// Rule-based planner: finds free, energy-appropriate slots and fills them with goal blocks.
// It plans like a doctor's week: never in the past, sleep protected around nights, light evenings after 12h shifts,
// weekly goals carried by the days off, and a recovery day after a heavy week. Every suggestion carries a human "why".
// Rejections teach preferences (state.prefs).
import { myDay, isNurseRota } from './model.js';
import { keyOf, fromKey, addDays, startOfDay, fmtMin, fmtDur } from './util.js';
import { subjectOf, weekMinutes } from './daily.js';

const DAY_MS = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Planner-only rules with their defaults (older saved rules don't have them; the Rules sheet may add them later).
export const PLANNER_DEFAULTS = {
  after12h: 'light',        // after a shift of 10h+: 'rest' (nothing), 'light' (one ≤30-min item), 'normal'
  windDownMin: 60,          // kept free before lights-out on work days (half of it on days off)
  breakMin: 15,             // gap on both sides of every planned block and calendar event
  napBeforeNight: true,     // first night of a run: protect an afternoon nap
  recoveryWeekHours: 48,    // more than this in the last 7 days → the next day off is a recovery day
};
const R = (rules) => ({ ...PLANNER_DEFAULTS, ...(rules || {}) });
const NAP_COLOR = '#8b93ff';
const ceil15 = (m) => Math.ceil(m / 15) * 15, floor15 = (m) => Math.floor(m / 15) * 15;
const memo = (cache, k, f) => { if (!cache) return f(); if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const myDayC = (state, date, cache) => memo(cache, 'my:' + keyOf(date), () => myDay(state, date));

// Shift hours, with a safe guess when the legend has none (an unknown code is still a working day).
function hoursOf(shift) {
  const h = shift?.hours;
  if (!h) return { start: 8 * 60, end: 17 * 60, overnight: false, durationMin: 540, guessed: true };
  return { ...h, durationMin: h.durationMin || (h.overnight ? h.end + 1440 - h.start : h.end - h.start) };
}
const isLong = (shift) => hoursOf(shift).durationMin >= 10 * 60;

// ---- what kind of day this is for a doctor ----
// mode: unknown | free | recovery | day | long-day | post-night | night-first | between-nights
export function dayProfile(state, date, cache = null) {
  return memo(cache, 'prof:' + keyOf(date), () => {
    const rules = R(state.rules);
    const md = myDayC(state, date, cache);
    const today = md.today, th = today ? hoursOf(today.shift) : null;
    const nightTonight = !!th?.overnight, afterNight = !!md.overnightTail;
    // A month with no doctors' rota (while other months have one) is unknown, not free: don't fill it with study.
    const hasDocRota = Object.values(state.rotas || {}).some(r => !isNurseRota(r));
    if (hasDocRota && !md.info.rotas.some(r => !isNurseRota(r))) return { mode: 'unknown', label: `no ${MONTHS[date.getMonth()]} rota yet`, weekMin: 0 };
    // last 7 days of work, and the run of long shifts that ended yesterday
    let weekMin = 0, longRun = 0, running = true;
    for (let i = 1; i <= 7; i++) {
      const t = myDayC(state, addDays(date, -i), cache).today;
      if (t) weekMin += hoursOf(t.shift).durationMin;
      if (running) { if (t && isLong(t.shift)) longRun++; else if (!(i === 1 && afterNight)) running = false; }
    }
    const prev = myDayC(state, addDays(date, -1), cache);
    let mode;
    if (nightTonight) mode = afterNight ? 'between-nights' : 'night-first';
    else if (today) mode = isLong(today.shift) ? 'long-day' : 'day';
    else if (afterNight) mode = 'post-night';
    else if ((prev.today || prev.afterNight) && (weekMin > rules.recoveryWeekHours * 60 || longRun >= 3)) mode = 'recovery';
    else mode = 'free';
    if (mode === 'long-day' && rules.after12h === 'normal') mode = 'day';
    const h = Math.round(weekMin / 60);
    const label = {
      free: 'free day', day: `around your ${today?.shift.label.split(' · ')[0].toLowerCase()} shift`,
      'long-day': rules.after12h === 'rest' ? 'after a 12h shift — evening kept for rest' : 'after a 12h shift — one light item, last hour before bed kept free',
      'post-night': 'after your night — slept until mid-afternoon, kept light',
      'night-first': 'first night tonight — light morning, nap in the afternoon',
      'between-nights': 'between nights — only habit-sized items',
      recovery: longRun >= 3 && weekMin <= rules.recoveryWeekHours * 60 ? `recovery day after ${longRun} long shifts in a row` : `recovery day after a ${h}h week`,
    }[mode];
    return { mode, label, weekMin, longRun, nightTonight, afterNight, today, hours: th };
  });
}

// How each mode plans: light = only habit-sized (≤30 min) items; maxBlocks caps goal/app blocks; weight spreads weekly goals.
const MODES = {
  free: { weight: 3 },
  recovery: { weight: 1, studyCap: 60, maxBlocks: 3 },
  day: { weight: 1 },
  'long-day': { weight: 0.2, light: true, maxBlocks: 1 },
  'post-night': { weight: 0.6, studyCap: 45, noFitness: true, maxBlocks: 2 },
  'night-first': { weight: 0.2, light: true, maxBlocks: 1 },
  'between-nights': { weight: 0.1, light: true, maxBlocks: 1 },
  unknown: { weight: 0, maxBlocks: 0 },
};
function modeOf(state, prof) {
  const m = { ...MODES[prof.mode] };
  if (prof.mode === 'long-day' && R(state.rules).after12h === 'rest') { m.maxBlocks = 0; m.weight = 0; }
  return m;
}
const LIGHT_MAX = 30;
// Share of a goal a day of this mode can carry (0 = not on such a day)
function weightFor(state, prof, g) {
  const m = modeOf(state, prof);
  if (g.kind === 'rest') return 0;
  if (g.kind === 'fitness' && (m.noFitness || m.light)) return 0;
  if (g.kind === 'social' && m.light) return 0;
  if (m.light && g.minBlock > LIGHT_MAX && g.kind !== 'habit') return 0;
  if (prof.mode === 'recovery' && g.kind === 'social') return MODES.free.weight;   // recovery leans social, not study
  return m.weight;
}

// ---- busy intervals for one day (minutes from local midnight, may exceed 1440 for overnight) ----
export function dayBusy(state, date, events = [], cache = null) {
  const rules = R(state.rules);
  const { today, overnightTail, afterNight } = myDayC(state, date, cache);
  const profile = dayProfile(state, date, cache);
  const busy = [];
  const add = (s, e, label, kind, extra = {}) => { if (e > s) busy.push({ start: s, end: e, label, kind, ...extra }); };

  // overnight shift ending this morning + recovery sleep until mid-afternoon
  if (overnightTail) {
    const endMin = hoursOf(overnightTail.shift).end;
    const home = endMin + commuteFor(rules, overnightTail.shift.site) + rules.postShiftBufferMin;
    add(0, home, `${overnightTail.shift.label} (ends ${fmtMin(endMin)})`, 'shift');
    add(home, Math.max(home, rules.postNightRecoveryUntil), 'Recovery sleep after night', 'sleep');
  }
  let leave = null;
  if (today) {
    const h = hoursOf(today.shift);
    const commute = commuteFor(rules, today.shift.site);
    leave = h.start - commute - rules.preShiftBufferMin;
    const e = h.overnight ? 1440 : h.end + commute + rules.postShiftBufferMin;
    add(Math.max(0, leave), Math.min(1440, e), today.shift.label, 'shift');
  }
  // lights-out: an early start tomorrow pulls bedtime forward (wake − sleep lands before midnight)
  const tomorrow = myDayC(state, addDays(date, 1), cache);
  let lightsOut = rules.sleepStart;
  if (tomorrow.today && !hoursOf(tomorrow.today.shift).overnight) {
    const wake = hoursOf(tomorrow.today.shift).start - commuteFor(rules, tomorrow.today.shift.site) - rules.preShiftBufferMin;
    const bed = wake - Math.round(rules.sleepHours * 60);
    if (bed < 0) lightsOut = Math.min(rules.sleepStart, bed + 1440);
  }
  const nightTonight = !!(today && hoursOf(today.shift).overnight);
  if (!nightTonight) {
    add(lightsOut, 1440, 'Sleep', 'sleep');
    // wind-down: after work the last hour stays free; on a day off half of it
    const wd = today || afterNight ? rules.windDownMin : Math.round(rules.windDownMin / 2);
    add(lightsOut - wd, lightsOut, 'Wind down', 'sleep', { rest: 'winddown' });
  }
  if (!overnightTail) add(0, rules.wakeMin, 'Sleep', 'sleep');

  // doctor rest windows (kind 'sleep' so the dial draws them as rest; `rest` tells the Plan view what they are)
  const rest = [];
  if (profile.mode === 'night-first' && rules.napBeforeNight && leave != null) {
    const napEnd = floor15(leave - 60), napStart = Math.max(13 * 60, napEnd - 210);
    if (napEnd - napStart >= 60) { rest.push({ start: napStart, end: napEnd, label: 'Nap before night', rest: 'nap' }); rest.push({ start: napEnd, end: leave, label: 'Wake up and eat before the night', rest: 'eat' }); }
  }
  if (profile.mode === 'between-nights' && leave != null) rest.push({ start: Math.max(rules.postNightRecoveryUntil, floor15(leave - 60)), end: leave, label: 'Rest and eat before the night', rest: 'eat' });
  if (profile.mode === 'recovery') rest.push({ start: rules.earliestPlan, end: Math.max(rules.earliestPlan, 11 * 60), label: 'Slow morning — recovery', rest: 'recovery' });
  for (const r of rest) add(r.start, r.end, r.label, 'sleep', { rest: r.rest });

  // protected blocks
  for (const b of rules.protectedBlocks || []) if (!b.days?.length || b.days.includes(date.getDay())) add(b.start, b.end, b.label, 'protected');

  // calendar events
  for (const ev of events) {
    if (ev.allDay) continue;
    const s0 = startOfDay(date).getTime();
    const s = Math.max(0, Math.round((ev.start - s0) / 60000)), e = Math.min(1440, Math.round((ev.end - s0) / 60000));
    if (e > 0 && s < 1440) add(s, e, ev.title, 'event');
  }
  // accepted plan blocks
  for (const p of state.plan?.[keyOf(date)] || []) if ((p.status === 'accepted' || p.status === 'done') && Number.isFinite(p.start) && Number.isFinite(p.end)) add(p.start, p.end, p.title, 'plan', { goalId: p.goalId });

  busy.sort((a, b) => a.start - b.start);
  return { busy, today, overnightTail, afterNight, profile, lightsOut, leave, rest };
}

export function commuteFor(rules, site) {
  return rules.commute?.[site] ?? rules.commute?.default ?? 30;
}

export function freeSlots(busy, from, to, minLen) {
  const out = [];
  let cur = from;
  for (const b of [...busy].sort((x, y) => x.start - y.start)) {
    if (b.end <= cur) continue;
    if (b.start > cur) { const e = Math.min(b.start, to); if (e - cur >= minLen) out.push({ start: cur, end: e }); }
    cur = Math.max(cur, b.end);
    if (cur >= to) break;
  }
  if (to - cur >= minLen) out.push({ start: cur, end: to });
  return out.filter(s => s.end - s.start >= minLen);
}

// Energy profile of a day: 'high' (off), 'medium' (day shift evening / before shift), 'low' (after night, night shift day)
export function dayEnergy(ctx) {
  if (ctx.today && ctx.today.shift.hours?.overnight) return 'low';
  if (ctx.afterNight) return 'low';
  if (ctx.today) return 'medium';
  return 'high';
}

const partOf = (m) => m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'afternoon' : 'evening';
function slotTag(ctx, slot) { return `${dayEnergy(ctx)}-${partOf(slot.start)}`; }

// Weekly progress for goals from accepted plan blocks
export function weekProgress(state, weekStart) {
  const prog = {};
  for (let i = 0; i < 7; i++) {
    const k = keyOf(addDays(weekStart, i));
    for (const p of state.plan?.[k] || []) if ((p.status === 'accepted' || p.status === 'done') && Number.isFinite(p.end - p.start)) prog[p.goalId] = (prog[p.goalId] || 0) + (p.end - p.start);
  }
  // A study/habit goal linked to a Study subject also counts minutes logged by hand in Study, so a manual +30 lowers the
  // planner's target too (beta T06-21). Larger of the two: Done blocks already log into the same Study log.
  for (const g of state.goals || []) { if (g?.kind !== 'study' && g?.kind !== 'habit') continue; const sub = subjectOf(state, g.name); if (sub) prog[g.id] = Math.max(prog[g.id] || 0, weekMinutes(state, sub.id, addDays(weekStart, 3))); }
  return prog;
}

export function weekStartOf(d) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; } // Sunday start

// Block length: habits to 5 min, others to 15, long study to 30 — never odd lengths like 1h 9m
function roundLen(len, kind) {
  if (kind === 'habit') return Math.floor(len / 5) * 5;
  if (kind === 'study' && len >= 60) return Math.floor(len / 30) * 30;
  return floor15(len);
}

/**
 * Suggest blocks for [from, from+days). eventsByDay: key -> events[]; apps: hub statuses (asks); opts.now pins the clock.
 * Returns { dateKey: block[] }. Non-enumerable extras for the Plan view: `.days[key] = {mode, label}` and
 * `.notes[key] = [text…]` (rota unknown, a habit that didn't fit, a goal skipped twice).
 */
export function suggest(state, from, days, eventsByDay = {}, apps = {}, metaFn = null, opts = {}) {
  const rules = R(state.rules);
  const now = opts.now || new Date();
  const todayKey = keyOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const cache = new Map();
  const goals = [...(state.goals || [])].filter(g => g && g.hoursPerWeek > 0).sort((a, b) => a.priority - b.priority);
  const restGoal = goals.find(g => g.kind === 'rest');
  const suggestions = {}, notes = {}, dayInfo = {};
  Object.defineProperty(suggestions, 'notes', { value: notes, enumerable: false });
  Object.defineProperty(suggestions, 'days', { value: dayInfo, enumerable: false });
  const note = (k, t) => (notes[k] ||= []).push(t);
  const weekly = {}; // weekStart -> goalId -> minutes already (accepted + suggested)
  const bump = (ws, gid, min) => { (weekly[ws] ||= {}); weekly[ws][gid] = (weekly[ws][gid] || 0) + min; };
  for (let i = 0; i < days; i++) {
    const ws = keyOf(weekStartOf(addDays(from, i)));
    if (!weekly[ws]) { weekly[ws] = {}; for (const [g, m] of Object.entries(weekProgress(state, weekStartOf(addDays(from, i))))) bump(ws, g, m); }
  }

  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const key = keyOf(date);
    if (key < todayKey) continue;                       // never plan the past
    const ws = keyOf(weekStartOf(date));
    const ctx = dayBusy(state, date, eventsByDay[key] || [], cache);
    const prof = ctx.profile, mode = modeOf(state, prof);
    dayInfo[key] = { mode: prof.mode, label: prof.label };
    if (prof.mode === 'unknown') { note(key, `No ${MONTHS[date.getMonth()]} rota yet — nothing planned until it's imported.`); continue; }
    const energy = dayEnergy(ctx);
    const planList = state.plan?.[key] || [];
    const existing = planList.filter(p => p.status === 'accepted' || p.status === 'done');
    const rejected = planList.filter(p => p.status === 'rejected');
    const cap = mode.studyCap ?? (ctx.today ? rules.maxStudyOnWorkday : rules.maxStudyOnFreeDay);
    let studyUsed = existing.filter(p => p.kind === 'study').reduce((a, p) => a + (p.end - p.start), 0);
    let blocks = existing.filter(p => p.kind !== 'rest').length;
    const dayList = [];
    // a gap on both sides of planned blocks and events (shift and sleep already carry their own buffers)
    const brk = rules.breakMin;
    const busy = ctx.busy.map(b => b.kind === 'plan' || b.kind === 'event' ? { ...b, start: b.start - brk, end: b.end + brk } : b);
    const occupy = (start, end, label) => busy.push({ start: start - brk, end: end + (end - start >= 90 ? 30 : brk), label, kind: 'plan' });
    let earliest = ctx.today && hoursOf(ctx.today.shift).overnight ? Math.max(rules.earliestPlan, 10 * 60) : rules.earliestPlan;
    if (key === todayKey) earliest = Math.max(earliest, ceil15(nowMin + 5));
    let latest = rules.latestPlan;
    const napStart = ctx.rest.find(r => r.rest === 'nap')?.start;
    if (napStart != null) latest = Math.min(latest, napStart - 60);   // first night: lunch, then the nap
    const free = prof.mode === 'free' || prof.mode === 'recovery';

    // 0. Built-in rest windows become blocks you can accept (they also count toward a "rest" goal)
    for (const r of ctx.rest) {
      const gid = restGoal && r.rest !== 'recovery' ? restGoal.id : `rest:${r.rest}`;
      if (planList.some(p => p.goalId === gid && p.start < r.end && p.end > r.start)) continue;
      const start = Math.max(r.start, key === todayKey ? ceil15(nowMin) : 0);
      if (r.end - start < 30) continue;
      dayList.push({ id: `${key}-${gid}-${start}`, goalId: gid, title: r.label, kind: 'rest', color: restGoal?.color || NAP_COLOR, start, end: r.end, status: 'suggested', date: key, reason: prof.label, tag: slotTag(ctx, { start }) });
      if (gid === restGoal?.id) bump(ws, gid, r.end - start);
    }

    // Build the candidates: app asks and goals, daily habits first so they never lose their slot to a long block
    const asksToday = [];
    for (const [appName, st] of Object.entries(apps || {})) for (const ask of (st?.asks || []).filter(a => a.date === key)) asksToday.push({ appName, st, ask, appKey: String(st.app || appName).toLowerCase() });
    const shadows = (g, appKey) => g.name.toLowerCase().includes(appKey) || (g.app || '').toLowerCase() === appKey;
    const cands = [];
    for (const a of asksToday) cands.push({ type: 'ask', ...a, phase: goals.some(g => g.daily && shadows(g, a.appKey)) ? 0 : 2 });
    // a recovery day puts friends before study
    for (const g of goals) cands.push({ type: 'goal', g, phase: g.daily ? 1 : prof.mode === 'recovery' && g.kind === 'social' ? 1.5 : 3 });
    cands.sort((a, b) => a.phase - b.phase);
    const askedApps = new Set();

    const dayShift = ctx.today && !hoursOf(ctx.today.shift).overnight;
    const shiftStart = dayShift ? ctx.leave : null;

    // Find the best placement for one block; avoid: the goal's skipped times today
    const place = ({ gid, kind, want, minLen, target, wantBefore, scoreGoal, avoid }) => {
      const b = [...busy, ...avoid];
      // heavy things (study, gym) end a full wind-down before lights-out on any day, not just after work
      const until = kind === 'study' || kind === 'fitness' ? Math.min(latest, ctx.lightsOut - rules.windDownMin) : latest;
      const slots = freeSlots(b, earliest, until, minLen);
      let best = null;
      for (const s of slots) {
        let len = Math.min(want, s.end - s.start);
        let start;
        if (wantBefore && s.end <= shiftStart) start = floor15(s.end - len);
        else start = target == null ? s.start : Math.min(Math.max(target, s.start), s.end - len);
        start = ceil15(start);
        if (start < s.start) start = ceil15(s.start);
        len = roundLen(Math.min(len, s.end - start), kind);
        if (len < minLen) continue;
        let score = scoreGoal ? scoreSlot(state, scoreGoal, { start, end: start + len }, ctx, energy, date) : 0;
        score += len / Math.max(30, want) * 2;                                  // a slot that fits the whole block wins
        if (target != null) score -= Math.abs(start - target) / 60;
        if (wantBefore) score += s.end <= shiftStart ? 10 + s.end / 1440 : 0;
        if (!best || score > best.score) best = { start, len, score };
      }
      return best;
    };
    const skippedOf = (gid) => rejected.filter(p => p.goalId === gid && Number.isFinite(p.start)).map(p => ({ start: p.start, end: p.end, kind: 'skip' }));

    for (const c of cands) {
      if (mode.maxBlocks != null && blocks >= mode.maxBlocks) {
        if (c.type === 'goal' && c.g.daily && !existing.some(p => p.goalId === c.g.id)) note(key, `${c.g.name} left out — ${prof.label.split(' — ')[0]}.`);
        continue;
      }
      if (c.type === 'ask') {
        const { appName, st, ask, appKey } = c;
        const gid = `app:${appKey}`;
        if (existing.some(p => p.goalId === gid)) { askedApps.add(appKey); continue; }
        const skipped = skippedOf(gid); if (skipped.length >= 2) continue;
        const asked = Math.max(10, Math.min(180, Math.round(+ask.minutes || 30)));
        const minutes = mode.light ? Math.min(asked, LIGHT_MAX) : asked;
        const wantBefore = ask.slot === 'before' && dayShift;
        const p = place({ gid, kind: 'study', want: minutes, minLen: Math.min(minutes, 20), target: null, wantBefore, scoreGoal: { id: gid, kind: 'study', maxBlock: minutes }, avoid: skipped });
        if (!p) continue;
        const { start, len } = p;
        const meta = metaFn ? metaFn(appName, st) : { title: st.title || appName, color: st.color || '#9aa0b1' };
        const why = [ask.reason || `${meta.title} asked for ${fmtDur(asked)}`];
        if (len < asked) why[0] += mode.light ? ` (kept to ${fmtDur(len)} — ${prof.label.split(' — ')[0]})` : ` (only ${fmtDur(len)} free)`;
        if (wantBefore) why[0] += start + len <= shiftStart ? ' before your shift' : ' before your shift — no room, placed after';
        if (skipped.length) why.push(`moved — you skipped ${fmtMin(skipped[0].start)}`);
        if (st.summary) why.push(String(st.summary).slice(0, 80));
        dayList.push({ id: `${key}-${gid}-${start}`, goalId: gid, app: appKey, title: ask.title || meta.title, kind: 'app', color: meta.color, start, end: start + len, status: 'suggested', date: key, reason: why.join(' · '), tag: slotTag(ctx, { start }) });
        occupy(start, start + len, ask.title || meta.title);
        askedApps.add(appKey); blocks++;
        if (!g_isHabit(st)) studyUsed += len;
        continue;
      }
      const g = c.g;
      if (g.kind === 'rest') continue;                                  // rest is shift-aware: the built-in windows above carry it
      if ([...askedApps].some(a => shadows(g, a))) continue;            // an app that asked for time today replaces its goal
      if (existing.some(p => p.goalId === g.id) && !g.split) continue;   // one session per goal per day
      const target = Math.round(g.hoursPerWeek * 60);
      const have = weekly[ws]?.[g.id] || 0;
      const deficit = target - have;
      if (deficit <= 0) continue;
      const skipped = skippedOf(g.id);
      if (skipped.length >= 2) { note(key, `${g.name} skipped twice — not offered again today.`); continue; }
      const minB = Math.max(5, +g.minBlock || 30), maxB = Math.max(minB, +g.maxBlock || minB);
      let want, minLen = minB;
      if (g.daily) {
        want = Math.min(maxB, Math.max(minB, Math.round(target / 7)));
        minLen = Math.min(minB, 15);                                     // a daily habit shrinks to fit rather than vanish
      } else {
        // spread what's left over the rest of the week, weighted by what each day can carry
        const w = weightFor(state, prof, g);
        if (!w) continue;
        let sum = 0, maxW = 0;
        for (let d = date, n = 0; n < 7 && keyOf(weekStartOf(d)) === ws; d = addDays(d, 1), n++) { const wd = weightFor(state, dayProfile(state, d, cache), g); sum += wd; maxW = Math.max(maxW, wd); }
        let share = Math.min(deficit, Math.round(deficit * w / Math.max(w, sum)));
        if (share < minB) { if (w < maxW || deficit < minB) continue; share = minB; }   // light days leave small leftovers to days off; a leftover under one session waits
        want = Math.min(maxB, share);
      }
      // boosts: a near deadline allows a bigger block; an app saying how long it needs sets the size
      if (g.deadline) { const dl = (fromKey(g.deadline) - startOfDay(date)) / DAY_MS; if (dl > 0 && dl < 42) want = Math.min(maxB, Math.round(want * 1.3)); }
      const app = appHint(apps, g);
      if (app?.minutes) want = Math.max(minB, Math.min(maxB, app.minutes));
      // limits always win over boosts: tired days stay light, study has a daily ceiling
      if (mode.light) { if (g.kind !== 'habit' && minB > LIGHT_MAX) continue; if (g.kind === 'fitness' || g.kind === 'social') continue; want = Math.min(want, LIGHT_MAX); minLen = Math.min(minLen, want); }
      if (mode.noFitness && g.kind === 'fitness') continue;
      if (energy === 'low' && g.kind === 'study') want = Math.min(want, 45);
      if (g.kind === 'study' && studyUsed + want > cap) want = cap - studyUsed;
      want = roundLen(want, g.kind);
      if (want < minLen) continue;
      // preferred time of day: study when fresh, gym late afternoon on days off, friends in the evening, a habit after lunch
      const studiedToday = dayList.some(b => b.kind === 'study') || existing.some(b => b.kind === 'study');
      const tgt = g.kind === 'social' ? 18 * 60 + 30 : g.kind === 'fitness' && free ? 16 * 60 : g.kind === 'habit' && free ? 13 * 60 : g.kind === 'study' && studiedToday && free ? 14 * 60 : null;
      const p = place({ gid: g.id, kind: g.kind, want, minLen, target: tgt, scoreGoal: g, avoid: skipped });
      if (!p) { if (g.daily) note(key, `${g.name} didn't fit today.`); continue; }
      const { start, len } = p;
      const reason = reasonFor(g, prof, deficit, target, app, now) + (skipped.length ? ` · moved — you skipped ${fmtMin(skipped[0].start)}` : '') + (len < want && g.daily ? ` · shortened to ${fmtDur(len)} to fit` : '');
      dayList.push({ id: `${key}-${g.id}-${start}`, goalId: g.id, title: g.name, kind: g.kind, color: g.color, start, end: start + len, status: 'suggested', date: key, reason, tag: slotTag(ctx, { start }) });
      occupy(start, start + len, g.name);
      bump(ws, g.id, len); blocks++;
      if (g.kind === 'study') studyUsed += len;
    }
    if (dayList.length) suggestions[key] = dayList.sort((a, b) => a.start - b.start);
  }
  return suggestions;
}

function g_isHabit(st) { return /habit|review/i.test(st?.next?.title || ''); }
function appHint(apps, goal) {
  const name = goal.name.toLowerCase();
  for (const [app, st] of Object.entries(apps || {})) {
    if (name.includes(app.toLowerCase()) || (goal.app && goal.app.toLowerCase() === app.toLowerCase())) {
      const due = +(st.due ?? st.dueCards ?? (Array.isArray(st.pending) ? 0 : st.pending) ?? 0) || 0;
      const minutes = st.estimatedMinutes ?? (due ? Math.min(90, Math.max(15, Math.round(due * 0.2))) : 0);
      return { app, due, minutes, summary: st.summary || '' };
    }
  }
  return null;
}

function scoreSlot(state, g, s, ctx, energy, date) {
  let score = 0;
  const part = partOf(s.start);
  if (g.kind === 'study' && part === 'morning' && energy !== 'low') score += 2;  // fresh brain
  if (g.kind === 'fitness' && part !== 'evening') score += 1;
  if (g.kind === 'social') { if (part === 'evening') score += 3; if ([4, 5].includes(date.getDay())) score += 1; if (part === 'morning') score -= 2; } // evenings, esp. Thu/Fri
  if (g.kind === 'habit') score += part === 'evening' ? 1 : 0;
  if (ctx.today && ctx.today.shift.type === 'N' && part === 'evening') score -= 5; // pre-night evening is for rest
  score += state.prefs?.[`${g.id}|${energy}-${part}`] || 0;                         // learned preference (negative after rejections)
  return score;
}

function reasonFor(g, prof, deficit, target, app, now) {
  const bits = [prof.label];
  bits.push(`${fmtDur(Math.max(0, deficit))} left of ${fmtDur(target)} this week`);
  if (app) bits.push(`${app.app}: ${app.due} due`);
  if (g.deadline) { const dl = Math.ceil((fromKey(g.deadline) - startOfDay(now)) / DAY_MS); if (dl > 0) bits.push(`${dl} days to deadline`); }
  return bits.join(' · ');
}

// Learned preference: reject -> down-weight that goal in that slot type. Counted once per block (a second Skip of the
// same block, or a block already rejected, teaches nothing new).
export function learn(state, block, delta) {
  const prefs = { ...(state.prefs || {}) };
  if (!block?.goalId || !block.tag) return prefs;
  const k = block.date || '';
  if ((state.plan?.[k] || []).some(p => p.id === block.id && (delta < 0 ? p.status === 'rejected' : p.status === 'accepted' || p.status === 'done'))) return prefs;
  const key = `${block.goalId}|${block.tag}`;
  prefs[key] = Math.max(-6, Math.min(6, (prefs[key] || 0) + delta));
  return prefs;
}
