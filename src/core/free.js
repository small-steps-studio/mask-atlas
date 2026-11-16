'use strict';
// Free-text scanning (Pro): finds, inside running text, (1) values that were seen elsewhere in the
// same message (names, streets, towns, organisations, numbers) and (2) values with a recognisable
// shape (e-mail address, URL, IP address, SSN-like number, telephone number, written dates, a name
// after a title word). Every match is replaced through the run, so a value gets the same
// replacement here as in its structured field.
//
// The detectors are written without nested quantifiers; the ones that scan for '@' and URL starts
// walk the text by hand, so the time is linear in the length of the text.

const W = require('./words');
const { normName } = require('./run');

const MIN_NAME = 3;
const SEEN_ID_KINDS = new Set(['record', 'plan', 'licence', 'device', 'other', 'taxid', 'msgid', 'routing', 'id']);

// Lower-cased text for the quick "can this value occur here" test. The case-insensitive regular
// expressions fold a few letters that toLowerCase keeps apart (long s, final sigma, micro sign);
// they are folded here too, so that the quick test never rules out a text the expression matches.
const FOLD_PAIRS = [[String.fromCharCode(0x17f), 's'], [String.fromCharCode(0x3c2), String.fromCharCode(0x3c3)], [String.fromCharCode(0xb5), String.fromCharCode(0x3bc)]];
function foldLow(s) {
  let r = s.toLowerCase();
  for (const [from, to] of FOLD_PAIRS) if (r.indexOf(from) !== -1) r = r.split(from).join(to);
  return r;
}
const DIGIT_SEPARATOR = /[\s().\-/]/;
function isDigit(ch) { return ch !== undefined && ch >= '0' && ch <= '9'; }

/**
 * The places of a telephone or SSN-like number in `text`: the digits of `tail` with up to two
 * separators (space, dot, hyphen, slash, parentheses) between neighbours, an optional "+1" or "1"
 * country code in front, no further digit directly before or after. [[start, end], ...], left to
 * right, not overlapping. A walk by hand: a regular expression of this shape costs far more to
 * build for every number of every message than the walk costs to run.
 */
function digitSpans(text, tail) {
  const out = [];
  let from = 0;
  for (let i = text.indexOf(tail[0], from); i !== -1; i = text.indexOf(tail[0], from)) {
    from = i + 1;
    let j = i, k = 0, ok = true;
    for (;;) {
      if (text[j] !== tail[k]) { ok = false; break; }
      k++;
      if (k === tail.length) break;
      let p = j + 1, gap = 0;
      while (gap < 2 && p < text.length && DIGIT_SEPARATOR.test(text[p])) { p++; gap++; }
      j = p;
    }
    if (!ok) continue;
    const end = j + 1;
    if (isDigit(text[end])) continue;
    // the country code in front: "+1 ", "1 ", "+1" or "1", the longest one that is not preceded by a digit
    const c1 = text[i - 1], c2 = text[i - 2], c3 = text[i - 3];
    const sep = c1 !== undefined && /[\s.-]/.test(c1);
    const lengths = [];
    if (sep && c2 === '1' && c3 === '+') lengths.push(3);
    if (sep && c2 === '1') lengths.push(2);
    if (c1 === '1' && c2 === '+') lengths.push(2);
    if (c1 === '1') lengths.push(1);
    let start = -1;
    const floor = out.length ? out[out.length - 1][1] : 0;
    for (const n of lengths) if (i - n >= floor && !isDigit(text[i - n - 1])) { start = i - n; break; }
    if (start < 0) { if (isDigit(c1)) continue; start = i; }
    if (out.length && start < out[out.length - 1][1]) continue;
    out.push([start, end]);
    from = end;
  }
  return out;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }
function flexSpace(s) { return s.split(/\s+/).map(esc).join('\\s+'); }
const LOOK_BEFORE_WORD = '(?<![\\p{L}\\p{Nd}_])';
const LOOK_AFTER_WORD = '(?![\\p{L}\\p{Nd}_])';
const LOOK_BEFORE_ID = '(?<![A-Za-z0-9])';
const LOOK_AFTER_ID = '(?![A-Za-z0-9])';

function isEmailChar(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45; }

/** E-mail addresses by walking outwards from every '@'. */
function findEmails(text, out) {
  let from = 0;
  for (;;) {
    const at = text.indexOf('@', from);
    if (at === -1) break;
    from = at + 1;
    let s = at;
    while (s > 0 && at - s < 64 && isEmailChar(text.charCodeAt(s - 1))) s--;
    let e = at + 1;
    while (e < text.length && e - at < 255 && isEmailChar(text.charCodeAt(e))) e++;
    // the domain must contain a dot followed by letters; trailing dots and hyphens belong to the sentence
    let dom = text.slice(at + 1, e);
    while (dom.length && (dom.endsWith('.') || dom.endsWith('-'))) { dom = dom.slice(0, -1); e--; }
    if (s === at || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(dom)) continue;
    while (s < at && /[.+%_-]/.test(text[s]) && !/[A-Za-z0-9]/.test(text[s])) s++;
    out.push({ start: s, end: e, kind: 'email', category: 'email' });
  }
}

// Characters that end a web address: white space and the characters " ' < > \ ^ ` { } |
function isUrlStop(c) {
  if (c <= 32 || c === 127 || c === 160 || c === 0x2028 || c === 0x2029 || c === 0xfeff || c === 0x1680 || c === 0x202f || c === 0x205f || c === 0x3000 || (c >= 0x2000 && c <= 0x200a)) return true;
  return c === 34 || c === 39 || c === 60 || c === 62 || c === 92 || c === 94 || c === 96 || c === 123 || c === 125 || c === 124;
}

/** URLs that start with http://, https://, ftp:// or www. */
function findUrls(text, out) {
  const low = text.toLowerCase();
  for (const marker of ['http://', 'https://', 'ftp://', 'www.']) {
    let from = 0;
    for (;;) {
      const i = low.indexOf(marker, from);
      if (i === -1) break;
      from = i + marker.length;
      if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1]) && marker === 'www.') continue;
      let e = i + marker.length;
      while (e < text.length && e - i < 2000 && !isUrlStop(text.charCodeAt(e))) e++;
      const reached = e;
      while (e > i && /[.,;:!?)\]]/.test(text[e - 1])) e--;
      if (e - i > marker.length) {
        out.push({ start: i, end: e, kind: 'url', category: 'url' });
        // A marker inside this address belongs to it; continuing after it keeps the work linear.
        from = Math.max(from, reached);
      }
    }
  }
}

const IPV4_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g;
const IPV6_RE = /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,5}:(?![0-9A-Fa-f:])/g;
const SSN_RE = /(?<![\d-])\d{3}[- ]\d{2}[- ]\d{4}(?![\d-])/g;
const PHONE_RE = /(?<![\w+.-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])|(?<![\w+.-])(?:\+?1[\s.-]?)?\(\d{3}\)\d{3}[\s.-]?\d{4}(?![\w-])|(?<![\w+.-])\d{10}(?![\w-])/g;
const INTL_RE = /(?<![\w+.-])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?![\w-])/g;
const DATE_ISO_RE = /(?<![\d-])\d{4}-\d{2}-\d{2}(?![\d-])/g;
const DATE_SLASH_RE = /(?<![\d/.])\d{1,2}\/\d{1,2}\/\d{4}(?![\d/])/g;
const DATE_DOT_RE = /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?![\d.])/g;
const DATE_YMD_SLASH_RE = /(?<![\d/])\d{4}\/\d{1,2}\/\d{1,2}(?![\d/])/g;

function regexMatches(re, text, kind, category, out, accept) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (accept && !accept(m)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, kind: kind, category: category });
  }
}

const TITLE_RE = new RegExp('(?<![\\p{L}\\p{Nd}])(?:' + W.TITLE_WORDS.filter(function (w) { return w.length > 2 || w === 'Dr' || w === 'Mr' || w === 'Ms'; }).join('|') + ')\\.?[ \\t]+', 'giu');
const RELATION_RE = /(?<![\p{L}\p{Nd}])(?:wife|husband|spouse|partner|son|daughter|mother|father|mom|dad|brother|sister|grandmother|grandfather|grandson|granddaughter|aunt|uncle|neighbou?r|friend|caller|guardian|patient|pt|mr|mrs|ms)[ \t]+/giu;

function nameTokensAfter(text, from, maxTokens, requireMixedCase) {
  const re = /([\p{Lu}][\p{L}'’-]*)(?:[ \t]+|$)/uy;
  const tokens = [];
  let pos = from;
  while (tokens.length < maxTokens) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) break;
    const word = m[1];
    const low = word.toLowerCase();
    if (W.NOT_A_NAME.indexOf(low) !== -1 || low.length < 2) break;
    if (requireMixedCase && word === word.toUpperCase()) break;
    tokens.push({ start: pos, end: pos + word.length, text: word });
    pos += m[0].length;
    if (m[0].length === word.length) break;
  }
  return tokens;
}

function findTitleNames(text, out) {
  TITLE_RE.lastIndex = 0;
  let m;
  while ((m = TITLE_RE.exec(text)) !== null) {
    const from = m.index + m[0].length;
    const tokens = nameTokensAfter(text, from, 3, false);
    if (tokens.length) out.push({ start: tokens[0].start, end: tokens[tokens.length - 1].end, kind: 'fullname', category: 'names' });
  }
  RELATION_RE.lastIndex = 0;
  while ((m = RELATION_RE.exec(text)) !== null) {
    const from = m.index + m[0].length;
    const tokens = nameTokensAfter(text, from, 2, true);
    if (tokens.length) out.push({ start: tokens[0].start, end: tokens[tokens.length - 1].end, kind: 'fullname', category: 'names' });
  }
}

// An identifier written after a label ("member VM-1234567", "serial number SN-0042") is found by the label.
const LABEL_RE = /(?<![\p{L}\p{Nd}])(member(?:\s+(?:id|number|no\.?))?|policy(?:\s+(?:number|no\.?))?|subscriber(?:\s+id)?|group(?:\s+(?:number|no\.?))?|account(?:\s+(?:number|no\.?))?|acct|mrn|medical\s+record(?:\s+number)?|ssn|social\s+security(?:\s+number)?|npi|licen[cs]e(?:\s+(?:number|no\.?))?|claim(?:\s+(?:number|no\.?|id))?|visit(?:\s+(?:number|no\.?))?|order(?:\s+(?:number|no\.?))?|case(?:\s+(?:number|no\.?))?|reference(?:\s+(?:number|no\.?))?|ref|serial(?:\s+(?:number|no\.?))?|s\/n|device(?:\s+id)?|patient\s+id|insurance\s+id|employee\s+id|badge|passport|vin|plate)(?:\s+(?:is|was|shows?))?\s{0,3}[:#=]?\s{0,3}([A-Za-z0-9][A-Za-z0-9_.\/-]{3,39})/giu;

function labelKind(label) {
  const l = label.toLowerCase();
  if (/^(ssn|social)/.test(l)) return 'ssn';
  if (/^(member|policy|subscriber|group|insurance)/.test(l)) return 'plan';
  if (/^(npi|licen)/.test(l)) return 'licence';
  if (/^(serial|s\/n|device|vin|plate)/.test(l)) return 'device';
  if (/^(employee|badge|passport)/.test(l)) return 'other';
  return 'record';
}

function findLabelled(text, out) {
  LABEL_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_RE.exec(text)) !== null) {
    const token = m[2];
    if (!/\d/.test(token) || /^\d{4}-\d{2}-\d{2}$/.test(token) || token.length < 4) continue;
    const kind = labelKind(m[1]);
    const start = m.index + m[0].length - token.length;
    out.push({ start: start, end: start + token.length, kind: kind, category: kind });
  }
}

/** The pattern detectors alone: [{ start, end, kind, category }]. */
function findPatterns(text, options) {
  const o = options || {};
  const out = [];
  if (text.length < 5) return out;
  findEmails(text, out);
  findUrls(text, out);
  regexMatches(IPV4_RE, text, 'ip', 'ip', out, function (m) { return m[1] <= 255 && m[2] <= 255 && m[3] <= 255 && m[4] <= 255; });
  regexMatches(IPV6_RE, text, 'ip', 'ip', out);
  regexMatches(SSN_RE, text, 'ssn', 'ssn', out);
  regexMatches(PHONE_RE, text, 'phone', 'phone', out);
  regexMatches(INTL_RE, text, 'phone', 'phone', out, function (m) { const n = m[0].replace(/\D/g, '').length; return n >= 8 && n <= 15; });
  if (o.dates !== false) {
    regexMatches(DATE_ISO_RE, text, 'date', 'dates', out);
    regexMatches(DATE_SLASH_RE, text, 'date', 'dates', out);
    regexMatches(DATE_YMD_SLASH_RE, text, 'date', 'dates', out);
    regexMatches(DATE_DOT_RE, text, 'date', 'dates', out);
  }
  if (o.titles !== false) { findTitleNames(text, out); findLabelled(text, out); }
  return out;
}

/** Keeps the earliest and then the longest of overlapping matches. */
function resolve(matches) {
  matches.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
  const kept = [];
  let end = -1;
  for (const m of matches) { if (m.start >= end) { kept.push(m); end = m.end; } }
  return kept;
}

/** The set of values seen in one message (or bundle, interchange); built from the structured hits. */
function createSeen() {
  const names = new Map();     // lower-case token -> { kind, original, exact }
  const phrases = new Map();   // normalised phrase -> { kind, original }  (streets, towns, organisations)
  const ids = new Map();       // lower-case id -> { kind, original }
  const digitsSeen = new Map(); // digits -> { kind, original } for phones and SSN-like numbers
  let compiled = null;

  function addName(kind, token) {
    const t = token.trim();
    if (t.length < MIN_NAME || !/\p{L}/u.test(t)) return;
    const low = t.toLowerCase();
    if (W.TITLE_WORDS.some(function (w) { return w.toLowerCase() === low; }) || W.SUFFIX_WORDS.indexOf(low) !== -1) return;
    if (!names.has(low)) names.set(low, { kind: kind, original: t, exact: W.COMMON_WORD_NAMES.indexOf(low) !== -1 });
    compiled = null;
  }

  function add(kind, original) {
    const text = String(original).trim();
    if (!text) return;
    switch (kind) {
      case 'family': case 'given': case 'fullname':
        for (const part of text.split(/[\s,]+/)) {
          addName(kind, part);
          if (/[-–]/.test(part)) for (const sub of part.split(/[-–]/)) addName(kind, sub);
        }
        break;
      case 'org': case 'place': case 'street': case 'city':
        if (text.length >= 4 && /\p{L}/u.test(text)) { phrases.set(normName(text), { kind: kind, original: text }); compiled = null; }
        break;
      case 'phone': case 'ssn': {
        const d = text.replace(/\D/g, '');
        if (d.length >= 7 && d.length <= 15) { digitsSeen.set(d, { kind: kind, original: text }); compiled = null; }
        break;
      }
      default:
        if (SEEN_ID_KINDS.has(kind) && text.length >= 5 && /\d/.test(text)) { ids.set(text.toLowerCase(), { kind: kind, original: text }); compiled = null; }
    }
  }

  // ---- matching ---------------------------------------------------------------------------------
  //
  // A message holds a few dozen seen values, an interchange or bundle of a whole batch holds
  // hundreds of thousands. One regular expression over all of them, tried on every text, would make
  // the time grow with the square of the batch. Instead every value is filed under its first word (its
  // head); a text is cut into words, and only the values whose head is one of its words are compared.
  // A value can only match where one of the words of the text starts and equals its head, so
  // nothing is missed by looking only there.

  const WORD_RUN = /[\p{L}\p{Nd}_]+/gu;
  const ID_RUN = /[A-Za-z0-9]+/g;
  const WORD_CHAR = /[\p{L}\p{Nd}_]/u;
  const ID_CHAR = /[A-Za-z0-9]/;
  const HEAD_OF_WORD = /^[\p{L}\p{Nd}_]+/u;
  const HEAD_OF_ID = /^[A-Za-z0-9]+/;

  function addTo(map, key, value) { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); }
  function longestFirst(map) { for (const list of map.values()) list.sort(function (a, b) { return b.text.length - a.text.length; }); }
  // Values that share a first word (every identifier of a family such as MR-...) are grouped by length, and a text is compared with one
  // slice per length instead of with every value.
  function byLength(heads) {
    const out = new Map();
    for (const [head, list] of heads) {
      const groups = new Map();
      for (const item of list) {
        let g = groups.get(item.text.length);
        if (!g) { g = new Map(); groups.set(item.text.length, g); }
        if (!g.has(item.text)) g.set(item.text, item.entry);
      }
      out.set(head, { lengths: Array.from(groups.keys()).sort(function (a, b) { return b - a; }), groups: groups });
    }
    return out;
  }

  function compile() {
    const nameHeads = new Map(), phraseHeads = new Map(), idHeads = new Map();
    const exactList = [];
    // A value that starts with a mark (an apostrophe, a hash, a bracket) is filed under its first word as well; `pre` is what stands in front of that word.
    const loose = { names: new Map(), phrases: new Map(), ids: new Map() };
    const FIRST_WORD = /[\p{L}\p{Nd}_]+/u;
    const FIRST_ID_WORD = /[A-Za-z0-9]+/;
    for (const [low, e] of names) {
      if (e.exact) { exactList.push(low); continue; }
      const folded = foldLow(low);
      const head = HEAD_OF_WORD.exec(folded);
      if (head) addTo(nameHeads, head[0], { text: folded, entry: e });
      else { const m = FIRST_WORD.exec(folded); if (m) addTo(loose.names, m[0], { text: folded, pre: folded.slice(0, m.index), entry: e }); }
    }
    for (const [key, e] of phrases) {
      const words = key.split(/\s+/).filter(Boolean).map(foldLow);
      if (!words.length) continue;
      const head = HEAD_OF_WORD.exec(words[0]);
      const item = { text: key, words: words, entry: e };
      if (head) addTo(phraseHeads, head[0], item);
      else { const m = FIRST_WORD.exec(words[0]); if (m) { item.pre = words[0].slice(0, m.index); addTo(loose.phrases, m[0], item); } }
    }
    for (const [low, e] of ids) {
      const head = HEAD_OF_ID.exec(low);
      if (head) addTo(idHeads, head[0], { text: low, entry: e });
      else { const m = FIRST_ID_WORD.exec(low); if (m) addTo(loose.ids, m[0], { text: low, pre: low.slice(0, m.index), entry: e }); }
    }
    longestFirst(phraseHeads); longestFirst(loose.names); longestFirst(loose.phrases); longestFirst(loose.ids);
    const tails = new Map();      // the digits to look for -> entry
    const lengths = new Set();
    for (const [d, e] of digitsSeen) {
      const tail = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
      if (!tails.has(tail)) tails.set(tail, e);
      lengths.add(tail.length);
    }
    const exactForms = [];
    for (const low of exactList) { const o = names.get(low).original; exactForms.push(o, o.toUpperCase()); }
    compiled = {
      nameHeads: byLength(nameHeads), phraseHeads: phraseHeads, idHeads: byLength(idHeads), tails: tails, lengths: Array.from(lengths),
      exact: exactForms.length ? { forms: Array.from(new Set(exactForms)), re: null } : null,
      loose: { names: loose.names, phrases: loose.phrases, ids: loose.ids }
    };
    return compiled;
  }

  function entryCategory(entry) {
    return entry.kind === 'family' || entry.kind === 'given' || entry.kind === 'fullname' ? 'names'
      : entry.kind === 'org' || entry.kind === 'place' ? 'other' : entry.kind === 'street' || entry.kind === 'city' ? 'addresses' : entry.kind === 'phone' ? 'phone' : entry.kind === 'ssn' ? 'ssn' : 'other';
  }
  function push(out, start, end, entry) { out.push({ start: start, end: end, kind: entry.kind, category: entryCategory(entry), original: entry.original, seen: true }); }

  /** Does `text` hold `want` (already folded) at `at`, compared case-insensitively? */
  function sameAt(text, at, want) {
    if (at + want.length > text.length) return false;
    return foldLow(text.slice(at, at + want.length)) === want;
  }

  /** Matches of the seen values in `text`. With `distinctiveOnly` only numbers, ids and e-mail are looked for. */
  function find(text, distinctiveOnly) {
    const out = [];
    if (!text || (!names.size && !phrases.size && !ids.size && !digitsSeen.size)) return out;
    const c = compiled || compile();

    if (!distinctiveOnly && (c.nameHeads.size || c.phraseHeads.size || c.loose.names.size || c.loose.phrases.size || c.exact)) {
      let nameEnd = 0, phraseEnd = 0;
      WORD_RUN.lastIndex = 0;
      let m;
      while ((m = WORD_RUN.exec(text)) !== null) {
        const head = foldLow(m[0]);
        const at = m.index;
        // values that start with a mark come first: they start in front of this word, so they are the leftmost match
        const looseNames = c.loose.names.get(head);
        if (looseNames) {
          for (const item of looseNames) {
            const start = at - item.pre.length, end = start + item.text.length;
            if (start < 0 || start < nameEnd || end > text.length || !sameAt(text, start, item.text)) continue;
            if (start > 0 && WORD_CHAR.test(text[start - 1])) continue;
            if (end < text.length && WORD_CHAR.test(text[end])) continue;
            push(out, start, end, item.entry); nameEnd = end; break;
          }
        }
        const loosePhrases = c.loose.phrases.get(head);
        if (loosePhrases) {
          for (const item of loosePhrases) {
            const start = at - item.pre.length;
            if (start < 0 || start < phraseEnd || (start > 0 && WORD_CHAR.test(text[start - 1]))) continue;
            const end = phraseEndAt(text, start, item.words);
            if (end < 0) continue;
            push(out, start, end, item.entry); phraseEnd = end; break;
          }
        }
        if (at >= nameEnd) {
          const g = c.nameHeads.get(head);
          if (g) {
            for (const len of g.lengths) {
              const end = at + len;
              if (end > text.length) continue;
              const entry = g.groups.get(len).get(foldLow(text.slice(at, end)));
              if (!entry) continue;
              if (end < text.length && WORD_CHAR.test(text[end])) continue;
              push(out, at, end, entry); nameEnd = end; break;
            }
          }
        }
        if (at >= phraseEnd) {
          const list = c.phraseHeads.get(head);
          if (list) {
            for (const item of list) {
              const end = phraseEndAt(text, at, item.words);
              if (end < 0) continue;
              push(out, at, end, item.entry); phraseEnd = end; break;
            }
          }
        }
      }
      if (c.exact) {
        if (!c.exact.re) {
          const sorted = c.exact.forms.slice().sort(function (a, b) { return b.length - a.length; });
          c.exact.re = new RegExp('(?<![\\p{L}\\p{Nd}_])(?:' + sorted.map(esc).join('|') + ')(?![\\p{L}\\p{Nd}_])', 'gu');
        }
        if (c.exact.forms.some(function (f) { return text.indexOf(f) !== -1; })) {
          c.exact.re.lastIndex = 0;
          while ((m = c.exact.re.exec(text)) !== null) {
            if (m[0].length === 0) { c.exact.re.lastIndex++; continue; }
            const entry = names.get(m[0].toLowerCase());
            if (entry) push(out, m.index, m.index + m[0].length, entry);
          }
        }
      }
    }

    if (c.idHeads.size || c.loose.ids.size) {
      let idEnd = 0;
      ID_RUN.lastIndex = 0;
      let m;
      while ((m = ID_RUN.exec(text)) !== null) {
        const at = m.index;
        const word = m[0].toLowerCase();
        const looseIds = c.loose.ids.get(word);
        if (looseIds) {
          for (const item of looseIds) {
            const start = at - item.pre.length, end = start + item.text.length;
            if (start < 0 || start < idEnd || end > text.length || text.slice(start, end).toLowerCase() !== item.text) continue;
            if (start > 0 && ID_CHAR.test(text[start - 1])) continue;
            if (end < text.length && ID_CHAR.test(text[end])) continue;
            push(out, start, end, item.entry); idEnd = end; break;
          }
        }
        const g = at >= idEnd ? c.idHeads.get(word) : null;
        if (g) {
          for (const len of g.lengths) {
            const end = at + len;
            if (end > text.length) continue;
            const entry = g.groups.get(len).get(text.slice(at, end).toLowerCase());
            if (!entry) continue;
            if (end < text.length && ID_CHAR.test(text[end])) continue;
            push(out, at, end, entry); idEnd = end; break;
          }
        }
      }
    }

    if (c.tails.size) {
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 7) {
        const found = new Set();
        for (const len of c.lengths) {
          for (let i = 0; i + len <= digits.length; i++) {
            const piece = digits.substr(i, len);
            if (c.tails.has(piece)) found.add(piece);
          }
        }
        for (const tail of found) for (const span of digitSpans(text, tail)) push(out, span[0], span[1], c.tails.get(tail));
      }
    }
    return out;
  }

  /** The end of a phrase (its words separated by white space) that starts at `at` as a whole word, or -1. */
  function phraseEndAt(text, at, words) {
    let pos = at;
    for (let i = 0; i < words.length; i++) {
      if (!sameAt(text, pos, words[i])) return -1;
      pos += words[i].length;
      if (i < words.length - 1) {
        let q = pos;
        while (q < text.length && /\s/.test(text[q])) q++;
        if (q === pos) return -1;
        pos = q;
      }
    }
    if (pos < text.length && WORD_CHAR.test(text[pos])) return -1;
    return pos;
  }

  return { add: add, find: find, size: function () { return names.size + phrases.size + ids.size + digitsSeen.size; } };
}

/**
 * Replaces the identifiers found in `text`. `opts`: seen (createSeen), run, person, patterns
 * (default true), distinctiveOnly (only numbers/ids/e-mail/URL from the seen set and patterns),
 * path (for the statistics), scanOnly (count, do not replace). Returns { text, count }.
 */
function scanText(text, opts) {
  const o = opts || {};
  const run = o.run;
  if (typeof text !== 'string' || text.length < 3) return { text: text, count: 0 };
  let matches = [];
  if (o.patterns !== false) {
    matches = findPatterns(text, { dates: o.dates, titles: !o.distinctiveOnly });
    if (o.distinctiveOnly) matches = matches.filter(function (m) { return m.kind === 'email' || m.kind === 'ssn' || m.kind === 'ip'; });
  }
  if (o.seen) {
    const found = o.seen.find(text, o.distinctiveOnly === true);
    for (const m of found) {
      matches.push(m);
      // "Family, Given": a capitalised word after a seen family name and a comma is a given name
      if (m.kind === 'family' && !o.distinctiveOnly) {
        const after = /^,[ \t]*([\p{Lu}][\p{L}'\u2019-]{2,})/u.exec(text.slice(m.end, m.end + 60));
        if (after && W.NOT_A_NAME.indexOf(after[1].toLowerCase()) === -1 && after[1] !== after[1].toUpperCase()) {
          const start = m.end + after[0].length - after[1].length;
          matches.push({ start: start, end: start + after[1].length, kind: 'given', category: 'names' });
        }
      }
    }
  }
  matches = resolve(matches);
  if (!matches.length) return { text: text, count: 0 };
  let out = '';
  let last = 0;
  let count = 0;
  for (const m of matches) {
    const original = text.slice(m.start, m.end);
    if (o.scanOnly && o.known && o.known(original)) continue;
    let replacement = original;
    if (m.kind === 'date') {
      if (o.scanOnly) replacement = original;
      else {
        const shifted = run.shift('written', original, o.person);
        replacement = shifted === null ? run.maskText(original) : shifted;
      }
    } else if (!o.scanOnly) {
      // a seen id keeps the replacement of its stored spelling; names, phones and the rest use the matched text
      replacement = run.value(m.kind, m.seen && SEEN_ID_KINDS.has(m.kind) ? m.original : original);
    }
    if (replacement !== original || o.scanOnly) {
      run.count(m.category, (o.path || 'text') + ' (free text)', original, replacement !== original);
      count++;
      out += text.slice(last, m.start) + replacement;
      last = m.end;
    }
  }
  out += text.slice(last);
  return { text: out, count: count };
}

module.exports = { createSeen, scanText, findPatterns, findEmails, findUrls, resolve, digitSpans, foldLow };
