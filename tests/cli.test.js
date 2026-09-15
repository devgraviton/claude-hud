'use strict';

// Black-box tests: run bin/statusline.js the way Claude Code does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_INPUT_BYTES } = require('../lib/cli');
const { version } = require('../package.json');
const { ESC, json, run, sandbox, tempDir } = require('./support/run');

const COLOR = { CLAUDE_HUD_COLOR: '1', NO_COLOR: '' };
const epoch = () => Math.floor(Date.now() / 1000);

// ---- invocation -------------------------------------------------------------

test('--demo renders a non-empty two-row status line', () => {
  const out = run({ args: ['--demo'], env: { CLAUDE_HUD_WIDTH: '400' } });
  assert.match(out, /Opus 5 \(1M\)/);
  assert.match(out, /«Add reset countdowns/);
  assert.match(out, /devgraviton\/claude-hud PR#1234↗/);
  assert.match(out, /\d+h\d+m|\d+d\d+h/);
  assert.equal(out.split('\n').length, 2);
});

test('--version and --help', () => {
  assert.equal(run({ args: ['--version'] }).trim(), version);
  const help = run({ args: ['--help'] });
  assert.match(help, /CLAUDE_HUD_DISABLE/);
  assert.match(help, /worktree/);
});

test('empty, invalid, non-object and oversized input fall back safely', () => {
  assert.match(run({ input: '' }), /Claude/);
  assert.match(run({ input: '{}' }), /Claude/);
  assert.match(run({ input: 'this is not json' }), /Claude/);
  assert.match(run({ input: '[1,2,3]' }), /Claude/);
  const huge = json({ session_name: 'z'.repeat(MAX_INPUT_BYTES + 10) });
  const out = run({ input: huge });
  assert.match(out, /Claude/);
  assert.doesNotMatch(out, /zzzz/);
});

test('fields with the wrong type are ignored instead of crashing', () => {
  const out = run({
    input: json({
      model: 'Opus',
      effort: { level: { nested: true } },
      rate_limits: { five_hour: 'full', seven_day: { used_percentage: 'lots' } },
      context_window: { used_percentage: null, current_usage: null },
      cost: { total_cost_usd: 'free', total_lines_added: -5 },
      workspace: { repo: ['a', 'b'] },
      pr: { number: '12; rm -rf /', review_state: 'constructor' },
      session_name: { toString: 'x' },
    }),
  });
  assert.match(out, /Claude/);
  assert.match(out, /ctx 0%/);
  assert.match(out, /\$0\.00/);
  assert.doesNotMatch(out, /PR#/);
});

// ---- stats row --------------------------------------------------------------

test('model name, effort and indicators', () => {
  const out = run({
    input: json({
      model: { display_name: 'Opus 4.7 (1M context)' },
      effort: { level: 'xhigh' },
      exceeds_200k_tokens: true,
      fast_mode: true,
      thinking: { enabled: true },
      output_style: { name: 'explanatory' },
    }),
  });
  assert.ok(out.includes('Opus 4.7 (1M) xhigh ⚠⚡● explanatory'), out);

  const bare = run({ input: json({ model: { display_name: 'Opus' }, output_style: { name: 'default' } }) });
  assert.doesNotMatch(bare, /⚠|⚡|●|default/);
});

test('usage windows: session, weekly and spend limit with countdowns', () => {
  const out = run({
    input: json({
      rate_limits: {
        // +30 s margins absorb process start-up time so the countdown is stable
        five_hour: { used_percentage: 45, resets_at: epoch() + 3 * 3600 + 30 },
        seven_day: { used_percentage: 60, resets_at: epoch() - 100 },
        spend_limit: { used_percentage: 120, resets_at: epoch() + 2 * 86400 + 3600 + 30 },
      },
    }),
    env: { CLAUDE_HUD_WIDTH: '400' },
  });
  assert.match(out, /session▕.+▏45% 3h/);
  assert.match(out, /weekly▕.+▏60%(?! \d)/);
  assert.match(out, /spend▕████████▏120% 2d1h/);
});

test('the fable window renders only when a per-model window is present', () => {
  const scoped = run({
    input: json({
      rate_limits: {
        seven_day: { used_percentage: 60 },
        model_scoped: [{ display_name: 'Fable', utilization: 0.3, resets_at: '2099-01-01T00:00:00Z' }],
      },
    }),
  });
  assert.match(scoped, /fable▕.+▏30%/);
  assert.ok(scoped.indexOf('weekly') < scoped.indexOf('fable'));

  const flat = run({ input: json({ rate_limits: { seven_day_overage_included: { used_percentage: 12 } } }) });
  assert.match(flat, /fable▕.+▏12%/);

  const none = run({ input: json({ rate_limits: { five_hour: { used_percentage: 20 } } }) });
  assert.doesNotMatch(none, /fable/);
});

test('context percentage, with the input-only fallback formula', () => {
  assert.match(run({ input: json({ context_window: { used_percentage: 37 } }) }), /ctx 37%/);
  const fallback = run({
    input: json({
      context_window: {
        used_percentage: null,
        context_window_size: 1000,
        current_usage: { input_tokens: 100, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 500 },
      },
    }),
  });
  assert.match(fallback, /ctx 25%/);
});

test('cost, lines changed and the live session timer', () => {
  const payload = json({
    session_id: 'timer-session',
    cost: { total_cost_usd: 12.5, total_duration_ms: 61_000, total_lines_added: 7, total_lines_removed: 2 },
  });
  const out = run({ input: payload });
  assert.ok(out.includes('$12.50 1m01s +7-2'), out);
});

test('tokens prefer prompt_cache statistics and flag a cold cache', () => {
  const usage = { input_tokens: 0, output_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 };
  assert.match(run({ input: json({ context_window: { current_usage: usage } }) }), /out 1\.2k cache 100%/);
  assert.match(
    run({ input: json({ context_window: { current_usage: usage }, prompt_cache: { hit_ratio: 0.42, warm: true } }) }),
    /cache 42%(?! cold)/
  );
  assert.match(
    run({ input: json({ prompt_cache: { hit_ratio: 0.9, warm: false, caching_observed: true } }) }),
    /cache 90% cold/
  );
});

// ---- context row ------------------------------------------------------------

test('session title, worktree and agent', () => {
  const out = run({
    input: json({
      session_name: 'Fix the login bug',
      worktree: { name: 'feat-x', path: '/w/feat-x' },
      agent: { name: 'reviewer' },
    }),
    env: { CLAUDE_HUD_WIDTH: '400' },
  });
  assert.match(out, /wt feat-x \| «Fix the login bug» \| @reviewer/);

  const gitWorktree = run({ input: json({ workspace: { git_worktree: 'hotfix' } }) });
  assert.match(gitWorktree, /wt hotfix/);

  const hidden = run({
    input: json({ session_name: 'Fix', worktree: { name: 'feat-x' }, agent: { name: 'r' } }),
    env: { CLAUDE_HUD_DISABLE: 'git,title,worktree,agent' },
  });
  assert.doesNotMatch(hidden, /«|wt |@r/);
});

test('a long session title is truncated to 28 columns', () => {
  const out = run({ input: json({ session_name: 'Handle blocked output with a fallback approach everywhere' }) });
  assert.match(out, /«.{1,28}…»/);
  assert.doesNotMatch(out, /everywhere/);
});

test('repo and pull request, with GitLab merge requests', () => {
  const out = run({
    input: json({ workspace: { repo: { host: 'github.com', owner: 'example-org', name: 'web.app' } }, pr: { number: 7 } }),
  });
  assert.match(out, /example-org\/web\.app PR#7↗/);
  assert.match(run({ input: json({ pr: { number: 42, kind: 'mr' } }) }), /MR!42↗/);

  const hidden = run({
    input: json({ workspace: { repo: { owner: 'a', name: 'b' } }, pr: { number: 7 } }),
    env: { CLAUDE_HUD_DISABLE: 'git,repo' },
  });
  assert.doesNotMatch(hidden, /a\/b|PR#7/);
});

test('project name comes from the last path component, including Windows paths', () => {
  assert.match(run({ input: json({ workspace: { current_dir: '/home/u/proj-a/' } }) }), /proj-a/);
  assert.match(run({ input: json({ cwd: 'C:\\Users\\u\\proj-b' }) }), /proj-b/);
});

// ---- security ---------------------------------------------------------------

test('escape sequences in payload strings never reach the terminal', () => {
  const out = run({
    input: json({
      model: { display_name: 'Opus\u001b[2J' },
      session_name: 'evil\u001b]0;pwned\u0007name\u202E',
      output_style: { name: 'x\u001b]8;;https://evil.test\u001b\\y' },
      workspace: { repo: { owner: 'o\u009b31m', name: 'r\r\nFAKE' } },
      agent: { name: '\u0007bell' },
    }),
    env: { ...COLOR, CLAUDE_HUD_WIDTH: '400' },
  });
  const stripped = out.replace(/\u001b\[[0-9;]*m/g, ''); // our own colour codes
  assert.ok(!stripped.includes(ESC), JSON.stringify(stripped));
  assert.ok(!out.includes('\u0007') && !out.includes('\u009b') && !out.includes('\u202E'));
  assert.ok(!out.includes('\r'));
  assert.match(stripped, /«evil \]0;pwned name»/);
  assert.equal(out.split('\n').length, 2);
});

test('pull request hyperlinks are emitted only for safe http(s) URLs', () => {
  const link = (url) =>
    run({ input: json({ pr: { number: 1, url, review_state: 'approved' } }), env: COLOR });

  const safe = link('https://github.com/x/y/pull/1');
  assert.ok(safe.includes('\u001b]8;;https://github.com/x/y/pull/1\u001b\\'));

  for (const url of ['javascript:alert(1)', 'https://a.test/\u001b\\\u001b]8;;x', 'file:///etc/passwd']) {
    const out = link(url);
    assert.match(out, /PR#1↗/);
    assert.ok(!out.includes('\u001b]8;'), url);
  }
});

test('the timer state is stored privately inside the temp directory', { skip: process.platform === 'win32' }, () => {
  run({ input: json({ session_id: '../../escape', cost: { total_duration_ms: 1000 } }) });
  const dir = path.join(sandbox, `claude-hud-${process.getuid()}`);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(dir)) {
    assert.match(name, /^hud-[0-9a-f]{40}\.json$/);
    assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600);
  }
});

// ---- email ------------------------------------------------------------------

test('the account email is opt-in and read from the Claude config', () => {
  const home = tempDir('claude-hud-home-');
  fs.writeFileSync(path.join(home, '.claude.json'), json({ oauthAccount: { emailAddress: 'dev@example.com' } }));
  const env = { HOME: home, USERPROFILE: home };
  assert.doesNotMatch(run({ input: '{}', env }), /dev@example\.com/);
  assert.match(run({ input: '{}', env: { ...env, CLAUDE_HUD_SHOW_EMAIL: '1' } }), /dev@example\.com/);

  const configDir = tempDir('claude-hud-config-');
  fs.writeFileSync(path.join(configDir, '.claude.json'), json({ oauthAccount: { emailAddress: 'alt@example.com' } }));
  assert.match(
    run({ input: '{}', env: { ...env, CLAUDE_HUD_SHOW_EMAIL: '1', CLAUDE_CONFIG_DIR: configDir } }),
    /alt@example\.com/
  );
});

test('a missing or malformed Claude config does not crash the email segment', () => {
  const home = tempDir('claude-hud-nohome-');
  const env = { HOME: home, USERPROFILE: home, CLAUDE_HUD_SHOW_EMAIL: '1' };
  assert.match(run({ args: ['--demo'], env }), /Opus/);
  fs.writeFileSync(path.join(home, '.claude.json'), '{"oauthAccount":{"emailAddress":"not an email\\u001b"}}');
  const out = run({ input: '{}', env });
  assert.ok(!out.includes('not an email'));
});

// ---- colour and layout ------------------------------------------------------

test('colour switches', () => {
  assert.ok(!run({ args: ['--demo'] }).includes(ESC));
  assert.ok(run({ args: ['--demo'], env: COLOR }).includes(ESC));
  assert.ok(!run({ args: ['--demo'], env: { CLAUDE_HUD_COLOR: '1', NO_COLOR: '1' } }).includes(ESC));
});

test('rows never exceed CLAUDE_HUD_WIDTH or COLUMNS', () => {
  for (const env of [{ CLAUDE_HUD_WIDTH: '60' }, { COLUMNS: '60' }, { CLAUDE_HUD_WIDTH: '24' }]) {
    const width = Number(env.CLAUDE_HUD_WIDTH || env.COLUMNS);
    for (const row of run({ args: ['--demo'], env }).split('\n')) {
      assert.ok(row.length <= width, `row of ${row.length} cols exceeds ${width}: ${row}`);
    }
  }
});

test('hyperlink escapes do not count toward the row width', () => {
  // Size the width to the context row's visible length. If the OSC 8 bytes
  // around the PR link were measured, the coloured row would wrap where the
  // plain row does not.
  const contextRow = run({ args: ['--demo'], env: { CLAUDE_HUD_WIDTH: '400' } }).split('\n')[1];
  const env = { CLAUDE_HUD_WIDTH: String(contextRow.length) };
  const plain = run({ args: ['--demo'], env });
  const colored = run({ args: ['--demo'], env: { ...COLOR, ...env } });
  assert.ok(colored.includes(ESC + ']8;;https://github.com/'), 'demo should emit an OSC 8 link');
  assert.ok(plain.split('\n').includes(contextRow), 'context row should fit exactly');
  assert.equal(colored.split('\n').length, plain.split('\n').length);
});

test('the context row is omitted when it has no segments', () => {
  const out = run({
    input: json({ model: { display_name: 'Opus' } }),
    env: { CLAUDE_HUD_DISABLE: 'git,project', CLAUDE_HUD_WIDTH: '400' },
  });
  assert.equal(out, 'Opus');
});
