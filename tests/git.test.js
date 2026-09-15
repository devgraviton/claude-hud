'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { createGitReader, parseStatus, runGitStatus } = require('../lib/git');
const { tempDir } = require('./support/run');

function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const hasGit = gitAvailable();

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
  );
}

function initRepo() {
  const repo = tempDir('claude-hud-repo-');
  git(repo, '-c', 'init.defaultBranch=main', 'init', '-q');
  git(repo, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'init');
  return repo;
}

test('parseStatus reads branch, dirty state and ahead/behind', () => {
  assert.deepEqual(
    parseStatus('# branch.oid abc1234def\n# branch.head main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.txt\n'),
    { branch: 'main', dirty: true, ahead: 2, behind: 1 }
  );
  assert.deepEqual(parseStatus('# branch.oid abc1234def\n# branch.head feature/x\n'), {
    branch: 'feature/x',
    dirty: false,
    ahead: 0,
    behind: 0,
  });
  assert.equal(parseStatus('# branch.oid 0123456789abcdef\n# branch.head (detached)\n').branch, '0123456…');
  assert.equal(parseStatus('# branch.oid (initial)\n# branch.head (detached)\n').branch, 'HEAD');
  assert.equal(parseStatus('? untracked.txt\n'), null); // no branch header
  assert.equal(parseStatus(''), null);
});

test('the reader caches results briefly and re-runs after the TTL', () => {
  const memory = new Map();
  const store = { read: (k) => memory.get(k) ?? null, write: (k, v) => memory.set(k, v) };
  let calls = 0;
  const run = () => {
    calls += 1;
    return '# branch.oid abcdef0\n# branch.head main\n';
  };
  const at = (now) => createGitReader({ store, now, env: {}, run });
  assert.equal(at(10_000)('/repo').branch, 'main');
  assert.equal(at(11_000)('/repo').branch, 'main');
  assert.equal(calls, 1);
  at(13_000)('/repo');
  assert.equal(calls, 2);
  assert.equal(at(13_000)(''), null);
});

test('the reader ignores a tampered cache entry', () => {
  const store = {
    read: () => ({ dir: '/repo', at: 1000, status: { branch: 'x', dirty: 'yes' } }),
    write: () => true,
  };
  const reader = createGitReader({ store, now: 1500, env: {}, run: () => '# branch.head real\n' });
  assert.equal(reader('/repo').branch, 'real');
});

test('reports branch and dirty state for a real repository', { skip: !hasGit }, () => {
  const repo = initRepo();
  assert.deepEqual(parseStatus(runGitStatus(repo, process.env)), {
    branch: 'main',
    dirty: false,
    ahead: 0,
    behind: 0,
  });
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x');
  assert.equal(parseStatus(runGitStatus(repo, process.env)).dirty, true);
});

test('returns null outside a repository', { skip: !hasGit }, () => {
  const dir = tempDir('claude-hud-norepo-');
  assert.equal(runGitStatus(dir, { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) }), null);
});

test('never runs a repository-configured fsmonitor hook', { skip: !hasGit || process.platform === 'win32' }, (t) => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'x');
  git(repo, 'add', 'tracked.txt');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'add');
  const marker = path.join(tempDir(), 'fsmonitor-ran');
  const hook = path.join(tempDir(), 'hook.sh');
  fs.writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  git(repo, 'config', 'core.fsmonitor', hook);

  // Control: a plain `git status` does run the hook on this git build.
  execFileSync('git', ['status', '--porcelain'], { cwd: repo, stdio: 'ignore' });
  if (!fs.existsSync(marker)) {
    t.skip('this git build does not invoke core.fsmonitor hooks');
    return;
  }
  fs.rmSync(marker);

  assert.notEqual(runGitStatus(repo, process.env), null);
  assert.equal(fs.existsSync(marker), false, 'fsmonitor hook was executed');
});
