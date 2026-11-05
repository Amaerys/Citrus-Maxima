// Rule-based planner: finds free, energy-appropriate slots and fills them with goal blocks.
// Every suggestion carries a human "why". Rejections teach preferences (state.prefs).
import { myDay } from './model.js';
import { keyOf, fromKey, addDays, startOfDay, fmtMin, fmtDur } from './util.js';

const DAY_MS = 86400000;

// ---- busy intervals for one day (minutes from local midnight, may exceed 1440 for overnight) ----
export function dayBusy(state, date, events = []) {
  const rules = state.rules;
  const { today, overnightTail, afterNight } = myDay(state, date);
  const busy = [];
  const add = (s, e, label, kind) => { if (e > s) busy.push({ start: s, end: e, label, kind }); };

  // overnight shift ending this morning + recovery sleep
  if (overnightTail) {
    const endMin = overnightTail.shift.hours.end;
    const commute = commuteFor(rules, overnightTail.shift.site);
    add(0, endMin + commute + rules.postShiftBufferMin, `${overnightTail.shift.label} (ends ${fmtMin(endMin)})`, 'shift');
    add(endMin + commute + rules.postShiftBufferMin, Math.max(endMin + commute + rules.postShiftBufferMin, rules.postNightRecoveryUntil), 'Recovery sleep after night', 'sleep');
  }
  if (today) {
    const h = today.shift.hours;
    const commute = commuteFor(rules, today.shift.site);
    const s = h.start - commute - rules.preShiftBufferMin;
    const e = (h.overnight ? 1440 : h.end) + (h.overnight ? 0 : commute + rules.postShiftBufferMin);
    add(Math.max(0, s), Math.min(1440, e), today.shift.label, 'shift');
    if (!h.overnight) {
      // sleep before next day: if tomorrow is an early shift, lights out earlier
    }
  }
  // sleep window (free days / before day shifts)
  const tomorrow = myDay(state, addDays(date, 1));
  let lightsOut = rules.sleepStart;
  if (tomorrow.today && !tomorrow.today.shift.hours.overnight) {
    // only an early start pulls bedtime forward: wake − sleep lands before midnight (negative) → bed earlier tonight
    const wake = tomorrow.today.shift.hours.start - commuteFor(rules, tomorrow.today.shift.site) - rules.preShiftBufferMin;
    const bed = wake - Math.round(rules.sleepHours * 60);
    if (bed < 0) lightsOut = Math.min(rules.sleepStart, bed + 1440);
  }
  if (!(today && today.shift.hours.overnight)) add(lightsOut, 1440, 'Sleep', 'sleep');
  if (!overnightTail) add(0, rules.wakeMin, 'Sleep', 'sleep');

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
  for (const p of state.plan[keyOf(date)] || []) if (p.status === 'accepted' || p.status === 'done') add(p.start, p.end, p.title, 'plan');

  busy.sort((a, b) => a.start - b.start);
  return { busy, today, overnightTail, afterNight };
}

export function commuteFor(rules, site) {
  return rules.commute?.[site] ?? rules.commute?.default ?? 30;
}

export function freeSlots(busy, from, to, minLen) {
  const out = [];
  let cur = from;
  for (const b of busy) {
    if (b.end <= cur) continue;
    if (b.start > cur) { if (b.start - cur >= minLen) out.push({ start: cur, end: Math.min(b.start, to) }); }
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

function slotTag(ctx, slot) {
  const part = slot.start < 12 * 60 ? 'morning' : slot.start < 17 * 60 ? 'afternoon' : 'evening';
  return `${dayEnergy(ctx)}-${part}`;
}

// Weekly progress for goals from accepted plan blocks
export function weekProgress(state, weekStart) {
  const prog = {};
  for (let i = 0; i < 7; i++) {
    const k = keyOf(addDays(weekStart, i));
    for (const p of state.plan[k] || []) if (p.status === 'accepted' || p.status === 'done') prog[p.goalId] = (prog[p.goalId] || 0) + (p.end - p.start);
  }
  return prog;
}

export function weekStartOf(d) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; } // Sunday start

// Main: suggest blocks for [from, from+days). eventsByDay: key -> events[]
export function suggest(state, from, days, eventsByDay = {}, apps = {}, metaFn = null) {
  const rules = state.rules;
  const goals = [...state.goals].filter(g => g.hoursPerWeek > 0).sort((a, b) => a.priority - b.priority);
  const suggestions = {};
  const weekly = {}; // weekStart -> goalId -> minutes already (accepted + suggested)
  const bump = (ws, gid, min) => { (weekly[ws] ||= {}); weekly[ws][gid] = (weekly[ws][gid] || 0) + min; };
  const prog0 = {};
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i); const ws = keyOf(weekStartOf(d));
    if (!prog0[ws]) { prog0[ws] = weekProgress(state, weekStartOf(d)); for (const [g, m] of Object.entries(prog0[ws])) bump(ws, g, m); }
  }

  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const key = keyOf(date);
    const ws = keyOf(weekStartOf(date));
    const ctx = dayBusy(state, date, eventsByDay[key] || []);
    const energy = dayEnergy(ctx);
    const existing = (state.plan[key] || []).filter(p => p.status === 'accepted' || p.status === 'done');
    const rejectedToday = new Set((state.plan[key] || []).filter(p => p.status === 'rejected').map(p => `${p.goalId}|${p.start}`));
    const cap = ctx.today ? rules.maxStudyOnWorkday : rules.maxStudyOnFreeDay;
    let studyUsed = existing.filter(p => p.kind === 'study').reduce((a, p) => a + (p.end - p.start), 0);
    const dayList = [];
    const busy = [...ctx.busy];
    const daysLeftInWeek = 7 - date.getDay();
    const askedApps = new Set();

    // 1. Apps' own asks for this date (hub contract: status.asks[{date,title,minutes,slot}]) — they know their needs best
    for (const [appName, st] of Object.entries(apps || {})) {
      const appKey = String(st.app || appName).toLowerCase();
      for (const ask of (st.asks || []).filter(a => a.date === key)) {
        const minutes = Math.max(10, Math.min(180, Math.round(+ask.minutes || 30)));
        const gid = `app:${appKey}`;
        if (existing.some(p => p.goalId === gid)) { askedApps.add(appKey); continue; }
        const slots = freeSlots(busy, ctx.today?.shift.hours?.overnight ? Math.max(rules.earliestPlan, 10 * 60) : rules.earliestPlan, rules.latestPlan, Math.min(minutes, 20));
        if (!slots.length) continue;
        const dayShift = ctx.today && !ctx.today.shift.hours.overnight;
        const shiftStart = dayShift ? ctx.today.shift.hours.start - commuteFor(rules, ctx.today.shift.site) - rules.preShiftBufferMin : null;
        const wantBefore = ask.slot === 'before' && dayShift;
        const placeIn = (slot) => { const len = Math.min(minutes, slot.end - slot.start); const start = wantBefore && slot.end <= shiftStart ? Math.max(slot.start, slot.end - len) : preferredStart({ kind: 'study' }, slot, len); return { slot, len, start }; };
        let ordered = wantBefore ? [...slots.filter(x => x.end <= shiftStart).sort((x, y) => y.end - x.end), ...slots.filter(x => x.end > shiftStart)]
          : slots.map(x => ({ x, score: scoreSlot(state, { id: gid, kind: 'study', maxBlock: minutes }, x, ctx, energy, date) })).sort((a, b) => b.score - a.score).map(o => o.x);
        const choice = ordered.map(placeIn).find(c => !rejectedToday.has(`${gid}|${c.start}`) && !rejectedToday.has(`${gid}|${c.slot.start}`));
        if (!choice) continue;
        const { len, start } = choice;
        const meta = metaFn ? metaFn(appName, st) : { title: st.title || appName, color: st.color || '#9aa0b1' };
        const block = { id: `${key}-${gid}-${start}`, goalId: gid, app: appKey, title: ask.title || meta.title, kind: 'app', color: meta.color, start, end: start + len, status: 'suggested', date: key, reason: `${meta.title} asked for ${fmtDur(minutes)}${len < minutes ? ` (only ${fmtDur(len)} free)` : ''}${wantBefore ? (start + len <= shiftStart ? ' before your shift' : ' before your shift — no room, placed after') : ''}${st.summary ? ' · ' + String(st.summary).slice(0, 80) : ''}`, tag: slotTag(ctx, { start }) };
        dayList.push(block);
        busy.push({ start: block.start, end: block.end + 20, label: block.title, kind: 'plan' }); busy.sort((x, y) => x.start - y.start);
        askedApps.add(appKey);
        if (!g_isHabit(st)) studyUsed += len;
      }
    }

    for (const g of goals) {
      // an app that asked for time today replaces the goal named after it
      if ([...askedApps].some(a => g.name.toLowerCase().includes(a) || (g.app || '').toLowerCase() === a)) continue;
      const target = Math.round(g.hoursPerWeek * 60);
      const have = weekly[ws]?.[g.id] || 0;
      const deficit = target - have;
      if (deficit <= 0) continue;
      if (g.daily && existing.some(p => p.goalId === g.id)) continue;
      // How much today? spread deficit across remaining days, but at least minBlock
      let want = g.daily ? Math.min(g.maxBlock, Math.max(g.minBlock, Math.round(target / 7))) : Math.min(g.maxBlock, Math.max(g.minBlock, Math.round(deficit / Math.max(1, daysLeftInWeek))));
      // boosts: a near deadline allows a bigger block; an app saying how long it needs sets the size
      if (g.deadline) { const dl = (fromKey(g.deadline) - startOfDay(date)) / DAY_MS; if (dl > 0 && dl < 42) want = Math.min(g.maxBlock, Math.round(want * 1.3)); }
      const app = appHint(apps, g);
      if (app?.minutes) want = Math.max(g.minBlock, Math.min(g.maxBlock, app.minutes));
      // limits always win over boosts: tired days stay light, study has a daily ceiling
      if (energy === 'low' && g.kind === 'fitness') continue;
      if (energy === 'low' && g.kind === 'study') want = Math.min(want, 45);
      if (g.kind === 'study' && studyUsed + want > cap) want = cap - studyUsed;
      if (want < g.minBlock) continue;

      // on a night-shift day: sleep in, and keep the late afternoon/evening for rest before the shift
      const earliest = ctx.today?.shift.hours?.overnight ? Math.max(rules.earliestPlan, 10 * 60) : rules.earliestPlan;
      const slots = freeSlots(busy, earliest, rules.latestPlan, g.minBlock);
      if (!slots.length) continue;
      const scored = slots.map(s => ({ s, score: scoreSlot(state, g, s, ctx, energy, date) })).sort((a, b) => b.score - a.score);
      const pick = scored.find(x => !rejectedToday.has(`${g.id}|${x.s.start}`));
      if (!pick) continue;
      const len = Math.min(want, pick.s.end - pick.s.start);
      const start = preferredStart(g, pick.s, len);
      const block = {
        id: `${key}-${g.id}-${start}`, goalId: g.id, title: g.name, kind: g.kind, color: g.color,
        start, end: start + len, status: 'suggested', date: key,
        reason: reasonFor(g, ctx, energy, deficit, target, app, start),
        tag: slotTag(ctx, { start }),
      };
      dayList.push(block);
      busy.push({ start: block.start, end: block.end + 30, label: g.name, kind: 'plan' }); busy.sort((a, b) => a.start - b.start); // 30-min breathing room
      bump(ws, g.id, len);
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
  const len = s.end - s.start;
  score += Math.min(len, g.maxBlock) / 30;           // roomier slot is better
  const part = s.start < 12 * 60 ? 'morning' : s.start < 17 * 60 ? 'afternoon' : 'evening';
  if (g.kind === 'study' && part === 'morning' && energy !== 'low') score += 2;  // fresh brain
  if (g.kind === 'fitness' && part !== 'evening') score += 1;
  if (g.kind === 'social') { if (part === 'evening') score += 3; if ([4, 5].includes(date.getDay())) score += 1; if (part === 'morning') score -= 2; } // evenings, esp. Thu/Fri
  if (g.kind === 'habit') score += part === 'evening' ? 1 : 0;
  if (ctx.today && ctx.today.shift.type === 'N' && part === 'evening') score -= 5; // pre-night evening is for rest
  const pref = state.prefs?.[`${g.id}|${energy}-${part}`] || 0;
  score += pref;                                       // learned preference (negative after rejections)
  return score;
}

function preferredStart(g, slot, len) {
  // round to :00/:30, leave a gap at slot start if long
  let start = slot.start;
  if (slot.end - slot.start > len + 30 && g.kind !== 'habit') start += 15;
  start = Math.ceil(start / 15) * 15;
  if (start + len > slot.end) start = slot.end - len;
  return start;
}

function reasonFor(g, ctx, energy, deficit, target, app, start) {
  const bits = [];
  if (energy === 'high') bits.push('free day');
  else if (ctx.afterNight) bits.push('after your night – kept light and late');
  else if (ctx.today) bits.push(`around your ${ctx.today.shift.label.split(' · ')[0].toLowerCase()} shift`);
  bits.push(`${fmtDur(Math.max(0, deficit))} left of ${fmtDur(target)} this week`);
  if (app) bits.push(`${app.app}: ${app.due} due`);
  if (g.deadline) { const dl = Math.ceil((fromKey(g.deadline) - startOfDay(new Date())) / DAY_MS); if (dl > 0) bits.push(`${dl} days to deadline`); }
  return bits.join(' · ');
}

// Learned preference: reject -> down-weight that goal in that slot type
export function learn(state, block, delta) {
  const k = `${block.goalId}|${block.tag}`;
  const prefs = { ...(state.prefs || {}) };
  prefs[k] = Math.max(-6, Math.min(6, (prefs[k] || 0) + delta));
  return prefs;
}

