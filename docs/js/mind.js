// Mind: tasks, habits, objectives, reflections, resolutions, and what other apps send in — the rules and the numbers.
// Pure functions over the state object (no DOM, no store), so they are easy to test and the screens stay thin.
// Every record carries `at` (last edit); deleting leaves a tombstone in state.deleted — that is what lets devices merge safely.
import { keyOf, fromKey, addDays, startOfDay, uid } from './util.js';
import { weekStartOf, weekProgress } from './planner.js';
import { refOf } from './inbound.js';

const rec = (o) => Object.values(o || {});
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const tomb = (s, key) => ({ ...(s.deleted || {}), [key]: Date.now() });
const DAY = 86400000;

export const AREAS = [
  { id: 'health', name: 'Health', color: '#5fd38d', emoji: '💪' },
  { id: 'career', name: 'Career', color: '#4fb3ff', emoji: '🩺' },
  { id: 'learning', name: 'Learning', color: '#ffc857', emoji: '📚' },
  { id: 'money', name: 'Money', color: '#7ffaee', emoji: '💰' },
  { id: 'people', name: 'People', color: '#d58cff', emoji: '🤝' },
  { id: 'fun', name: 'Fun', color: '#ff8a3d', emoji: '🎮' },
  { id: 'calm', name: 'Calm', color: '#8e9bff', emoji: '🌿' },
  { id: 'home', name: 'Home', color: '#ff8fa3', emoji: '🏠' },
];
export const areaOf = (id) => AREAS.find(a => a.id === id) || null;
export const PRI = ['', 'High', 'Urgent'];

// ════════════════════════════════════════ capture: "Call bank tomorrow 20m !" → a task
export function parseCapture(raw, now = new Date()) {
  let t = ` ${String(raw || '').trim()} `;
  let due = '', est = 0, pri = 0;
  const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], ' '); } };
  const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  take(/\s(!{1,2})(?=\s)/, m => { pri = m[1].length; });
  take(/\s~?(\d+(?:\.\d+)?)\s?(h|hr|hrs|hours?|m|min|mins|minutes?)(?=\s)/i, m => { est = Math.round(parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)); });
  take(/\s(?:due |by |on )?(today|tod)(?=\s)/i, () => { due = keyOf(now); });
  take(/\s(?:due |by |on )?(tomorrow|tmrw)(?=\s)/i, () => { due = keyOf(addDays(now, 1)); });
  take(/\snext week(?=\s)/i, () => { due = keyOf(addDays(now, 7)); });
  take(/\sin (\d{1,3}) days?(?=\s)/i, m => { due = keyOf(addDays(now, +m[1])); });
  take(/\s(?:due |by |on |next )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?=\s)/i, m => {
    const idx = DAYS[m[1].slice(0, 3).toLowerCase()]; due = keyOf(addDays(now, (idx - now.getDay() + 7) % 7 || 7));
  });
  take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, m => {   // dd/mm[/yyyy], the way you write dates
    const d = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) { t = t.replace(/^/, ' ' + m[0]); return; }
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    let c = new Date(y, mo - 1, d); if (!m[3] && c < startOfDay(now)) c = new Date(y + 1, mo - 1, d);
    if (c.getMonth() === mo - 1) due = keyOf(c);
  });
  let title = t.replace(/\s+/g, ' ').trim();
  if (!title) title = String(raw || '').trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title, due, est, pri };
}

// ════════════════════════════════════════ tasks
export function addTask(s, f) {
  const title = String(f.title || '').trim().slice(0, 140); if (!title) return s;
  const id = f.id || uid(), now = Date.now();
  const t = { id, title, done: false, doneAt: 0, due: f.due || '', est: Math.max(0, Math.min(480, +f.est || 0)), pri: Math.max(0, Math.min(2, +f.pri || 0)), aimId: f.aimId || '', area: f.area || '', notes: String(f.notes || '').slice(0, 600), src: f.src || '', srcApp: f.srcApp || '', createdAt: now, at: now };
  return { ...s, tasks: { ...s.tasks, [id]: t } };
}
export function updateTask(s, id, patch) { const t = s.tasks?.[id]; return t ? { ...s, tasks: { ...s.tasks, [id]: { ...t, ...patch, at: Date.now() } } } : s; }
export const setTaskDone = (s, id, done) => updateTask(s, id, { done: !!done, doneAt: done ? Date.now() : 0 });
export function deleteTask(s, id) { const tasks = { ...s.tasks }; delete tasks[id]; return { ...s, tasks, deleted: tomb(s, `task:${id}`) }; }
export const taskArea = (s, t) => t.area || s.aims?.[t.aimId]?.area || '';

export function taskBuckets(s, now = new Date()) {
  const today = keyOf(now), weekEnd = keyOf(addDays(now, 7));
  const all = rec(s.tasks), open = all.filter(t => !t.done);
  const order = (a, b) => (b.pri || 0) - (a.pri || 0) || (a.due || '9').localeCompare(b.due || '9') || (a.createdAt || 0) - (b.createdAt || 0);
  return {
    overdue: open.filter(t => t.due && t.due < today).sort(order),
    today: open.filter(t => t.due === today).sort(order),
    soon: open.filter(t => t.due > today && t.due <= weekEnd).sort(order),
    later: open.filter(t => t.due > weekEnd).sort(order),
    someday: open.filter(t => !t.due).sort(order),
    done: all.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
  };
}
/** The few things worth doing today: overdue and due-today first, then high-priority undated. */
export function focusTasks(s, now = new Date(), n = 3) {
  const b = taskBuckets(s, now);
  return [...b.overdue, ...b.today, ...b.someday.filter(t => t.pri > 0), ...b.soon].slice(0, n);
}
/** The accepted/done planner block that schedules this task, if any. */
export function taskBlock(s, t) {
  for (const [date, list] of Object.entries(s.plan || {})) for (const p of list || []) if (p.goalId === `app:task-${t.id}` && (p.status === 'accepted' || p.status === 'done')) return { ...p, date };
  return null;
}

// ════════════════════════════════════════ habits
export const activeHabits = (s) => rec(s.habits).filter(h => !h.archived).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export const habitArea = (s, h) => h.area || s.aims?.[h.aimId]?.area || '';
export function habitFreqLabel(h) {
  const f = h.freq || { type: 'daily' };
  if (f.type === 'days' && new Set(f.days || []).size === 7) return 'Every day';
  if (f.type === 'days') return (f.days || []).length === 5 && ![0, 6].some(d => f.days.includes(d)) ? 'Weekdays' : (f.days || []).map(d => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join(' ');
  if (f.type === 'weekly') return `${f.n || 3}× a week`;
  return 'Every day';
}
export function addHabit(s, f) {
  const name = String(f.name || '').trim().slice(0, 60); if (!name) return s;
  const id = f.id || uid(), now = Date.now();
  const h = { id, name, emoji: String(f.emoji || '').slice(0, 4), freq: f.freq || { type: 'daily' }, aimId: f.aimId || '', area: f.area || '', link: f.link || '', threshold: +f.threshold || 0, minutes: Math.max(0, Math.min(180, +f.minutes || 0)), archived: false, createdAt: f.createdAt || now, at: now };
  return { ...s, habits: { ...s.habits, [id]: h } };
}
export function updateHabit(s, id, patch) { const h = s.habits?.[id]; return h ? { ...s, habits: { ...s.habits, [id]: { ...h, ...patch, at: Date.now() } } } : s; }
export function deleteHabit(s, id) { const habits = { ...s.habits }, habitLog = { ...s.habitLog }; delete habits[id]; delete habitLog[id]; return { ...s, habits, habitLog, deleted: tomb(s, `habit:${id}`) }; }
export function logHabit(s, id, key, v) { return { ...s, habitLog: { ...s.habitLog, [id]: { ...(s.habitLog?.[id] || {}), [key]: { v: v ? 1 : 0, at: Date.now() } } } }; }

export function habitDue(h, date) { const f = h.freq || {}; return f.type === 'days' ? (f.days || []).includes(date.getDay()) : true; }
/** Latest value Citrus has for an app metric on a day (the apps report today's number; Citrus keeps the history). */
export const metricCell = (s, series, key) => s.metricLog?.[series]?.[key] || null;
export function latestMetric(s, series) { const cells = s.metricLog?.[series]; if (!cells) return null; const d = Object.keys(cells).sort().pop(); return d ? { date: d, ...cells[d] } : null; }

/** Done = you tapped it, or the app it's linked to says so: "yuzu" (the app's own "done today") or "yuzu:cards" (that metric reached its goal). */
export function habitDone(s, h, key, apps, todayKey) {
  const c = s.habitLog?.[h.id]?.[key];
  if (c) return c.v === 1;   // an explicit tap wins, including un-ticking an automatic one
  return !!autoDone(s, h, key, apps, todayKey);
}
export function autoDone(s, h, key, apps, todayKey) {
  if (!h.link) return false;
  const [app, metric] = h.link.split(':');
  if (metric) { const c = metricCell(s, h.link, key); return !!c && c.v >= (h.threshold || c.goal || 1); }
  if (key !== todayKey) return false;
  const t = apps?.[app]?.today; return !!(t?.done && (!t.date || t.date === key));
}

/** Current and best streak. Days that aren't due don't break it; today only counts once done (and never breaks it while pending). */
export function habitStreak(s, h, now, apps) {
  const todayKey = keyOf(now), f = h.freq || { type: 'daily' };
  const created = startOfDay(new Date(h.createdAt || now.getTime()));
  const start = new Date(Math.max(created.getTime(), startOfDay(now).getTime() - 400 * DAY));
  if (f.type === 'weekly') {
    const n = f.n || 3; let run = 0, best = 0, ws = weekStartOf(start), last = weekStartOf(now);
    for (; ws <= last; ws = addDays(ws, 7)) {
      let c = 0; for (let i = 0; i < 7; i++) { const d = addDays(ws, i), k = keyOf(d); if (k > todayKey) break; if (d >= created && habitDone(s, h, k, apps, todayKey)) c++; }
      const current = keyOf(ws) === keyOf(last);
      if (c >= n) { run++; best = Math.max(best, run); } else if (!current) run = 0;
    }
    return { cur: run, best, unit: 'wk' };
  }
  let run = 0, best = 0;
  for (let d = start; keyOf(d) <= todayKey; d = addDays(d, 1)) {
    if (!habitDue(h, d)) continue;
    const k = keyOf(d);
    if (habitDone(s, h, k, apps, todayKey)) { run++; best = Math.max(best, run); } else if (k !== todayKey) run = 0;
  }
  return { cur: run, best, unit: 'd' };
}
export function habitWeekCount(s, h, ws, now, apps) { const todayKey = keyOf(now); let c = 0; for (let i = 0; i < 7; i++) { const k = keyOf(addDays(ws, i)); if (k <= todayKey && habitDone(s, h, k, apps, todayKey)) c++; } return c; }

/** Due vs done over a window, for all habits (weekly habits count n/7 per day). Fractions are fine: they feed percentages. */
export function habitWindow(s, from, to, apps, only = null) {
  const todayKey = keyOf(to); let due = 0, done = 0;
  for (const h of only || activeHabits(s)) {
    const created = startOfDay(new Date(h.createdAt || 0)); const f = h.freq || {}; let hd = 0, dn = 0;
    for (let d = startOfDay(from); keyOf(d) <= todayKey; d = addDays(d, 1)) {
      if (d < created) continue;
      const k = keyOf(d), did = habitDone(s, h, k, apps, todayKey);
      if (f.type === 'weekly') { hd += (f.n || 3) / 7; if (did) dn++; }
      else if (habitDue(h, d)) { if (k === todayKey && !did) continue; hd++; if (did) dn++; }   // today isn't a miss yet
    }
    due += hd; done += Math.min(dn, hd || dn);
  }
  return { due, done, rate: due > 0 ? clamp01(done / due) : null };
}
export const habitRate = (s, h, now, days, apps) => habitWindow(s, addDays(startOfDay(now), -(days - 1)), now, apps, [h]).rate;

// ════════════════════════════════════════ objectives (long-term aims)
export function addAim(s, f) {
  const title = String(f.title || '').trim().slice(0, 100); if (!title) return s;
  const id = f.id || uid(), now = Date.now();
  const a = { id, title, why: String(f.why || '').slice(0, 300), area: f.area || '', deadline: f.deadline || '', milestones: (f.milestones || []).filter(m => m.title).map(m => ({ id: m.id || uid(), title: String(m.title).slice(0, 100), done: !!m.done })), pct: +f.pct || 0, link: f.link || '', status: 'active', createdAt: now, at: now };
  return { ...s, aims: { ...s.aims, [id]: a } };
}
export function updateAim(s, id, patch) { const a = s.aims?.[id]; return a ? { ...s, aims: { ...s.aims, [id]: { ...a, ...patch, at: Date.now() } } } : s; }
export function deleteAim(s, id) {
  const aims = { ...s.aims }; delete aims[id];
  // what pointed at it keeps working, just unlinked
  const tasks = Object.fromEntries(Object.entries(s.tasks || {}).map(([k, t]) => [k, t.aimId === id ? { ...t, aimId: '', area: t.area || s.aims?.[id]?.area || '', at: Date.now() } : t]));
  const habits = Object.fromEntries(Object.entries(s.habits || {}).map(([k, hb]) => [k, hb.aimId === id ? { ...hb, aimId: '', area: hb.area || s.aims?.[id]?.area || '', at: Date.now() } : hb]));
  return { ...s, aims, tasks, habits, deleted: tomb(s, `aim:${id}`) };
}
/** 0–1. A linked app number is the most truthful; then milestones; then the tasks pointed at it; then your own slider. */
export function aimProgress(s, a) {
  if (a.link) { const m = latestMetric(s, a.link); if (m) return clamp01(m.v / 100); }
  const ms = a.milestones || []; if (ms.length) return ms.filter(m => m.done).length / ms.length;
  const ts = rec(s.tasks).filter(t => t.aimId === a.id); if (ts.length) return ts.filter(t => t.done).length / ts.length;
  return clamp01((a.pct || 0) / 100);
}
export function daysLeft(deadline, now = new Date()) { return deadline ? Math.round((fromKey(deadline) - startOfDay(now)) / DAY) : null; }

// ════════════════════════════════════════ reflection
export const DAILY = new Set(['daily', 'gratitude', 'stoic', 'journal']);
export const METHODS = [
  { id: 'daily', name: 'Evening check-in', cadence: 'Daily', blurb: 'Two minutes: how the day went, what worked, what tomorrow needs.', mood: true,
    fields: [{ k: 'wins', label: 'Three wins today', type: 'lines', n: 3 }, { k: 'lesson', label: 'One lesson', type: 'text' }, { k: 'tomorrow', label: 'Top three for tomorrow', type: 'lines', n: 3, toTasks: true }] },
  { id: 'gratitude', name: 'Gratitude', cadence: 'Daily', blurb: 'Three small good things. It trains attention toward what is working.',
    fields: [{ k: 'three', label: 'Three things I appreciate', type: 'lines', n: 3 }] },
  { id: 'stoic', name: 'Stoic review', cadence: 'Daily', blurb: 'Seneca\'s evening audit, without the mysticism: well done, fell short, do differently.', mood: true,
    fields: [{ k: 'well', label: 'What did I do well?', type: 'text' }, { k: 'short', label: 'Where did I fall short?', type: 'text' }, { k: 'change', label: 'What will I do differently tomorrow?', type: 'text' }] },
  { id: 'weekly', name: 'Weekly review', cadence: 'Weekly', blurb: 'Look back, learn, and choose next week\'s focus.', stats: true, rating: true,
    fields: [{ k: 'wins', label: 'What went well', type: 'text' }, { k: 'blockers', label: 'What got in the way', type: 'text' }, { k: 'learned', label: 'What I learned', type: 'text' }, { k: 'focus', label: 'Focus for next week (up to 3)', type: 'lines', n: 3, toTasks: true }] },
  { id: 'ssc', name: 'Start · Stop · Continue', cadence: 'Monthly', blurb: 'One honest pass over habits and routines.',
    fields: [{ k: 'start', label: 'Start doing', type: 'text' }, { k: 'stop', label: 'Stop doing', type: 'text' }, { k: 'continue', label: 'Keep doing', type: 'text' }] },
  { id: 'wheel', name: 'Wheel of life', cadence: 'Monthly', blurb: 'Rate eight areas 1–10 to see what is thriving and what is starved.', wheel: true,
    fields: [{ k: 'note', label: 'What stands out?', type: 'text' }] },
  { id: 'premortem', name: 'Pre-mortem', cadence: 'Per goal', blurb: 'Imagine the goal failed. Why? Then fix it before it happens.', aim: true,
    fields: [{ k: 'fail', label: 'It is six months later and this failed. What went wrong?', type: 'text' }, { k: 'signs', label: 'Early warning signs I would see', type: 'text' }, { k: 'prevent', label: 'What I will do now to prevent it', type: 'text' }] },
  { id: 'journal', name: 'Free write', cadence: 'Anytime', blurb: 'No structure. Get it out of your head.', mood: true, fields: [{ k: 'text', label: '', type: 'long' }] },
  { id: 'yearend', name: 'Year in review', cadence: 'Yearly', blurb: 'Close the year: proud of, hard, learned, and the word for the next.', rating: true,
    fields: [{ k: 'proud', label: 'What I am proudest of', type: 'text' }, { k: 'hard', label: 'What was hardest', type: 'text' }, { k: 'learned', label: 'What I learned', type: 'text' }, { k: 'word', label: 'My word for next year', type: 'text' }] },
];
export const methodOf = (id) => METHODS.find(m => m.id === id);
export function reflectionKey(method, dateKey, aimId = '') { return method === 'premortem' ? `premortem:${dateKey}:${aimId}` : `${method}:${dateKey}`; }
export function saveReflection(s, e) {
  const key = e.id || reflectionKey(e.method, e.date, e.aimId);
  return { ...s, reflections: { ...s.reflections, [key]: { ...e, id: key, at: Date.now() } } };
}
export function deleteReflection(s, id) { const reflections = { ...s.reflections }; delete reflections[id]; return { ...s, reflections, deleted: tomb(s, `refl:${id}`) }; }
export const reflectionsList = (s) => rec(s.reflections).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
export function reflectedOn(s, key) { return rec(s.reflections).some(r => DAILY.has(r.method) && r.date === key); }
export function reflectionStreak(s, now) {
  const days = new Set(rec(s.reflections).filter(r => DAILY.has(r.method)).map(r => r.date)); let d = startOfDay(now), n = 0;
  if (!days.has(keyOf(d))) d = addDays(d, -1);   // today can still happen
  while (days.has(keyOf(d))) { n++; d = addDays(d, -1); }
  return n;
}
/** Which reflection fits right now. */
export function suggestMethod(s, now = new Date()) {
  const today = keyOf(now), ws = keyOf(weekStartOf(now)), has = (id, k) => !!s.reflections?.[`${id}:${k}`];
  const wheelThisMonth = rec(s.reflections).some(r => r.method === 'wheel' && r.date.slice(0, 7) === today.slice(0, 7));
  const weeklyThisWeek = rec(s.reflections).some(r => r.method === 'weekly' && r.date >= ws && r.date <= keyOf(addDays(weekStartOf(now), 6)));
  if ([5, 6].includes(now.getDay()) && !weeklyThisWeek) return { method: 'weekly', why: 'The weekend is the moment to close the week.' };
  if (now.getDate() <= 5 && !wheelThisMonth) return { method: 'wheel', why: 'A new month: see which areas of life got starved.' };
  if (now.getHours() >= 17 && !reflectedOn(s, today)) return { method: 'daily', why: 'Close the day in two minutes.' };
  if (now.getHours() < 12 && !has('gratitude', today)) return { method: 'gratitude', why: 'A calm start: three good things.' };
  return { method: reflectedOn(s, today) ? 'journal' : 'daily', why: reflectedOn(s, today) ? 'Already reflected today — free write if you want more.' : 'Whenever you are ready.' };
}
export function moodSeries(s, days, now) {
  const by = {}; for (const r of rec(s.reflections)) if (r.mood || r.energy) (by[r.date] ||= []).push(r);
  return Array.from({ length: days }, (_, i) => { const k = keyOf(addDays(startOfDay(now), i - days + 1)); const l = by[k] || []; const avg = (f) => { const v = l.map(x => x[f]).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }; return { date: k, mood: avg('mood'), energy: avg('energy') }; });
}
export function latestWheel(s, n = 2) { return rec(s.reflections).filter(r => r.method === 'wheel' && r.scores).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, n); }

// ════════════════════════════════════════ resolutions
export const QUARTERS = ['q1', 'q2', 'q3', 'q4'];
export function addResolution(s, f) {
  const title = String(f.title || '').trim().slice(0, 100); if (!title) return s;
  const id = f.id || uid(), now = Date.now();
  const r = { id, year: f.year, title, area: f.area || '', why: String(f.why || '').slice(0, 300), target: String(f.target || '').slice(0, 120), progress: +f.progress || 0, aimId: f.aimId || '', status: 'active', checkins: {}, createdAt: now, at: now };
  return { ...s, resolutions: { ...s.resolutions, [id]: r } };
}
export function updateResolution(s, id, patch) { const r = s.resolutions?.[id]; return r ? { ...s, resolutions: { ...s.resolutions, [id]: { ...r, ...patch, at: Date.now() } } } : s; }
export function deleteResolution(s, id) { const resolutions = { ...s.resolutions }; delete resolutions[id]; return { ...s, resolutions, deleted: tomb(s, `res:${id}`) }; }
export function setCheckin(s, id, q, c) { const r = s.resolutions?.[id]; return r ? updateResolution(s, id, { checkins: { ...r.checkins, [q]: { ...c, at: Date.now() } } }) : s; }
export function setTheme(s, year, theme) { return { ...s, yearMeta: { ...s.yearMeta, [year]: { theme: String(theme || '').slice(0, 40), at: Date.now() } } }; }
export const resolutionsOf = (s, year) => rec(s.resolutions).filter(r => r.year === year).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export function resolutionProgress(s, r) { if (r.aimId && s.aims?.[r.aimId]) return aimProgress(s, s.aims[r.aimId]); return clamp01((r.progress || 0) / 100); }
export const quarterOf = (now) => QUARTERS[Math.floor(now.getMonth() / 3)];
export function yearReview(s, year, now, apps) {
  const from = new Date(year, 0, 1), to = new Date(Math.min(new Date(year, 11, 31).getTime(), now.getTime()));
  const tasks = rec(s.tasks).filter(t => t.done && t.doneAt >= from.getTime() && t.doneAt < new Date(year + 1, 0, 1).getTime()).length;
  const res = resolutionsOf(s, year), avg = res.length ? res.reduce((a, r) => a + resolutionProgress(s, r), 0) / res.length : null;
  const refl = rec(s.reflections).filter(r => (r.date || '').startsWith(String(year))).length;
  let bestStreak = 0, bestName = ''; for (const h of activeHabits(s)) { const st = habitStreak(s, h, to, apps); if (st.best > bestStreak) { bestStreak = st.best; bestName = h.name; } }
  const hw = habitWindow(s, from, to, apps);
  return { tasks, resolutions: res.length, avgProgress: avg, reflections: refl, bestStreak, bestName, habitRate: hw.rate };
}

// ════════════════════════════════════════ areas, scores, insights
export function areaStats(s, areaId, now, apps) {
  const todayKey = keyOf(now), from = addDays(startOfDay(now), -6), fromMs = from.getTime();
  const aims = rec(s.aims).filter(a => a.area === areaId && a.status !== 'done');
  const habits = activeHabits(s).filter(h => habitArea(s, h) === areaId);
  const tasks = rec(s.tasks).filter(t => taskArea(s, t) === areaId);
  const hw = habitWindow(s, from, now, apps, habits);
  const done7 = tasks.filter(t => t.done && t.doneAt >= fromMs).length, openDue = tasks.filter(t => !t.done && t.due && t.due <= todayKey).length;
  const parts = [];
  if (hw.rate != null) parts.push(hw.rate);
  if (done7 + openDue > 0) parts.push(done7 / (done7 + openDue));
  if (aims.length) parts.push(aims.reduce((a, x) => a + aimProgress(s, x), 0) / aims.length);
  const activeToday = habits.some(h => habitDone(s, h, todayKey, apps, todayKey)) || tasks.some(t => t.done && t.doneAt >= startOfDay(now).getTime());
  return {
    id: areaId, aims, habits, openTasks: tasks.filter(t => !t.done).length, items: aims.length + habits.length + tasks.filter(t => !t.done).length,
    score: parts.length ? clamp01(parts.reduce((a, b) => a + b, 0) / parts.length) : null,
    heat: clamp01((habits.filter(h => habitDone(s, h, todayKey, apps, todayKey)).length + done7) / 7), activeToday,
    habitDots: habits.map(h => ({ id: h.id, done: habitDone(s, h, todayKey, apps, todayKey) })),
    aimDots: aims.slice(0, 4).map(a => ({ id: a.id, title: a.title, p: aimProgress(s, a) })),
  };
}
export function lastActive(s, areaId, apps) {
  let last = '';
  for (const h of activeHabits(s).filter(x => habitArea(s, x) === areaId)) for (const [d, c] of Object.entries(s.habitLog?.[h.id] || {})) if (c.v && d > last) last = d;
  for (const t of rec(s.tasks).filter(x => x.done && taskArea(s, x) === areaId)) { const d = keyOf(new Date(t.doneAt)); if (d > last) last = d; }
  return last;
}

export function brainScore(s, now, apps) {
  const todayKey = keyOf(now), from = addDays(startOfDay(now), -6);
  const parts = [];
  const hw = habitWindow(s, from, now, apps);
  parts.push({ id: 'habits', label: 'Habits', weight: 40, value: hw.rate });
  let tDone = 0, tLate = 0; for (const t of rec(s.tasks)) { if (t.done && t.doneAt >= from.getTime()) tDone++; else if (!t.done && t.due && t.due <= todayKey) tLate++; }
  parts.push({ id: 'tasks', label: 'Tasks', weight: 30, value: tDone + tLate ? tDone / (tDone + tLate) : null });
  const days = new Set(rec(s.reflections).filter(r => DAILY.has(r.method) && r.date >= keyOf(from) && r.date <= todayKey).map(r => r.date));
  parts.push({ id: 'reflect', label: 'Reflection', weight: 15, value: rec(s.reflections).length ? clamp01(days.size / 4) : null });
  const prog = weekProgress(s, weekStartOf(now)); let have = 0, target = 0;
  for (const g of s.goals || []) { const t = Math.round((g.hoursPerWeek || 0) * 60); if (t > 0) { target += t; have += Math.min(t, prog[g.id] || 0); } }
  const elapsed = (now.getDay() + 1) / 7;
  parts.push({ id: 'time', label: 'Planned time', weight: 15, value: target ? clamp01(have / (target * elapsed)) : null });
  const live = parts.filter(p => p.value != null), w = live.reduce((a, p) => a + p.weight, 0);
  return { score: w ? Math.round(live.reduce((a, p) => a + p.value * p.weight, 0) / w * 100) : null, parts };
}
export function weekStats(s, ws, now, apps) {
  const wsMs = ws.getTime(), weMs = addDays(ws, 7).getTime(), end = addDays(ws, 6);
  const hw = habitWindow(s, ws, end < now ? end : now, apps);
  const tasksDone = rec(s.tasks).filter(t => t.done && t.doneAt >= wsMs && t.doneAt < weMs).length;
  const reflect = new Set(rec(s.reflections).filter(r => DAILY.has(r.method) && r.date >= keyOf(ws) && r.date <= keyOf(end)).map(r => r.date)).size;
  let studyMin = 0; for (let i = 0; i < 7; i++) for (const p of s.plan?.[keyOf(addDays(ws, i))] || []) if (p.status === 'done') studyMin += p.end - p.start;
  return { ws, habitRate: hw.rate, tasksDone, reflect, studyMin };
}
export const trend = (s, weeks, now, apps) => Array.from({ length: weeks }, (_, i) => weekStats(s, addDays(weekStartOf(now), -7 * (weeks - 1 - i)), now, apps));
export function dayScore(s, d, apps, now) { const w = habitWindow(s, d, d > now ? d : d, apps); return d > now ? null : w.rate; }
export function insights(s, now, apps) {
  const out = [], todayKey = keyOf(now), habits = activeHabits(s);
  for (const h of habits) { const st = habitStreak(s, h, now, apps); if (st.cur >= 3 && habitDue(h, now) && !habitDone(s, h, todayKey, apps, todayKey) && now.getHours() >= 16) out.push({ pri: 1, text: `${h.name}: ${st.cur}-${st.unit === 'wk' ? 'week' : 'day'} streak, not done yet today.` }); }
  const b = taskBuckets(s, now); if (b.overdue.length >= 3) out.push({ pri: 2, text: `${b.overdue.length} tasks are overdue. Finish one, move one, drop the rest.` });
  const by = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  for (let i = 1; i <= 56; i++) { const d = addDays(startOfDay(now), -i); const w = habitWindow(s, d, d, apps); by[d.getDay()].due += w.due; by[d.getDay()].done += w.done; }
  const best = by.map((x, i) => ({ i, r: x.due >= 4 ? x.done / x.due : -1 })).sort((a, c) => c.r - a.r)[0];
  if (best && best.r >= 0.5) out.push({ pri: 4, text: `You are strongest on ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][best.i]}: ${Math.round(best.r * 100)}% of habits done.` });
  for (const a of AREAS) { const st = areaStats(s, a.id, now, apps); if (!st.habits.length && !st.aims.length) continue; const last = lastActive(s, a.id, apps); const idle = last ? Math.round((startOfDay(now) - fromKey(last)) / DAY) : null; if (idle != null && idle >= 14) { out.push({ pri: 3, text: `${a.name} has had no attention for ${idle} days.` }); break; } }
  const w = latestWheel(s, 1)[0]; if (w) { const low = Object.entries(w.scores).sort((a, c) => a[1] - c[1])[0]; if (low && low[1] <= 4) out.push({ pri: 5, text: `${areaOf(low[0])?.name || low[0]} scored lowest (${low[1]}/10) at your last wheel check.` }); }
  const rs = reflectionStreak(s, now); if (rs >= 3) out.push({ pri: 6, text: `${rs} days of reflection in a row.` });
  return out.sort((a, c) => a.pri - c.pri).slice(0, 3);
}

// ════════════════════════════════════════ planner: tasks and habits that need time become asks, like an app's
export function mindAsks(s, from, days, now = new Date()) {
  const apps = {}, todayKey = keyOf(now), k0 = keyOf(from), k1 = keyOf(addDays(from, days - 1));
  for (const t of rec(s.tasks)) {
    if (t.done || !t.est || !t.due) continue;
    const date = t.due < todayKey ? todayKey : t.due; if (date < k0 || date > k1) continue;
    const key = `task-${t.id}`;
    apps[key] = { app: key, title: t.title, color: t.pri ? '#ff7a1a' : '#9aa0b1', asks: [{ date, title: t.title, minutes: t.est, slot: 'free', reason: t.due < todayKey ? 'Overdue task' : `Task due ${t.due.slice(8)}/${t.due.slice(5, 7)}` }] };
  }
  for (const h of activeHabits(s)) {
    if (!h.minutes) continue; const asks = [];
    for (let i = 0; i < days; i++) { const d = addDays(from, i), k = keyOf(d); if (k < todayKey || !habitDue(h, d) || habitDone(s, h, k, null, todayKey)) continue; asks.push({ date: k, title: h.name, minutes: h.minutes, slot: 'free', reason: `Habit: ${h.name}` }); }
    if (asks.length) apps[`habit-${h.id}`] = { app: `habit-${h.id}`, title: h.name, color: areaOf(habitArea(s, h))?.color || '#5fd38d', asks };
  }
  return apps;
}
/** When a planner block for a task or habit is marked done, the task or habit is too. */
export function completeFromBlock(s, goalId, dateKey) {
  const m = /^app:(task|habit)-(.+)$/.exec(goalId || ''); if (!m) return s;
  return m[1] === 'task' ? (s.tasks?.[m[2]] && !s.tasks[m[2]].done ? setTaskDone(s, m[2], true) : s) : (s.habits?.[m[2]] ? logHabit(s, m[2], dateKey, 1) : s);
}

// ════════════════════════════════════════ from other apps: metrics, progress, inbox
/** File today's numbers and progress the apps report into history. Returns the same object when nothing changed. */
export function recordMetrics(s, apps) {
  let log = s.metricLog || {}, changed = false;
  const put = (series, date, cell) => {
    const cur = log[series]?.[date];
    if (cur && cur.v === cell.v && cur.goal === cell.goal && cur.label === cell.label) return;
    if (!changed) { log = { ...log }; changed = true; }
    log[series] = { ...(log[series] || {}), [date]: { ...cell, at: Date.now() } };
  };
  for (const [name, st] of Object.entries(apps || {})) {
    const app = st.app || name;
    for (const m of st.metrics || []) put(`${app}:${m.key}`, m.date, { v: m.value, goal: m.goal || 0, label: m.label, unit: m.unit, kind: 'metric' });
    for (const p of st.progress || []) put(`${app}:${p.key}`, p.date, { v: p.pct, goal: 100, label: p.label, unit: '%', kind: 'progress' });
  }
  if (!changed) return s;
  const cut = keyOf(addDays(new Date(), -400));   // keep a bit over a year
  for (const series of Object.keys(log)) { const cells = Object.fromEntries(Object.entries(log[series]).filter(([d]) => d >= cut)); log[series] = cells; }
  return { ...s, metricLog: log };
}
export function metricSeries(s) {
  return Object.entries(s.metricLog || {}).map(([key, cells]) => {
    const dates = Object.keys(cells).sort(), last = cells[dates[dates.length - 1]];
    return { key, app: key.split(':')[0], label: last.label || key, unit: last.unit || '', kind: last.kind, last: last.v, goal: last.goal || 0, date: dates[dates.length - 1], dates, cells };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
/** Proposals from other apps you haven't decided on (and that haven't expired). */
export function inboxPending(s, apps, now = new Date()) {
  const todayKey = keyOf(now), out = [];
  for (const [name, st] of Object.entries(apps || {})) for (const it of st.inbox || []) {
    const ref = refOf(st.app || name, it.id);
    if (s.inboxLog?.[ref]) continue;
    if (it.expires && it.expires < todayKey) continue;
    if (it.type === 'event' && it.date < todayKey) continue;
    out.push({ ref, app: st.app || name, item: it, at: st.updatedAt || '' });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
/** Take a proposal in: a task becomes a task (remembering who sent it), a note joins that day's notes, an event is returned for the calendar. */
export function acceptInbox(s, p) {
  const { ref, app, item } = p, now = Date.now();
  let next = s, taskId = '';
  if (item.type === 'note') {
    const date = item.date || keyOf(new Date()), cur = s.notes?.[date];
    next = { ...s, notes: { ...s.notes, [date]: `${cur ? cur + '\n' : ''}[${app}] ${item.text || item.title}` } };
  } else if (item.type === 'task' || !item.start) {
    taskId = uid();
    next = addTask(s, { id: taskId, title: item.title, due: item.date, est: item.minutes, pri: item.pri, notes: [item.text, item.url].filter(Boolean).join('\n'), src: ref, srcApp: app });
  }
  return { state: { ...next, inboxLog: { ...next.inboxLog, [ref]: { status: 'accepted', at: now, taskId, type: item.type } } }, taskId };
}
export const dismissInbox = (s, ref) => ({ ...s, inboxLog: { ...s.inboxLog, [ref]: { status: 'dismissed', at: Date.now() } } });
/** What Citrus tells the apps back (in plan.json): which of their proposals you took, finished or dropped. */
export function receipts(s) {
  const out = [];
  for (const [ref, v] of Object.entries(s.inboxLog || {})) {
    const i = ref.indexOf(':'), t = v.taskId ? s.tasks?.[v.taskId] : null;
    out.push({ app: ref.slice(0, i), id: ref.slice(i + 1), status: v.status === 'dismissed' ? 'dismissed' : t?.done ? 'done' : 'accepted', at: v.at });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 60).map(({ at, ...r }) => r);
}

// ════════════════════════════════════════ what the other apps and the morning brief read (plan.json › mind)
export function mindSummary(s, now, apps) {
  const todayKey = keyOf(now), b = taskBuckets(s, now), habits = activeHabits(s);
  const streaks = habits.map(h => ({ name: h.name, days: habitStreak(s, h, now, apps).cur })).filter(x => x.days > 0).sort((a, c) => c.days - a.days).slice(0, 3);
  const bs = brainScore(s, now, apps);
  return {
    score: bs.score,
    tasks: { overdue: b.overdue.length, today: b.today.length, top: focusTasks(s, now, 5).map(t => ({ title: t.title, due: t.due || '', pri: t.pri || 0 })) },
    habits: { due: habits.filter(h => habitDue(h, now)).length, done: habits.filter(h => habitDue(h, now) && habitDone(s, h, todayKey, apps, todayKey)).length, pending: habits.filter(h => habitDue(h, now) && !habitDone(s, h, todayKey, apps, todayKey)).map(h => h.name).slice(0, 6) },
    streaks, reflectedToday: reflectedOn(s, todayKey),
    receipts: receipts(s),
  };
}

// ════════════════════════════════════════ first-run: a starter kit built from what Citrus already knows
export function starterKit(s) {
  const have = new Set([...rec(s.habits).map(h => h.name.toLowerCase()), ...rec(s.aims).map(a => a.title.toLowerCase())]);
  const kit = [
    { kind: 'habit', name: 'Evening check-in', emoji: '🌙', area: 'calm', freq: { type: 'daily' }, why: 'Two minutes to close the day' },
    { kind: 'habit', name: 'Gym', emoji: '💪', area: 'health', freq: { type: 'weekly', n: 3 }, link: 'orange', why: 'Counts automatically when Orange says you trained' },
    { kind: 'habit', name: 'Yuzu reviews', emoji: '🍋', area: 'learning', freq: { type: 'daily' }, link: 'yuzu', why: 'Counts automatically when Yuzu says you are done' },
    { kind: 'habit', name: 'German session', emoji: '🇩🇪', area: 'learning', freq: { type: 'daily' }, link: 'mephisto', why: 'Counts automatically from Mephisto' },
    { kind: 'habit', name: 'Walk 20 minutes', emoji: '🚶', area: 'health', freq: { type: 'days', days: [0, 1, 2, 3, 4, 5, 6] }, minutes: 20, why: 'Citrus finds time for it in your day' },
    { kind: 'aim', title: 'Pass USMLE Step 1', area: 'learning', milestones: ['Finish first pass of the content', 'Question bank at 50%', 'First full practice exam', 'Book the exam date'] },
    { kind: 'aim', title: 'Be consistently fit', area: 'health', milestones: ['Four weeks of 3 sessions', 'Track progress in Orange', 'Eight weeks in a row'] },
  ];
  return kit.filter(k => !have.has((k.name || k.title).toLowerCase()));
}
