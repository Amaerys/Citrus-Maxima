// Bergamot (Mind: journal, notes, tasks, habits) is live: it owns them; goals stay in Citrus Plan. Citrus shows what Bergamot
// publishes in hub/bergamot/status.json (raw, incl. extra) and stops writing tasks, habits, reflections, memos and day notes. Pure, no DOM.
import { keyOf } from './util.js';
/** Day-bound parts of a status (today's free friends, today's meals, journaled today, today's pick) only count on the day it was written. */
const fresh = (raw, now = new Date()) => !raw?.today?.date || raw.today.date === keyOf(now);
export const SITE = 'https://bergamot-mind.github.io/Bergamot/';
export const live = (s) => !!(s?.apps?.bergamot);
const ex = (s) => { const x = s?.apps?.bergamot?.extra; return x && typeof x === 'object' ? x : {}; };
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);
export function tasks(s) { const t = fresh(s?.apps?.bergamot) ? ex(s).tasks || {} : {}; return { overdue: num(t.overdue), today: num(t.today), top: arr(t.top, 6).filter(x => x && x.title).map(x => ({ title: str(x.title, 80), due: str(x.due, 10), pri: num(x.pri) })) }; }
export function habits(s) { const x = fresh(s?.apps?.bergamot) ? ex(s).habits || {} : {}; return { due: num(x.due), done: num(x.done), pending: arr(x.pending, 8).map(p => (typeof p === 'string' ? p : str(p?.name, 40))).filter(Boolean) }; }
export const journaledToday = (s) => fresh(s?.apps?.bergamot) && !!ex(s).journaledToday;
export function mood(s) { const m = ex(s).mood || {}; return { today: m.today == null || !fresh(s?.apps?.bergamot) ? null : num(m.today), week: m.week == null ? null : num(m.week) }; }
export const streaks = (s) => arr(ex(s).streaks, 3).filter(x => x && x.name).map(x => ({ name: str(x.name, 40), days: num(x.days) }));
/** What Bergamot has linked to one of your aims: {tasks, open, done, doneWeek, habits, entries, notes} or null. */
export function goalLink(s, aimId) { const g = ex(s).goalLinks?.[aimId]; return g && typeof g === 'object' ? { tasks: num(g.tasks), open: num(g.open), done: num(g.done), doneWeek: num(g.doneWeek), habits: num(g.habits), entries: num(g.entries), notes: num(g.notes) } : null; }
/** "3 tasks today (1 overdue): Call bank, …" for the morning briefing. */
export function todayLine(s) {
  const t = tasks(s); if (!t.today && !t.overdue) return '';
  return `${t.today} task${t.today === 1 ? '' : 's'} today${t.overdue ? ` (${t.overdue} overdue)` : ''}${t.top.length ? `: ${t.top.slice(0, 3).map(x => x.title).join(', ')}` : ''}`;
}
