'use strict';

// The signed-in account email, shown only with CLAUDE_HUD_SHOW_EMAIL=1. It is
// read from Claude Code's local config on each render and never written anywhere.

const fs = require('node:fs');
const path = require('node:path');

const MAX_CONFIG_BYTES = 32 * 1024 * 1024;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}$/;

function configCandidates(env, homedir) {
  const files = [];
  if (env.CLAUDE_CONFIG_DIR) files.push(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'));
  if (homedir) files.push(path.join(homedir, '.claude.json'));
  return files;
}

function readAccountEmail({ env, homedir }) {
  for (const file of configCandidates(env, homedir)) {
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_CONFIG_BYTES) continue;
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      const email = config && config.oauthAccount && config.oauthAccount.emailAddress;
      if (typeof email === 'string' && EMAIL.test(email)) return email;
    } catch {
      // missing or unreadable config: try the next location
    }
  }
  return null;
}

module.exports = { readAccountEmail };
