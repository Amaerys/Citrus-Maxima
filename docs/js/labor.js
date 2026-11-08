// Saudi Labor Law checks on MY rota (Royal Decree M/51 as amended by M/44, in force 19 Feb 2025). Pure functions, no DOM.
// Not legal advice: the contract, the employer's policy or a government/civil-service post may differ, so everything is a flag to check, not a verdict.
import { addDays, startOfDay, keyOf, fromKey } from './util.js';
import { dayInfo, shiftWindow } from './model.js';

export const LAW = {
  dailyH: 8, weeklyH: 48, ramadanWeeklyH: 36, spanH: 12, // Art. 98 / 101
  restH: 24,            // Art. 104: weekly rest, 24 consecutive hours
  otFactor: 1.5,        // Art. 107: hourly wage + 50 %
  compLeaveH: 1.5, compLeaveMaxDays: 30, // Art. 107 (reg.): leave in place of OT pay, with consent
  annualDays: 21, annualDays5y: 30,      // after 5 continuous years
  hourlyDivisor: 240,   // basic monthly ÷ (30 × 8)
};
export const ARTICLE = { span: 'Art. 101', weekly: 'Art. 98', ramadan: 'Art. 98', rest: 'Art. 104', ot: 'Art. 107', holiday: 'Art. 107', daily: 'Art. 98' };
export const DEFAULTS = { on: true, muslim: false, ramadan: ['2027-02-08', '2027-03-09'], hire: '', wage: 0, holidays: [] };
// Fixed-date public holidays (National Day 23 Sep, Founding Day 22 Feb). Eid dates move with the moon, so they are entered by hand.
const fixed = (d) => (d.getMonth() === 8 && d.getDate() === 23) || (d.getMonth() === 1 && d.getDate() === 22);
export const settings = (s) => ({ ...DEFAULTS, ...(s.settings?.labor || {}) });
export const isHoliday = (cfg, d) => fixed(d) || (cfg.holidays || []).includes(keyOf(d));
export const inRamadan = (cfg, d) => !!cfg.muslim && cfg.ramadan?.length === 2 && keyOf(d) >= cfg.ramadan[0] && keyOf(d) <= cfg.ramadan[1];

/** All my work windows in [from, to) incl. an overnight tail from the day before. */
export function windows(state, from, to) {
  const out = [];
  for (let d = addDays(from, -1); d < to; d = addDays(d, 1)) {
    const m = dayInfo(state, d).mine;
    if (!m || m.shift.kind !== 'work' || !m.shift.hours) continue;
    const w = shiftWindow(d, m.shift); if (w) out.push({ ...w, date: d, shift: m.shift });
  }
  return out;
}
const mins = (a, b) => Math.max(0, Math.round((b - a) / 60000));
const clip = (w, a, b) => mins(Math.max(w.start, a), Math.min(w.end, b));

/** Full month check. Returns { weeks, findings, totals, level }. */
export function checkMonth(state, y, m, cfgIn) {
  const cfg = cfgIn || settings(state), first = new Date(y, m - 1, 1), end = new Date(y, m, 1);
  const ws = new Date(first); ws.setDate(ws.getDate() - ws.getDay()); // week = Sunday–Saturday
  const wins = windows(state, ws, addDays(end, 7)), findings = [], weeks = [];
  const add = (level, rule, date, msg) => findings.push({ level, rule, article: ARTICLE[rule], date: keyOf(date), msg });
  for (const w of wins) {
    if (w.date < first || w.date >= end) continue;
    const span = mins(w.start, w.end) / 60;
    if (span > LAW.spanH) add('violation', 'span', w.date, `${span.toFixed(1)}h from start to finish, more than the ${LAW.spanH}h you may be at work in a day`);
    else if (span > LAW.dailyH) add('info', 'daily', w.date, `${span.toFixed(1)}h shift: over ${LAW.dailyH}h/day, legal only inside the ${LAW.weeklyH}h week (normal for 12h clinical shifts)`);
    if (isHoliday(cfg, w.date)) add('info', 'holiday', w.date, `Worked on a public holiday: those hours count as overtime`);
  }
  let otMin = 0, restBad = 0;
  for (let a = new Date(ws); a < end; a = addDays(a, 7)) {
    const b = addDays(a, 7); let worked = 0;
    const inWeek = wins.filter(w => w.end > a && w.start < b).map(w => ({ start: Math.max(w.start, a), end: Math.min(w.end, b) })).sort((x, y2) => x.start - y2.start);
    for (const w of inWeek) worked += mins(w.start, w.end);
    let ram = 0; for (let i = 0; i < 7; i++) if (inRamadan(cfg, addDays(a, i))) ram++;
    const cap = Math.round(((7 - ram) * LAW.weeklyH + ram * LAW.ramadanWeeklyH) / 7 * 10) / 10, over = Math.max(0, worked / 60 - cap);
    // longest stretch with no work, counting the ends of the week
    let gap = 0, cur = +a; for (const w of inWeek) { gap = Math.max(gap, w.start - cur); cur = Math.max(cur, w.end); } gap = Math.max(gap, +b - cur);
    const restOk = gap >= LAW.restH * 3600000, weekEndInMonth = addDays(b, -1) >= first && a < end;
    const clipped = { a, b }; const inMonthDays = Array.from({ length: 7 }, (_, i) => addDays(a, i)).filter(d => d >= first && d < end).length;
    if (inMonthDays === 7) { // only judge whole weeks inside the month so a partial week at either edge never raises a false alarm
      otMin += Math.round(over * 60);
      if (over > 0) add('warn', ram ? 'ramadan' : 'weekly', addDays(a, 6), `${(worked / 60).toFixed(1)}h in the week of ${keyOf(a)}: ${over.toFixed(1)}h over the ${cap}h limit${ram ? ' (Ramadan hours)' : ''}`);
      if (!restOk) { restBad++; add('violation', 'rest', a, `No 24 consecutive hours off in the week of ${keyOf(a)}`); }
    }
    weeks.push({ start: keyOf(a), hours: Math.round(worked / 6) / 10, cap, over: Math.round(over * 10) / 10, restOk, full: inMonthDays === 7, ram });
  }
  const ot = Math.round(otMin / 6) / 10, hourly = cfg.wage ? cfg.wage / LAW.hourlyDivisor : 0;
  const totals = { overtimeH: ot, compLeaveH: Math.round(ot * LAW.compLeaveH * 10) / 10, otPay: hourly ? Math.round(ot * hourly * LAW.otFactor) : null, restBad };
  const level = findings.some(f => f.level === 'violation') ? 'violation' : findings.some(f => f.level === 'warn') ? 'warn' : 'ok';
  return { weeks, findings: findings.sort((p, q) => p.date.localeCompare(q.date)), totals, level, cfg };
}

/** Annual leave entitlement and what the loaded rotas already show as leave in the current leave year. */
export function leaveStatus(state, now = new Date(), cfgIn) {
  const cfg = cfgIn || settings(state); if (!cfg.hire) return null;
  const hire = fromKey(cfg.hire); let yrs = now.getFullYear() - hire.getFullYear(); const ann = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
  if (ann > now) yrs--; const start = new Date(now.getFullYear() - (ann > now ? 1 : 0), hire.getMonth(), hire.getDate());
  const entitled = yrs >= 5 ? LAW.annualDays5y : LAW.annualDays; let used = 0;
  for (let d = startOfDay(start); d <= now; d = addDays(d, 1)) { const m = dayInfo(state, d).mine; if (m && m.shift.kind === 'leave') used++; }
  return { years: yrs, entitled, used, left: Math.max(0, entitled - used), yearStart: keyOf(start), next5: yrs < 5 ? keyOf(new Date(hire.getFullYear() + 5, hire.getMonth(), hire.getDate())) : '' };
}
