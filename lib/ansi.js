'use strict';

// 256-colour SGR codes for each segment role.
const PALETTE = Object.freeze({
  model: '1;38;5;80', // bold cyan
  dim: '38;5;244', // gray
  green: '38;5;114',
  yellow: '38;5;179',
  red: '38;5;203',
  cost: '38;5;179',
  git: '38;5;176',
  project: '1;38;5;215', // bold orange
});

/**
 * Colour and hyperlink writers. With colour off both return plain text, so the
 * output carries no escape bytes at all. `link` expects a URL that already went
 * through `sanitize.safeUrl`.
 */
function createPainter(enabled) {
  const paint = (code, text) =>
    enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text);
  const link = (text, url) =>
    enabled && url
      ? `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`
      : String(text);
  return { paint, link };
}

module.exports = { PALETTE, createPainter };
