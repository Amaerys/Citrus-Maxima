// Home chores (room cleaning, laundry, …) planned around your shifts. Pure functions (no DOM).
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { meState } from './social.js';
import { myDay } from './model.js';

export const PRESETS = [
  { title: 'Room cleaning', icon: '🧹', every: 7, mins: 60 },
  { title: 'Laundry', icon: '🧺', every: 4, mins: 120 },
  { title: 'Change bed sheets', icon: '🛏️', every: 14, mins: 20 },
  { title: 'Groceries', icon: '🛒', every: 7, mins: 60 },
  { title: 'Bathroom deep clean', icon: '🚿', every: 14, mins: 45 },
];
export const LIMITS = { every: [1, 365], mins: [5, 480], title: 50 };
const uid = () => 'c' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const isKey = (v) => /^\d{4}-\d\d-\d\d$/.test(v || '');
/** First user-perceived character: slice() would split ZWJ emoji such as 🧑‍🍳 into broken halves. */
export function firstGrapheme(v, fallback = '🏠') {
  const t = String(v || '').trim(); if (!t) return fallback;
  try { if (typeof Intl !== 'undefined' && Intl.Segmenter) { for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) return g.segment.slice(0, 16); } } catch {}
  return Array.from(t).slice(0, 2).join('');
}
/** Problems with what was typed in the edit sheet (empty → fine). Clamping silently (0 → 7) hid mistakes. */
export function validate(c, s = null, now = new Date()) {
  const out = {}, t = String(c.title || '').trim(), ev = Number(c.every), mn = Number(c.mins);
  if (!t) out.title = 'Give it a name';
  else if (s && choreList(s).some(x => x.id !== c.id && x.title.toLowerCase() === t.toLowerCase())) out.dup = `You already have “${t}”`;
  if (!Number.isFinite(ev) || ev < LIMITS.every[0] || ev > LIMITS.every[1] || ev !== Math.round(ev)) out.every = 'Every 1–365 days';
  if (!Number.isFinite(mn) || mn < LIMITS.mins[0] || mn > LIMITS.mins[1]) out.mins = '5–480 minutes';
  if (c.lastDone && isKey(c.lastDone) && c.lastDone > keyOf(now)) out.lastDone = 'Can’t be in the future';
  return out;
}
export function addChore(s, c, now = new Date()) {
  const title = String(c.title || '').trim().slice(0, LIMITS.title); if (!title) return s; const id = c.id || uid();
  const n = c.next, today = keyOf(now);
  const ch = { id, title, icon: firstGrapheme(c.icon), every: Math.max(1, Math.min(365, Math.round(+c.every) || 7)), mins: Math.max(5, Math.min(480, Math.round(+c.mins) || 60)),
    lastDone: isKey(c.lastDone) ? (c.lastDone > today ? today : c.lastDone) : '',   // a future "last done" would push the due date out of sight
    // next keeps what is needed to move or remove the calendar copy later: the Google event id, or the outbox key it was queued under
    next: n && isKey(n.date) ? { date: n.date, start: Math.max(0, Math.min(1439, +n.start || 0)), mins: +n.mins || 0, eventId: String(n.eventId || ''), calendarId: String(n.calendarId || ''), key: String(n.key || '') } : null, at: c.at || Date.now() };
  return { ...s, chores: { ...(s.chores || {}), [id]: ch } };
}
export const updateChore = (s, id, patch) => s.chores?.[id] ? addChore(s, { ...s.chores[id], ...patch, id }) : s;
export function deleteChore(s, id) { const chores = { ...(s.chores || {}) }; delete chores[id]; return { ...s, chores, deleted: { ...(s.deleted || {}), [`chore:${id}`]: Date.now() } }; }
export const markDone = (s, id, date = keyOf(new Date())) => updateChore(s, id, { lastDone: date, next: null });
/** Day the chore is due (never done → today). */
export const dueDate = (c, now = new Date()) => c.lastDone ? addDays(fromKey(c.lastDone), c.every) : startOfDay(now);
export const daysLate = (c, now = new Date()) => Math.round((startOfDay(now) - dueDate(c, now)) / 864e5);
const planned = (c, now) => !!(c.next && c.next.date >= keyOf(now));
/** Most urgent first: overdue (latest first), then planned (soonest first), then by due date — a title sort put bed sheets above overdue laundry. */
export const choreList = (s, now = new Date()) => Object.values(s.chores || {}).map(c => ({ c, late: daysLate(c, now), p: planned(c, now) }))
  .sort((a, b) => ((b.late > 0) - (a.late > 0)) || (a.late > 0 && b.late > 0 ? b.late - a.late : 0) || (b.p - a.p) || (a.p && b.p ? (a.c.next.date + a.c.next.start / 1e4).localeCompare(b.c.next.date + b.c.next.start / 1e4) : 0) || (b.late - a.late) || a.c.title.localeCompare(b.c.title)).map(x => x.c);

/** "When did you last do it?" answers for a new chore → a lastDone key (or '' = still unknown). */
export const lastDoneFrom = (answer, c, now = new Date()) => answer === 'today' ? keyOf(now) : answer === 'few' ? keyOf(addDays(now, -Math.min(3, Math.max(1, Math.floor(c.every / 2))))) : answer === 'week' ? keyOf(addDays(now, -Math.max(7, c.every))) : '';

const LONG_SHIFT = 600;   // after 10h+ on shift, only short chores are worth suggesting that evening
const minus = (wins, busy) => { for (const [bs, be] of busy) wins = wins.flatMap(([a, b]) => be <= a || bs >= b ? [[a, b]] : [[a, Math.min(b, bs)], [Math.max(a, be), b]]).filter(w => w[1] - w[0] >= 30); return wins; };
/** Your rota code that day ("D1"), for "after D1" hints. */
const codeOn = (s, date) => { try { return myDay(s, date).info.mine?.code || ''; } catch { return ''; } };

/**
 * Best days and times to do it, from the due date outwards. Every candidate must contain a free window of the chore's length;
 * days after a night shift only offer the afternoon; staying close to the due day matters most, then having a roomy window.
 * Days with no rota (next month not loaded yet) still get a daytime slot, flagged `unknown`, instead of silently vanishing.
 * busyOf(date) → [[startMin,endMin]] calendar events to avoid.
 */
export function suggestSlots(s, c, { now = new Date(), busyOf = () => [], count = 3, horizon = 10 } = {}) {
  const today = startOfDay(now), due = dueDate(c, now), first = new Date(Math.max(today, addDays(due, -2))), out = [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < horizon; i++) {
    const date = addDays(first, i), isToday = +date === +today, busy = busyOf(date);
    const st = meState(s, date, busy), unknown = st.status === 'unknown';
    const wins = unknown ? minus([[9 * 60, 21 * 60]], busy) : st.windows, shiftLen = st.status === 'work' ? st.end - st.start : 0;
    for (const w of wins) {
      let a = Math.max(w[0], 9 * 60); if (isToday) a = Math.max(a, Math.ceil((nowMin + 30) / 15) * 15); const room = w[1] - a;
      if (room < c.mins + 15) continue;
      const afterShift = st.status === 'work' && a >= st.end, beforeShift = st.status === 'work' && a + c.mins <= st.start;
      if (afterShift && shiftLen >= LONG_SHIFT && c.mins > 30) continue;   // a 2h chore at 20:45 after a 12h day is poor advice
      const late = Math.round((date - due) / 864e5);
      const score = -Math.abs(late < 0 ? late * 0.7 : late * 1.4) + Math.min(room - c.mins, 240) / 120 + (a >= 9 * 60 && a <= 12 * 60 ? 0.6 : 0) + (date.getDay() === 5 ? -0.3 : 0)
        + (afterShift ? -0.8 - Math.max(0, shiftLen - 480) / 240 : 0) + (unknown ? -0.8 : 0);
      const code = st.status === 'work' ? codeOn(s, date) || st.type : '';
      out.push({ date, key: keyOf(date), start: a, end: a + c.mins, room, until: w[1], late, score, unknown, off: st.status === 'off' || st.status === 'leave', after: afterShift ? code : '', before: beforeShift ? code : '' });
      break;   // one slot per day: the first window that fits
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, count).sort((x, y) => x.date - y.date || x.start - y.start);
}
/** Days in the next `days` that have no rota for you (for an honest "load December" hint). */
export function rotaGaps(s, { now = new Date(), days = 10 } = {}) {
  const out = []; for (let i = 0; i < days; i++) { const d = addDays(startOfDay(now), i); if (meState(s, d).status === 'unknown') out.push(d); } return out;
}
/** What is due soon or overdue, for the Today card. A chore added in the last day with no "last done" yet waits on Home instead of flooding Today. */
export function dueSoon(s, now = new Date(), within = 1) {
  return choreList(s, now).filter(c => c.lastDone || c.next || +now - (c.at || 0) > 864e5).map(c => ({ c, late: daysLate(c, now) }))
    .filter(x => x.late >= -within || (x.c.next && x.c.next.date === keyOf(now))).sort((a, b) => b.late - a.late);
}
