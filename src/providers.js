'use strict';
const { safePlace } = require('./core/locate');
// Editor integration that is not a command: the Problems panel marks of a scan and the read-only
// documents of the side-by-side preview. A mark names the category and the element path; it never
// holds the value.

const { CATEGORIES } = require('./core/run');

const PREVIEW_SCHEME = 'mask-atlas-preview';
const MAX_MARKS = 1000;

function createDiagnostics(app) {
  const vscode = app.vscode;
  const collection = vscode.languages.createDiagnosticCollection('Mask Atlas');
  const labels = {};
  for (const [key, label] of CATEGORIES) labels[key] = label;

  /**
   * Marks the hits of a scan in the document. A hit with a line number is marked on its line;
   * hits without one (JSON documents) are summarised in one mark per category at the top.
   */
  function show(document, hits) {
    const items = [];
    const perLine = hits.filter(function (h) { return typeof h.line === 'number' && h.line < document.lineCount; });
    const rest = hits.filter(function (h) { return !(typeof h.line === 'number' && h.line < document.lineCount); });
    const seen = new Set();
    for (const h of perLine) {
      const k = h.line + '|' + h.path + '|' + h.category;
      if (seen.has(k) || items.length >= MAX_MARKS) continue;
      seen.add(k);
      const line = document.lineAt(h.line);
      const d = new vscode.Diagnostic(line.range, (labels[h.category] || h.category) + ': ' + safePlace(h.path) + ' (possible identifier)', vscode.DiagnosticSeverity.Information);
      d.source = 'Mask Atlas';
      d.code = 'MA-' + h.category;
      items.push(d);
    }
    const summary = new Map();
    for (const h of rest) { const k = h.category + '|' + h.path; summary.set(k, (summary.get(k) || 0) + 1); }
    for (const [k, n] of summary) {
      if (items.length >= MAX_MARKS) break;
      const [category, path] = k.split('|');
      const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), (labels[category] || category) + ': ' + safePlace(path) + ' (' + n + (n === 1 ? ' field' : ' fields') + ', possible identifiers)', vscode.DiagnosticSeverity.Information);
      d.source = 'Mask Atlas';
      d.code = 'MA-' + category;
      items.push(d);
    }
    collection.set(document.uri, items);
    return items.length;
  }

  return {
    show: show,
    clear: function (uri) { if (uri) collection.delete(uri); else collection.clear(); },
    dispose: function () { collection.dispose(); }
  };
}

/** Serves the masked text of the side-by-side preview as read-only documents. */
function createPreviewProvider(app) {
  const vscode = app.vscode;
  const texts = new Map();
  const emitter = new vscode.EventEmitter();
  let counter = 0;
  const registration = vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
    onDidChange: emitter.event,
    provideTextDocumentContent: function (uri) { return texts.get(uri.toString()) || ''; }
  });
  return {
    add: function (name, text) {
      counter++;
      const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: '/' + counter + '/' + name });
      texts.set(uri.toString(), text);
      if (texts.size > 20) texts.delete(texts.keys().next().value);
      return uri;
    },
    dispose: function () { registration.dispose(); emitter.dispose(); texts.clear(); }
  };
}

module.exports = { createDiagnostics, createPreviewProvider, PREVIEW_SCHEME };
