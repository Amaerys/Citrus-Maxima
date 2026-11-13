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
export const SLEEP_LIMITS = { sleepH: [4, 12], prepMin: [15, 240] };
export const daySettings = (s) => ({ ...DAY_DEFAULTS, ...(s.settings?.day || {}) });
/** A settings value the sheet can save, or null with the reason (no silent replacement, beta T01-10). */
export function checkSetting(k, raw) {
  const [lo, hi] = SLEEP_LIMITS[k], v = String(raw ?? '').trim() === '' ? NaN : +raw;
  if (!Number.isFinite(v)) return { ok: false, msg: `Enter a number from ${lo} to ${hi}` };
  if (v < lo || v > hi) return { ok: false, msg: `Must be ${lo}–${hi}` };
  return { ok: true, value: k === 'sleepH' ? Math.round(v * 2) / 2 : Math.round(v) };
}
/** "Day · Upper Village, 08:00–20:00" — but never the hours twice when the rota label already has them (beta T01-25). */
export const shiftLabel = (sh) => /\d\d?:\d\d/.test(sh.label) ? sh.label : `${sh.label}, ${hm(sh.hours.start)}–${hm(sh.hours.end)}`;
/** Before this hour the night is still "tonight": a 02:00 check plans for today's shift, not tomorrow's (beta T01-06). */
export const NIGHT_ENDS = 4;
/** Am I on a shift right now (today's, or the tail of last night's)? Returns its end, or null. */
export function onShiftNow(s, now = new Date()) {
  const md = myDay(s, startOfDay(now)), live = (w) => w && now >= w.start && now < w.end;
  if (live(md.today?.window)) return md.today.window.end; if (live(md.overnightTail?.window)) return md.overnightTail.window.end; return null;
}

/** What the day holds, in the order you would want to know it. */
export function briefing(s, now = new Date()) {
  const out = [], day = startOfDay(now), md = myDay(s, day), info = md.info, mine = info.mine, key = keyOf(day);
  if (md.today) { const w = md.today.shift; out.push({ icon: w.type === 'N' ? '🌙' : '🩺', text: `${shiftLabel(w)} (${Math.round(w.hours.durationMin / 60 * 10) / 10}h)${md.today.mci ? ' · MCI 2nd' : ''}` }); }
  else if (mine?.shift.kind === 'leave') out.push({ icon: '🌴', text: 'On leave today' }); else if (info.hasRota) out.push({ icon: '☕', text: md.afterNight ? 'Off after a night, rest first' : 'Day off' });
  if (md.afterNight) out.push({ icon: '🌙', text: `Your night ends at ${hm(md.overnightTail.window.end.getHours() * 60 + md.overnightTail.window.end.getMinutes())}` });
  if (info.withMe?.length) out.push({ icon: '👥', text: `With you: ${info.withMe.slice(0, 4).map(e => fn(e.person)).join(', ')}${info.withMe.length > 4 ? ` +${info.withMe.length - 4}` : ''}` });
  // During last night's tail (after midnight) the nurses with you are last night's, not tonight's (beta T04-07)
  if (md.overnightTail && now < md.overnightTail.window.end && N.nurseRotas(s).length) { const y = addDays(day, -1), t = nurseLine(N.workingWithMe(s, y, dayInfo(s, y).mine)); if (t) out.push({ icon: '💉', text: `Now: ${t.text}` }); }
  if (md.today && N.nurseRotas(s).length) { const t = nurseLine(N.workingWithMe(s, day, mine)); if (t) out.push({ icon: '💉', text: t.text }); if (t?.head) out.push({ icon: '🧭', text: t.head }); }
  const due = C.choreList(s).filter(c => C.dueDate(c, day) <= day).map(c => c.title); if (due.length) out.push({ icon: '🏠', text: `Due at home: ${due.slice(0, 3).join(', ')}` });
  const tasks = rec(s.tasks).filter(t => !t.done && t.due === key).map(t => t.title); if (tasks.length) out.push({ icon: '✅', text: `${tasks.length} task${tasks.length > 1 ? 's' : ''} due: ${tasks.slice(0, 2).join(', ')}` });
  const bd = [...F.birthdays(s, day, 0).map(b => b.friend.nick || b.friend.name), ...X.rotaBirthdays(s, day, 0).map(b => b.name)]; if (bd.length) out.push({ icon: '🎂', text: `Birthday today: ${bd.slice(0, 3).join(', ')}` });
  const cfg = L.settings(s), wk = new Date(day); wk.setDate(wk.getDate() - wk.getDay()); let mins = 0; for (const w of L.windows(s, wk, addDays(wk, 7))) { const a = Math.max(w.start, wk), b = Math.min(w.end, addDays(wk, 7)); if (b > a) mins += (b - a) / 60000; }
  const cap = cfg.weeklyH || L.LAW.weeklyH, h = Math.round(mins / 6) / 10; if (mins) out.push({ icon: '⏱', text: `${h}h rostered this week${h > cap ? `, ${Math.round((h - cap) * 10) / 10}h over the ${cap}h limit` : `, ${Math.round((cap - h) * 10) / 10}h before overtime`}` });
  const job = currentJob(s); if (job) for (const k of upcoming(job, day, 14)) out.push({ icon: '📄', text: `${k.label} in ${k.days} days` });
  const ce = X.contractEnds(s, day, 7); if (ce.length) out.push({ icon: '📄', text: `Nurse contract ending: ${ce.slice(0, 2).map(c => fn(c)).join(', ')}` });
  return out;
}

/** One honest nurse line from nurses.workingWithMe (D03): "likely" only with posting history behind it; otherwise its shared summary. */
export function nurseLine(w) {
  if (!w?.hasNurses) return null; const names = (a) => a.slice(0, 3).map(r => fn(r.person)).join(', ') + (a.length > 3 ? ` +${a.length - 3}` : '');
  const heard = (w.tipped || []).filter(r => !r.guess), guessed = (w.tipped || []).filter(r => r.guess), likely = w.likely || [];
  const text = w.confirmed.length ? `Nurses posted with you: ${names(w.confirmed)}`
    : heard.length ? `Nurses heard to be with you: ${names(heard)}`
    : likely.length ? `Nurses likely with you: ${names(likely)}`
    : guessed.length ? `Nurses, guessed from last time: ${names(guessed)}`
    : w.summary ? `Nurses: ${w.summary}` : '';
  const head = w.head?.length ? `Head nurse on today: ${w.head.map(r => fn(r.person)).join(', ')}` : '';
  return text || head ? { text: text || head, head: text ? head : '' } : null;
}
/** What Copy / Share sends: the date, then exactly the lines on the card (beta T01-14). */
export function briefingText(lines, now = new Date()) {
  const d = startOfDay(now), title = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
  return [title, ...lines.map(l => `${l.icon} ${l.text}`)].join('\n');
}

/** Tonight: when to sleep for the next shift, using your sleep target and getting-ready time.
 *  "Next" is tomorrow in the evening, but today in the small hours (02:00 before an 08:00 start, beta T01-06).
 *  Times are minutes of the shift's day; `bed` < 0 in the raw maths means the evening before. */
export function windDown(s, now = new Date()) {
  const cfg = daySettings(s), early = now.getHours() < NIGHT_ENDS, day = early ? startOfDay(now) : addDays(startOfDay(now), 1), md = myDay(s, day), sh = md.today?.shift;
  const when = early ? 'today' : 'tomorrow', dayWord = early ? 'Today' : 'Tomorrow';
  if (!sh) return { work: false, dayWord, label: md.info.mine?.shift.kind === 'leave' ? 'On leave, no alarm needed' : md.info.hasRota ? 'Day off, no alarm needed' : '', notes: [] };
  const start = sh.hours.start, wake = start - cfg.prepMin, night = sh.type === 'N' || start >= 17 * 60, bed = wake - cfg.sleepH * 60, due = C.choreList(s).filter(c => C.dueDate(c, day) <= day).map(c => c.title);
  // minutes from now until bedtime, counted on one clock: the evening before the shift's day is −1440…0 (beta T01-09)
  const nowMin = now.getHours() * 60 + now.getMinutes() - (early ? 0 : 1440), toBed = bed - nowMin, toWake = wake - nowMin;
  // past bedtime already (small hours, or a late evening before an early start): say how much sleep is still possible
  const sleepNow = !night && toBed <= 0 && toWake > 0;
  const notes = []; if (night) notes.push('Night shift: sleep in the morning and keep the room dark; eat a proper meal before you start.'); else if (start <= 8 * 60 && !sleepNow) notes.push('Early start: get things ready tonight.');
  if (due.length) notes.push(`Home: ${due.slice(0, 3).join(', ')} due ${when}`);
  return { work: true, dayWord, label: shiftLabel(sh), night, start, wake, bed: ((bed % 1440) + 1440) % 1440, bedPrevDay: bed < 0, minutesToBed: Math.round(toBed), sleepNow, sleepMin: sleepNow ? Math.round(toWake) : 0, notes, sleepH: cfg.sleepH };
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
/** The study planner's blocks for one day, shaped like planner blocks ({title,start,end,kind:'study'}), leaving out the ones the
 *  planner already holds — so the Plan tab can show them on its day cards and there is one timeline (beta T06-22). */
export function studyBlocksOn(s, date, opts = {}) {
  const k = keyOf(date), from = startOfDay(new Date()) > startOfDay(date) ? startOfDay(date) : opts.now || new Date();
  const days = Math.max(1, Math.round((startOfDay(date) - startOfDay(from)) / 864e5) + 1);
  return studyPlan(s, from, { ...opts, days }).filter(p => p.date === k && !p.fromPlan).map(p => ({ id: `study:${k}:${p.subject}`, kind: 'study', title: `Study · ${p.name}`, subject: p.subject, app: p.app, start: p.start, end: p.end }));
}
