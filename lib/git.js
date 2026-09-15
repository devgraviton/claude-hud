'use strict';

// Branch, dirty marker and ahead/behind counts from one `git status` call.
//
// git runs without a shell, with a fixed argument list, and with repository
// hooks that `git status` could otherwise trigger turned off on the command
// line (command-line `-c` outranks repository config):
// - core.fsmonitor=false: a repo-configured fsmonitor hook is an executable;
// - --no-optional-locks: never take the index lock or rewrite the index, so
//   the status line cannot race a git command you are running;
// - --ignore-submodules=all: do not recurse into submodule work trees.
// Results are cached briefly, because Claude Code can re-run the status line
// several times per second.

const { execFileSync } = require('node:child_process');

const CACHE_TTL_MS = 2000;
const TIMEOUT_MS = 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const GIT_ARGS = Object.freeze([
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  'status',
  '--porcelain=v2',
  '--branch',
  '--untracked-files=normal',
  '--ignore-submodules=all',
  '--no-renames',
]);

/** Parse `git status --porcelain=v2 --branch` output. */
function parseStatus(output) {
  let head = null;
  let oid = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  for (const line of String(output).split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice(12).trim());
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line !== '' && !line.startsWith('#')) {
      dirty = true;
    }
  }
  if (!head) return null;
  let branch = head;
  if (head === '(detached)') {
    branch = oid && /^[0-9a-f]{7,}$/.test(oid) ? oid.slice(0, 7) + '…' : 'HEAD';
  }
  return { branch, dirty, ahead, behind };
}

function isStatus(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.branch === 'string' &&
    typeof value.dirty === 'boolean' &&
    Number.isInteger(value.ahead) &&
    Number.isInteger(value.behind)
  );
}

/** Run git status in `cwd`; returns raw porcelain output, or null when unavailable. */
function runGitStatus(cwd, env) {
  const options = {
    cwd,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: TIMEOUT_MS,
    windowsHide: true,
  };
  try {
    return execFileSync('git', GIT_ARGS, options);
  } catch (err) {
    // A huge change list overflows the buffer, but the branch headers come
    // first, so the captured prefix is still usable (and certainly dirty).
    if (err && err.code === 'ENOBUFS' && typeof err.stdout === 'string') return err.stdout;
    return null; // not a repository, git missing, or timed out
  }
}

function createGitReader({ store, now, env, run = runGitStatus }) {
  return function readGit(dir) {
    if (typeof dir !== 'string' || dir === '') return null;
    const key = 'git\u0000' + dir;
    const cached = store.read(key);
    if (
      cached &&
      cached.dir === dir &&
      typeof cached.at === 'number' &&
      now - cached.at >= 0 &&
      now - cached.at < CACHE_TTL_MS &&
      (cached.status === null || isStatus(cached.status))
    ) {
      return cached.status;
    }
    const output = run(dir, env);
    const status = output === null ? null : parseStatus(output);
    store.write(key, { dir, at: now, status });
    return status;
  };
}

module.exports = { CACHE_TTL_MS, GIT_ARGS, createGitReader, parseStatus, runGitStatus };
