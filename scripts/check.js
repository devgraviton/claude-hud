'use strict';

// Repository self-check (no dependencies): every JavaScript file parses, the
// JSON manifests parse, and the version is consistent across package.json,
// the plugin manifest, the marketplace entry and CHANGELOG.md.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const failures = [];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage']);

function javascriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  } catch (err) {
    failures.push(`${relative}: ${err.message}`);
    return null;
  }
}

const sources = javascriptFiles(root);
for (const file of sources) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push(`${path.relative(root, file)}: ${String(err.stderr || err.message).trim()}`);
  }
}

const pkg = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

if (pkg && plugin) {
  if (plugin.name !== pkg.name) failures.push('plugin.json name differs from package.json');
  if (plugin.version !== pkg.version) {
    failures.push(`plugin.json version ${plugin.version} != package.json ${pkg.version}`);
  }
}
if (plugin && marketplace) {
  const entry = (marketplace.plugins || []).find((p) => p && p.name === plugin.name);
  if (!entry) failures.push(`marketplace.json has no entry named ${plugin.name}`);
  else if (entry.version && entry.version !== plugin.version) {
    failures.push(`marketplace.json entry version ${entry.version} != ${plugin.version}`);
  }
}
if (pkg) {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`## [${pkg.version}]`)) {
    failures.push(`CHANGELOG.md has no "## [${pkg.version}]" section`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error('check failed: ' + failure);
  process.exitCode = 1;
} else {
  console.log(`check passed: ${sources.length} JavaScript files, manifests v${pkg.version}`);
}
