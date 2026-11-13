// People: pure helpers behind the directory, the roster grid and a person's month (no DOM, unit-tested in test/D02.mjs).
import { interpretCode } from './rota-parser.js';
import { addDays, startOfDay } from './util.js';

const pkey = (p) => p.id ? `id:${p.id}` : `name:${String(p.name).toLowerCase()}`;

// ───────── phones: the rota stores 536095543, people type 0536095543 or +966 53 609 5543 — compare the national part
/** Digits of a phone without the Saudi prefix (00966 / +966 / 966 / 0), so every way of writing one number matches. */
export function phoneKey(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966') && d.length > 3) d = d.slice(3);   // no Saudi national number starts with 966
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}
/** True when the typed digits are part of any of the numbers. Needs 3+ digits so "05" does not match everyone. */
export function phoneMatch(query, values) {
  const raw = String(query || '').replace(/\D/g, ''); if (raw.length < 3) return false;
  const q = phoneKey(query) || raw;
  return values.some(v => { const d = String(v || '').replace(/\D/g, ''); if (!d) return false; const k = phoneKey(v); return k.includes(q) || d.includes(raw); });
}
/** A phone the app can dial: digits with country code, or '' when the text is not a phone (mirrors social.normPhone). */
export function dialable(v, cc = '966') {
  let d = String(v || '').trim(); if (!d) return ''; const plus = d.startsWith('+') || d.startsWith('00');
  if (/[A-Za-z]/.test(d)) return '';
  d = d.replace(/[^\d]/g, ''); if (d.startsWith('00')) d = d.slice(2);
  if (plus) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.startsWith('0')) d = cc + d.slice(1); else if (d.length <= 9) d = cc + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}
/** The number the Call/WhatsApp buttons should use: your saved one if it dials, else the rota's. */
export function phoneInUse(saved, rota) { return dialable(saved) ? saved : (rota || ''); }

// ───────── handles: accept links with or without https, "@name", or a bare name; say when the text is not a handle
export function preHandle(v) {
  let x = String(v || '').trim(); if (!x) return '';
  x = x.replace(/^(https?:\/\/)?(www\.)?(snapchat\.com\/(add\/|@)?|instagram\.com\/|tiktok\.com\/@|x\.com\/|twitter\.com\/)/i, '').replace(/^@+/, '').replace(/[/?#].*$/, '').replace(/[!,;:]+$/, '');
  return x;
}
/** {handle, warn}: the handle that will be saved and, if the text was not a clean handle, why. */
export function checkHandle(v) {
  const raw = String(v || '').trim(); if (!raw) return { handle: '', warn: '' };
  const x = preHandle(raw);
  if (/\s/.test(x)) return { handle: '', warn: 'Only the username, without spaces' };
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(x)) return { handle: '', warn: 'Not a username: use letters, digits, . _ -' };
  return { handle: x, warn: '' };
}

// ───────── shifts
/** A night is the N shift (or anything that starts 18:00 or later and runs past midnight). SF 13–01 and A2 14–02 are late shifts, not nights. */
export const isNight = (sh) => sh?.kind === 'work' && (sh.type === 'N' || !!(sh.hours?.overnight && sh.hours.start >= 18 * 60));
export const isLate = (sh) => sh?.kind === 'work' && !isNight(sh) && !!sh.hours && (sh.hours.overnight || sh.hours.end <= sh.hours.start);
/** Codes that are not a clinic shift: admin, HQ, projects and compounds away from the Qiddiya clinics, training. */
const NON_CLINIC = /^(AD|HQ|NA|OR|SPD|STC)$/;
const OFF_SITE = /SABIC|Nair|Headquarter|Project/i;
export const isOffSite = (sh) => sh?.kind === 'work' && (NON_CLINIC.test(sh.type) || OFF_SITE.test(sh.site || sh.label || ''));
/** Colour family for a code: D / E / N / A (nurse A, A+, B+) / L (late: SF, A2) / adm (admin, HQ, off-site) / leave / other / off. */
export function tClass(sh) {
  if (sh.kind === 'leave') return 'leave'; if (sh.kind === 'other') return 'other'; if (sh.kind === 'off') return 'off';
  if (NON_CLINIC.test(sh.type)) return 'adm';
  if (/^[DNE]$/.test(sh.type)) return sh.type;
  if (sh.type === 'M') return 'E';
  if (isLate(sh)) return 'L';
  return 'A';
}
/** The site number in a GP code (D1 → 1, N2 → 2), for the thin site stripe that tells Upper from Lower Village. */
export const siteNo = (code) => { const m = /^[DNE]([1-9])$/i.exec(String(code || '').trim()); return m ? +m[1] : 0; };

/** One person's month: shifts, nights, late shifts, hours (and how many shifts the rota gives no hours for), leave, days off. */
export function monthStats(r, p) {
  let work = 0, nights = 0, late = 0, mins = 0, noHours = 0, leave = 0, off = 0, other = 0;
  for (let d = 1; d <= r.daysInMonth; d++) {
    const sh = interpretCode(p.days[d] || '', r.legend, r.unitKind);
    if (sh.kind === 'work') { work++; if (isNight(sh)) nights++; else if (isLate(sh)) late++; if (sh.hours) mins += sh.hours.durationMin || 0; else noHours++; }
    else if (sh.kind === 'leave') leave++; else if (sh.kind === 'off') off++; else other++;
  }
  return { work, nights, late, hours: Math.round(mins / 60), noHours, leave, off, other };
}

/** Same code all month and not a shift ("Transferred", "Annual Leave" all month): the row is one label, not 30 dots. */
export function wholeMonth(r, p) {
  const c = p.days[1] || ''; if (!c) return '';
  for (let d = 2; d <= r.daysInMonth; d++) if ((p.days[d] || '') !== c) return '';
  return interpretCode(c, r.legend, r.unitKind).kind === 'work' ? '' : c;
}

// ───────── names: "Mohammed A." is ambiguous in a 31-doctor rota, so add letters until each short name is unique
const words = (n) => String(n).replace(/^Dr\.?\s*/i, '').replace(/\s*-\s*TL$/i, '').split(/\s+/).filter(Boolean);
export function shortNames(names) {
  const w = names.map(words), out = w.map(x => x.length > 1 ? `${x[0]} ${x[x.length - 1][0]}.` : (x[0] || ''));
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Map(); out.forEach((n, i) => seen.set(n, [...(seen.get(n) || []), i]));
    let clash = false;
    for (const idx of seen.values()) if (idx.length > 1) { clash = true; for (const i of idx) { const x = w[i]; out[i] = pass === 0 ? `${x[0]} ${x[x.length - 1]}` : pass === 1 && x.length > 2 ? `${x[0]} ${x[1][0]}. ${x[x.length - 1]}` : x.join(' '); } }
    if (!clash) break;
  }
  return out;
}

// ───────── who is on: rostered today vs actually on shift right now (including last night's tail)
function codeOn(s, key, date) {
  for (const r of Object.values(s.rotas || {})) {
    if (r.year !== date.getFullYear() || r.month !== date.getMonth() + 1) continue;
    const p = r.people.find(x => pkey(x) === key); if (!p) continue;
    const code = p.days[date.getDate()] || '', sh = interpretCode(code, r.legend, r.unitKind);
    if (sh.kind === 'work' || sh.kind === 'leave') return { sh, code, unit: r.unitKind };
  }
  return null;
}
const span = (sh) => { const st = sh.hours.start, en = sh.hours.overnight || sh.hours.end <= sh.hours.start ? sh.hours.end + 1440 : sh.hours.end; return [st, en]; };
/**
 * Today's entry for a person plus where "now" falls: state 'now' (on shift), 'tail' (last night's shift still running),
 * 'later' (starts later today), 'ended' (done for today) or '' (no hours / not working).
 */
export function shiftState(s, key, now = new Date()) {
  const day = startOfDay(now), m = (now - day) / 60000, t = codeOn(s, key, day), y = codeOn(s, key, addDays(day, -1));
  if (y?.sh.kind === 'work' && y.sh.hours) { const [, en] = span(y.sh); if (en > 1440 && m < en - 1440) return { ...y, state: 'tail', yesterday: true, today: t }; }
  if (!t) return null;
  if (t.sh.kind !== 'work' || !t.sh.hours) return { ...t, state: '' };
  const [st, en] = span(t.sh);
  return { ...t, state: m < st ? 'later' : m < en ? 'now' : 'ended' };
}

// ───────── search: one matcher for the list and the roster
export const UNIT_WORDS = { gp: 'GP', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurse' };
/** Does a person match the search box? Name, title, clinic, nurse group, unit (FSED…), saved note and handles, or any number. */
export function matches(q, { p, units = [], clinic = '', group = '', contact = {} }) {
  q = String(q || '').toLowerCase().trim(); if (!q) return true;
  const hay = [p.name, p.title, clinic, group, ...units.map(u => `${u} ${UNIT_WORDS[u] || ''}`), contact.note, contact.snap, contact.insta].map(x => String(x || '').toLowerCase());
  if (q.split(/\s+/).every(t => hay.some(x => x.includes(t)))) return true;
  return phoneMatch(q, [p.mobile, contact.phone, contact.whatsapp]);
}

/** Anything saved for this person beyond the rota? (decides "Add numbers" vs "Edit contact") */
export const hasContact = (c) => !!c && ['phone', 'whatsapp', 'snap', 'insta', 'note', 'birthday'].some(k => String(c[k] || '').trim());
/** Friend kind for a rota person: nurses are nurses, GPs colleagues, the ER specialists "other". */
export const friendKind = (units) => units.includes('nurse') ? 'nurse' : units.includes('gp') ? 'gp' : 'other';

/** "Today", "Tomorrow", "in 3 days", "2 days ago" — only relative words, so it never repeats the date. */
export function relWords(d, today = new Date()) {
  const n = Math.round((startOfDay(d) - startOfDay(today)) / 86400000);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
}
