'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'bin', 'statusline.js');
const ESC = '\u001b';

/** A fresh temporary directory, removed when the test process exits. */
function tempDir(prefix = 'claude-hud-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sandbox = tempDir();

/**
 * Run the status line as Claude Code would and return stdout. Colour, git and
 * email are off and the width/temp dir are pinned, so output is deterministic
 * and nothing is written outside the sandbox.
 */
function run({ args = [], input = '', env = {} } = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_HUD_COLOR: '0',
      CLAUDE_HUD_DISABLE: 'git',
      CLAUDE_HUD_SHOW_EMAIL: '',
      CLAUDE_HUD_WIDTH: '',
      CLAUDE_CONFIG_DIR: '',
      COLUMNS: '',
      NO_COLOR: '',
      TMPDIR: sandbox,
      TEMP: sandbox,
      TMP: sandbox,
      ...env,
    },
  });
}

const json = (value) => JSON.stringify(value);

module.exports = { ESC, SCRIPT, json, run, sandbox, tempDir };
