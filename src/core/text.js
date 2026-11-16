'use strict';
// Small text helpers shared by the format readers: the byte order mark, and placeholders (single
// characters of the Unicode private use area) that stand in for markup or escape sequences while
// a scanner looks at the plain words around them.

const BOM = String.fromCharCode(0xFEFF);
const PUA_FIRST = 0xE000;
const PUA_LAST = 0xF7FF;
const MAX_PLACEHOLDERS = 6000;
const PUA_RE = new RegExp('[' + String.fromCharCode(PUA_FIRST) + '-' + String.fromCharCode(PUA_LAST) + ']', 'g');
const LEADING_BLANKS = new RegExp('^[' + BOM + String.fromCharCode(0x0b) + '\\s]+');

function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

/** A list that hands out placeholders for saved strings and puts them back. */
function placeholders() {
  const saved = [];
  return {
    add: function (original) {
      if (saved.length >= MAX_PLACEHOLDERS) return original;
      saved.push(original);
      return String.fromCharCode(PUA_FIRST + saved.length - 1);
    },
    restore: function (text) {
      return text.replace(PUA_RE, function (c) { const m = saved[c.charCodeAt(0) - PUA_FIRST]; return m === undefined ? c : m; });
    }
  };
}

module.exports = { BOM, PUA_RE, LEADING_BLANKS, stripBom, placeholders };
