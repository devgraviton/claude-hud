#!/usr/bin/env node
'use strict';

/*
 * claude-hud — a heads-up display (live status line) for Claude Code.
 *
 * Claude Code pipes a JSON status payload to this script's stdin on every
 * conversation update; we print a compact, colorized status line back.
 *
 * Override behavior via environment variables (see README.md):
 *   CLAUDE_HUD_DISABLE=context,tokens,cost,limits,git  hide one or more segments
 *   CLAUDE_HUD_WIDTH=160      wrap segments to this many columns (default: auto)
 *   CLAUDE_HUD_SHOW_EMAIL=1   show the logged-in Claude Code account email
 *   CLAUDE_HUD_COLOR=0  (or NO_COLOR=1)                 disable ANSI color
 *
 * Run `node bin/statusline.js --demo` to preview with sample data.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DISABLED = new Set(
  (process.env.CLAUDE_HUD_DISABLE || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const USE_COLOR = !process.env.NO_COLOR && process.env.CLAUDE_HUD_COLOR !== '0';
const SHOW_EMAIL =
  !!process.env.CLAUDE_HUD_SHOW_EMAIL &&
  process.env.CLAUDE_HUD_SHOW_EMAIL !== '0';

// ---- formatting helpers --------------------------------------------------

const COL = {
  model: '1;38;5;80', // bold cyan
  dim: '38;5;244', // gray
  green: '38;5;114',
  yellow: '38;5;179',
  red: '38;5;203',
  cost: '38;5;179',
  git: '38;5;176',
  project: '1;38;5;215', // bold orange
};

function paint(code, str) {
  return USE_COLOR ? `\x1b[${code}m${str}\x1b[0m` : String(str);
}

// OSC 8 terminal hyperlink. Suppressed when color is off so that plain mode
// stays free of escape bytes; falls back to the bare text.
function hyperlink(text, url) {
  if (!url || !USE_COLOR) return String(text);
  return '\x1b]8;;' + url + '\x1b\\' + text + '\x1b]8;;\x1b\\';
}

function pctColor(p) {
  return p < 50 ? COL.green : p < 80 ? COL.yellow : COL.red;
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return String((n / 1e6).toFixed(1)).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return String((n / 1e3).toFixed(1)).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

function fmtDuration(ms) {
  let s = Math.floor((Number(ms) || 0) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return h + 'h' + pad(m) + 'm' + pad(s) + 's';
  if (m > 0) return m + 'm' + pad(s) + 's';
  return s + 's';
}

function fmtCost(usd) {
  usd = Number(usd) || 0;
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(2);
}

// compact "time until reset": up to the top two units, dropping a leading zero
function fmtCountdown(epochSeconds) {
  const ms = (Number(epochSeconds) || 0) * 1000 - Date.now();
  if (!(ms > 0)) return '';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return d + 'd' + (h > 0 ? h + 'h' : '');
  if (h > 0) return h + 'h' + (m > 0 ? m + 'm' : '');
  if (m > 0) return m + 'm';
  return '<1m';
}

function truncate(str, max) {
  str = String(str);
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function bar(pct, width) {
  pct = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---- usage windows -------------------------------------------------------

// A usage window's percent (0-100). Accepts either the statusline's
// `used_percentage` (0-100) or the raw claude.ai `utilization` (a 0-1 fraction,
// or occasionally already 0-100), so the same renderer handles both shapes.
function winPercent(w) {
  if (!w) return null;
  if (w.used_percentage != null) return Number(w.used_percentage) || 0;
  if (w.utilization != null) {
    const u = Number(w.utilization) || 0;
    return u <= 1 ? u * 100 : u; // fraction → percent; leave an already-0-100 value
  }
  return null;
}

// A usage window's reset time as epoch seconds. Accepts either an epoch number or
// an ISO-8601 string (per-model windows carry the latter).
function winResetEpoch(w) {
  const r = w && w.resets_at;
  if (r == null) return null;
  if (typeof r === 'number') return r;
  const t = Date.parse(r);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// The Fable 5 weekly window, however Claude Code chooses to surface it: a
// per-model entry in `model_scoped[]` (matched by display name), or the flat
// `seven_day_overage_included` window (which the CLI's /usage view labels
// "Fable 5 limit"). Returns null when the payload carries neither — as today's
// statusline payload does; it exposes only `five_hour` and `seven_day`, so this
// segment stays dormant until Claude Code starts emitting per-model windows.
function fableWindow(rl) {
  if (!rl) return null;
  if (Array.isArray(rl.model_scoped)) {
    const f = rl.model_scoped.find(
      (m) => m && /fable/i.test(m.display_name || '')
    );
    if (f) return f;
  }
  return rl.seven_day_overage_included || null;
}

// ---- live session duration ----------------------------------------------

// cost.total_duration_ms is a per-turn snapshot. To make the session timer
// tick on every refresh, anchor a start timestamp (per session_id) in a temp
// file and measure from it — re-anchoring whenever Claude Code reports a new
// duration, so it stays accurate across turns.
function liveDurationMs(data) {
  const snapshot = data.cost && data.cost.total_duration_ms;
  if (typeof snapshot !== 'number') return null;
  const sid = data.session_id;
  if (!sid) return snapshot;
  const file = path.join(
    os.tmpdir(),
    'claude-hud-' + String(sid).replace(/[^\w.-]/g, '_') + '.json'
  );
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  if (!state || state.snapshot !== snapshot) {
    // new turn (or first run): re-anchor to Claude Code's reported duration
    state = { snapshot, start: Date.now() - snapshot };
    try {
      fs.writeFileSync(file, JSON.stringify(state));
    } catch (_) {}
  }
  return Date.now() - state.start;
}

// ---- account email ------------------------------------------------------

// The logged-in Claude Code account email, read from the user's local
// ~/.claude.json. Shown only when CLAUDE_HUD_SHOW_EMAIL is set. The address is
// read live from each machine — it is never stored in this repo.
function accountEmail() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
    const m = raw.match(/"emailAddress"\s*:\s*"([^"@]+@[^"]+)"/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

// ---- git -----------------------------------------------------------------

function git(args, cwd) {
  return execSync('git ' + args, {
    cwd,
    timeout: 800,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
}

function gitSegment(data) {
  const cwd =
    (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();

  let branch;
  try {
    branch = git('rev-parse --abbrev-ref HEAD', cwd);
  } catch (_) {
    return ''; // not a git repo (or git unavailable)
  }
  if (!branch) return '';
  if (branch === 'HEAD') {
    // detached HEAD — fall back to the short commit hash
    try {
      branch = git('rev-parse --short HEAD', cwd) + '…';
    } catch (_) {}
  }

  let dirty = false;
  try {
    dirty = git('status --porcelain', cwd).length > 0;
  } catch (_) {}

  return paint(COL.git, '⎎ ' + branch + (dirty ? '*' : ''));
}

// repo owner/name + open PR, derived from the payload (no git shell-out)
function repoSegment(data) {
  const out = [];
  const repo = data.workspace && data.workspace.repo;
  if (repo && repo.owner && repo.name) {
    out.push(paint(COL.dim, repo.owner + '/' + repo.name));
  }
  const pr = data.pr;
  if (pr && pr.number) {
    const stateCol =
      {
        approved: COL.green,
        changes_requested: COL.red,
        pending: COL.yellow,
        draft: COL.yellow,
      }[pr.review_state] || COL.dim;
    out.push(paint(stateCol, hyperlink('PR#' + pr.number + '↗', pr.url)));
  }
  return out.join(' ');
}

// ---- line builder --------------------------------------------------------

// Row 1 (stats): model+effort+indicators · limits · ctx · cost · tokens
// Row 2 (context): project · title · git · repo/PR · email
function build(data) {
  const stats = [];
  const context = [];

  // model (always shown) — "Opus 4.7 (1M context)" shortened to "(1M)"
  const model = data.model || {};
  const name = (model.display_name || model.id || 'Claude').replace(
    ' context)',
    ')'
  );
  let modelStr = paint(COL.model, name);
  if (data.effort && data.effort.level) {
    modelStr += ' ' + paint(COL.dim, data.effort.level);
  }
  const flags = [];
  if (data.exceeds_200k_tokens === true) flags.push('⚠');
  if (data.fast_mode === true) flags.push('⚡');
  if (data.thinking && data.thinking.enabled === true) flags.push('●');
  const styleName = data.output_style && data.output_style.name;
  if (flags.length) modelStr += ' ' + paint(COL.yellow, flags.join(''));
  if (styleName && styleName !== 'default') {
    modelStr += ' ' + paint(COL.dim, styleName);
  }
  stats.push(modelStr);

  // session (5-hour) + weekly (7-day) + per-model (Fable) usage windows
  if (data.rate_limits && !DISABLED.has('limits')) {
    const rl = data.rate_limits;
    const win = (label, w) => {
      const pct = winPercent(w);
      if (pct == null) return;
      const p = Math.round(pct);
      const col = pctColor(p);
      let s =
        paint(COL.dim, label) + paint(col, '▕' + bar(p, 8) + '▏' + p + '%');
      const cd = fmtCountdown(winResetEpoch(w));
      if (cd) s += ' ' + paint(COL.dim, cd);
      stats.push(s);
    };
    win('session', rl.five_hour);
    win('weekly', rl.seven_day);
    win('fable', fableWindow(rl));
  }

  const cw = data.context_window || null;

  // context-window usage
  if (cw && !DISABLED.has('context')) {
    let pct = cw.used_percentage;
    if (pct == null && cw.context_window_size) {
      pct = (cw.total_input_tokens / cw.context_window_size) * 100;
    }
    pct = Number(pct) || 0;
    stats.push(
      paint(COL.dim, 'ctx') + ' ' + paint(pctColor(pct), Math.round(pct) + '%')
    );
  }

  // cost + live session timer + lines changed
  if (data.cost && !DISABLED.has('cost')) {
    const parts = [paint(COL.cost, fmtCost(data.cost.total_cost_usd))];
    const durMs = liveDurationMs(data);
    if (durMs != null) parts.push(paint(COL.dim, fmtDuration(durMs)));
    const add = data.cost.total_lines_added || 0;
    const del = data.cost.total_lines_removed || 0;
    if (add || del) {
      parts.push(paint(COL.green, '+' + add) + paint(COL.red, '-' + del));
    }
    stats.push(parts.join(' '));
  }

  // token breakdown for the most recent response + cache hit rate
  const cu = cw && cw.current_usage;
  if (cu && !DISABLED.has('tokens')) {
    const totalIn =
      (cu.input_tokens || 0) +
      (cu.cache_creation_input_tokens || 0) +
      (cu.cache_read_input_tokens || 0);
    let t = paint(COL.dim, 'out ' + fmtNum(cu.output_tokens || 0));
    if (totalIn > 0) {
      const hit = Math.round(
        ((cu.cache_read_input_tokens || 0) / totalIn) * 100
      );
      t += ' ' + paint(hit >= 70 ? COL.green : COL.dim, 'cache ' + hit + '%');
    }
    stats.push(t);
  }

  // ---- row 2: context ----

  // project — basename of the current working directory
  if (!DISABLED.has('project')) {
    const cwd =
      (data.workspace && data.workspace.current_dir) ||
      data.cwd ||
      process.cwd();
    const pname = path.basename(cwd);
    if (pname) context.push(paint(COL.project, pname));
  }

  // session title (human label for this session)
  if (data.session_name && !DISABLED.has('title')) {
    context.push(paint(COL.dim, '«' + truncate(data.session_name, 28) + '»'));
  }

  // git branch + dirty marker (shells out to git)
  if (!DISABLED.has('git')) {
    const g = gitSegment(data);
    if (g) context.push(g);
  }

  // repo + PR from the payload (independent of the git shell-out)
  if (!DISABLED.has('repo')) {
    const r = repoSegment(data);
    if (r) context.push(r);
  }

  // logged-in Claude Code account email — opt-in
  if (SHOW_EMAIL) {
    const email = accountEmail();
    if (email) context.push(paint(COL.dim, email));
  }

  return layout([stats, context]);
}

// ---- layout: pack segments into rows that fit the terminal width ---------

function visibleWidth(str) {
  // measured width ignores ANSI escapes (they take no display columns):
  // strip OSC 8 hyperlinks first, then SGR color codes.
  return str
    .replace(/\x1b\]8;[^;]*;[^\x1b\x07]*(?:\x1b\\|\x07)/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '').length;
}

function effectiveWidth() {
  let width =
    parseInt(process.env.CLAUDE_HUD_WIDTH, 10) ||
    process.stdout.columns ||
    parseInt(process.env.COLUMNS, 10) ||
    80;
  if (!(width > 20)) width = 80;
  return width;
}

// pack one group's segments into rows that fit the width
function wrapRows(seg, width) {
  const sep = ' ' + paint(COL.dim, '|') + ' ';
  const SEP_W = 3; // visible width of the separator: space + bar + space
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const s of seg) {
    const w = visibleWidth(s);
    const added = row.length ? w + SEP_W : w;
    if (row.length && rowWidth + added > width) {
      rows.push(row.join(sep)); // current row is full — start a new one
      row = [s];
      rowWidth = w;
    } else {
      row.push(s);
      rowWidth += added;
    }
  }
  if (row.length) rows.push(row.join(sep));
  return rows;
}

// render each group as its own wrap-block; empty groups produce no line
function layout(groups) {
  const width = effectiveWidth();
  const lines = [];
  for (const seg of groups) {
    if (!seg || !seg.length) continue;
    for (const r of wrapRows(seg, width)) lines.push(r);
  }
  return lines.join('\n');
}

// ---- entry ---------------------------------------------------------------

function emit(data) {
  let line;
  try {
    line = build(data);
  } catch (e) {
    line = paint(COL.dim, 'claude-hud: ' + (e && e.message));
  }
  process.stdout.write(line);
}

function demoData() {
  return {
    model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8 (1M context)' },
    effort: { level: 'xhigh' },
    thinking: { enabled: true },
    fast_mode: false,
    exceeds_200k_tokens: false,
    output_style: { name: 'default' },
    session_name: 'Add reset countdowns to the HUD',
    cwd: process.cwd(),
    workspace: {
      current_dir: process.cwd(),
      repo: { host: 'github.com', owner: 'devgraviton', name: 'claude-hud' },
    },
    context_window: {
      total_input_tokens: 62000,
      total_output_tokens: 1200,
      context_window_size: 200000,
      used_percentage: 31,
      remaining_percentage: 69,
      current_usage: {
        input_tokens: 0,
        output_tokens: 1200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 220000,
      },
    },
    cost: {
      total_cost_usd: 14.98,
      total_duration_ms: 26738000,
      total_lines_added: 759,
      total_lines_removed: 90,
    },
    rate_limits: {
      five_hour: {
        used_percentage: 1,
        resets_at: Math.floor(Date.now() / 1000) + 4 * 3600 + 43 * 60,
      },
      seven_day: {
        used_percentage: 64,
        resets_at: Math.floor(Date.now() / 1000) + 4 * 86400 + 14 * 3600,
      },
      // per-model weekly window (Claude Code's "Fable 5 limit"), in the
      // server-driven `model_scoped[]` shape: utilization is a 0-1 fraction and
      // resets_at is an ISO-8601 string.
      model_scoped: [
        {
          display_name: 'Fable',
          utilization: 0.12,
          resets_at: new Date(
            Date.now() + 4 * 86400000 + 6 * 3600000
          ).toISOString(),
        },
      ],
    },
    pr: {
      number: 1234,
      url: 'https://github.com/devgraviton/claude-hud/pull/1234',
      review_state: 'pending',
    },
  };
}

if (process.argv.includes('--demo')) {
  emit(demoData());
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let data = {};
    try {
      data = JSON.parse(input || '{}');
    } catch (_) {}
    emit(data);
  });
}
