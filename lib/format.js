'use strict';

// Pure number/time formatting helpers. Nothing here reads the environment or
// the clock implicitly: callers pass `now` so rendering stays deterministic.

/** `value` as a finite number, or `null` (booleans and empty strings are rejected). */
function finite(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const trimZero = (s) => s.replace(/\.0$/, '');

/** Compact count: 950 → "950", 1200 → "1.2k", 3400000 → "3.4M". */
function fmtNum(value) {
  const n = Math.max(0, finite(value) ?? 0);
  if (n >= 999_950) return trimZero((n / 1e6).toFixed(1)) + 'M';
  if (n >= 999.5) return trimZero((n / 1e3).toFixed(1)) + 'k';
  return String(Math.round(n));
}

/** Elapsed time: "42s", "3m07s", "7h25m38s". */
function fmtDuration(ms) {
  let s = Math.floor(Math.max(0, finite(ms) ?? 0) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h${pad(m)}m${pad(s)}s`;
  if (m > 0) return `${m}m${pad(s)}s`;
  return `${s}s`;
}

/** USD with cents; sub-cent spend shows as "<$0.01" rather than "$0.00". */
function fmtCost(usd) {
  const n = Math.max(0, finite(usd) ?? 0);
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

/** Time until `epochSeconds`, top two units ("4d14h", "3h", "12m", "<1m"); "" once past. */
function fmtCountdown(epochSeconds, now) {
  const target = finite(epochSeconds);
  if (target === null) return '';
  const ms = target * 1000 - now;
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

/** A reset time as epoch seconds, from an epoch number or an ISO-8601 string. */
function toEpochSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value === '') return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** Fixed-width block bar; the percentage is clamped to 0–100 for drawing only. */
function bar(pct, width) {
  const p = Math.max(0, Math.min(100, finite(pct) ?? 0));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Traffic-light tone for a usage percentage. */
function percentTone(pct) {
  return pct < 50 ? 'green' : pct < 80 ? 'yellow' : 'red';
}

module.exports = {
  bar,
  finite,
  fmtCost,
  fmtCountdown,
  fmtDuration,
  fmtNum,
  percentTone,
  toEpochSeconds,
};
