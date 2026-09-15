'use strict';

const { PALETTE } = require('./ansi');
const { stringWidth, stripAnsi, truncateWidth } = require('./width');

/** Pack one group's segments into rows no wider than `width` columns. */
function wrapRows(segments, width, separator) {
  const sepWidth = stringWidth(separator);
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const original of segments) {
    let segment = original;
    let w = stringWidth(segment);
    if (w > width) {
      // A single segment wider than the row: drop its styling and cut it.
      segment = truncateWidth(stripAnsi(segment), width);
      w = stringWidth(segment);
    }
    const added = row.length ? w + sepWidth : w;
    if (row.length && rowWidth + added > width) {
      rows.push(row.join(separator));
      row = [segment];
      rowWidth = w;
    } else {
      row.push(segment);
      rowWidth += added;
    }
  }
  if (row.length) rows.push(row.join(separator));
  return rows;
}

/** Render each non-empty group as its own block of wrapped rows. */
function layout(groups, width, paint) {
  const separator = ' ' + paint(PALETTE.dim, '|') + ' ';
  const lines = [];
  for (const group of groups) {
    if (group.length) lines.push(...wrapRows(group, width, separator));
  }
  return lines.join('\n');
}

module.exports = { layout, wrapRows };
