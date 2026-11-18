// Your choices for how Citrus looks and behaves — synced with your state (settings.custom), unlike the per-device interface.
// Pure: defaults, sanitising and small getters. The Customise sheet in Settings edits it.
export const TABS = [['today', 'Today'], ['rota', 'Work'], ['plan', 'Plan'], ['mind', 'Mind'], ['social', 'Social'], ['apps', 'Apps']];
export const WORK_SEGS = [['calendar', 'Calendar'], ['team', 'People'], ['nurses', 'Nurses'], ['home', 'Home'], ['career', 'Career']];
export const TODAY_CARDS = ['Schedule update', 'From your apps', 'Across your apps', 'Briefing', 'Tonight', 'Shift board', 'Nurses', 'Contract dates', 'Plan', 'Home', 'Study', 'Mind', 'Media', 'On call'];
export const BRIEF_LINES = [['shift', 'Your shift'], ['team', 'Who you work with'], ['nurses', 'Nurses with you'], ['home', 'Chores due'], ['tasks', 'Tasks due'], ['birthdays', 'Birthdays'], ['hours', 'Week hours vs 48h'], ['contract', 'Contract dates']];
export const DEFAULTS = {
  start: 'today',                 // tab Citrus opens on
  tabs: { hidden: [], order: TABS.map(t => t[0]) },
  workSegs: { hidden: [] },
  today: { hidden: [], pinned: [], top: 5 },   // pinned cards always open at the top; `top` = how many ranked cards stay open
  brief: { off: [] },
  social: { days: 0, wake: 8 * 60, late: 24 * 60, minMeet: 90 },   // days 0 = fit the screen
};
const arr = (v, ok) => Array.isArray(v) ? [...new Set(v.filter(x => ok.includes(x)))] : [];
const num = (v, lo, hi, d) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : d;
const ids = (l) => l.map(x => Array.isArray(x) ? x[0] : x);
/** Clean, complete settings — never trust what came from storage or another device. */
export function custom(s) {
  const c = s?.settings?.custom || {}, t = c.tabs || {};
  const order = [...arr(t.order, ids(TABS)), ...ids(TABS).filter(x => !(t.order || []).includes(x))];
  const hidden = arr(t.hidden, ids(TABS)).filter(x => x !== 'today');   // Today can't be hidden: it's home
  const sc = c.social || {};
  const out = {
    start: ids(TABS).includes(c.start) && !hidden.includes(c.start) ? c.start : 'today',
    tabs: { hidden, order },
    workSegs: { hidden: arr(c.workSegs?.hidden, ids(WORK_SEGS)).slice(0, WORK_SEGS.length - 1) },   // at least one segment stays
    today: { hidden: arr(c.today?.hidden, TODAY_CARDS), pinned: arr(c.today?.pinned, TODAY_CARDS), top: num(c.today?.top, 1, 12, 5) },
    brief: { off: arr(c.brief?.off, ids(BRIEF_LINES)) },
    social: { days: [0, 7, 10, 14, 21].includes(+sc.days) ? +sc.days : 0, wake: num(sc.wake, 4 * 60, 14 * 60, 480), late: num(sc.late, 18 * 60, 26 * 60, 1440), minMeet: num(sc.minMeet, 30, 360, 90) },
  };
  if (out.social.late - out.social.wake < 4 * 60) out.social.late = Math.min(26 * 60, out.social.wake + 4 * 60);
  return out;
}
/** Change one part: returns the new state (patch is merged one level deep). */
export function setCustom(s, part, patch) { const cur = custom(s); return { ...s, settings: { ...s.settings, custom: { ...cur, [part]: typeof patch === 'object' && !Array.isArray(patch) ? { ...cur[part], ...patch } : patch } } }; }
export const toggleIn = (list, id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
export function move(list, id, dir) { const i = list.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return list; const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; return l; }
export const visibleTabs = (s) => { const c = custom(s); return c.tabs.order.filter(t => !c.tabs.hidden.includes(t)); };
export const visibleWorkSegs = (s) => { const c = custom(s); return WORK_SEGS.filter(([id]) => !c.workSegs.hidden.includes(id)); };
export const briefOn = (s, id) => !custom(s).brief.off.includes(id);
