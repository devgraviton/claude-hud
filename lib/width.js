'use strict';

// Terminal display-width measurement. The status line packs segments into rows
// by visible columns, so escape sequences count as zero and East Asian wide
// characters (CJK, Hangul, most emoji) count as two.

// SGR colour codes and OSC 8 hyperlink envelopes (terminated by BEL or ST).
const ANSI = /\u001b\[[0-9;]*m|\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

function stripAnsi(str) {
  return String(str).replace(ANSI, '');
}

function isZeroWidth(cp) {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space/joiners, marks
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
  );
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function charWidth(ch) {
  const cp = ch.codePointAt(0);
  return isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1;
}

function stringWidth(str) {
  let width = 0;
  for (const ch of stripAnsi(str)) width += charWidth(ch);
  return width;
}

/** Cut plain text to at most `max` columns, ending with "…" when shortened. */
function truncateWidth(str, max) {
  const text = String(str);
  if (stringWidth(text) <= max) return text;
  let out = '';
  let width = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (width + w > max - 1) break;
    out += ch;
    width += w;
  }
  return out + '…';
}

module.exports = { stringWidth, stripAnsi, truncateWidth };
