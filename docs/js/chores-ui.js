// Home: room cleaning, laundry and other chores, planned around your shifts. A segment of the Work tab and a card on Today.
import { h, toast, keyOf, fromKey, relDay, fmtMin, fmtDur, DAY_SHORT } from './util.js';
import * as C from './chores.js';

let ctx = null;
export function initChores(c) { ctx = c; }
const S = () => ctx.S();
const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
const slotText = (x) => `${relDay(typeof x.date === 'string' ? fromKey(x.date) : x.date)} ${fmtMin(x.start)}`;

function status(c, now = new Date()) {
  if (c.next && c.next.date >= keyOf(now)) return { cls: 'plan', text: `Planned ${slotText({ date: c.next.date, start: c.next.start })}` };
  const late = C.daysLate(c, now);
  if (!c.lastDone) return { cls: 'due', text: 'Never done — due now' };
  return late > 0 ? { cls: 'late', text: `${late} day${late === 1 ? '' : 's'} overdue` } : late === 0 ? { cls: 'due', text: 'Due today' } : { cls: 'ok', text: `Due ${relDay(C.dueDate(c, now))}` };
}

async function schedule(c, slot) {
  ctx.update(s => C.updateChore(s, c.id, { next: { date: slot.key, start: slot.start } }));
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  try { await ctx.addEvent({ title: `${c.icon} ${c.title}`, date: slot.key, start: hm(slot.start), end: hm(slot.end), minutes: c.mins, text: 'Planned by Citrus around your shifts.' }); toast(`${c.title}: ${slotText({ date: slot.key, start: slot.start })} (added to your calendar)`); }
  catch { toast(`${c.title}: ${slotText({ date: slot.key, start: slot.start })} (saved here; connect Google to add it to your calendar)`); }
}

function planSheet(c) {
  const slots = C.suggestSlots(S(), c, { busyOf: ctx.busyOf, count: 4 }), box = ctx.sheet([]);
  const body = [h('h2', {}, `${c.icon} ${c.title}`), h('div', { class: 'small muted', style: { margin: '4px 0 12px' } }, `Best times around your shifts and calendar for ${fmtDur(c.mins)}.`),
    slots.length ? h('div', { class: 'list' }, slots.map(x => h('button', { class: 'item clickable', onClick: async () => { box.close(); await schedule(c, x); ctx.render(); } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${DAY_SHORT[x.date.getDay()]} ${relDay(x.date)} · ${fmtMin(x.start)}–${fmtMin(x.end)}`), h('div', { class: 'meta' }, x.late > 0 ? `${x.late} day${x.late === 1 ? '' : 's'} past due` : x.late === 0 ? 'On the due day' : `${-x.late} day${x.late === -1 ? '' : 's'} early`)), h('span', { class: 'chip sel' }, 'Plan'))))
      : h('div', { class: 'card empty' }, 'No free stretch long enough in the next days. Shorten it, or pick a time yourself below.'),
    h('details', { style: { marginTop: '12px' } }, h('summary', {}, 'Pick a time myself'), (() => { const d = h('input', { type: 'date', value: keyOf(new Date()) }), t = h('input', { type: 'time', value: '10:00' });
      return [field('Day', d), field('Start', t), h('button', { class: 'btn primary', onClick: async () => { if (!d.value || !t.value) return; const [a, b] = t.value.split(':').map(Number), st = a * 60 + b; box.close(); await schedule(c, { key: d.value, start: st, end: st + c.mins }); ctx.render(); } }, 'Plan it')]; })())];
  box.box.append(...body);
}

export function editSheet(c) {
  const t = h('input', { value: c?.title || '', placeholder: 'e.g. Room cleaning' }), ic = h('input', { value: c?.icon || '🏠', style: { width: '70px' } }), ev = h('input', { type: 'number', min: 1, max: 365, value: c?.every || 7 }), mn = h('input', { type: 'number', min: 5, max: 480, value: c?.mins || 60 }), ld = h('input', { type: 'date', value: c?.lastDone || '' });
  const box = ctx.sheet([h('h2', {}, c ? 'Edit chore' : 'New chore'), field('Name', t), field('Icon', ic), h('div', { class: 'grid2' }, field('Repeat every (days)', ev), field('Takes (minutes)', mn)), field('Last done', ld),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { if (!t.value.trim()) return toast('Give it a name', 'err'); ctx.update(s => c ? C.updateChore(s, c.id, { title: t.value, icon: ic.value, every: ev.value, mins: mn.value, lastDone: ld.value }) : C.addChore(s, { title: t.value, icon: ic.value, every: ev.value, mins: mn.value, lastDone: ld.value })); box.close(); ctx.render(); } }, 'Save'),
      c ? h('button', { class: 'btn danger', onClick: () => { if (confirm(`Delete ${c.title}?`)) { ctx.update(s => C.deleteChore(s, c.id)); box.close(); ctx.render(); } } }, 'Delete') : null)]);
}

const card = (c) => { const st = status(c);
  return h('div', { class: `card chore ${st.cls}` },
    h('div', { class: 'row' }, h('div', { class: 'ch-ic' }, c.icon), h('div', { class: 'grow' }, h('div', { class: 'name' }, c.title), h('div', { class: 'tiny dim' }, `every ${c.every} day${c.every === 1 ? '' : 's'} · ${fmtDur(c.mins)}${c.lastDone ? ` · last ${relDay(fromKey(c.lastDone))}` : ''}`)), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${c.title}`, onClick: () => editSheet(c) }, '⋯')),
    h('div', { class: `ch-status ${st.cls}` }, st.text),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => planSheet(c) }, c.next ? 'Re-plan' : 'Find a time'), h('button', { class: 'btn primary grow', onClick: () => { ctx.update(s => C.markDone(s, c.id)); toast(`${c.title} done`); ctx.render(); } }, 'Done ✓'))); };

export function renderHome() {
  const list = C.choreList(S()), have = new Set(list.map(c => c.title.toLowerCase()));
  const out = [h('div', { class: 'small muted', style: { margin: '2px 0 10px' } }, 'Chores that Citrus fits around your shifts: days off first, after work on shift days, never right before a night.')];
  out.push(...list.map(card));
  const rest = C.PRESETS.filter(p => !have.has(p.title.toLowerCase()));
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, list.length ? 'Add another' : 'Start with'), h('div', { class: 'chips' }, rest.map(p => h('button', { class: 'chip', onClick: () => { ctx.update(s => C.addChore(s, p)); ctx.render(); } }, `${p.icon} ${p.title}`)), h('button', { class: 'chip', onClick: () => editSheet(null) }, '+ Your own'))));
  return out;
}

/** Today: only what is due soon, with one tap to a time. */
export function todayCard() {
  const due = C.dueSoon(S()); if (!due.length) return null;
  return h('div', { class: 'card chores-today' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Home'), h('button', { class: 'btn sm ghost', onClick: () => { ctx.go('rota', 'home'); } }, 'All chores')),
    due.slice(0, 3).map(({ c }) => { const st = status(c); return h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, c.icon), h('div', { class: 'grow' }, h('div', { class: 'name' }, c.title), h('div', { class: `ch-status ${st.cls}` }, st.text)), h('button', { class: 'btn sm', onClick: () => planSheet(c) }, c.next ? 'Move' : 'Plan'), h('button', { class: 'btn sm primary', 'aria-label': `${c.title} done`, onClick: () => { ctx.update(s => C.markDone(s, c.id)); ctx.render(); } }, '✓')); }));
}
