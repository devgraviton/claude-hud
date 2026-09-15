'use strict';

const { finite } = require('./format');

/**
 * `cost.total_duration_ms` is a snapshot Claude Code updates on its own events.
 * To let the timer tick on `refreshInterval` re-runs, the first time a snapshot
 * is seen its implied start time is stored per session; later runs with the
 * same snapshot measure from that anchor. A new snapshot re-anchors.
 */
function createDurationTracker({ store, now }) {
  return function liveDurationMs(data) {
    const cost = data && data.cost;
    const snapshot = cost && typeof cost === 'object' ? finite(cost.total_duration_ms) : null;
    if (snapshot === null || snapshot < 0) return null;

    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    if (!sessionId) return snapshot;

    const key = 'duration\u0000' + sessionId;
    const state = store.read(key);
    if (
      state &&
      state.snapshot === snapshot &&
      finite(state.start) !== null &&
      state.start <= now
    ) {
      return now - state.start;
    }
    store.write(key, { snapshot, start: now - snapshot });
    return snapshot;
  };
}

module.exports = { createDurationTracker };
