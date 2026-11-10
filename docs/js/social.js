// Social: friends, their handles, when they are free, when you and they overlap, and what to do with that time. Pure functions (no DOM).
import { interpretCode } from './rota-parser.js';
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { isMe } from './model.js';

const rec = (m) => Object.values(m || {});
const uid = () => 'f' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]/g, ' ').replace(/\s+/g, ' ').trim();

// ───────────────────────────── handles and links (paste a link, an @name or a bare name — all work)
export const cleanHandle = (v) => { let x = String(v || '').trim(); if (!x) return ''; x = x.replace(/^https?:\/\/(www\.)?(instagram\.com|snapchat\.com\/add|snapchat\.com\/@|tiktok\.com\/@|x\.com|twitter\.com)\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0]; return /^[A-Za-z0-9._-]{1,40}$/.test(x) ? x : ''; };
/** Digits only with a country code. Local Saudi numbers (05xxxxxxxx) get 966; anything with + or 00 is kept as given. */
export function normPhone(v, cc = '966') {
  let d = String(v || '').trim(); if (!d) return ''; const plus = d.startsWith('+') || d.startsWith('00'); d = d.replace(/[^\d]/g, ''); if (d.startsWith('00')) d = d.slice(2);
  if (plus) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.startsWith('0')) d = cc + d.slice(1); else if (d.length <= 9) d = cc + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}
export const links = (f, cc = '966') => {
  const ph = normPhone(f.phone, cc), wa = normPhone(f.whatsapp || f.phone, cc), snap = cleanHandle(f.snap), ig = cleanHandle(f.insta);
  return { tel: ph ? `tel:+${ph}` : '', wa: wa ? `https://wa.me/${wa}` : '', snap: snap ? `https://www.snapchat.com/add/${snap}` : '', insta: ig ? `https://www.instagram.com/${ig}/` : '', sms: ph ? `sms:+${ph}` : '' };
};
export const waWith = (f, text, cc) => { const l = links(f, cc).wa; return l ? `${l}?text=${encodeURIComponent(text)}` : ''; };

// ───────────────────────────── friend records (merge per record by `at`, like everything else)
export const FRIEND_KINDS = [{ id: 'gp', label: 'GP colleague' }, { id: 'nurse', label: 'Nurse / shifts' }, { id: 'other', label: 'Other' }];
export const SHIFT_CODES = [{ id: 'D', label: 'Day' }, { id: 'E', label: 'Evening' }, { id: 'N', label: 'Night' }, { id: 'off', label: 'Off' }, { id: 'leave', label: 'Leave' }];
const DEFAULT_HOURS = { D: [7 * 60, 19 * 60], E: [13 * 60, 22 * 60], N: [19 * 60, 7 * 60] };
export function addFriend(s, f) {
  const name = String(f.name || '').trim().slice(0, 60); if (!name) return s; const id = f.id || uid();
  const fr = { id, name, nick: String(f.nick || '').slice(0, 30), kind: ['gp', 'nurse', 'other'].includes(f.kind) ? f.kind : 'other', phone: String(f.phone || '').slice(0, 24), whatsapp: String(f.whatsapp || '').slice(0, 24), snap: cleanHandle(f.snap), insta: cleanHandle(f.insta),
    rotaKey: f.rotaKey || '', place: String(f.place || '').slice(0, 60), birthday: /^\d{4}-\d\d-\d\d$|^\d\d-\d\d$/.test(f.birthday || '') ? f.birthday : '', every: Math.max(0, Math.min(365, +f.every || 0)), notes: String(f.notes || '').slice(0, 500),
    sched: f.sched && typeof f.sched === 'object' ? f.sched : {}, weeklyOff: Array.isArray(f.weeklyOff) ? f.weeklyOff.filter(n => n >= 0 && n <= 6) : [], hours: f.hours || {}, fav: !!f.fav, createdAt: f.createdAt || Date.now(), at: Date.now() };
  return { ...s, friends: { ...(s.friends || {}), [id]: fr } };
}
export function updateFriend(s, id, patch) { const cur = s.friends?.[id]; if (!cur) return s; return addFriend(s, { ...cur, ...patch, id, createdAt: cur.createdAt }); }
export function deleteFriend(s, id) { const friends = { ...(s.friends || {}) }; delete friends[id]; return { ...s, friends, deleted: { ...(s.deleted || {}), [`friend:${id}`]: Date.now() } }; }
export const friendList = (s) => rec(s.friends).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.name.localeCompare(b.name));
export const shortName = (f) => f.nick || String(f.name).split(' ')[0];
/** Set (or clear with '') one day of a manually-kept schedule. */
export function setShift(s, id, date, code) { const f = s.friends?.[id]; if (!f) return s; const sched = { ...(f.sched || {}) }; if (!code) delete sched[date]; else sched[date] = code; return updateFriend(s, id, { sched }); }

// ───────────────────────────── linking to the rota
const rotaPeople = (s) => { const out = new Map(); for (const r of rec(s.rotas)) for (const p of r.people) { const k = p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`; if (!out.has(k)) out.set(k, { key: k, name: p.name, id: p.id, mobile: p.mobile, title: p.title }); } return [...out.values()]; };
/** People in the loaded rotas whose name contains every word you typed ("Mohammed Merri" finds only that Mohammed). */
export function matchRota(s, name) {
  const want = norm(name).split(' ').filter(Boolean); if (!want.length) return [];
  return rotaPeople(s).filter(p => !isMe(s, p)).map(p => { const have = norm(p.name).split(' '); const hit = want.filter(w => have.some(x => x === w || x.startsWith(w))).length; return { ...p, ratio: hit / want.length, score: hit / want.length - (have.length - want.length) * 0.01 }; })
    .filter(p => p.ratio >= 1).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
const rotaCode = (s, key, d) => {
  for (const r of rec(s.rotas)) { if (r.year !== d.getFullYear() || r.month !== d.getMonth() + 1) continue; const p = r.people.find(x => (x.id ? `id:${x.id}` : `name:${x.name.toLowerCase()}`) === key); if (p) return interpretCode(p.days[d.getDate()] || '', r.legend, r.unitKind); }
  return null;
};

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
  if (code) { if (code === 'off') return { status: 'off', type: '' }; if (code === 'leave') return { status: 'leave', type: '' }; const hrs = f.hours?.[code] || DEFAULT_HOURS[code]; if (hrs) return { status: 'work', type: code, start: hrs[0], end: hrs[1] <= hrs[0] ? hrs[1] + 1440 : hrs[1] }; }
  if (f.weeklyOff?.includes(date.getDay())) return { status: 'off', type: '' };
  return { status: 'unknown', type: '', why };
}
/** Free windows [from, to] in minutes for someone on a date, allowing for travel, sleep after a night and a rest before one. */
export function freeWindows(s, f, date) {
  const today = personShift(s, f, date), prev = personShift(s, f, addDays(date, -1)), wins = [];
  const tailEnd = prev.status === 'work' && prev.end > 1440 ? prev.end - 1440 : 0;   // yesterday's night shift still running into this morning
  const from = Math.max(WAKE, tailEnd ? tailEnd + 8 * H : WAKE);                       // after a night, sleep ~8h first
  if (today.status === 'leave' || today.status === 'off') wins.push([Math.min(from, 20 * H), LATE]);
  else if (today.status === 'work') {
    if (today.type === 'N' || today.start >= 17 * H) { const to = today.start - BEFORE - (today.type === 'N' ? 2 * H : 0); if (to - Math.max(from, 14 * H) >= MIN_WINDOW) wins.push([Math.max(from, 14 * H), to]); }   // before an evening or night: only the afternoon
    else { if (today.start - BEFORE - from >= MIN_WINDOW) wins.push([from, today.start - BEFORE]); const after = today.end + AFTER; if (today.end <= LATE && LATE - after >= MIN_WINDOW) wins.push([after, LATE]); }
  } else return [];
  return wins.filter(w => w[1] - w[0] >= MIN_WINDOW);
}
export const dayState = (s, f, date) => { const sh = personShift(s, f, date), w = freeWindows(s, f, date); return { ...sh, windows: w, free: w.length ? (w.some(x => x[1] - x[0] >= 8 * H) ? 'all' : 'part') : sh.status === 'unknown' ? 'unknown' : 'busy', afterNight: personShift(s, f, addDays(date, -1)).end > 1440 }; };

/** You, as a friend-shaped record so the same code answers "when am I free?". Events you already have today subtract from your windows. */
export function myWindows(s, date, busy = []) {
  const me = rec(s.rotas).flatMap(r => r.people).find(p => isMe(s, p)); const key = me ? (me.id ? `id:${me.id}` : `name:${me.name.toLowerCase()}`) : '';
  let wins = freeWindows(s, { rotaKey: key }, date); if (!key) wins = [[WAKE, LATE]];
  for (const [bs, be] of busy) wins = wins.flatMap(([a, b]) => be <= a || bs >= b ? [[a, b]] : [[a, Math.min(b, bs)], [Math.max(a, be), b]]).filter(w => w[1] - w[0] >= MIN_WINDOW);
  return wins;
}
const intersect = (A, B) => A.flatMap(([a, b]) => B.map(([c, d]) => [Math.max(a, c), Math.min(b, d)])).filter(w => w[1] - w[0] >= MIN_WINDOW);

/** Ranked chances to meet. For every day in range: the windows when you and the chosen friends are all free (or most of them). */
export function meetups(s, { ids = null, from = new Date(), days = 21, minMin = 120, busyOf = () => [], now = new Date() } = {}) {
  const friends = friendList(s).filter(f => !ids || ids.includes(f.id)); const out = [], start = startOfDay(from);
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i), mine = myWindows(s, date, busyOf(date)); if (!mine.length) continue;
    const states = friends.map(f => ({ f, wins: freeWindows(s, f, date), st: dayState(s, f, date) }));
    const known = states.filter(x => x.st.free !== 'unknown');
    // best window for the largest group: try each of my windows, intersect friend by friend, keep those who still fit
    for (const mw of mine) {
      let group = [], win = [mw];
      for (const x of known.sort((a, b) => (b.f.fav ? 1 : 0) - (a.f.fav ? 1 : 0))) { const nw = intersect(win, x.wins); if (nw.length) { win = nw; group.push(x.f); } }
      if (!group.length) continue; const w = win.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]; if (w[1] - w[0] < minMin) continue;
      const missing = friends.filter(f => !group.includes(f)), dow = date.getDay(), weekend = dow === 5 || dow === 6;
      const all = !missing.length, unknownN = states.filter(x => x.st.free === 'unknown').length;
      const score = group.length * 10 + (all && friends.length > 1 ? 15 : 0) - missing.length * 3 + Math.min(w[1] - w[0], 480) / 60 + (weekend ? 4 : 0) + (w[0] >= 17 * H ? 1.5 : 0) - i * 0.15 - unknownN * 0.5 + group.filter(f => overdue(s, f, date) > 0).length * 2;
      out.push({ date, key: keyOf(date), window: w, who: group.map(f => f.id), missing: missing.map(f => f.id), all, unknownN, weekend, score, dayLong: w[1] - w[0] >= 8 * H });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// ───────────────────────────── outings, keeping in touch
export function logOuting(s, o) {
  const id = o.id || 'o' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4), when = /^\d{4}-\d\d-\d\d$/.test(o.date) ? o.date : keyOf(new Date());
  const out = { id, date: when, who: (o.who || []).filter(Boolean), what: String(o.what || '').slice(0, 80), where: String(o.where || '').slice(0, 80), rating: Math.max(0, Math.min(5, +o.rating || 0)), notes: String(o.notes || '').slice(0, 400), planned: !!o.planned, at: Date.now() };
  return { ...s, outings: { ...(s.outings || {}), [id]: out } };
}
export function deleteOuting(s, id) { const outings = { ...(s.outings || {}) }; delete outings[id]; return { ...s, outings, deleted: { ...(s.deleted || {}), [`outing:${id}`]: Date.now() } }; }
export const outingList = (s) => rec(s.outings).sort((a, b) => b.date.localeCompare(a.date));
export function lastSeen(s, id, now = new Date()) { const t = keyOf(now); const l = outingList(s).filter(o => !o.planned && o.date <= t && o.who.includes(id))[0]; return l ? l.date : ''; }
/** Days past the gap you said you want (0 if you set none or are on time). */
export function overdue(s, f, now = new Date()) {
  if (!f.every) return 0; const ls = lastSeen(s, f.id, now), since = ls ? Math.round((startOfDay(now) - fromKey(ls)) / 864e5) : Math.round((startOfDay(now) - new Date(f.createdAt || now)) / 864e5);
  return Math.max(0, since - f.every);
}
export function friendStats(s, f, now = new Date()) {
  const y = String(now.getFullYear()), all = outingList(s).filter(o => !o.planned && o.who.includes(f.id)), yr = all.filter(o => o.date.startsWith(y)), rated = all.filter(o => o.rating);
  return { total: all.length, thisYear: yr.length, last: lastSeen(s, f.id, now), avgRating: rated.length ? rated.reduce((t, o) => t + o.rating, 0) / rated.length : null, favPlace: (() => { const c = {}; all.forEach(o => { if (o.where) c[o.where] = (c[o.where] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; })() };
}
/** Birthdays in the next `days`, soonest first. Accepts YYYY-MM-DD or MM-DD. */
export function birthdays(s, now = new Date(), days = 45) {
  const t = startOfDay(now), out = [];
  for (const f of friendList(s)) { if (!f.birthday) continue; const [m, d] = f.birthday.split('-').slice(-2).map(Number); let n = new Date(t.getFullYear(), m - 1, d); if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d); const inDays = Math.round((n - t) / 864e5); if (inDays <= days) out.push({ friend: f, date: n, inDays }); }
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
/** The message you send to ask. `choices` are meetup results; with several, people reply with a number. */
export function inviteText({ names = [], choices = [], what = '', fmtDay = (d) => keyOf(d), fmtT = (m) => m }) {
  const to = names.length ? names.join(', ') : 'everyone', line = (c) => `${fmtDay(c.date)} ${fmtT(c.window[0])}–${fmtT(c.window[1])}`;
  if (choices.length === 1) return `Hey ${to}! I’m free ${line(choices[0])}${what ? ` — ${what}?` : ' — are you up for something?'}`;
  return `Hey ${to}! ${what ? `${what}? ` : 'Shall we meet up? '}Which works for you?\n${choices.map((c, i) => `${i + 1}) ${line(c)}`).join('\n')}\nReply with a number 👍`;
}
/** Read .vcf contacts (FN + TEL + optional BDAY/NICKNAME). */
export function parseVCF(text) {
  const out = []; for (const card of String(text || '').split(/BEGIN:VCARD/i).slice(1)) {
    const g = (k) => { const m = new RegExp(`^${k}[^:\\r\\n]*:(.*)$`, 'im').exec(card); return m ? m[1].trim() : ''; };
    const name = g('FN') || g('N').split(';').filter(Boolean).reverse().join(' '); if (!name) continue; const bd = g('BDAY').replace(/[^\d-]/g, ''); const tel = g('TEL');
    out.push({ name, phone: tel, nick: g('NICKNAME'), birthday: /^\d{8}$/.test(bd) ? `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6)}` : /^\d{4}-\d\d-\d\d$/.test(bd) ? bd : '' });
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
  const fr = rec(s.friends).find(f => f.rotaKey === key), p = { phone: String(patch.phone || '').slice(0, 24), whatsapp: String(patch.whatsapp || '').slice(0, 24), snap: cleanHandle(patch.snap), insta: cleanHandle(patch.insta), note: String(patch.note || '').slice(0, 300), birthday: /^\d{4}-\d\d-\d\d$|^\d\d-\d\d$/.test(patch.birthday || '') ? patch.birthday : '' };
  if (fr) return updateFriend(s, fr.id, { birthday: p.birthday || fr.birthday, phone: p.phone, whatsapp: p.whatsapp, snap: p.snap, insta: p.insta, notes: p.note });
  const contacts = { ...(s.contacts || {}) }; if (!p.phone && !p.whatsapp && !p.snap && !p.insta && !p.note && !p.birthday) delete contacts[key]; else contacts[key] = { key, ...p, at: Date.now() };
  return { ...s, contacts, deleted: { ...(s.deleted || {}), ...(!contacts[key] ? { [`contact:${key}`]: Date.now() } : {}) } };
}
/** Every handle we know for a rota person, as links (rota number first, your own entry on top). */
export function reachLinks(s, person, key) { const c = contactOf(s, key); return links({ phone: c.phone || person.mobile || '', whatsapp: c.whatsapp || '', snap: c.snap, insta: c.insta }); }
/** Make a rota person a friend (their shifts then feed the free-days grid). */
export function friendFromPerson(s, person, key, kind) {
  const old = s.contacts?.[key] || {};
  return addFriend(s, { name: person.name.replace(/^Dr\.?\s*/i, ''), kind, rotaKey: key, phone: old.phone || person.mobile || '', whatsapp: old.whatsapp || '', snap: old.snap || '', insta: old.insta || '', notes: old.note || '', every: 30 });
}

/** Your own day in the same shape as a friend's (status work/off/leave, shift type, free windows), so the grid can show you working too. */
export function meState(s, date, busy = []) {
  const me = rec(s.rotas).flatMap(r => r.people).find(p => isMe(s, p)), key = me ? (me.id ? `id:${me.id}` : `name:${me.name.toLowerCase()}`) : ''; if (!key) return { status: 'unknown', windows: myWindows(s, date, busy) };
  const st = dayState(s, { rotaKey: key }, date); return { ...st, windows: myWindows(s, date, busy) };
}
