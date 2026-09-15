#!/usr/bin/env node
'use strict';

// claude-hud — a heads-up display status line for Claude Code.
// Claude Code pipes a JSON payload to stdin on each update; see README.md.

require('../lib/cli').main();
