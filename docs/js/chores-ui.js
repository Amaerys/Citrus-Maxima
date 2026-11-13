// Home: room cleaning, laundry and other chores, planned around your shifts. A segment of the Work tab and a card on Today.
import { h, toast, keyOf, fromKey, addDays, relDay, fmtMin, fmtDur, DAY_SHORT } from './util.js';
import * as C from './chores.js';
import * as CAL from './chores-cal.js';

let ctx = null;
export function initChores(c) { ctx = c; }
const S = () => ctx.S();
const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
const asDate = (d) => typeof d === 'string' ? fromKey(d) : d;
/** "Fri · Today", "Sat · Tomorrow", "Sun 15/11" — relDay already carries the weekday beyond tomorrow. */
export function dayLabel(d, now = new Date()) { d = asDate(d); const r = relDay(d, now); return /^(Today|Tomorrow|Yesterday)$/.test(r) ? `${DAY_SHORT[d.getDay()]} · ${r}` : r; }
const slotText = (x) => `${dayLabel(x.date)} ${fmtMin(x.start)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function status(c, now = new Date()) {
  if (c.next && c.next.date >= keyOf(now)) return { cls: 'plan', text: `Planned ${slotText({ date: c.next.date, start: c.next.start })}` };
  const late = C.daysLate(c, now);
  if (!c.lastDone) return { cls: 'due', text: 'Never logged — due now' };
  return late > 0 ? { cls: 'late', text: `${plural(late, 'day')} overdue` } : late === 0 ? { cls: 'due', text: 'Due today' } : { cls: 'ok', text: `Due ${relDay(C.dueDate(c, now))}` };
}

/** A toast with buttons (Undo, "It was yesterday"): util's toast() is text-only. */
function actionToast(msg, actions, ms = 6000) {
  let host = document.getElementById('toasts'); if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  let t = null; const close = () => { if (!t) return; t.classList.remove('show'); const x = t; t = null; setTimeout(() => x.remove(), 300); };
  t = h('div', { class: 'toast ch-toast', role: 'status' }, h('span', { class: 'grow' }, msg), ...actions.map(([label, fn]) => h('button', { class: 'btn sm ghost', onClick: () => { close(); fn(); } }, label)));
  host.append(t); setTimeout(() => t && t.classList.add('show'), 10); setTimeout(close, ms);
}

const sayRemoved = (r) => r === 'removed' ? 'Old time removed from your calendar' : r === 'unqueued' ? 'Old time dropped' :r === 'queued' ? 'Old time leaves your calendar when back online' : r === 'unknown' ? 'Remove the old time in Google Calendar yourself' : '';
/** Plan (or move) a chore: one calendar copy at a time, and one honest toast about where it went. */
async function schedule(c, slot) {
  const old = c.next, res = await CAL.place(c, slot);
  ctx.update(s => C.updateChore(s, c.id, { next: res.next }));
  const gone = old ? await CAL.remove(old) : '', when = slotText({ date: slot.key, start: slot.start });
  const where = res.how === 'cal' ? 'in your calendar' : res.how === 'queued' ? `saved; ${CAL.waitingWhy()}` : `saved here only (calendar said: ${res.error})`;
  toast(`${c.title} → ${when}: ${where}${gone ? `. ${sayRemoved(gone)}` : ''}`, res.how === 'local' || gone === 'unknown' ? 'err' : 'ok');
}

/** Done ✓ (Home and Today): a plan still ahead of now leaves the calendar; Undo and "It was yesterday" ride on the toast. */
async function done(c) {
  const prev = S().chores?.[c.id]; if (!prev) return;
  const now = new Date(), ahead = prev.next && fromKey(prev.next.date).getTime() + prev.next.start * 6e4 > +now;
  ctx.update(s => C.markDone(s, c.id)); ctx.render();
  const gone = ahead ? await CAL.remove(prev.next) : '';
  actionToast(`${c.title} done${gone ? ` · ${sayRemoved(gone).replace('Old time', 'plan')}` : ''}`, [
    ['Undo', () => { ctx.update(s => s.chores?.[c.id] ? { ...s, chores: { ...s.chores, [c.id]: gone ? { ...prev, next: null } : prev } } : s); ctx.render(); }],
    ['It was yesterday', () => { ctx.update(s => C.markDone(s, c.id, keyOf(addDays(now, -1)))); ctx.render(); }]]);
}

function slotMeta(c, x) {
  const due = !c.lastDone ? '' : x.late > 0 ? `${plural(x.late, 'day')} past due` : x.late === 0 ? 'on the due day' : `${plural(-x.late, 'day')} early`;
  const why = x.unknown ? 'rota unknown' : x.off ? 'day off' : x.after ? `after ${x.after}` : x.before ? `before ${x.before}` : '';
  const room = x.until >= 1440 ? 'free till midnight' : `free till ${fmtMin(x.until)}`;
  return [due, why, room].filter(Boolean).join(' · ');
}

function planSheet(c) {
  const now = new Date(), own = c.next;
  // the chore's own planned event must not block its own re-plan
  const busyOf = (d) => (ctx.busyOf ? ctx.busyOf(d) : []).filter(b => !(own && keyOf(d) === own.date && b[0] === own.start));
  const slots = C.suggestSlots(S(), c, { busyOf, count: 4, now }), box = ctx.sheet([]), gaps = C.rotaGaps(S(), { now });
  const gapMonths = [...new Set(gaps.map(d => d.toLocaleString('en', { month: 'long' })))];
  const pick = async (x) => { box.close(); await schedule(c, x); ctx.render(); };
  const d = h('input', { type: 'date', value: keyOf(now), min: keyOf(now) }), t = h('input', { type: 'time', value: '10:00' }), err = h('div', { class: 'ch-err', role: 'alert' });
  box.box.classList.add('ch-sheet');
  box.box.append(h('h2', {}, `${c.icon} ${c.title}`),
    h('div', { class: 'small muted ch-intro' }, `${fmtDur(c.mins)} · best times around your shifts and calendar${own ? ` · now ${slotText({ date: own.date, start: own.start })}` : ''}.`),
    slots.length ? h('div', { class: 'list ch-slots' }, slots.map(x => h('button', { class: `item clickable${x.unknown ? ' unknown' : ''}`, onClick: () => pick(x) },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${dayLabel(x.date, now)} · ${fmtMin(x.start)}–${fmtMin(x.end)}`), h('div', { class: 'meta' }, slotMeta(c, x))), h('span', { class: 'chip sel' }, own ? 'Move' : 'Plan'))))
      : h('div', { class: 'card empty' }, `No free ${fmtDur(c.mins)} stretch in the next 10 days around your shifts and calendar. Pick a time yourself below.`),
    gapMonths.length ? h('div', { class: 'tiny dim ch-gap' }, `No rota for ${gapMonths.join(' / ')} yet: those days are guessed as daytime. Load the rota in Work to plan around shifts.`) : null,
    h('details', { class: 'ch-own', open: slots.length ? null : '' }, h('summary', {}, 'Pick a time myself'),
      h('div', { class: 'grid2' }, field('Day', d), field('Start', t)), err,
      h('button', { class: 'btn primary', onClick: async () => {
        if (!d.value || !t.value) return; const [a, b] = t.value.split(':').map(Number), st = a * 60 + b;
        if (fromKey(d.value).getTime() + st * 6e4 < Date.now()) { err.textContent = 'That time has passed'; return; }
        await pick({ key: d.value, date: fromKey(d.value), start: st, end: Math.min(st + c.mins, 1439) }); } }, own ? 'Move it' : 'Plan it')));
}

export function editSheet(c) {
  const today = keyOf(new Date());
  const t = h('input', { value: c?.title || '', placeholder: 'e.g. Room cleaning', maxlength: C.LIMITS.title }), ic = h('input', { value: c?.icon || '🏠', style: { width: '70px' }, 'aria-label': 'Icon' }),
    ev = h('input', { type: 'number', min: 1, max: 365, value: c?.every || 7, inputmode: 'numeric' }), mn = h('input', { type: 'number', min: 5, max: 480, value: c?.mins || 60, inputmode: 'numeric' }), ld = h('input', { type: 'date', value: c?.lastDone || '', max: today });
  const err = h('div', { class: 'ch-err', role: 'alert' }); let dupOk = false;
  const save = h('button', { class: 'btn primary grow', onClick: () => {
    const v = { id: c?.id, title: t.value, icon: ic.value, every: ev.value, mins: mn.value, lastDone: ld.value }, bad = C.validate(v, S());
    const hard = [bad.title, bad.every, bad.mins, bad.lastDone].filter(Boolean);
    if (hard.length) { err.textContent = hard.join(' · '); return; }
    if (bad.dup && !dupOk) { err.textContent = `${bad.dup}. Tap again to add it anyway.`; dupOk = true; save.textContent = 'Save anyway'; return; }
    ctx.update(s => c ? C.updateChore(s, c.id, v) : C.addChore(s, v)); box.close(); ctx.render(); } }, 'Save');
  t.addEventListener('input', () => { dupOk = false; save.textContent = 'Save'; err.textContent = ''; });
  const box = ctx.sheet([h('h2', {}, c ? 'Edit chore' : 'New chore'), h('div', { class: 'ch-name-row' }, field('Icon', ic), field('Name', t)), h('div', { class: 'grid2' }, field('Repeat every (days)', ev), field('Takes (minutes)', mn)), field('Last done', ld), err,
    h('div', { class: 'row wrap' }, save,
      c ? h('button', { class: 'btn danger', onClick: async () => { if (!confirm(`Delete ${c.title}?`)) return; const n = S().chores?.[c.id]?.next; ctx.update(s => C.deleteChore(s, c.id)); box.close(); ctx.render(); const r = n ? await CAL.remove(n) : ''; if (r) toast(`${c.title} deleted · ${sayRemoved(r).replace('Old time', 'its plan')}`); } }, 'Delete') : null)]);
  box.box.classList.add('ch-sheet');
}

/** A brand-new chore asks when it was last done, instead of starting everything "due now". */
const askLast = (c) => h('div', { class: 'ch-ask' }, h('span', { class: 'tiny dim' }, 'Last done?'),
  [['today', 'Today'], ['few', 'A few days ago'], ['week', 'A week+ ago']].map(([k, l]) => h('button', { class: 'chip', onClick: () => { ctx.update(s => C.updateChore(s, c.id, { lastDone: C.lastDoneFrom(k, c) })); ctx.render(); } }, l)));

const card = (c) => { const st = status(c);
  return h('div', { class: `card chore st-${st.cls}` },
    h('div', { class: 'row' }, h('div', { class: 'ch-ic' }, c.icon), h('div', { class: 'grow ch-main' }, h('div', { class: 'name' }, c.title), h('div', { class: 'tiny dim' }, `every ${plural(c.every, 'day')} · ${fmtDur(c.mins)}${c.lastDone ? ` · last ${relDay(fromKey(c.lastDone))}` : ''}`)), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${c.title}`, onClick: () => editSheet(c) }, '⋯')),
    h('div', { class: `ch-status ${st.cls}` }, st.text),
    !c.lastDone ? askLast(c) : null,
    h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => planSheet(c) }, c.next ? 'Re-plan' : 'Find a time'), h('button', { class: 'btn primary grow', onClick: () => done(c) }, 'Done ✓'))); };

export function renderHome() {
  const now = new Date(), list = C.choreList(S(), now), have = new Set(list.map(c => c.title.toLowerCase()));
  const late = list.filter(c => c.lastDone && C.daysLate(c, now) > 0).length, plan = list.filter(c => c.next && c.next.date >= keyOf(now)).length;
  const dueNow = list.filter(c => !(c.next && c.next.date >= keyOf(now)) && (!c.lastDone || C.daysLate(c, now) === 0)).length;
  const sum = list.length ? [late ? `${late} overdue` : '', dueNow ? `${dueNow} due today` : '', plan ? `${plan} planned` : ''].filter(Boolean).join(' · ') || 'all on track' : '';
  const out = [h('div', { class: 'small muted ch-lead' }, 'Chores that Citrus fits around your shifts: days off first, short ones after work, never right before a night.', sum ? h('b', { class: 'ch-sum' }, ` ${sum}`) : null)];
  out.push(h('div', { class: 'ch-grid' }, ...list.map(card)));
  const rest = C.PRESETS.filter(p => !have.has(p.title.toLowerCase()));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, list.length ? 'Add another' : 'Start with'), h('div', { class: 'chips' }, rest.map(p => h('button', { class: 'chip', onClick: () => { ctx.update(s => C.addChore(s, p)); ctx.render(); } }, `${p.icon} ${p.title}`)), h('button', { class: 'chip', onClick: () => editSheet(null) }, '+ Your own'))));
  return out;
}

/** Today: only what is due soon, with one tap to a time. */
export function todayCard() {
  const due = C.dueSoon(S()); if (!due.length) return null;
  const late = due.filter(x => x.c.lastDone && x.late > 0).length;
  return h('div', { class: `card chores-today${late ? ' has-late' : ''}` }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Home', late ? h('span', { class: 'ch-badge' }, `${late} overdue`) : null), h('button', { class: 'btn sm ghost', onClick: () => { ctx.go('rota', 'home'); } }, due.length > 3 ? `All ${due.length}` : 'All chores')),
    due.slice(0, 3).map(({ c }) => { const st = status(c); return h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, c.icon), h('div', { class: 'grow ch-main' }, h('div', { class: 'name' }, c.title), h('div', { class: `ch-status ${st.cls}` }, st.text)), h('button', { class: 'btn sm', onClick: () => planSheet(c) }, c.next ? 'Move' : 'Plan'), h('button', { class: 'btn sm primary', 'aria-label': `${c.title} done`, onClick: () => done(c) }, '✓')); }));
}
/** Rank for the Today card: above Plan (70) when something is overdue. app.js still passes a fixed 62 (see D07 report). */
export const todayScore = () => C.dueSoon(S()).some(x => x.c.lastDone && x.late > 0) ? 72 : 62;
