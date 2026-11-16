// Mandarin (Scheduler & Work) is live: it owns rotas, corrections, nurses, leave and career. Citrus reads what it publishes in
// hub/mandarin (status.json + shifts.json) and keeps only the cockpit, Plan, Home, Social and the hub. Pure, no DOM.
import { keyOf } from './util.js';
export const SITE = 'https://mandarin-work.github.io/Mandarin/';
/** Mandarin counts as live once its status.json has reached Citrus. */
export const live = (s) => !!(s?.apps?.mandarin);
export const shifts = (s) => s?.apps?.mandarin?._shifts || null;
/** Your corrections (swaps, covers, leave) now live in Mandarin: inside the window shifts.json covers, its corrected days replace Citrus's
 *  own old corrections, and an uncorrected day there clears any stale one here. Outside the window Citrus's history stays. */
const memo = new WeakMap();
export function withMandarin(s) {
  const sh = shifts(s); if (!sh?.days?.length) return s;
  if (memo.has(s)) return memo.get(s);
  const swaps = { ...(s.swaps || {}) };
  for (const d of sh.days) { if (!d?.date) continue; if (d.corrected) swaps[d.date] = { code: d.kind === 'work' || d.kind === 'leave' ? d.code || '' : '', note: 'from Mandarin', at: 0, mandarin: true }; else delete swaps[d.date]; }
  const out = { ...s, swaps }; memo.set(s, out); return out;
}
/** Your next days as Mandarin sees them (for the Work panel). */
export function nextDays(s, now = new Date(), n = 7) {
  const k = keyOf(now); return (shifts(s)?.days || []).filter(d => d.date >= k).slice(0, n);
}
/** Mandarin's own deep link for one of its screens (from its status actions), or its home page. */
export function link(s, id) { const a = (s?.apps?.mandarin?.actions || []).find(x => x.id === id); return a?.url || SITE; }
