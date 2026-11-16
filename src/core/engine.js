'use strict';
// Entry points of the engine: recognise the format of a text, process it unit by unit with a run,
// and report what happened. No editor API, no file access (see ../pro/files.js for files).

const hl7 = require('../formats/hl7');
const x12 = require('../formats/x12');
const fhir = require('../formats/fhir');

const FORMAT_NAMES = { hl7: 'HL7 v2', x12: 'X12', fhir: 'FHIR JSON', ndjson: 'FHIR NDJSON' };

function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

/** 'hl7' | 'x12' | 'fhir' | 'ndjson' | null for a text that is none of them. */
function detectFormat(text) {
  if (typeof text !== 'string') return null;
  const head = stripBom(text.slice(0, 4096)).replace(/^[\s\x0b]+/, '');
  if (!head) return null;
  if (hl7.detect(head)) return 'hl7';
  if (x12.detect(head)) return 'x12';
  if (head[0] === '{' || head[0] === '[') return fhir.detect(text);
  if (hl7.looksLikeSegments(text.slice(0, 4096))) return 'hl7';
  return null;
}

/**
 * Processes a whole text. Returns { ok, format, text, changed, units } or { ok: false, reason, message }.
 * `options.scanOnly` counts the identifiers without changing anything.
 */
function processText(text, run, options) {
  const o = options || {};
  const format = o.format || detectFormat(text);
  if (!format) return { ok: false, reason: 'not-recognised', message: 'The text is not recognised as an HL7 v2 message, a FHIR JSON resource or bundle, or an X12 interchange.' };
  let result;
  try {
    if (format === 'hl7') result = processHl7(text, run, o);
    else if (format === 'x12') result = processX12(text, run, o);
    else result = fhir.processText(text, run, o, format);
  } catch (err) {
    return { ok: false, reason: 'error', format: format, message: 'The ' + FORMAT_NAMES[format] + ' text could not be processed: ' + (err && err.message ? err.message : 'unexpected problem') + '.' };
  }
  if (result.ok === false) return Object.assign({ format: format }, result);
  return Object.assign({ ok: true, format: format }, result);
}

function breaks(text) { const m = text.match(/\r\n|\r|\n/g); return m ? m.length : 0; }

function processHl7(text, run, o) {
  const units = hl7.splitUnits(text);
  let out = '';
  let changed = 0, count = 0, line = 0;
  for (const u of units) {
    const base = line;
    line += breaks(u.text);
    if (u.kind === 'other' || u.kind === 'trailer') { out += u.text; continue; }
    const r = hl7.processUnit(u.text, run, Object.assign({}, o, { lineBase: base }));
    out += r.text; changed += r.changed; count++;
  }
  return { text: o.scanOnly ? text : out, changed: changed, units: count };
}

function processX12(text, run, o) {
  const units = x12.splitUnits(text);
  let out = '';
  let changed = 0, count = 0, line = 0;
  for (const u of units) {
    const base = line;
    line += breaks(u.text);
    if (u.kind !== 'interchange') { out += u.text; continue; }
    const r = x12.processUnit(u.text, run, Object.assign({}, o, { lineBase: base }));
    out += r.text; changed += r.changed; count++;
  }
  return { text: o.scanOnly ? text : out, changed: changed, units: count };
}

module.exports = { detectFormat, processText, FORMAT_NAMES, hl7, x12, fhir };
