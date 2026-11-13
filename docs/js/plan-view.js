// Plan tab model (pure, no DOM): what each day card shows, the week's balance of rest / study / gym / social,
// 24-hour time parsing and the checks for the Rules and Goals sheets. app.js draws it.
import { myDay } from './model.js';
import { keyOf, addDays, fmtMin, fmtDur } from './util.js';
import { PLANNER_DEFAULTS } from './planner.js';
import * as DY from './daily.js';

// ───────── time
/** "22:30", "2230", "9:05", "9" → minutes; anything else → null (never NaN, beta T06-04). */
export function parseHM(v) {
  const t = String(v ?? '').trim().replace('.', ':'); let m;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(t)) || (m = /^(\d{2})(\d{2})$/.exec(t)) || (m = /^(\d{1,2})()$/.exec(t))) {
    const hh = +m[1], mm = +(m[2] || 0); if (hh < 24 && mm < 60) return hh * 60 + mm;
  }
  return null;
}

// ───────── pillars: the owner wants rest, study, gym and social in balance
export const PILLARS = [
  { id: 'rest', label: 'Rest', color: 'var(--green)' },
  { id: 'study', label: 'Study', color: 'var(--orange)' },
  { id: 'gym', label: 'Gym', color: 'var(--blue)' },
  { id: 'social', label: 'Social', color: 'var(--eve)' },
];
/** Which pillar a block or goal belongs to (habits like card reviews count as study). */
export function pillarOf(x, goals = []) {
  const g = goals.find(g => g.id === x.goalId), kind = x.kind || g?.kind || '';
  if (kind === 'rest' || /^rest:/.test(x.goalId || '')) return 'rest';
  if (kind === 'fitness') return 'gym';
  if (kind === 'social') return 'social';
  if (kind === 'study' || kind === 'habit' || kind === 'app' || /^study:/.test(x.goalId || '')) return 'study';
  return 'study';
}
const isLive = (p) => p.status === 'accepted' || p.status === 'done';
const len = (p) => Number.isFinite(p.end - p.start) ? Math.max(0, p.end - p.start) : 0;

/**
 * One goal's week: done, accepted (not done yet) and still-suggested minutes against its target.
 * A study goal linked to a Study subject counts that subject's logged minutes too, so Plan and Study agree (beta T06-21):
 * done = the larger of "Done blocks" and "minutes logged" (Done logs into the same log, so they are never added twice).
 */
export function goalWeek(s, g, ws, suggestions = {}, now = new Date()) {
  let done = 0, acc = 0, sugg = 0;
  for (let i = 0; i < 7; i++) {
    const k = keyOf(addDays(ws, i));
    for (const p of s.plan?.[k] || []) if (p.goalId === g.id && isLive(p)) { if (p.status === 'done') done += len(p); else acc += len(p); }
    for (const b of suggestions[k] || []) if (b.goalId === g.id) sugg += len(b);
  }
  const sub = g.kind === 'study' || g.kind === 'habit' ? DY.subjectOf(s, g.name) : null;
  const logged = sub ? DY.weekMinutes(s, sub.id, now) : 0;
  return { done: Math.max(done, logged), acc, sugg, target: Math.round((+g.hoursPerWeek || 0) * 60), subject: sub?.name || '', logged, paused: !(+g.hoursPerWeek > 0) };
}

// ───────── one day card
/**
 * Rows for a day, in time order. `ctx` is planner.dayBusy(); items are accepted (`_acc`), suggested and study-plan (`_study`) blocks.
 * Shift rows carry the real shift hours with leave/home as a note (T06-05); sleep, recovery and wind-down are faint rows (T06-23).
 */
export function dayRows(s, ctx, { items = [], rejected = [], bed = null } = {}) {
  const rules = { ...PLANNER_DEFAULTS, ...(s.rules || {}) }, rows = [];
  const shiftBusy = ctx.busy.filter(b => b.kind === 'shift');
  if (ctx.overnightTail) {
    const h = ctx.overnightTail.shift.hours || {}, home = shiftBusy.find(b => b.start === 0)?.end;
    rows.push({ type: 'shift', night: true, start: 0, end: h.end ?? 0, sortAt: -1, label: `${ctx.overnightTail.shift.label.split(' (')[0]}`, time: `→ ${fmtMin(h.end ?? 0)}`, sub: `from last night${home != null ? ` · home ~${fmtMin(home)}` : ''}` });
  }
  if (ctx.today) {
    const h = ctx.today.shift.hours || { start: 8 * 60, end: 17 * 60 }, b = shiftBusy.find(x => x.start > 0 || !ctx.overnightTail);
    const home = h.overnight ? null : b?.end;
    rows.push({ type: 'shift', night: !!h.overnight, start: h.start, end: h.overnight ? 1440 : h.end, label: ctx.today.shift.label, code: ctx.today.code, time: `${fmtMin(h.start)}–${fmtMin(h.end)}`,
      sub: [ctx.leave != null ? `leave ${fmtMin(Math.max(0, ctx.leave))}` : '', home != null ? `home ~${fmtMin(Math.min(home, 1439))}` : '', h.overnight ? 'ends tomorrow' : ''].filter(Boolean).join(' · ') });
  }
  const covered = (r) => [...items, ...rejected].some(i => (i.kind === 'rest' || /^rest:/.test(i.goalId || '')) && i.start < r.end && i.end > r.start);
  let wind = null, lights = null;
  for (const b of ctx.busy) {
    if (b.kind === 'sleep') {
      if (b.rest === 'winddown') { wind = b; continue; }
      if (b.label === 'Sleep') { if (b.end === 1440) lights = b; continue; }   // the night itself: drawn as the lights-out row
      if (b.rest && covered(b)) continue;                                       // the nap / rest block is on the card already
      rows.push({ type: 'sleep', start: b.start, end: b.end, label: b.label, time: `${fmtMin(b.start)}–${fmtMin(b.end)}` });
    } else if (b.kind === 'event' || b.kind === 'protected') rows.push({ type: b.kind, start: b.start, end: b.end, label: b.label, time: `${fmtMin(b.start)}–${fmtMin(Math.min(b.end, 1439))}` });
  }
  if (lights) {
    const planned = lights.start, lo = bed != null && bed < planned ? bed : planned, wd = wind ? wind.end - wind.start : 0;
    const why = bed != null && bed <= planned ? 'early start tomorrow' : planned < rules.sleepStart ? 'early start tomorrow' : '';
    rows.push({ type: 'sleep', lights: true, start: lo - wd, end: lo, label: wd ? `Wind down · lights out ${fmtMin(lo)}` : `Lights out ${fmtMin(lo)}`, time: fmtMin(lo - wd), sub: why });
  }
  for (const i of items) rows.push({ type: 'block', start: i.start, end: i.end, block: i });
  return rows.sort((a, b) => (a.sortAt ?? a.start) - (b.sortAt ?? b.start) || (a.type === 'block') - (b.type === 'block'));
}

/** Bedtime from Settings › Sleep (the Tonight card's "Be asleep by"), on this day's clock; null when tomorrow is free or a night (T01-19). */
export function dailyBed(s, date) {
  const sh = myDay(s, addDays(date, 1)).today?.shift; if (!sh?.hours || sh.hours.overnight || sh.type === 'N') return null;
  const cfg = DY.daySettings(s); return sh.hours.start - cfg.prepMin - Math.round(cfg.sleepH * 60) + 1440;
}

/** Minutes per pillar (and work) for a day, from its rows: the week strip draws these. */
export function dayLoad(rows, goals) {
  const out = { work: 0, rest: 0, study: 0, gym: 0, social: 0 };
  for (const r of rows) {
    if (r.type === 'shift') out.work += Math.max(0, (r.end - r.start)) || 0;
    else if (r.type === 'block') out[pillarOf(r.block, goals)] += len(r.block);
  }
  return out;
}

/** "free day · 3h left of 8h this week" → "3h left of 8h this week": the day label is already in the card header. */
export function trimReason(reason, label) {
  let r = String(reason || ''); if (label && r.startsWith(label)) r = r.slice(label.length).replace(/^\s*·\s*/, '');
  return r;
}

// ───────── sheets
// [field, label, min, max, unit]  (time fields are parsed with parseHM)
export const RULE_FIELDS = {
  sleepHours: ['Sleep hours', 4, 12, 'h'], sleepStart: ['Lights out (free days)', 0, 1439, 'time'], wakeMin: ['Wake (free days)', 0, 1439, 'time'],
  postNightRecoveryUntil: ['After a night, sleep until', 0, 1439, 'time'], preShiftBufferMin: ['Before shift', 0, 240, 'min'], postShiftBufferMin: ['After shift', 0, 240, 'min'],
  windDownMin: ['Wind down before bed', 0, 180, 'min'], breakMin: ['Break between blocks', 0, 60, 'min'], recoveryWeekHours: ['Recovery day after a week over', 24, 96, 'h'],
  maxStudyOnWorkday: ['Max study, work day', 0, 720, 'min'], maxStudyOnFreeDay: ['Max study, free day', 0, 720, 'min'],
  earliestPlan: ['Plan from', 0, 1439, 'time'], latestPlan: ['Plan until', 0, 1439, 'time'],
};
/** raw: {field: string}. Blank keeps the old value; anything else must be in range. → { rules, errors: {field: msg} } */
export function checkRules(raw, old) {
  const rules = { ...PLANNER_DEFAULTS, ...old }, errors = {};
  for (const [k, [, lo, hi, unit]] of Object.entries(RULE_FIELDS)) {
    if (!(k in raw)) continue; const t = String(raw[k] ?? '').trim(); if (t === '') continue;
    if (unit === 'time') { const m = parseHM(t); if (m == null) errors[k] = 'Use 24-hour HH:MM'; else rules[k] = m; continue; }
    const v = +t; if (!Number.isFinite(v)) { errors[k] = 'Enter a number'; continue; }
    if (v < lo || v > hi) { errors[k] = `${lo}–${hi} ${unit}`; continue; }
    rules[k] = unit === 'h' ? Math.round(v * 2) / 2 : Math.round(v);
  }
  if (!errors.earliestPlan && !errors.latestPlan && rules.latestPlan <= rules.earliestPlan) errors.latestPlan = 'Must be after “Plan from”';   // T06-15
  if (raw.after12h != null) rules.after12h = ['rest', 'light', 'normal'].includes(raw.after12h) ? raw.after12h : 'light';
  if (raw.napBeforeNight != null) rules.napBeforeNight = !!raw.napBeforeNight;
  return { rules, errors };
}
/** One goal row from the sheet → { goal, errors } (T06-16: name required, h/week ≥ 0, min ≤ max). */
export function checkGoal(raw) {
  const errors = {}, num = (v) => String(v ?? '').trim() === '' ? NaN : +v;
  const name = String(raw.name || '').trim().slice(0, 60); if (!name) errors.name = 'Name it';
  let hpw = num(raw.hoursPerWeek); if (!Number.isFinite(hpw) || hpw < 0 || hpw > 80) errors.hoursPerWeek = '0–80 h';
  let min = num(raw.minBlock); if (!Number.isFinite(min) || min < 5 || min > 480) errors.minBlock = '5–480 min';
  let max = num(raw.maxBlock); if (!Number.isFinite(max) || max < 5 || max > 720) errors.maxBlock = '5–720 min';
  if (!errors.minBlock && !errors.maxBlock && min > max) errors.maxBlock = 'At least the min block';
  let prio = num(raw.priority); if (!Number.isFinite(prio) || prio < 1 || prio > 9) errors.priority = '1–9';
  const goal = { ...raw, name, hoursPerWeek: Math.round(hpw * 2) / 2, minBlock: Math.round(min), maxBlock: Math.round(max), priority: Math.round(prio) };
  return { goal, errors };
}
export const fmtLeft = (have, target) => target ? (have >= target ? 'done ✓' : `${fmtDur(target - have)} left`) : 'paused';
