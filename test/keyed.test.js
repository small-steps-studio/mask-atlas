'use strict';
// Keyed building blocks: HMAC from cached pads, the keyed permutation over numbers and strings,
// seed derivation, and the rule that no source file draws numbers from Math.random.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../src/core/keyed');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEY = Buffer.alloc(32, 0x5a);
const KEY2 = Buffer.alloc(32, 0xa5);
const rnd = mulberry32(20261112);
function randomBytes(n) { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); return b; }
function pad(n, w) { return String(n).padStart(w, '0'); }
function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }

function charClass(c) {
  if (c >= '0' && c <= '9') return 'd';
  if (c >= 'A' && c <= 'Z') return 'U';
  if (c >= 'a' && c <= 'z') return 'l';
  return c;
}
function shapeClass(s) { return Array.from(s).map(charClass).join(''); }

// ---- HMAC ----------------------------------------------------------------------------------

test('macOf equals HMAC-SHA256 for 600 random binary messages', () => {
  const key = randomBytes(32);
  const mac = K.macOf(key);
  for (let i = 0; i < 600; i++) {
    const msg = randomBytes(Math.floor(rnd() * 300));
    assert.ok(mac(msg).equals(hmac(key, msg)), 'message ' + i + ' of length ' + msg.length);
  }
});

test('macOf equals HMAC-SHA256 around the SHA-256 block boundaries', () => {
  const mac = K.macOf(KEY);
  for (const n of [0, 1, 31, 32, 33, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 191, 192, 193, 1000, 4096]) {
    const msg = Buffer.alloc(n, 0x41 + (n % 7));
    assert.ok(mac(msg).equals(hmac(KEY, msg)), 'length ' + n);
  }
});

test('macOf equals HMAC-SHA256 for string messages, including non-ASCII text', () => {
  const mac = K.macOf(KEY);
  const words = ['', 'a', 'Quillfeather|Alderiq', '1:a|2:bc|', String.fromCharCode(0xe9, 0x4e, 0x1f600 >> 10), 'tab\tand\nnewline', '日本語のテキスト', 'x'.repeat(300)];
  for (const w of words) assert.ok(mac(w).equals(hmac(KEY, w)), JSON.stringify(w.slice(0, 20)));
});

test('macOf equals HMAC-SHA256 for keys of 16, 32 and 64 bytes', () => {
  for (const len of [16, 32, 64]) {
    const key = randomBytes(len);
    const mac = K.macOf(key);
    for (let i = 0; i < 40; i++) {
      const msg = randomBytes(i * 7);
      assert.ok(mac(msg).equals(hmac(key, msg)), 'key length ' + len + ' message length ' + msg.length);
    }
  }
});

test('macOf is cached per key object and differs between keys', () => {
  const a = K.macOf(KEY), b = K.macOf(KEY), c = K.macOf(KEY2);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(!a('same').equals(c('same')));
  // the cached state is not consumed by use
  assert.ok(a('same').equals(a('same')));
});

test('prf is HMAC over length-labelled parts and keeps part boundaries apart', () => {
  assert.ok(K.prf(KEY, ['a', 'b']).equals(hmac(KEY, '1:a|1:b|')));
  assert.ok(K.prf(KEY, ['family', 'quill', 3]).equals(hmac(KEY, '6:family|5:quill|1:3|')));
  assert.ok(!K.prf(KEY, ['ab', 'c']).equals(K.prf(KEY, ['a', 'bc'])));
  assert.ok(!K.prf(KEY, ['a|b']).equals(K.prf(KEY, ['a', 'b'])));
  assert.ok(!K.prf(KEY, ['1:a|']).equals(K.prf(KEY, ['a'])));
  assert.equal(K.prf(KEY, ['x']).length, 32);
});

test('index stays in range, is deterministic and spreads evenly', () => {
  assert.equal(K.index(KEY, 1, ['x']), 0);
  assert.equal(K.index(KEY, 0, ['x']), 0);
  assert.equal(K.index(KEY, 7, ['x']), K.index(KEY, 7, ['x']));
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const v = K.index(KEY, 10, ['spread', i]);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 10);
    counts[v]++;
  }
  for (const c of counts) assert.ok(c > 1700 && c < 2300, 'bucket count ' + c);
  for (const n of [2, 3, 1000, 2 ** 31, 2 ** 40]) {
    const v = K.index(KEY, n, ['range', n]);
    assert.ok(v >= 0 && v < n);
  }
});

test('hexToken is lower-case hexadecimal of the requested length and keyed', () => {
  const t = K.hexToken(KEY, ['tag'], 6);
  assert.match(t, /^[0-9a-f]{12}$/);
  assert.equal(K.hexToken(KEY, ['tag']).length, 16);
  assert.notEqual(K.hexToken(KEY, ['tag'], 6), K.hexToken(KEY2, ['tag'], 6));
});

// ---- number permutation --------------------------------------------------------------------

test('permute is a bijection without fixed points on every small domain', () => {
  for (const n of [2, 3, 4, 5, 7, 10, 16, 17, 26, 100, 256, 257, 1000, 1025, 4096, 4097, 10000, 65536]) {
    const seen = new Set();
    for (let x = 0; x < n; x++) {
      const y = K.permute(KEY, 'dom', n, x);
      assert.ok(Number.isInteger(y) && y >= 0 && y < n, 'range for n=' + n + ' x=' + x);
      assert.notEqual(y, x, 'fixed point for n=' + n + ' x=' + x);
      seen.add(y);
    }
    assert.equal(seen.size, n, 'bijection for n=' + n);
  }
});

test('permute on a domain of two values swaps them; on one value it returns zero', () => {
  assert.equal(K.permute(KEY, 't', 2, 0), 1);
  assert.equal(K.permute(KEY, 't', 2, 1), 0);
  assert.equal(K.permute(KEY, 't', 1, 0), 0);
});

test('permute has no fixed point for sampled values of domains just below 2^32', () => {
  for (const n of [2 ** 32 - 1, 2 ** 32 - 5, 4000000007 % (2 ** 32), 3 * 10 ** 9, 10 ** 9]) {
    const seen = new Set();
    for (let i = 0; i < 1500; i++) {
      const x = Math.floor(rnd() * n);
      const y = K.permute(KEY, 'near', n, x);
      assert.ok(y >= 0 && y < n);
      assert.notEqual(y, x);
      seen.add(x + ':' + y);
    }
    assert.equal(seen.size >= 1499, true);
  }
});

test('permute is deterministic and depends on key and tweak', () => {
  const n = 100000;
  let differKey = 0, differTweak = 0;
  for (let x = 0; x < 300; x++) {
    const a = K.permute(KEY, 'one', n, x);
    assert.equal(a, K.permute(KEY, 'one', n, x));
    if (a !== K.permute(KEY2, 'one', n, x)) differKey++;
    if (a !== K.permute(KEY, 'two', n, x)) differTweak++;
  }
  assert.ok(differKey >= 295, 'different key: ' + differKey);
  assert.ok(differTweak >= 295, 'different tweak: ' + differTweak);
});

test('permute works on number domains up to 2^50 and keeps neighbours apart', () => {
  for (const n of [2 ** 33, 2 ** 40, 10 ** 12, 2 ** 50]) {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const y = K.permute(KEY, 'wide', n, i);
      assert.ok(Number.isInteger(y) && y >= 0 && y < n, 'range for n=' + n);
      seen.add(y);
    }
    assert.equal(seen.size, 1000, 'distinct outputs for n=' + n);
  }
});

test('permute works on BigInt domains beyond 2^50', () => {
  const n = 10n ** 30n;
  const seen = new Set();
  for (let i = 0n; i < 400n; i++) {
    const y = K.permute(KEY, 'huge', n, 10n ** 29n + i);
    assert.equal(typeof y, 'bigint');
    assert.ok(y >= 0n && y < n);
    seen.add(y);
  }
  assert.equal(seen.size, 400);
  assert.equal(K.permute(KEY, 'huge', n, 12345n), K.permute(KEY, 'huge', n, 12345n));
  assert.notEqual(K.permute(KEY, 'huge', n, 12345n), K.permute(KEY2, 'huge', n, 12345n));
  const edge = K.permute(KEY, 'huge', n, n - 1n);
  assert.ok(edge >= 0n && edge < n);
});

// ---- string permutation --------------------------------------------------------------------

test('permuteString is a bijection on all 4-digit strings, for two keys', () => {
  for (const key of [KEY, KEY2]) {
    const seen = new Set();
    for (let i = 0; i < 10000; i++) {
      const s = pad(i, 4);
      const t = K.permuteString(key, 'pin', s);
      assert.match(t, /^\d{4}$/);
      assert.notEqual(t, s);
      seen.add(t);
    }
    assert.equal(seen.size, 10000);
  }
});

test('permuteString is a bijection on AA..ZZ, aa..zz and mixed shapes', () => {
  const upper = [], lower = [], mixed = [];
  for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) {
    upper.push(String.fromCharCode(65 + a, 65 + b));
    lower.push(String.fromCharCode(97 + a, 97 + b));
  }
  for (let a = 0; a < 26; a++) for (let d = 0; d < 10; d++) mixed.push(String.fromCharCode(65 + a) + '-' + d);
  for (const list of [upper, lower, mixed]) {
    const seen = new Set();
    for (const s of list) {
      const t = K.permuteString(KEY, 'letters', s);
      assert.equal(shapeClass(t), shapeClass(s));
      assert.notEqual(t, s);
      seen.add(t);
    }
    assert.equal(seen.size, list.length);
  }
});

test('permuteString keeps digits, upper case, lower case and literals in place', () => {
  const samples = ['MR-4471920', 'ab12CD', 'X1-y2_Z3', '(312) 555-0141', '912-73-4408', 'A b C', 'a.b.c@mail.example', '12/34/5678', 'ACC20261105-0087',
    'Ünï-123-Ö', '  12  ', 'ID#99', 'v1.2.3', 'ZZ99zz'];
  for (const s of samples) {
    const t = K.permuteString(KEY, 'shape', s);
    assert.equal(t.length, s.length, s);
    for (let i = 0; i < s.length; i++) {
      const c = charClass(s[i]);
      if (c === 'd' || c === 'U' || c === 'l') assert.equal(charClass(t[i]), c, s + ' at ' + i);
      else assert.equal(t[i], s[i], 'literal in ' + s + ' at ' + i);
    }
    assert.notEqual(t, s, s);
  }
});

test('permuteString leaves strings without digits or ASCII letters untouched', () => {
  for (const s of ['', '---', '   ', String.fromCharCode(0xc4, 0xd6, 0xdc), '#$%&', String.fromCharCode(0x65e5, 0x672c)]) assert.equal(K.permuteString(KEY, 'x', s), s);
});

test('permuteString has no fixed point for random shapes below 2^32', () => {
  for (let i = 0; i < 3000; i++) {
    let s = '', domain = 1;
    for (;;) {
      const r = rnd();
      const radix = r < 0.5 ? 10 : 26;
      if (domain * radix >= 2 ** 32) break;
      domain *= radix;
      s += radix === 10 ? String(Math.floor(rnd() * 10)) : String.fromCharCode((rnd() < 0.5 ? 65 : 97) + Math.floor(rnd() * 26));
      if (rnd() < 0.15) s += '-';
      if (s.length > 14) break;
    }
    if (!s) continue;
    assert.notEqual(K.permuteString(KEY, 'fp', s), s, s);
  }
});

test('permuteString keeps a UUID a valid UUID and the same letter case', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (let i = 0; i < 300; i++) {
    const h = randomBytes(16).toString('hex');
    const u = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    const t = K.permuteString(KEY, 'uuid', u);
    assert.match(t, re);
    assert.notEqual(t, u);
    for (const at of [8, 13, 18, 23]) assert.equal(t[at], '-');
    assert.equal(t, K.permuteString(KEY, 'uuid', u));
  }
});

test('permuteString keeps an upper-case UUID valid and free of lower-case letters', () => {
  const upper = [];
  for (let i = 0; i < 100; i++) {
    const h = randomBytes(16).toString('hex').toUpperCase();
    upper.push(h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20));
  }
  for (const u of upper) {
    const t = K.permuteString(KEY, 'uuid', u);
    assert.match(t, /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    assert.doesNotMatch(t, /[a-z]/, 'an upper-case UUID must not come back with lower-case letters: ' + u + ' -> ' + t);
  }
});

test('permuteString keeps hexadecimal digests hexadecimal and of the same length', () => {
  for (const len of [32, 40, 64]) {
    const h = randomBytes(len / 2).toString('hex');
    const t = K.permuteString(KEY, 'digest', h);
    assert.equal(t.length, len);
    assert.match(t, /^[0-9a-f]+$/);
    assert.notEqual(t, h);
  }
});

test('permuteString handles big domains of 40 and more characters', () => {
  const shapes = ['7'.repeat(60), 'A'.repeat(45), 'ab1'.repeat(20), '4471920-'.repeat(8) + 'Z', randomBytes(32).toString('hex') + 'zz'];
  for (const s of shapes) {
    const t = K.permuteString(KEY, 'big', s);
    assert.equal(shapeClass(t).length, shapeClass(s).length);
    assert.equal(t.length, s.length);
    assert.notEqual(t, s);
    assert.equal(t, K.permuteString(KEY, 'big', s));
    assert.notEqual(t, K.permuteString(KEY2, 'big', s));
  }
  const outputs = new Set();
  for (let i = 0; i < 300; i++) outputs.add(K.permuteString(KEY, 'big', '1'.repeat(45) + pad(i, 3)));
  assert.equal(outputs.size, 300);
  for (const o of outputs) assert.match(o, /^\d{48}$/);
});

test('permuteString is deterministic per key and differs between keys and tags', () => {
  let differKey = 0, differTag = 0;
  for (let i = 0; i < 30; i++) {
    const s = pad(1000000000 + i * 37, 10);
    const a = K.permuteString(KEY, 'a', s);
    assert.equal(a, K.permuteString(KEY, 'a', s));
    if (a !== K.permuteString(KEY2, 'a', s)) differKey++;
    if (a !== K.permuteString(KEY, 'b', s)) differTag++;
  }
  assert.ok(differKey >= 29);
  assert.ok(differTag >= 29);
});

test('permuteString with forceHex treats every hexadecimal digit as such and leaves other letters alone', () => {
  const t = K.permuteString(KEY, 'v6', 'fe80:0db8:abcd:g', true);
  assert.match(t, /^[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}:g$/);
  assert.notEqual(t, 'fe80:0db8:abcd:g');
  const slots = K.shapeOf('fe80:zz', true);
  assert.equal(slots.length, 4);
});

test('shapeOf lists digit, upper and lower positions and the hex positions of a UUID', () => {
  assert.deepEqual(K.shapeOf('A1b').map((s) => s.kind), ['U', 'd', 'l']);
  assert.deepEqual(K.shapeOf('A1b').map((s) => s.radix), [26, 10, 26]);
  const u = K.shapeOf('4d2f9a60-7b13-4c58-9e21-0a5d3c7b8e01');
  assert.equal(u.length, 32);
  assert.ok(u.every((s) => s.radix === 16));
});

// ---- keys ----------------------------------------------------------------------------------

test('keyFromSeed gives 32 bytes, the same key for the same seed and another for another seed', () => {
  const a = K.keyFromSeed('first seed');
  assert.ok(Buffer.isBuffer(a));
  assert.equal(a.length, 32);
  assert.ok(a.equals(K.keyFromSeed('first seed')));
  assert.ok(!a.equals(K.keyFromSeed('first seed ')));
  assert.ok(!a.equals(K.keyFromSeed('First seed')));
  assert.ok(K.keyFromSeed(12345).equals(K.keyFromSeed('12345')));
});

test('keyFromSeed treats composed and decomposed text as the same seed', () => {
  const composed = 'caf' + String.fromCharCode(0xe9);
  const decomposed = 'cafe' + String.fromCharCode(0x301);
  assert.ok(K.keyFromSeed(composed).equals(K.keyFromSeed(decomposed)));
});

test('a seed-derived key makes the same pseudonyms every time, another seed makes others', () => {
  const k1 = K.keyFromSeed('derive-1'), k2 = K.keyFromSeed('derive-1'), k3 = K.keyFromSeed('derive-2');
  const s = '4471920';
  assert.equal(K.permuteString(k1, 'id', s), K.permuteString(k2, 'id', s));
  assert.notEqual(K.permuteString(k1, 'id', s), K.permuteString(k3, 'id', s));
});

test('randomKey returns 32 fresh bytes every time', () => {
  const keys = new Set();
  for (let i = 0; i < 20; i++) {
    const k = K.randomKey();
    assert.ok(Buffer.isBuffer(k));
    assert.equal(k.length, 32);
    keys.add(k.toString('hex'));
  }
  assert.equal(keys.size, 20);
});

// ---- source scan ---------------------------------------------------------------------------

function listJs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listJs(full, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no source file draws numbers from Math.random', () => {
  const files = listJs(path.join(__dirname, '..', 'src'), []);
  assert.ok(files.length >= 20, 'source files found: ' + files.length);
  const bad = [];
  for (const f of files) {
    // comments may mention the name (a note saying it is not used); only code counts
    const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    if (/Math\s*\.\s*random|Math\s*\[\s*['"]random['"]\s*\]|\{\s*random\s*\}\s*=\s*Math/.test(text)) bad.push(path.relative(path.join(__dirname, '..'), f));
  }
  assert.deepEqual(bad, []);
});

test('the engine files draw their randomness from the operating system source only', () => {
  const core = ['keyed.js', 'run.js', 'free.js', 'dates.js', 'engine.js', 'unit.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'core', f), 'utf8'));
  for (const text of core) assert.doesNotMatch(text, /Date\.now\(\)\s*[%*^]|performance\.now\(\)\s*[%*^]/);
  assert.match(core[0], /crypto\.randomBytes\(32\)/);
});
