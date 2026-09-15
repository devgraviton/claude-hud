'use strict';

const os = require('node:os');
const { createPainter } = require('./ansi');
const { SEGMENT_KEYS, loadConfig } = require('./config');
const { demoData } = require('./demo');
const { createDurationTracker } = require('./duration');
const { readAccountEmail } = require('./email');
const { createGitReader } = require('./git');
const { render } = require('./render');
const { createStore } = require('./state');
const { version } = require('../package.json');

// Claude Code's payload is a few kilobytes; anything far larger is not a
// statusline payload and is ignored rather than buffered.
const MAX_INPUT_BYTES = 1024 * 1024;
// Claude Code cancels an in-flight run when a newer update arrives; this is a
// backstop for a stdin that never closes.
const STDIN_TIMEOUT_MS = 5000;

const HELP = `claude-hud ${version} — a heads-up display status line for Claude Code

Usage:
  statusline.js            read the statusline JSON payload on stdin and print the HUD
  statusline.js --demo     print the HUD for built-in sample data
  statusline.js --version  print the version
  statusline.js --help     print this help

Environment:
  CLAUDE_HUD_WIDTH=160       wrap width in columns (default: $COLUMNS, then 80)
  CLAUDE_HUD_DISABLE=a,b     hide segments: ${SEGMENT_KEYS.join(', ')}
  CLAUDE_HUD_SHOW_EMAIL=1    show the signed-in account email
  CLAUDE_HUD_COLOR=0         disable colour and hyperlinks (NO_COLOR=1 also works)
  CLAUDE_HUD_DEBUG=1         write render errors to stderr
`;

function parsePayload(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function readStdin(stdin, done) {
  if (stdin.isTTY) {
    done('');
    return;
  }
  const chunks = [];
  let size = 0;
  let finished = false;
  const finish = (raw) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done(raw);
  };
  const timer = setTimeout(() => {
    stdin.destroy();
    finish('');
  }, STDIN_TIMEOUT_MS);
  stdin.on('data', (chunk) => {
    if (finished) return;
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      stdin.destroy();
      finish('');
      return;
    }
    chunks.push(chunk);
  });
  stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
  stdin.on('error', () => finish(''));
}

function createContext(env, now) {
  const config = loadConfig(env);
  const store = createStore({ baseDir: os.tmpdir(), now });
  return {
    config,
    ...createPainter(config.color),
    now,
    cwd: process.cwd(),
    git: createGitReader({ store, now, env }),
    liveDuration: createDurationTracker({ store, now }),
    email: () => readAccountEmail({ env, homedir: os.homedir() }),
  };
}

function emit(data, { env, stdout, stderr }) {
  let output;
  try {
    output = render(data, createContext(env, Date.now()));
  } catch (err) {
    if (loadConfig(env).debug) stderr.write(String((err && err.stack) || err) + '\n');
    output = 'claude-hud: render error (set CLAUDE_HUD_DEBUG=1 for details)';
  }
  stdout.write(output);
}

function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const io = { env, stdout, stderr };
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(HELP);
  } else if (argv.includes('--version') || argv.includes('-v')) {
    stdout.write(version + '\n');
  } else if (argv.includes('--demo')) {
    emit(demoData(Date.now(), process.cwd()), io);
  } else {
    readStdin(stdin, (raw) => emit(parsePayload(raw), io));
  }
}

module.exports = { MAX_INPUT_BYTES, main, parsePayload };
