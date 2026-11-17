// Calamansi (Home, Kitchen & daily life) is live: it owns chores, recipes, meals, the fridge, shopping, bills and the car.
// Citrus shows what it publishes in hub/calamansi/status.json (raw, incl. extra) and stops writing chores. Pure, no DOM.
import { keyOf } from './util.js';
/** Day-bound parts of a status (today's free friends, today's meals, journaled today, today's pick) only count on the day it was written. */
const fresh = (raw, now = new Date()) => !raw?.today?.date || raw.today.date === keyOf(now);
export const SITE = 'https://calamansi-food.github.io/Calamansi/';
export const live = (s) => !!(s?.apps?.calamansi);
const ex = (s) => { const x = s?.apps?.calamansi?.extra; return x && typeof x === 'object' ? x : {}; };
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
export const chores = (s) => arr(ex(s).chores, 6).filter(c => c && c.title).map(c => ({ title: str(c.title, 60), icon: str(c.icon, 4), late: +c.late || 0, status: str(c.status, 60) }));
const meal = (m) => ({ label: str(m.label, 30), title: str(m.title, 60), icon: str(m.icon, 4), done: !!m.done, packed: !!m.packed });
export const meals = (s) => { const m = fresh(s?.apps?.calamansi) ? ex(s).meals || {} : {}; return { today: arr(m.today, 6).filter(x => x && x.title).map(meal), tomorrow: arr(m.tomorrow, 6).filter(x => x && x.title).map(meal), batch: m.batch && m.batch.title ? { date: str(m.batch.date, 10), title: str(m.batch.title, 60), portions: +m.batch.portions || 0 } : null }; };
export const shopping = (s) => { const x = ex(s).shopping || {}; return { open: +x.open || 0, items: arr(x.items, 8).map(i => str(i, 40)).filter(Boolean) }; };
export const fridge = (s) => arr(ex(s).fridge, 5).filter(f => f && f.name).map(f => ({ name: str(f.name, 40), days: Number.isFinite(+f.days) ? +f.days : null }));
export const bills = (s) => arr(ex(s).bills, 5).filter(b => b && b.title).map(b => ({ title: str(b.title, 60), due: str(b.due, 10), amount: +b.amount || 0 }));
/** "Due at home: Laundry, Room cleaning" for the morning briefing (overdue or due today only). */
export function todayLine(s) {
  const due = chores(s).filter(c => c.late > 0 || /due (now|today)|overdue/.test(c.status)).map(c => c.title);
  return due.length ? `Due at home: ${due.slice(0, 3).join(', ')}` : '';
}
