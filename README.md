# claude-hud

[![CI](https://github.com/devgraviton/claude-hud/actions/workflows/ci.yml/badge.svg)](https://github.com/devgraviton/claude-hud/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](package.json)

A heads-up display for [Claude Code](https://code.claude.com): a live, two-row
status line with your model, plan usage, context, cost and repository state.

```
Opus 5 (1M) xhigh ● | session▕░░░░░░░░▏4% 4h36m | weekly▕████░░░░▏49% 5d21h | ctx 31% | $14.98 7h25m38s +759-90 | out 1.2k cache 93%
claude-hud | «Add reset countdowns to the HUD» | ⎎ main* ↑1 | devgraviton/claude-hud PR#1234↗
```

No runtime dependencies, no network access. Requires Node.js 20 or later;
`git` is optional.

## Segments

**Stats row**

| Segment | Shows | Source |
| --- | --- | --- |
| Model | Name (`(1M context)` shortened to `(1M)`), effort level, `⚠` over 200k tokens, `⚡` fast mode, `●` extended thinking, non-default output style | `model`, `effort`, `exceeds_200k_tokens`, `fast_mode`, `thinking`, `output_style` |
| `session` / `weekly` | 5-hour and 7-day plan usage with time to reset (Pro and Max plans) | `rate_limits.five_hour`, `rate_limits.seven_day` |
| `spend` | Spend limit behind a Claude apps gateway; can exceed 100% | `rate_limits.spend_limit` |
| `ctx` | Context window used: green below 50%, yellow below 80%, red above | `context_window` |
| Cost | Session cost in USD, a live session timer, lines added/removed | `cost` |
| Tokens | Output tokens of the last response and prompt-cache hit rate (`cold` once the cache has expired) | `context_window.current_usage`, `prompt_cache` |

**Context row**

| Segment | Shows | Source |
| --- | --- | --- |
| Project | Name of the working directory | `workspace.current_dir` |
| `wt` | Worktree name | `worktree.name`, `workspace.git_worktree` |
| Title | Session name in `«…»` | `session_name` |
| `@agent` | Agent the session runs as | `agent.name` |
| Git | Branch, `*` when there are uncommitted changes, `↑`/`↓` ahead/behind | `git status` |
| Repository | `owner/name` and a clickable `PR#n` (or GitLab `MR!n`), coloured by review state | `workspace.repo`, `pr` |
| Email | Signed-in account (opt-in) | `~/.claude.json` |

Every field is optional: segments appear when Claude Code provides their data.
`spend_limit` and `prompt_cache` need Claude Code 2.1.251 or later. The
`fable` segment is forward-compatible: it renders a per-model weekly window
only if the payload ever includes one, which the documented payload does not
today.

## Install

A plugin cannot register the main status line, so installation has two steps.

**1. Get the code.** Clone this repository somewhere stable:

```sh
git clone https://github.com/devgraviton/claude-hud.git ~/claude-hud
```

Or install it as a plugin; the files land in a versioned directory under
`~/.claude/plugins/cache/`, which changes on every update:

```
/plugin marketplace add devgraviton/claude-hud
/plugin install claude-hud@claude-hud
```

**2. Point your status line at it** in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/Users/you/claude-hud/bin/statusline.js\"",
    "refreshInterval": 2
  }
}
```

Use an absolute path. On Windows, write it with forward slashes
(`C:/Users/you/claude-hud/bin/statusline.js`), because Git Bash strips
unquoted backslashes. The status line appears at the next update.

`refreshInterval` (seconds, minimum 1) re-runs the command between Claude Code
events so the session timer and git segment stay current while the session is
idle. The model, usage, context and cost figures change only when Claude Code
sends new data.

## Configure

Set these in the `env` block of `settings.json` or in your shell profile.

| Variable | Effect |
| --- | --- |
| `CLAUDE_HUD_WIDTH=160` | Wrap width in columns. Defaults to `COLUMNS`, which Claude Code sets to the terminal width, then 80. |
| `CLAUDE_HUD_DISABLE=git,tokens` | Hide segments: `limits`, `context`, `cost`, `tokens`, `project`, `worktree`, `title`, `agent`, `git`, `repo`. The model is always shown. |
| `CLAUDE_HUD_SHOW_EMAIL=1` | Show the signed-in account email. Off by default because it shows up in screenshots and screen shares. Read from `$CLAUDE_CONFIG_DIR/.claude.json` or `~/.claude.json`. |
| `CLAUDE_HUD_COLOR=0` or `NO_COLOR=1` | Plain text: no colour and no hyperlinks. |
| `CLAUDE_HUD_DEBUG=1` | Write render errors to stderr. |

Preview a configuration without Claude Code:

```sh
node bin/statusline.js --demo
CLAUDE_HUD_WIDTH=100 CLAUDE_HUD_DISABLE=tokens node bin/statusline.js --demo
```

## Security and privacy

claude-hud reads the payload on stdin, runs `git status` in the working
directory unless `git` is disabled, and reads your Claude config only for the
opt-in email segment. It never makes network requests. Payload text is
stripped of terminal control sequences before it is printed, and its cache
lives in a private per-user temp directory. See [SECURITY.md](SECURITY.md) for
the full model and how to report a vulnerability.

## Development

```sh
npm run check   # syntax of every file, manifest and version consistency
npm test        # unit, security and end-to-end tests (node:test)
npm run demo
```

```
bin/statusline.js     entry point
lib/cli.js            argument handling, stdin, dependency wiring
lib/render.js         payload → segments → rows
lib/layout.js         width-aware row wrapping
lib/sanitize.js       terminal-safe text and URLs
lib/state.js          private on-disk cache
lib/git.js            hardened git status
lib/*.js              formatting, config, usage windows, timer, email, demo data
tests/                node:test suites
```

CI runs both commands on Node.js 20, 22 and 24 across Linux, macOS and Windows.
Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
