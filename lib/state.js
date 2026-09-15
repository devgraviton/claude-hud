'use strict';

// Small per-user key/value cache on disk (session timer anchors, git status).
//
// Hardening, because the default base is the shared system temp directory:
// - one private directory per user (0700, owned by the current uid, not a
//   symlink); if an existing path fails those checks the store is disabled
//   rather than used;
// - file names are SHA-256 digests of the key, so payload values such as
//   session ids or paths never reach the file system as names;
// - reads refuse symlinks (O_NOFOLLOW), non-regular files and oversized files;
// - writes go to an exclusive temp file (0600) that is renamed into place;
// - stale entries are pruned occasionally.
// Every failure degrades to "no cache"; the status line still renders.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'hud-';
const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.02;

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function privateDir(baseDir) {
  const uid = currentUid();
  const dir = path.join(baseDir, uid === null ? 'claude-hud' : `claude-hud-${uid}`);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if (!err || err.code !== 'EEXIST') return null;
  }
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory()) return null; // also rejects a planted symlink
    if (uid !== null && (st.uid !== uid || (st.mode & 0o077) !== 0)) return null;
  } catch {
    return null;
  }
  return dir;
}

function prune(dir, now) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (st.isFile() && now - st.mtimeMs > MAX_AGE_MS) fs.unlinkSync(file);
    } catch {
      // another process may have removed it first
    }
  }
}

/**
 * @param {object} options
 * @param {string|null} options.baseDir  parent directory (normally os.tmpdir())
 * @param {number} options.now           current time in ms
 * @param {() => number} [options.random]
 */
function createStore({ baseDir, now, random = Math.random }) {
  let dir; // undefined: not resolved yet; null: unavailable

  function resolveDir() {
    if (dir === undefined) {
      dir = baseDir ? privateDir(baseDir) : null;
      if (dir && random() < PRUNE_PROBABILITY) prune(dir, now);
    }
    return dir;
  }

  function fileFor(key) {
    const d = resolveDir();
    if (!d) return null;
    const digest = crypto.createHash('sha256').update(String(key)).digest('hex');
    return path.join(d, PREFIX + digest.slice(0, 40) + '.json');
  }

  function read(key) {
    const file = fileFor(key);
    if (!file) return null;
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_ENTRY_BYTES) return null;
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      return value !== null && typeof value === 'object' ? value : null;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // already closed
        }
      }
    }
  }

  function write(key, value) {
    const file = fileFor(key);
    if (!file) return false;
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // nothing was created
      }
      return false;
    }
  }

  return { read, write, dir: resolveDir };
}

module.exports = { MAX_AGE_MS, createStore };
