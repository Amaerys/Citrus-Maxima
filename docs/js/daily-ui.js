// Today cards: briefing (morning), wind-down + how the day felt (evening), study planner (any time).
import { h, toast, keyOf, addDays, startOfDay, fromKey, fmtMin, DAY_SHORT, MONTHS } from './util.js';
import * as D from './daily.js';
import { undoToast } from './mind-ui.js';
let ctx = null;
export function initDaily(c) { ctx = c; }
const S = () => ctx.S(), field = (l, input) => { const id = input.id || (input.id = 'df-' + Math.random().toString(36).slice(2, 8)); return h('div', { class: 'field' }, h('label', { for: id }, l), input); };
const hm = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const FACES = ['😞', '😕', '😐', '🙂', '😄'];
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

export function todayCards(now = new Date()) {
  const s = S(), out = [], hr = now.getHours(), onShift = D.onShiftNow(s, now);
  const b = D.briefing(s, now); if (b.length) out.push({ el: briefCard(b, hr >= D.NIGHT_ENDS && hr < 14, now), score: hr < D.NIGHT_ENDS ? 30 : hr < 12 ? 95 : hr < 18 ? 60 : 35, label: hr < 5 ? 'Overnight' : 'Briefing' });
  // Tonight is for the evening and the small hours, and steps back while a shift is running: you can't act on it then (beta T01-11)
  if (hr >= 18 || hr < D.NIGHT_ENDS) { const w = windCard(now, onShift); if (w) out.push({ el: w, score: onShift ? 28 : 94, label: 'Tonight' }); }
  const subs = D.subjects(s), blk = subs.length ? D.studyPlan(s, now, { busyOf: ctx.busyOf, planned: ctx.planned, days: 1 }).length : 0;
  out.push({ el: studyCard(now), score: !subs.length ? 20 : blk ? 66 : 45, label: 'Study' }); return out.filter(x => x.el);
}

// Days rated from a card in this session: their row stays, showing the pick, so a mis-tap can be changed (beta T01-13).
const ratedHere = new Set();
const dayName = (k) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][fromKey(k).getDay()];
function rateRow(key, label) {
  const cur = D.dayRating(S(), key);
  return h('div', { class: 'rate', role: 'group', 'aria-label': label }, h('div', { class: 'row rate-head' }, h('div', { class: 'tiny dim grow' }, label), cur ? h('span', { class: 'tiny rate-saved' }, 'Saved · tap to change') : null),
    h('div', { class: 'rate-faces' }, FACES.map((f, i) => h('button', { type: 'button', class: `rate-f ${cur === i + 1 ? 'sel' : ''}`, 'aria-label': `${i + 1} of 5`, 'aria-pressed': cur === i + 1 ? 'true' : 'false',
      onClick: () => { const again = cur > 0; ratedHere.add(key); ctx.update(x => D.rateDay(x, key, i + 1)); toast(again ? `Changed to ${f}` : `Saved ${f}`, 'ok'); } }, f))));
}
function briefCard(lines, open, now) {
  const s = S(), hr = now.getHours(), yk = keyOf(addDays(startOfDay(now), -1));
  // one rating prompt at a time: before NIGHT_ENDS the Tonight card asks about the day that just ended (beta T01-12)
  const ask = hr >= D.NIGHT_ENDS && hr < 12 && s.rotas && Object.keys(s.rotas).length && (!D.dayRating(s, yk) || ratedHere.has(yk));
  const text = () => D.briefingText(lines, now);
  const share = h('div', { class: 'row brief-acts' }, navigator.share ? h('button', { class: 'btn sm ghost', onClick: () => navigator.share({ title: 'Today', text: text() }).catch(() => {}) }, 'Share') : null, h('button', { class: 'btn sm ghost', onClick: async () => { try { await navigator.clipboard.writeText(text()); toast('Copied', 'ok'); } catch { toast('Could not copy', 'err'); } } }, 'Copy'));
  return h('details', { class: 'card brief2', open: open ? '' : null }, h('summary', {}, h('span', { class: 'title' }, hr < 5 ? 'Overnight' : hr < 12 ? 'Your morning' : 'Your day'), h('span', { class: 'tiny dim' }, `${lines.length} things`)),
    lines.map(l => h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, l.icon), h('div', { class: 'grow small' }, l.text))), ask ? rateRow(yk, 'How was yesterday?') : null, share);
}
const dur = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;
function windCard(now, onShift) {
  const s = S(), w = D.windDown(s, now), early = now.getHours() < D.NIGHT_ENDS, key = keyOf(early ? addDays(startOfDay(now), -1) : startOfDay(now)), ins = D.dayInsights(s);
  if (!w.label && !ins.total) return null;
  const head = h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Tonight'), h('button', { class: 'btn sm ghost', 'aria-label': 'Sleep settings', onClick: sleepSheet }, '⚙'));
  // on shift: one quiet line instead of sleep advice you can't follow yet
  if (onShift) return h('div', { class: 'card wind' }, head, h('div', { class: 'small muted' }, `On shift until ${hm(onShift.getHours() * 60 + onShift.getMinutes())}. Your sleep plan shows when it ends.`), rateRow(key, early ? `How was ${dayName(key)}?` : 'How was today?'));
  const plan = !w.work ? (w.label ? h('div', { class: 'small' }, `${w.dayWord}: ${w.label}`) : null)
    : [h('div', { class: 'small' }, `${w.dayWord}: ${w.label}`),
      h('div', { class: `cr-key soon wind-key ${w.sleepNow ? 'now' : ''}` }, h('div', { class: 'grow' },
        h('b', {}, w.sleepNow ? `Sleep now: ${dur(w.sleepMin)} possible` : `${w.night ? 'Sleep until' : 'Be asleep by'} ${w.night ? hm(w.wake) : hm(w.bed)}`),
        h('div', { class: 'tiny dim' }, w.sleepNow ? `Up at ${hm(w.wake)} to be ready for ${hm(w.start)}` : `${w.sleepH}h of sleep, up at ${hm(w.wake)} to be ready for ${hm(w.start)}`)),
        !w.night && !w.sleepNow && w.minutesToBed > 0 && w.minutesToBed < 720 ? h('span', { class: 'chip' }, `in ${dur(w.minutesToBed)}`) : null)];
  return h('div', { class: 'card wind' }, head, plan, w.notes.map(n => h('div', { class: 'tiny dim wind-note' }, n)), rateRow(key, early ? `How was ${dayName(key)}?` : 'How was today?'), ins.lines.map(l => h('div', { class: 'small wind-ins' }, l)));
}
function sleepSheet() {
  const c = D.daySettings(S()), v = { sleepH: c.sleepH, prepMin: c.prepMin }, msgs = {}, save = h('button', { class: 'btn primary', onClick: () => {
    const r = Object.fromEntries(Object.keys(v).map(k => [k, D.checkSetting(k, v[k])])); if (!Object.values(r).every(x => x.ok)) return toast('Fix the highlighted value first', 'err');
    ctx.update(x => ({ ...x, settings: { ...x.settings, day: { sleepH: r.sleepH.value, prepMin: r.prepMin.value } } })); box.close(); ctx.render(); toast(`Saved · ${r.sleepH.value}h sleep, ${r.prepMin.value} min to get ready`, 'ok'); } }, 'Save');
  const check = () => { let ok = true; for (const k of Object.keys(v)) { const r = D.checkSetting(k, v[k]); ok &&= r.ok; msgs[k].textContent = r.ok ? '' : r.msg; msgs[k].previousElementSibling.setAttribute('aria-invalid', r.ok ? 'false' : 'true'); } save.disabled = !ok; };
  // labels are tied to their inputs (for/id) and every bad value says why, instead of being swapped silently (beta T01-10)
  const F = (k, label, unit, step) => { const [mn, mx] = D.SLEEP_LIMITS[k], id = `sl-${k}`; msgs[k] = h('div', { class: 'tiny field-err', id: `${id}-err`, 'aria-live': 'polite' });
    return h('div', { class: 'field' }, h('label', { for: id }, label, h('span', { class: 'dim' }, ` (${mn}–${mx} ${unit})`)), h('input', { id, type: 'number', inputmode: 'decimal', min: mn, max: mx, step, value: v[k], 'aria-describedby': `${id}-err`, onInput: (e) => { v[k] = e.target.value; check(); } }), msgs[k]); };
  const box = ctx.sheet([h('h2', {}, 'Sleep'), F('sleepH', 'Hours of sleep you aim for', 'h', 0.5), F('prepMin', 'Minutes to get ready before a shift', 'min', 5), h('div', { class: 'tiny dim' }, 'Bedtime = shift start − getting ready − sleep.'), save]);
}

// ───────── study
function studyCard(now) {
  const s = S(), subs = D.subjects(s), key = keyOf(startOfDay(now));
  if (!subs.length) return h('div', { class: 'card study-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Study'), h('button', { class: 'btn sm', onClick: () => studySheet() }, 'Set up')), h('div', { class: 'small muted' }, 'Plan study blocks around your shifts for your medical apps, with streaks.'));
  const plan = D.studyPlan(s, now, { busyOf: ctx.busyOf, planned: ctx.planned }), todays = plan.filter(p => p.date === key), streak = D.studyStreak(s, now);
  return h('div', { class: 'card study-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Study'), streak ? h('span', { class: 'chip sel' }, `🔥 ${streak} day${streak > 1 ? 's' : ''}`) : null, h('button', { class: 'btn sm ghost', onClick: () => studySheet() }, 'Plan')),
    subs.map(sub => { const wk = D.weekMinutes(s, sub.id, now), pct = Math.min(100, Math.round(wk / (sub.perWeek || 1) * 100)), today = D.studyOn(s, key, sub.id), blk = todays.find(p => p.subject === sub.id);
      return h('div', { class: 'study-row' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, sub.name), h('div', { class: 'tiny dim' }, blk ? `Today ${hm(blk.start)}–${hm(blk.end)}${blk.fromPlan ? ' · in your plan' : ''}` : today ? `${today} min today` : 'No window today')), sub.app && ctx.hasApp?.(sub.app) ? h('button', { class: 'btn sm ghost', onClick: () => ctx.launchApp(sub.app) }, 'Open') : null,
        today ? h('button', { class: 'btn sm ghost', 'aria-label': `Take 15 minutes off ${sub.name}`, onClick: () => logTap(key, sub, -15) }, '−15') : null,
        [15, 30].map(m => h('button', { class: 'btn sm', 'aria-label': `Log ${m} minutes of ${sub.name}`, onClick: () => logTap(key, sub, m) }, `+${m}`))), h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })), h('div', { class: 'tiny dim' }, `${wk} of ${sub.perWeek} min this week`)); }));
}
// A second tap on the same button within a moment is a double tap, not another block; every log can be undone (beta T01-24).
let lastTap = { k: '', at: 0 };
function logTap(key, sub, m) {
  const k = `${key}:${sub.id}:${m}`, t = Date.now(); if (lastTap.k === k && t - lastTap.at < 700) return; lastTap = { k, at: t };
  const before = D.studyOn(S(), key, sub.id); ctx.update(x => D.logStudy(x, key, sub.id, m)); const after = D.studyOn(S(), key, sub.id);
  if (after !== before) undoToast(`${sub.name}: ${after} min today`, () => ctx.update(x => D.logStudy(x, key, sub.id, before - D.studyOn(x, key, sub.id))));
}
function studySheet() {
  const wrap = h('div', {}), box = ctx.sheet([wrap]); const paint = () => {
    const s = S(), subs = D.subjects(s), plan = D.studyPlan(s, new Date(), { busyOf: ctx.busyOf, planned: ctx.planned }), have = new Set(subs.map(x => x.name)), left = D.SUBJECT_STARTERS.filter(x => !have.has(x.name));
    wrap.replaceChildren(h('h2', {}, 'Study plan'),
      left.length ? h('div', { class: 'card' }, h('div', { class: 'small' }, 'Your apps'), h('div', { class: 'chips', style: { marginTop: '6px' } }, left.map(x => h('button', { class: 'chip', onClick: () => { ctx.update(st => D.saveSubject(st, { ...x, perWeek: 150, block: 45 })); setTimeout(paint, 0); } }, `＋ ${x.name}`)))) : null,
      subs.map(sub => { const v = { ...sub }; return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, sub.name), h('button', { class: 'btn sm ghost', 'aria-label': `Delete ${sub.name}`, onClick: () => { if (confirm(`Remove ${sub.name}?`)) { ctx.update(st => D.deleteSubject(st, sub.id)); setTimeout(paint, 0); } } }, '🗑')),
        h('div', { class: 'row wrap' }, field('Minutes a week', h('input', { type: 'number', min: 0, max: 3000, step: 15, value: sub.perWeek, onChange: (e) => { ctx.update(st => D.saveSubject(st, { ...sub, perWeek: +e.target.value })); setTimeout(paint, 0); } })), field('Block length (min)', h('input', { type: 'number', min: 15, max: 240, step: 5, value: sub.block, onChange: (e) => { ctx.update(st => D.saveSubject(st, { ...sub, block: +e.target.value })); setTimeout(paint, 0); } })))); }),
      h('div', { class: 'card' }, h('input', { id: 'new-subj', placeholder: 'Another subject…', maxlength: 60, 'aria-label': 'New subject name (up to 60 characters)' }), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onClick: () => { const i = wrap.querySelector('#new-subj'); if (!i.value.trim()) return toast('Name it first', 'err'); ctx.update(st => D.saveSubject(st, { name: i.value })); setTimeout(paint, 0); } }, 'Add')),
      h('div', { class: 'title', style: { marginTop: '10px' } }, 'The week ahead'), plan.length ? plan.map(p => h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'tiny dim' }, `${fd(p.date)} ${hm(p.start)}–${hm(p.end)}${p.fromPlan ? ` · your plan: ${p.title}` : ''}`)))) : h('div', { class: 'small muted' }, subs.length ? 'No free windows found, or the weekly targets are already met.' : 'Add a subject to see where it fits around your shifts.'));
  }; paint();
}
