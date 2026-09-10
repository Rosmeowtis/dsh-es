/**
 * dsh-es: whole-disk NTFS discovery for DeepSeek Harness, backed by Everything's
 * `es.exe` index. Registers one model-facing tool, `es_search`.
 *
 * Every path crossing the tool boundary is POSIX-compatible in both directions —
 * `D:/ros/x`, `/d/ros/x`, `//server/share/x` in, `D:/ros/x` out — so a Windows
 * backslash never has to survive a JSON/tool-call escape layer.
 *
 * @module dsh-es
 */
import { resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildArgv, isAbsolutePath, parseResults, toWindows } from './core.js';

export const name = 'es-search';
/** The tool registry and the process seam; nothing else is consumed. */
export const inject = ['tools', 'subprocess'];

/** Hard cap on `max`, so one call can never flood the context. */
const MAX_RESULTS_CAP = 1000;
/** es.exe prints one path per line; 8 MiB is far above 1000 indexed paths. */
const RAW_STDOUT_MAX_BYTES = 8 << 20;
const STDERR_MAX_BYTES = 64 << 10;
/** es.exe termination grace before the process tree is force-killed. */
const GRACE_MS = 2_000;
/** Cooperative budget for a cold Everything database load. */
const TIMEOUT_MS = 30_000;

const SORTS = [
	'name',
	'name-descending',
	'path',
	'path-descending',
	'size',
	'size-descending',
	'extension',
	'extension-descending',
	'date-modified',
	'date-modified-descending',
	'date-created',
	'date-created-descending',
	'date-accessed',
	'date-accessed-descending',
	'run-count',
	'run-count-descending',
];

const DESCRIPTION = [
	'Search every indexed local volume instantly, through the Everything index (es.exe) — the whole-disk lookup that `glob` cannot reach because it is confined to the workspace.',
	'',
	'Search text uses the Everything query syntax: plain words match the file NAME (space-separated words are ANDed), `*.zip` and `report?.docx` are wildcards, and filters combine, e.g. `ext:md handbook`, `size:>1gb ext:iso`, `dm:today folder:downloads`, `parent:D:/projects report`, `case:READ ME.txt`.',
	'',
	'Paths are POSIX-compatible on both sides: pass `path` as `D:/ros/proj`, `/d/ros/proj` or `//server/share` (relative resolves against the session cwd), and every result comes back as `D:/ros/...`, ready for read/glob/grep/edit. Never pass a wildcard backslash path.',
	'',
	'Results are index facts, not a live scan: a file created seconds ago may still be missing, and hits outside the workspace may later be refused by sandboxed tools.',
].join('\n');

/**
 * Validate the deployment config once at plugin load rather than per call.
 * @param config - the patch row's `config` object.
 * @returns the resolved executable and default result limit.
 */
function readConfig(config) {
	const executable = config?.executable ?? 'es.exe';
	const maxResults = config?.maxResults ?? 200;
	if (typeof executable !== 'string' || executable.length === 0) throw new Error('dsh-es: config.executable must be a non-empty string');
	if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('dsh-es: config.maxResults must be a positive integer');
	return { executable, maxResults };
}

/**
 * Resolve one model-supplied path to the Windows form es.exe wants.
 * @param path - `D:/x`, `/d/x`, `//server/share/x`, or a cwd-relative path.
 * @param cwd - the calling agent's session cwd.
 * @returns the absolute Windows path.
 */
function resolveSearchPath(path, cwd) {
	return toWindows(isAbsolutePath(path) ? path : resolve(cwd, path));
}

/**
 * Run es.exe once and return its complete stdout.
 *
 * Exit 0 means success even with zero results (es.exe reports "no matches" by
 * printing nothing); any other exit code is surfaced with es.exe's own message,
 * which is how "Everything is not running" (exit 8) and "query read as a switch"
 * (exit 6) reach the model.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param executable - the configured es.exe name or absolute path.
 * @param argv - the es.exe arguments after the executable.
 * @param cwd - the working directory for the spawn.
 * @param exec - the tool-execution context, supplying cancellation.
 * @returns es.exe's complete raw stdout.
 */
async function runEs(ctx, executable, argv, cwd, exec) {
	if (exec.signal.aborted) throw new Error('es_search was cancelled before it ran');
	let resolved;
	try {
		resolved = await ctx.subprocess.resolveExecutable(executable);
	} catch (error) {
		throw new Error(`es_search could not find "${executable}". Install Everything and put es.exe on PATH, or set config.executable in the dsh-es patch row (${error.message})`);
	}

	let handle;
	try {
		handle = ctx.subprocess.spawn({
			argv: [resolved, ...argv],
			cwd,
			stdio: {
				stdin: 'ignore',
				stdout: { maxBytes: RAW_STDOUT_MAX_BYTES },
				stderr: { maxBytes: STDERR_MAX_BYTES },
			},
			graceMs: GRACE_MS,
			signal: exec.signal,
		});
	} catch (error) {
		throw new Error(`es_search could not start ${executable}: ${error.message}`);
	}

	let outcome;
	try {
		outcome = await handle.done;
	} catch (error) {
		throw new Error(`es_search could not start ${executable}: ${error.message}`);
	}
	const stdout = handle.collected.stdout?.readFrom(0);
	const stderr = handle.collected.stderr?.readFrom(0);
	if (stdout === undefined || stderr === undefined) throw new Error('es_search got no captured output from es.exe');
	if (outcome.exitCode !== 0) {
		const detail = `${stdout.text}${stderr.text}`.trim().split('\n')[0] ?? '';
		throw new Error(`es.exe exited with ${outcome.exitCode ?? `signal ${outcome.signal}`}${detail === '' ? '' : `: ${detail}`}`);
	}
	if (stdout.lossy) throw new Error('es_search received more output than it retains; lower max or narrow the query');
	return stdout.text;
}

/**
 * Register the `es_search` tool.
 * @param ctx - registrant context carrying the tool and subprocess registries.
 * @param config - the patch row's `config`.
 */
export function apply(ctx, config) {
	const { executable, maxResults } = readConfig(config);

	ctx.tools.register(defineTool({
		name: 'es_search',
		description: DESCRIPTION,
		timeoutMs: TIMEOUT_MS,
		isConcurrencySafe: () => true,
		parameters: {
			query: {
				type: 'string',
				required: true,
				description: 'Everything search text: names, wildcards, and filters such as `ext:md handbook` or `size:>1gb ext:iso`.',
			},
			path: {
				type: 'string',
				description: 'Restrict the search to this folder and below, POSIX-style ("D:/ros", "/d/ros/proj", "//server/share"); a relative path resolves against the session cwd.',
			},
			max: {
				type: 'integer',
				description: `Maximum results to return (default ${maxResults}, hard cap ${MAX_RESULTS_CAP}).`,
			},
			regex: {
				type: 'boolean',
				description: 'Match with es.exe -r (Everything regex) instead of query syntax. Anchored patterns are unreliable on Everything 1.4 and then silently return zero rows — prefer wildcards like `*.zip`.',
			},
			matchPath: {
				type: 'boolean',
				description: 'Match the query against the whole path instead of just the file name (es.exe -p).',
			},
			kind: {
				type: 'string',
				enum: ['any', 'files', 'folders'],
				description: 'Return everything (default), files only, or folders only.',
			},
			sort: {
				type: 'string',
				enum: SORTS,
				description: 'Result order; `size-descending` finds the largest files, `date-modified-descending` the newest. Omit for index order.',
			},
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					query: { type: 'string', required: true },
					results: { type: 'array', required: true, items: { type: 'string' } },
					count: { type: 'integer', required: true },
					max: { type: 'integer', required: true },
					truncated: { type: 'boolean', required: true },
				},
			},
			render: (_args, value) => {
				if (value.count === 0) return [{ type: 'text', text: `No matches in the Everything index for: ${value.query}` }];
				const lines = [...value.results];
				if (value.truncated) lines.push(`(showing the first ${value.count} matches — raise \`max\` or narrow the query for more)`);
				return [{ type: 'text', text: `${value.count} match${value.count === 1 ? '' : 'es'} for ${value.query}:\n${lines.join('\n')}` }];
			},
		},
		presentCall: (args) => ({
			card: 'generic',
			title: `Search Everything: ${args.query}`,
			kind: 'search',
		}),
		async execute(args, exec) {
			const query = args.query.trim();
			if (query === '') throw new Error('es_search needs a non-empty query');
			if (query.startsWith('-')) throw new Error('es_search query must not start with "-": es.exe reads that as a switch. Search for such a name with a wildcard instead, e.g. "*-report.txt".');

			const max = Math.min(args.max ?? maxResults, MAX_RESULTS_CAP);
			const cwd = exec.agent?.session.header.cwd ?? process.cwd();
			const argv = buildArgv({
				query,
				// Ask for one row past the page: its presence is the only proof that
				// more matches exist, and it costs one line rather than a second
				// es.exe call just to read a count.
				max: max + 1,
				path: args.path === undefined ? undefined : resolveSearchPath(args.path, cwd),
				regex: args.regex === true,
				matchPath: args.matchPath === true,
				kind: args.kind ?? 'any',
				sort: args.sort,
			});

			const found = parseResults(await runEs(ctx, executable, argv, cwd, exec));
			const results = found.slice(0, max);
			return { query, results, count: results.length, max, truncated: found.length > max };
		},
	}));
}
