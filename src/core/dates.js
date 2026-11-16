'use strict';
// Date arithmetic for the date shifting: civil dates only (no time zone conversion, no daylight
// saving), so that the time of day and the zone stay exactly as they were. Every function returns
// null for text it cannot read as a valid date, so that the caller can fall back to masking.

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(y, m) { return m === 2 ? (isLeap(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function validCivil(y, m, d) { return y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); }

// Days since 1970-01-01 (proleptic Gregorian) and back.
function toDays(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDays(z0) {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: m <= 2 ? y + 1 : y, m: m, d: d };
}

/** Adds days to a civil date; null when the result leaves the years 1 to 9999. */
function addDays(y, m, d, days) {
  const r = fromDays(toDays(y, m, d) + days);
  return r.y >= 1 && r.y <= 9999 ? r : null;
}

/** Adds months (the day is kept, or cut to the end of a shorter month). */
function addMonths(y, m, d, months) {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = (total % 12 + 12) % 12 + 1;
  if (ny < 1 || ny > 9999) return null;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

function pad(n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }

/** Offset in days (never 0) for a whole day shift, month count and year count derived from it. */
function parts(offset) {
  const sign = offset < 0 ? -1 : 1;
  const a = Math.abs(offset);
  return { days: offset, months: sign * Math.max(2, Math.round(a / 30.4375)), years: sign * Math.max(1, Math.round(a / 365.25)) };
}

const HL7_TS = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\.\d{1,6})?([+-]\d{4})?$/;

/** HL7 DT / DTM / TS value (YYYY[MM[DD[HH[MM[SS[.S]]]]]][+/-ZZZZ]). */
function shiftHl7(value, offset) {
  const m = HL7_TS.exec(value);
  if (!m) return null;
  const p = parts(offset);
  const y = Number(m[1]);
  const hasMonth = m[2] !== undefined, hasDay = m[3] !== undefined;
  if (m[4] !== undefined && !hasDay) return null;
  if (!hasMonth) return fmt(addMonths(y, 1, 1, p.years * 12), 4, m, false, false);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (!hasDay) return fmt(addMonths(y, mo, 1, p.months), 6, m, true, false);
  const d = Number(m[3]);
  if (!validCivil(y, mo, d)) return null;
  return fmt(addDays(y, mo, d, p.days), 8, m, true, true);
}

function fmt(r, width, m, month, day) {
  if (!r) return null;
  let out = pad(r.y, 4);
  if (month) out += pad(r.m, 2);
  if (day) out += pad(r.d, 2);
  // time of day, fraction and zone stay as they were
  const tail = (m[4] || '') + (m[5] || '') + (m[6] || '') + (m[7] || '') + (m[8] || '');
  return out + tail;
}

const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

/** FHIR date / dateTime / instant (also the plain ISO 8601 layout used in text). */
function shiftIso(value, offset) {
  const m = ISO.exec(value);
  if (!m) return null;
  const p = parts(offset);
  const y = Number(m[1]);
  if (m[2] === undefined) { const r = addMonths(y, 1, 1, p.years * 12); return r ? pad(r.y, 4) : null; }
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (m[3] === undefined) { const r = addMonths(y, mo, 1, p.months); return r ? pad(r.y, 4) + '-' + pad(r.m, 2) : null; }
  const d = Number(m[3]);
  if (!validCivil(y, mo, d)) return null;
  const r = addDays(y, mo, d, p.days);
  if (!r) return null;
  return pad(r.y, 4) + '-' + pad(r.m, 2) + '-' + pad(r.d, 2) + (m[4] || '');
}

/** X12 D8 (CCYYMMDD) or DT (CCYYMMDDHHMM[SS]) value. */
function shiftD8(value, offset) {
  if (!/^\d{8}(\d{4}(\d{2}(\d{1,2})?)?)?$/.test(value)) return null;
  return shiftHl7(value, offset);
}

/** X12 RD8 range (CCYYMMDD-CCYYMMDD): both ends move by the same offset. */
function shiftRd8(value, offset) {
  const m = /^(\d{8})-(\d{8})$/.exec(value);
  if (!m) return null;
  const a = shiftHl7(m[1], offset), b = shiftHl7(m[2], offset);
  return a && b ? a + '-' + b : null;
}

/** X12 six-digit YYMMDD (the two-digit year keeps its century window: 70 to 99 is 19xx). */
function shiftYymmdd(value, offset) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const yy = Number(m[1]);
  const y = yy >= 70 ? 1900 + yy : 2000 + yy;
  const mo = Number(m[2]), d = Number(m[3]);
  if (!validCivil(y, mo, d)) return null;
  const r = addDays(y, mo, d, parts(offset).days);
  if (!r) return null;
  const ny = r.y % 100;
  return pad(ny, 2) + pad(r.m, 2) + pad(r.d, 2);
}

/**
 * Dates as they are written in running text: 2026-11-04, 11/04/2026 (order mdy or dmy), 4.11.2026.
 * Returns { text } with the same layout (separators, zero padding) or null.
 */
function shiftWritten(value, offset, order) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) { const s = shiftIso(value, offset); return s; }
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (m) return layout(Number(m[1]), Number(m[2]), Number(m[3]), offset, [m[2], m[3]], '/', 'ymd');
  m = /^(\d{1,2})([/.])(\d{1,2})\2(\d{4})$/.exec(value);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[3]), y = Number(m[4]);
  const dayFirst = m[2] === '.' || order === 'dmy';
  const day = dayFirst ? a : b, mon = dayFirst ? b : a;
  if (!dayFirst && a > 12 && b <= 12) return layout(y, b, a, offset, [m[1], m[3]], m[2], 'dmy');
  return layout(y, mon, day, offset, [m[1], m[3]], m[2], dayFirst ? 'dmy' : 'mdy');
}

function layout(y, mo, d, offset, widthsFrom, sep, order) {
  if (!validCivil(y, mo, d)) return null;
  const r = addDays(y, mo, d, parts(offset).days);
  if (!r) return null;
  const padded = widthsFrom.some(function (t) { return t.length === 2; });
  const w = padded ? 2 : 1;
  const mm = pad(r.m, w), dd = pad(r.d, w);
  if (order === 'ymd') return pad(r.y, 4) + sep + mm + sep + dd;
  return (order === 'dmy' ? dd + sep + mm : mm + sep + dd) + sep + pad(r.y, 4);
}

module.exports = { isLeap, daysInMonth, validCivil, toDays, fromDays, addDays, addMonths, shiftHl7, shiftIso, shiftD8, shiftRd8, shiftYymmdd, shiftWritten, parts };
