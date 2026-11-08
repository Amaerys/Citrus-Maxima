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
  head: { label: 'Head nurse', choices: ALL },
  leaders: { label: 'Team leaders (UPV–LPV)', choices: ['UPV', 'LPV'] },
  fa: { label: 'First aiders', choices: ALL },
  pool: { label: 'Construction clinics', choices: ALL },
  fsed: { label: 'FSED', fixed: 'FSED' },
  aqua: { label: 'Aqua Arabia', fixed: 'Aqua Arabia' },
  plateau: { label: 'Upper Plateau clinic', fixed: 'Upper Plateau clinic' },
  nairiya: { label: 'Nairiya project', fixed: 'Nairiya' },
};
export const isFloater = (g) => !!GROUPS[g]?.choices;
export const keyOfPerson = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
const rec = (m) => Object.values(m || {});
export const nurseRotaFor = (s, date) => rec(s.rotas).find(r => r.unitKind === 'nurse' && r.year === date.getFullYear() && r.month === date.getMonth() + 1) || null;
export const nurseRotas = (s) => rec(s.rotas).filter(r => r.unitKind === 'nurse');
export const nurses = (s) => { const m = new Map(); for (const r of nurseRotas(s)) for (const p of r.people) m.set(keyOfPerson(p), p); return [...m.values()]; };

// ───────── postings
const pk = (date, key) => `${keyOf(date)}:${key}`;
/** A posting is either confirmed, or a tip: something you heard (e.g. from the team leader) before it was official. Only confirmed postings count as fact and as history. */
export const postOf = (s, date, key) => { const x = s.posts?.[pk(date, key)]; return x && !x.tip ? x.site : ''; };
export const tipOf = (s, date, key) => { const x = s.posts?.[pk(date, key)]; return x && x.tip ? { site: x.site, from: x.from || '' } : null; };
export function setPost(s, date, key, site, opt = {}) {
  const id = pk(date, key), posts = { ...(s.posts || {}) }, deleted = { ...(s.deleted || {}) };
  if (!site) { delete posts[id]; deleted[`post:${id}`] = Date.now(); } else { posts[id] = { id, date: keyOf(date), key, site, ...(opt.tip ? { tip: true, from: String(opt.from || '').slice(0, 40) } : {}), at: Date.now() }; delete deleted[`post:${id}`]; }
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
  const r = nurseRotaFor(s, date); if (!r) return [];
  const d = date.getDate(), out = [];
  for (const p of r.people) {
    const code = p.days[d] || '', shift = interpretCode(code, r.legend, 'nurse'); if (shift.kind !== 'work') continue;
    const g = GROUPS[p.group] || GROUPS.pool, key = keyOfPerson(p), fixed = g.fixed || '', choices = g.choices || [];
    out.push({ person: p, key, code, shift, group: p.group, fixed, choices, post: fixed || postOf(s, date, key), tip: fixed ? null : tipOf(s, date, key), suggest: fixed ? '' : suggestPost(s, key, date, choices) });
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
export function applySuggestions(s, date) { let x = s; for (const r of rowsFor(s, date)) if (!r.post && !r.tip && r.suggest) x = setPost(x, date, r.key, r.suggest); return x; }

// ───────── who will work with me
/**
 * Nurses whose shift overlaps yours, split into the ones posted to your site ("confirmed") and the ones who could still be sent there ("possible",
 * with a chance from where they've been posted before). Fixed groups (FSED, Aqua Arabia…) and nurses posted elsewhere are left out.
 * mine: your dayInfo entry (GP shift with .shift.site / .shift.hours).
 */
export function workingWithMe(s, date, mine) {
  if (!mine || mine.shift.kind !== 'work' || !mine.shift.hours) return null;
  const site = siteId(mine.shift.site), rows = rowsFor(s, date); if (!rows.length) return { site, confirmed: [], tipped: [], possible: [], elsewhere: 0, tippedElsewhere: 0, unposted: 0, hasNurses: false };
  const cand = rows.filter(r => isFloater(r.group) && r.shift.hours && (!site || r.group === 'head' || r.choices.includes(site) || r.post === site));
  const om = overlapModel(mine, cand.map(r => ({ ...r, shift: r.shift })));
  const by = new Map(om?.rows.map(o => [o.entry.key, o]) || []);
  const confirmed = [], tipped = [], possible = []; let elsewhere = 0, unposted = 0, tippedElsewhere = 0;
  for (const r of cand) {
    const o = by.get(r.key); if (!o) continue;
    if (r.post && site && r.post === site) confirmed.push({ ...r, overlap: o.overlap, pct: o.pct, from: o.from, to: o.to, entry: o.entry });
    else if (r.post) elsewhere++;
    else if (r.tip && site && r.tip.site === site) { unposted++; tipped.push({ ...r, overlap: o.overlap, pct: o.pct, from: o.from, to: o.to, entry: o.entry, heardFrom: r.tip.from }); }
    else if (r.tip && site) { unposted++; tippedElsewhere++; }
    else {
      unposted++;
      const hist = history(s, r.key), n = hist.length, at = site ? hist.filter(x => x.date && x.site === site).length : 0, chance = site ? (at + 1) / (n + Math.max(1, r.choices.length)) : 0;
      possible.push({ ...r, overlap: o.overlap, pct: o.pct, from: o.from, to: o.to, chance, seen: n, entry: o.entry });
    }
  }
  confirmed.sort((a, b) => b.overlap - a.overlap || a.person.name.localeCompare(b.person.name));
  possible.sort((a, b) => b.chance * b.pct - a.chance * a.pct || a.person.name.localeCompare(b.person.name));
  tipped.sort((a, b) => b.overlap - a.overlap || a.person.name.localeCompare(b.person.name));
  return { site, confirmed, tipped, possible, elsewhere, tippedElsewhere, unposted, hasNurses: true };
}
/** Evening nudge: tomorrow's floaters not yet posted. */
export const unpostedFor = (s, date) => staffing(s, date).unposted;
