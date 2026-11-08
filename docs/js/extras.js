// Social extras: time polls, place wishlist, team treats, birthdays of rota people, nurses' contract ends. Pure functions (no DOM).
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { allPeople } from './model.js';
const txt = (v, n) => String(v || '').trim().slice(0, n), uid = (p) => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const rec = (o) => Object.values(o || {});
const dte = (v) => /^\d{4}-\d\d-\d\d$/.test(v || '') ? v : '';

// ───────── time polls
export function savePoll(s, p) {
  const id = p.id || uid('p'), slots = (p.slots || []).filter(x => dte(x.date) && Number.isFinite(+x.start) && Number.isFinite(+x.end)).map(x => ({ date: x.date, start: +x.start, end: +x.end })).slice(0, 8);
  if (!slots.length) return s; const who = [...new Set(p.who || [])].slice(0, 30), votes = {}; for (const [f, v] of Object.entries(p.votes || {})) if (who.includes(f)) votes[f] = (v || []).filter(i => i >= 0 && i < slots.length);
  return { ...s, polls: { ...(s.polls || {}), [id]: { id, title: txt(p.title, 80) || 'Meet up', slots, who, votes, status: p.status === 'closed' ? 'closed' : 'open', chosen: Number.isInteger(p.chosen) && p.chosen < slots.length ? p.chosen : -1, at: Date.now() } } };
}
export const deletePoll = (s, id) => { const polls = { ...(s.polls || {}) }; delete polls[id]; return { ...s, polls, deleted: { ...(s.deleted || {}), [`poll:${id}`]: Date.now() } }; };
export const pollList = (s) => rec(s.polls).sort((a, b) => (a.status === b.status ? b.at - a.at : a.status === 'open' ? -1 : 1));
export function setVote(s, id, friendId, idxs) { const p = s.polls?.[id]; return p ? savePoll(s, { ...p, votes: { ...p.votes, [friendId]: idxs } }) : s; }
/** Yes-count per slot, who said yes, who has not answered, and the best slot (most yes; ties go to the earlier one). */
export function pollResult(p) {
  const counts = p.slots.map((_, i) => p.who.filter(f => (p.votes[f] || []).includes(i))), answered = p.who.filter(f => f in p.votes), waiting = p.who.filter(f => !(f in p.votes));
  let best = -1; counts.forEach((c, i) => { if (c.length && (best < 0 || c.length > counts[best].length)) best = i; });
  return { counts, answered, waiting, best, everyone: best >= 0 && counts[best].length === p.who.length && p.who.length > 0, noneFit: answered.length === p.who.length && p.who.length > 0 && best < 0 };
}
export function pollText(p, names, fmtDay, fmtT) {
  const to = names.length ? names.join(', ') : 'everyone', line = (c) => `${fmtDay(fromKey(c.date))} ${fmtT(c.start)}–${fmtT(c.end)}`;
  return `Hey ${to}! ${p.title}? Which of these work for you?\n${p.slots.map((c, i) => `${i + 1}) ${line(c)}`).join('\n')}\nReply with the numbers that work 👍`;
}

// ───────── wishlist
export const WISH_KINDS = [['food', '🍽', 'Restaurant / café'], ['trip', '🧳', 'Trip'], ['activity', '🎯', 'Activity'], ['place', '📍', 'Place to see']];
export function saveWish(s, w) { const id = w.id || uid('w'), name = txt(w.name, 80); if (!name) return s; const kind = WISH_KINDS.some(k => k[0] === w.kind) ? w.kind : 'place'; return { ...s, wishlist: { ...(s.wishlist || {}), [id]: { id, name, kind, city: txt(w.city, 40), note: txt(w.note, 300), url: /^https?:\/\//i.test(w.url || '') ? String(w.url).slice(0, 300) : '', with: [...new Set(w.with || [])].slice(0, 20), done: w.done ? dte(w.done) || keyOf(new Date()) : '', at: Date.now() } } }; }
export const deleteWish = (s, id) => { const wishlist = { ...(s.wishlist || {}) }; delete wishlist[id]; return { ...s, wishlist, deleted: { ...(s.deleted || {}), [`wish:${id}`]: Date.now() } }; };
export const wishList = (s, done = false) => rec(s.wishlist).filter(w => !!w.done === done).sort((a, b) => done ? b.done.localeCompare(a.done) : b.at - a.at);

// ───────── team treats
export function saveTreat(s, t) { const id = t.id || uid('t'), date = dte(t.date) || keyOf(new Date()); return { ...s, treats: { ...(s.treats || {}), [id]: { id, date, what: txt(t.what, 80) || 'Treat', for: txt(t.for, 60) || 'The team', cost: Math.max(0, Math.min(1e5, +t.cost || 0)), at: Date.now() } } }; }
export const deleteTreat = (s, id) => { const treats = { ...(s.treats || {}) }; delete treats[id]; return { ...s, treats, deleted: { ...(s.deleted || {}), [`treat:${id}`]: Date.now() } }; };
export const treatList = (s) => rec(s.treats).sort((a, b) => b.date.localeCompare(a.date));
/** Days since you last brought something, against your own usual gap (default 21). Nudge only after the gap has passed. */
export function treatNudge(s, now = new Date()) {
  const l = treatList(s); if (!l.length) return null; const today = startOfDay(now), since = Math.round((today - fromKey(l[0].date)) / 864e5);
  const gaps = l.slice(0, 6).slice(1).map((t, i) => Math.round((fromKey(l[i].date) - fromKey(t.date)) / 864e5)).filter(x => x > 0), usual = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 21;
  return { since, usual, due: since >= usual, last: l[0], spent: l.filter(t => t.date.slice(0, 7) === keyOf(today).slice(0, 7)).reduce((a, t) => a + t.cost, 0) };
}

// ───────── people from the rotas: birthdays (saved on their contact) and nurses' contract ends
const keyOfPerson = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
export function rotaBirthdays(s, now = new Date(), days = 45) {
  const t = startOfDay(now), names = new Map(allPeople(s).map(p => [p.key, p.name])), seenFriend = new Set(rec(s.friends).map(f => f.rotaKey).filter(Boolean)), out = [];
  for (const c of rec(s.contacts)) { if (!c.birthday || seenFriend.has(c.key)) continue; const [m, d] = c.birthday.split('-').slice(-2).map(Number); let n = new Date(t.getFullYear(), m - 1, d); if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d); const inDays = Math.round((n - t) / 864e5); if (inDays <= days) out.push({ key: c.key, name: names.get(c.key) || String(c.key).replace(/^name:/, ''), date: n, inDays }); }
  return out.sort((a, b) => a.inDays - b.inDays);
}
export function contractEnds(s, now = new Date(), days = 60) {
  const t = startOfDay(now), out = [];
  for (const r of rec(s.rotas)) { if (r.unitKind !== 'nurse') continue; for (const p of r.people) for (const [d, v] of Object.entries(p.days || {})) if (/END OF CONTRACT/i.test(v)) { const date = new Date(r.year, r.month - 1, +d), inDays = Math.round((date - t) / 864e5); if (inDays >= -3 && inDays <= days) out.push({ key: keyOfPerson(p), name: p.name, date, inDays }); } }
  return out.sort((a, b) => a.inDays - b.inDays);
}
