'use strict';
// Which settings and rules change how a run works, and where each of them comes from (user,
// workspace or workspace folder). A workspace can carry settings of its own; a setting that
// weakens a run (it keeps something that would otherwise be replaced) must never apply without
// being named in the confirmation, the notification and the report. No editor API here.

const DEFAULTS = Object.freeze({
  keepEnvelopeIdentifiers: false, maskOrganisations: true, shiftDates: true, dateOrder: 'mdy', scanFreeText: true, 'export.neutraliseFormulas': true
});

// a rule of kind free-text or binary, or a rule for one component of an HL7 field, takes the place over from the built-in profile
const EFFECT_TAKEOVER = 'places named by a free-text, binary or single-component rule can be left as they are';

// the settings that weaken a run when they are not at their default: what each one lets stay
const ROWS = [
  { key: 'keepEnvelopeIdentifiers', weakens: (v) => v === true, label: 'maskAtlas.keepEnvelopeIdentifiers', effect: 'sender, receiver, facility and control identifiers are kept' },
  { key: 'maskOrganisations', weakens: (v) => v === false, label: 'maskAtlas.maskOrganisations', effect: 'organisation names are kept' },
  { key: 'shiftDates', weakens: (v) => v === false, label: 'maskAtlas.shiftDates', effect: 'dates are kept as they are' },
  { key: 'scanFreeText', weakens: (v) => v === false, label: 'maskAtlas.scanFreeText', effect: 'notes, comments and narrative are not read' },
  { key: 'export.neutraliseFormulas', weakens: (v) => v === false, label: 'maskAtlas.export.neutraliseFormulas', effect: 'formula characters in the map CSV are not neutralised', exportOnly: true },
  { key: 'dateOrder', weakens: () => false, label: 'maskAtlas.dateOrder', effect: 'a date such as 04/09/2026 in free text is read day first' }
];

/** The place a configuration value comes from, from what `inspect()` of the editor reports. */
function sourceOf(inspected) {
  if (!inspected) return 'default';
  if (inspected.workspaceFolderValue !== undefined) return 'workspace folder';
  if (inspected.workspaceValue !== undefined) return 'workspace';
  if (inspected.globalValue !== undefined) return 'user';
  return 'default';
}

const isWorkspace = (source) => source === 'workspace' || source === 'workspace folder';

/**
 * The rows of the settings that differ from their defaults and of the rule file.
 *   values   effective values by short key (keepEnvelopeIdentifiers, ...)
 *   sources  where each value comes from, by short key plus rulesFile
 *   rules    { file, count, keepCount } of the rule file in use, or null
 *   seedSet  whether a pseudonym seed is in use
 * Returns { rows, weakening, workspaceWeakening }: each row is { setting, value, source, effect, weakens }.
 */
function describeSettings(values, sources, rules, seedSet, notes) {
  const rows = [];
  for (const spec of ROWS) {
    const value = values[spec.key];
    if (value === undefined || value === DEFAULTS[spec.key]) continue;
    rows.push({ setting: spec.label, value: String(value), source: sources[spec.key] || 'default', effect: spec.effect, weakens: spec.weakens(value), exportOnly: !!spec.exportOnly });
  }
  if (rules) {
    const keeps = rules.keepCount || 0;
    const takes = rules.takeoverCount || 0;
    rows.push({
      setting: 'maskAtlas.rulesFile',
      value: rules.count + (rules.count === 1 ? ' rule' : ' rules') + (keeps ? ', ' + keeps + (keeps === 1 ? ' keeps a place' : ' keep places') : '') + (takes ? ', ' + takes + (takes === 1 ? ' can take over a field' : ' can take over fields') : ''),
      source: sources.rulesFile || 'default', effect: keeps ? 'places named by a keep rule are left as they are' : takes ? EFFECT_TAKEOVER : 'places are added or changed by the rule file', weakens: keeps > 0 || takes > 0,
      sourceText: notes && notes.rulesFile ? notes.rulesFile : ''
    });
  }
  if (seedSet) rows.push({ setting: 'pseudonym seed', value: 'saved', source: 'user', effect: 'the replacements are repeated in every run with the seed', weakens: false });
  // the formula setting changes only the CSV of the pseudonym map, not a run: it is named where the map is exported
  const weakening = rows.filter((r) => r.weakens && !r.exportOnly);
  const exportWeakening = rows.filter((r) => r.weakens && r.exportOnly);
  return { rows: rows, weakening: weakening, workspaceWeakening: weakening.filter((r) => isWorkspace(r.source)), exportWeakening: exportWeakening, workspaceExportWeakening: exportWeakening.filter((r) => isWorkspace(r.source)) };
}

/** One sentence for a notification: what weakens the run. */
function weakeningText(weakening, keptByRule) {
  const parts = weakening.map((r) => r.effect.replace(/^places named by a keep rule are left as they are$/, 'places kept by your rule file').replace(EFFECT_TAKEOVER, 'places left as they are by rules of your rule file'));
  if (keptByRule) parts.push(keptByRule + (keptByRule === 1 ? ' field' : ' fields') + ' kept by your rules');
  return parts.join('; ');
}

/** Where a row comes from, in words: "workspace setting maskAtlas.shiftDates", or a rule file inside the workspace folder whose path the user set. */
function sourceLabel(r) { return r.sourceText || (r.source + ' setting ' + r.setting); }

/** The sentence of the confirmation when the weakening comes from a workspace. */
function workspaceWarning(workspaceWeakening) {
  return 'This workspace changes how the run works: ' + workspaceWeakening.map((r) => r.effect + ' (' + sourceLabel(r) + ')').join('; ') + '.';
}

module.exports = { sourceLabel, DEFAULTS, ROWS, sourceOf, isWorkspace, describeSettings, weakeningText, workspaceWarning };
