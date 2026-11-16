'use strict';
// The reports (Markdown) and the exports. A report holds counts, element paths, shapes (letters as
// X and digits as 9) and file names; it never holds a value from a message. No editor API here.

const { CATEGORIES } = require('./core/run');
const { LIMITS, CHECK_NAMES } = require('./core/verify');
const { mdEscape, csvRow, plural, numberText } = require('./util');
const { safePlace } = require('./core/locate');

const LF = String.fromCharCode(10);
const HELPER_NOTE = 'Mask Atlas is a helper, not a guarantee. It lowers the risk that a message identifies a person, but you remain responsible for reading the result before it leaves your hands. ' +
  'This report is not legal advice and not a certificate of any kind.';

function categoryTable(stats, withChanged) {
  const lines = ['| Category | Fields |', '| --- | ---: |'];
  let total = 0;
  for (const [key, label] of CATEGORIES) {
    const n = stats.byCategory.get(key) || 0;
    total += n;
    if (n) lines.push('| ' + label + ' | ' + numberText(n) + ' |');
  }
  if (!total) lines.push('| (none found) | 0 |');
  return { text: lines.join('\n'), total: total };
}

function pathTable(stats, limit) {
  const rows = Array.from(stats.byPath.values()).sort(function (a, b) { return b.count - a.count || (a.path < b.path ? -1 : 1); });
  const label = {};
  for (const [k, v] of CATEGORIES) label[k] = v;
  const lines = ['| Element path | Category | Fields | Shape of the first value |', '| --- | --- | ---: | --- |'];
  for (const r of rows.slice(0, limit || 40)) lines.push('| `' + safePlace(r.path) + '` | ' + (label[r.category] || r.category) + ' | ' + numberText(r.count) + ' | `' + r.shape.replace(/`/g, "'") + '` |');
  if (rows.length > (limit || 40)) lines.push('| ... ' + (rows.length - (limit || 40)) + ' more paths | | | |');
  return lines.join('\n');
}

/** The identifier risk report of the free tier. */
function riskReportMarkdown(info) {
  const stats = info.stats;
  const cat = categoryTable(stats);
  const out = [];
  out.push('# Mask Atlas: identifier risk report');
  out.push('');
  out.push('Format: ' + info.formatName + ' (' + plural(info.units, 'message or document', 'messages or documents') + ').');
  out.push('');
  out.push('**' + numberText(cat.total) + ' fields** in the categories below hold values that can point to a person. The report shows where they are and what shape they have; it never shows the values.');
  out.push('');
  out.push(cat.text);
  out.push('');
  if (cat.total) { out.push('## Where they are'); out.push(''); out.push(pathTable(stats)); out.push(''); }
  if (info.settingsRows && info.settingsRows.length) { out.push(settingsSection({ settingsRows: info.settingsRows, stats: stats })); }
  out.push('## What this scan does not look at');
  out.push('');
  if (info.freeTextChecked) out.push('* Free text was scanned for names and numbers seen elsewhere in the message and for e-mail addresses, telephone numbers, SSN-like numbers, IP addresses and dates.');
  else if (info.freeTextOff) out.push('* ' + plural(stats.freeTextFields, 'free-text field') + ' (notes, comments, narrative text) were found and NOT read, because the setting maskAtlas.scanFreeText is off.');
  else out.push('* ' + plural(stats.freeTextFields, 'free-text field') + ' (notes, comments, narrative text) were found and not read. The free tier only checks the fields of the built-in profile; Pro scans free text too.');
  out.push('* Names and numbers that sit in a field the profile does not know, were not seen elsewhere in the message and have no recognisable shape.');
  out.push('* Text inside pictures, scanned documents and encoded attachments.');
  out.push('');
  out.push(HELPER_NOTE);
  out.push('');
  return out.join('\n');
}

function statusLabel(s) {
  return s === 'written' ? 'de-identified copy written' : s === 'unchanged' ? 'unchanged: nothing recognised, NOT written' : s === 'skipped' ? 'skipped: format not recognised' : 'error';
}

/** The report of a Pro run (one message, a selection of files or a folder). */
function runReportMarkdown(info) {
  const stats = info.stats;
  const cat = categoryTable(stats);
  const files = info.files || [];
  const written = files.filter(function (f) { return f.status === 'written'; });
  const unchanged = files.filter(function (f) { return f.status === 'unchanged'; });
  const skipped = files.filter(function (f) { return f.status === 'skipped'; });
  const errors = files.filter(function (f) { return f.status === 'error'; });
  const out = [];
  out.push('# Mask Atlas: de-identification report');
  out.push('');
  out.push(info.title);
  out.push('');
  out.push('| | |');
  out.push('| --- | --- |');
  out.push('| Fields replaced | ' + numberText(stats.total) + ' |');
  if (files.length) {
    out.push('| Files read | ' + numberText(files.length) + ' |');
    out.push('| Files written | ' + numberText(written.length) + ' |');
    out.push('| Files left unchanged and not written | ' + numberText(unchanged.length) + ' |');
    out.push('| Files skipped (format not recognised) | ' + numberText(skipped.length) + ' |');
    out.push('| Files with errors | ' + numberText(errors.length) + ' |');
  }
  out.push('| Messages or documents processed | ' + numberText(stats.units) + ' |');
  if (info.freeTextOff) out.push('| Free-text fields | ' + numberText(stats.freeTextFields) + ' found and NOT read (the setting maskAtlas.scanFreeText is off) |');
  else out.push('| Free-text fields read | ' + numberText(stats.freeTextRead || 0) + ' of ' + numberText(stats.freeTextFields) + ' (' + numberText(stats.freeTextHits) + ' values found in them) |');
  if (stats.keptByRule) out.push('| Fields kept by your rules | ' + numberText(stats.keptByRule) + ' |');
  out.push('| Key | ' + info.keyNote + ' |');
  out.push('| Dates | ' + info.dateNote + ' |');
  out.push('| Envelope and routing identifiers | ' + (info.keepEnvelope ? 'kept as they are (setting)' : 'replaced') + ' |');
  out.push('| Organisation names | ' + (info.maskOrganisations ? 'replaced' : 'kept (setting)') + ' |');
  if (info.rulesNote) out.push('| Rule file | ' + info.rulesNote + ' |');
  out.push('');
  out.push(settingsSection(info));
  const warnings = [];
  if (info.weakening && info.weakening.length) warnings.push('**This run was weakened by settings or rules: ' + weakeningLine(info) + '.** Places that these leave as they are are not replaced and the verification does not count them.');
  if (unchanged.length) warnings.push('**' + plural(unchanged.length, 'file') + ' had no recognised identifier and ' + (unchanged.length === 1 ? 'was' : 'were') + ' NOT written.** A file that is not in the target folder was not de-identified; look at it yourself or add a rule.');
  if (errors.length) warnings.push('**' + plural(errors.length, 'file') + ' could not be processed** (see the table). Nothing was written for ' + (errors.length === 1 ? 'it' : 'them') + '.');
  if (info.fileNameWarnings && info.fileNameWarnings.length) warnings.push('**' + plural(info.fileNameWarnings.length, 'file name') + ' may contain a value that was replaced inside the files** (file names are not changed): ' + info.fileNameWarnings.map(function (n) { return '`' + n.replace(/`/g, "'") + '`'; }).join(', ') + '.');
  if (info.truncated) warnings.push('The folder holds more files than the limit of ' + numberText(info.maxFiles) + '; the rest were not read.');
  if (info.mapIncomplete) warnings.push('The run replaced more distinct values than the pseudonym map can hold; the map export and the verification are incomplete.');
  if (warnings.length) { out.push('## Warnings'); out.push(''); for (const w of warnings) out.push('* ' + w); out.push(''); }
  out.push('## Replaced fields by category');
  out.push('');
  out.push(cat.text);
  out.push('');
  if (cat.total) { out.push('## Replaced fields by element path'); out.push(''); out.push(pathTable(stats, 60)); out.push(''); }
  if (info.verification) out.push(verificationSection(info.verification));
  if (files.length) {
    out.push('## Files');
    out.push('');
    out.push('| File | Format | Result | Fields replaced |');
    out.push('| --- | --- | --- | ---: |');
    for (const f of files.slice(0, 2000)) out.push('| ' + mdEscape(f.file) + ' | ' + (f.format || '') + ' | ' + statusLabel(f.status) + (f.message ? ' (' + mdEscape(f.message) + ')' : '') + ' | ' + (f.changed === undefined ? '' : numberText(f.changed)) + ' |');
    if (files.length > 2000) out.push('| ... ' + (files.length - 2000) + ' more files | | | |');
    out.push('');
  }
  out.push('## Limits');
  out.push('');
  for (const l of LIMITS) out.push('* ' + l);
  out.push('');
  out.push(HELPER_NOTE);
  out.push('');
  return out.join('\n');
}

function weakeningLine(info) {
  return info.weakening.map(function (r) { return r.effect + ' (' + (r.sourceText || r.source + ': ' + r.setting) + ')'; }).join('; ') + (info.stats && info.stats.keptByRule ? '; ' + plural(info.stats.keptByRule, 'field') + ' kept by your rules' : '');
}

/** The settings and rules that differ from the defaults and where each comes from. */
function settingsSection(info) {
  const out = [];
  out.push('## Settings and rules that differ from the defaults');
  out.push('');
  const rows = info.settingsRows || [];
  if (!rows.length) { out.push('None: every setting is at its default and no rule file is in use.'); out.push(''); return out.join(LF); }
  out.push('| Setting | Value | Set in | Effect |');
  out.push('| --- | --- | --- | --- |');
  for (const r of rows) out.push('| `' + r.setting + '` | ' + mdEscape(r.value) + ' | ' + (r.sourceText ? r.sourceText.replace(/: maskAtlas\.rulesFile$/, '') : r.source) + ' | ' + r.effect + (r.weakens ? (r.exportOnly ? ' (weakens the export of the map, not the run)' : ' (weakens the run)') : '') + ' |');
  if (info.stats && info.stats.keptPaths && info.stats.keptPaths.size) {
    out.push('');
    out.push('Places kept by your rules (element paths and counts):');
    out.push('');
    for (const [p, n] of Array.from(info.stats.keptPaths).slice(0, 30)) out.push('* `' + safePlace(p) + '`: ' + numberText(n));
  }
  out.push('');
  return out.join(LF);
}

/** "PASS", "FAIL" or "PASS, with weakened settings": a pass does not stand alone when settings or rules left places as they are. */
function verificationLabel(v) {
  if (!v.pass) return 'FAIL';
  return v.weakText ? 'PASS, with weakened settings' : 'PASS';
}

function verificationSection(v) {
  const out = [];
  out.push('## Verification of the output');
  out.push('');
  out.push('The output was read again from ' + (v.fromDisk ? 'disk' : 'the new editor') + ' and compared with this run.');
  out.push('');
  out.push('**Result: ' + verificationLabel(v) + '** (' + plural(v.files, 'file') + ' checked' + (v.failedFiles ? ', ' + v.failedFiles + ' with findings' : '') + ').');
  if (v.pass && v.weakText) {
    out.push('');
    out.push('The pass counts only what the run replaced. Settings or rules left places as they are: ' + v.weakText + '. These are not counted as findings.');
  }
  out.push('');
  out.push('| Check | Findings |');
  out.push('| --- | ---: |');
  out.push('| A replaced value (name, number, address, ...) is still in the output | ' + numberText(v.originalValues) + ' |');
  out.push('| An e-mail address, SSN-like number, telephone number or IP address that this run did not create | ' + numberText(v.patterns) + ' |');
  out.push('| A field of the profile holds a value that this run did not create | ' + numberText(v.fields) + ' |');
  out.push('');
  if (v.keptByDesign) out.push('Not counted: ' + numberText(v.keptByDesign) + ' places of X12 interchanges (control numbers, counts and version numbers of the standard), which the run keeps on purpose.\n');
  if (v.incomplete) out.push('The check is incomplete because the run replaced more distinct values than are kept for it.\n');
  if (v.locations && v.locations.length) {
    out.push('Where the findings are (places only; a report never shows a value):');
    out.push('');
    out.push('| File | Message or interchange | Element | Kind | Check | Findings |');
    out.push('| --- | ---: | --- | --- | --- | ---: |');
    for (const r of v.locations.slice(0, 40)) {
      out.push('| ' + mdEscape(r.file || '(the active document)') + ' | ' + (r.unit ? numberText(r.unit) : '') + ' | `' + safePlace(r.path) + '`' + (r.line ? ' (line ' + numberText(r.line) + ')' : '') + ' | ' + r.kind + ' | ' + (CHECK_NAMES[r.check] || r.check) + ' | ' + numberText(r.count) + ' |');
    }
    if (v.locations.length > 40 || v.locationsCut) out.push('| ... further places are not listed | | | | | |');
    out.push('');
  } else if (v.paths && v.paths.length) {
    out.push('| Element path | Category | Findings |');
    out.push('| --- | --- | ---: |');
    for (const r of v.paths.slice(0, 30)) out.push('| `' + safePlace(r.path) + '` | ' + r.category + ' | ' + numberText(r.count) + ' |');
    out.push('');
  }
  out.push(v.pass
    ? 'A pass means these three checks found nothing. It does not prove the output is free of identifiers; see the limits below.'
    : 'Open the places above in the output files and fix the cause (a rule file can add or change paths), then run again.');
  out.push('');
  return out.join(LF);
}

/** CSV of the pseudonym map (explicit export). */
function mapCsv(rows, neutralise) {
  let out = csvRow(['category', 'original', 'replacement'], false);
  for (const r of rows) out += csvRow([r.category, r.original, r.replacement], neutralise);
  return out;
}

module.exports = { riskReportMarkdown, runReportMarkdown, verificationSection, verificationLabel, mapCsv, HELPER_NOTE };
