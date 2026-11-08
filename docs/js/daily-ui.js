// Today cards: briefing (morning), wind-down + how the day felt (evening), study planner (any time).
import { h, toast, keyOf, addDays, startOfDay, fromKey, fmtMin, DAY_SHORT, MONTHS } from './util.js';
import * as D from './daily.js';
let ctx = null;
export function initDaily(c) { ctx = c; }
const S = () => ctx.S(), field = (l, ...x) => h('div', { class: 'field' }, h('label', {}, l), ...x);
const hm = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const FACES = ['😞', '😕', '😐', '🙂', '😄'];
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

export function todayCards(now = new Date()) {
  const s = S(), out = [], hr = now.getHours();
  const b = D.briefing(s, now); if (b.length) out.push(briefCard(b, hr < 14, now));
  if (hr >= 18 || hr < 3) { const w = windCard(now); if (w) out.push(w); }
  out.push(studyCard(now)); return out.filter(Boolean);
}

function rateRow(key, label) {
  const cur = D.dayRating(S(), key);
  return h('div', { class: 'rate' }, h('div', { class: 'tiny dim' }, label), h('div', { class: 'rate-faces' }, FACES.map((f, i) => h('button', { class: `rate-f ${cur === i + 1 ? 'sel' : ''}`, 'aria-label': `${i + 1} of 5`, 'aria-pressed': cur === i + 1 ? 'true' : 'false', onClick: () => ctx.update(x => D.rateDay(x, key, i + 1)) }, f))));
}
function briefCard(lines, open, now) {
  const s = S(), yk = keyOf(addDays(startOfDay(now), -1)), ask = now.getHours() < 12 && !D.dayRating(s, yk) && s.rotas && Object.keys(s.rotas).length && D.dayInsights(s).total + 1 >= 0;
  return h('details', { class: 'card brief2', open: open ? '' : null }, h('summary', {}, h('span', { class: 'title' }, now.getHours() < 12 ? 'Your morning' : 'Your day'), h('span', { class: 'tiny dim' }, `${lines.length} things`)),
    lines.map(l => h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, l.icon), h('div', { class: 'grow small' }, l.text))), ask ? rateRow(yk, 'How was yesterday?') : null);
}
function windCard(now) {
  const s = S(), w = D.windDown(s, now), key = keyOf(startOfDay(now).getTime() && now.getHours() < 3 ? addDays(startOfDay(now), -1) : startOfDay(now)), ins = D.dayInsights(s);
  if (!w.label && !ins.total) return null;
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Tonight'), h('button', { class: 'btn sm ghost', 'aria-label': 'Sleep settings', onClick: sleepSheet }, '⚙')),
    w.work ? [h('div', { class: 'small' }, `Tomorrow: ${w.label}`), h('div', { class: 'cr-key soon' }, h('div', { class: 'grow' }, h('b', {}, `${w.night ? 'Sleep until' : 'Be asleep by'} ${w.night ? hm(w.wake) : hm(w.bed)}`), h('div', { class: 'tiny dim' }, `${w.sleepH}h of sleep, up at ${hm(w.wake)} to be ready for ${hm(w.wake + 90)}`)), !w.night && w.minutesToBed > 0 && w.minutesToBed < 600 ? h('span', { class: 'chip' }, `in ${Math.floor(w.minutesToBed / 60)}h ${w.minutesToBed % 60}m`) : null)] : w.label ? h('div', { class: 'small' }, w.label) : null,
    w.notes.map(n => h('div', { class: 'tiny dim', style: { marginTop: '4px' } }, n)), rateRow(key, 'How was today?'), ins.lines.map(l => h('div', { class: 'small', style: { marginTop: '6px' } }, l)));
}
function sleepSheet() {
  const c = D.daySettings(S()), v = { ...c }, I = (k, mn, mx) => h('input', { type: 'number', min: mn, max: mx, value: v[k], onInput: (e) => { v[k] = +e.target.value; } });
  const box = ctx.sheet([h('h2', {}, 'Sleep'), field('Hours of sleep you aim for', I('sleepH', 4, 12)), field('Minutes to get ready before a shift', I('prepMin', 15, 240)), h('button', { class: 'btn primary', onClick: () => { ctx.update(x => ({ ...x, settings: { ...x.settings, day: { sleepH: Math.max(4, Math.min(12, v.sleepH || 8)), prepMin: Math.max(15, Math.min(240, v.prepMin || 90)) } } })); box.close(); ctx.render(); } }, 'Save')]);
}

// ───────── study
function studyCard(now) {
  const s = S(), subs = D.subjects(s), key = keyOf(startOfDay(now));
  if (!subs.length) return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Study'), h('button', { class: 'btn sm', onClick: () => studySheet() }, 'Set up')), h('div', { class: 'small muted' }, 'Plan study blocks around your shifts for your medical apps, with streaks.'));
  const plan = D.studyPlan(s, now, { busyOf: ctx.busyOf }), todays = plan.filter(p => p.date === key), streak = D.studyStreak(s, now);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Study'), streak ? h('span', { class: 'chip sel' }, `🔥 ${streak} day${streak > 1 ? 's' : ''}`) : null, h('button', { class: 'btn sm ghost', onClick: () => studySheet() }, 'Plan')),
    subs.map(sub => { const wk = D.weekMinutes(s, sub.id, now), pct = Math.min(100, Math.round(wk / (sub.perWeek || 1) * 100)), today = D.studyOn(s, key, sub.id), blk = todays.find(p => p.subject === sub.id);
      return h('div', { class: 'study-row' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, sub.name), h('div', { class: 'tiny dim' }, blk ? `Today ${hm(blk.start)}–${hm(blk.end)}` : today ? `${today} min today` : 'No window today')), sub.app && ctx.hasApp?.(sub.app) ? h('button', { class: 'btn sm ghost', onClick: () => ctx.launchApp(sub.app) }, 'Open') : null,
        [15, 30].map(m => h('button', { class: 'btn sm', 'aria-label': `Log ${m} minutes of ${sub.name}`, onClick: () => ctx.update(x => D.logStudy(x, key, sub.id, m)) }, `+${m}`))), h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })), h('div', { class: 'tiny dim' }, `${wk} of ${sub.perWeek} min this week`)); }));
}
function studySheet() {
  const wrap = h('div', {}), box = ctx.sheet([wrap]); const paint = () => {
    const s = S(), subs = D.subjects(s), plan = D.studyPlan(s, new Date(), { busyOf: ctx.busyOf }), have = new Set(subs.map(x => x.name)), left = D.SUBJECT_STARTERS.filter(x => !have.has(x.name));
    wrap.replaceChildren(h('h2', {}, 'Study plan'),
      left.length ? h('div', { class: 'card' }, h('div', { class: 'small' }, 'Your apps'), h('div', { class: 'chips', style: { marginTop: '6px' } }, left.map(x => h('button', { class: 'chip', onClick: () => { ctx.update(st => D.saveSubject(st, { ...x, perWeek: 150, block: 45 })); setTimeout(paint, 0); } }, `＋ ${x.name}`)))) : null,
      subs.map(sub => { const v = { ...sub }; return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, sub.name), h('button', { class: 'btn sm ghost', 'aria-label': `Delete ${sub.name}`, onClick: () => { if (confirm(`Remove ${sub.name}?`)) { ctx.update(st => D.deleteSubject(st, sub.id)); setTimeout(paint, 0); } } }, '🗑')),
        h('div', { class: 'row wrap' }, field('Minutes a week', h('input', { type: 'number', value: sub.perWeek, onChange: (e) => { ctx.update(st => D.saveSubject(st, { ...sub, perWeek: +e.target.value })); setTimeout(paint, 0); } })), field('Block length', h('input', { type: 'number', value: sub.block, onChange: (e) => { ctx.update(st => D.saveSubject(st, { ...sub, block: +e.target.value })); setTimeout(paint, 0); } })))); }),
      h('div', { class: 'card' }, h('input', { id: 'new-subj', placeholder: 'Another subject…' }), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onClick: () => { const i = wrap.querySelector('#new-subj'); if (!i.value.trim()) return toast('Name it first', 'err'); ctx.update(st => D.saveSubject(st, { name: i.value })); setTimeout(paint, 0); } }, 'Add')),
      h('div', { class: 'title', style: { marginTop: '10px' } }, 'The week ahead'), plan.length ? plan.map(p => h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'tiny dim' }, `${fd(p.date)} ${hm(p.start)}–${hm(p.end)}`)))) : h('div', { class: 'small muted' }, subs.length ? 'No free windows found, or the weekly targets are already met.' : 'Add a subject to see where it fits around your shifts.'));
  }; paint();
}
