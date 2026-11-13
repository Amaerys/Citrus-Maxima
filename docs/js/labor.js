// Saudi Labor Law checks on MY rota (Royal Decree M/51 as amended by M/44, in force 19 Feb 2025). Pure functions, no DOM.
// Not legal advice: the contract, the employer's policy or a government/civil-service post may differ, so everything is a flag to check, not a verdict.
import { addDays, startOfDay, keyOf, fromKey, MONTHS } from './util.js';
import { dayInfo, shiftWindow } from './model.js';
import { currentJob, overtime } from './career.js';

export const LAW = {
  dailyH: 8, weeklyH: 48, ramadanWeeklyH: 36, spanH: 12, // Art. 98 / 101
  restH: 24,            // Art. 104: weekly rest, 24 consecutive hours
  otFactor: 1.5,        // Art. 107: hourly wage + 50 % (of the basic hourly wage, see career.js:overtime)
  compLeaveH: 1.5, compLeaveMaxDays: 30, // Art. 107 (reg.): leave in place of OT pay, with consent
  annualDays: 21, annualDays5y: 30,      // after 5 continuous years
  hourlyDivisor: 240,   // basic monthly ÷ (30 × 8)
};
export const ARTICLE = { span: 'Art. 101', weekly: 'Art. 98', ramadan: 'Art. 98', rest: 'Art. 104', ot: 'Art. 107', holiday: 'Art. 107', daily: 'Art. 98', contract: 'Art. 98' };
export const DEFAULTS = { on: true, muslim: false, ramadan: ['2027-02-08', '2027-03-09'], hire: '', wage: 0, holidays: [] };
/** Keys the current contract in Career supplies. settings.labor holds one only when the user typed a different value by hand. */
export const CONTRACT_KEYS = ['hire', 'wage', 'leaveDays', 'weeklyH'];
const blank = (v) => v === '' || v === 0 || v == null;
// Fixed-date public holidays (National Day 23 Sep, Founding Day 22 Feb). Eid dates move with the moon, so they are entered by hand.
const fixed = (d) => (d.getMonth() === 8 && d.getDate() === 23) || (d.getMonth() === 1 && d.getDate() === 22);
/** What the current contract says, in labor-check terms ({} without a contract). */
export const fromContract = (s) => { const j = currentJob(s); return j ? { hire: j.start || '', wage: +j.basic || 0, leaveDays: +j.leave || 0, weeklyH: +j.hoursWeek || 0 } : {}; };
/** Only the hand-set values: blanks and values that just repeat the contract are dropped, so a later contract edit keeps flowing in (beta T05-01). */
export function overrides(s) {
  const c = fromContract(s), raw = s.settings?.labor || {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => !(CONTRACT_KEYS.includes(k) && (blank(v) || String(v) === String(c[k] ?? '')))));
}
/** Defaults come from the current contract in Career (start date, basic wage, leave days, weekly hours); anything you set by hand wins.
 * weeklyH is the cap actually used: the contract (or your) week, never above the legal 48h (Art. 98, beta T05-02); contractH keeps the raw figure.
 * src says where each contract key came from ('you' / 'contract' / ''), for the "from contract" hints. */
export const settings = (s) => {
  const c = fromContract(s), o = overrides(s), cfg = { ...DEFAULTS, ...c, ...o }, j = currentJob(s);
  const contractH = +cfg.weeklyH || 0, src = Object.fromEntries(CONTRACT_KEYS.map(k => [k, k in o ? 'you' : blank(c[k]) ? '' : 'contract']));
  return { ...cfg, contractH, weeklyH: contractH > 0 ? Math.min(contractH, LAW.weeklyH) : LAW.weeklyH, src, contract: c, allowances: j ? Math.max(0, (+j.housing || 0) + (+j.transport || 0) + (+j.other || 0)) : 0 };
};
/** Overtime hour per Art. 107, the same figure as Career: (basic + allowances) ÷ 240 + 50 % of basic ÷ 240. */
export const otRate = (cfg) => cfg.wage ? overtime({ basic: cfg.wage, other: cfg.allowances || 0 }).full : 0;
/** "8–14 Nov", "29 Nov–5 Dec": the Sunday–Saturday week in the app's day-month style (beta T02-14). */
export const weekLabel = (a) => { const b = addDays(a, 6), m = (d) => MONTHS[d.getMonth()].slice(0, 3); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)}–${b.getDate()} ${m(b)}`; };
const dayLabel = (d) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
/** Holiday lines → valid YYYY-MM-DD dates (round-trip through a real date, so 2026-13-45 is refused) + the lines that were ignored (beta T02-12). */
export function parseHolidays(text) {
  const ok = [], bad = [];
  for (const x of String(text || '').split(/[\s,;]+/).filter(Boolean)) { if (/^\d{4}-\d{2}-\d{2}$/.test(x) && keyOf(fromKey(x)) === x) { if (!ok.includes(x)) ok.push(x); } else bad.push(x); }
  return { ok: ok.sort(), bad };
}
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

/** Full month check. Returns { weeks, findings, totals, level, cfg }.
 * Findings carry a ready label ("14 Nov", "Week of 8–14 Nov", "Contract") so the card never pins a weekly flag to a day off (beta T02-14);
 * real flags come first, and the per-shift "over 8h a day" notes are folded into one note per shift length (beta T02-15). */
export function checkMonth(state, y, m, cfgIn) {
  const cfg = cfgIn || settings(state), first = new Date(y, m - 1, 1), end = new Date(y, m, 1);
  const ws = new Date(first); ws.setDate(ws.getDate() - ws.getDay()); // week = Sunday–Saturday
  const wins = windows(state, ws, addDays(end, 7)), findings = [], weeks = [];
  const add = (level, rule, date, msg, label) => findings.push({ level, rule, article: ARTICLE[rule], date: date ? keyOf(date) : '', label: label || (date ? dayLabel(date) : ''), msg });
  // the legal ceiling always applies; a contract can only lower it (Art. 98, beta T05-02)
  const contractH = +(cfg.contractH ?? cfg.weeklyH) || 0, wk = Math.min(+cfg.weeklyH || LAW.weeklyH, LAW.weeklyH), capName = wk < LAW.weeklyH ? `${wk}h contract` : `${LAW.weeklyH}h legal`;
  if (contractH > LAW.weeklyH) add('violation', 'contract', null, `Your contract sets a ${contractH}h week, over the ${LAW.weeklyH}h legal limit. Weeks are checked against ${LAW.weeklyH}h`, 'Contract');
  const long = {}; let holMin = 0; const holByWeek = {};   // Art. 107: holiday hours are overtime; taken out of the weekly sum so no hour is paid twice (same rule as plans.js monthReport)
  for (const w of wins) {
    if (w.date < first || w.date >= end) continue;
    const span = mins(w.start, w.end) / 60;
    if (span > LAW.spanH) add('violation', 'span', w.date, `${span.toFixed(1)}h from start to finish, more than the ${LAW.spanH}h you may be at work in a day`);
    else if (span > LAW.dailyH) (long[span.toFixed(1)] ||= []).push(keyOf(w.date));
    if (isHoliday(cfg, w.date)) { add('info', 'holiday', w.date, `Worked on a public holiday: those hours count as overtime`); const dm = mins(w.start, w.end); holMin += dm; const wkKey = keyOf(addDays(w.date, -w.date.getDay())); holByWeek[wkKey] = (holByWeek[wkKey] || 0) + dm; }
  }
  for (const [hrs, dates] of Object.entries(long)) findings.push({ level: 'info', rule: 'daily', article: ARTICLE.daily, date: dates[0], dates, label: `${dates.length} ×`, msg: `${(+hrs).toFixed(hrs.endsWith('.0') ? 0 : 1)}h shift${dates.length > 1 ? 's' : ''}: over ${LAW.dailyH}h a day, fine inside a ${LAW.weeklyH}h week (normal for 12h clinical shifts)` });
  let otMin = 0, restBad = 0, legalOver = 0;
  for (let a = new Date(ws); a < end; a = addDays(a, 7)) {
    const b = addDays(a, 7); let worked = 0;
    const inWeek = wins.filter(w => w.end > a && w.start < b).map(w => ({ start: Math.max(w.start, a), end: Math.min(w.end, b) })).sort((x, y2) => x.start - y2.start);
    for (const w of inWeek) worked += mins(w.start, w.end);
    let ram = 0; for (let i = 0; i < 7; i++) if (inRamadan(cfg, addDays(a, i))) ram++;
    const r10 = (n) => Math.round(n * 10) / 10, cap = r10(((7 - ram) * wk + ram * Math.min(wk, LAW.ramadanWeeklyH)) / 7), legal = r10(((7 - ram) * LAW.weeklyH + ram * LAW.ramadanWeeklyH) / 7);
    const h = worked / 60, over = Math.max(0, h - cap), overLegal = Math.max(0, h - legal);
    // longest stretch with no work, counting the ends of the week
    let gap = 0, cur = +a; for (const w of inWeek) { gap = Math.max(gap, w.start - cur); cur = Math.max(cur, w.end); } gap = Math.max(gap, +b - cur);
    const restOk = gap >= LAW.restH * 3600000, inMonthDays = Array.from({ length: 7 }, (_, i) => addDays(a, i)).filter(d => d >= first && d < end).length, wl = `Week of ${weekLabel(a)}`;
    if (inMonthDays === 7) { // only judge whole weeks inside the month so a partial week at either edge never raises a false alarm
      otMin += Math.max(0, Math.round(worked - (holByWeek[keyOf(a)] || 0) - cap * 60)); if (overLegal > 0) legalOver++;
      const also = cap < legal && overLegal > 0 ? `, ${r10(overLegal)}h over the legal ${legal}h` : '';
      if (over > 0) add('warn', ram ? 'ramadan' : 'weekly', a, `${r10(h)}h worked (Sun–Sat): ${r10(over)}h over the ${ram ? `${cap}h Ramadan` : capName} limit${also}`, wl);
      if (!restOk) { restBad++; add('violation', 'rest', a, `No 24 consecutive hours off (Sun–Sat)`, wl); }
    }
    weeks.push({ start: keyOf(a), hours: Math.round(worked / 6) / 10, cap, legal, over: r10(over), overLegal: r10(overLegal), restOk, full: inMonthDays === 7, ram });
  }
  otMin += holMin; const ot = Math.round(otMin / 6) / 10, rate = otRate(cfg);
  const totals = { overtimeH: ot, compLeaveH: Math.round(ot * LAW.compLeaveH * 10) / 10, otPay: rate ? Math.round(ot * rate) : null, otRate: rate || null, restBad, legalOver, cap: wk, capName };
  const rank = { violation: 0, warn: 1, info: 2 };
  const level = findings.some(f => f.level === 'violation') ? 'violation' : findings.some(f => f.level === 'warn') ? 'warn' : 'ok';
  return { weeks, findings: findings.sort((p, q) => rank[p.level] - rank[q.level] || p.date.localeCompare(q.date)), totals, level, cfg };
}

/** Annual leave entitlement and what the loaded rotas already show as leave in the current leave year. */
export function leaveStatus(state, now = new Date(), cfgIn) {
  const cfg = cfgIn || settings(state); if (!cfg.hire) return null;
  const hire = fromKey(cfg.hire); let yrs = now.getFullYear() - hire.getFullYear(); const ann = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
  if (ann > now) yrs--; const start = new Date(now.getFullYear() - (ann > now ? 1 : 0), hire.getMonth(), hire.getDate());
  const entitled = Math.max(cfg.leaveDays || 0, yrs >= 5 ? LAW.annualDays5y : LAW.annualDays); let used = 0;
  const seen = new Set(); // months of the leave year that have my rota loaded: leave in other months cannot be seen (beta T05-27)
  for (let d = startOfDay(start); d <= now; d = addDays(d, 1)) { const m = dayInfo(state, d).mine; if (m) seen.add(keyOf(d).slice(0, 7)); if (m && m.shift.kind === 'leave') used++; }
  return { years: yrs, entitled, used, left: Math.max(0, entitled - used), seenMonths: seen.size, yearStart: keyOf(start), next5: yrs < 5 ? keyOf(new Date(hire.getFullYear() + 5, hire.getMonth(), hire.getDate())) : '' };
}
