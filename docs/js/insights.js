// Across your apps: the hub's own analysis (Citrus is the connector; every number comes from an app's status.json, kept day by day
// in state.metricLog by mind.recordMetrics). Pure, no DOM. Two things:
//  1. week(): this week per app, each number against its goal, plus what needs you.
//  2. shiftEffects(): how a number moves with your shifts (after a night / night / day / off), from the daily history.
import { keyOf, fromKey, addDays } from './util.js';

const TITLE = { mandarin: 'Work', clementine: 'People', calamansi: 'Home', bergamot: 'Mind', sudachi: 'Media', orange: 'Fitness', yuzu: 'Flashcards', mephisto: 'German', buffer: 'Blood gases', sinus: 'ECG', kumquat: 'Biostatistics', embergine: 'Arrest sim', bassiet: 'Step 1' };
const LOWER_BETTER = /overdue|due|expiring|open/i;   // a goal of 0 on these means "none left" (cards due, chores overdue, food to use up)

/** Latest value of every series, grouped by app: [{app, area, rows:[{key,label,v,goal,unit,ok,pct,date}]}]. Stale (> 8 days) series are left out. */
export function week(s, now = new Date()) {
  const log = s?.metricLog || {}, cut = keyOf(addDays(now, -8)), byApp = {};
  for (const [series, cells] of Object.entries(log)) {
    const i = series.indexOf(':'); if (i < 1) continue;
    const app = series.slice(0, i), key = series.slice(i + 1), d = Object.keys(cells || {}).sort().pop(); if (!d || d < cut) continue;
    const c = cells[d]; if (!c || !Number.isFinite(+c.v)) continue;
    const goal = Number.isFinite(+c.goal) ? +c.goal : 0, v = +c.v, lower = LOWER_BETTER.test(key) || (goal === 0 && LOWER_BETTER.test(c.label || ''));
    const hasGoal = goal > 0 || lower;
    const ok = !hasGoal ? null : lower ? v <= goal : v >= goal;
    const pct = goal > 0 && !lower ? Math.max(0, Math.min(100, Math.round((v / goal) * 100))) : null;
    (byApp[app] ||= []).push({ key, label: String(c.label || key).slice(0, 40), v, goal, unit: String(c.unit || '').slice(0, 12), ok, pct, date: d, lower });
  }
  return Object.entries(byApp).map(([app, rows]) => ({ app, area: TITLE[app] || app, rows: rows.sort((a, b) => (a.ok === false ? 0 : 1) - (b.ok === false ? 0 : 1) || a.label.localeCompare(b.label)).slice(0, 4) }))
    .sort((a, b) => a.area.localeCompare(b.area));
}
/** What is behind: rows below their goal, worst first (by how far, as a share of the goal). */
export function behind(s, now = new Date()) {
  return week(s, now).flatMap(g => g.rows.filter(r => r.ok === false).map(r => ({ ...r, app: g.app, area: g.area, gap: r.lower ? r.v - r.goal : r.goal ? (r.goal - r.v) / r.goal : 1 })))
    .sort((a, b) => (b.lower ? 0.5 : b.gap) - (a.lower ? 0.5 : a.gap)).slice(0, 5);
}

/**
 * kindOf(dateKey) → 'postnight' | 'night' | 'day' | 'off' | '' (Citrus's own view of your shifts, swaps included).
 * For every daily series with enough history, the average on each kind of day; returned only where the difference is worth saying:
 * at least 3 days of each of two kinds and a gap of 15 % of the overall average (or 0.5 on a 1–5 scale).
 */
export function shiftEffects(s, kindOf, now = new Date(), days = 60) {
  const log = s?.metricLog || {}, from = keyOf(addDays(now, -days)), out = [];
  for (const [series, cells] of Object.entries(log)) {
    const by = {};
    for (const [d, c] of Object.entries(cells || {})) {
      if (d < from || !Number.isFinite(+c?.v)) continue;
      const k = kindOf(d); if (!k) continue;
      (by[k] ||= []).push(+c.v);
    }
    const kinds = Object.entries(by).filter(([, v]) => v.length >= 3).map(([k, v]) => ({ k, n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }));
    if (kinds.length < 2) continue;
    const all = kinds.reduce((a, x) => a + x.avg * x.n, 0) / kinds.reduce((a, x) => a + x.n, 0);
    kinds.sort((a, b) => b.avg - a.avg);
    const hi = kinds[0], lo = kinds[kinds.length - 1], gap = hi.avg - lo.avg, last = cells[Object.keys(cells).sort().pop()] || {};
    const small = /\/5|mood|energy|rating/i.test(`${last.unit} ${last.label} ${series}`);
    if (small ? gap < 0.5 : !all || gap / Math.abs(all) < 0.15) continue;
    const i = series.indexOf(':');
    out.push({ series, app: series.slice(0, i), area: TITLE[series.slice(0, i)] || series.slice(0, i), label: String(last.label || series.slice(i + 1)), unit: String(last.unit || ''), hi, lo, strength: small ? gap / 4 : gap / Math.abs(all) });
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 4);
}
export const KIND_LABEL = { postnight: 'after a night', night: 'on nights', day: 'on day shifts', off: 'on days off' };
/** "Mood: 3.1 after a night vs 4.2 on days off". */
export function effectLine(e) {
  const f = (x) => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
  return `${e.label}: ${f(e.lo.avg)}${e.unit && e.unit !== '/5' ? ' ' + e.unit : ''} ${KIND_LABEL[e.lo.k]} vs ${f(e.hi.avg)} ${KIND_LABEL[e.hi.k]}`;
}

// ───────── Hand-over: data each app now owns (store.HANDOVER), which Citrus stops keeping once you finish the hand-over (Settings)
import { HANDOVER } from './store.js';
export { HANDOVER };
/** How much Citrus still holds for each live app: [{app, keys, count, bytes}] (only apps that report and haven't been handed over). */
export function handoverPending(s) {
  const done = s?.settings?.handedOver || {}, out = [];
  for (const [app, keys] of Object.entries(HANDOVER)) {
    if (!s?.apps?.[app] || done[app]) continue;
    let count = 0, bytes = 0;
    for (const k of keys) { const v = s[k]; if (v && typeof v === 'object') { count += Object.keys(v).length; bytes += JSON.stringify(v).length; } }
    out.push({ app, keys, count, bytes });
  }
  return out;
}
/** The handed-over part of the state, for the safety copy written to Drive before Citrus lets go of it. */
export function handoverPart(s, apps) { const part = {}; for (const a of apps) for (const k of HANDOVER[a] || []) if (s?.[k] !== undefined) part[k] = s[k]; return part; }
export { fromKey };
