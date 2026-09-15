'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_AGE_MS, createStore } = require('../lib/state');
const { tempDir } = require('./support/run');

const posix = process.platform !== 'win32';

test('round-trips values under hashed file names', () => {
  const base = tempDir();
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  assert.equal(store.read('../../etc/passwd'), null);
  assert.equal(store.write('../../etc/passwd', { ok: true }), true);
  assert.deepEqual(store.read('../../etc/passwd'), { ok: true });

  const names = fs.readdirSync(store.dir());
  assert.equal(names.length, 1);
  assert.match(names[0], /^hud-[0-9a-f]{40}\.json$/);
});

test('creates a private directory and private files', { skip: !posix }, () => {
  const base = tempDir();
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  store.write('k', { v: 1 });
  const dir = store.dir();
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const [name] = fs.readdirSync(dir);
  assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600);
});

test('refuses a pre-planted symlink in place of its directory', { skip: !posix }, () => {
  const base = tempDir();
  const target = tempDir();
  fs.symlinkSync(target, path.join(base, `claude-hud-${process.getuid()}`));
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  assert.equal(store.dir(), null);
  assert.equal(store.write('k', { v: 1 }), false);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('refuses a directory other users can write to', { skip: !posix }, () => {
  const base = tempDir();
  const dir = path.join(base, `claude-hud-${process.getuid()}`);
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o777);
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  assert.equal(store.dir(), null);
});

test('does not follow a symlinked entry when reading', { skip: !posix }, () => {
  const base = tempDir();
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  store.write('k', { v: 1 });
  const dir = store.dir();
  const [name] = fs.readdirSync(dir);
  const outside = path.join(tempDir(), 'secret.json');
  fs.writeFileSync(outside, '{"stolen":true}');
  fs.rmSync(path.join(dir, name));
  fs.symlinkSync(outside, path.join(dir, name));
  assert.equal(store.read('k'), null);
});

test('ignores oversized and malformed entries', () => {
  const base = tempDir();
  const store = createStore({ baseDir: base, now: Date.now(), random: () => 1 });
  store.write('big', { v: 'big' });
  store.write('bad', { v: 'bad' });
  const dir = store.dir();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const oversized = fs.readFileSync(file, 'utf8').includes('big');
    fs.writeFileSync(file, oversized ? `{"v":"${'x'.repeat(70 * 1024)}"}` : '{not json');
  }
  assert.equal(store.read('big'), null);
  assert.equal(store.read('bad'), null);
});

test('prunes stale entries only', () => {
  const base = tempDir();
  const now = Date.now();
  const writer = createStore({ baseDir: base, now, random: () => 1 });
  writer.write('old', { v: 1 });
  writer.write('fresh', { v: 2 });
  const dir = writer.dir();
  const stale = (now - MAX_AGE_MS - 60_000) / 1000;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.readFileSync(file, 'utf8') === '{"v":1}') fs.utimesSync(file, stale, stale);
  }
  const pruner = createStore({ baseDir: base, now, random: () => 0 });
  pruner.dir();
  assert.equal(pruner.read('old'), null);
  assert.deepEqual(pruner.read('fresh'), { v: 2 });
});

test('is disabled without a base directory', () => {
  const store = createStore({ baseDir: null, now: Date.now() });
  assert.equal(store.write('k', {}), false);
  assert.equal(store.read('k'), null);
});
