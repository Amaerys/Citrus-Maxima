// The nurses' schedule, and what the app can know about it. Pure functions (no DOM).
// The schedule gives each nurse a SHIFT (D, N, M, A…) but not a SITE for the "construction clinics" pool: those nurses are posted the night before
// to Upper Village, Lower Village or the Upper/Lower office clinics. So postings are entered here (state.posts), remembered, and used to say who works with you.
import { interpretCode } from './rota-parser.js';
import { keyOf, addDays } from './util.js';
import { overlapModel } from './board.js';

export const SITES = [
  { id: 'UPV', label: 'Upper Village', re: /upper village/i },
  { id: 'LPV', label: 'Lower Village', re: /lower village/i },
  { id: 'UPO', label: 'Upper office clinic', re: /upper office/i },
  { id: 'LPO', label: 'Lower office clinic', re: /lower office/i },
];
export const siteId = (text) => SITES.find(x => x.re.test(String(text || '')))?.id || '';
export const siteLabel = (id) => SITES.find(x => x.id === id)?.label || id;
const ALL = SITES.map(x => x.id);
/** group → who they are and where they can be posted. `fixed` groups work at one place and never float. */
export const GROUPS = {
  head: { label: 'Head nurse', choices: ALL, supervises: true },   // ALL SITES: oversees, is not posted, so never a "could be with you" candidate
  leaders: { label: 'Team leaders (UPV–LPV)', choices: ['UPV', 'LPV'] },   // the sheet heading says UPV-LPV
  fa: { label: 'First aiders', choices: ALL },
  pool: { label: 'Construction clinics', choices: ALL },
  fsed: { label: 'FSED', fixed: 'FSED' },
  aqua: { label: 'Aqua Arabia', fixed: 'Aqua Arabia' },
  sixflags: { label: 'Six Flags', fixed: 'Six Flags' },
  plateau: { label: 'Upper Plateau clinic', fixed: 'Upper Plateau clinic' },
  nairiya: { label: 'Nairiya project', fixed: 'Nairiya' },
};
/**
 * A group as this month's sheet defines it: the built-in meaning, with the posting choices the heading lists ("(UPV-LPV)"), or — for a heading
 * the app has never seen — a fixed group named after it (rota.groups, from the parser). Unknown keys never fall back to the floating pool.
 */
export function groupDef(key, rota = null) {
  const base = GROUPS[key], sheet = rota?.groups?.[key];
  if (base) { const ch = base.choices && sheet?.choices?.filter(c => ALL.includes(c)); return ch?.length ? { ...base, choices: ALL.filter(c => ch.includes(c)) } : base; }
  if (sheet) { const ch = (sheet.choices || []).filter(c => ALL.includes(c)), label = sheet.label || sheet.heading || key; return ch.length ? { label, choices: ALL.filter(c => ch.includes(c)) } : { label, fixed: sheet.fixed || label }; }
  const label = String(key).replace(/^sec:/, '').replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()) || 'Other';
  return { label, fixed: label };
}
/** Groups from imported sheets join GROUPS so screens that list GROUPS (directory filter, roster sections) show them too. */
function registerGroups(rotas) { for (const r of rotas) for (const k of Object.keys(r.groups || {})) if (!GROUPS[k]) GROUPS[k] = groupDef(k, r); }
export const isFloater = (g) => !!groupDef(g || 'pool').choices;
export const keyOfPerson = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
const rec = (m) => Object.values(m || {});
export const nurseRotaFor = (s, date) => rec(s.rotas).find(r => r.unitKind === 'nurse' && r.year === date.getFullYear() && r.month === date.getMonth() + 1) || null;
export const nurseRotas = (s) => { const l = rec(s.rotas).filter(r => r.unitKind === 'nurse'); registerGroups(l); return l; };
export const nurses = (s) => { const m = new Map(); for (const r of nurseRotas(s)) for (const p of r.people) m.set(keyOfPerson(p), p); return [...m.values()]; };

// ───────── postings
const pk = (date, key) => `${keyOf(date)}:${key}`;
/** A posting is either confirmed, or a tip: something you heard (e.g. from the team leader) before it was official. Only confirmed postings count as fact and as history. */
export const postOf = (s, date, key) => { const x = s.posts?.[pk(date, key)]; return x && !x.tip ? x.site : ''; };
export const tipOf = (s, date, key) => { const x = s.posts?.[pk(date, key)]; return x && x.tip ? { site: x.site, from: x.from || '', ...(x.guess ? { guess: true } : {}) } : null; };
export function setPost(s, date, key, site, opt = {}) {
  const id = pk(date, key), posts = { ...(s.posts || {}) }, deleted = { ...(s.deleted || {}) };
  if (!site) { delete posts[id]; deleted[`post:${id}`] = Date.now(); } else { posts[id] = { id, date: keyOf(date), key, site, ...(opt.tip ? { tip: true, from: String(opt.from || '').slice(0, 40), ...(opt.guess ? { guess: true } : {}) } : {}), at: Date.now() }; delete deleted[`post:${id}`]; }
  return { ...s, posts, deleted };
}
/** Everything a nurse has been posted to, newest first (before `before`, if given). */
export function history(s, key, before = null) {
  const lim = before ? keyOf(before) : '9999';
  return rec(s.posts).filter(x => x.key === key && x.date < lim && SITES.some(t => t.id === x.site) && !x.tip).sort((a, b) => b.date.localeCompare(a.date));
}
/** Where they probably go next: the place they were posted most recently. */
export function suggestPost(s, key, date, choices) { const h = history(s, key, date)[0]; return h && choices.includes(h.site) ? h.site : ''; }

/** Nurses working on a date, with their shift, group, posting and suggestion. */
export function rowsFor(s, date) {
  const r = nurseRotaFor(s, date); if (!r) return []; registerGroups([r]);
  const d = date.getDate(), out = [];
  for (const p of r.people) {
    const code = p.days[d] || '', shift = interpretCode(code, r.legend, 'nurse'); if (shift.kind !== 'work') continue;
    const g = groupDef(p.group || 'pool', r), key = keyOfPerson(p), fixed = g.fixed || '', choices = g.choices || [], tip = fixed ? null : tipOf(s, date, key);
    // no suggestion once there is a tip: the tip already says where they probably go
    out.push({ person: p, key, code, shift, group: p.group, fixed, choices, post: fixed || postOf(s, date, key), tip, suggest: fixed || tip ? '' : suggestPost(s, key, date, choices) });
  }
  return out;
}
export function staffing(s, date) {
  const rows = rowsFor(s, date), byShift = {}, bySite = {}; let unposted = 0;
  for (const r of rows) {
    byShift[r.shift.type] = (byShift[r.shift.type] || 0) + 1;
    if (r.post) { (bySite[r.post] ||= {})[r.shift.type] = (bySite[r.post][r.shift.type] || 0) + 1; } else if (isFloater(r.group) && r.group !== 'head') unposted++;
  }
  return { total: rows.length, byShift, bySite, unposted, rows };
}
/** "Use last posts": a guess from history is saved as a TIP (from "last time"), never as a confirmed posting — so it is not a fact on Today
 *  and does not train the chance model on its own guesses. Confirming each one is still a tap on the board. */
export function applySuggestions(s, date) { let x = s; for (const r of rowsFor(s, date)) if (!r.post && !r.tip && r.suggest) x = setPost(x, date, r.key, r.suggest, { tip: true, from: 'last time', guess: true }); return x; }

// ───────── who will work with me
const HALF_LIFE = 21;   // days: a posting three weeks ago counts half as much as one yesterday
/** Friends first (favourites before plain friends): with no history to go on, the people you care about are the useful tie-break, not the alphabet. */
const friendRank = (s, key) => { const f = rec(s.friends).find(x => x.rotaKey === key); return f ? (f.fav ? 2 : 1) : 0; };
/**
 * Nurses whose shift overlaps yours, split into the ones posted to your site ("confirmed"), the ones you heard about ("tipped"), and the ones who
 * could still be sent there ("possible", with a chance from where they were CONFIRMED before this date, recent postings weighing more).
 * Fixed groups (FSED, Aqua Arabia, Six Flags…) and nurses posted elsewhere are left out; the head nurse supervises, so is listed apart (`head`).
 * `likely` is the part of `possible` that history actually points at you; with no history there is nothing "likely", only `possible.length` who
 * could be sent — `summary` says so in one line, for every screen to use the same words.
 * mine: your dayInfo entry (GP shift with .shift.site / .shift.hours).
 */
export function workingWithMe(s, date, mine) {
  if (!mine || mine.shift.kind !== 'work' || !mine.shift.hours) return null;
  const site = siteId(mine.shift.site), rows = rowsFor(s, date);
  if (!rows.length) return { site, confirmed: [], tipped: [], possible: [], likely: [], head: [], elsewhere: 0, tippedElsewhere: 0, unposted: 0, hasNurses: false, summary: '' };
  const sup = (r) => !!groupDef(r.group).supervises;
  const cand = rows.filter(r => r.shift.hours && (sup(r) || (isFloater(r.group) && (!site || r.choices.includes(site) || r.post === site))));
  const om = overlapModel(mine, cand.map(r => ({ ...r, shift: r.shift })));
  const by = new Map(om?.rows.map(o => [o.entry.key, o]) || []);
  const confirmed = [], tipped = [], possible = [], head = []; let elsewhere = 0, unposted = 0, tippedElsewhere = 0;
  const day0 = keyOf(date), age = (k) => Math.max(0, (Date.parse(day0) - Date.parse(k)) / 864e5);
  for (const r of cand) {
    const o = by.get(r.key); if (!o) continue;
    const x = { ...r, overlap: o.overlap, pct: o.pct, from: o.from, to: o.to, entry: o.entry, friend: friendRank(s, r.key) };
    if (sup(r)) { head.push(x); continue; }
    if (r.post && site && r.post === site) confirmed.push(x);
    else if (r.post) elsewhere++;
    else if (r.tip && site && r.tip.site === site) { unposted++; tipped.push({ ...x, heardFrom: r.tip.from, guess: !!r.tip.guess }); }
    else if (r.tip && site) { unposted++; tippedElsewhere++; }
    else {
      unposted++;
      // only postings before this day count (a posting entered for the 25th says nothing about the 16th)
      const hist = history(s, r.key, date), n = hist.length, wt = (h) => Math.pow(0.5, age(h.date) / HALF_LIFE);
      const tot = hist.reduce((a, h) => a + wt(h), 0), at = site ? hist.filter(h => h.site === site).reduce((a, h) => a + wt(h), 0) : 0, k = Math.max(1, r.choices.length);
      const chance = site ? (at + 1) / (tot + k) : 0;
      possible.push({ ...x, chance, base: 1 / k, seen: n, known: n > 0 });
    }
  }
  const tie = (a, b) => b.friend - a.friend || b.pct - a.pct || a.person.name.localeCompare(b.person.name);
  confirmed.sort((a, b) => b.overlap - a.overlap || tie(a, b));
  // with history, the chance leads; with none, the chance is only a prior (1 / number of sites), so friends and overlap lead instead
  possible.sort((a, b) => (b.known - a.known) || (a.known ? b.chance * b.pct - a.chance * a.pct || tie(a, b) : b.friend - a.friend || b.chance * b.pct - a.chance * a.pct || tie(a, b)));
  tipped.sort((a, b) => (a.guess - b.guess) || b.overlap - a.overlap || tie(a, b));
  // "likely" needs evidence: a confirmed posting history that favours your site over an even split
  const likely = possible.filter(p => p.known && p.chance > p.base + 1e-9);
  const n = possible.length, fn = (r) => r.person.name.split(' ')[0];
  const summary = confirmed.length ? `${confirmed.length} posted with you${n ? ` · ${n} more could be sent` : ''}`
    : tipped.length ? `${tipped.length} heard${n ? ` · ${n} more could be sent` : ''}`
    : likely.length ? `Likely with you: ${likely.slice(0, 3).map(fn).join(', ')}${n > likely.length ? ` · ${n} could be sent` : ''}`
    : n ? `${n} could be sent, not posted yet` : '';
  return { site, confirmed, tipped, possible, likely, head, elsewhere, tippedElsewhere, unposted, hasNurses: true, summary };
}
/** Evening nudge: tomorrow's floaters not yet posted. */
export const unpostedFor = (s, date) => staffing(s, date).unposted;
