/**
 * Runnable check for dsh-es: pure argv/parse/style/paging logic, plus one live
 * es.exe round trip that skips itself when Everything or es.exe is unavailable.
 * `npm test` (or `node --test test/`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	PAGE_SIZE,
	SORT_FIELDS,
	SORTS,
	buildCountArgv,
	buildSearchArgv,
	dupeMessage,
	esErrorText,
	findDupe,
	formatPath,
	languageFromLocale,
	paginate,
	parseCount,
	parseResults,
	renderSearch,
} from '../lib/core.js';

test('SORTS expands every sort field into its three accepted forms', () => {
	assert.equal(SORT_FIELDS.length, 12);
	assert.equal(SORTS.length, 36);
	assert.equal(new Set(SORTS).size, 36);
	for (const field of SORT_FIELDS) {
		assert.ok(SORTS.includes(field), field);
		assert.ok(SORTS.includes(`${field}-ascending`), field);
		assert.ok(SORTS.includes(`${field}-descending`), field);
	}
	assert.equal(PAGE_SIZE, 100);
});

test('findDupe reports the operator and leaves lookalikes alone', () => {
	assert.equal(findDupe('dupe:'), 'dupe:');
	assert.equal(findDupe('report.txt dupe:'), 'dupe:');
	assert.equal(findDupe('DUPE-FROM:C:\\ros'), 'DUPE-FROM:');
	assert.equal(findDupe('dupe-size:1'), 'dupe-size:');
	// Locked in: the colon must follow `dupe` or one dashed suffix, so these are
	// ordinary search text, not a dupe operator. `DUP-FROM:` has no `dupe` in it
	// either, and Everything does not read it as an operator.
	assert.equal(findDupe('DUP-FROM:'), null);
	assert.equal(findDupe('dupefoo:'), null);
	assert.equal(findDupe('xdupe:'), null);
	assert.equal(findDupe('ext:md handbook'), null);
	assert.equal(findDupe(''), null);
});

test('buildSearchArgv pins the switch order and page window', () => {
	assert.deepEqual(
		buildSearchArgv('ext:md handbook', { sort: null, type: 'all', offset: 0, limit: 5 }),
		['-n', '5', '-o', '0', 'ext:md handbook'],
	);
	assert.deepEqual(
		buildSearchArgv('a', { sort: 'size-descending', type: 'folder', offset: 100, limit: 100 }),
		['-n', '100', '-o', '100', '/ad', '-sort', 'size-descending', 'a'],
	);
	assert.deepEqual(
		buildSearchArgv('a', { sort: undefined, type: 'file', offset: 0, limit: 100 }),
		['-n', '100', '-o', '0', '/a-d', 'a'],
	);
	assert.deepEqual(buildSearchArgv('a', {}), ['-n', '100', '-o', '0', 'a']);
});

test('buildCountArgv asks for the total with the same filters and no paging', () => {
	assert.deepEqual(
		buildCountArgv('a', { sort: 'name', type: 'file' }),
		['/a-d', '-sort', 'name', '-get-result-count', 'a'],
	);
	assert.deepEqual(buildCountArgv('a', { sort: null, type: 'all' }), ['-get-result-count', 'a']);
	assert.deepEqual(buildCountArgv('a', {}), ['-get-result-count', 'a']);
});

test('parseCount reads a non-negative integer and rejects anything else', () => {
	assert.equal(parseCount('2987482\r\n'), 2987482);
	assert.equal(parseCount('\uFEFF0\n'), 0);
	assert.equal(parseCount('  42  \n'), 42);
	assert.equal(parseCount('7'), 7);
	assert.throws(() => parseCount('garbage\n'), /unparsable result count: garbage/);
	assert.throws(() => parseCount('-1'), /unparsable result count: -1/);
	assert.throws(() => parseCount(''), /unparsable result count/);
});

test('formatPath renders each style from the same raw path', () => {
	assert.equal(formatPath('D:\\a\\b', 'posix'), 'D:/a/b');
	assert.equal(formatPath('D:\\a\\b', 'msys'), '/d/a/b');
	assert.equal(formatPath('D:\\a\\b', 'wsl'), '/mnt/d/a/b');
	assert.equal(formatPath('D:/already/posix', 'posix'), 'D:/already/posix');
	assert.equal(formatPath('C:\\Users\\me\\最终幻想.zip', 'wsl'), '/mnt/c/Users/me/最终幻想.zip');
	// A drive letter lowercases for msys/wsl, but stays as printed for posix.
	assert.equal(formatPath('d:\\x', 'posix'), 'd:/x');
});

test('formatPath strips extended-length prefixes and keeps UNC in every style', () => {
	assert.equal(formatPath('\\\\?\\C:\\deep\\path', 'posix'), 'C:/deep/path');
	assert.equal(formatPath('\\\\?\\C:\\deep\\path', 'wsl'), '/mnt/c/deep/path');
	assert.equal(formatPath('\\\\?\\UNC\\server\\share\\x', 'posix'), '//server/share/x');
	assert.equal(formatPath('\\\\?\\UNC\\server\\share\\x', 'msys'), '//server/share/x');
	assert.equal(formatPath('\\\\server\\share\\x', 'wsl'), '//server/share/x');
	// Unknown style falls back to posix.
	assert.equal(formatPath('D:\\a\\b', 'bogus'), 'D:/a/b');
});

test('parseResults drops CR, BOM, blank lines and duplicates without trimming names', () => {
	const text = '\uFEFFD:\\a b\\c.txt\r\nD:\\a b\\c.txt\r\n\r\nC:\\d\\e f\r\n';
	assert.deepEqual(parseResults(text), ['D:/a b/c.txt', 'C:/d/e f']);
	assert.deepEqual(parseResults(''), []);
	assert.equal(parseResults('D:\\a b\\c.txt\n')[0], 'D:/a b/c.txt');
	assert.deepEqual(parseResults('D:\\a\\b\r\n', 'wsl'), ['/mnt/d/a/b']);
});

test('paginate rounds pages up and clamps the request onto them', () => {
	assert.deepEqual(paginate(0, 1), { page: 1, totalPages: 1, offset: 0 });
	assert.deepEqual(paginate(100, 1), { page: 1, totalPages: 1, offset: 0 });
	assert.deepEqual(paginate(101, 1), { page: 1, totalPages: 2, offset: 0 });
	assert.deepEqual(paginate(101, 99), { page: 2, totalPages: 2, offset: 100 });
	assert.deepEqual(paginate(201, 3), { page: 3, totalPages: 3, offset: 200 });
	// Non-positive, fractional, or missing pages all mean page 1.
	assert.equal(paginate(500, 0).page, 1);
	assert.equal(paginate(500, -3).page, 1);
	assert.equal(paginate(500, 2.5).page, 1);
	assert.equal(paginate(500, undefined).page, 1);
});

test('renderSearch emits the exact three-line header and no trailing newline', () => {
	assert.equal(
		renderSearch({ count: 2, page: 1, totalPages: 1, results: ['D:/a', 'C:/b'] }),
		'count: 2\npage: 1 / 1\nresults:\nD:/a\nC:/b',
	);
	assert.equal(renderSearch({ count: 0, page: 1, totalPages: 1, results: [] }), 'count: 0\npage: 1 / 1\nresults:');
});

test('esErrorText localizes both the IPC failure and the generic failure', () => {
	assert.equal(
		esErrorText(8, 'Error 8: Everything IPC window not found, is Everything running?', 'zh'),
		'Everything 索引未运行：请先启动 Everything 再重试（es.exe 退出码 8）。',
	);
	assert.equal(
		esErrorText(8, 'Everything is not running', 'en'),
		'Everything is not running. Start Everything, then search again (es.exe exit 8).',
	);
	assert.equal(
		esErrorText(4, 'Error 4: Expected switch parameter.', 'zh'),
		'es.exe 执行失败（退出码 4）：Error 4: Expected switch parameter.',
	);
	assert.equal(
		esErrorText(4, 'Error 4: Expected switch parameter.', 'en'),
		'es.exe failed (exit 4): Error 4: Expected switch parameter.',
	);
	// No dangling colon, and a signalled exit reports the signal.
	assert.equal(esErrorText(4, '', 'en'), 'es.exe failed (exit 4)');
	assert.equal(esErrorText(4, '', 'zh'), 'es.exe 执行失败（退出码 4）');
	assert.equal(esErrorText(null, '', 'en'), 'es.exe failed (exit signal)');
});

test('languageFromLocale and dupeMessage pick the session language', () => {
	assert.equal(languageFromLocale('zh-CN'), 'zh');
	assert.equal(languageFromLocale('zh'), 'zh');
	assert.equal(languageFromLocale('en-US'), 'en');
	assert.equal(languageFromLocale(undefined), 'en');
	assert.match(dupeMessage('dupe:', 'zh'), /本工具不支持 dupe 相关功能（dupe:/);
	assert.match(dupeMessage('dupe-from:', 'en'), /does not support the dupe-from: operator/);
});

test('live: es.exe answers through the count and search argv', (t) => {
	const scratch = join(dirname(fileURLToPath(import.meta.url)), '.es-smoke.txt');
	const exe = process.env.DSH_ES_EXE ?? 'es.exe';
	mkdirSync(dirname(scratch), { recursive: true });

	// File-descriptor stdio, not pipes: this works under the harness' own
	// Windows sandbox, where spawned pipes are denied. es.exe writes UTF-8, so
	// reading the file back as utf8 preserves non-ASCII file names.
	const run = (argv) => {
		const fd = openSync(scratch, 'w');
		const result = spawnSync(exe, argv, { stdio: ['ignore', fd, fd], windowsHide: true });
		closeSync(fd);
		return { result, output: readFileSync(scratch, 'utf8') };
	};

	try {
		const counted = run(buildCountArgv('*', { sort: null, type: 'all' }));
		if (counted.result.error?.code === 'ENOENT') return t.skip('es.exe not on PATH');
		if (counted.result.status === 8) return t.skip('Everything is not running (es.exe error 8)');
		assert.equal(counted.result.status, 0, counted.output);
		const count = parseCount(counted.output);
		assert.ok(Number.isInteger(count) && count >= 0, `bad count: ${count}`);

		const searched = run(buildSearchArgv('*', { sort: null, type: 'all', offset: 0, limit: 5 }));
		if (searched.result.status === 8) return t.skip('Everything is not running (es.exe error 8)');
		assert.equal(searched.result.status, 0, searched.output);
		const results = parseResults(searched.output);
		assert.ok(results.length > 0, 'the Everything index returned nothing at all');
		assert.ok(results.length <= 5, `-n 5 over-delivered: ${results.length}`);
		for (const path of results) {
			assert.ok(!path.includes('\\'), `backslash reached the tool boundary: ${path}`);
			assert.ok(/^([A-Za-z]:\/|\/\/)/.test(path), `not an absolute POSIX path: ${path}`);
		}
	} finally {
		rmSync(scratch, { force: true });
	}
});
