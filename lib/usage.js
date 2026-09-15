'use strict';

const { finite } = require('./format');

/**
 * A usage window's percentage. Accepts the documented `used_percentage`
 * (0–100, or above 100 for an exceeded spend limit) or a raw `utilization`
 * fraction (0–1). Returns null when the window carries neither.
 */
function windowPercent(window) {
  if (!window || typeof window !== 'object') return null;
  const used = finite(window.used_percentage);
  if (used !== null) return used;
  const utilization = finite(window.utilization);
  if (utilization === null) return null;
  return utilization <= 1 ? utilization * 100 : utilization;
}

/**
 * The Fable 5 weekly window, if the payload ever carries one. Claude Code's
 * documented statusline payload has no per-model windows today (only
 * `five_hour`, `seven_day` and `spend_limit`), so this is forward-compatible
 * and normally returns null: it looks for a `model_scoped[]` entry named
 * Fable, then the flat `seven_day_overage_included` window.
 */
function fableWindow(rateLimits) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  if (Array.isArray(rateLimits.model_scoped)) {
    const entry = rateLimits.model_scoped.find(
      (m) => m && typeof m.display_name === 'string' && /fable/i.test(m.display_name)
    );
    if (entry) return entry;
  }
  const flat = rateLimits.seven_day_overage_included;
  return flat && typeof flat === 'object' ? flat : null;
}

module.exports = { fableWindow, windowPercent };
