'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPainter } = require('../lib/ansi');
const { flag, loadConfig } = require('../lib/config');
const fmt = require('../lib/format');
const { wrapRows } = require('../lib/layout');
const { cleanText, safeUrl } = require('../lib/sanitize');
const { fableWindow, windowPercent } = require('../lib/usage');
const { stringWidth, stripAnsi, truncateWidth } = require('../lib/width');
const { createDurationTracker } = require('../lib/duration');
const { parsePayload } = require('../lib/cli');

test('finite rejects non-numeric values', () => {
  assert.equal(fmt.finite(3), 3);
  assert.equal(fmt.finite('4.5'), 4.5);
  for (const bad of [null, undefined, '', true, false, 'x', NaN, Infinity, {}]) {
    assert.equal(fmt.finite(bad), null, String(bad));
  }
});

test('fmtNum compacts counts', () => {
  assert.equal(fmt.fmtNum(950), '950');
  assert.equal(fmt.fmtNum(1200), '1.2k');
  assert.equal(fmt.fmtNum(1000), '1k');
  assert.equal(fmt.fmtNum(999_999), '1M');
  assert.equal(fmt.fmtNum(3_400_000), '3.4M');
  assert.equal(fmt.fmtNum(-5), '0');
  assert.equal(fmt.fmtNum('junk'), '0');
});

test('fmtDuration and fmtCost', () => {
  assert.equal(fmt.fmtDuration(42_000), '42s');
  assert.equal(fmt.fmtDuration(187_000), '3m07s');
  assert.equal(fmt.fmtDuration(26_738_000), '7h25m38s');
  assert.equal(fmt.fmtDuration(-1), '0s');
  assert.equal(fmt.fmtCost(12.5), '$12.50');
  assert.equal(fmt.fmtCost(0.004), '<$0.01');
  assert.equal(fmt.fmtCost(0), '$0.00');
  assert.equal(fmt.fmtCost(-3), '$0.00');
});

test('fmtCountdown uses the supplied clock', () => {
  const now = 1_700_000_000_000;
  const at = (seconds) => now / 1000 + seconds;
  assert.equal(fmt.fmtCountdown(at(4 * 86400 + 14 * 3600), now), '4d14h');
  assert.equal(fmt.fmtCountdown(at(3 * 3600 + 30), now), '3h');
  assert.equal(fmt.fmtCountdown(at(12 * 60 + 5), now), '12m');
  assert.equal(fmt.fmtCountdown(at(20), now), '<1m');
  assert.equal(fmt.fmtCountdown(at(-1), now), '');
  assert.equal(fmt.fmtCountdown(null, now), '');
});

test('toEpochSeconds accepts epoch numbers and ISO strings', () => {
  assert.equal(fmt.toEpochSeconds(1738425600), 1738425600);
  assert.equal(fmt.toEpochSeconds('1738425600'), 1738425600);
  assert.equal(fmt.toEpochSeconds('2025-02-01T16:00:00Z'), 1738425600);
  assert.equal(fmt.toEpochSeconds('not a date'), null);
  assert.equal(fmt.toEpochSeconds({}), null);
});

test('bar clamps to its width', () => {
  assert.equal(fmt.bar(0, 8), '░░░░░░░░');
  assert.equal(fmt.bar(50, 8), '████░░░░');
  assert.equal(fmt.bar(250, 8), '████████');
  assert.equal(fmt.bar(-10, 8), '░░░░░░░░');
});

test('windowPercent reads used_percentage or a utilization fraction', () => {
  assert.equal(windowPercent({ used_percentage: 41.2 }), 41.2);
  assert.equal(windowPercent({ used_percentage: 120 }), 120);
  assert.equal(windowPercent({ utilization: 0.3 }), 30);
  assert.equal(windowPercent({ utilization: 45 }), 45);
  assert.equal(windowPercent({}), null);
  assert.equal(windowPercent(null), null);
});

test('fableWindow is null for the documented payload shape', () => {
  assert.equal(fableWindow({ five_hour: {}, seven_day: {} }), null);
  assert.deepEqual(fableWindow({ model_scoped: [{ display_name: 'Fable 5', utilization: 0.1 }] }), {
    display_name: 'Fable 5',
    utilization: 0.1,
  });
  assert.equal(fableWindow({ model_scoped: [{ display_name: 42 }] }), null);
});

test('cleanText strips terminal control and bidi characters', () => {
  assert.equal(cleanText('a\u001b]0;pwned\u0007b'), 'a ]0;pwned b');
  assert.equal(cleanText('line1\nline2\r\n'), 'line1 line2');
  assert.equal(cleanText('\u202egnp.exe'), 'gnp.exe');
  assert.equal(cleanText('x\u009by'), 'x y');
  assert.equal(cleanText({ toString: () => '\u001b[31m' }), '');
  assert.equal(cleanText(7), '7');
  assert.equal(cleanText('abcdefghij', 5), 'abcd…');
});

test('safeUrl only allows plain http(s) URLs', () => {
  assert.equal(safeUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  assert.equal(safeUrl('http://gitlab.internal/g/p/-/merge_requests/2'), 'http://gitlab.internal/g/p/-/merge_requests/2');
  for (const bad of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    'https://example.com/\u001b]8;;evil\u001b\\',
    'https://example.com/a b',
    'https://example.com/' + 'a'.repeat(3000),
    'not a url',
    42,
    null,
  ]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
});

test('stringWidth ignores escapes and counts wide characters as two', () => {
  const { paint, link } = createPainter(true);
  assert.equal(stringWidth(paint('1;31', 'abc')), 3);
  assert.equal(stringWidth(link('PR#1', 'https://x.test/1')), 4);
  assert.equal(stringWidth('日本語'), 6);
  assert.equal(stringWidth('e\u0301'), 1);
  assert.equal(stripAnsi(paint('2', 'x')), 'x');
});

test('truncateWidth respects wide characters', () => {
  assert.equal(truncateWidth('short', 10), 'short');
  assert.equal(truncateWidth('日本語テキスト', 7), '日本語…');
  assert.ok(stringWidth(truncateWidth('日本語テキスト', 7)) <= 7);
});

test('wrapRows never exceeds the width and truncates oversized segments', () => {
  const rows = wrapRows(['aaaa', 'bbbb', 'cccc', 'x'.repeat(50)], 12, ' | ');
  assert.deepEqual(rows.slice(0, 2), ['aaaa | bbbb', 'cccc']);
  for (const row of rows) assert.ok(stringWidth(row) <= 12, row);
});

test('loadConfig parses flags, width precedence and disabled keys', () => {
  assert.equal(flag('1'), true);
  assert.equal(flag('true'), true);
  assert.equal(flag('0'), false);
  assert.equal(flag('off'), false);
  assert.equal(flag(undefined), false);

  assert.equal(loadConfig({}).width, 80);
  assert.equal(loadConfig({ COLUMNS: '132' }).width, 132);
  assert.equal(loadConfig({ COLUMNS: '132', CLAUDE_HUD_WIDTH: '90' }).width, 90);
  assert.equal(loadConfig({ CLAUDE_HUD_WIDTH: '5', COLUMNS: 'wide' }).width, 80);

  const config = loadConfig({ CLAUDE_HUD_DISABLE: ' Git , tokens,,', NO_COLOR: '1' });
  assert.deepEqual([...config.disabled], ['git', 'tokens']);
  assert.equal(config.color, false);
  assert.equal(loadConfig({ CLAUDE_HUD_COLOR: '0' }).color, false);
  assert.equal(loadConfig({}).color, true);
});

test('createPainter emits nothing but text when colour is off', () => {
  const { paint, link } = createPainter(false);
  assert.equal(paint('1', 'x'), 'x');
  assert.equal(link('x', 'https://example.com'), 'x');
});

test('parsePayload only accepts JSON objects', () => {
  assert.deepEqual(parsePayload('{"a":1}'), { a: 1 });
  for (const raw of ['', '[1,2]', 'null', '42', '{bad', undefined]) {
    assert.deepEqual(parsePayload(raw), {}, String(raw));
  }
});

test('the duration tracker anchors a snapshot and ticks from it', () => {
  const memory = new Map();
  const store = { read: (k) => memory.get(k) ?? null, write: (k, v) => memory.set(k, v) };
  const payload = { session_id: 's1', cost: { total_duration_ms: 10_000 } };

  assert.equal(createDurationTracker({ store, now: 100_000 })(payload), 10_000);
  assert.equal(createDurationTracker({ store, now: 104_000 })(payload), 14_000);

  const next = { session_id: 's1', cost: { total_duration_ms: 20_000 } };
  assert.equal(createDurationTracker({ store, now: 105_000 })(next), 20_000);

  const track = createDurationTracker({ store, now: 1 });
  assert.equal(track({ cost: { total_duration_ms: 5 } }), 5); // no session id: snapshot only
  assert.equal(track({ cost: {} }), null);
  assert.equal(track({ session_id: 's2', cost: { total_duration_ms: -1 } }), null);
});
