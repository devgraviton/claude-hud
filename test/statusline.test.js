'use strict';

// Black-box tests for bin/statusline.js — run with `node --test` (or `npm test`).
// No dependencies: uses Node's built-in test runner and assert module.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'bin', 'statusline.js');
const ESC = String.fromCharCode(27); // ANSI escape sequences start with this

// Run statusline.js with the given args / stdin / env and return stdout.
// Colour and the (environment-dependent) git segment are off by default so
// assertions can match plain, deterministic text.
function run({ args = [], input = '', env = {} } = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_HUD_COLOR: '0',
      CLAUDE_HUD_DISABLE: 'git',
      ...env,
    },
  });
}

const json = (obj) => JSON.stringify(obj);

test('--demo renders a non-empty status line', () => {
  const out = run({ args: ['--demo'] });
  assert.ok(out.length > 0);
  assert.match(out, /Opus/);
});

test('empty input falls back to a model name without crashing', () => {
  assert.match(run({ input: '{}' }), /Claude/);
});

test('invalid JSON input does not crash', () => {
  assert.match(run({ input: 'this is not json' }), /Claude/);
});

test('context percentage is rendered', () => {
  const out = run({ input: json({ context_window: { used_percentage: 37 } }) });
  assert.match(out, /ctx 37%/);
});

test('cost is formatted as USD', () => {
  const out = run({ input: json({ cost: { total_cost_usd: 12.5 } }) });
  assert.ok(out.includes('$12.50'));
});

test('"(1M context)" in the model name is shortened to "(1M)"', () => {
  const out = run({
    input: json({ model: { display_name: 'Opus 4.7 (1M context)' } }),
  });
  assert.ok(out.includes('Opus 4.7 (1M)'));
  assert.doesNotMatch(out, /context/);
});

test('session and weekly usage windows render from rate_limits', () => {
  const out = run({
    input: json({
      rate_limits: {
        five_hour: { used_percentage: 20 },
        seven_day: { used_percentage: 60 },
      },
    }),
  });
  assert.match(out, /session/);
  assert.match(out, /weekly/);
});

test('CLAUDE_HUD_DISABLE hides a named segment', () => {
  const input = json({ context_window: { used_percentage: 50 } });
  assert.match(run({ input }), /ctx/);
  assert.doesNotMatch(
    run({ input, env: { CLAUDE_HUD_DISABLE: 'git,context' } }),
    /ctx/
  );
});

test('CLAUDE_HUD_COLOR=0 emits no ANSI escape codes', () => {
  assert.ok(!run({ args: ['--demo'] }).includes(ESC));
});

test('ANSI colours are emitted when colour is enabled', () => {
  const out = run({
    args: ['--demo'],
    env: { CLAUDE_HUD_COLOR: '1', NO_COLOR: '' },
  });
  assert.ok(out.includes(ESC));
});

test('output wraps so that no row exceeds CLAUDE_HUD_WIDTH', () => {
  const width = 60;
  const out = run({
    args: ['--demo'],
    env: { CLAUDE_HUD_WIDTH: String(width) },
  });
  for (const row of out.split('\n')) {
    assert.ok(
      row.length <= width,
      'row of ' + row.length + ' cols exceeds width ' + width + ': ' + row
    );
  }
});

test('a wide CLAUDE_HUD_WIDTH keeps everything on a single line', () => {
  const out = run({ args: ['--demo'], env: { CLAUDE_HUD_WIDTH: '400' } });
  assert.equal(out.split('\n').length, 1);
});

test('CLAUDE_HUD_SHOW_EMAIL does not crash when no account file exists', () => {
  const out = run({
    args: ['--demo'],
    env: {
      CLAUDE_HUD_SHOW_EMAIL: '1',
      HOME: path.join(os.tmpdir(), 'claude-hud-test-nohome'),
    },
  });
  assert.ok(out.length > 0);
});
