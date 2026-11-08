// Work planning helpers: month report, leave planner, swap finder. Pure functions (no DOM).
import { addDays, startOfDay, keyOf, fromKey } from './util.js';
import { dayInfo, isMe } from './model.js';
import * as L from './labor.js';

const pk = (p) => p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`;
const mineOn = (s, d) => dayInfo(s, d).mine;
const isWork = (m) => !!m && m.shift.kind === 'work';

/** Month-end report: the numbers you would want on payday. */
export function monthReport(s, y, m) {
  const days = new Date(y, m, 0).getDate(), cfg = L.settings(s), chk = L.checkMonth(s, y, m, cfg);
  let work = 0, nights = 0, mins = 0, weekend = 0, holiday = 0, leave = 0, streak = 0, best = 0; const sites = {}, types = {};
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m - 1, d), mi = mineOn(s, date);
    if (isWork(mi)) { work++; streak++; best = Math.max(best, streak); mins += mi.shift.hours?.durationMin || 0; if (mi.shift.type === 'N' || mi.shift.hours?.overnight) nights++; if ([5, 6].includes(date.getDay())) weekend++; if (L.isHoliday(cfg, date)) holiday++; const st = mi.shift.site || mi.shift.label; sites[st] = (sites[st] || 0) + 1; types[mi.shift.type] = (types[mi.shift.type] || 0) + 1; } else { streak = 0; if (mi?.shift.kind === 'leave') leave++; }
  }
  const t = chk.totals, hours = Math.round(mins / 6) / 10, hourlyBasic = cfg.wage ? cfg.wage / L.LAW.hourlyDivisor : 0;
  return { y, m, work, nights, weekend, holiday, leave, off: days - work - leave, hours, longestStreak: best, sites, types, overtimeH: t.overtimeH, compLeaveH: t.compLeaveH, otPay: t.otPay, level: chk.level, flags: chk.findings.filter(f => f.level !== 'info').length, avgShiftH: work ? Math.round(mins / work / 6) / 10 : 0, basic: cfg.wage || 0, hourlyBasic: Math.round(hourlyBasic * 100) / 100 };
}

/** What taking leave over [from, to] would cost and cover. Leave counts calendar days (your contract), so every day in the range is deducted. */
export function evalLeave(s, from, to, now = new Date()) {
  const a = startOfDay(from), b = startOfDay(to); if (b < a) return null; const n = Math.round((b - a) / 864e5) + 1; let covered = 0, nights = 0, already = 0, weekends = 0; const list = [];
  for (let d = new Date(a); d <= b; d = addDays(d, 1)) { const mi = mineOn(s, d), has = dayInfo(s, d).hasRota; if (isWork(mi)) { covered++; if (mi.shift.type === 'N') nights++; list.push(keyOf(d)); } else if (mi?.shift.kind === 'leave') already++; if ([5, 6].includes(d.getDay())) weekends++; }
  const ls = L.leaveStatus(s, now), left = ls ? ls.left : null;
  return { days: n, covered, nights, already, weekends, billable: n - already, leftAfter: left == null ? null : left - (n - already), entitled: ls?.entitled ?? null, workDates: list, ratio: n ? covered / n : 0, noticeBy: keyOf(addDays(a, -30)), enough: left == null ? null : left - (n - already) >= 0 };
}
/** Windows of `len` calendar days (from tomorrow, up to `horizon` days) ranked by how many of your rostered shifts they replace per leave day spent. */
export function bestWindows(s, len, { now = new Date(), horizon = 150, top = 5, friends = [] } = {}) {
  const out = [], start = addDays(startOfDay(now), 1);
  for (let i = 0; i < horizon; i++) { const a = addDays(start, i), b = addDays(a, len - 1); if (!dayInfo(s, a).hasRota || !dayInfo(s, b).hasRota) continue; const e = evalLeave(s, a, b, now); if (!e) continue; out.push({ from: keyOf(a), to: keyOf(b), ...e, withFriends: friends.filter(f => f.off?.(a, b)).length }); }
  out.sort((x, y) => y.covered - x.covered || x.nights - y.nights || x.from.localeCompare(y.from));
  const picked = []; for (const w of out) { if (picked.every(p => Math.abs(fromKey(p.from) - fromKey(w.from)) >= len * 864e5)) picked.push(w); if (picked.length >= top) break; }
  return picked;
}

/** Swap finder: for a shift you want to hand over on `date`, colleagues who are off that day AND work on a day you are off (within `span` days), so the trade is even. Skips swaps that would put either of you on 7 days in a row. */
export function swapOptions(s, date, { span = 14 } = {}) {
  const info = dayInfo(s, date), mine = info.mine; if (!isWork(mine)) return { mine, options: [] };
  const people = new Map(); for (const e of info.off) if (!isMe(s, e.person)) people.set(pk(e.person), e.person);
  const myOff = [], theirs = [];
  for (let i = -span; i <= span; i++) { if (!i) continue; const d = addDays(date, i), di = dayInfo(s, d); if (!di.hasRota) continue; if (!isWork(di.mine)) myOff.push({ d, di }); }
  const options = [];
  for (const [key, p] of people) {
    const gives = [];
    for (const { d, di } of myOff) { const e = di.entries.find(x => pk(x.person) === key && x.rota.unitKind === 'gp'); if (e && e.shift.kind === 'work') gives.push({ date: keyOf(d), code: e.code, shift: e.shift, sameType: e.shift.type === mine.shift.type, site: e.shift.site }); }
    if (!gives.length) continue;
    const sameSite = gives.filter(g => g.sameType).length;
    const run = (who, around) => { let c = 1; for (const dir of [-1, 1]) for (let k = 1; k < 7; k++) { const x = dayInfo(s, addDays(around, dir * k)); const w = who === 'me' ? isWork(x.mine) : x.entries.some(e => pk(e.person) === key && e.shift.kind === 'work'); if (!w) break; c++; } return c; };
    const theirRun = run('them', date), prevN = dayInfo(s, addDays(date, -1)).entries.some(e => pk(e.person) === key && e.shift.type === 'N');
    options.push({ person: p, key, gives: gives.sort((a, b) => (b.sameType - a.sameType) || a.date.localeCompare(b.date)).slice(0, 4), sameType: sameSite, tired: theirRun >= 7 || prevN, theirRun, score: sameSite * 3 + gives.length - (theirRun >= 7 ? 5 : 0) - (prevN ? 3 : 0) });
  }
  options.sort((a, b) => b.score - a.score); return { mine, options };
}

/** Pencil planned leave into your own corrections (state.swaps), so the calendar, labor check and leave balance all see it. Only days you are rostered or off are touched; nothing in the imported rota changes. */
export function applyLeave(s, from, to, now = Date.now()) {
  const swaps = { ...(s.swaps || {}) }; let n = 0;
  for (let d = startOfDay(from); d <= startOfDay(to); d = addDays(d, 1)) { const k = keyOf(d), mi = dayInfo(s, d).mine; if (mi?.shift.kind === 'leave' && !swaps[k]) continue; swaps[k] = { code: 'VL', with: '', note: 'Planned leave', at: now }; n++; }
  return { state: { ...s, swaps }, days: n };
}
export function clearLeave(s, from, to) {
  const swaps = { ...(s.swaps || {}) }, deleted = { ...(s.deleted || {}) }; for (let d = startOfDay(from); d <= startOfDay(to); d = addDays(d, 1)) { const k = keyOf(d); if (swaps[k]?.note === 'Planned leave') { delete swaps[k]; deleted[`swap:${k}`] = Date.now(); } }
  return { ...s, swaps, deleted };
}

/** Planned-leave corrections grouped into continuous ranges, soonest first. */
export function plannedLeave(s) {
  const ks = Object.entries(s.swaps || {}).filter(([, v]) => v?.note === 'Planned leave').map(([k]) => k).sort(), out = [];
  for (const k of ks) { const last = out[out.length - 1]; if (last && keyOf(addDays(fromKey(last.to), 1)) === k) last.to = k; else out.push({ from: k, to: k }); }
  return out.map(r => ({ ...r, days: Math.round((fromKey(r.to) - fromKey(r.from)) / 864e5) + 1 }));
}
