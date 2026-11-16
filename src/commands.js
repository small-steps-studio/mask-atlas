'use strict';
// All commands: the free tier (identifier risk report, mask in place, preview), the Pro tools
// (de-identify a message, files or a folder, verification, rule files, pseudonym map export), the
// licence and trial commands and the support commands. The engine runs in a worker thread (see
// worker/engine-worker.js): the extension host stays responsive and a run can be cancelled.

const fs = require('node:fs');
const path = require('node:path');
const config = require('./licence/config');
const messages = require('./licence/messages');
const engine = require('./core/engine');
const files = require('./core/files');
const { CATEGORIES } = require('./core/run');
const rulesModule = require('./pro/rules');
const settingsModule = require('./settings');
const { sampleFor } = require('./samples');
const { diagnosticsBlock, reportProblemText } = require('./support');
const { riskReportMarkdown, runReportMarkdown, verificationLabel } = require('./report');
const { plural, numberText } = require('./util');

const WALKTHROUGH_ID = 'SmallStepsStudio.mask-atlas#maskAtlas.gettingStarted';
const BUTTONS = Object.freeze({ buy: 'Buy Pro', enter: 'Enter Licence Key', lost: 'Lost your key?', remove: 'Remove Licence', report: 'Report A Problem', showReport: 'Show Report' });
const NAME = config.productName;
const MIN_SEED = 12;
// An editor document larger than this many megabytes is de-identified only after a confirmation (it takes a while, although the editor stays usable).
const LONG_EDITOR_RUN_MB = 4;
// Above this size of text a notification with a cancel button shows while the worker is busy.
const PROGRESS_FROM_CHARS = 500000;

function registerCommands(app) {
  const vscode = app.vscode;
  const client = app.engine;
  const disposables = [];

  function reg(id, fn) {
    disposables.push(vscode.commands.registerCommand(id, async function () {
      try {
        return await fn.apply(null, arguments);
      } catch (err) {
        if (err && err.cancelled) { vscode.window.showInformationMessage(NAME + ': cancelled. Nothing was kept of the unfinished run except the files already written.'); return undefined; }
        // never show a stack or any text that may come from a message
        const why = err && err.message && /^[A-Za-z0-9 ,.:;()'"%\/-]{1,300}$/.test(err.message) ? err.message : 'the command could not be completed.';
        vscode.window.showErrorMessage(NAME + ': ' + why + ' If this keeps happening, run "' + NAME + ': Report A Problem".');
        return undefined;
      }
    }));
  }
  function info() { return vscode.window.showInformationMessage.apply(vscode.window, Array.prototype.slice.call(arguments)); }
  function warn(text) { return vscode.window.showWarningMessage.apply(vscode.window, [NAME + ': ' + text].concat(Array.prototype.slice.call(arguments, 1))); }

  /** Only one run works at a time: the worker answers one request after the other. */
  async function guarded(fn) {
    if (app.busy) { warn('Another run is still working. Wait for it to finish, or cancel it, and try again.'); return undefined; }
    app.busy = true;
    try { return await fn(); } finally { app.busy = false; }
  }

  /** Runs fn(token) with a notification and a cancel button when the work is large. */
  function withWork(title, size, fn) {
    if (size < PROGRESS_FROM_CHARS) return fn(undefined, function () { /* no progress */ });
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': ' + title, cancellable: true }, function (progress, token) {
      return fn(token, function (data) { if (data && data.message) progress.report({ message: data.message }); });
    });
  }

  async function openExternal(url) {
    try { return await vscode.env.openExternal(vscode.Uri.parse(url)); } catch (e) {
      warn('The link could not be opened by the editor. Open it in your browser: ' + url);
      return false;
    }
  }
  async function handleLicenceButton(pick) {
    if (pick === BUTTONS.buy) await vscode.commands.executeCommand('maskAtlas.buyPro');
    else if (pick === BUTTONS.enter) await vscode.commands.executeCommand('maskAtlas.enterKey');
    else if (pick === BUTTONS.remove) await vscode.commands.executeCommand('maskAtlas.removeLicence');
    else if (pick === BUTTONS.lost) await showLostKey();
  }
  async function showLostKey() {
    const pick = await info(messages.lostKeyText(), BUTTONS.enter, BUTTONS.report);
    if (pick === BUTTONS.enter) await vscode.commands.executeCommand('maskAtlas.enterKey');
    else if (pick === BUTTONS.report) await vscode.commands.executeCommand('maskAtlas.reportProblem');
  }

  // ---- Pro gate: licence first, then the free trial -----------------------------------------
  async function requirePro(feature) {
    if (await app.licence.isPro()) return true;
    let trial = await app.licence.checkTrial();
    if (trial.state === 'unused') {
      trial = await app.licence.startTrial();
      if (trial.state === 'active') {
        await app.licence.noteTrialReminder();
        info(messages.trialStartedText(trial), BUTTONS.buy, BUTTONS.enter).then(handleLicenceButton).then(undefined, function () { /* closed */ });
        return true;
      }
    }
    if (trial.state === 'active') {
      await app.licence.touchTrial();
      if (await app.licence.noteTrialReminder()) info(messages.trialReminderText(trial), BUTTONS.buy, BUTTONS.enter).then(handleLicenceButton).then(undefined, function () { /* closed */ });
      return true;
    }
    const pick = await info(messages.proNoticeText(feature, trial), BUTTONS.buy, BUTTONS.enter);
    await handleLicenceButton(pick);
    return false;
  }

  // ---- shared helpers ------------------------------------------------------------------------
  function runOptions() {
    const s = app.getSettings();
    return { keepEnvelope: s.keepEnvelopeIdentifiers, maskOrganisations: s.maskOrganisations, shiftDates: s.shiftDates, dateOrder: s.dateOrder, freeText: s.scanFreeText, recordMap: true };
  }

  function activeDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { warn('Open an HL7 v2, FHIR JSON or X12 file first.'); return null; }
    const doc = editor.document;
    const limit = app.getSettings().maxFileSizeMB * 1024 * 1024;
    const text = doc.getText();
    if (text.length > limit) {
      warn('The document is larger than the limit of ' + app.getSettings().maxFileSizeMB + ' MB set for the editor commands. Use ' + NAME + ': De-identify Folder (Pro), which reads large files from disk in pieces, or raise "maskAtlas.maxFileSizeMB".');
      return null;
    }
    const format = engine.detectFormat(text);
    if (!format) { warn(engine.processText(text, require('./core/run').createRun({ mode: 'mask' }), {}).message + ' Nothing was changed.'); return null; }
    return { editor: editor, doc: doc, text: text, format: format };
  }

  async function openText(content, language, beside) {
    const doc = await vscode.workspace.openTextDocument({ content: content, language: language });
    await vscode.window.showTextDocument(doc, { viewColumn: beside ? vscode.ViewColumn.Beside : undefined, preview: false });
    return doc;
  }
  function languageOf(format) { return format === 'fhir' || format === 'ndjson' ? 'json' : 'plaintext'; }

  /** The rule file named in the settings (Pro): its text, or an error message. A relative path points into the workspace folder, so the file comes from the workspace whatever sets the path. */
  function loadRulesText() {
    const file = app.getSettings().rulesFile.trim();
    if (!file) return { text: '' };
    let target = file;
    if (!path.isAbsolute(target)) {
      if (vscode.workspace.isTrusted === false) return { error: 'The rule file "' + file + '" is a path inside a workspace that is not trusted, so it is not read. Trust the workspace, or set "maskAtlas.rulesFile" to an absolute path in your user settings.' };
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      if (!folder) return { error: 'The setting "maskAtlas.rulesFile" is a relative path but no folder is open.' };
      target = path.join(folder.uri.fsPath, target);
    }
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch (e) { return { error: 'The rule file named in "maskAtlas.rulesFile" could not be read.' }; }
    return { text: text, relative: !path.isAbsolute(file) };
  }

  /** The settings and rules that differ from the defaults, with their sources. */
  function describeNow(rulesInfo, seedSet, rulesInWorkspace) {
    const s = app.getSettings();
    const values = { keepEnvelopeIdentifiers: s.keepEnvelopeIdentifiers, maskOrganisations: s.maskOrganisations, shiftDates: s.shiftDates, dateOrder: s.dateOrder, scanFreeText: s.scanFreeText, 'export.neutraliseFormulas': s.neutraliseFormulas };
    const sources = Object.assign({}, app.getSettingSources());
    const notes = {};
    if (rulesInWorkspace) {
      // a relative path points into the workspace folder, so the file is the workspace's; the path itself may be the user's own
      if (sources.rulesFile === 'user') notes.rulesFile = 'rule file inside the workspace folder, path set in your user settings: maskAtlas.rulesFile';
      sources.rulesFile = 'workspace folder';
    }
    return settingsModule.describeSettings(values, sources, rulesInfo, seedSet, notes);
  }

  /** The settings (that differ from the default) which apply to the free tier and the scan, with their sources. */
  function freeRows(withFreeText) {
    return describeNow(null, false).rows.filter(function (r) {
      return r.setting === 'maskAtlas.keepEnvelopeIdentifiers' || r.setting === 'maskAtlas.maskOrganisations' || (withFreeText && r.setting === 'maskAtlas.scanFreeText');
    });
  }
  function freeWeakRows(withFreeText) { return freeRows(withFreeText).filter(function (r) { return r.weakens; }); }
  function freeWeakSentence(rows) {
    return rows.length ? ' Settings that keep identifiers apply: ' + rows.map(function (r) { return r.effect + ' (' + r.source + ' setting ' + r.setting + ')'; }).join('; ') + '.' : '';
  }

  /** A Pro run in the worker: key from the saved seed or from the system's random source. */
  async function newProRun() {
    const loaded = loadRulesText();
    if (loaded.error) { warn(loaded.error + ' Nothing was changed.'); return null; }
    let seed;
    try { seed = await app.context.secrets.get(app.seedSecret); } catch (e) { seed = undefined; }
    const options = runOptions();
    const runId = client.newRunId();
    const created = await client.request('createRun', { runId: runId, mode: 'pseudonym', seed: seed || undefined, options: options, rulesText: loaded.text || '' });
    if (created.rulesErrors) { warn('The rule file has problems: ' + created.rulesErrors.slice(0, 5).join(' ') + ' Nothing was changed.'); return null; }
    const rulesInfo = created.rules;
    const described = describeNow(rulesInfo, !!seed, !!loaded.relative);
    return {
      runId: runId, options: options, rulesInfo: rulesInfo, settings: described,
      rulesNote: rulesInfo ? plural(rulesInfo.count, 'rule') + ' from the rule file' + (rulesInfo.keepCount ? ' (' + plural(rulesInfo.keepCount, 'keep rule') + ')' : '') : '',
      keyNote: seed ? 'derived from your saved seed (the same seed gives the same replacements in a later run)' : 'random key for this run only (not stored; a later run gives different replacements)'
    };
  }

  /** When a workspace (not the user) turned off a protection, the run does not start without a yes. */
  async function confirmWorkspaceSettings(pro, extraText, button) {
    const w = pro.settings.workspaceWeakening;
    if (!w.length) return true;
    const pick = await vscode.window.showWarningMessage(NAME + ': ' + settingsModule.workspaceWarning(w) + (extraText ? ' ' + extraText : '') + ' Continue with these settings?', { modal: true }, button);
    return pick === button;
  }

  /** What weakened this run: the settings that differ, and a rule file only when one of its keep rules matched a field. */
  function weakInfo(pro, stats) {
    const kept = stats.keptByRule || 0;
    const active = pro.settings.weakening.filter(function (r) { return r.setting !== 'maskAtlas.rulesFile' || kept > 0; });
    return { weakening: active, weakText: settingsModule.weakeningText(active, kept) };
  }

  function reportInfo(pro, stats, extra) {
    const o = pro.options;
    return Object.assign({
      stats: stats, keyNote: pro.keyNote, keepEnvelope: o.keepEnvelope, maskOrganisations: o.maskOrganisations, rulesNote: pro.rulesNote,
      dateNote: o.shiftDates ? 'shifted per patient (order and intervals kept)' : 'kept as they are (setting)',
      settingsRows: pro.settings.rows, weakening: extra && extra.weak ? extra.weak.weakening : pro.settings.weakening, freeTextOff: !o.freeText
    }, extra || {});
  }

  function categorySummary(stats) {
    const parts = [];
    for (const [key, label] of CATEGORIES) { const n = stats.byCategory.get(key) || 0; if (n) parts.push(label.toLowerCase() + ' ' + n); }
    return parts.join(', ');
  }

  function verificationInfo(total, fromDisk, weak) {
    return {
      pass: total.pass, files: total.files, failedFiles: total.failedFiles, originalValues: total.originalValues, patterns: total.patterns, fields: total.fields, incomplete: total.incomplete,
      paths: total.paths, locations: total.locations, locationsCut: total.locationsCut, keptByDesign: total.keptByDesign, fromDisk: fromDisk, weakText: weak ? weak.weakText : ''
    };
  }
  function verificationSentence(v) {
    return verificationLabel(v) + (v.pass && v.weakText ? ' (' + v.weakText + ')' : '');
  }

  // ---- samples and support -------------------------------------------------------------------
  async function openSample(kind) {
    const s = sampleFor(kind);
    await openText(s.text, s.language, false);
  }
  reg('maskAtlas.openSampleHl7', function () { return openSample('hl7'); });
  reg('maskAtlas.openSampleFhir', function () { return openSample('fhir'); });
  reg('maskAtlas.openSampleX12', function () { return openSample('x12'); });
  reg('maskAtlas.openWalkthrough', async function () { await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false); });
  reg('maskAtlas.showDocumentation', async function () { await openExternal(config.docsUrl); });

  reg('maskAtlas.reportProblem', async function () {
    const editor = vscode.window.activeTextEditor;
    let active = null;
    if (editor) {
      const text = editor.document.getText();
      const format = text.length <= 8 * 1024 * 1024 ? engine.detectFormat(text) : null;
      active = { format: format ? engine.FORMAT_NAMES[format] : 'format not recognised', size: text.length, skipped: text.length > 8 * 1024 * 1024 ? 'not examined (over 8 million characters)' : '' };
    }
    let seedSet = false;
    try { seedSet = !!(await app.context.secrets.get(app.seedSecret)); } catch (e) { seedSet = false; }
    const extension = app.context && app.context.extension;
    const block = diagnosticsBlock({
      extensionVersion: extension && extension.packageJSON ? extension.packageJSON.version : app.extensionVersion,
      editorName: vscode.env && vscode.env.appName, editorVersion: vscode.version, platform: process.platform, osRelease: app.osRelease ? app.osRelease() : '',
      arch: process.arch, nodeVersion: process.versions && process.versions.node, settings: app.settingsForReport(), licence: await app.licence.status(false),
      active: active, seedSet: seedSet, lastRun: !!app.lastRun
    });
    await vscode.env.clipboard.writeText(block);
    const opened = await openExternal(config.issuesUrl);
    info(NAME + ': ' + reportProblemText(opened !== false));
  });

  // ---- free: identifier risk report ----------------------------------------------------------
  reg('maskAtlas.scan', function () {
    return guarded(async function () {
      const a = activeDocument();
      if (!a) return;
      // Free text is read for a licensed user or a running trial; the scan never starts the trial.
      const access = await app.licence.hasAccess();
      const withText = access && runOptions().freeText;
      const weakRows = freeWeakRows(access);
      const runId = client.newRunId();
      await client.request('createRun', { runId: runId, mode: withText ? 'pseudonym' : 'mask', options: Object.assign({}, runOptions(), { recordMap: false }) });
      let result;
      try {
        result = await withWork('scanning for identifiers', a.text.length, function (token, progress) {
          progress({ message: 'reading ' + engine.FORMAT_NAMES[a.format] });
          return client.request('processText', { runId: runId, text: a.text, format: a.format, scanOnly: true, collectHits: true }, { token: token });
        });
      } finally { client.forget(runId); }
      if (!result.ok) { warn(result.message + ' Nothing was changed.'); return; }
      let marks = 0;
      if (app.getSettings().markInProblems && app.diagnostics) marks = app.diagnostics.show(a.doc, result.hits);
      const text = riskReportMarkdown({ formatName: engine.FORMAT_NAMES[result.format], units: result.stats.units, stats: result.stats, freeTextChecked: withText, freeTextOff: access && !withText, settingsRows: freeRows(access) });
      await openText(text, 'markdown', true);
      const total = result.stats.total;
      info(NAME + ': ' + (total
        ? numberText(total) + ' fields can point to a person (' + categorySummary(result.stats) + ')' + (marks ? '; they are marked in the Problems panel.' : '.')
        : 'No field of the built-in profile holds an identifier. That does not make the message safe to share; read it yourself.') + freeWeakSentence(weakRows));
    });
  }.bind(null));

  // ---- free: mask in place and preview -------------------------------------------------------
  async function maskedText(a) {
    const runId = client.newRunId();
    await client.request('createRun', { runId: runId, mode: 'mask', options: Object.assign({}, runOptions(), { recordMap: false }) });
    let result;
    try {
      result = await withWork('masking', a.text.length, function (token) { return client.request('processText', { runId: runId, text: a.text, format: a.format }, { token: token }); });
    } finally { client.forget(runId); }
    if (!result.ok) { warn(result.message + ' Nothing was changed.'); return null; }
    return result;
  }

  reg('maskAtlas.maskDocument', function () {
    return guarded(async function () {
      const a = activeDocument();
      if (!a) return;
      const m = await maskedText(a);
      if (!m) return;
      if (!m.changed) { warn('No field of the built-in profile was found, so nothing was masked. The message may still hold identifiers in free text or unusual fields.'); return; }
      const full = new vscode.Range(a.doc.positionAt(0), a.doc.positionAt(a.text.length));
      const ok = await a.editor.edit(function (b) { b.replace(full, m.text); });
      if (!ok) { warn('The editor refused the change (is the file read-only?). Nothing was changed.'); return; }
      if (app.diagnostics) app.diagnostics.clear(a.doc.uri);
      info(NAME + ': ' + numberText(m.stats.total) + ' fields masked with X for letters and 9 for digits (' + categorySummary(m.stats) + '). The text of the editor was changed, not the file on disk; undo with Ctrl+Z. Free text is not read by the free tier: review the result.' + freeWeakSentence(freeWeakRows(false)));
    });
  });

  reg('maskAtlas.previewMask', function () {
    return guarded(async function () {
      const a = activeDocument();
      if (!a) return;
      const m = await maskedText(a);
      if (!m) return;
      if (!m.changed) { warn('No field of the built-in profile was found, so there is nothing to preview.'); return; }
      const name = path.basename(a.doc.fileName || 'message') + ' (masked)';
      const right = app.preview.add(name, m.text);
      await vscode.commands.executeCommand('vscode.diff', a.doc.uri, right, 'Original <-> masked preview', { preview: true });
      const weak = freeWeakSentence(freeWeakRows(false));
      if (weak) info(NAME + ':' + weak);
    });
  });

  // ---- Pro: de-identify the message in the editor --------------------------------------------
  reg('maskAtlas.deidentifyDocument', function () {
    return guarded(async function () {
      if (!(await requirePro('De-identify Message'))) return;
      const a = activeDocument();
      if (!a) return;
      const megabytes = a.text.length / 1048576;
      if (megabytes > LONG_EDITOR_RUN_MB) {
        const go = await vscode.window.showWarningMessage(NAME + ': this document is ' + megabytes.toFixed(1) + ' MB. De-identifying it in the editor takes roughly ' + Math.ceil(megabytes * 3) +
          ' seconds; the editor stays usable and a notification with a cancel button shows. De-identify Folder and De-identify Selected Files read the file from disk in pieces. Continue here?', { modal: true }, 'Continue');
        if (go !== 'Continue') return;
      }
      const pro = await newProRun();
      if (!pro) return;
      if (!(await confirmWorkspaceSettings(pro, '', 'Run With These Settings'))) { client.forget(pro.runId); return; }
      let result;
      try {
        result = await withWork('de-identifying the message', a.text.length, function (token, progress) {
          progress({ message: 'reading ' + engine.FORMAT_NAMES[a.format] });
          return client.request('processText', { runId: pro.runId, text: a.text, format: a.format, verify: true }, { token: token });
        });
      } catch (e) { app.setLastRun(null); client.forget(pro.runId); throw e; }
      if (!result.ok) { warn(result.message + ' Nothing was changed.'); client.forget(pro.runId); return; }
      if (!result.changed) { warn('Nothing was recognised as an identifier, so no copy was made. Add a rule file or read the message yourself.'); client.forget(pro.runId); return; }
      const weak = weakInfo(pro, result.stats);
      const v = verificationInfo(result.verification, false, weak);
      await openText(result.text, languageOf(result.format), true);
      const md = runReportMarkdown(reportInfo(pro, result.stats, { weak: weak, title: 'One ' + engine.FORMAT_NAMES[result.format] + ' document from the editor.', files: [], verification: v, mapIncomplete: result.mapIncomplete }));
      app.setLastRun({ runId: pro.runId, outputs: null, outDir: null, report: md, weak: weak, pro: pro, stats: result.stats });
      const findings = result.verification.originalValues + result.verification.patterns + result.verification.fields;
      const pick = await info(NAME + ': ' + numberText(result.stats.total) + ' fields replaced in a new, unsaved editor (' + categorySummary(result.stats) + '). Verification: ' + (v.pass ? verificationSentence(v) : 'FAIL, ' + plural(findings, 'finding')) +
        '. Your original was not changed. Read the result before you share it.', BUTTONS.showReport);
      if (pick === BUTTONS.showReport) await openText(md, 'markdown', true);
    });
  });

  // ---- Pro: files and folders ----------------------------------------------------------------
  function uniqueTarget(source) {
    const parent = path.dirname(source);
    const base = path.basename(source);
    let candidate = path.join(parent, base + '-masked');
    let n = 2;
    while (fs.existsSync(candidate)) { candidate = path.join(parent, base + '-masked-' + n); n++; }
    return candidate;
  }

  async function runOnDisk(title, source, label) {
    const pro = await newProRun();
    if (!pro) return;
    const target = uniqueTarget(source.dir);
    const confirm = await vscode.window.showWarningMessage(NAME + ': write de-identified copies of the recognised files in "' + path.basename(source.dir) + '" to the new folder "' + path.basename(target) +
      '"? Your original files are not changed. Files in which nothing is recognised are not copied.' + (pro.settings.workspaceWeakening.length ? ' ' + settingsModule.workspaceWarning(pro.settings.workspaceWeakening) : ''), { modal: true }, 'Write Copies');
    if (confirm !== 'Write Copies') { client.forget(pro.runId); return; }
    let outcome;
    try {
      outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': ' + title, cancellable: true }, function (progress, token) {
        let last = '';
        return client.request('runFiles', { runId: pro.runId, folder: source.folder || null, list: source.list || null, baseDir: source.dir, outDir: target }, {
          token: token,
          onProgress: function (p) {
            const text = p.phase === 'files' ? p.done + ' of ' + p.total : p.phase === 'verify' ? 'verifying the output' + (p.total ? ' (' + p.done + ' of ' + p.total + ')' : '') : '';
            if (text && text !== last) { progress.report({ message: text }); last = text; }
          }
        });
      });
    } catch (e) {
      app.setLastRun(null);
      client.forget(pro.runId);
      if (e && e.cancelled) { info(NAME + ': cancelled. Files already written stay in "' + path.basename(target) + '"; they are not a complete or verified result.'); return; }
      throw e;
    }
    const entries = outcome.files;
    const weak = weakInfo(pro, outcome.stats);
    const v = verificationInfo(outcome.verification, true, weak);
    const md = runReportMarkdown(reportInfo(pro, outcome.stats, { weak: weak, title: label, files: entries, verification: v, fileNameWarnings: outcome.nameWarnings, mapIncomplete: outcome.mapIncomplete, truncated: outcome.truncated, maxFiles: files.MAX_FILES }));
    app.setLastRun({ runId: pro.runId, outputs: entries, outDir: target, report: md, weak: weak, pro: pro, stats: outcome.stats });
    const written = entries.filter(function (f) { return f.status === 'written'; }).length;
    const unchanged = entries.filter(function (f) { return f.status === 'unchanged'; }).length;
    const problems = entries.filter(function (f) { return f.status === 'error'; }).length;
    const text = NAME + ': ' + plural(written, 'file') + ' written to "' + path.basename(target) + '", ' + numberText(outcome.stats.total) + ' fields replaced. Verification: ' + verificationSentence(v) +
      (unchanged ? '. ' + plural(unchanged, 'file') + ' had nothing recognised and ' + (unchanged === 1 ? 'was' : 'were') + ' NOT written' : '') + (problems ? '. ' + plural(problems, 'file') + ' could not be processed' : '') + '.';
    const show = (unchanged || problems || !v.pass) ? await warn(text.slice(NAME.length + 2), BUTTONS.showReport) : await info(text, BUTTONS.showReport);
    if (show === BUTTONS.showReport) await openText(md, 'markdown', true);
  }

  reg('maskAtlas.deidentifyFolder', function (uri) {
    return guarded(async function () {
      if (!(await requirePro('De-identify Folder'))) return;
      let folder = uri && uri.fsPath ? uri.fsPath : null;
      if (!folder) {
        const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'De-identify this folder', title: NAME + ': folder with HL7, FHIR and X12 files' });
        if (!pick || !pick.length) return;
        folder = pick[0].fsPath;
      }
      let st;
      try { st = fs.statSync(folder); } catch (e) { warn('The folder could not be read.'); return; }
      if (!st.isDirectory()) { warn('That is not a folder.'); return; }
      await runOnDisk('de-identifying ' + path.basename(folder), { dir: folder, folder: folder }, 'The folder "' + path.basename(folder) + '" (all files below it).');
    });
  });

  reg('maskAtlas.deidentifyFiles', function (uri, uris) {
    return guarded(async function () {
      if (!(await requirePro('De-identify Selected Files'))) return;
      let list = Array.isArray(uris) && uris.length ? uris : uri ? [uri] : [];
      list = list.filter(function (u) { return u && u.fsPath; }).map(function (u) { return u.fsPath; });
      if (!list.length) {
        const pick = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: 'De-identify these files', title: NAME + ': HL7, FHIR or X12 files' });
        if (!pick || !pick.length) return;
        list = pick.map(function (u) { return u.fsPath; });
      }
      list = list.filter(function (f) { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
      if (!list.length) { warn('No file was selected.'); return; }
      const dir = path.dirname(list[0]);
      await runOnDisk('de-identifying ' + plural(list.length, 'file'), { dir: dir, list: list }, plural(list.length, 'selected file') + ' from the folder "' + path.basename(dir) + '".');
    });
  });

  // ---- Pro: verification, map export, forgetting ---------------------------------------------
  reg('maskAtlas.verify', function () {
    return guarded(async function () {
      if (!(await requirePro('Verify De-identified Output'))) return;
      const last = app.lastRun;
      if (!last) { info(NAME + ': there is no run to verify against. The check compares an output with the values replaced by one run, which is kept in memory for an hour; run De-identify first.'); return; }
      const choices = [];
      if (last.outDir && last.outputs) choices.push({ label: 'Output folder of the last run', description: path.basename(last.outDir), id: 'folder' });
      if (vscode.window.activeTextEditor) choices.push({ label: 'Document in the active editor', description: 'checked against the last run', id: 'editor' });
      if (!choices.length) { info(NAME + ': there is nothing to verify: open the output in an editor or run De-identify Folder.'); return; }
      const pick = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(choices, { placeHolder: 'What should be verified?' });
      if (!pick) return;
      let answer, fromDisk = false;
      if (pick.id === 'folder') {
        answer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: NAME + ': verifying the output', cancellable: true }, function (progress, token) {
          return client.request('verifyOutputs', { runId: last.runId, outDir: last.outDir, entries: last.outputs }, { token: token, onProgress: function (p) { if (p.total) progress.report({ message: p.done + ' of ' + p.total }); } });
        });
        fromDisk = true;
      } else {
        const a = activeDocument();
        if (!a) return;
        answer = await withWork('verifying the document', a.text.length, function (token) { return client.request('verifyText', { runId: last.runId, text: a.text, format: a.format }, { token: token }); });
      }
      const total = answer.verification;
      const v = verificationInfo(total, fromDisk, last.weak);
      const md = runReportMarkdown(reportInfo(Object.assign({}, last.pro, { keyNote: 'not shown for a verification' }), last.stats, {
        weak: last.weak,
        title: 'Verification of ' + (pick.id === 'folder' ? 'the output folder of the last run' : 'the active document') + ' against the last run.', files: [], verification: v
      }));
      const findings = total.originalValues + total.patterns + total.fields;
      const pickBtn = await (total.pass ? info(NAME + ': verification ' + verificationSentence(v) + '. No replaced value, no foreign pattern and no unreplaced field was found. This is not proof; see the limits in the report.', BUTTONS.showReport)
        : warn('verification FAIL: ' + plural(findings, 'finding') + '.', BUTTONS.showReport));
      if (pickBtn === BUTTONS.showReport) await openText(md, 'markdown', true);
    });
  });

  /** When a workspace turns the formula neutralisation of the map CSV off, the confirmation says so. */
  function formulaWarning() {
    const rows = describeNow(null, false).workspaceExportWeakening;
    return rows.length ? ' ' + settingsModule.workspaceWarning(rows) : '';
  }

  reg('maskAtlas.exportMap', function () {
    return guarded(async function () {
      if (!(await requirePro('Export Pseudonym Map'))) return;
      const last = app.lastRun;
      if (!last) { info(NAME + ': there is no run to export. The map of a run is kept in memory for an hour after De-identify Message, Selected Files or Folder.'); return; }
      const confirm = await vscode.window.showWarningMessage(NAME + ': the pseudonym map lists every original value next to its replacement. Anyone who gets the file can undo the de-identification of this run. Save it only on a protected disk and never send it with the data.' + formulaWarning() + ' Save the map?',
        { modal: true }, 'Save Map');
      if (confirm !== 'Save Map') return;
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(require('node:os').homedir(), 'mask-atlas-map.csv')), filters: { 'CSV file': ['csv'] }, saveLabel: 'Save Map', title: NAME + ': save the pseudonym map' });
      if (!target) return;
      const exported = await client.request('exportMap', { runId: last.runId, target: target.fsPath, neutralise: app.getSettings().neutraliseFormulas });
      info(NAME + ': ' + plural(exported.rows, 'row') + ' saved' + (exported.complete ? '' : ' (the map is incomplete: the run replaced more distinct values than are kept)') + '. The file holds original values: protect it.');
    });
  });

  reg('maskAtlas.forgetRun', async function () {
    if (!app.lastRun) { info(NAME + ': nothing is kept in memory.'); return; }
    app.setLastRun(null);
    info(NAME + ': the result of the last run (including the pseudonym map) was removed from memory. Output files already written are not touched.');
  });

  reg('maskAtlas.setSeed', async function () {
    if (!(await requirePro('Set Pseudonym Seed'))) return;
    const seed = await vscode.window.showInputBox({
      title: NAME + ': pseudonym seed (at least ' + MIN_SEED + ' characters, the same seed gives the same replacements in every later run; keep it secret like a password)', placeHolder: 'Passphrase', password: true, ignoreFocusOut: true,
      validateInput: function (v) { return (v || '').length < MIN_SEED ? 'Use at least ' + MIN_SEED + ' characters; a short seed can be guessed.' : null; }
    });
    if (!seed) return;
    await app.context.secrets.store(app.seedSecret, seed);
    info(NAME + ': the seed was saved in the secret storage of the editor. Runs now give the same replacements for the same values. "' + NAME + ': Clear Pseudonym Seed" removes it.');
  });

  reg('maskAtlas.clearSeed', async function () {
    await app.context.secrets.delete(app.seedSecret);
    info(NAME + ': the seed was removed. Each run uses a new random key again.');
  });

  reg('maskAtlas.createRulesFile', async function () {
    if (!(await requirePro('Create Rules File'))) return;
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) { await openText(rulesModule.templateText(), 'json', false); info(NAME + ': no folder is open, so the template was opened as an unsaved document. Save it and set "maskAtlas.rulesFile" to its path.'); return; }
    const target = path.join(folder.uri.fsPath, 'mask-atlas-rules.json');
    if (fs.existsSync(target)) { const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target)); await vscode.window.showTextDocument(doc); info(NAME + ': "mask-atlas-rules.json" already exists in this folder; it was opened, not changed.'); return; }
    fs.writeFileSync(target, rulesModule.templateText(), 'utf8');
    await vscode.workspace.getConfiguration('maskAtlas').update('rulesFile', 'mask-atlas-rules.json', vscode.ConfigurationTarget.Workspace);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc);
    info(NAME + ': "mask-atlas-rules.json" was created in the folder and "maskAtlas.rulesFile" now points to it. The first rule that matches a field wins; "keep" switches a built-in path off, and every run report lists the places that your rules keep.');
  });

  // ---- licence commands ----------------------------------------------------------------------
  reg('maskAtlas.buyPro', async function () {
    const choice = await vscode.window.showQuickPick(messages.buyChoices(), { placeHolder: 'Which licence? Both unlock the same Pro features.', matchOnDescription: true, matchOnDetail: true });
    if (!choice) return;
    let users = 1;
    if (choice.tier === 'business') {
      const answer = await vscode.window.showInputBox({ title: NAME + ' Pro Business: ' + messages.businessUsersQuestion(), value: '1', ignoreFocusOut: true, validateInput: messages.businessUsersError });
      if (answer === undefined) return;
      if (messages.businessUsersError(answer)) { warn(messages.businessUsersError(answer) + ' The checkout page was not opened.'); return; }
      users = Number(String(answer).trim());
    }
    const url = app.licence.buyUrl(choice.tier, users);
    if (!url) { info(NAME + ': ' + choice.label + ' is not on sale yet. Please check the extension page again soon.'); return; }
    await openExternal(url);
  });

  reg('maskAtlas.enterKey', async function () {
    const raw = await vscode.window.showInputBox({
      title: NAME + ' Pro: paste the licence key from your purchase e-mail', placeHolder: 'Licence key', ignoreFocusOut: true, password: false,
      validateInput: function (v) { return /\s/.test((v || '').trim()) ? 'A licence key contains no spaces.' : null; }
    });
    const key = (raw || '').trim();
    if (!key) return;
    const result = await app.licence.activate(key);
    if (result.ok) info(NAME + ': ' + messages.activatedText(result.licenceType, result));
    else {
      const pick = await vscode.window.showErrorMessage(NAME + ': ' + messages.activationFailureText(result), BUTTONS.lost);
      if (pick === BUTTONS.lost) await showLostKey();
    }
  });

  reg('maskAtlas.licenceStatus', async function () {
    const st = await app.licence.status(true);
    const text = NAME + ': ' + messages.licenceStatusText(st);
    let pick;
    if (st.pro) pick = await info(text, BUTTONS.remove);
    else if (st.hasKey) pick = await info(text, BUTTONS.enter, BUTTONS.remove, BUTTONS.lost);
    else pick = await info(text, BUTTONS.buy, BUTTONS.enter, BUTTONS.lost);
    await handleLicenceButton(pick);
  });

  reg('maskAtlas.removeLicence', async function () {
    const st = await app.licence.status(false);
    if (!st.hasKey) { info(NAME + ': No licence key is stored on this computer, so there is nothing to remove.'); return; }
    const pick = await vscode.window.showWarningMessage(NAME + ': ' + messages.removeConfirmText(), { modal: true }, BUTTONS.remove);
    if (pick !== BUTTONS.remove) return;
    const result = await app.licence.remove();
    info(NAME + ': ' + (result.deactivated
      ? 'The licence was removed from this computer and the activation was freed. You can enter the key on another computer now.'
      : 'The licence was removed from this computer. ' + (result.reason === 'status'
        ? 'The licence server did not confirm that the activation was freed (it answered with HTTP ' + result.status + '), so the activation may still count against the limit of '
        : 'The licence server could not be reached, so the activation may still count against the limit of ') +
        config.activationLimit + '; if a later activation is refused, contact ' + config.supportContact() + '.'));
  });

  return disposables;
}

module.exports = { registerCommands: registerCommands, BUTTONS: BUTTONS };
