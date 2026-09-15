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
      CLAUDE_HUD_SHOW_EMAIL: '', // neutralize ambient value for determinism
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

test('mode indicators appear only when their flags are set', () => {
  const out = run({
    input: json({
      model: { display_name: 'Opus' },
      exceeds_200k_tokens: true,
      fast_mode: true,
      thinking: { enabled: true },
      output_style: { name: 'explanatory' },
    }),
  });
  assert.match(out, /⚠/);
  assert.match(out, /⚡/);
  assert.match(out, /●/);
  assert.match(out, /explanatory/);
});

test('no indicators for a bare model payload', () => {
  const out = run({
    input: json({
      model: { display_name: 'Opus' },
      output_style: { name: 'default' },
    }),
  });
  assert.doesNotMatch(out, /⚠|⚡|●/);
  assert.doesNotMatch(out, /default/);
});

test('session title renders, wrapped in guillemets', () => {
  const out = run({ input: json({ session_name: 'Fix the login bug' }) });
  assert.match(out, /«Fix the login bug»/);
});

test('a long session title is truncated to 28 chars with an ellipsis', () => {
  const long = 'Handle blocked output with a fallback approach everywhere';
  const out = run({ input: json({ session_name: long }) });
  assert.match(out, /«.{1,28}…»/);
  assert.doesNotMatch(out, /everywhere/);
});

test('CLAUDE_HUD_DISABLE=title hides the session title', () => {
  const input = json({ session_name: 'Fix the login bug' });
  assert.match(run({ input }), /«Fix the login bug»/);
  assert.doesNotMatch(
    run({ input, env: { CLAUDE_HUD_DISABLE: 'git,title' } }),
    /«/
  );
});

test('repo segment shows owner/name from the payload', () => {
  const out = run({
    input: json({
      workspace: { repo: { owner: 'devgraviton', name: 'graviton.dev' } },
    }),
  });
  assert.match(out, /devgraviton\/graviton\.dev/);
});

test('PR renders with number, arrow, and an OSC 8 link when color is on', () => {
  const out = run({
    input: json({
      pr: {
        number: 1234,
        url: 'https://github.com/x/y/pull/1234',
        review_state: 'approved',
      },
    }),
    env: { CLAUDE_HUD_COLOR: '1', NO_COLOR: '' },
  });
  assert.match(out, /PR#1234↗/);
  assert.ok(out.includes('\x1b]8;;https://github.com/x/y/pull/1234'));
});

test('CLAUDE_HUD_DISABLE=repo hides repo and PR', () => {
  const input = json({
    workspace: { repo: { owner: 'a', name: 'b' } },
    pr: { number: 7 },
  });
  assert.match(run({ input }), /a\/b/);
  assert.doesNotMatch(
    run({ input, env: { CLAUDE_HUD_DISABLE: 'git,repo' } }),
    /a\/b|PR#7/
  );
});

test('--demo showcases the new segments', () => {
  const out = run({ args: ['--demo'] }); // color off by default in run()
  assert.match(out, /«/); // session title
  assert.match(out, /devgraviton\/claude-hud/); // repo
  assert.match(out, /PR#/); // PR
  assert.match(out, /fable/); // per-model (Fable) usage window
  assert.match(out, /\d+h\d+m|\d+d\d+h/); // a reset countdown
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

test('fable window renders after weekly from a model_scoped entry', () => {
  const out = run({
    input: json({
      rate_limits: {
        five_hour: { used_percentage: 20 },
        seven_day: { used_percentage: 60 },
        model_scoped: [
          {
            display_name: 'Fable',
            utilization: 0.3, // 0-1 fraction → 30%
            resets_at: '2099-01-01T00:00:00Z',
          },
        ],
      },
    }),
  });
  assert.match(out, /session/);
  assert.match(out, /weekly/);
  assert.match(out, /fable/);
  assert.match(out, /30%/);
  // ordering: fable comes after weekly
  assert.ok(out.indexOf('weekly') < out.indexOf('fable'));
});

test('fable window renders from the flat seven_day_overage_included field', () => {
  const out = run({
    input: json({
      rate_limits: {
        seven_day: { used_percentage: 60 },
        seven_day_overage_included: { used_percentage: 12 },
      },
    }),
  });
  assert.match(out, /fable/);
  assert.match(out, /12%/);
});

test('no fable segment when the payload carries no per-model window', () => {
  const out = run({
    input: json({
      rate_limits: {
        five_hour: { used_percentage: 20 },
        seven_day: { used_percentage: 60 },
      },
    }),
  });
  assert.match(out, /weekly/);
  assert.doesNotMatch(out, /fable/);
});

test('a window shows a reset countdown when resets_at is in the future', () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600 + 30; // ~3h
  const out = run({
    input: json({
      rate_limits: { five_hour: { used_percentage: 45, resets_at: resetsAt } },
    }),
  });
  assert.match(out, /45%\s+3h/);
});

test('a window shows no countdown when resets_at is in the past', () => {
  const resetsAt = Math.floor(Date.now() / 1000) - 100;
  const out = run({
    input: json({
      rate_limits: { five_hour: { used_percentage: 45, resets_at: resetsAt } },
    }),
  });
  assert.match(out, /45%/);
  assert.doesNotMatch(out, /45%\s+\d+[dhm]/);
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

test('a wide CLAUDE_HUD_WIDTH yields two rows (stats + context)', () => {
  const out = run({ args: ['--demo'], env: { CLAUDE_HUD_WIDTH: '400' } });
  assert.equal(out.split('\n').length, 2);
});

test('visibleWidth ignores OSC 8 hyperlink escapes (via wrapping)', () => {
  // A hyperlinked segment must measure by visible text only, so a wide width
  // keeps it on its row rather than wrapping on the invisible escape bytes.
  const out = run({
    args: ['--demo'],
    env: { CLAUDE_HUD_COLOR: '1', NO_COLOR: '', CLAUDE_HUD_WIDTH: '400' },
  });
  assert.equal(out.split('\n').length, 2);
});

test('row 2 is omitted entirely when it has no segments', () => {
  const out = run({
    input: json({ model: { display_name: 'Opus' } }),
    env: { CLAUDE_HUD_DISABLE: 'git,project', CLAUDE_HUD_WIDTH: '400' },
  });
  assert.equal(out.split('\n').length, 1);
  assert.match(out, /Opus/);
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
