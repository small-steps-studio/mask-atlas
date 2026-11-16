'use strict';
// Small helpers without editor dependencies: escaping for the export formats and text utilities.

/**
 * One CSV cell. A cell that starts with = + - @, a tab or a carriage return gets a leading
 * apostrophe (a spreadsheet then shows text instead of running a formula) unless `neutralise` is
 * false; quoting follows RFC 4180.
 */
function csvCell(value, neutralise) {
  let s = value === undefined || value === null ? '' : String(value);
  if (neutralise !== false && /^[=+\-@\t\r]/.test(s)) s = '\'' + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRow(cells, neutralise) { return cells.map(function (c) { return csvCell(c, neutralise); }).join(',') + '\r\n'; }

/** Escapes text for a Markdown table cell or a line of text. */
function mdEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\\`*_{}\[\]<>|#]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function baseName(p) { return String(p).split(/[\\/]/).pop(); }

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

function numberText(n) { return Number(n).toLocaleString('en-US'); }

module.exports = { csvCell, csvRow, mdEscape, baseName, plural, numberText };
