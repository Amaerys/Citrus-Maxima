// Today: morning briefing, evening wind-down, how-did-the-day-feel log with what it learns, and a study planner around your shifts. Pure functions (no DOM).
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { dayInfo, myDay } from './model.js';
import * as N from './nurses.js';
import * as C from './chores.js';
import * as F from './social.js';
import * as X from './extras.js';
import * as L from './labor.js';
import { currentJob, upcoming } from './career.js';
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const fn = (p) => p.name.replace(/^Dr\.?\s*/i, '').split(' ')[0];
const rec = (o) => Object.values(o || {});

export const DAY_DEFAULTS = { sleepH: 8, prepMin: 90 };
export const daySettings = (s) => ({ ...DAY_DEFAULTS, ...(s.settings?.day || {}) });

/** What the day holds, in the order you would want to know it. */
export function briefing(s, now = new Date()) {
  const out = [], day = startOfDay(now), md = myDay(s, day), info = md.info, mine = info.mine, key = keyOf(day);
  if (md.today) { const w = md.today.shift; out.push({ icon: w.type === 'N' ? '🌙' : '🩺', text: `${w.label}, ${hm(w.hours.start)}–${hm(w.hours.end)} (${Math.round(w.hours.durationMin / 60 * 10) / 10}h)` }); }
  else if (mine?.shift.kind === 'leave') out.push({ icon: '🌴', text: 'On leave today' }); else if (info.hasRota) out.push({ icon: '☕', text: md.afterNight ? 'Off after a night, rest first' : 'Day off' });
  if (md.afterNight) out.push({ icon: '🌙', text: `Your night ends at ${hm(md.overnightTail.window.end.getHours() * 60 + md.overnightTail.window.end.getMinutes())}` });
  if (info.withMe?.length) out.push({ icon: '👥', text: `With you: ${info.withMe.slice(0, 4).map(e => fn(e.person)).join(', ')}${info.withMe.length > 4 ? ` +${info.withMe.length - 4}` : ''}` });
  if (md.today && N.nurseRotas(s).length) { const w = N.workingWithMe(s, day, mine); if (w?.hasNurses) { const names = (w.confirmed.length ? w.confirmed : [...(w.tipped || []), ...w.possible]).slice(0, 3).map(r => fn(r.person)); if (names.length) out.push({ icon: '🩺', text: `${w.confirmed.length ? 'Nurses posted with you' : 'Nurses likely with you'}: ${names.join(', ')}` }); } }
  const due = C.choreList(s).filter(c => C.dueDate(c, day) <= day).map(c => c.title); if (due.length) out.push({ icon: '🏠', text: `Due at home: ${due.slice(0, 3).join(', ')}` });
  const tasks = rec(s.tasks).filter(t => !t.done && t.due === key).map(t => t.title); if (tasks.length) out.push({ icon: '✅', text: `${tasks.length} task${tasks.length > 1 ? 's' : ''} due: ${tasks.slice(0, 2).join(', ')}` });
  const bd = [...F.birthdays(s, day, 0).map(b => b.friend.nick || b.friend.name), ...X.rotaBirthdays(s, day, 0).map(b => b.name)]; if (bd.length) out.push({ icon: '🎂', text: `Birthday today: ${bd.slice(0, 3).join(', ')}` });
  const cfg = L.settings(s), wk = new Date(day); wk.setDate(wk.getDate() - wk.getDay()); let mins = 0; for (const w of L.windows(s, wk, addDays(wk, 7))) { const a = Math.max(w.start, wk), b = Math.min(w.end, addDays(wk, 7)); if (b > a) mins += (b - a) / 60000; }
  const cap = cfg.weeklyH || L.LAW.weeklyH, h = Math.round(mins / 6) / 10; if (mins) out.push({ icon: '⏱', text: `${h}h rostered this week${h > cap ? `, ${Math.round((h - cap) * 10) / 10}h over the ${cap}h limit` : `, ${Math.round((cap - h) * 10) / 10}h before overtime`}` });
  const job = currentJob(s); if (job) for (const k of upcoming(job, day, 14)) out.push({ icon: '📄', text: `${k.label} in ${k.days} days` });
  const ce = X.contractEnds(s, day, 7); if (ce.length) out.push({ icon: '📄', text: `Nurse contract ending: ${ce.slice(0, 2).map(c => fn(c)).join(', ')}` });
  return out;
}

/** Tonight: when to sleep for tomorrow's shift, using your sleep target and getting-ready time. */
export function windDown(s, now = new Date()) {
  const cfg = daySettings(s), tmr = addDays(startOfDay(now), 1), md = myDay(s, tmr), sh = md.today?.shift;
  if (!sh) return { work: false, label: md.info.mine?.shift.kind === 'leave' ? 'On leave tomorrow' : md.info.hasRota ? 'Day off tomorrow, no alarm needed' : '', notes: [] };
  const start = sh.hours.start, wake = start - cfg.prepMin, night = sh.type === 'N' || start >= 17 * 60, bed = wake - cfg.sleepH * 60, tomorrowDue = C.choreList(s).filter(c => C.dueDate(c, tmr) <= tmr).map(c => c.title);
  const nowMin = now.getHours() * 60 + now.getMinutes(), toBed = bed < 0 ? bed + 1440 - nowMin : bed + 1440 * 0 - nowMin;
  const notes = []; if (night) notes.push('Night shift: sleep in the morning and keep the room dark; eat a proper meal before you start.'); else if (start <= 8 * 60) notes.push('Early start: get things ready tonight.');
  if (tomorrowDue.length) notes.push(`Home: ${tomorrowDue.slice(0, 3).join(', ')} due tomorrow`);
  return { work: true, label: `${sh.label}, ${hm(start)}–${hm(sh.hours.end)}`, night, wake, bed: ((bed % 1440) + 1440) % 1440, bedPrevDay: bed < 0, minutesToBed: Math.round(toBed), notes, sleepH: cfg.sleepH };
}

// ───────── how the day felt
export function rateDay(s, key, score, note = '') {
  const sc = Math.round(+score); if (!(sc >= 1 && sc <= 5) || !/^\d{4}-\d\d-\d\d$/.test(key)) return s; return { ...s, dayLog: { ...(s.dayLog || {}), [key]: { key, score: sc, note: String(note || '').slice(0, 200), at: Date.now() } } };
}
export const dayRating = (s, key) => s.dayLog?.[key]?.score || 0;
/** Plain-language patterns, only once there are enough rated days (3+ in a group, a real gap between groups). */
export function dayInsights(s) {
  const logs = rec(s.dayLog); const groups = {}, add = (g, v) => (groups[g] ||= []).push(v);
  for (const l of logs) { const d = fromKey(l.key), mi = dayInfo(s, d).mine, prev = dayInfo(s, addDays(d, -1)).mine, sh = mi?.shift; const type = sh?.kind === 'work' ? (sh.type === 'N' ? 'night shifts' : sh.type === 'D' ? 'day shifts' : 'other shifts') : sh?.kind === 'leave' ? 'leave days' : 'days off'; add(type, l.score); if (sh?.kind !== 'work' && prev?.shift.kind === 'work' && (prev.shift.type === 'N' || prev.shift.hours?.overnight)) add('days after a night', l.score); add([5, 6].includes(d.getDay()) ? 'Fridays and Saturdays' : 'weekdays', l.score); }
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10, rows = Object.entries(groups).filter(([, a]) => a.length >= 3).map(([g, a]) => ({ group: g, avg: avg(a), n: a.length })).sort((a, b) => b.avg - a.avg);
  const out = []; if (rows.length >= 2 && rows[0].avg - rows[rows.length - 1].avg >= 0.5) out.push(`Your best days are ${rows[0].group} (${rows[0].avg}/5); the hardest are ${rows[rows.length - 1].group} (${rows[rows.length - 1].avg}/5).`);
  const month = logs.filter(l => l.key >= keyOf(addDays(new Date(), -30))); if (month.length >= 5) out.push(`Last 30 days: ${avg(month.map(l => l.score))}/5 across ${month.length} rated days.`);
  return { rows, lines: out, total: logs.length };
}

// ───────── study planner
const STOP = new Set(['and', 'the', 'of', 'for', 'study', 'app', 'review', 'read', 'reading', 'questions', 'qbank', '&', '/', '-']);
const words = (t) => String(t || '').toLowerCase().replace(/step\s*(\d)/g, 'step$1').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
/** The study subject a planner block belongs to, if any: shares a meaningful word with its name or app ("USMLE Step 1" ↔ "Step 1 pathology"). */
export function subjectOf(s, title) { const tw = new Set(words(title)); if (!tw.size) return null; let best = null, n = 0; for (const x of subjects(s)) { const k = [...new Set([...words(x.name), ...words(x.app)])].filter(w => tw.has(w)).length; if (k > n) { n = k; best = x; } } return best; }
export const SUBJECT_STARTERS = [{ name: 'Anatomy & imaging', app: 'Anatomy' }, { name: 'ER textbook / MRCEM', app: 'ER textbook' }, { name: 'Step 1 pathology', app: 'Step 1 pathology' }];
export const subjects = (s) => rec(s.study).sort((a, b) => a.name.localeCompare(b.name));
export function saveSubject(s, x) { const id = x.id || 's' + Math.random().toString(36).slice(2, 8), name = String(x.name || '').trim().slice(0, 60); if (!name) return s; return { ...s, study: { ...(s.study || {}), [id]: { id, name, app: String(x.app || '').slice(0, 60), perWeek: Math.max(0, Math.min(3000, Math.round(+x.perWeek) || 150)), block: Math.max(15, Math.min(240, Math.round(+x.block) || 45)), at: Date.now() } } }; }
export const deleteSubject = (s, id) => { const study = { ...(s.study || {}) }; delete study[id]; return { ...s, study, deleted: { ...(s.deleted || {}), [`study:${id}`]: Date.now() } }; };
export function logStudy(s, key, id, mins) { const k = `${key}:${id}`, cur = s.studyLog?.[k]?.mins || 0, m = Math.max(0, Math.min(720, Math.round(cur + mins))); const studyLog = { ...(s.studyLog || {}) }; if (!m) { delete studyLog[k]; return { ...s, studyLog, deleted: { ...(s.deleted || {}), [`slog:${k}`]: Date.now() } }; } studyLog[k] = { key: k, mins: m, at: Date.now() }; return { ...s, studyLog }; }
export const studyOn = (s, key, id) => s.studyLog?.[`${key}:${id}`]?.mins || 0;
const weekStart = (d) => addDays(startOfDay(d), -startOfDay(d).getDay());
export function weekMinutes(s, id, now = new Date()) { let t = 0; const ws = weekStart(now); for (let i = 0; i < 7; i++) t += studyOn(s, keyOf(addDays(ws, i)), id); return t; }
/** Consecutive days with any study logged, counting back from today (yesterday still counts if today is not done yet). */
export function studyStreak(s, now = new Date()) { const any = (k) => subjects(s).some(x => studyOn(s, k, x.id) > 0); let d = startOfDay(now), n = 0; if (!any(keyOf(d))) d = addDays(d, -1); while (any(keyOf(d))) { n++; d = addDays(d, -1); } return n; }
/** Blocks for the next days: the subject furthest behind its weekly target gets the next free window (after-shift evenings first). */
/** `planned(date)` = the planner's blocks for that day ({title,start,end}): they are never overlapped, and one that is about a subject counts as that subject's block. */
export function studyPlan(s, now = new Date(), { days = 7, busyOf = () => [], planned = () => [] } = {}) {
  const subs = subjects(s).filter(x => x.perWeek > 0); if (!subs.length) return [];
  const plan = [], got = new Map(subs.map(x => [x.id, weekMinutes(s, x.id, now)])), today = startOfDay(now), nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i), pl = planned(date) || [], busy = [...busyOf(date), ...pl.map(b => [b.start, b.end])]; let wins = F.myWindows(s, date, busy); if (i === 0) wins = wins.map(([a, b]) => [Math.max(a, nowMin + 15), b]).filter(w => w[1] - w[0] >= 30);
    wins.sort((a, b) => (b[0] >= 17 * 60) - (a[0] >= 17 * 60) || a[0] - b[0]); const key = keyOf(date);
    if (i > 0 && date.getDay() === 0) for (const x of subs) got.set(x.id, 0);
    let fromPlan = false; for (const b of pl) { const sub = subjectOf(s, b.title); if (!sub || plan.some(p => p.date === key && p.subject === sub.id)) continue; plan.push({ date: key, subject: sub.id, name: sub.name, app: sub.app, start: b.start, end: b.end, fromPlan: true, title: b.title }); got.set(sub.id, got.get(sub.id) + (b.end - b.start)); fromPlan = true; }
    if (fromPlan) continue;   // the planner already has study on this day: don't stack a second block
    const sub = [...subs].sort((a, b) => got.get(a.id) / a.perWeek - got.get(b.id) / b.perWeek)[0];
    { if (studyOn(s, key, sub.id) >= sub.block || got.get(sub.id) >= sub.perWeek) continue; const w = wins.find(w => w[1] - w[0] >= sub.block); if (!w) continue;
      const start = w[0] >= 17 * 60 || w[1] - w[0] < sub.block + 60 ? w[0] : w[0] + 30; plan.push({ date: key, subject: sub.id, name: sub.name, app: sub.app, start, end: start + sub.block }); got.set(sub.id, got.get(sub.id) + sub.block);
    }
  }
  return plan;
}
