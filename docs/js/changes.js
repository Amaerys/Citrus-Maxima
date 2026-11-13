// What changed when a schedule is uploaded again: your shifts first, then who you work with, friends, and everyone else. Pure functions (no DOM).
import { interpretCode } from './rota-parser.js';
import { isMe } from './model.js';
import { keyOf } from './util.js';
import { overlapModel } from './board.js';
const pk = (p) => p.id ? `id:${p.id}` : `name:${String(p.name).toLowerCase()}`;
const clean = (c) => String(c || '').trim();
const short = (p) => String(p.name).replace(/^Dr\.?\s*/i, '').replace(/\s*-\s*TL$/, '');
/** Human label for a code: "Day 08:00–20:00", "Off", "Leave". */
export function codeLabel(code, rota) {
  const c = clean(code); if (!c) return 'Off'; const sh = interpretCode(c, rota.legend, rota.unitKind), t = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (sh.kind === 'off') return 'Off'; if (sh.kind === 'leave') return sh.label || 'Leave'; if (sh.kind === 'work' && sh.hours) return `${sh.label.replace(/ ·.*/, '')} ${t(sh.hours.start)}–${t(sh.hours.end)}${sh.site && rota.unitKind === 'gp' ? ` · ${sh.site}` : ''}`; return sh.label || c;
}
/** One person's shift on one day, shaped like a dayInfo entry so board.js overlapModel can read it. */
const entry = (p, d, rota) => { const sh = interpretCode(clean(p.days?.[d]), rota.legend, rota.unitKind); return sh.kind === 'work' && sh.hours ? { person: p, shift: sh } : null; };
/** Who is "with you" on day d of one rota version: the day sheet's rule (model.js dayInfo + app.js overlapCount) — same site, and at
 *  least 2h of your shift shared (overlapModel). Rotas without site names (one unit) compare everyone on them. Others at other sites
 *  are only counted (beta T02-04 / T01-20: the brief used to count every site and disagreed with the day sheet). */
export function teamOn(rota, me, d, keep = () => true) {
  const mine = me && entry(me, d, rota); if (!mine) return null;
  const site = mine.shift.site || '', with2h = (list) => { const m = overlapModel(mine, list); return (m?.rows || []).filter(r => r.overlap >= 120).map(r => r.entry.person); };
  const all = rota.people.filter(p => p !== me && keep(p)).map(p => entry(p, d, rota)).filter(Boolean);
  return { site, with: with2h(all.filter(e => (e.shift.site || '') === site)), elsewhere: site ? with2h(all.filter(e => (e.shift.site || '') !== site)).length : 0 };
}

/** Compare the stored version of a schedule with the newly uploaded one. `today` decides which changes are still ahead. */
export function diffRota(s, prev, next, today = new Date()) {
  const t0 = keyOf(today), dk = (d) => keyOf(new Date(next.year, next.month - 1, d)), days = Math.max(prev.daysInMonth || 0, next.daysInMonth || 0);
  const oldBy = new Map(prev.people.map(p => [pk(p), p])), newBy = new Map(next.people.map(p => [pk(p), p]));
  const friends = new Map(Object.values(s.friends || {}).filter(f => f.rotaKey).map(f => [f.rotaKey, f]));
  const out = { rotaId: next.id, unitKind: next.unitKind, year: next.year, month: next.month, source: next.sourceName || '', at: Date.now(), mine: [], withMe: [], friends: [], others: [], added: [], removed: [], total: 0, ahead: 0, people: 0 };
  for (const [k, p] of newBy) if (!oldBy.has(k)) out.added.push(short(p));
  for (const [k, p] of oldBy) if (!newBy.has(k)) out.removed.push(short(p));
  for (const [k, np] of newBy) {
    const op = oldBy.get(k); if (!op) continue; const ch = [];
    for (let d = 1; d <= days; d++) { const a = clean(op.days?.[d]), b = clean(np.days?.[d]); if (a === b) continue; const key = dk(d); ch.push({ day: d, date: key, from: codeLabel(a, prev), to: codeLabel(b, next), ahead: key >= t0 }); }
    if (!ch.length) continue; out.total += ch.length; out.ahead += ch.filter(c => c.ahead).length; out.people++;
    const row = { key: k, name: short(np), changes: ch };
    if (isMe(s, np)) out.mine = ch; else if (friends.has(k)) out.friends.push({ ...row, friend: friends.get(k).nick || friends.get(k).name }); else out.others.push(row);
  }
  // who now shares your hours, day by day (same schedule only; your own row decides your hours and your site)
  const meNew = next.people.find(p => isMe(s, p)), meOld = prev.people.find(p => isMe(s, p)), both = (p) => oldBy.has(pk(p)) && newBy.has(pk(p));
  if (meNew) for (let d = 1; d <= days; d++) {
    const key = dk(d); if (key < t0) continue; const tn = teamOn(next, meNew, d, both), to = meOld ? teamOn(prev, meOld, d, both) : null; if (!tn && !to) continue;
    const after = new Set((tn?.with || []).map(pk)), before = new Set((to?.with || []).map(pk));
    const joined = [...after].filter(k => !before.has(k)).map(k => short(newBy.get(k))), left = [...before].filter(k => !after.has(k)).map(k => short(oldBy.get(k) || newBy.get(k)));
    const mine = clean(meNew.days?.[d]) !== clean(meOld?.days?.[d]);
    // your own changed shift: say who you'll be with (all of them, not just the newcomers); otherwise only report a real change
    if (tn && (mine || joined.length || left.length)) out.withMe.push({ day: d, date: key, joined, left, mine, count: after.size, site: tn.site, elsewhere: tn.elsewhere, names: (tn.with || []).map(short) });
  }
  out.friends.sort((a, b) => b.changes.filter(c => c.ahead).length - a.changes.filter(c => c.ahead).length); out.others.sort((a, b) => b.changes.length - a.changes.length);
  return out;
}
/** Keep the last 30 update briefs, newest first. */
export function recordChanges(s, d) { if (!d || (!d.total && !d.added.length && !d.removed.length)) return s; const id = `${d.rotaId}@${d.at}`, all = { ...(s.rotaChanges || {}), [id]: { ...d, id, seen: false } }; const keep = Object.values(all).sort((a, b) => b.at - a.at).slice(0, 30); return { ...s, rotaChanges: Object.fromEntries(keep.map(x => [x.id, x])) }; }
export const changeList = (s) => Object.values(s.rotaChanges || {}).sort((a, b) => b.at - a.at);
export const unseen = (s) => changeList(s).filter(x => !x.seen);
export const markSeen = (s, ids) => ({ ...s, rotaChanges: Object.fromEntries(Object.entries(s.rotaChanges || {}).map(([k, v]) => [k, ids.includes(k) ? { ...v, seen: true, at2: Date.now() } : v])) });
/** One line for toasts and cards. */
export function headline(d) {
  const mineAhead = d.mine.filter(c => c.ahead).length, bits = [];
  if (mineAhead) bits.push(mineAhead === 1 ? '1 of your shifts changed' : `${mineAhead} of your shifts changed`); else if (d.unitKind !== 'nurse' && d.mine) bits.push('your shifts unchanged');
  const wm = d.withMe.filter(x => !x.mine).reduce((a, x) => a + x.joined.length + x.left.length, 0); if (wm) bits.push(`${wm} change${wm > 1 ? 's' : ''} in who works with you`);
  if (d.friends.length) bits.push(`${d.friends.length} friend${d.friends.length > 1 ? 's' : ''} affected`);
  bits.push(`${d.total} change${d.total === 1 ? '' : 's'} across ${d.people} ${d.people === 1 ? 'person' : 'people'}`);
  return bits.join(' · ');
}
