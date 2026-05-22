# claude-hud

A heads-up display for Claude Code — a live status line pinned to the bottom of
the terminal. It refreshes on every conversation turn and shows, in one compact
line:

```
Opus 4.7 high  ·  ctx 42%  ·  out 1.2k cache 89%  ·  $0.34 12m04s +156-23  ·  session ▕███░░░░░▏ 34% ↺3h12m  ·  weekly ▕████░░░░▏ 52% ↺4d3h  ·  ⎎ main* PR#1234
```

| Segment | Shows |
| --- | --- |
| **Model** | model display name + reasoning effort level |
| **Context** | percent of the context window used, as text (green &lt;50%, yellow &lt;80%, red above) |
| **Tokens** | output tokens of the last response + cache-hit rate |
| **Cost** | session cost (USD), live session timer, lines added/removed |
| **Session** | 5-hour usage window — percent bar + live countdown to reset (Claude.ai Pro/Max only) |
| **Weekly** | 7-day usage window — percent bar + live countdown to reset (Claude.ai Pro/Max only) |
| **Git** | current branch (`*` = uncommitted changes) + open PR number/review state |

Everything is read from the JSON payload Claude Code pipes to the status line
on stdin; the git branch is read with `git` in the session's working directory.
Pure Node.js — no `jq`, no dependencies. Requires Claude Code v2.1.132+.

## Setup

A Claude Code status line is activated by a `statusLine` entry in **your own**
settings — Claude Code does **not** let a plugin register a status line for you
(a plugin's bundled `settings.json` only supports the `agent` and
`subagentStatusLine` keys; `statusLine` is ignored). So setup is two steps: get
the script, then point your settings at it.

### 1. Get the script

Either install the plugin…

```
/plugin marketplace add devgraviton/claude-hud
/plugin install claude-hud@claude-hud
```

…which places the script at
`~/.claude/plugins/cache/claude-hud/claude-hud/<version>/bin/statusline.js` —
or just clone this repo anywhere.

### 2. Point your status line at it

Run `/statusline` in Claude Code and give it the path, or add this to
`~/.claude/settings.json` yourself:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/ABSOLUTE/PATH/TO/claude-hud/bin/statusline.js\"",
    "padding": 0
  }
}
```

Restart Claude Code — the status line appears at the bottom.

> **Path tip:** the plugin cache path contains the version number and changes
> on every `claude plugin update`. For a path that survives updates, point at a
> clone of this repo, or copy `bin/statusline.js` to a fixed location such as
> `~/.claude/`.

## Configure

Set environment variables for the Claude Code process (your shell profile, or
the `env` block of `settings.json`):

| Variable | Effect |
| --- | --- |
| `CLAUDE_HUD_DISABLE=context,tokens,cost,limits,git` | hide any of these segments (comma-separated); the model is always shown |
| `CLAUDE_HUD_COLOR=0` / `NO_COLOR=1` | disable ANSI colors |

Example — show only model + context on a narrow terminal:

```json
{ "env": { "CLAUDE_HUD_DISABLE": "tokens,cost,limits,git" } }
```

## Live updates

The status line re-renders after every assistant turn. To make it also tick
*between* turns — a live session timer, fresh git state — add `refreshInterval`
to the `statusLine` block in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node \"/ABSOLUTE/PATH/TO/claude-hud/bin/statusline.js\"",
  "refreshInterval": 2
}
```

`refreshInterval` is in seconds (minimum 1); the command re-runs that often
even while idle. `2` is a good balance — `1` is snappier but spawns a process
every second.

What it does and doesn't do: the model, context %, token, cost and usage
figures are snapshots Claude Code updates **once per assistant turn** — there
is no sub-turn data, so `refreshInterval` cannot make those change between
turns. What it *does* keep live is the session timer and the git segment.

## Preview / test

```sh
node bin/statusline.js --demo

echo '{"model":{"display_name":"Sonnet"},"context_window":{"used_percentage":75,"total_input_tokens":150000,"context_window_size":200000}}' \
  | node bin/statusline.js
```

## Repo layout

```
claude-hud/
├── .claude-plugin/
│   ├── marketplace.json    # marketplace manifest
│   └── plugin.json         # plugin manifest
├── bin/
│   └── statusline.js       # the status line script
├── LICENSE
└── README.md
```

## License

MIT
