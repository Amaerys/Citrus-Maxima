// Home chores (room cleaning, laundry, …) planned around your shifts. Pure functions (no DOM).
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { myWindows } from './social.js';

export const PRESETS = [
  { title: 'Room cleaning', icon: '🧹', every: 7, mins: 60 },
  { title: 'Laundry', icon: '🧺', every: 4, mins: 120 },
  { title: 'Change bed sheets', icon: '🛏️', every: 14, mins: 20 },
  { title: 'Groceries', icon: '🛒', every: 7, mins: 60 },
  { title: 'Bathroom deep clean', icon: '🚿', every: 14, mins: 45 },
];
const uid = () => 'c' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const choreList = (s) => Object.values(s.chores || {}).sort((a, b) => a.title.localeCompare(b.title));
export function addChore(s, c) {
  const title = String(c.title || '').trim().slice(0, 50); if (!title) return s; const id = c.id || uid();
  const ch = { id, title, icon: String(c.icon || '🏠').slice(0, 4), every: Math.max(1, Math.min(365, Math.round(+c.every) || 7)), mins: Math.max(5, Math.min(480, Math.round(+c.mins) || 60)), lastDone: /^\d{4}-\d\d-\d\d$/.test(c.lastDone || '') ? c.lastDone : '', next: c.next && /^\d{4}-\d\d-\d\d$/.test(c.next.date || '') ? { date: c.next.date, start: Math.max(0, Math.min(1439, +c.next.start || 0)), eventId: c.next.eventId || '' } : null, at: Date.now() };
  return { ...s, chores: { ...(s.chores || {}), [id]: ch } };
}
export const updateChore = (s, id, patch) => s.chores?.[id] ? addChore(s, { ...s.chores[id], ...patch, id }) : s;
export function deleteChore(s, id) { const chores = { ...(s.chores || {}) }; delete chores[id]; return { ...s, chores, deleted: { ...(s.deleted || {}), [`chore:${id}`]: Date.now() } }; }
export const markDone = (s, id, date = keyOf(new Date())) => updateChore(s, id, { lastDone: date, next: null });
/** Day the chore is due (never done → today). */
export const dueDate = (c, now = new Date()) => c.lastDone ? addDays(fromKey(c.lastDone), c.every) : startOfDay(now);
export const daysLate = (c, now = new Date()) => Math.round((startOfDay(now) - dueDate(c, now)) / 864e5);

/**
 * Best days and times to do it, from the due date outwards. Every candidate must contain a free window of the chore's length;
 * days after a night shift only offer the afternoon; staying close to the due day matters most, then having a roomy window.
 * busyOf(date) → [[startMin,endMin]] calendar events to avoid.
 */
export function suggestSlots(s, c, { now = new Date(), busyOf = () => [], count = 3, horizon = 10 } = {}) {
  const today = startOfDay(now), due = dueDate(c, now), first = new Date(Math.max(today, addDays(due, -2))), out = [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < horizon; i++) {
    const date = addDays(first, i), isToday = +date === +today;
    for (const w of myWindows(s, date, busyOf(date))) {
      let a = Math.max(w[0], 9 * 60); if (isToday) a = Math.max(a, Math.ceil((nowMin + 30) / 15) * 15); const room = w[1] - a;
      if (room < c.mins + 15) continue;
      const late = Math.round((date - due) / 864e5), score = -Math.abs(late < 0 ? late * 0.7 : late * 1.4) + Math.min(room - c.mins, 240) / 120 + (a >= 9 * 60 && a <= 12 * 60 ? 0.6 : 0) + (date.getDay() === 5 ? -0.3 : 0);
      out.push({ date, key: keyOf(date), start: a, end: a + c.mins, room, late, score });
      break;   // one slot per day: the first window that fits
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, count).sort((x, y) => x.date - y.date || x.start - y.start);
}
/** What is due soon or overdue, for the Today card. */
export function dueSoon(s, now = new Date(), within = 1) {
  return choreList(s).map(c => ({ c, late: daysLate(c, now) })).filter(x => x.late >= -within || (x.c.next && x.c.next.date === keyOf(now))).sort((a, b) => b.late - a.late);
}
