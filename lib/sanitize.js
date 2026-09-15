'use strict';

// Every string printed to the terminal passes through here. Payload fields such
// as the session name, output style, repo owner or PR URL are not trusted: an
// embedded ESC/BEL/CSI could otherwise rewrite the terminal title, fake output,
// or smuggle a hyperlink, and bidi controls could visually reorder text.

const { truncateWidth } = require('./width');

// C0 + DEL + C1 controls, the Arabic letter mark, zero-width space/non-joiner
// and directional marks, line/paragraph separators, bidi embeddings/overrides/
// isolates, word joiner, and BOM. ZWJ (U+200D) is kept for emoji sequences.
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const URL_FORBIDDEN = /[\u0000-\u0020\u007f-\u009f]/;
const MAX_URL_LENGTH = 2048;

/**
 * Printable single-line text: control characters become spaces, whitespace
 * runs collapse, and the result is cut to `maxWidth` columns when given.
 */
function cleanText(value, maxWidth) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value).replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
  if (maxWidth) text = truncateWidth(text, maxWidth);
  return text;
}

/**
 * A URL safe to place inside an OSC 8 hyperlink: http(s) only, no embedded
 * credentials, no whitespace or control bytes. Returns the normalized href or null.
 */
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  if (URL_FORBIDDEN.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return URL_FORBIDDEN.test(url.href) ? null : url.href;
}

module.exports = { cleanText, safeUrl };
