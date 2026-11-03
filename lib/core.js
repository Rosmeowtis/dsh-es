/**
 * Pure es.exe plumbing for the dsh-es plugin: argv assembly, result/count
 * parsing, path styling, pagination, and the localized text the tool returns.
 * No harness imports live here, so `npm test` can exercise all of it
 * without a profile install.
 * @module dsh-es/core
 */

/** Default rows per page; `config.pageSize` overrides it (1-1000, validated there). */
export const PAGE_SIZE = 100;

/** Every field es.exe documents for `-sort`. */
export const SORT_FIELDS = [
	'name',
	'path',
	'size',
	'extension',
	'date-created',
	'date-modified',
	'date-accessed',
	'attributes',
	'file-list-file-name',
	'run-count',
	'date-recently-changed',
	'date-run',
];

/**
 * Every value `order` accepts: the direction suffix carried by the field name
 * (`-sort name-descending`). Omitted order means es.exe's own default.
 */
export const SORT_ORDERS = ['ascending', 'descending'];

/**
 * Everything's dupe operators, case-insensitively: `dupe:`, `dupe-from:`, and
 * any other `dupe-…:` variant. `dupefoo:` is deliberately not a match — the
 * colon must follow the operator itself or one dashed suffix.
 */
const DUPE_OPERATOR = /\bdupe(?:-[a-z-]+)?:/i;

/** A token es.exe would read as a switch rather than as search text. */
const SWITCH_LIKE = /^[-/]/;

/** `\\?\UNC\server\share` / `\\?\C:\`: the extended-length prefixes es.exe may print. */
const EXTENDED_UNC = /^\\\\\?\\UNC\\/i;
const EXTENDED_PATH = /^\\\\\?\\/;

/** A styled drive path still starts with its letter, whatever the style. */
const DRIVE = /^([A-Za-z]):/;

/**
 * Whether a query asks for Everything's dupe matching, which this plugin
 * refuses: it compares size and hash across the whole index.
 * @param query - the model-supplied query.
 * @returns the offending operator text (`dupe:`, `dupe-from:`, …) or null.
 */
export function findDupe(query) {
	const found = DUPE_OPERATOR.exec(String(query ?? ''));
	return found === null ? null : found[0];
}

/**
 * Split a query into one es.exe argument per whitespace-separated token.
 *
 * es.exe joins its non-switch arguments into one Everything search string, but
 * it re-quotes every argument that contains a space. Handing it the whole query
 * as a single argument therefore makes Everything read `ext:jpg size:>1mb` as
 * the literal phrase `"ext:jpg size:>1mb"`, and every operator/AND term in it
 * stops working (count 0, no results). One token per argument keeps Everything's
 * own parsing in charge; a quoted phrase survives because its quote characters
 * ride along inside the split tokens.
 * @param query - Everything query syntax text.
 * @returns the search arguments, in query order.
 */
export function splitQuery(query) {
	return String(query ?? '')
		.split(/\s+/)
		.filter((token) => token !== '')
		.map((token) => (SWITCH_LIKE.test(token) ? `"${token}"` : token));
}

/**
 * The filesystem switch for one `type`; `all` (and any unknown value) means no
 * switch at all.
 * @param type - `all`, `folder`, or `file`.
 * @returns `/ad`, `/a-d`, or null.
 */
function typeSwitch(type) {
	return type === 'folder' ? '/ad' : type === 'file' ? '/a-d' : null;
}

/**
 * The `-sort` value for one field and direction: `name-descending`. Order is
 * optional, and an absent order leaves es.exe's default direction in place.
 * @param sort - an es.exe sort field, or null/undefined for index order.
 * @param order - `ascending`, `descending`, or null/undefined for the default.
 * @returns the sort value, or null when sorting is off.
 */
function sortSwitch(sort, order) {
	if (sort === null || sort === undefined) return null;
	return order === null || order === undefined ? sort : `${sort}-${order}`;
}

/**
 * Append the optional type and sort switches, in that order.
 * @param argv - the argv being assembled.
 * @param sort - an es.exe sort field, or null/undefined for index order.
 * @param order - `ascending`, `descending`, or null/undefined for the default.
 * @param type - `all`, `folder`, or `file`.
 */
function appendFilters(argv, sort, order, type) {
	const attribute = typeSwitch(type);
	if (attribute !== null) argv.push(attribute);
	const sorted = sortSwitch(sort, order);
	if (sorted !== null) argv.push('-sort', sorted);
}

/**
 * Build the es.exe argv for one page of results. Every value is its own argv
 * element and no shell layer exists, so nothing is quoted or interpolated.
 * @param query - Everything query syntax text.
 * @param options - page selection and filters.
 * @returns the argv after the executable.
 */
export function buildSearchArgv(query, options = {}) {
	const { sort, order, type, offset = 0, limit = PAGE_SIZE } = options;
	const argv = ['-n', String(limit), '-o', String(offset)];
	appendFilters(argv, sort, order, type);
	argv.push(...splitQuery(query));
	return argv;
}

/**
 * Build the es.exe argv for one total count. `-n`/`-o` are absent because the
 * count must cover every match, not the requested page.
 * @param query - Everything query syntax text.
 * @param options - the same filters as the search, minus paging.
 * @returns the argv after the executable.
 */
export function buildCountArgv(query, options = {}) {
	const { sort, order, type } = options;
	const argv = [];
	appendFilters(argv, sort, order, type);
	argv.push('-get-result-count', ...splitQuery(query));
	return argv;
}

/**
 * es.exe `-get-result-count` stdout → the total. Anything but a non-negative
 * integer is an upstream failure, so the raw first line is carried into the
 * message instead of a misleading zero.
 * @param text - the complete raw stdout.
 * @returns the result count.
 */
export function parseCount(text) {
	const lines = String(text).split('\n');
	const raw = lines.find((line) => line.trim() !== '') ?? lines[0] ?? '';
	const cleaned = raw.replace(/^\uFEFF/, '').trim();
	if (/^\d+$/.test(cleaned)) return Number(cleaned);
	throw new Error(`es.exe returned an unparsable result count: ${raw.trim()}`);
}

/**
 * Windows path → the display style this plugin returns: forward slashes
 * everywhere, so no path ever carries a backslash through a tool-call escape
 * layer. `\\?\` prefixes are dropped, and a UNC share stays `//server/share`
 * in every style because MSYS and WSL accept that form as-is.
 * @param rawPath - one path as es.exe printed it.
 * @param style - `posix`, `msys`, or `wsl`.
 * @returns the display path.
 */
export function formatPath(rawPath, style) {
	const posix = String(rawPath).replace(EXTENDED_UNC, '\\\\').replace(EXTENDED_PATH, '').replace(/\\/g, '/');
	const drive = DRIVE.exec(posix);
	if (drive === null) return posix;
	const letter = drive[1].toLowerCase();
	const rest = posix.slice(2);
	if (style === 'msys') return `/${letter}${rest}`;
	if (style === 'wsl') return `/mnt/${letter}${rest}`;
	return posix;
}

/**
 * es.exe stdout → styled paths. One path per line, CRLF-terminated and UTF-8;
 * surrounding whitespace is NOT trimmed because a filename may legitimately
 * contain it.
 * @param text - the complete raw stdout.
 * @param style - `posix`, `msys`, or `wsl`.
 * @returns the de-duplicated paths, in the order es.exe printed them.
 */
export function parseResults(text, style = 'posix') {
	const results = [];
	const seen = new Set();
	for (const line of String(text).split('\n')) {
		const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (trimmed === '') continue;
		const path = formatPath(trimmed.startsWith('\uFEFF') ? trimmed.slice(1) : trimmed, style);
		if (seen.has(path)) continue;
		seen.add(path);
		results.push(path);
	}
	return results;
}

/**
 * Clamp a requested page onto the pages that actually exist, so a model can
 * ask for page 99 of a two-page result and still get the last page.
 * @param count - the total match count from `-get-result-count`.
 * @param page - the requested 1-based page.
 * @param pageSize - rows per page, from `config.pageSize`.
 * @returns the resolved page, total page count, and 0-based es.exe offset.
 */
export function paginate(count, page, pageSize = PAGE_SIZE) {
	const totalPages = Math.max(1, Math.ceil(count / pageSize));
	const wanted = Number.isInteger(page) && page >= 1 ? page : 1;
	const current = Math.min(wanted, totalPages);
	return { page: current, totalPages, offset: (current - 1) * pageSize };
}

/**
 * The exact text handed back to the session: a two-line header and one path
 * per line, with no trailing newline.
 * @param page - the resolved page, total pages, count, and its paths.
 * @returns the rendered tool output.
 */
export function renderSearch({ count, page, totalPages, results }) {
	const lines = [`count: ${count}`, `page: ${page} / ${totalPages}`, 'results:'];
	for (const result of results) lines.push(result);
	return lines.join('\n');
}

/**
 * Pick the message language from a locale tag.
 * @param locale - a BCP 47 tag such as `zh-CN` or `en-US`.
 * @returns `zh` or `en`.
 */
export function languageFromLocale(locale) {
	return String(locale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * The refusal shown when the query uses a dupe operator.
 * @param operator - the operator text, such as `dupe-from:`.
 * @param language - `zh` or `en`.
 * @returns the one-line message.
 */
export function dupeMessage(operator, language) {
	return language === 'zh'
		? `本工具不支持 dupe 相关功能（${operator} 会对全量文件做尺寸/哈希比对，耗时极长）。`
		: `dsh-es does not support the ${operator} operator: it compares size and hash across the whole index and is far too slow.`;
}

/** es.exe's way of saying it cannot reach a running Everything. */
const NOT_RUNNING = /not running|ipc window|error 8/i;

/**
 * es.exe's failure, localized to one line. `exitCode` is null when the process
 * died from a signal, in which case the message names the signal rather than
 * printing `null`; an empty `detail` drops the trailing colon instead of
 * leaving it dangling.
 * @param exitCode - the numeric exit code, or null for a signalled process.
 * @param detail - the first line es.exe printed, possibly empty.
 * @param language - `zh` or `en`.
 * @returns the one-line error message.
 */
export function esErrorText(exitCode, detail, language) {
	const problem = String(detail ?? '').trim();
	const code = exitCode ?? 'signal';
	if (NOT_RUNNING.test(problem)) {
		return language === 'zh'
			? `Everything 索引未运行：请先启动 Everything 再重试（es.exe 退出码 ${code}）。`
			: `Everything is not running. Start Everything, then search again (es.exe exit ${code}).`;
	}
	if (language === 'zh') return `es.exe 执行失败（退出码 ${code}）${problem === '' ? '' : `：${problem}`}`;
	return `es.exe failed (exit ${code})${problem === '' ? '' : `: ${problem}`}`;
}
