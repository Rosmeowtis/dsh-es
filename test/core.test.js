/**
 * Runnable check for dsh-es: pure path/argv/parse logic, plus one live es.exe
 * round trip that skips itself when Everything or es.exe is unavailable.
 * `npm test` (or `node --test test/`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildArgv, isAbsolutePath, parseResults, toPosix, toWindows } from '../lib/core.js';

test('toPosix keeps the drive or share and drops every backslash', () => {
	assert.equal(toPosix('D:\\ros\\repos\\dsh-es'), 'D:/ros/repos/dsh-es');
	assert.equal(toPosix('C:\\Users\\me\\最终幻想.zip'), 'C:/Users/me/最终幻想.zip');
	assert.equal(toPosix('\\\\server\\share\\x'), '//server/share/x');
	assert.equal(toPosix('\\\\?\\C:\\deep\\path'), 'C:/deep/path');
	assert.equal(toPosix('\\\\?\\UNC\\server\\share\\x'), '//server/share/x');
	assert.equal(toPosix('D:/already/posix'), 'D:/already/posix');
});

test('toWindows accepts every dialect the model may pass', () => {
	assert.equal(toWindows('D:/ros/x'), 'D:\\ros\\x');
	assert.equal(toWindows('/d/ros/x'), 'D:\\ros\\x');
	assert.equal(toWindows('/D/ros/x'), 'D:\\ros\\x');
	assert.equal(toWindows('//server/share/x'), '\\\\server\\share\\x');
	assert.equal(toWindows('D:\\ros\\x'), 'D:\\ros\\x');
	assert.equal(toWindows('D:/ros/x/'), 'D:\\ros\\x\\');
});

test('isAbsolutePath distinguishes cwd-relative input', () => {
	assert.equal(isAbsolutePath('D:/x'), true);
	assert.equal(isAbsolutePath('/d/x'), true);
	assert.equal(isAbsolutePath('//server/share'), true);
	assert.equal(isAbsolutePath('\\\\server\\share'), true);
	assert.equal(isAbsolutePath('sub/dir'), false);
	assert.equal(isAbsolutePath('.'), false);
});

test('buildArgv places the query last and only emits requested switches', () => {
	assert.deepEqual(
		buildArgv({ query: 'ext:md handbook', max: 5, kind: 'any' }),
		['-n', '5', 'ext:md handbook'],
	);
	assert.deepEqual(
		buildArgv({ query: 'a', max: 1, kind: 'folders', regex: true, matchPath: true, sort: 'size-descending', path: 'D:\\ros' }),
		['-n', '1', '-r', '-p', '/ad', '-sort', 'size-descending', '-path', 'D:\\ros', 'a'],
	);
	assert.deepEqual(buildArgv({ query: 'a', max: 2, kind: 'files' }), ['-n', '2', '/a-d', 'a']);
});

test('parseResults keeps spaces, drops CRLF noise and duplicates', () => {
	const text = '\uFEFFD:\\a b\\c.txt\r\nD:\\a b\\c.txt\r\n\r\nC:\\d\\e f\r\n';
	assert.deepEqual(parseResults(text), ['D:/a b/c.txt', 'C:/d/e f']);
	assert.deepEqual(parseResults(''), []);
});

test('live: es.exe answers through buildArgv/parseResults in POSIX form', (t) => {
	const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
	const scratch = join(repoRoot, 'test', '.es-smoke.txt');
	mkdirSync(dirname(scratch), { recursive: true });
	const fd = openSync(scratch, 'w');
	// File-descriptor stdio, not pipes: this works under the harness' own
	// Windows sandbox, where spawned pipes are denied.
	const run = spawnSync(process.env.DSH_ES_EXE ?? 'es.exe', buildArgv({ query: '*', max: 5, kind: 'any' }), {
		stdio: ['ignore', fd, fd],
		windowsHide: true,
	});
	closeSync(fd);
	const output = readFileSync(scratch, 'utf8');
	rmSync(scratch, { force: true });

	if (run.error?.code === 'ENOENT') return t.skip('es.exe not on PATH');
	if (run.status === 8) return t.skip('Everything is not running (es.exe error 8)');
	assert.equal(run.status, 0, output);

	const results = parseResults(output);
	assert.ok(results.length > 0, 'the Everything index returned nothing at all');
	for (const path of results) {
		assert.ok(!path.includes('\\'), `backslash reached the tool boundary: ${path}`);
		assert.ok(/^([A-Za-z]:\/|\/\/)/.test(path), `not an absolute POSIX path: ${path}`);
		assert.equal(path, toPosix(toWindows(path)));
	}
});
