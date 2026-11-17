// Sudachi (media logger) is live: it owns the library. Citrus shows what it publishes in hub/sudachi/status.json (raw, incl. extra)
// and stops writing media. Pure, no DOM.
import { keyOf } from './util.js';
/** Day-bound parts of a status (today's free friends, today's meals, journaled today, today's pick) only count on the day it was written. */
const fresh = (raw, now = new Date()) => !raw?.today?.date || raw.today.date === keyOf(now);
export const SITE = 'https://sudachi-library.github.io/Sudachi/';
export const live = (s) => !!(s?.apps?.sudachi);
const ex = (s) => { const x = s?.apps?.sudachi?.extra; return x && typeof x === 'object' ? x : {}; };
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const cnt = (w) => { w = w && typeof w === 'object' ? w : {}; return { eps: num(w.eps), films: num(w.films), books: num(w.books), chapters: num(w.chapters), pages: num(w.pages), games: num(w.games), hours: num(w.hours), played: num(w.played), finished: num(w.finished) }; };
export const week = (s) => cnt(ex(s).week);
export const month = (s) => cnt(ex(s).month);
export const now = (s) => arr(ex(s).now, 6).filter(m => m && m.title).map(m => ({ kind: str(m.kind, 10), title: str(m.title, 80), progress: num(m.progress), total: num(m.total) }));
export function pick(s) { const p = fresh(s?.apps?.sudachi) ? ex(s).pick : null; return p && p.title ? { kind: str(p.kind, 10), title: str(p.title, 80), why: str(p.why, 80), minutes: num(p.minutes), label: str(p.label, 40) } : null; }
export const goals = (s) => Object.entries(ex(s).goals || {}).filter(([, g]) => g && typeof g === 'object').map(([k, g]) => ({ kind: str(k, 12), done: num(g.done), target: num(g.target) })).filter(g => g.target > 0);
/** "3 eps · 1 film · 6h played" (empty when nothing this week). */
export function countLine(c) {
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [c.eps && pl(c.eps, 'ep'), c.films && pl(c.films, 'film'), c.books && pl(c.books, 'book'), c.chapters && pl(c.chapters, 'chapter'), c.pages && `${c.pages} pages`, c.played && `${c.played}h played`].filter(Boolean).join(' · ');
}
