/**
 * Pure es.exe plumbing for the dsh-es plugin: POSIX⇄Windows path translation,
 * argv assembly, and result-line parsing. No harness imports live here, so
 * `node --test test/` can exercise all of it without a profile install.
 * @module dsh-es/core
 */

/** Absolute-looking on this platform: `D:/x`, `/d/x`, `\\server\share`, `C:\x`. */
const ABSOLUTE = /^(?:[A-Za-z]:|\/|\\)/;

/**
 * Whether a model-supplied path is absolute in any of the accepted dialects.
 * @param path - the path as the model wrote it.
 * @returns true when the path needs no cwd resolution.
 */
export function isAbsolutePath(path) {
	return ABSOLUTE.test(path);
}

/**
 * Windows path (or Anything) → the POSIX-compatible form this plugin returns:
 * forward slashes, drive letter or `//server/share` kept, so `D:\a\b` becomes
 * `D:/a/b` and stays directly usable by every other dsh tool on Windows while
 * never carrying a backslash through a tool-call escape layer.
 * @param path - one path as es.exe printed it.
 * @returns the POSIX-compatible display path.
 */
export function toPosix(path) {
	return path
		.replace(/^\\\\\?\\UNC\\/i, '\\\\')
		.replace(/^\\\\\?\\/, '')
		.replace(/\\/g, '/');
}

/**
 * Model-supplied path → the Windows form es.exe expects. Accepts `D:/a/b`,
 * `/d/a/b` (MSYS form), `//server/share/x`, and already-native `D:\a\b`.
 * @param path - the path as the model wrote it.
 * @returns the Windows path for argv.
 */
export function toWindows(path) {
	const drive = /^\/([A-Za-z])(?=\/|$)/.exec(path);
	if (drive !== null) return `${drive[1].toUpperCase()}:${path.slice(2).replace(/\//g, '\\')}`;
	return path.replace(/\//g, '\\');
}

/**
 * Build the es.exe argv for one search. Every model value is one argv element
 * and no shell layer exists, so nothing is quoted or interpolated.
 * @param options - the search request.
 * @returns the argv after the executable.
 */
export function buildArgv(options) {
	const argv = ['-n', String(options.max)];
	if (options.regex) argv.push('-r');
	if (options.matchPath) argv.push('-p');
	if (options.kind === 'files') argv.push('/a-d');
	else if (options.kind === 'folders') argv.push('/ad');
	if (options.sort !== undefined) argv.push('-sort', options.sort);
	if (options.path !== undefined) argv.push('-path', options.path);
	argv.push(options.query);
	return argv;
}

/**
 * es.exe stdout → POSIX paths. One path per line, CRLF-terminated and UTF-8;
 * surrounding whitespace is NOT trimmed because a filename may legitimately
 * contain it.
 * @param text - the complete raw stdout.
 * @returns the de-duplicated paths, in the order es.exe printed them.
 */
export function parseResults(text) {
	const results = [];
	const seen = new Set();
	for (const line of text.split('\n')) {
		const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (trimmed === '') continue;
		const path = toPosix(trimmed.startsWith('\uFEFF') ? trimmed.slice(1) : trimmed);
		if (seen.has(path)) continue;
		seen.add(path);
		results.push(path);
	}
	return results;
}
