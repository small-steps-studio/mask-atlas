'use strict';
// A small strict JSON reader and writer for FHIR resources.
//  - Numbers that JavaScript cannot represent exactly (long integers, trailing zeros, exponents)
//    are kept as their original text (JsonNumber), so untouched numbers are written back unchanged.
//  - Objects have no prototype, so a key such as "__proto__" is an ordinary key.
//  - Errors carry the position (offset, line, column) of the first problem and never the text.
// The writer reproduces the indentation of the input (compact, or pretty with the indentation of
// the first nested line), a trailing line break, and the escaping of the input strings is
// normalised (a character is written as itself unless JSON requires an escape).

class JsonNumber { constructor(raw) { this.raw = raw; } toString() { return this.raw; } }

class JsonError extends Error {
  constructor(message, offset, text) {
    super(message);
    this.offset = offset;
    let line = 1, col = 1;
    for (let i = 0; i < offset && i < text.length; i++) { if (text.charCodeAt(i) === 10) { line++; col = 1; } else col++; }
    this.line = line; this.column = col;
  }
}

const MAX_DEPTH = 200;

function parse(text) {
  let i = 0;
  const n = text.length;
  function fail(msg) { throw new JsonError(msg, i, text); }
  function ws() { while (i < n) { const c = text.charCodeAt(i); if (c === 32 || c === 10 || c === 13 || c === 9) i++; else break; } }

  function str() {
    const start = ++i;
    let simple = true;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) { const raw = text.slice(start, i); i++; return simple ? raw : decode(raw, start); }
      if (c === 92) { simple = false; i += 2; continue; }
      if (c < 32) fail('control character in string');
      i++;
    }
    fail('unterminated string');
  }
  function decode(raw, at) {
    try { return JSON.parse('"' + raw + '"'); } catch (e) { i = at; fail('bad escape in string'); }
  }
  function num() {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') i++;
    else if (text[i] >= '1' && text[i] <= '9') { while (text[i] >= '0' && text[i] <= '9') i++; } else fail('bad number');
    if (text[i] === '.') { i++; if (!(text[i] >= '0' && text[i] <= '9')) fail('bad number'); while (text[i] >= '0' && text[i] <= '9') i++; }
    if (text[i] === 'e' || text[i] === 'E') { i++; if (text[i] === '+' || text[i] === '-') i++; if (!(text[i] >= '0' && text[i] <= '9')) fail('bad number'); while (text[i] >= '0' && text[i] <= '9') i++; }
    const raw = text.slice(start, i);
    const v = Number(raw);
    const exact = String(v) === raw && (!Number.isInteger(v) || Number.isSafeInteger(v));
    return exact ? v : new JsonNumber(raw);
  }
  function value(depth) {
    if (depth > MAX_DEPTH) fail('nesting too deep');
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj = Object.create(null);
      ws();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const k = str();
        ws();
        if (text[i] !== ':') fail('expected a colon');
        i++;
        obj[k] = value(depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return obj; }
        fail('expected a comma or a closing brace');
      }
    }
    if (c === '[') {
      i++;
      const arr = [];
      ws();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return arr; }
        fail('expected a comma or a closing bracket');
      }
    }
    if (c === '"') return str();
    if (c === 't' && text.startsWith('true', i)) { i += 4; return true; }
    if (c === 'f' && text.startsWith('false', i)) { i += 5; return false; }
    if (c === 'n' && text.startsWith('null', i)) { i += 4; return null; }
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    fail('unexpected character');
  }
  ws();
  const result = value(0);
  ws();
  if (i < n) fail('unexpected text after the document');
  return result;
}

/** The indentation used by the text: '' for compact, else the whitespace before the first nested line. */
function detectIndent(text) {
  const m = /^[ \t\r\n]*[\[{][ \t]*\r?\n([ \t]+)\S/.exec(text);
  return m ? m[1] : '';
}

function quote(s) {
  return JSON.stringify(s).split(String.fromCharCode(0x2028)).join(String.fromCharCode(92) + "u2028").split(String.fromCharCode(0x2029)).join(String.fromCharCode(92) + "u2029");
}

function stringify(value, indent, eol) {
  const nl = eol || '\n';
  function write(v, level) {
    if (v === null) return 'null';
    if (typeof v === 'string') return quote(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof JsonNumber) return v.raw;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (!indent) return '[' + v.map(function (x) { return write(x, level + 1); }).join(',') + ']';
      const pad = indent.repeat(level + 1);
      return '[' + nl + v.map(function (x) { return pad + write(x, level + 1); }).join(',' + nl) + nl + indent.repeat(level) + ']';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    if (!indent) return '{' + keys.map(function (k) { return quote(k) + ':' + write(v[k], level + 1); }).join(',') + '}';
    const pad = indent.repeat(level + 1);
    return '{' + nl + keys.map(function (k) { return pad + quote(k) + ': ' + write(v[k], level + 1); }).join(',' + nl) + nl + indent.repeat(level) + '}';
  }
  return write(value, 0);
}

module.exports = { parse, stringify, detectIndent, JsonNumber, JsonError };
