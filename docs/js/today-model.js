// Today's "who am I with, right now" answers, shared by the hero, the brief, the day sheet and the Who's in board. Pure functions (no DOM).
import { overlapModel } from './board.js';
import { dayInfo, isMe } from './model.js';
import { interpretCode } from './rota-parser.js';
import { addDays, startOfDay, keyOf } from './util.js';

const pkey = (p) => p.id ? `id:${p.id}` : `name:${String(p.name).toLowerCase()}`;
const words = (name) => String(name || '').replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);

/**
 * Which shift the hero should describe at `now`. A night that started yesterday wins until it ends (00:00–08:00 you are still at work);
 * once today's shift is over, or on a free evening, the hero turns to tomorrow.
 * md / tmr: myDay(state, now) and myDay(state, now + 1 day); prevInfo: dayInfo(state, now − 1 day).
 * → { kind: 'tail' | 'today' | 'tomorrow' | 'done' | 'none', entry, info, date }
 */
export function heroFocus(now, md, tmr, prevInfo) {
  const t = +now, day = startOfDay(now), tail = md.overnightTail;
  if (tail && t < +tail.window.end) return { kind: 'tail', entry: tail, info: prevInfo, date: addDays(day, -1) };
  if (md.today && t < +md.today.window.end) return { kind: 'today', entry: md.today, info: md.info, date: day };
  const freeEvening = !md.today && now.getHours() >= 18 && md.info.mine?.shift.kind !== 'leave';
  if ((md.today || freeEvening) && tmr?.today) return { kind: 'tomorrow', entry: tmr.today, info: tmr.info, date: addDays(day, 1), doneToday: !!md.today };
  if (md.today) return { kind: 'done', entry: md.today, info: md.info, date: day };
  return { kind: 'none', entry: null, info: md.info, date: day };
}

/**
 * Colleagues at YOUR site who share any part of your shift — the same list the day sheet's "Who shares your shift" draws.
 * Other sites are counted, not listed: a doctor at Lower Village is not "with you" at Upper Village.
 * → { rows: [{ entry, overlap, from, to, same }], otherSites: n, site }
 */
export function teamAtSite(info) {
  const mine = info?.mine; if (!mine || mine.shift.kind !== 'work' || !mine.shift.hours) return { rows: [], otherSites: 0, site: '' };
  const m = overlapModel(mine, [...info.withMe, ...info.alsoAtSite]), same = new Set(info.withMe);
  const rows = (m?.rows || []).map(r => ({ entry: r.entry, overlap: r.overlap, pct: r.pct, from: r.from, to: r.to, same: same.has(r.entry) }))
    .sort((a, b) => b.same - a.same || b.overlap - a.overlap || a.entry.person.name.localeCompare(b.entry.person.name));
  const elsewhere = overlapModel(mine, info.gp.filter(e => e !== mine && e.shift.site !== mine.shift.site));
  return { rows, otherSites: elsewhere ? elsewhere.rows.filter(r => r.overlap >= 120).length : 0, site: mine.shift.site || '' };
}

/**
 * Short, unambiguous names: the first name, plus as much of the next name as it takes when first names collide
 * ("Ahmed A.", "Ahmed Ab." …, then the full name). people: [{ name, id }] → Map(personKey → label).
 */
export function shortNames(people) {
  const uniq = new Map(); for (const p of people) if (p?.name) uniq.set(pkey(p), p);
  const byFirst = new Map(); for (const [k, p] of uniq) { const f = (words(p.name)[0] || p.name).toLowerCase(); (byFirst.get(f) || byFirst.set(f, []).get(f)).push([k, p]); }
  const out = new Map();
  for (const group of byFirst.values()) {
    if (group.length === 1) { const [k, p] = group[0]; out.set(k, words(p.name)[0] || p.name); continue; }
    // cheapest rule that tells this person apart: second initial → last name → second name → full name
    const rules = [(w) => w[1] ? `${w[0]} ${w[1][0]}.` : '', (w) => w.length > 2 ? `${w[0]} ${w[w.length - 1]}` : '', (w) => w[1] ? `${w[0]} ${w[1]}` : ''];
    for (const [k, p] of group) {
      const w = words(p.name); let label = w.join(' ') || p.name;
      for (const rule of rules) { const mine = rule(w); if (mine && !group.some(([k2, p2]) => k2 !== k && rule(words(p2.name)).toLowerCase() === mine.toLowerCase())) { label = mine; break; } }
      out.set(k, label);
    }
  }
  return out;
}

/**
 * Board entries for a site at `nowMin` (minutes since today's midnight, or null when the board is not for today):
 * yesterday's overnight shifts that are still running come first, marked dayOffset −1, so at 02:00 the night crew who are
 * actually in the building are the ones counted — not tonight's crew.
 */
export function withLastNight(todayEntries, prevEntries, nowMin) {
  if (nowMin == null) return todayEntries;
  const carry = (prevEntries || []).filter(e => { const x = e.shift?.hours; return x && (x.overnight || x.end <= x.start) && x.end > nowMin; }).map(e => ({ ...e, dayOffset: -1 }));
  return [...carry, ...todayEntries];
}

/** Does this month have the GP rota loaded? (Specialist or nurse files alone don't say whether you work.) */
export const hasGpRota = (info) => (info?.rotas || []).some(r => r.unitKind === 'gp');

/**
 * Days a specialist or nurse is on with you, for the person sheet.
 * Specialists: days their rota covers your site (UV → Upper Village, LV → Lower Village) or, for FSED, days your hours overlap theirs.
 * Nurses: days whatever nursesWithMe(date, mine) says they're confirmed / heard / possible at your site.
 * → [{ date, code, label, how }]
 */
export function daysWithMe(state, personKey, { nursesWithMe = null } = {}) {
  const out = [];
  for (const r of Object.values(state.rotas || {})) {
    const p = (r.people || []).find(x => pkey(x) === personKey); if (!p || r.unitKind === 'gp') continue;
    for (let d = 1; d <= (r.daysInMonth || 31); d++) {
      const code = p.days?.[d] || '', sh = interpretCode(code, r.legend, r.unitKind); if (sh.kind !== 'work') continue;
      const date = new Date(r.year, r.month - 1, d), mine = dayInfo(state, date).mine; if (!mine || mine.shift.kind !== 'work' || !isMe(state, mine.person)) continue;
      const site = mine.shift.site || '';
      if (r.unitKind === 'nurse') {
        const w = nursesWithMe ? nursesWithMe(date, mine) : null; if (!w) continue;
        const how = w.confirmed.some(x => x.key === personKey) ? 'posted with you' : (w.tipped || []).some(x => x.key === personKey && !x.guess) ? 'heard: with you' : (w.tipped || []).some(x => x.key === personKey) ? 'guess (last time)' : w.possible.some(x => x.key === personKey) ? 'could be with you' : '';
        if (how) out.push({ date, code, label: mine.code, how });
      } else if (r.unitKind === 'uv' || r.unitKind === 'lv') {
        if ((r.unitKind === 'uv' ? /upper/i : /lower/i).test(site)) out.push({ date, code, label: mine.code, how: 'covers your site' });
      } else {
        const m = overlapModel(mine, [{ person: p, shift: sh }]); if (m?.rows.length) out.push({ date, code, label: mine.code, how: 'on call during your shift' });
      }
    }
  }
  return out.sort((a, b) => a.date - b.date).filter((x, i, a) => !i || keyOf(a[i - 1].date) !== keyOf(x.date));
}
