// Social: friends, their handles, when they are free, when you and they overlap, and what to do with that time. Pure functions (no DOM).
import { interpretCode } from './rota-parser.js';
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { isMe } from './model.js';

const rec = (m) => Object.values(m || {});
const uid = () => 'f' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → 0-9, so a number typed on an Arabic keyboard still dials. */
export const asciiDigits = (v) => String(v ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6F0));

// ───────────────────────────── handles and links (paste a link, an @name or a bare name — all work)
const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;
const SITE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|snapchat\.com\/add|snapchat\.com\/@|snapchat\.com|tiktok\.com\/@|x\.com|twitter\.com)\/+/i;
/** A username from whatever was pasted: a profile link (with or without https), "@name", "@@name!!", or a sentence ("my snap is faisal" → the @word, else the last word). '' when nothing usable is left. */
export const cleanHandle = (v) => {
  let x = String(v || '').trim(); if (!x) return '';
  x = x.replace(SITE, '').split(/[/?#]/)[0];
  const words = x.split(/\s+/).filter(Boolean), at = words.find(w => w.startsWith('@'));
  x = (at || words[words.length - 1] || '').replace(/^@+/, '').replace(/[!?.,;:)]+$/, '');   // other junk (<b>, quotes) makes it unusable rather than guessed
  return HANDLE.test(x) ? x : '';
};
/** Digits only with a country code. Local Saudi numbers (05xxxxxxxx) get 966; anything with + or 00 is kept as given. */
export function normPhone(v, cc = '966') {
  let d = asciiDigits(v).trim(); if (!d) return ''; const plus = d.startsWith('+') || d.startsWith('00'); d = d.replace(/[^\d]/g, ''); if (d.startsWith('00')) d = d.slice(2);
  if (plus) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.startsWith('0')) d = cc + d.slice(1); else if (d.length <= 9) d = cc + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}
export const links = (f, cc = '966') => {
  const ph = normPhone(f.phone, cc), wa = normPhone(f.whatsapp, cc) || ph, snap = cleanHandle(f.snap), ig = cleanHandle(f.insta);   // a junk WhatsApp entry falls back to the phone
  return { tel: ph ? `tel:+${ph}` : '', wa: wa ? `https://wa.me/${wa}` : '', snap: snap ? `https://www.snapchat.com/add/${snap}` : '', insta: ig ? `https://www.instagram.com/${ig}/` : '', sms: ph ? `sms:+${ph}` : '' };
};
export const waWith = (f, text, cc) => { const l = links(f, cc).wa; return l ? `${l}?text=${encodeURIComponent(text)}` : ''; };

/** A birthday from what people actually type: 1990-03-14, 14/03/1990, 14.3, 14-03, 03-14 (ISO month-day), vCard --0314. Day first when it is ambiguous (Saudi habit). Returns YYYY-MM-DD, MM-DD or ''. */
export function parseBirthday(v) {
  const x = asciiDigits(v).trim(); if (!x) return '';
  const ok = (y, m, d) => { m = +m; d = +d; if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''; const dt = new Date(y ? +y : 2000, m - 1, d); if (dt.getMonth() !== m - 1) return ''; const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return y ? `${y}-${md}` : md; };
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(x))) return ok(m[1], m[2], m[3]);
  if ((m = /^(\d{4})(\d\d)(\d\d)$/.exec(x))) return ok(m[1], m[2], m[3]);
  if ((m = /^--(\d\d)-?(\d\d)$/.exec(x))) return ok('', m[1], m[2]);
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(x))) return ok(m[3], m[2], m[1]);
  if ((m = /^(\d{1,2})[/.](\d{1,2})$/.exec(x))) return ok('', m[2], m[1]);
  if ((m = /^(\d\d)-(\d\d)$/.exec(x))) return ok('', m[1], m[2]) || ok('', m[2], m[1]);   // MM-DD is the stored form; 31-12 still works
  return '';
}

// ───────────────────────────── friend records (merge per record by `at`, like everything else)
export const FRIEND_KINDS = [{ id: 'gp', label: 'GP colleague' }, { id: 'nurse', label: 'Nurse / shifts' }, { id: 'other', label: 'Other' }];
export const SHIFT_CODES = [{ id: 'D', label: 'Day' }, { id: 'E', label: 'Evening' }, { id: 'N', label: 'Night' }, { id: 'off', label: 'Off' }, { id: 'leave', label: 'Leave' }];
// Hours for shifts entered by hand when neither the friend nor their rota's legend says otherwise. Nurses here work 12h D/N.
const DEFAULT_HOURS = { D: [7 * 60, 19 * 60], E: [13 * 60, 22 * 60], N: [19 * 60, 7 * 60] };
const NURSE_HOURS = { D: [8 * 60, 20 * 60], E: [12 * 60, 24 * 60], N: [20 * 60, 8 * 60] };
const cleanHours = (o) => { const out = {}; for (const c of ['D', 'E', 'N']) { const v = o?.[c]; if (Array.isArray(v) && v.length === 2 && v.every(n => Number.isFinite(+n) && +n >= 0 && +n <= 1440) && +v[0] !== +v[1]) out[c] = [+v[0], +v[1]]; } return out; };
export function addFriend(s, f) {
  const name = String(f.name || '').trim().slice(0, 60); if (!name) return s; const id = f.id || uid();
  const fr = { id, name, nick: String(f.nick || '').slice(0, 30), kind: ['gp', 'nurse', 'other'].includes(f.kind) ? f.kind : 'other', phone: asciiDigits(f.phone || '').slice(0, 24), whatsapp: asciiDigits(f.whatsapp || '').slice(0, 24), snap: cleanHandle(f.snap), insta: cleanHandle(f.insta),
    rotaKey: f.rotaKey || '', place: String(f.place || '').slice(0, 60), birthday: parseBirthday(f.birthday), every: Math.max(0, Math.min(365, +f.every || 0)), notes: String(f.notes || '').slice(0, 500),
    sched: f.sched && typeof f.sched === 'object' ? f.sched : {}, weeklyOff: Array.isArray(f.weeklyOff) ? f.weeklyOff.filter(n => n >= 0 && n <= 6) : [], hours: cleanHours(f.hours), fav: !!f.fav, createdAt: f.createdAt || Date.now(), at: Date.now() };
  return { ...s, friends: { ...(s.friends || {}), [id]: fr } };
}
export function updateFriend(s, id, patch) { const cur = s.friends?.[id]; if (!cur) return s; return addFriend(s, { ...cur, ...patch, id, createdAt: cur.createdAt }); }
export function deleteFriend(s, id) { const friends = { ...(s.friends || {}) }; delete friends[id]; return { ...s, friends, deleted: { ...(s.deleted || {}), [`friend:${id}`]: Date.now() } }; }
export const friendList = (s) => rec(s.friends).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.name.localeCompare(b.name));
const bare = (n) => String(n || '').replace(/^Dr\.?\s+/i, '').replace(/\s+-\s+.*$/, '').trim();   // "Dr. Mohammed Mari - TL" → "Mohammed Mari"
export const shortName = (f) => f.nick || bare(f.name).split(' ')[0] || String(f.name);
/** Short names that stay unique inside one list: first name, plus the last initial when two share it ("Fatima M.", "Fatima A."). */
export function shortNames(list) {
  const first = list.map(f => f.nick || bare(f.name).split(' ')[0]), n = {}; first.forEach(x => { n[x] = (n[x] || 0) + 1; });
  return list.map((f, i) => { if (f.nick || n[first[i]] < 2) return first[i] || String(f.name); const w = bare(f.name).split(' '); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : first[i]; });
}
/** Set (or clear with '') one day of a manually-kept schedule. */
export function setShift(s, id, date, code) { const f = s.friends?.[id]; if (!f) return s; const sched = { ...(f.sched || {}) }; if (!code) delete sched[date]; else sched[date] = code; return updateFriend(s, id, { sched }); }

// ───────────────────────────── linking to the rota
const keyOfP = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
const rotaPeople = (s) => { const out = new Map(); for (const r of rec(s.rotas)) for (const p of r.people) { const k = keyOfP(p); if (!out.has(k)) out.set(k, { key: k, name: p.name, id: p.id, mobile: p.mobile, title: p.title, unit: r.unitKind }); else if (!out.get(k).units) out.get(k).units = [out.get(k).unit]; if (out.get(k).units && !out.get(k).units.includes(r.unitKind)) out.get(k).units.push(r.unitKind); } return [...out.values()].map(p => ({ ...p, units: p.units || [p.unit] })); };
export const rotaPeopleList = (s) => rotaPeople(s).filter(p => !isMe(s, p));
// Transliterated Arabic names are spelt many ways (Meshal/Mishal, Merri/Mari, Mohammed/Muhammad): compare consonant skeletons, or allow one typo.
const skel = (w) => w[0] + w.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
const close = (w, x) => w.length >= 4 && x.length >= 3 && /^[a-z]+$/.test(w) && (skel(w) === skel(x) || lev1(w, x));
/** People in the loaded rotas whose name contains every word you typed ("Mohammed Merri" finds only that Mohammed).
 *  When nothing matches exactly, a second pass allows spelling variants; those results carry `fuzzy: true`. */
export function matchRota(s, name) {
  const want = norm(name).split(' ').filter(Boolean); if (!want.length) return [];
  const ppl = rotaPeople(s).filter(p => !isMe(s, p)), score = (exact) => ppl.map(p => { const have = norm(bare(p.name)).split(' '); const hit = want.filter(w => have.some(x => x === w || x.startsWith(w) || (!exact && close(w, x)))).length; return { ...p, ratio: hit / want.length, score: hit / want.length - (have.length - want.length) * 0.01, ...(exact ? {} : { fuzzy: true }) }; })
    .filter(p => p.ratio >= 1).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const ex = score(true); return ex.length ? ex : score(false);
}
// Index rota rows by person key once per rota (a linear scan per cell made Social slow with many friends).
// Keyed by the rota object and checked against its people array, so a rota replaced or edited in place is re-indexed.
const rotaIdx = new WeakMap();
const peopleOf = (r) => { let ix = rotaIdx.get(r); if (!ix || ix.people !== r.people || ix.n !== r.people.length) { const m = new Map(); for (const p of r.people || []) { const k = keyOfP(p); if (!m.has(k)) m.set(k, p); } ix = { people: r.people, n: (r.people || []).length, m }; rotaIdx.set(r, ix); } return ix.m; };
const rotaFor = (s, key, d) => { if (!s.rotas || !key) return null; for (const r of rec(s.rotas)) { if (r.year !== d.getFullYear() || r.month !== d.getMonth() + 1) continue; const p = peopleOf(r).get(key); if (p) return { r, p }; } return null; };
const rotaCode = (s, key, d) => { const x = rotaFor(s, key, d); return x ? interpretCode(x.p.days[d.getDate()] || '', x.r.legend, x.r.unitKind) : null; };
/** Which unit a rota row belongs to (gp, fsed, uv, nurse…), from any loaded month. */
export const unitOfKey = (s, key) => { if (!s.rotas || !key) return ''; for (const r of rec(s.rotas)) if (peopleOf(r).has(key)) return r.unitKind; return ''; };
/** Hours for a hand-entered code: what you set on the friend, else their rota's legend (nurses D 08–20), else a sensible default. */
export function shiftHours(s, f, code) {
  if (f.hours?.[code]) return f.hours[code];
  for (const r of rec(s.rotas)) { if (!f.rotaKey || !peopleOf(r).has(f.rotaKey)) continue; const h = r.legend?.[code]?.hours; if (h && h.start != null) return [h.start, h.end]; }
  return ((f.kind === 'nurse' || unitOfKey(s, f.rotaKey) === 'nurse') ? NURSE_HOURS : DEFAULT_HOURS)[code] || null;
}
/** The last day any loaded rota covers, so "later days unknown" can be said out loud. */
export function scheduleEnd(s) { let end = null; for (const r of rec(s.rotas)) { const d = new Date(r.year, r.month - 1, r.daysInMonth || new Date(r.year, r.month, 0).getDate()); if (!end || d > end) end = d; } return end; }

// ───────────────────────────── when is someone free?
const H = 60, MIN_WINDOW = 90, AFTER = 45, BEFORE = 90;
const WAKE = 8 * H, LATE = 24 * H;
/** The shift (or lack of one) of a person on a date: { status: 'off'|'work'|'leave'|'unknown', start, end, type } with minutes from that day's midnight (end may pass 1440). */
function personShift(s, f, date) {
  const key = keyOf(date);
  let why = '';
  if (f.rotaKey) {
    const sh = rotaCode(s, f.rotaKey, date);
    if (sh && sh.kind === 'work' && sh.hours) return { status: 'work', type: sh.type, start: sh.hours.start, end: sh.hours.overnight || sh.hours.end <= sh.hours.start ? sh.hours.end + 1440 : sh.hours.end, site: sh.site };
    if (sh && (sh.kind === 'leave' || sh.kind === 'off')) return { status: sh.kind, type: '' };
    if (sh && sh.kind === 'other') why = sh.label;   // training, pulled out to another project…: the schedule says nothing useful, so use what you entered by hand
  }
  const code = f.sched?.[key];
  if (code) { if (code === 'off') return { status: 'off', type: '' }; if (code === 'leave') return { status: 'leave', type: '' }; const hrs = shiftHours(s, f, code); if (hrs) return { status: 'work', type: code, start: hrs[0], end: hrs[1] <= hrs[0] ? hrs[1] + 1440 : hrs[1], manual: true }; }
  if (f.weeklyOff?.includes(date.getDay())) return { status: 'off', type: '' };
  return { status: 'unknown', type: '', why };
}
/** Is the person coming off a real night (yesterday's shift still running ≥3h into this morning)? Then the day is for sleep first — never "a day off". */
const nightTail = (prev) => prev.status === 'work' && prev.end > 1440 ? prev.end - 1440 : 0;
/** Free windows [from, to] in minutes for someone on a date, allowing for travel, sleep after a night and a rest before one. */
export function freeWindows(s, f, date) {
  const today = personShift(s, f, date), prev = personShift(s, f, addDays(date, -1)), wins = [];
  const tailEnd = nightTail(prev);                                                     // yesterday's night shift still running into this morning
  const from = Math.max(WAKE, tailEnd ? tailEnd + 8 * H : WAKE);                       // after a night, sleep ~8h first
  if (today.status === 'leave' || today.status === 'off') wins.push([Math.min(from, 20 * H), LATE]);
  else if (today.status === 'work') {
    if (today.type === 'N' || today.start >= 17 * H) { const to = today.start - BEFORE - (today.type === 'N' ? 2 * H : 0); if (to - Math.max(from, 14 * H) >= MIN_WINDOW) wins.push([Math.max(from, 14 * H), to]); }   // before an evening or night: only the afternoon
    else { if (today.start - BEFORE - from >= MIN_WINDOW) wins.push([from, today.start - BEFORE]); const after = today.end + AFTER; if (today.end <= LATE && LATE - after >= MIN_WINDOW) wins.push([after, LATE]); }
  } else return [];
  return wins.filter(w => w[1] - w[0] >= MIN_WINDOW);
}
export const dayState = (s, f, date) => {
  const sh = personShift(s, f, date), w = freeWindows(s, f, date), prev = personShift(s, f, addDays(date, -1)), afterNight = nightTail(prev) >= 3 * H;
  return { ...sh, windows: w, free: w.length ? (!afterNight && w.some(x => x[1] - x[0] >= 8 * H) ? 'all' : 'part') : sh.status === 'unknown' ? 'unknown' : 'busy', afterNight, prevTail: nightTail(prev) };
};
/** Drop what is already past: on `now`'s day nothing starts before now + `lead` minutes (getting there), earlier days have nothing left. */
export function clipToNow(wins, date, now = new Date(), lead = AFTER, min = MIN_WINDOW) {
  const cut = Math.round((now - startOfDay(date)) / 60000) + lead; if (cut <= WAKE) return wins;
  return wins.map(([a, b]) => [Math.max(a, cut), b]).filter(([a, b]) => b - a >= min);
}

/** You, as a friend-shaped record so the same code answers "when am I free?". Events you already have today subtract from your windows. */
const myKey = (s) => { const me = rec(s.rotas).flatMap(r => r.people).find(p => isMe(s, p)); return me ? keyOfP(me) : ''; };
export function myWindows(s, date, busy = []) {
  const key = myKey(s);
  let wins = freeWindows(s, { rotaKey: key }, date); if (!key) wins = [[WAKE, LATE]];
  for (const [bs, be] of busy) wins = wins.flatMap(([a, b]) => be <= a || bs >= b ? [[a, b]] : [[a, Math.min(b, bs)], [Math.max(a, be), b]]).filter(w => w[1] - w[0] >= MIN_WINDOW);
  return wins;
}
const intersect = (A, B) => A.flatMap(([a, b]) => B.map(([c, d]) => [Math.max(a, c), Math.min(b, d)])).filter(w => w[1] - w[0] >= MIN_WINDOW);

/** Ranked chances to meet. For every day in range: the windows when you and the chosen friends are all free (or most of them).
 *  Times before `now` (+ travel) are never offered. `busy` = known but not free; `unknown` = no schedule info (not the same as busy). */
export function meetups(s, { ids = null, from = null, days = 21, minMin = 120, busyOf = () => [], now = new Date() } = {}) {
  const friends = friendList(s).filter(f => !ids || ids.includes(f.id)); const out = [], start = startOfDay(from || now), meKey = myKey(s);   // no `from`: start on `now`'s day, not the machine's
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i), mine = clipToNow(myWindows(s, date, busyOf(date)), date, now); if (!mine.length) continue;
    const states = friends.map(f => { const st = dayState(s, f, date); return { f, wins: st.windows, st }; });
    const known = states.filter(x => x.st.free !== 'unknown').sort((a, b) => (b.f.fav ? 1 : 0) - (a.f.fav ? 1 : 0)), unknownF = states.filter(x => x.st.free === 'unknown').map(x => x.f);
    const meNight = meKey ? dayState(s, { rotaKey: meKey }, date).afterNight : false;
    // best window for the largest group: try each of my windows, intersect friend by friend, keep those who still fit
    for (const mw of mine) {
      let group = [], win = [mw];
      for (const x of known) { const nw = intersect(win, x.wins); if (nw.length) { win = nw; group.push(x); } }
      if (!group.length) continue; const w = win.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]; if (w[1] - w[0] < minMin) continue;
      const gf = group.map(x => x.f), missing = friends.filter(f => !gf.includes(f)), dow = date.getDay(), weekend = dow === 5 || dow === 6;
      const all = !missing.length, unknownN = unknownF.length, dayLong = w[1] - w[0] >= 8 * H && !meNight && !group.some(x => x.st.afterNight);
      const score = gf.length * 10 + (all && friends.length > 1 ? 15 : 0) - missing.length * 3 + Math.min(w[1] - w[0], 480) / 60 + (weekend ? 4 : 0) + (w[0] >= 17 * H ? 1.5 : 0) - i * 0.15 - unknownN * 0.5 + gf.filter(f => overdue(s, f, date) > 0).length * 2;
      out.push({ date, key: keyOf(date), window: w, who: gf.map(f => f.id), missing: missing.map(f => f.id), busy: missing.filter(f => !unknownF.includes(f)).map(f => f.id), unknown: unknownF.map(f => f.id), all, unknownN, weekend, score, dayLong });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// ───────────────────────────── outings, keeping in touch
/** `start` (minutes) is kept for planned meet-ups so "did it happen?" waits until it has. A future date is always planned. */
export function logOuting(s, o) {
  const id = o.id || 'o' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4), when = /^\d{4}-\d\d-\d\d$/.test(o.date) ? o.date : keyOf(new Date());
  const start = Number.isFinite(+o.start) && o.start !== '' && o.start != null ? Math.max(0, Math.min(1439, Math.round(+o.start))) : null;
  const out = { id, date: when, who: (o.who || []).filter(Boolean), what: String(o.what || '').slice(0, 80), where: String(o.where || '').slice(0, 80), rating: Math.max(0, Math.min(5, +o.rating || 0)), notes: String(o.notes || '').slice(0, 400), planned: !!o.planned || when > keyOf(new Date()), ...(start != null ? { start } : {}), at: Date.now() };
  return { ...s, outings: { ...(s.outings || {}), [id]: out } };
}
/** A planned outing whose time has passed: ask whether it happened. Without a start time, ask from the next day. */
export const outingDue = (o, now = new Date()) => { if (!o.planned) return false; const t = keyOf(now); if (o.date < t) return true; if (o.date > t || o.start == null) return false; return now.getHours() * 60 + now.getMinutes() >= o.start + 120; };
export function deleteOuting(s, id) { const outings = { ...(s.outings || {}) }; delete outings[id]; return { ...s, outings, deleted: { ...(s.deleted || {}), [`outing:${id}`]: Date.now() } }; }
export const outingList = (s) => rec(s.outings).sort((a, b) => b.date.localeCompare(a.date));
export function lastSeen(s, id, now = new Date()) { const t = keyOf(now); const l = outingList(s).filter(o => !o.planned && o.date <= t && o.who.includes(id))[0]; return l ? l.date : ''; }
/** Days past the gap you said you want (0 if you set none or are on time). */
export function overdue(s, f, now = new Date()) {
  if (!f.every) return 0; const ls = lastSeen(s, f.id, now), since = ls ? Math.round((startOfDay(now) - fromKey(ls)) / 864e5) : Math.round((startOfDay(now) - new Date(f.createdAt || now)) / 864e5);
  return Math.max(0, since - f.every);
}
export function friendStats(s, f, now = new Date()) {
  const y = String(now.getFullYear()), t = keyOf(now), all = outingList(s).filter(o => !o.planned && o.date <= t && o.who.includes(f.id)), yr = all.filter(o => o.date.startsWith(y)), rated = all.filter(o => o.rating);
  return { total: all.length, thisYear: yr.length, last: lastSeen(s, f.id, now), avgRating: rated.length ? rated.reduce((t, o) => t + o.rating, 0) / rated.length : null, favPlace: (() => { const c = {}; all.forEach(o => { if (o.where) c[o.where] = (c[o.where] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; })() };
}
/** Birthdays in the next `days`, soonest first. Accepts YYYY-MM-DD or MM-DD. */
export function birthdays(s, now = new Date(), days = 45) {
  const t = startOfDay(now), out = [];
  for (const f of friendList(s)) { if (!f.birthday) continue; const [m, d] = f.birthday.split('-').slice(-2).map(Number); if (!m || !d) continue; let n = new Date(t.getFullYear(), m - 1, d); if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d); const inDays = Math.round((n - t) / 864e5); if (inDays <= days) out.push({ friend: f, date: n, inDays }); }
  return out.sort((a, b) => a.inDays - b.inDays);
}

// ───────────────────────────── ideas for the time you have
/** Suggestions fitted to the window (length, time of day, weekday), the group size and what is in your Library. */
export function ideas({ window, size = 1, date = new Date(), watch = null, backlogGame = null, birthday = null }) {
  const len = window ? window[1] - window[0] : 180, startH = window ? window[0] / H : 18, dow = date.getDay(), weekend = dow === 5 || dow === 6, out = [];
  const add = (icon, title, why) => out.push({ icon, title, why });
  if (birthday) add('🎂', `Surprise dinner for ${birthday}`, 'Their birthday is close; book a table and ask the others to chip in.');
  if (len >= 8 * H) { add('🏜️', 'Desert or dune day trip', 'A whole free day for everyone; leave early, be back by dark.'); add('🥾', 'Edge of the World / hiking morning', 'Sunrise start, long breakfast after.'); if (size >= 3) add('⚽', 'Padel or football match', 'Enough of you for two teams.'); }
  if (len >= 4 * H && startH < 15) { add('🍳', 'Late brunch, then somewhere to walk it off', 'Long window from the morning.'); add('☕', 'Specialty café crawl', 'Pick two, share dessert.'); }
  if (startH >= 17) { add('🍽️', 'Dinner out', 'Everyone is free after work; book for 20:00–20:30.'); add('☕', 'Late coffee and a walk', 'Short, easy after a shift.'); if (weekend) add('🎳', 'Bowling or arcade', 'Fri/Sat evening, good for groups.'); }
  if (len >= 3 * H) { if (size >= 3) add('🧩', 'Escape room', 'Best with 3–6 people and about 90 minutes.'); add('🎬', 'Movie night', watch ? `Pick from your list: ${watch}` : 'Cinema, or a film at someone’s place.'); }
  if (backlogGame) add('🎮', `Game night: ${backlogGame}`, 'From your Steam backlog; ask who owns it.');
  if (len < 3 * H) { add('🥤', 'Quick coffee or shawarma', 'Short window: keep it close to whoever works furthest away.'); add('🚶', 'Evening walk on the corniche', 'No booking needed.'); }
  if (size >= 4) add('🍖', 'Home BBQ or potluck', 'Cheaper than a restaurant and nobody leaves early.');
  return out.slice(0, 8);
}
/** HH:MM for a minute of the day. Exactly midnight at the end of a window is 24:00 (not 23:59); past midnight wraps (a 23:00–01:00 slot reads 23:00–01:00). */
export const hhmm = (m) => { m = Math.round(+m || 0); if (m === 1440) return '24:00'; m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** The message you send to ask. `choices` are meetup results; with several, people reply with a number. */
export function inviteText({ names = [], choices = [], what = '', fmtDay = (d) => keyOf(d), fmtT = hhmm }) {
  const to = names.length ? names.join(', ') : 'everyone', line = (c) => `${fmtDay(c.date)} ${fmtT(c.window[0])}–${fmtT(c.window[1])}`;
  if (choices.length === 1) return `Hey ${to}! I’m free ${line(choices[0])}${what ? ` — ${what}?` : ' — are you up for something?'}`;
  return `Hey ${to}! ${what ? `${what}? ` : 'Shall we meet up? '}Which works for you?\n${choices.map((c, i) => `${i + 1}) ${line(c)}`).join('\n')}\nReply with a number 👍`;
}
/** Read .vcf contacts (FN + TEL + optional BDAY/NICKNAME). BDAY may be 19900105, 1990-01-05 or vCard 4's --0105. */
export function parseVCF(text) {
  const out = []; for (const card of String(text || '').split(/BEGIN:VCARD/i).slice(1)) {
    const g = (k) => { const m = new RegExp(`^${k}[^:\\r\\n]*:(.*)$`, 'im').exec(card); return m ? m[1].trim() : ''; };
    const name = g('FN') || g('N').split(';').filter(Boolean).reverse().join(' '); if (!name) continue; const bd = g('BDAY').split('T')[0].replace(/[^\d-]/g, ''); const tel = g('TEL');
    out.push({ name, phone: tel, nick: g('NICKNAME'), birthday: parseBirthday(bd) });
  } return out;
}

// ───────────── people from the rotas (doctors, specialists, nurses): numbers and social handles on top of what the rota already says
/** Handles for a rota person. If they are also one of your friends, the friend record is the single source. */
export function contactOf(s, key) {
  const fr = rec(s.friends).find(f => f.rotaKey === key);
  if (fr) return { friend: fr, phone: fr.phone, whatsapp: fr.whatsapp, snap: fr.snap, insta: fr.insta, note: fr.notes, birthday: fr.birthday };
  return { friend: null, ...(s.contacts?.[key] || {}) };
}
export function setContact(s, key, patch) {
  const fr = rec(s.friends).find(f => f.rotaKey === key), p = { phone: asciiDigits(patch.phone || '').slice(0, 24), whatsapp: asciiDigits(patch.whatsapp || '').slice(0, 24), snap: cleanHandle(patch.snap), insta: cleanHandle(patch.insta), note: String(patch.note || '').slice(0, 300), birthday: parseBirthday(patch.birthday) };
  if (fr) return updateFriend(s, fr.id, { birthday: p.birthday || fr.birthday, phone: p.phone, whatsapp: p.whatsapp, snap: p.snap, insta: p.insta, notes: p.note });
  const contacts = { ...(s.contacts || {}) }; if (!p.phone && !p.whatsapp && !p.snap && !p.insta && !p.note && !p.birthday) delete contacts[key]; else contacts[key] = { key, ...p, at: Date.now() };
  return { ...s, contacts, deleted: { ...(s.deleted || {}), ...(!contacts[key] ? { [`contact:${key}`]: Date.now() } : {}) } };
}
/** Every handle we know for a rota person, as links. Your own entry wins only when it is a usable number; otherwise the rota's number still works. */
export function reachLinks(s, person, key) { const c = contactOf(s, key), phone = normPhone(c.phone) ? c.phone : (person.mobile || c.phone || ''); return links({ phone, whatsapp: c.whatsapp || '', snap: c.snap, insta: c.insta }); }
/** Make a rota person a friend (their shifts then feed the free-days grid). Everything saved on their contact — birthday included — moves over. */
export function friendFromPerson(s, person, key, kind) {
  const old = s.contacts?.[key] || {};
  return addFriend(s, { name: bare(person.name) || person.name, kind, rotaKey: key, phone: normPhone(old.phone) ? old.phone : person.mobile || old.phone || '', whatsapp: old.whatsapp || '', snap: old.snap || '', insta: old.insta || '', notes: old.note || '', birthday: old.birthday || '', every: 30 });
}

/** Your own day in the same shape as a friend's (status work/off/leave, shift type, free windows), so the grid can show you working too. */
export function meState(s, date, busy = []) {
  const key = myKey(s); if (!key) return { status: 'unknown', windows: myWindows(s, date, busy) };
  const st = dayState(s, { rotaKey: key }, date); return { ...st, windows: myWindows(s, date, busy) };
}

// ───────── find a day: any people from the app (friends, colleagues, nurses), not only friends
/** A friend-shaped record for anyone in the rotas, reusing their friend entry when there is one (so hand-entered shifts count). */
export function personRecord(s, key, name) { const fr = friendList(s).find(f => f.rotaKey === key || f.id === key); return fr || { id: key, name: bare(name) || name || key.replace(/^(id|name):/, ''), rotaKey: key.startsWith('id:') || key.startsWith('name:') ? key : '' }; }
/** For each day ahead: the time everyone picked is free together (you included unless `withMe` is false).
 *  `all` = everyone free for at least `minMin`; otherwise who is missing. People with no schedule info are listed, never assumed free.
 *  Time already past (before `now` + travel) is dropped. Asking for a whole day (minMin ≥ 8h) never counts someone just off a night. */
export function commonFree(s, people, { from = null, days = 21, withMe = true, minMin = 120, busyOf = () => [], now = new Date() } = {}) {
  const out = [], start = startOfDay(from || now), whole = minMin >= 8 * H, meKey = myKey(s);
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i), states = people.map(p => ({ p, st: dayState(s, p, date) })), unknown = states.filter(x => x.st.free === 'unknown');
    const meNight = withMe && meKey ? dayState(s, { rotaKey: meKey }, date).afterNight : false;
    let win = clipToNow(withMe ? myWindows(s, date, busyOf(date)) : [[WAKE, LATE]], date, now); if (!win.length || (whole && meNight)) { out.push({ date, key: keyOf(date), all: false, me: false, window: null, windows: [], free: [], missing: states.filter(x => x.st.free !== 'unknown').map(x => x.p), unknown: unknown.map(x => x.p), weekend: [5, 6].includes(date.getDay()), dayLong: false }); continue; }
    const free = [], missing = [];
    for (const x of states) { if (x.st.free === 'unknown') continue; if (whole && x.st.afterNight) { missing.push(x.p); continue; } const nw = intersect(win, x.st.windows).filter(w => w[1] - w[0] >= minMin); if (nw.length) { win = nw; free.push(x.p); } else missing.push(x.p); }
    const w = win.filter(w => w[1] - w[0] >= minMin).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;
    const dayLong = !!w && w[1] - w[0] >= 8 * H && !meNight && !free.some(p => states.find(x => x.p === p).st.afterNight);
    out.push({ date, key: keyOf(date), all: !!w && !missing.length && !unknown.length && free.length === people.length, me: true, window: w, windows: win, free, missing, unknown: unknown.map(x => x.p), weekend: [5, 6].includes(date.getDay()), dayLong });
  }
  return out;
}
