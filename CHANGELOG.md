# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09-15

### Security

- Strip terminal control characters, C1 codes and bidi overrides from every
  payload string before printing, so a crafted session name, branch or repo
  name cannot inject escape sequences.
- Emit pull-request hyperlinks only for `http(s)` URLs without credentials or
  control bytes.
- Move the session-timer cache from a predictable file in the shared temp
  directory to a private per-user directory (`0700`, ownership and symlink
  checks, hashed file names, `O_NOFOLLOW` reads, exclusive `0600` writes,
  pruning of stale entries).
- Run git without a shell and with `core.fsmonitor=false`,
  `--no-optional-locks` and `--ignore-submodules=all`; one `git status` call
  replaces three.
- Cap stdin at 1 MiB; ignore non-object payloads.
- Render errors no longer print exception messages unless `CLAUDE_HUD_DEBUG=1`.
- CI: read-only token permissions, SHA-pinned actions, no persisted
  credentials, Dependabot for action updates.

### Added

- `spend_limit` usage window (Claude apps gateway spend limits).
- `prompt_cache` hit ratio, with a `cold` marker when the cache has expired.
- GitLab merge requests (`pr.kind: "mr"`) render as `MR!<n>`.
- Worktree (`worktree.name` / `workspace.git_worktree`) and agent
  (`agent.name`) segments, with `worktree` and `agent` keys for
  `CLAUDE_HUD_DISABLE`.
- Ahead/behind counts on the git segment.
- `COLUMNS` is honoured as the wrap width, as Claude Code sets it for status
  line commands; `CLAUDE_HUD_WIDTH` still takes precedence.
- Display-width aware wrapping and truncation for CJK text and emoji.
- `--help`, `--version`, `CLAUDE_HUD_DEBUG`, and `CLAUDE_CONFIG_DIR` support for
  the email segment.
- Forward-compatible `fable` per-model usage window.

### Changed

- The single script is split into focused modules under `lib/`, with unit,
  security and end-to-end tests.
- The context-percentage fallback uses the documented input-only formula.
- CI tests Node.js 20, 22 and 24 on Linux, macOS and Windows.
- Removed internal planning documents from the repository.

## [0.2.0] - 2026-06-29

- Two-row layout, session title, repository and pull-request segments, mode
  indicators and reset countdowns.
