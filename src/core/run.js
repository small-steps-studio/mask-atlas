'use strict';
// A run: the state shared by every message, file and format processed together. It holds the key,
// the registry that keeps replacements consistent (and different for different originals), the
// per-person date offsets and the statistics of the report. Two modes:
//   mask       fixed pattern, letters X and digits 9, same length (free tier; no registry)
//   pseudonym  invented names, addresses, e-mail; keyed permutations for numbers; dates shifted
//
// Nothing here touches the editor, the file system or the network.

const K = require('./keyed');
const W = require('./words');
const D = require('./dates');

const CATEGORIES = [
  ['names', 'Names'], ['addresses', 'Addresses'], ['dates', 'Dates'], ['phone', 'Phone and fax numbers'], ['email', 'E-mail addresses'],
  ['ssn', 'SSN-like numbers'], ['record', 'Medical record and account numbers'], ['plan', 'Plan and certificate numbers'], ['licence', 'Licence numbers'],
  ['device', 'Vehicle and device identifiers'], ['url', 'URLs'], ['ip', 'IP addresses'], ['biometric', 'Biometric and photo references'],
  ['other', 'Other unique identifiers']
];

const CATEGORY_OF = {
  family: 'names', given: 'names', fullname: 'names', org: 'other', place: 'other', street: 'addresses', city: 'addresses', zip: 'addresses', addrtext: 'addresses',
  geo: 'addresses', date: 'dates', phone: 'phone', email: 'email', ssn: 'ssn', url: 'url', ip: 'ip', record: 'record', plan: 'plan', licence: 'licence', device: 'device',
  other: 'other', routing: 'other', msgid: 'other', taxid: 'other', binary: 'biometric', ref: 'other', freetext: 'other'
};

const MAX_ENTRIES = 1500000;
const MAX_PERSONS = 2000000;

function maskText(s) {
  return String(s).replace(/\p{L}/gu, 'X').replace(/\p{Nd}/gu, '9');
}

/** Fixed-pattern mask of a FHIR reference: the resource type stays (it is not an identifier), the id and host are masked. */
function maskRef(text) {
  if (/^[A-Z][A-Za-z]+$/.test(text) || text[0] === '#') return text;
  let m = /^(urn:(?:uuid|oid):)(.+)$/i.exec(text);
  if (m) return m[1] + maskText(m[2]);
  m = /^([A-Z][A-Za-z]+)\?(.*)$/s.exec(text);
  if (m) return m[1] + '?' + maskText(m[2]);
  m = /^(.*?)([A-Z][A-Za-z]+)\/([^/?#]+)((?:\/_history\/[^/?#]+)?)$/.exec(text);
  if (m) return maskText(m[1]) + m[2] + '/' + maskText(m[3]) + (m[4] ? '/_history/' + maskText(m[4].slice('/_history/'.length)) : '');
  return maskText(text);
}

function titleCase(s) {
  return s.replace(/(^|[-'’ ])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); });
}

function restyle(out, original) {
  const letters = original.replace(/[^\p{L}]/gu, '');
  // a script without letter case (Chinese, Japanese, ...) has no capitals to follow
  const cased = letters !== letters.toLowerCase() || letters !== letters.toUpperCase();
  if (cased && letters.length >= 2 && letters === letters.toUpperCase()) return out.toUpperCase();
  if (cased && letters.length >= 2 && letters === letters.toLowerCase()) return out.toLowerCase();
  return titleCase(out);
}

function normName(s) { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Replaces the digits of `template` one by one with `digits` (same count expected). */
function reflow(template, digits) {
  let i = 0;
  return template.replace(/\d/g, function () { const c = digits[i]; i++; return c === undefined ? '0' : c; });
}

function createRun(opts) {
  const o = opts || {};
  const mode = o.mode === 'mask' ? 'mask' : 'pseudonym';
  const key = o.key || K.randomKey();
  const userRules = o.userRules || null;
  const options = Object.assign({
    keepEnvelope: false, maskOrganisations: true, shiftDates: true, dateOrder: 'mdy', freeText: true, recordMap: true
  }, o.options || {});

  // One table of the invented words in use for every kind (family and given names, towns, streets, organisations, hosts, e-mail
  // addresses): no two different originals share a replacement, whatever their kind.
  const used = new Map();
  const buckets = { family: bucket('family'), given: bucket('given'), city: bucket('city'), street: bucket('street'), org: bucket('org'), host: bucket('host'), email: bucket('email') };
  function bucket(name) { return { name: name, map: new Map() }; }
  const kept = new Set();
  const entries = new Map();          // 'class|norm' -> [class, original, replacement]
  let entriesFull = false;
  const persons = new Map();
  let defaultPerson = null;
  const stats = { total: 0, byCategory: new Map(), byPath: new Map(), units: 0, filesChanged: 0, filesUnchanged: 0, freeTextFields: 0, freeTextRead: 0, freeTextHits: 0, unparsedDates: 0, keptByRule: 0, keptPaths: new Map() };

  function assign(b, norm, build) {
    const have = b.map.get(norm);
    if (have !== undefined) return have;
    for (let attempt = 0; attempt < 5000; attempt++) {
      const out = build(attempt);
      const low = out.toLowerCase();
      if (low === norm) continue;
      const owner = used.get(low);
      const id = b.name + '|' + norm;
      if (owner === undefined || owner === id) { used.set(low, id); b.map.set(norm, out); return out; }
    }
    throw new Error('the list of invented names ran out of candidates');
  }

  function digest(tag, norm, attempt) { return K.prf(key, [tag, norm, attempt]); }
  function pick(list, d, at) { return list[d.readUInt16BE(at) % list.length]; }

  function familyWord(norm) {
    return assign(buckets.family, norm, function (a) {
      const d = digest('family', norm, a);
      let w = pick(W.FAMILY_ROOT, d, 0) + pick(W.FAMILY_MIDDLE, d, 2) + pick(W.FAMILY_END, d, 4);
      if (a >= 6) w += pick(W.FAMILY_ROOT, d, 6).toLowerCase() + pick(W.FAMILY_END, d, 8);
      return titleCase(w);
    });
  }

  function givenWord(norm) {
    return assign(buckets.given, norm, function (a) {
      const d = digest('given', norm, a);
      let w = pick(W.GIVEN_ONSET, d, 0) + pick(W.GIVEN_MIDDLE, d, 2) + pick(W.GIVEN_END, d, 4);
      if (a >= 6) w += pick(W.GIVEN_MIDDLE, d, 6) + pick(W.GIVEN_END, d, 8);
      return titleCase(w);
    });
  }

  function cityWord(norm) {
    return assign(buckets.city, norm, function (a) {
      const d = digest('city', norm, a);
      let w = pick(W.FAMILY_ROOT, d, 0) + pick(W.TOWN_END, d, 2);
      if (a >= 4) w += ' ' + pick(W.TOWN_EXTRA, d, 4);
      if (a >= 12) w += ' ' + pick(W.FAMILY_ROOT, d, 6);
      return titleCase(w);
    });
  }

  function streetWord(norm) {
    return assign(buckets.street, norm, function (a) {
      const d = digest('street', norm, a);
      let w = pick(W.FAMILY_ROOT, d, 0) + pick(W.FAMILY_MIDDLE, d, 2) + pick(W.TOWN_END, d, 4);
      if (a >= 6) w += ' ' + pick(W.FAMILY_ROOT, d, 6);
      return titleCase(w);
    });
  }

  function hostWord(norm) {
    return assign(buckets.host, norm, function (a) {
      const d = digest('host', norm, a);
      let w = (pick(W.FAMILY_ROOT, d, 0) + pick(W.FAMILY_END, d, 2)).toLowerCase();
      if (a >= 4) w += '-' + pick(W.FAMILY_ROOT, d, 4).toLowerCase();
      if (a >= 10) w += (d.readUInt16BE(6) % 1000);
      return w;
    });
  }

  function orgWord(norm) {
    return assign(buckets.org, norm, function (a) {
      const d = digest('org', norm, a);
      let w = pick(W.FAMILY_ROOT, d, 0) + pick(W.FAMILY_END, d, 2);
      if (a >= 5) w += ' ' + pick(W.FAMILY_ROOT, d, 4) + pick(W.FAMILY_END, d, 6);
      return titleCase(w);
    });
  }

  function record(cls, original, replacement, kind, byRule) {
    if (!options.recordMap || original === replacement) return;
    if (entries.size >= MAX_ENTRIES) { entriesFull = true; return; }
    const k = (kind || cls) + '\u0000' + original;
    if (!entries.has(k)) entries.set(k, [cls, original, replacement, kind || cls, !!byRule]);
  }

  // ---- replacement makers (pseudonym mode) ----------------------------------------------------------

  function nameParts(text, partKind) {
    return text.split(/([-–])/).map(function (p) {
      if (p === '-' || p === '–' || p === '') return p;
      const n = normName(p);
      if (n.length < 1) return p;
      // an initial (a single letter, with or without a full stop): an ASCII letter becomes another letter, any other letter becomes an ASCII initial;
      // a single letter that is no ASCII letter and has no full stop is a whole name (a one-character family name) and gets an invented name
      if (/^[A-Za-z]\.?$/.test(p)) return K.permuteString(key, 'initial/' + partKind, p.replace('.', '')) + (p.endsWith('.') ? '.' : '');
      if (/^\p{L}\.$/u.test(p)) return String.fromCharCode(65 + K.index(key, 26, ['initial', partKind, p.replace('.', '')])) + '.';
      if (!/\p{L}/u.test(p)) return K.permuteString(key, 'id', p);
      const out = partKind === 'family' ? familyWord(n) : givenWord(n);
      return restyle(out, p);
    }).join('');
  }

  function fullName(text) {
    const trimmed = text.trim();
    if (!trimmed) return text;
    const comma = trimmed.indexOf(',');
    const tokens = trimmed.split(/\s+/);
    return tokens.map(function (t, i) {
      const bare = t.replace(/[.,]+$/, '');
      const tail = t.slice(bare.length);
      const low = bare.toLowerCase();
      if (!bare) return t;
      if (W.TITLE_WORDS.some(function (w) { return w.toLowerCase() === low; }) || W.SUFFIX_WORDS.indexOf(low) !== -1) return t;
      let partKind;
      const n = normName(bare);
      if (buckets.family.map.has(n) && !buckets.given.map.has(n)) partKind = 'family';
      else if (buckets.given.map.has(n) && !buckets.family.map.has(n)) partKind = 'given';
      else if (comma !== -1) partKind = trimmed.indexOf(t) < comma ? 'family' : 'given';
      else partKind = i === tokens.length - 1 || (i === tokens.length - 2 && W.SUFFIX_WORDS.indexOf(tokens[tokens.length - 1].replace(/[.,]+$/, '').toLowerCase()) !== -1) ? 'family' : 'given';
      return nameParts(bare, partKind) + tail;
    }).join(' ');
  }

  function orgName(text) {
    const norm = normName(text);
    const words = text.trim().split(/\s+/);
    const typeWords = words.filter(function (w) { return W.ORG_TYPES.some(function (t) { return t.toLowerCase() === w.toLowerCase().replace(/[.,]+$/, ''); }); });
    const base = orgWord(norm);
    const tail = typeWords.length ? typeWords.slice(-2).join(' ') : W.ORG_DEFAULT_TYPE;
    return restyle(base + ' ' + tail, text).replace(/\s+/g, ' ');
  }

  const UNIT_TAIL = /(,?\s*(?:apt|apartment|unit|suite|ste|floor|fl|room|rm|bldg|building)\.?\s*#?\s*[\w-]+|,?\s*#\s*[\w-]+)\s*$/i;

  function streetLine(text) {
    let rest = text.trim();
    if (!rest) return text;
    if (/^(?:apt|apartment|unit|suite|ste|floor|fl|room|rm|bldg|building)\.?\s*#?\s*[\w-]+$/i.test(rest)) { if (kept.size < 100000) kept.add(text.toLowerCase()); return text; }
    let unit = '';
    const um = UNIT_TAIL.exec(rest);
    if (um && um.index > 0) { unit = rest.slice(um.index); rest = rest.slice(0, um.index); }
    const po = /^(p\.?\s?o\.?\s*box|post office box|postfach)\s+(\S+)$/i.exec(rest);
    if (po) return restyle(po[1] + ' ' + K.permuteString(key, 'id', po[2]), text) + unit;
    const nm = /^(\d+[A-Za-z]?(?:\s?[-/]\s?\d+[A-Za-z]?)?)\s+(.*)$/.exec(rest);
    const number = nm ? nm[1] : '';
    const words = (nm ? nm[2] : rest).split(/\s+/).filter(Boolean);
    let type = '';
    if (words.length > 1) {
      const last = words[words.length - 1].replace(/[.,]+$/, '');
      const low = last.toLowerCase();
      if (W.STREET_TYPES.some(function (t) { return t.toLowerCase() === low; }) || W.STREET_ABBREVIATIONS[low]) { type = words.pop(); }
    }
    const nameNorm = normName(words.join(' '));
    const fake = nameNorm ? streetWord(nameNorm) : '';
    const numOut = number ? K.permuteString(key, 'id', number) : '';
    const out = [numOut, fake, type].filter(Boolean).join(' ');
    return restyle(out, text) + (unit ? unit.replace(/\d+/g, function (d) { return K.permuteString(key, 'id', d); }) : '');
  }

  function addressText(text) {
    return text.split(',').map(function (part, i) {
      const t = part.trim();
      if (!t) return part;
      const lead = part.slice(0, part.length - part.trimStart().length);
      if (/^[A-Za-z]{2}\s+\d{5}(-\d{4})?$/.test(t)) { const [st, z] = t.split(/\s+/); return lead + st + ' ' + K.permuteString(key, 'id', z); }
      if (/^\d{5}(-\d{4})?$/.test(t)) return lead + K.permuteString(key, 'id', t);
      if (/^[A-Za-z]{2}$/.test(t) && i > 0) return part;
      if (/^\d/.test(t) || i === 0) return lead + streetLine(t);
      return lead + restyle(cityWord(normName(t)), t);
    }).join(',');
  }

  function emailOf(text) {
    const norm = text.trim().toLowerCase();
    const out = assign(buckets.email, norm, function (a) {
      const d = digest('email', norm, a);
      const g = pick(W.GIVEN_ONSET, d, 0) + pick(W.GIVEN_MIDDLE, d, 2) + pick(W.GIVEN_END, d, 4);
      const f = pick(W.FAMILY_ROOT, d, 6) + pick(W.FAMILY_END, d, 8);
      const dom = ['mail', 'post', 'inbox', 'webmail', 'letters'][d.readUInt16BE(10) % 5];
      return (g + '.' + f).toLowerCase() + (a ? String(a) : '') + '@' + dom + '.example';
    });
    return out;
  }

  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

  function ipOf(text) {
    const m = IPV4.exec(text);
    if (m) {
      const octs = [1, 2, 3, 4].map(function (i) { return Number(m[i]); });
      if (octs.every(function (v) { return v <= 255; })) return octs.map(function (v, i) { return String(K.permute(key, 'ip4/' + i, 256, v)); }).join('.');
    }
    return text.replace(/[0-9a-fA-F]+/g, function (g, off, whole) {
      return K.permuteString(key, 'ip6/' + g.length, g, true);
    });
  }

  function urlOf(text) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(?:([^@/\s]*)@)?(\[[0-9a-fA-F:]+\]|[^/:?#\s]+)(:\d+)?([/?#].*)?$/s.exec(text);
    if (!m) return K.permuteString(key, 'id', text);
    const host = m[3];
    let newHost;
    if (IPV4.test(host)) newHost = ipOf(host);
    else if (host[0] === '[') newHost = '[' + ipOf(host.slice(1, -1)) + ']';
    else newHost = hostWord(host.toLowerCase()) + '.example';
    let path = m[5] || '';
    if (path) {
      const q = path.indexOf('?');
      const pathPart = q === -1 ? path : path.slice(0, q);
      const query = q === -1 ? '' : path.slice(q);
      const em = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/s.exec(pathPart);
      const stem = em[1].split('/').map(function (seg) {
        return /^([A-Z][a-z]+)+$/.test(seg) || /^(fhir|api|r4|r5|v[0-9]+|_history|_search|_format)$/i.test(seg) ? seg : K.permuteString(key, 'id', seg);
      }).join('/');
      const newQuery = query.replace(/([?&;#])([^=&;#]*)=([^&;#]*)/g, function (all, sep, name, value) { return sep + name + '=' + K.permuteString(key, 'id', value); });
      path = stem + (em[2] || '') + newQuery;
    }
    return (m[1] || '') + (m[2] !== undefined ? 'user@' : '') + newHost + (m[4] || '') + path;
  }

  const STANDARD_HOSTS = /(^|\.)(hl7\.org|fhir\.org|snomed\.info|loinc\.org|nlm\.nih\.gov|unitsofmeasure\.org|ihe\.net|who\.int|ama-assn\.org|cms\.gov|nucc\.org|nubc\.org|ncpdp\.org|x12\.org|dicom\.nema\.org|iso\.org|ietf\.org|w3\.org|ada\.org|acr\.org|icd10data\.com|cdc\.gov|fda\.gov|nih\.gov|ihtsdo\.org|ncbi\.nlm\.nih\.gov|terminology\.hl7\.org|hl7\.eu|ehealth\.gov\.au)$/i;

  /** True for the address of a standards body or terminology service (and for a bare IP address): it names no organisation and stays. */
  function isStandardSystem(text) {
    const m = /^(https?:\/\/)([^/:?#\s]+)(.*)$/i.exec(String(text));
    return !m || STANDARD_HOSTS.test(m[2]) || IPV4.test(m[2]);
  }

  /** A code system address: the host names the organisation and is replaced; well-known hosts and the path stay. */
  function systemOf(text) {
    const m = /^(https?:\/\/)([^/:?#\s]+)(.*)$/i.exec(text);
    if (!m || STANDARD_HOSTS.test(m[2]) || IPV4.test(m[2])) return text;
    return m[1] + hostWord(m[2].toLowerCase()) + '.example' + m[3];
  }

  function refOf(text) {
    if (/^[A-Z][A-Za-z]+$/.test(text)) return text;
    let m = /^(urn:(?:uuid|oid):)(.+)$/i.exec(text);
    if (m) return m[1] + K.permuteString(key, 'id', m[2]);
    if (text[0] === '#') return text;
    m = /^([A-Z][A-Za-z]+)\?(.*)$/s.exec(text);
    if (m) return m[1] + '?' + K.permuteString(key, 'id', m[2]);
    m = /^(.*?)([A-Z][A-Za-z]+)\/([^/?#]+)((?:\/_history\/[^/?#]+)?)$/.exec(text);
    if (m) {
      const head = m[1] ? urlOf(m[1].replace(/\/$/, '')) + '/' : '';
      return head + m[2] + '/' + K.permuteString(key, 'id', m[3]) + m[4];
    }
    if (/^https?:\/\//i.test(text)) return urlOf(text);
    return K.permuteString(key, 'id', text);
  }

  function phoneOf(text) {
    const digits = text.replace(/\D/g, '');
    if (!digits) return text;
    let lead = '';
    let core = digits;
    if (digits.length === 11 && digits[0] === '1') { lead = '1'; core = digits.slice(1); }
    const out = lead + K.permuteString(key, 'id', core);
    return reflow(text, out);
  }

  function ssnOf(text) {
    const digits = text.replace(/\D/g, '');
    if (!digits) return text;
    return reflow(text, K.permuteString(key, 'id', digits));
  }

  function geoOf(text, isLat) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
    if (!m) return text;
    const decimals = m[3] ? m[3].length : 0;
    const d = K.prf(key, ['geo', isLat ? 'lat' : 'lon', text]);
    const range = isLat ? 80 : 170;
    const u = (d.readUIntBE(0, 6) / 281474976710656) * 2 - 1;
    const v = u * range;
    let s = Math.abs(v).toFixed(decimals);
    if (decimals === 0 && s === text.replace('-', '')) s = String((Number(s) + 1) % range);
    return (v < 0 ? '-' : '') + s;
  }

  function filler(text) {
    const n = text.length;
    if (/^[A-Za-z0-9+/=\s]*$/.test(text)) {
      const pad = /=+$/.exec(text);
      const p = pad ? pad[0].length : 0;
      return 'A'.repeat(Math.max(0, n - p)) + '='.repeat(p);
    }
    return 'X'.repeat(n);
  }

  function generate(kind, original, extra) {
    switch (kind) {
      case 'family': return /\s/.test(original.trim()) ? fullName(original) : nameParts(original, 'family');
      case 'given': return /\s/.test(original.trim()) ? fullName(original) : nameParts(original, 'given');
      case 'fullname': return fullName(original);
      case 'org': case 'place': return orgName(original);
      case 'street': return streetLine(original);
      case 'addrtext': return addressText(original);
      case 'city': return restyle(cityWord(normName(original)), original);
      case 'phone': return phoneOf(original);
      case 'ssn': return ssnOf(original);
      case 'email': return emailOf(original);
      case 'url': return urlOf(original);
      case 'system': return systemOf(original);
      case 'ref': return refOf(original);
      case 'ip': return ipOf(original);
      case 'geo': return geoOf(original, extra && extra.lat);
      case 'binary': return filler(original);
      default: return K.permuteString(key, 'id', original); // zip, record, plan, licence, device, other, routing, msgid, taxid, id
    }
  }

  const CLASS_OF = { system: 'system', family: 'name', given: 'name', fullname: 'name', org: 'name', place: 'name', street: 'address', addrtext: 'address', city: 'address', phone: 'phone', ssn: 'ssn', email: 'email', url: 'url', ref: 'ref', ip: 'ip', geo: 'geo', binary: 'binary' };

  /** The replacement for `original` of `kind` ('date' kinds go through shift()). */
  function value(kind, original, extra) {
    const text = String(original);
    if (text === '' || !/[\p{L}\p{Nd}]/u.test(text)) return text;
    if (kind === 'org' || kind === 'place') { if (!options.maskOrganisations) return text; }
    if (mode === 'mask') {
      if (kind === 'system' && isStandardSystem(text)) return text; // a standard code system names no organisation
      return kind === 'binary' ? 'X'.repeat(text.length) : kind === 'ref' ? maskRef(text) : maskText(text);
    }
    let out = generate(kind, text, extra);
    // a format may have to change a replacement before it is written (a delimiter of the interchange inside it); the map records what is written
    if (extra && typeof extra.clean === 'function') out = extra.clean(out);
    if (out === text && (kind === 'system' || kind === 'ref') && kept.size < 100000) kept.add(text.toLowerCase());
    if (kind !== 'binary' && kind !== 'geo') record(kind === 'zip' ? 'id' : (CLASS_OF[kind] || 'id'), text, out, kind, !!(extra && extra.byRule));
    return out;
  }

  // ---- dates --------------------------------------------------------------------------------

  function offsetOf(ident) {
    const d = K.prf(key, ['offset', ident]);
    const magnitude = 60 + (d.readUInt32BE(0) % 671);
    return (d[4] & 1 ? -1 : 1) * magnitude;
  }

  function conflicting(person, strong) {
    for (const prefix of ['ssn:', 'id:']) {
      const mine = strong.filter(function (id) { return id.startsWith(prefix); });
      if (!mine.length) continue;
      const known = Array.from(person.strong).filter(function (id) { return id.startsWith(prefix); });
      if (known.length && !mine.some(function (id) { return person.strong.has(id); })) return true;
    }
    return false;
  }

  /** The date context of a patient: any of the identifiers finds the same person. */
  function person(idents) {
    const ids = (idents || []).filter(Boolean);
    const strong = ids.filter(function (id) { return !id.startsWith('name:'); });
    let p = null;
    for (const id of ids) {
      const found = persons.get(id);
      if (!found) continue;
      // a name alone does not join two people whose social security or record numbers differ
      if (id.startsWith('name:') && conflicting(found, strong)) continue;
      p = found; break;
    }
    if (!p) {
      if (!ids.length) {
        if (!defaultPerson) defaultPerson = { ident: '(no patient identifier)', offset: offsetOf('(default)') };
        return defaultPerson;
      }
      p = { ident: ids[0], offset: offsetOf(ids[0]), strong: new Set() };
    }
    for (const id of strong) p.strong.add(id);
    if (persons.size < MAX_PERSONS) for (const id of ids) if (!persons.has(id)) persons.set(id, p);
    return p;
  }

  /** Shifts a date in the given layout; returns null when it cannot be read as a date. */
  function shift(layoutName, text, p) {
    if (mode === 'mask') return maskText(text);
    if (!options.shiftDates) return text;
    const offset = (p || person([])).offset;
    switch (layoutName) {
      case 'hl7': return D.shiftHl7(text, offset);
      case 'iso': return D.shiftIso(text, offset);
      case 'd8': return D.shiftD8(text, offset);
      case 'rd8': return D.shiftRd8(text, offset);
      case 'yymmdd': return D.shiftYymmdd(text, offset);
      case 'written': return D.shiftWritten(text, offset, options.dateOrder);
      default: return null;
    }
  }

  // ---- statistics ---------------------------------------------------------------------------

  function count(category, path, sample, changed) {
    stats.total++;
    stats.byCategory.set(category, (stats.byCategory.get(category) || 0) + 1);
    const k = path + '\u0000' + category;
    let row = stats.byPath.get(k);
    if (!row) {
      if (stats.byPath.size >= 5000) return;
      row = { path: path, category: category, count: 0, changed: 0, shape: maskText(String(sample)).slice(0, 24) };
      stats.byPath.set(k, row);
    }
    row.count++;
    if (changed) row.changed++;
  }

  /** A field that a rule of the user's rule file keeps as it is (the places are counted, never the values). */
  function keepNote(path) {
    stats.keptByRule++;
    if (stats.keptPaths.has(path) || stats.keptPaths.size < 500) stats.keptPaths.set(path, (stats.keptPaths.get(path) || 0) + 1);
  }

  /** Copies of the counters, so that a file that has to be read again does not count twice. */
  function snapshotStats() {
    const s = Object.assign({}, stats);
    s.keptPaths = new Map(stats.keptPaths);
    s.byCategory = new Map(stats.byCategory);
    s.byPath = new Map(Array.from(stats.byPath, function (kv) { return [kv[0], Object.assign({}, kv[1])]; }));
    return s;
  }
  function restoreStats(s) {
    Object.assign(stats, s);
    stats.keptPaths = new Map(s.keptPaths);
    stats.byCategory = new Map(s.byCategory);
    stats.byPath = new Map(Array.from(s.byPath, function (kv) { return [kv[0], Object.assign({}, kv[1])]; }));
  }

  function exportRows() {
    const rows = [];
    for (const e of entries.values()) rows.push({ category: e[0], original: e[1], replacement: e[2], kind: e[3], byRule: e[4] === true });
    const seen = new Set();
    for (const p of persons.values()) {
      if (seen.has(p)) continue;
      seen.add(p);
      rows.push({ category: 'date shift', original: p.ident, replacement: (p.offset > 0 ? '+' : '') + p.offset + ' days' });
    }
    return { rows: rows, complete: !entriesFull };
  }

  /** Lower-case name tokens and identifier strings of this run, for the residual check. */
  function originalsIndex() {
    const names = new Set(), ids = new Set();
    for (const e of entries.values()) {
      const cls = e[0], orig = e[1], kind = e[3];
      if (cls === 'name' && (kind === 'org' || kind === 'place')) {
        const first = orig.split(/[^\p{L}\p{Nd}'’]+/u).filter(Boolean)[0] || '';
        const l = first.toLowerCase();
        if (l.length >= 6 && !W.COMMON_WORD_NAMES.includes(l) && !W.ORG_TYPES.some(function (w) { return w.toLowerCase() === l; }) && !W.NOT_A_NAME.includes(l) && !W.GENERIC_ORG_WORDS.includes(l)) names.add(l);
      } else if (cls === 'name') {
        for (const t of orig.split(/[^\p{L}\p{Nd}'’]+/u)) { const l = t.toLowerCase(); if (l.length >= 4 && !W.COMMON_WORD_NAMES.includes(l) && !W.ORG_TYPES.some(function (w) { return w.toLowerCase() === l; }) && !W.TITLE_WORDS.some(function (w) { return w.toLowerCase() === l; })) names.add(l); }
      } else if (cls === 'address') {
        for (const t of orig.split(/[^\p{L}\p{Nd}]+/u)) { const l = t.toLowerCase(); if (l.length >= 7 && /\p{L}/u.test(l) && !W.STREET_TYPES.some(function (w) { return w.toLowerCase() === l; })) names.add(l); }
      } else if (cls === 'system') {
        const mm = /^https?:\/\/([^/:?#\s]+)/i.exec(orig);
        if (mm) for (const t of mm[1].split(/[^\p{L}\p{Nd}]+/u)) { const l = t.toLowerCase(); if (l.length >= 5 && !/^(example|health|hospital|clinic|medical|systems|group)$/.test(l)) names.add(l); }
      } else if (cls === 'phone' || cls === 'ssn') {
        const d = orig.replace(/\D/g, ''); if (d.length >= 7) ids.add(d);
      } else if (cls === 'email' || cls === 'url') ids.add(orig.toLowerCase());
      else if (orig.length >= 5) ids.add(orig.toLowerCase());
    }
    return { names: names, ids: ids };
  }

  return {
    mode: mode, key: key, options: options, userRules: userRules, stats: stats, value: value, isStandardSystem: isStandardSystem, keepNote: keepNote, shift: shift, person: person, count: count, exportRows: exportRows,
    snapshotStats: snapshotStats, restoreStats: restoreStats, originalsIndex: originalsIndex, nameKnown: function (norm) { return { family: buckets.family.map.has(norm), given: buckets.given.map.has(norm) }; },
    isKept: function (t) { return kept.has(String(t).toLowerCase()); }, isEntriesFull: function () { return entriesFull; }, entryCount: function () { return entries.size; }, maskText: maskText
  };
}

module.exports = { createRun, maskText, restyle, normName, reflow, titleCase, CATEGORIES, CATEGORY_OF };
