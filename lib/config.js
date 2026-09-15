'use strict';

// Environment-variable configuration, parsed once per invocation.

/** Segment keys accepted by CLAUDE_HUD_DISABLE. The model segment is always shown. */
const SEGMENT_KEYS = Object.freeze([
  'limits',
  'context',
  'cost',
  'tokens',
  'project',
  'worktree',
  'title',
  'agent',
  'git',
  'repo',
]);

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 20;
const MAX_WIDTH = 1000;

/** Truthy switch: anything except unset, "", "0", "false", "off" or "no". */
function flag(value) {
  if (value === undefined || value === null) return false;
  return !['', '0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

function widthFrom(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : null;
}

function loadConfig(env = process.env) {
  const disabled = new Set(
    String(env.CLAUDE_HUD_DISABLE || '')
      .split(',')
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean)
  );
  return Object.freeze({
    disabled,
    // Claude Code captures the script's output, so the TTY width is unknown;
    // it exports COLUMNS instead. An explicit CLAUDE_HUD_WIDTH wins.
    width: widthFrom(env.CLAUDE_HUD_WIDTH) ?? widthFrom(env.COLUMNS) ?? DEFAULT_WIDTH,
    color: !env.NO_COLOR && env.CLAUDE_HUD_COLOR !== '0',
    showEmail: flag(env.CLAUDE_HUD_SHOW_EMAIL),
    debug: flag(env.CLAUDE_HUD_DEBUG),
  });
}

module.exports = { SEGMENT_KEYS, flag, loadConfig };
