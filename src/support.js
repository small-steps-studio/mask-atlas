'use strict';
// The diagnostics block that "Report A Problem" copies to the clipboard. It holds versions, the
// platform, the format and size of the active file, the settings and the licence or trial state.
// It never holds file contents, file names, paths, values from a message, the licence key or its
// hint, user names, computer names or e-mail addresses. The rule file setting, which names a path,
// appears only as "set" or "not set".

const config = require('./licence/config');

const SETTING_KEYS = ['maxFileSizeMB', 'keepEnvelopeIdentifiers', 'maskOrganisations', 'shiftDates', 'dateOrder', 'scanFreeText', 'rulesFile', 'markInProblems', 'export.neutraliseFormulas'];
const PATH_KEYS = ['rulesFile'];

function licenceLine(st) {
  if (!st) return 'unknown';
  const trial = st.trial || { state: 'unused' };
  let text;
  if (st.pro && st.via === 'grace') text = 'Pro (licence, offline grace period)';
  else if (st.pro) text = 'Pro (' + (st.licenceType || 'licence') + ', verified)';
  else if (st.hasKey && st.via === 'product') text = (trial.state === 'active' ? 'Trial' : 'Free') + ' (stored key of another product)';
  else if (st.hasKey && st.via === 'rejected') text = (trial.state === 'active' ? 'Trial' : 'Free') + ' (stored key rejected by the server)';
  else if (st.hasKey) text = (trial.state === 'active' ? 'Trial' : 'Free') + ' (stored key, grace period over)';
  else if (trial.state === 'active') text = 'Trial (' + trial.daysLeft + ' day' + (trial.daysLeft === 1 ? '' : 's') + ' left)';
  else if (trial.state === 'expired') text = 'Free (trial ended)';
  else text = 'Free (trial not started)';
  return text + ', licence server: ' + (st.mode || 'live');
}

function settingValue(v) {
  if (v === undefined) return 'default';
  return typeof v === 'object' || typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/**
 * Builds the block from `info`: extensionVersion, editorName, editorVersion, platform, osRelease,
 * arch, nodeVersion, settings (flat object keyed as SETTING_KEYS), licence (status), active
 * ({ format, size } or null), seedSet (boolean), lastRun (boolean).
 */
function diagnosticsBlock(info) {
  const i = info || {};
  const lines = [];
  lines.push(config.productName + ' ' + (i.extensionVersion || 'unknown version'));
  lines.push('Editor: ' + (i.editorName || 'unknown') + ' ' + (i.editorVersion || ''));
  lines.push('Platform: ' + (i.platform || 'unknown') + ' ' + (i.osRelease || '') + ' ' + (i.arch || '') + (i.nodeVersion ? ', Node ' + i.nodeVersion : ''));
  const a = i.active;
  if (!a) lines.push('Active file: none');
  else lines.push('Active file: ' + (a.format || 'format not recognised') + (typeof a.size === 'number' ? ', ' + a.size + ' characters' : '') + (a.skipped ? ', ' + a.skipped : ''));
  lines.push('Settings:');
  const s = i.settings || {};
  for (const k of SETTING_KEYS) {
    const v = PATH_KEYS.indexOf(k) !== -1 ? (s[k] ? 'set' : 'not set') : settingValue(s[k]);
    lines.push('  ' + k + ' = ' + v);
  }
  lines.push('Pseudonym seed: ' + (i.seedSet ? 'saved' : 'none'));
  lines.push('Result of the last run held in memory: ' + (i.lastRun ? 'yes' : 'no'));
  lines.push('Licence: ' + licenceLine(i.licence));
  lines.push('Issues page: ' + config.issuesUrl);
  return lines.join('\n') + '\n';
}

function reportProblemText(opened) {
  return 'A diagnostics block (version numbers, platform, settings, licence state; no file contents, names or values) was copied to the clipboard. ' +
    (opened ? 'Paste it into the issue that opens in your browser, add what you did and what you expected, and attach a small example message made of invented data.'
      : 'Open ' + config.issuesUrl + ', create a new issue, paste the block and describe what you did and what you expected. Never attach a real patient message.');
}

module.exports = { diagnosticsBlock, licenceLine, reportProblemText, SETTING_KEYS };
