'use strict';

/** Sample payload for `--demo`, shaped like Claude Code's statusline JSON. */
function demoData(now, cwd) {
  const epoch = Math.floor(now / 1000);
  return {
    model: { id: 'claude-opus-5', display_name: 'Opus 5 (1M context)' },
    effort: { level: 'xhigh' },
    thinking: { enabled: true },
    fast_mode: false,
    exceeds_200k_tokens: false,
    output_style: { name: 'default' },
    session_name: 'Add reset countdowns to the HUD',
    cwd,
    workspace: {
      current_dir: cwd,
      project_dir: cwd,
      added_dirs: [],
      repo: { host: 'github.com', owner: 'devgraviton', name: 'claude-hud' },
    },
    context_window: {
      total_input_tokens: 310000,
      total_output_tokens: 1200,
      context_window_size: 1000000,
      used_percentage: 31,
      remaining_percentage: 69,
      current_usage: {
        input_tokens: 2000,
        output_tokens: 1200,
        cache_creation_input_tokens: 8000,
        cache_read_input_tokens: 300000,
      },
    },
    prompt_cache: { warm: true, caching_observed: true, ttl: '1h', hit_ratio: 0.93 },
    cost: {
      total_cost_usd: 14.98,
      total_duration_ms: 26738000,
      total_api_duration_ms: 9120000,
      total_lines_added: 759,
      total_lines_removed: 90,
    },
    rate_limits: {
      five_hour: { used_percentage: 4, resets_at: epoch + 4 * 3600 + 36 * 60 },
      seven_day: { used_percentage: 49, resets_at: epoch + 5 * 86400 + 21 * 3600 },
    },
    pr: {
      number: 1234,
      url: 'https://github.com/devgraviton/claude-hud/pull/1234',
      review_state: 'pending',
    },
  };
}

module.exports = { demoData };
