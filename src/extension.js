'use strict';
// Mask Atlas entry point. Builds the shared `app` object and installs every part of the extension;
// a failure in one part does not take the others down.

const vscode = require('vscode');
const os = require('node:os');
const { createLicence } = require('./licence/licence');
const { createDiagnostics, createPreviewProvider } = require('./providers');
const { registerCommands } = require('./commands');
const { createClient } = require('./worker/client');
const settingsModule = require('./settings');

const LAST_RUN_MINUTES = 60;
const SEED_SECRET = 'maskAtlas.seed';
// the settings whose source is reported (short key -> configuration key)
const SOURCE_KEYS = ['keepEnvelopeIdentifiers', 'maskOrganisations', 'shiftDates', 'dateOrder', 'scanFreeText', 'rulesFile', 'export.neutraliseFormulas'];

function numberSetting(value, fallback, min, max) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function activate(context) {
  let output = null;
  function log(text) {
    if (!output) output = vscode.window.createOutputChannel('Mask Atlas');
    output.appendLine(text);
  }

  let settingsCache = null;
  let sourcesCache = null;
  function getSettings() {
    if (settingsCache) return settingsCache;
    const c = vscode.workspace.getConfiguration('maskAtlas');
    settingsCache = {
      maxFileSizeMB: numberSetting(c.get('maxFileSizeMB', 20), 20, 0.1, 64),
      keepEnvelopeIdentifiers: c.get('keepEnvelopeIdentifiers', false) === true,
      maskOrganisations: c.get('maskOrganisations', true) !== false,
      shiftDates: c.get('shiftDates', true) !== false,
      dateOrder: c.get('dateOrder', 'mdy') === 'dmy' ? 'dmy' : 'mdy',
      scanFreeText: c.get('scanFreeText', true) !== false,
      rulesFile: String(c.get('rulesFile', '') || ''),
      markInProblems: c.get('markInProblems', true) !== false,
      neutraliseFormulas: c.get('export.neutraliseFormulas', true) !== false
    };
    return settingsCache;
  }

  /** Where each setting that matters for a run comes from: user, workspace, workspace folder or default. */
  function getSettingSources() {
    if (sourcesCache) return sourcesCache;
    const c = vscode.workspace.getConfiguration('maskAtlas');
    const sources = {};
    for (const key of SOURCE_KEYS) {
      let inspected = null;
      try { inspected = typeof c.inspect === 'function' ? c.inspect(key) : null; } catch (e) { inspected = null; }
      sources[key] = settingsModule.sourceOf(inspected);
    }
    sourcesCache = sources;
    return sources;
  }

  // The licence server environment is the live one, always: no setting, command, environment
  // variable or editor mode can select another one.
  const licence = createLicence({ secrets: context.secrets, globalState: context.globalState });
  licence.checkTrial().then(undefined, function () { /* read-only state */ });

  let lastRunTimer = null;
  let engineClient = null;
  const app = {
    vscode: vscode,
    context: context,
    licence: licence,
    getSettings: getSettings,
    getSettingSources: getSettingSources,
    diagnostics: null,
    preview: null,
    engine: null,
    busy: false,
    lastRun: null,
    seedSecret: SEED_SECRET,
    extensionVersion: (context.extension && context.extension.packageJSON && context.extension.packageJSON.version) || require('../package.json').version,
    osRelease: function () { try { return os.release(); } catch (e) { return ''; } },
    // The result of the last Pro run is kept in memory only (for the verification and the map export) and forgotten after an hour.
    setLastRun: function (value) {
      if (lastRunTimer) { clearTimeout(lastRunTimer); lastRunTimer = null; }
      const old = app.lastRun;
      app.lastRun = value;
      if (old && (!value || old.runId !== value.runId) && engineClient) engineClient.forget(old.runId);
      if (value) {
        lastRunTimer = setTimeout(function () { app.setLastRun(null); }, LAST_RUN_MINUTES * 60 * 1000);
        if (lastRunTimer.unref) lastRunTimer.unref();
      }
    },
    settingsForReport: function () {
      const s = getSettings();
      return {
        maxFileSizeMB: s.maxFileSizeMB, keepEnvelopeIdentifiers: s.keepEnvelopeIdentifiers, maskOrganisations: s.maskOrganisations, shiftDates: s.shiftDates,
        dateOrder: s.dateOrder, scanFreeText: s.scanFreeText, rulesFile: s.rulesFile, markInProblems: s.markInProblems, 'export.neutraliseFormulas': s.neutraliseFormulas
      };
    }
  };

  // The engine runs in a worker thread; when the worker stops (cancelled, out of memory) the runs it held are gone.
  engineClient = createClient({ onReset: function () { if (app.lastRun) { app.lastRun = null; if (lastRunTimer) { clearTimeout(lastRunTimer); lastRunTimer = null; } } } });
  app.engine = engineClient;

  const subscriptions = context.subscriptions;
  subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (event) {
    if (event.affectsConfiguration('maskAtlas')) { settingsCache = null; sourcesCache = null; }
  }));
  if (typeof vscode.workspace.onDidGrantWorkspaceTrust === 'function') {
    subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(function () { settingsCache = null; sourcesCache = null; }));
  }
  subscriptions.push({ dispose: function () { if (lastRunTimer) clearTimeout(lastRunTimer); app.lastRun = null; engineClient.dispose(); } });

  function install(name, fn) {
    try {
      const result = fn();
      if (Array.isArray(result)) result.forEach(function (d) { subscriptions.push(d); });
      else if (result && typeof result.dispose === 'function') subscriptions.push(result);
      return result;
    } catch (err) {
      log('Could not start ' + name + ': ' + (err && err.message ? err.message : err));
      return null;
    }
  }

  app.diagnostics = install('problems', function () { return createDiagnostics(app); });
  app.preview = install('preview', function () { return createPreviewProvider(app); });
  install('commands', function () { return registerCommands(app); });
  install('stale marks', function () {
    return vscode.workspace.onDidChangeTextDocument(function (event) { if (app.diagnostics && event.contentChanges.length) app.diagnostics.clear(event.document.uri); });
  });
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
