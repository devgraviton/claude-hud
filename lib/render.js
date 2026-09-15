'use strict';

// Turns a Claude Code statusline payload into the two-row HUD:
//   stats   — model · usage windows · context · cost · tokens
//   context — project · worktree · title · agent · git · repo/PR · email
// Field names follow https://code.claude.com/docs/en/statusline#available-data.
// Every field is optional; anything missing or malformed is skipped.

const { PALETTE } = require('./ansi');
const fmt = require('./format');
const { layout } = require('./layout');
const { cleanText, safeUrl } = require('./sanitize');
const { fableWindow, windowPercent } = require('./usage');

const PR_TONES = new Map([
  ['approved', 'green'],
  ['changes_requested', 'red'],
  ['pending', 'yellow'],
  ['draft', 'yellow'],
]);

function obj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function count(value) {
  const n = fmt.finite(value);
  return n !== null && n > 0 ? Math.round(n) : 0;
}

function workingDir(data, fallback) {
  const workspace = obj(data.workspace);
  for (const dir of [workspace && workspace.current_dir, data.cwd, fallback]) {
    if (typeof dir === 'string' && dir !== '') return dir;
  }
  return null;
}

function baseName(dir) {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

// ---- stats row --------------------------------------------------------------

function modelSegment(data, { paint }) {
  const model = obj(data.model) || {};
  const rawName = cleanText(model.display_name) || cleanText(model.id) || 'Claude';
  const name = cleanText(rawName.replace(' context)', ')'), 40);
  let out = paint(PALETTE.model, name);

  const effort = obj(data.effort);
  const level = effort && cleanText(effort.level, 12);
  if (level) out += ' ' + paint(PALETTE.dim, level);

  const flags = [];
  if (data.exceeds_200k_tokens === true) flags.push('⚠');
  if (data.fast_mode === true) flags.push('⚡');
  if (obj(data.thinking) && data.thinking.enabled === true) flags.push('●');
  if (flags.length) out += ' ' + paint(PALETTE.yellow, flags.join(''));

  const outputStyle = obj(data.output_style);
  const style = outputStyle && cleanText(outputStyle.name, 24);
  if (style && style !== 'default') out += ' ' + paint(PALETTE.dim, style);
  return out;
}

function usageSegments(data, { paint, now }) {
  const limits = obj(data.rate_limits);
  if (!limits) return [];
  const out = [];
  const add = (label, window) => {
    const pct = windowPercent(window);
    if (pct === null) return;
    const p = Math.max(0, Math.round(pct));
    let segment =
      paint(PALETTE.dim, label) +
      paint(PALETTE[fmt.percentTone(p)], '▕' + fmt.bar(p, 8) + '▏' + p + '%');
    const countdown = fmt.fmtCountdown(fmt.toEpochSeconds(window.resets_at), now);
    if (countdown) segment += ' ' + paint(PALETTE.dim, countdown);
    out.push(segment);
  };
  add('session', obj(limits.five_hour));
  add('weekly', obj(limits.seven_day));
  add('fable', fableWindow(limits));
  add('spend', obj(limits.spend_limit));
  return out;
}

function contextSegment(data, { paint }) {
  const cw = obj(data.context_window);
  if (!cw) return null;
  let pct = fmt.finite(cw.used_percentage);
  if (pct === null) {
    // Same input-only formula Claude Code uses for used_percentage.
    const size = fmt.finite(cw.context_window_size);
    const usage = obj(cw.current_usage);
    const input = usage
      ? count(usage.input_tokens) +
        count(usage.cache_creation_input_tokens) +
        count(usage.cache_read_input_tokens)
      : fmt.finite(cw.total_input_tokens);
    if (size !== null && size > 0 && input !== null) pct = (input / size) * 100;
  }
  const p = Math.max(0, Math.round(pct ?? 0));
  return paint(PALETTE.dim, 'ctx') + ' ' + paint(PALETTE[fmt.percentTone(p)], p + '%');
}

function costSegment(data, { paint, liveDuration }) {
  const cost = obj(data.cost);
  if (!cost) return null;
  const parts = [paint(PALETTE.cost, fmt.fmtCost(cost.total_cost_usd))];
  const elapsed = liveDuration(data);
  if (elapsed !== null) parts.push(paint(PALETTE.dim, fmt.fmtDuration(elapsed)));
  const added = count(cost.total_lines_added);
  const removed = count(cost.total_lines_removed);
  if (added || removed) {
    parts.push(paint(PALETTE.green, '+' + added) + paint(PALETTE.red, '-' + removed));
  }
  return parts.join(' ');
}

function tokensSegment(data, { paint }) {
  const cw = obj(data.context_window);
  const usage = cw && obj(cw.current_usage);
  const cache = obj(data.prompt_cache);
  const parts = [];
  if (usage) parts.push(paint(PALETTE.dim, 'out ' + fmt.fmtNum(usage.output_tokens)));

  // Prefer the session-wide prompt_cache statistics (Claude Code 2.1.251+);
  // fall back to the last response's cache reads.
  let hit = null;
  let cold = false;
  const ratio = cache ? fmt.finite(cache.hit_ratio) : null;
  if (ratio !== null) {
    hit = ratio * 100;
    cold = cache.warm === false && cache.caching_observed === true;
  } else if (usage) {
    const cacheRead = count(usage.cache_read_input_tokens);
    const totalIn =
      count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + cacheRead;
    if (totalIn > 0) hit = (cacheRead / totalIn) * 100;
  }
  if (hit !== null) {
    const h = Math.round(Math.min(100, Math.max(0, hit)));
    const tone = cold ? 'yellow' : h >= 70 ? 'green' : 'dim';
    parts.push(paint(PALETTE[tone], 'cache ' + h + '%' + (cold ? ' cold' : '')));
  }
  return parts.length ? parts.join(' ') : null;
}

// ---- context row ------------------------------------------------------------

function projectSegment(dir, { paint }) {
  const name = dir ? cleanText(baseName(dir), 40) : '';
  return name ? paint(PALETTE.project, name) : null;
}

function worktreeSegment(data, { paint }) {
  const session = obj(data.worktree);
  const workspace = obj(data.workspace);
  const name =
    cleanText(session && session.name, 32) || cleanText(workspace && workspace.git_worktree, 32);
  return name ? paint(PALETTE.dim, 'wt ' + name) : null;
}

function titleSegment(data, { paint }) {
  const title = cleanText(data.session_name, 28);
  return title ? paint(PALETTE.dim, '«' + title + '»') : null;
}

function agentSegment(data, { paint }) {
  const agent = obj(data.agent);
  const name = agent && cleanText(agent.name, 24);
  return name ? paint(PALETTE.dim, '@' + name) : null;
}

function gitSegment(dir, { paint, git }) {
  const status = dir ? git(dir) : null;
  if (!status) return null;
  const branch = cleanText(status.branch, 40);
  if (!branch) return null;
  let out = '⎎ ' + branch + (status.dirty ? '*' : '');
  if (status.ahead > 0) out += ' ↑' + status.ahead;
  if (status.behind > 0) out += ' ↓' + status.behind;
  return paint(PALETTE.git, out);
}

function repoSegment(data, { paint, link }) {
  const out = [];
  const workspace = obj(data.workspace);
  const repo = workspace && obj(workspace.repo);
  const owner = repo && cleanText(repo.owner, 60);
  const name = repo && cleanText(repo.name, 60);
  if (owner && name) out.push(paint(PALETTE.dim, owner + '/' + name));

  const pr = obj(data.pr);
  const number = pr && fmt.finite(pr.number);
  if (number !== null && Number.isInteger(number) && number > 0) {
    const tone = PR_TONES.get(pr.review_state) || 'dim';
    const label = (pr.kind === 'mr' ? 'MR!' : 'PR#') + number + '↗';
    out.push(paint(PALETTE[tone], link(label, safeUrl(pr.url))));
  }
  return out.length ? out.join(' ') : null;
}

function emailSegment({ paint, email }) {
  const address = cleanText(email(), 80);
  return address ? paint(PALETTE.dim, address) : null;
}

// ---- assembly ---------------------------------------------------------------

function buildGroups(data, ctx) {
  const off = (key) => ctx.config.disabled.has(key);

  const stats = [modelSegment(data, ctx)];
  if (!off('limits')) stats.push(...usageSegments(data, ctx));
  if (!off('context')) stats.push(contextSegment(data, ctx));
  if (!off('cost')) stats.push(costSegment(data, ctx));
  if (!off('tokens')) stats.push(tokensSegment(data, ctx));

  const dir = workingDir(data, ctx.cwd);
  const context = [];
  if (!off('project')) context.push(projectSegment(dir, ctx));
  if (!off('worktree')) context.push(worktreeSegment(data, ctx));
  if (!off('title')) context.push(titleSegment(data, ctx));
  if (!off('agent')) context.push(agentSegment(data, ctx));
  if (!off('git')) context.push(gitSegment(dir, ctx));
  if (!off('repo')) context.push(repoSegment(data, ctx));
  if (ctx.config.showEmail) context.push(emailSegment(ctx));

  return [stats.filter(Boolean), context.filter(Boolean)];
}

/**
 * @param {unknown} data  parsed statusline payload
 * @param {object} ctx    { config, paint, link, now, cwd, git(dir), liveDuration(data), email() }
 */
function render(data, ctx) {
  return layout(buildGroups(obj(data) || {}, ctx), ctx.config.width, ctx.paint);
}

module.exports = { buildGroups, render };
