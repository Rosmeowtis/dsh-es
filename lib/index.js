/**
 * dsh-es: whole-disk filename search for DeepSeek Harness, backed by Everything's
 * `es.exe` index. Registers one model-facing tool, `es_search`, which counts the
 * matches with `-get-result-count` and then asks for exactly one 100-row page.
 *
 * Every argv/parse/format decision lives in ./core.js as a pure function; this
 * module is only the harness seam — config, parameters, spawn, localization.
 *
 * @module dsh-es
 */
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
	PAGE_SIZE,
	SORT_FIELDS,
	SORT_ORDERS,
	buildCountArgv,
	buildSearchArgv,
	dupeMessage,
	esErrorText,
	findDupe,
	languageFromLocale,
	paginate,
	parseCount,
	parseResults,
	renderSearch,
} from './core.js';

export const name = 'es-search';
/** The tool registry and the process seam; nothing else is consumed. */
export const inject = ['tools', 'subprocess'];

/** Upper bound on `config.pageSize`: keeps one page inside the 1 MiB stdout cap. */
const MAX_PAGE_SIZE = 1000;
/** One page of paths, at the largest allowed page size, is far below this. */
const STDOUT_MAX_BYTES = 1 << 20;
const STDERR_MAX_BYTES = 64 << 10;
/** es.exe termination grace before the process tree is force-killed. */
const GRACE_MS = 2_000;
/** Cooperative budget for a cold Everything database load. */
const TIMEOUT_MS = 30_000;

/**
 * The bundled syntax cheat sheet, resolved from this module rather than the
 * cwd so it stays readable after the plugin is installed as a package.
 */
const SYNTAX_DOC = fileURLToPath(new URL('../docs/search-syntax.md', import.meta.url));

const DESCRIPTION = [
	'使用 es_search 工具在 Windows 上进行全盘文件名搜索。',
	'',
	'常用语法：通配符 `*.zip`、`report?.docx`；反选 `!*.txt`；类型 `ext:md`；大小 `size:>1gb`；修改时间 `date-modified:today`；路径 `path:D:/ros`；父目录 `parent:D:/projects`；区分大小写 `case:Read Me.txt`；正则 `regex:^ab.*\\.js$`。',
	'',
	`如以上语法无法满足搜索需求，则参阅 ${SYNTAX_DOC}`,
].join('\n');

/** Session-facing failure texts, in the language the caller's session uses. */
const MESSAGES = {
	zh: {
		emptyQuery: 'es_search 需要一个非空的 query。',
		dashQuery: 'es_search 的 query 不能以 "-" 开头：es.exe 会把它当成命令行选项。请改用通配符，例如 "*-report.txt"。',
		badPage: 'es_search 的 page 必须是正整数（从 1 开始）。',
		orderWithoutSort: 'es_search 的 order 需要同时给出 sort（排序字段），否则不会产生排序。',
		missingExecutable: (executable, detail) => `es_search 找不到 "${executable}"：请安装并运行 Everything，把 es.exe 加入 PATH，或在 dsh-es 的 config.executable 中填写完整路径（${detail}）。`,
		spawnFailed: (executable, detail) => `es_search 无法启动 ${executable}：${detail}`,
		noOutput: 'es_search 没有从 es.exe 收到任何输出。',
		signalExit: (signal) => `es.exe 被信号 ${signal} 终止，未返回结果。`,
		lossy: 'es_search 收到的 es.exe 输出超过保留上限，结果可能不完整：请缩小查询范围（例如加上 path: 或更具体的通配符）。',
		cancelled: 'es_search 已取消。',
	},
	en: {
		emptyQuery: 'es_search needs a non-empty query.',
		dashQuery: 'es_search query must not start with "-": es.exe reads that as a switch. Search for such a name with a wildcard instead, e.g. "*-report.txt".',
		badPage: 'es_search page must be a positive integer (1 or greater).',
		orderWithoutSort: 'es_search order needs sort (the field to sort by); on its own it sorts nothing.',
		missingExecutable: (executable, detail) => `es_search could not find "${executable}": install and run Everything, put es.exe on PATH, or set config.executable in the dsh-es patch row (${detail}).`,
		spawnFailed: (executable, detail) => `es_search could not start ${executable}: ${detail}`,
		noOutput: 'es_search got no captured output from es.exe.',
		signalExit: (signal) => `es.exe was terminated by ${signal} before returning results.`,
		lossy: 'es_search received more es.exe output than it retains, so results may be incomplete: narrow the query (e.g. add path: or a more specific wildcard).',
		cancelled: 'es_search was cancelled.',
	},
};

/**
 * Validate the deployment config once at plugin load rather than per call.
 * @param config - the patch row's `config` object.
 * @returns the configured es.exe name or absolute path, and rows per page.
 */
function readConfig(config) {
	const executable = config?.executable ?? 'es.exe';
	const pageSize = config?.pageSize ?? PAGE_SIZE;
	if (typeof executable !== 'string' || executable.length === 0) throw new Error('dsh-es: config.executable must be a non-empty string');
	if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
		throw new Error(`dsh-es: config.pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
	}
	return { executable, pageSize };
}

/**
 * Run es.exe once and return its complete stdout.
 *
 * Exit 0 means success even with zero results (es.exe reports "no matches" by
 * printing nothing); any other exit code is surfaced through `esErrorText` with
 * es.exe's own first line, which is how "Everything is not running" (exit 8)
 * reaches the model in its own language.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param executable - the configured es.exe name or absolute path.
 * @param argv - the es.exe arguments after the executable.
 * @param cwd - the working directory for the spawn.
 * @param exec - the tool-execution context, supplying cancellation.
 * @param language - 'zh' or 'en', from the caller's resolved locale.
 * @returns es.exe's complete raw stdout.
 */
async function runEs(ctx, executable, argv, cwd, exec, language) {
	const messages = MESSAGES[language];
	if (exec.signal.aborted) throw new Error(messages.cancelled);

	let resolved;
	try {
		resolved = await ctx.subprocess.resolveExecutable(executable);
	} catch (error) {
		throw new Error(messages.missingExecutable(executable, error.message));
	}

	let handle;
	try {
		handle = ctx.subprocess.spawn({
			argv: [resolved, ...argv],
			cwd,
			stdio: {
				stdin: 'ignore',
				stdout: { maxBytes: STDOUT_MAX_BYTES },
				stderr: { maxBytes: STDERR_MAX_BYTES },
			},
			graceMs: GRACE_MS,
			signal: exec.signal,
		});
	} catch (error) {
		throw new Error(messages.spawnFailed(executable, error.message));
	}

	let outcome;
	try {
		outcome = await handle.done;
	} catch (error) {
		if (exec.signal.aborted) throw new Error(messages.cancelled);
		throw new Error(messages.spawnFailed(executable, error.message));
	}
	const stdout = handle.collected.stdout?.readFrom(0);
	const stderr = handle.collected.stderr?.readFrom(0);
	if (stdout === undefined || stderr === undefined) throw new Error(messages.noOutput);
	if (exec.signal.aborted) throw new Error(messages.cancelled);
	if (outcome.exitCode === null) throw new Error(messages.signalExit(outcome.signal));
	if (outcome.exitCode !== 0) {
		const detail = `${stdout.text}${stderr.text}`.trim().split('\n')[0]?.trim() ?? '';
		throw new Error(esErrorText(outcome.exitCode, detail, language));
	}
	if (stdout.lossy) throw new Error(messages.lossy);
	return stdout.text;
}

/**
 * Register the `es_search` tool.
 * @param ctx - registrant context carrying the tool and subprocess registries.
 * @param config - the patch row's `config`.
 */
export function apply(ctx, config) {
	const { executable, pageSize } = readConfig(config);
	const language = languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
	const messages = MESSAGES[language];

	ctx.tools.register(defineTool({
		name: 'es_search',
		description: DESCRIPTION,
		timeoutMs: TIMEOUT_MS,
		isConcurrencySafe: () => true,
		parameters: {
			query: {
				type: 'string',
				required: true,
				description: 'Everything 查询语法：词、通配符 `*.zip`、`ext:md`、`size:>1gb`、`dm:today`、`path:`、`parent:` 等。',
			},
			page: {
				type: 'integer',
				description: `页码，每页固定 ${pageSize} 条，从 1 开始。`,
			},
			style: {
				type: 'string',
				enum: ['posix', 'msys', 'wsl'],
				description: '返回路径风格：posix `D:/x`、msys `/d/x`、wsl `/mnt/d/x`。',
			},
			sort: {
				oneOf: [
					{ type: 'string', enum: SORT_FIELDS },
					{ type: 'null' },
				],
				description: '排序字段；省略或传 null 时使用索引默认顺序。',
			},
			order: {
				type: 'string',
				enum: SORT_ORDERS,
				description: '排序方向：ascending 升序、descending 降序；省略则用该字段的默认方向，需配合 sort。',
			},
			type: {
				type: 'string',
				enum: ['all', 'folder', 'file'],
				description: '搜索类型：all 全部、folder 仅文件夹、file 仅文件。',
			},
		},
		output: {
			schema: { type: 'string' },
			render: (_args, text) => [{ type: 'text', text }],
		},
		presentCall: (args) => ({
			card: 'generic',
			title: `Search Everything: ${args.query}`,
			kind: 'search',
		}),
		async execute(args, exec) {
			const query = args.query.trim();
			if (query === '') throw new Error(messages.emptyQuery);
			const dupe = findDupe(query);
			if (dupe !== null) throw new Error(dupeMessage(dupe, language));
			if (query.startsWith('-')) throw new Error(messages.dashQuery);
			const page = args.page ?? 1;
			if (page < 1) throw new Error(messages.badPage);
			const sort = args.sort ?? null;
			const order = args.order ?? null;
			if (sort === null && order !== null) throw new Error(messages.orderWithoutSort);
			const type = args.type ?? 'all';
			const style = args.style ?? 'posix';
			const cwd = exec.agent?.session.header.cwd ?? process.cwd();

			const count = parseCount(await runEs(ctx, executable, buildCountArgv(query, { sort, order, type }), cwd, exec, language));
			const { page: current, totalPages, offset } = paginate(count, page, pageSize);
			const results = count === 0
				? []
				: parseResults(
					await runEs(ctx, executable, buildSearchArgv(query, { sort, order, type, offset, limit: pageSize }), cwd, exec, language),
					style,
				).slice(0, pageSize);
			return renderSearch({ count, page: current, totalPages, results });
		},
	}));
}
