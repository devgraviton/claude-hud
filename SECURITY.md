# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/devgraviton/claude-hud/security/advisories/new).
Do not open a public issue. You should receive an acknowledgement within a
week; fixes are released as a new version and noted in [CHANGELOG.md](CHANGELOG.md).

Only the latest release is supported.

## What claude-hud does on your machine

claude-hud is a single Node.js program with no runtime dependencies. Claude
Code starts it for every status line update and pipes a JSON payload to it.

| Access | Detail |
| --- | --- |
| **Reads** stdin | The statusline payload, capped at 1 MiB; larger input is ignored. |
| **Reads** `~/.claude.json` | Only when `CLAUDE_HUD_SHOW_EMAIL=1`, and only `oauthAccount.emailAddress`. `$CLAUDE_CONFIG_DIR/.claude.json` is tried first when set. |
| **Runs** `git status` | In the session's working directory unless the `git` segment is disabled. No shell is used, the argument list is fixed, and the call is limited to 1 s. |
| **Writes** a cache | Small JSON files (session timer anchor, git status) in a per-user directory under the system temp directory. |
| **Network** | None. |

## Hardening

- **Terminal escape injection.** Every payload string (session name, model and
  output-style names, repository owner/name, agent and worktree names, git
  branch, email) has C0/C1 control characters, bidi overrides and line
  separators removed before printing. Pull-request links are emitted as OSC 8
  hyperlinks only for `http(s)` URLs without credentials or control bytes.
- **Temp-directory safety.** The cache lives in `claude-hud-<uid>` created with
  mode `0700`. If that path exists but is a symlink, is owned by another user,
  or is accessible to others, caching is disabled. File names are SHA-256
  digests, never payload values. Reads refuse symlinks (`O_NOFOLLOW`) and
  files over 64 KiB; writes use an exclusive `0600` temp file renamed into
  place. Entries older than seven days are pruned.
- **git.** `git status` runs with `core.fsmonitor=false` (a repository-configured
  fsmonitor is an executable), `--no-optional-locks` (never rewrites the index),
  `--ignore-submodules=all`, and `GIT_TERMINAL_PROMPT=0`.
- **Failure isolation.** Malformed or unexpected payload fields are skipped.
  Render errors print a generic message; details go to stderr only with
  `CLAUDE_HUD_DEBUG=1`.
- **Supply chain.** No runtime or development dependencies. CI actions are
  pinned to commit SHAs, run with read-only `contents` permission and without
  persisted credentials, and Dependabot proposes action updates.

## Residual risk

git reads the configuration of the repository it runs in. Running the status
line inside a repository whose `.git/config` was written by someone else
carries the same risk as running `git status` there yourself, which Claude
Code also does. Other executable git settings, such as `filter.*` drivers, are
not overridden. For untrusted checkouts, set `CLAUDE_HUD_DISABLE=git`.
