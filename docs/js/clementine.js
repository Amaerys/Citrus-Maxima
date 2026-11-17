// Clementine (Social & People) is live: it owns contact cards, friends, free time, outings, polls, wishlist, treats and birthdays.
// Citrus shows what it publishes in hub/clementine/status.json (raw, incl. extra) and stops writing social data. Pure, no DOM.
import { keyOf } from './util.js';
/** Day-bound parts of a status (today's free friends, today's meals, journaled today, today's pick) only count on the day it was written. */
const fresh = (raw, now = new Date()) => !raw?.today?.date || raw.today.date === keyOf(now);
export const SITE = 'https://clementine-social.github.io/Clementine/';
export const live = (s) => !!(s?.apps?.clementine);
const raw = (s) => s?.apps?.clementine || {};
export const extra = (s) => { const x = raw(s).extra; return x && typeof x === 'object' ? x : {}; };
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
/** Birthdays and other dates from Clementine (label like "birthday" / "anniversary"), soonest first. */
export const dates = (s) => arr(extra(s).birthdays, 8).filter(b => b && b.name).map(b => ({ name: str(b.name, 60), label: str(b.label, 40) || (b.birthday ? 'birthday' : ''), birthday: !!b.birthday, inDays: Number.isFinite(+b.inDays) ? +b.inDays : 99, age: +b.age || 0, date: str(b.date, 10) })).sort((a, b) => a.inDays - b.inDays);
export const freeTonight = (s) => !fresh(s?.apps?.clementine) ? [] : arr(extra(s).freeTonight, 6).filter(x => x && x.name).map(x => ({ name: str(x.name, 40), from: str(x.from, 5), to: str(x.to, 5) }));
export const upcoming = (s) => arr(extra(s).upcoming, 5).filter(x => x && x.date).map(x => ({ date: str(x.date, 10), start: str(x.start, 5), what: str(x.what, 60) || 'Meet-up', who: Array.isArray(x.who) ? x.who.map(w => str(w, 40)).join(', ') : str(x.who, 120) }));
/** "Birthday today: Sara · Omar's anniversary" for the morning briefing. */
export function todayLine(s) {
  const t = dates(s).filter(d => d.inDays === 0); if (!t.length) return '';
  return t.map(d => d.birthday ? `${d.name}'s birthday${d.age ? ` (${d.age})` : ''}` : `${d.name}: ${d.label}`).join(' · ');
}
