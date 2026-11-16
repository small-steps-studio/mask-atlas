'use strict';
// Keyed building blocks for the pseudonyms: a 256-bit run key, HMAC-SHA256 as the only source of
// "randomness", and a keyed format-preserving permutation (a Feistel network with cycle walking)
// over strings made of digits and letters. No general-purpose random-number function is used anywhere.
//
// A permutation is a bijection, so two different originals of the same shape can never get the
// same replacement; originals of different shapes get replacements of different shapes. The
// permutation is conjugated with "add one" for small domains so that no value maps to itself.

const crypto = require('node:crypto');

const ROUNDS = 6;
const MAX_NUMBER_DOMAIN = 2 ** 50;
const NO_FIXED_POINT_BELOW = 2 ** 32;

/** A fresh 256-bit key from the operating system's random source. */
function randomKey() { return crypto.randomBytes(32); }

/** A 256-bit key derived from the user's seed (scrypt). The same seed always gives the same key. */
function keyFromSeed(seed) {
  const text = String(seed).normalize('NFC');
  return crypto.scryptSync(text, 'mask-atlas/seed/v1', 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

// HMAC-SHA256 built from two cached SHA-256 states (the inner and outer pads of the key). It gives
// the same result as crypto.createHmac('sha256', key) (checked by the tests) at about a ninth of
// the cost per call, which matters because every pseudonym needs a few dozen calls.
const macCache = new WeakMap();
function macOf(key) {
  let mac = macCache.get(key);
  if (mac) return mac;
  const ipad = Buffer.alloc(64, 0x36), opad = Buffer.alloc(64, 0x5c);
  for (let i = 0; i < key.length; i++) { ipad[i] ^= key[i]; opad[i] ^= key[i]; }
  const inner = crypto.createHash('sha256').update(ipad);
  const outer = crypto.createHash('sha256').update(opad);
  mac = function (message) { return outer.copy().update(inner.copy().update(message).digest()).digest(); };
  macCache.set(key, mac);
  return mac;
}

function labelled(parts) {
  let out = '';
  for (let i = 0; i < parts.length; i++) { const p = String(parts[i]); out += p.length + ':' + p + '|'; }
  return out;
}

/** HMAC-SHA256 over length-labelled parts: a 32-byte Buffer. */
function prf(key, parts) {
  return macOf(key)(labelled(parts));
}

/** An integer in [0, n) taken from the first 64 bits of the PRF (the bias is below 2^-23 for n up to 2^40). */
function index(key, n, parts) {
  if (n <= 1) return 0;
  const d = prf(key, parts);
  if (n <= 1048576) {
    // exact in double arithmetic: (hi mod n) * 2^32 + lo stays below 2^53
    return ((d.readUInt32BE(0) % n) * 4294967296 + d.readUInt32BE(4)) % n;
  }
  return Number(d.readBigUInt64BE(0) % BigInt(n));
}

/** A short lower-case hexadecimal token (for tags and tests). */
function hexToken(key, parts, bytes) { return prf(key, parts).subarray(0, bytes || 8).toString('hex'); }

// ---- Feistel permutation over [0, n) -------------------------------------------------------

function bitLength(n) {
  if (typeof n === 'bigint') return n <= 1n ? 1 : (n - 1n).toString(2).length;
  return n <= 1 ? 1 : Math.floor(Math.log2(n - 1)) + 1;
}

function roundNumber(key, tweak, round, value, mask) {
  return macOf(key)(tweak + '/' + round + '/' + value).readUInt32BE(0) & mask;
}

function roundBig(key, tweak, round, value, halfBits, mask) {
  let out = 0n;
  let produced = 0;
  let counter = 0;
  while (produced < halfBits) {
    const d = macOf(key)(tweak + '/' + round + '/' + counter + '/' + value);
    out = (out << 256n) | BigInt('0x' + d.toString('hex'));
    produced += 256;
    counter++;
  }
  return out & mask;
}

function makeFeistel(key, tweak, n) {
  const big = typeof n === 'bigint' || n > MAX_NUMBER_DOMAIN;
  let bits = bitLength(n);
  if (bits % 2) bits++;
  const half = bits / 2;
  if (!big) {
    const base = 2 ** half;
    const mask = base - 1;
    const enc = function (x) {
      let l = Math.floor(x / base), r = x % base;
      for (let i = 0; i < ROUNDS; i++) { const f = roundNumber(key, tweak, i, r, mask); const nl = r; r = (l ^ f) >>> 0; l = nl; }
      return l * base + r;
    };
    const dec = function (x) {
      let l = Math.floor(x / base), r = x % base;
      for (let i = ROUNDS - 1; i >= 0; i--) { const pr = l; const f = roundNumber(key, tweak, i, pr, mask); l = (r ^ f) >>> 0; r = pr; }
      return l * base + r;
    };
    return { enc: enc, dec: dec, big: false, n: Number(n) };
  }
  const nb = BigInt(n);
  const base = 1n << BigInt(half);
  const mask = base - 1n;
  const enc = function (x) {
    let l = x >> BigInt(half), r = x & mask;
    for (let i = 0; i < ROUNDS; i++) { const f = roundBig(key, tweak, i, r.toString(16), half, mask); const nl = r; r = l ^ f; l = nl; }
    return (l << BigInt(half)) | r;
  };
  const dec = function (x) {
    let l = x >> BigInt(half), r = x & mask;
    for (let i = ROUNDS - 1; i >= 0; i--) { const pr = l; const f = roundBig(key, tweak, i, pr.toString(16), half, mask); l = r ^ f; r = pr; }
    return (l << BigInt(half)) | r;
  };
  return { enc: enc, dec: dec, big: true, n: nb };
}

/** Permutes x in [0, n) (x and n both Numbers, or both BigInts). Never returns x when n is below 2^32 and n > 1. */
function permute(key, tweak, n, x) {
  const f = makeFeistel(key, tweak, n);
  const one = f.big ? 1n : 1;
  const nn = f.n;
  const walk = function (fn, v) { let y = fn(v); while (y >= nn) y = fn(y); return y; };
  const forward = function (v) { return walk(f.enc, v); };
  const backward = function (v) { return walk(f.dec, v); };
  const y = forward(x);
  if (f.big || nn >= NO_FIXED_POINT_BELOW || nn <= 1) return y;
  // conjugate with +1 so that the permutation has no fixed point: g(x) = f^-1(f(x) + 1 mod n)
  let z = y + one;
  if (z >= nn) z = f.big ? 0n : 0;
  return backward(z);
}

// ---- Shape-preserving permutation of strings -----------------------------------------------

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_DIGEST = /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/** Splits a string into permutable positions (digits, ASCII letters; hex digits for UUIDs) and literals. */
function shapeOf(s, forceHex) {
  const hex = forceHex === true || UUID.test(s) || HEX_DIGEST.test(s);
  // In hexadecimal text the digits take the case of the letters: upper case when the text has upper-case
  // letters and no lower-case ones, lower case otherwise.
  const digitKind = hex && /[A-F]/.test(s) && !/[a-f]/.test(s) ? 'H' : 'h';
  const slots = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (hex && ((c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70))) {
      slots.push({ i: i, radix: 16, kind: c >= 65 && c <= 70 ? 'H' : c >= 97 ? 'h' : digitKind });
    } else if (!hex && c >= 48 && c <= 57) slots.push({ i: i, radix: 10, kind: 'd' });
    else if (!hex && c >= 65 && c <= 90) slots.push({ i: i, radix: 26, kind: 'U' });
    else if (!hex && c >= 97 && c <= 122) slots.push({ i: i, radix: 26, kind: 'l' });
  }
  return slots;
}

function digitOf(slot, ch) {
  const c = ch.charCodeAt(0);
  switch (slot.kind) {
    case 'd': return c - 48;
    case 'U': return c - 65;
    case 'l': return c - 97;
    case 'h': return c <= 57 ? c - 48 : c - 87;
    default: return c <= 57 ? c - 48 : c - 55;
  }
}

function charOf(slot, v) {
  switch (slot.kind) {
    case 'd': return String.fromCharCode(48 + v);
    case 'U': return String.fromCharCode(65 + v);
    case 'l': return String.fromCharCode(97 + v);
    case 'h': return '0123456789abcdef'[v];
    default: return '0123456789ABCDEF'[v];
  }
}

// A value with more permutable positions than this is permuted in groups of this many positions
// (each group with its own tweak), so that the work grows in proportion to the length of the value
// instead of with its square. Every group is a bijection of its shape, hence so is the whole value.
const GROUP_SLOTS = 64;
const PERMUTE_CACHE_MAX = 100000;
const permCache = new WeakMap();

/** Permutes the positions `slots` of `s` as one number and writes the result into the array `out`. */
function permuteSlots(key, tag, s, slots, out) {
  let useBig = false;
  let nNumber = 1;
  for (const sl of slots) { nNumber *= sl.radix; if (nNumber > MAX_NUMBER_DOMAIN) { useBig = true; break; } }
  let x, n;
  if (!useBig) {
    n = nNumber; x = 0;
    for (const sl of slots) x = x * sl.radix + digitOf(sl, s[sl.i]);
  } else {
    n = 1n; x = 0n;
    for (const sl of slots) { const r = BigInt(sl.radix); n *= r; x = x * r + BigInt(digitOf(sl, s[sl.i])); }
  }
  if (n === 1 || n === 1n) return;
  let sig = '';
  for (const sl of slots) sig += sl.radix === 16 ? 'x' : sl.kind; // hexadecimal: the case only decides how the result is written
  const y = permute(key, tag + '/' + sig, n, x);
  if (!useBig) {
    let rest = y;
    for (let k = slots.length - 1; k >= 0; k--) { const sl = slots[k]; out[sl.i] = charOf(sl, rest % sl.radix); rest = Math.floor(rest / sl.radix); }
  } else {
    let rest = y;
    for (let k = slots.length - 1; k >= 0; k--) { const sl = slots[k]; const r = BigInt(sl.radix); out[sl.i] = charOf(sl, Number(rest % r)); rest /= r; }
  }
}

/**
 * Replaces every digit and ASCII letter of `s` by another of the same kind (digit for digit, upper
 * case for upper case, lower case for lower case, hexadecimal for UUIDs and digests); everything
 * else stays. Keyed by `key` and `tag`; a bijection on the strings of one shape. `forceHex` treats
 * every hexadecimal digit as such (for IPv6 groups).
 */
function permuteString(key, tag, s, forceHex) {
  // The same value comes up again and again (a record number in several segments, the same
  // patient in many messages): short results are remembered for the key, up to a fixed number.
  const cacheable = s.length <= 64;
  let cache = null, ck = '';
  if (cacheable) {
    cache = permCache.get(key);
    if (!cache) { cache = new Map(); permCache.set(key, cache); }
    ck = (forceHex ? 'h' : 'n') + tag.length + ':' + tag + s;
    const hit = cache.get(ck);
    if (hit !== undefined) return hit;
  }
  const slots = shapeOf(s, forceHex);
  let result = s;
  if (slots.length) {
    const out = s.split('');
    if (slots.length <= GROUP_SLOTS) permuteSlots(key, tag, s, slots, out);
    else for (let g = 0, from = 0; from < slots.length; g++, from += GROUP_SLOTS) permuteSlots(key, tag + '#' + g, s, slots.slice(from, from + GROUP_SLOTS), out);
    result = out.join('');
  }
  if (cache && cache.size < PERMUTE_CACHE_MAX) cache.set(ck, result);
  return result;
}

module.exports = { macOf, randomKey, keyFromSeed, prf, index, hexToken, permute, permuteString, shapeOf, ROUNDS };
