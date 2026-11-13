// Work planning helpers: month report, leave planner, swap finder. Pure functions (no DOM).
import { addDays, startOfDay, keyOf, fromKey, uid } from './util.js';
import { dayInfo, isMe, shiftWindow } from './model.js';
import * as L from './labor.js';

const pk = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
const mineOn = (s, d) => dayInfo(s, d).mine;
const isWork = (m) => !!m && m.shift.kind === 'work';
const H = 3600000;

/** Month-end report: the numbers you would want on payday. Work on a public holiday counts as overtime (Art. 107),
 *  so those hours are added to the weekly overflow; in a full week the holiday hours are taken out of the weekly sum
 *  first, so an hour is never paid twice. */
export function monthReport(s, y, m) {
  const days = new Date(y, m, 0).getDate(), cfg = L.settings(s), chk = L.checkMonth(s, y, m, cfg);
  let work = 0, nights = 0, mins = 0, weekend = 0, holiday = 0, leave = 0, streak = 0, best = 0, holMin = 0; const sites = {}, types = {}, holByWeek = {};
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m - 1, d), mi = mineOn(s, date);
    if (isWork(mi)) {
      work++; streak++; best = Math.max(best, streak); const dm = mi.shift.hours?.durationMin || 0; mins += dm;
      if (mi.shift.type === 'N' || mi.shift.hours?.overnight) nights++; if ([5, 6].includes(date.getDay())) weekend++;
      if (L.isHoliday(cfg, date)) { holiday++; holMin += dm; const wk = keyOf(addDays(date, -date.getDay())); holByWeek[wk] = (holByWeek[wk] || 0) + dm; }
      const st = mi.shift.site || mi.shift.label; sites[st] = (sites[st] || 0) + 1; types[mi.shift.type] = (types[mi.shift.type] || 0) + 1;
    } else { streak = 0; if (mi?.shift.kind === 'leave') leave++; }
  }
  const t = chk.totals, hours = Math.round(mins / 6) / 10, hourlyBasic = cfg.wage ? cfg.wage / L.LAW.hourlyDivisor : 0;
  let otMin = holMin; for (const w of chk.weeks) if (w.full) otMin += Math.max(0, Math.round(w.hours * 60) - (holByWeek[w.start] || 0) - Math.round(w.cap * 60));
  const overtimeH = holMin ? Math.round(otMin / 6) / 10 : t.overtimeH;
  // follow labor.js's own rate when it has one, so this card and the labor card always show the same SAR per hour
  const otRate = t.overtimeH && t.otPay != null ? t.otPay / t.overtimeH : hourlyBasic ? hourlyBasic * L.LAW.otFactor : null;
  return { y, m, work, nights, weekend, holiday, holidayH: Math.round(holMin / 6) / 10, leave, off: days - work - leave, hours, longestStreak: best, sites, types,
    overtimeH, compLeaveH: Math.round(overtimeH * L.LAW.compLeaveH * 10) / 10, otPay: otRate != null ? Math.round(overtimeH * otRate) : null, otRate: otRate != null ? Math.round(otRate * 100) / 100 : null,
    lawOn: cfg.on !== false, level: chk.level, flags: chk.findings.filter(f => f.level !== 'info').length, avgShiftH: work ? Math.round(mins / work / 6) / 10 : 0, basic: cfg.wage || 0, hourlyBasic: Math.round(hourlyBasic * 100) / 100 };
}

// ───────── leave
const isPlanned = (v) => v?.note === 'Planned leave';
/** Planned leave pencilled after `today` that lies outside [a, b]: the balance has to carry it too. */
function plannedElsewhere(s, a, b, now) {
  const t = keyOf(startOfDay(now)), ka = keyOf(a), kb = keyOf(b);
  return Object.entries(s.swaps || {}).filter(([k, v]) => isPlanned(v) && k > t && (k < ka || k > kb)).length;
}

/** What taking leave over [from, to] would cost and cover. Leave counts calendar days (your contract), so every day in the range is deducted.
 *  Days with no rota loaded are counted apart (`noRota`): nothing can be said about them, so they are never "off anyway". */
export function evalLeave(s, from, to, now = new Date()) {
  const a = startOfDay(from), b = startOfDay(to); if (b < a) return null; const n = Math.round((b - a) / 864e5) + 1;
  let covered = 0, nights = 0, already = 0, weekends = 0, noRota = 0, offDays = 0; const list = [];
  for (let d = new Date(a); d <= b; d = addDays(d, 1)) {
    const di = dayInfo(s, d), mi = di.mine;
    if (!di.hasRota || !mi) noRota++;
    else if (isWork(mi)) { covered++; if (mi.shift.type === 'N' || mi.shift.hours?.overnight) nights++; list.push(keyOf(d)); }
    else if (mi.shift.kind === 'leave') already++;
    else offDays++;
    if ([5, 6].includes(d.getDay())) weekends++;
  }
  const ls = L.leaveStatus(s, now), left = ls ? ls.left - plannedElsewhere(s, a, b, now) : null, billable = n - already, noticeBy = keyOf(addDays(a, -30));
  return { days: n, covered, nights, already, weekends, noRota, offDays, billable, leftAfter: left == null ? null : left - billable, entitled: ls?.entitled ?? null, workDates: list,
    ratio: n - noRota ? covered / (n - noRota) : 0, noticeBy, shortNotice: noticeBy < keyOf(startOfDay(now)), started: a <= startOfDay(now), enough: left == null ? null : left - billable >= 0 };
}
/** Windows of `len` calendar days (from tomorrow, up to `horizon` days) ranked by how many of your rostered shifts they replace.
 *  Windows that start inside the 30-day notice period are kept (rotas arrive late) but tagged `short`, and rank after the rest. */
export function bestWindows(s, len, { now = new Date(), horizon = 150, top = 5, friends = [] } = {}) {
  const out = [], start = addDays(startOfDay(now), 1), notice = keyOf(addDays(startOfDay(now), 30));
  for (let i = 0; i < horizon; i++) {
    const a = addDays(start, i), b = addDays(a, len - 1); if (!dayInfo(s, a).hasRota || !dayInfo(s, b).hasRota) continue;
    const e = evalLeave(s, a, b, now); if (!e || e.noRota || !e.covered) continue;
    out.push({ from: keyOf(a), to: keyOf(b), ...e, short: keyOf(a) < notice, withFriends: friends.filter(f => f.off?.(a, b)).length });
  }
  out.sort((x, y) => (x.short - y.short) || y.covered - x.covered || x.nights - y.nights || x.from.localeCompare(y.from));
  const picked = []; for (const w of out) { if (picked.every(p => Math.abs(fromKey(p.from) - fromKey(w.from)) >= len * 864e5)) picked.push(w); if (picked.length >= top) break; }
  return picked;
}

// ───────── swaps
/** Minimum rest between the end of one shift and the start of the next, and the weekly rest (Art. 104). */
export const MIN_REST_H = 11, WEEK_REST_H = L.LAW.restH, MAX_RUN = 6;
// a work code without hours in the legend still takes time: assume the usual block for its type rather than "no time at all"
const FALLBACK = { D: [480, 1200], E: [600, 1320], N: [1200, 480] };
function winOf(date, shift) {
  const w = shiftWindow(date, shift); if (w) return w;
  const [a, b] = FALLBACK[shift.type] || FALLBACK.D; return shiftWindow(date, { hours: { start: a, end: b, overnight: b < a } });
}
/** One person's work windows over [from, to], with `change` (dayKey → shift | null) applied on top of the rota. */
function timeline(s, who, from, to, change) {
  const out = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const k = keyOf(d); let sh;
    if (change.has(k)) sh = change.get(k);
    else { const di = dayInfo(s, d); sh = who === 'me' ? di.mine?.shift : (di.entries.filter(e => pk(e.person) === who && e.shift.kind === 'work').sort((x, y) => (y.rota.unitKind === 'gp') - (x.rota.unitKind === 'gp'))[0]?.shift); }
    if (sh?.kind === 'work') out.push({ key: k, date: new Date(d), ...winOf(d, sh) });
  }
  return out.sort((x, y) => x.start - y.start);
}
/** Is the shift added on `added` safe in this timeline? Returns the first broken rule, or ''. */
function breaks(tl, added) {
  const i = tl.findIndex(w => w.key === added); if (i < 0) return '';
  const w = tl[i], prev = tl[i - 1], next = tl[i + 1];
  if ((prev && w.start - prev.end < MIN_REST_H * H) || (next && next.start - w.end < MIN_REST_H * H)) return 'rest';
  let run = 1; const days = new Set(tl.map(x => x.key));
  for (const dir of [-1, 1]) for (let k = 1; k <= MAX_RUN; k++) { if (!days.has(keyOf(addDays(w.date, dir * k)))) break; run++; }
  if (run > MAX_RUN) return 'run';
  // weekly rest: in the Sunday–Saturday week(s) the new shift touches, some 24h stretch must stay free
  for (const anchor of new Set([keyOf(addDays(w.date, -w.date.getDay())), keyOf(addDays(w.end, -w.end.getDay()))])) {
    const a = fromKey(anchor), b = addDays(a, 7); let gap = 0, cur = +a;
    for (const x of tl) { if (x.end <= a || x.start >= b) continue; gap = Math.max(gap, x.start - cur); cur = Math.max(cur, +x.end); }
    if (Math.max(gap, +b - cur) < WEEK_REST_H * H) return 'week';
  }
  return '';
}

/** Swap finder: for a shift you want to hand over on `date`, colleagues who are off that day AND work on a day you are off (within `span` days),
 *  so the trade is even. Every pairing is simulated for both doctors and left out when it would leave either of you less than 11h between
 *  shifts (a day straight after a night), more than 6 days in a row, or no 24h weekly rest. Only shifts that have not started are offered. */
export function swapOptions(s, date, { span = 14, now = new Date() } = {}) {
  const info = dayInfo(s, date), mine = info.mine; if (!isWork(mine)) return { mine, options: [], left: {} };
  if (winOf(date, mine.shift).start <= now) return { mine, options: [], left: {}, past: true };
  const people = new Map(); for (const e of info.off) if (!isMe(s, e.person)) people.set(pk(e.person), e.person);
  const myOff = [];
  for (let i = -span; i <= span; i++) { if (!i) continue; const d = addDays(date, i), di = dayInfo(s, d); if (di.hasRota && di.mine?.shift.kind === 'off') myOff.push({ d, di }); }
  const from = addDays(date, -span - 8), to = addDays(date, span + 8), dk = keyOf(date), left = { rest: 0, run: 0, week: 0 }, options = [];
  for (const [key, p] of people) {
    const gives = [];
    for (const { d, di } of myOff) {
      const e = di.entries.find(x => pk(x.person) === key && x.rota.unitKind === 'gp'); if (!e || e.shift.kind !== 'work' || winOf(d, e.shift).start <= now) continue;
      const k = keyOf(d);
      // me: drop my shift on `date`, take theirs on d. them: take mine on `date`, drop theirs on d.
      const why = breaks(timeline(s, 'me', from, to, new Map([[dk, null], [k, e.shift]])), k) || breaks(timeline(s, key, from, to, new Map([[dk, mine.shift], [k, null]])), dk);
      if (why) { left[why]++; continue; }
      gives.push({ date: k, code: e.code, shift: e.shift, type: e.shift.type, sameType: e.shift.type === mine.shift.type, site: e.shift.site });
    }
    if (!gives.length) continue;
    const same = gives.filter(g => g.sameType).length, shown = gives.sort((a, b) => (b.sameType - a.sameType) || a.date.localeCompare(b.date)).slice(0, 4);
    options.push({ person: p, key, gives: shown, more: gives.length - shown.length, sameType: same, allSame: shown.every(g => g.sameType), score: same * 3 + gives.length });
  }
  options.sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name)); return { mine, options, left };
}

/** Pencil planned leave into your own corrections (state.swaps), so the calendar, labor check and leave balance all see it.
 *  Each request keeps its own `leaveId`, so two requests that touch stay two rows. Days that are already leave are skipped and counted apart. */
export function applyLeave(s, from, to, now = Date.now(), id = uid()) {
  const swaps = { ...(s.swaps || {}) }; let n = 0, already = 0;
  for (let d = startOfDay(from); d <= startOfDay(to); d = addDays(d, 1)) { const k = keyOf(d), mi = dayInfo(s, d).mine; if (mi?.shift.kind === 'leave' || isPlanned(swaps[k])) { already++; continue; } swaps[k] = { code: 'VL', with: '', note: 'Planned leave', at: now, leaveId: id }; n++; }
  return { state: { ...s, swaps }, days: n, already, id };
}
/** Remove planned leave in [from, to]; with `id`, only that request (older entries without an id go by range). */
export function clearLeave(s, from, to, id) {
  const swaps = { ...(s.swaps || {}) }, deleted = { ...(s.deleted || {}) };
  for (let d = startOfDay(from); d <= startOfDay(to); d = addDays(d, 1)) { const k = keyOf(d); if (isPlanned(swaps[k]) && (id == null || (swaps[k].leaveId || '') === id)) { delete swaps[k]; deleted[`swap:${k}`] = Date.now(); } }
  return { ...s, swaps, deleted };
}
/** Put back entries taken out by clearLeave (undo). */
export function restoreLeave(s, entries, now = Date.now()) {
  const swaps = { ...(s.swaps || {}) }, deleted = { ...(s.deleted || {}) };
  for (const [k, v] of Object.entries(entries)) { swaps[k] = { ...v, at: now }; delete deleted[`swap:${k}`]; }
  return { ...s, swaps, deleted };
}

/** Planned-leave requests, soonest first: one row per request (same leaveId, continuous days). */
export function plannedLeave(s) {
  const ks = Object.entries(s.swaps || {}).filter(([, v]) => isPlanned(v)).sort(([a], [b]) => a.localeCompare(b)), out = [];
  for (const [k, v] of ks) {
    const id = v.leaveId || '', last = out.findLast(r => r.id === id);
    if (last && keyOf(addDays(fromKey(last.to), 1)) === k) { last.to = k; last.entries[k] = v; } else out.push({ id, from: k, to: k, entries: { [k]: v } });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from)).map(r => ({ ...r, days: Math.round((fromKey(r.to) - fromKey(r.from)) / 864e5) + 1 }));
}
