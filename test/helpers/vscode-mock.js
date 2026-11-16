'use strict';
// A stand-in for the editor API, large enough to activate the extension and drive its commands
// and providers in unit tests. It records what the extension registers, shows and opens.
//
// Options of createMock:
//   files        { uri: text }                documents that are open in the editor
//   active       uri                          the document of the active editor
//   config       { key: value }               settings of the "maskAtlas" section (short keys)
//   configSources { key: 'user'|'workspace'|'workspace folder' }  where a setting comes from (what inspect() reports; default: user for a key in config)
//   trusted      false                        workspace.isTrusted is false
//   folders      [{ uri, name }]              workspace folders (uri objects need fsPath)
//   answers      [value...]                   answers for the message buttons, in order
//   answer       (kind, text, buttons) => v   decides the answer of a message instead of the queue
//   inputAnswers, quickPickAnswers            answers of the input box and the quick pick
//   openDialog, saveDialog                    values (or functions) returned by the file dialogs
//   cancelled    true                         the progress token reports a cancellation
//   cancelAfter  milliseconds                 the progress token reports a cancellation after this time
//   readOnly     true                         the active editor refuses edits
//   openExternalFails  true                   env.openExternal throws

const Module = require('node:module');
const nodePath = require('node:path');

class LineIndex {
  constructor(text) {
    this.text = text;
    this.starts = [0];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 13) { if (text.charCodeAt(i + 1) === 10) i++; this.starts.push(i + 1); } else if (c === 10) this.starts.push(i + 1);
    }
  }
  get lineCount() { return this.starts.length; }
  positionAt(offset) {
    const o = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= o) lo = mid; else hi = mid - 1; }
    return { line: lo, character: o - this.starts[lo] };
  }
  offsetAt(line, character) { return (this.starts[Math.min(line, this.starts.length - 1)] || 0) + character; }
  lineText(line) {
    const start = this.starts[line];
    const end = line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length;
    return this.text.slice(start, end).replace(/\r\n$|\r$|\n$/, '');
  }
}

class Uri {
  constructor(scheme, path, raw, fsPath) { this.scheme = scheme; this.path = path; this.raw = raw; this.fsPath = fsPath === undefined ? path : fsPath; }
  toString() { return this.raw; }
  static parse(text) { const m = /^([a-zA-Z][\w+.-]*):(.*)$/.exec(text); return new Uri(m ? m[1] : 'file', m ? m[2].replace(/^\/\//, '') : text, text); }
  static file(p) { return new Uri('file', p.replace(/\\/g, '/'), 'file:///' + p.replace(/\\/g, '/').replace(/^\//, ''), p); }
  static from(parts) { return new Uri(parts.scheme, parts.path || '', parts.scheme + '://' + (parts.path || '')); }
  static joinPath(base, name) { return Uri.parse(base.raw.replace(/\/$/, '') + '/' + name); }
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position || (a && typeof a === 'object')) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
  contains(r) { const le = (x, y) => x.line < y.line || (x.line === y.line && x.character <= y.character); return le(this.start, r.start) && le(r.end, this.end); }
}
class Selection extends Range {}
class EventEmitter {
  constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
  fire(v) { this.listeners.forEach((f) => f(v)); }
  dispose() {}
}

/** A document whose text can be replaced by an editor edit. */
function makeDocument(uriText, text, languageId, fsPath) {
  const doc = {
    uri: uriText && typeof uriText === 'object' ? uriText : Uri.parse(uriText), languageId: languageId || 'plaintext', version: 1, index: new LineIndex(text), text: text,
    getText: () => doc.text,
    positionAt: (o) => { const p = doc.index.positionAt(o); return new Position(p.line, p.character); },
    offsetAt: (p) => doc.index.offsetAt(p.line, p.character),
    lineAt: (n) => { const t = doc.index.lineText(n); return { text: t, lineNumber: n, range: new Range(n, 0, n, t.length) }; },
    setText: (next) => { doc.text = next; doc.index = new LineIndex(next); doc.version++; }
  };
  Object.defineProperty(doc, 'lineCount', { get: () => doc.index.lineCount });
  doc.fileName = fsPath || (doc.uri.fsPath || '');
  return doc;
}

function createMock(options) {
  const o = options || {};
  const disposable = { dispose() {} };
  const state = {
    commands: new Map(), executed: [], infoMessages: [], warningMessages: [], errorMessages: [], opened: [], openedDocs: [], shownDocs: [], clipboard: null,
    inputAnswers: (o.inputAnswers || []).slice(), quickPickAnswers: (o.quickPickAnswers || []).slice(), answers: (o.answers || []).slice(),
    inputBoxes: [], quickPicks: [], openDialogs: [], saveDialogs: [], progress: [],
    config: Object.assign({}, o.config || {}), configUpdates: [], documents: [], diagnostics: new Map(), providers: {}, contentProviders: new Map(),
    written: new Map(), files: new Map(Object.entries(o.files || {})), changeListeners: [], configListeners: [], trustListeners: [], outputLines: [], edits: 0
  };
  for (const [uri, text] of state.files) state.documents.push(makeDocument(uri, text));
  const find = (uri) => state.documents.find((d) => d.uri.toString() === uri);
  const editorFor = (doc) => ({
    document: doc, selection: new Selection(0, 0, 0, 0), revealRange() {},
    edit: async (cb) => {
      if (o.readOnly === true) return false;
      const edits = [];
      cb({ replace: (range, text) => edits.push({ range, text }) });
      for (const e of edits) {
        const from = doc.offsetAt(e.range.start), to = doc.offsetAt(e.range.end);
        doc.setText(doc.getText().slice(0, from) + e.text + doc.getText().slice(to));
      }
      state.edits++;
      return true;
    }
  });
  state.activeTextEditor = o.active ? editorFor(find(o.active)) : undefined;
  state.setActive = (uri) => { state.activeTextEditor = uri ? editorFor(find(uri)) : undefined; };
  state.addDocument = (uri, text, languageId, fsPath) => { const d = makeDocument(uri, text, languageId, fsPath); state.documents.push(d); return d; };

  const pick = (kind, text, rest) => {
    const buttons = rest.filter((x) => typeof x === 'string');
    if (typeof o.answer === 'function') return o.answer(kind, text, buttons);
    return state.answers.shift();
  };
  const dialog = (value, list, args) => { list.push(args); return typeof value === 'function' ? value(...args) : value; };

  const vscode = {
    Uri: Uri, Position: Position, Range: Range, Selection: Selection, EventEmitter: EventEmitter,
    Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    ProgressLocation: { Notification: 15 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    version: '1.99.0',
    env: {
      appName: 'Visual Studio Code',
      clipboard: { writeText: async (t) => { state.clipboard = t; } },
      openExternal: async (uri) => { if (o.openExternalFails === true) throw new Error('no browser'); state.opened.push(uri.toString()); return true; }
    },
    extensions: { getExtension: () => undefined },
    commands: {
      registerCommand: (id, fn) => { state.commands.set(id, fn); return disposable; },
      executeCommand: async (id, ...args) => { state.executed.push({ id, args }); const fn = state.commands.get(id); if (!fn) return undefined; return fn(...args); }
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, d) => state.diagnostics.set(uri.toString(), d), delete: (uri) => state.diagnostics.delete(uri.toString()), clear: () => state.diagnostics.clear(), dispose() {}
      })
    },
    window: {
      get activeTextEditor() { return state.activeTextEditor; },
      get visibleTextEditors() { return state.activeTextEditor ? [state.activeTextEditor] : []; },
      showInformationMessage: async (text, ...rest) => { state.infoMessages.push({ text, buttons: rest.filter((x) => typeof x === 'string') }); return pick('info', text, rest); },
      showWarningMessage: async (text, ...rest) => { state.warningMessages.push({ text, buttons: rest.filter((x) => typeof x === 'string'), rest }); return pick('warning', text, rest); },
      showErrorMessage: async (text, ...rest) => { state.errorMessages.push({ text, buttons: rest.filter((x) => typeof x === 'string') }); return pick('error', text, rest); },
      showInputBox: async (opts) => {
        state.inputBoxes.push(opts);
        const a = state.inputAnswers.shift();
        if (opts && opts.validateInput && a !== undefined) { state.lastValidation = opts.validateInput(a); }
        return a;
      },
      showQuickPick: async (items, opts) => {
        const want = state.quickPickAnswers.shift();
        const list = await items;
        state.quickPicks.push({ items: list, opts });
        if (want === undefined) return undefined;
        return typeof want === 'function' ? list.find(want) : list[want];
      },
      showOpenDialog: async (opts) => dialog(o.openDialog, state.openDialogs, [opts]),
      showSaveDialog: async (opts) => dialog(o.saveDialog, state.saveDialogs, [opts]),
      showTextDocument: async (doc, opts) => { state.shownDocs.push({ doc, opts }); state.activeTextEditor = editorFor(doc); return state.activeTextEditor; },
      createOutputChannel: () => ({ appendLine: (t) => state.outputLines.push(t), dispose() {} }),
      withProgress: async (opts, fn) => {
        state.progress.push(opts);
        const listeners = [];
        const token = { isCancellationRequested: o.cancelled === true, onCancellationRequested: (cb) => { listeners.push(cb); return { dispose() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } }; } };
        let timer = null;
        if (typeof o.cancelAfter === 'number') timer = setTimeout(() => { token.isCancellationRequested = true; listeners.slice().forEach((cb) => cb()); }, o.cancelAfter);
        const reports = [];
        state.progressReports = reports;
        try { return await fn({ report(v) { reports.push(v); } }, token); } finally { if (timer) clearTimeout(timer); }
      }
    },
    workspace: {
      get workspaceFolders() { return o.folders || undefined; },
      get textDocuments() { return state.documents; },
      get isTrusted() { return o.trusted !== false; },
      onDidGrantWorkspaceTrust: (fn) => { state.trustListeners.push(fn); return disposable; },
      getConfiguration: () => ({
        get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
        inspect: (key) => {
          if (!(key in state.config)) return { key: 'maskAtlas.' + key };
          const source = (o.configSources || {})[key] || 'user';
          const value = state.config[key];
          return source === 'workspace folder' ? { key: 'maskAtlas.' + key, workspaceFolderValue: value } : source === 'workspace' ? { key: 'maskAtlas.' + key, workspaceValue: value } : { key: 'maskAtlas.' + key, globalValue: value };
        },
        update: async (key, value, target) => { state.configUpdates.push({ key, value, target }); state.config[key] = value; }
      }),
      onDidChangeConfiguration: (fn) => { state.configListeners.push(fn); return disposable; },
      onDidChangeTextDocument: (fn) => { state.changeListeners.push(fn); return disposable; },
      registerTextDocumentContentProvider: (scheme, provider) => { state.contentProviders.set(scheme, provider); return disposable; },
      openTextDocument: async (arg) => {
        if (arg && arg.content !== undefined) {
          const d = makeDocument('untitled:Untitled-' + (state.openedDocs.length + 1), arg.content, arg.language);
          state.openedDocs.push(d);
          return d;
        }
        const key = arg.toString();
        const have = find(key);
        if (have) return have;
        const fs = require('node:fs');
        const text = state.written.get(key) || state.files.get(key) || (arg.fsPath && fs.existsSync(arg.fsPath) ? fs.readFileSync(arg.fsPath, 'utf8') : '');
        const d = makeDocument(arg, text, 'plaintext', arg.fsPath);
        state.documents.push(d);
        return d;
      },
      fs: {
        writeFile: async (uri, data) => { state.written.set(uri.toString(), Buffer.from(data).toString('utf8')); }
      }
    }
  };
  /** Pretends that the user edited a document (stale marks must go). */
  state.fireTextChange = (doc) => state.changeListeners.forEach((f) => f({ document: doc, contentChanges: [{ text: 'x' }] }));
  state.fireConfigChange = (section) => state.configListeners.forEach((f) => f({ affectsConfiguration: (s) => !section || s === section || section.startsWith(s) }));
  /** The text a registered content provider serves for a uri (the preview documents). */
  state.contentOf = async (uri) => { const p = state.contentProviders.get(uri.scheme); return p ? p.provideTextDocumentContent(uri) : undefined; };
  return { vscode: vscode, state: state };
}

function install(mock) {
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'vscode') return mock;
    return original.apply(this, arguments);
  };
  return function uninstall() { Module._load = original; };
}

function makeContext(pkg, extensionMode) {
  const secrets = new Map();
  const global = new Map();
  return {
    subscriptions: [],
    extensionMode: extensionMode || 1,
    extension: { packageJSON: pkg },
    secretsMap: secrets, globalMap: global,
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { if (v === undefined) global.delete(k); else global.set(k, v); } }
  };
}

/**
 * Loads a fresh copy of the extension (the source modules are forgotten first, so that every
 * activation sees the mock that is installed at that moment) and activates it.
 */
function startExtension(root, pkg, mock, extensionMode, prepare) {
  const uninstall = install(mock.vscode);
  const srcDir = nodePath.join(root, 'src');
  for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
  const ext = require(nodePath.join(root, 'src', 'extension'));
  const context = makeContext(pkg, extensionMode);
  if (prepare) prepare(context);
  ext.activate(context);
  const stop = function () {
    uninstall();
    for (const d of context.subscriptions) { try { if (d && typeof d.dispose === 'function') d.dispose(); } catch (e) { /* stopping */ } }
  };
  return { ext: ext, context: context, uninstall: stop, state: mock.state, mock: mock, run: (id, ...a) => mock.vscode.commands.executeCommand(id, ...a) };
}

module.exports = { createMock: createMock, install: install, makeContext: makeContext, startExtension: startExtension, Uri: Uri, makeDocument: makeDocument, LineIndex: LineIndex };
