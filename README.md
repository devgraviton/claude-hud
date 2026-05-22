# claude-hud

A heads-up display for Claude Code — a live status line pinned to the bottom of
the terminal. It refreshes every turn (and between turns) and shows, on one
line:

```
Opus 4.7 (1M) xhigh | session▕░░░░░░░░▏1% | weekly▕█████░░░▏64% | ctx 31% | $14.98 7h25m38s +759-90 | out 1.2k cache 100% | you@example.com
```

| Segment | Shows |
| --- | --- |
| **Model** | model name + reasoning effort level (`(1M context)` is shortened to `(1M)`) |
| **Session** | 5-hour usage window, as a percent bar (Claude.ai Pro/Max accounts only) |
| **Weekly** | 7-day usage window, as a percent bar (Claude.ai Pro/Max accounts only) |
| **Context** | percent of the context window used (green &lt;50%, yellow &lt;80%, red above) |
| **Cost** | session cost (USD), live session timer, lines added/removed |
| **Tokens** | output tokens of the last response + cache-hit rate |
| **Git** | branch (`*` = uncommitted changes) + open PR — shown unless disabled |
| **Email** | logged-in Claude Code account email — opt-in (see Configure) |

Data comes from the JSON Claude Code pipes to the status line on stdin; the git
branch is read with `git`, and the account email from your local
`~/.claude.json`. Pure Node.js — no dependencies. Requires Claude Code v2.1.132+.
If the line is wider than the terminal it wraps onto extra rows instead of
overflowing.

## Setup

A Claude Code status line is activated by a `statusLine` entry in **your own**
settings — Claude Code does not let a plugin register one (a plugin's bundled
`settings.json` only honors the `agent` and `subagentStatusLine` keys). So setup
is two steps.

### 1. Get the script

Install the plugin…

```
/plugin marketplace add devgraviton/claude-hud
/plugin install claude-hud@claude-hud
```

…which places the script under
`~/.claude/plugins/cache/claude-hud/claude-hud/<version>/bin/statusline.js` — or
just clone this repo anywhere.

### 2. Point your status line at it

Run `/statusline` in Claude Code, or add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/ABSOLUTE/PATH/TO/claude-hud/bin/statusline.js\"",
    "refreshInterval": 2
  },
  "env": {
    "CLAUDE_HUD_WIDTH": "160"
  }
}
```

Restart Claude Code — the status line appears at the bottom.

> **Path tip:** the plugin cache path contains the version number and changes on
> every `claude plugin update`. For a path that survives updates, point at a
> clone of this repo.

## Configure

Set these environment variables in the `env` block of `settings.json` (or your
shell profile):

| Variable | Effect |
| --- | --- |
| `CLAUDE_HUD_WIDTH=160` | wrap segments to this many columns. Claude Code does not expose the real terminal width, so set this to your terminal's width. Default: 80. |
| `CLAUDE_HUD_DISABLE=git,tokens` | hide segments (comma-separated): `context`, `tokens`, `cost`, `limits`, `git` |
| `CLAUDE_HUD_SHOW_EMAIL=1` | show the logged-in account email. Off by default — it appears in screenshots/screen-shares. Read live from your local `~/.claude.json`; never stored in this repo. |
| `CLAUDE_HUD_COLOR=0` / `NO_COLOR=1` | disable ANSI colors |

## Live updates

The status line re-renders after every turn. Add `refreshInterval` (seconds,
minimum 1) to the `statusLine` block to make it tick *between* turns too:

```json
"statusLine": { "type": "command", "command": "…", "refreshInterval": 2 }
```

That keeps the **session timer** and the **git** segment live. The model,
context, token, cost and usage figures are snapshots Claude Code updates once
per assistant turn — there is no sub-turn data, so `refreshInterval` cannot make
those change between turns.

## Preview / test

```sh
node bin/statusline.js --demo
CLAUDE_HUD_WIDTH=160 CLAUDE_HUD_SHOW_EMAIL=1 node bin/statusline.js --demo
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
