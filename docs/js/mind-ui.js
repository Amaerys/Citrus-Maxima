// Mind screens. One view with six segments (Overview · Tasks · Habits · Aims · Reflect · Year), plus the card on Today,
// the capture bar, the inbox from other apps, and the sheets. app.js hands over what it owns through initMind(ctx).
import { h, toast, keyOf, fromKey, addDays, startOfDay, fmtDate, relDay, DAY_SHORT, MONTHS } from './util.js';
import { weekStartOf } from './planner.js';
import * as M from './mind.js';
import { ring, spark, bars, heat, radar, tree } from './mind-viz.js';
import * as L from './media.js';
import { initMedia, logReadingSheet, renderLibrary, renderNotes, mediaSearchItems, quickNote, quickLog } from './media-ui.js';

let ctx = null;
export function initMind(c) { ctx = c; ctx.openTask = (p) => openTask(p); initMedia(ctx); }
const S = () => ctx.S();
const up = (fn) => ctx.update(fn);
const now = () => new Date();
const apps = () => ctx.apps();
const ui = { seg: 'overview', area: '', doneOpen: false, year: new Date().getFullYear(), pop: '', lock: 0, kit: null };
export const mindSeg = () => ui.seg;
export function setSeg(seg, area = '') { ui.seg = seg; ui.area = area; }

// one order for the launcher grid and the ‹ › steps: SEGS is read off GROUPS
const GROUPS = [['Today', ['overview', 'tasks', 'habits']], ['Direction', ['aims', 'year', 'reflect']], ['Keep', ['library', 'notes']]];
const SEG_META = { overview: ['Overview', '◉'], tasks: ['Tasks', '✓'], habits: ['Habits', '🔁'], aims: ['Aims', '🎯'], reflect: ['Reflect', '✎'], year: ['Year', '🗓'], library: ['Library', '📚'], notes: ['Notes', '📝'] };
const SEGS = GROUPS.flatMap(([, ids]) => ids).map(id => [id, ...SEG_META[id]]);
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const areaColor = (id) => M.areaOf(id)?.color || 'var(--muted)';
const pctTxt = (v) => v == null ? '–' : `${Math.round(v * 100)}%`;
const firstUrl = (t) => { const m = /https?:\/\/[^\s)]+/.exec(t || ''); return m ? m[0] : ''; };
const dueLabel = (k) => k ? relDay(fromKey(k), now()) : '';

// ───────────────────────────────────────── small form helpers
const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
function pick(options, value, onPick, cls = '') {
  const box = h('div', { class: `seg wrap ${cls}` });
  const paint = (v) => { for (const b of box.children) b.classList.toggle('active', b.dataset.v === String(v)); };
  for (const [v, label, color] of options) box.append(h('button', { type: 'button', dataset: { v: String(v) }, style: color ? { '--c': color } : null, onClick: () => { paint(v); onPick(v); } }, label));
  paint(value); return box;
}
const areaPick = (value, onPick) => pick([['', 'None'], ...M.AREAS.map(a => [a.id, `${a.emoji} ${a.name}`, a.color])], value, onPick);
function aimSelect(value, onPick) {
  const sel = h('select', { onChange: () => onPick(sel.value) }, h('option', { value: '' }, 'None'), ...Object.values(S().aims || {}).filter(a => a.status !== 'done').map(a => h('option', { value: a.id }, a.title)));
  sel.value = value || ''; return sel;
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const confirmBtn = (label, fn) => { const b = h('button', { class: 'btn danger', onClick: () => { if (b.dataset.sure) fn(); else { b.dataset.sure = 1; b.textContent = 'Tap again to confirm'; setTimeout(() => { delete b.dataset.sure; b.textContent = label; }, 3000); } } }, label); return b; };

// ───────────────────────────────────────── undo: a complete or a delete can be taken back for 5 s
let undoTimer = 0;
export function undoToast(msg, onUndo) {
  let host = document.getElementById('toasts'); if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  host.querySelector('.toast.undo')?.remove(); clearTimeout(undoTimer);
  const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  const t = h('div', { class: 'toast undo', role: 'status' }, h('span', { class: 'u-msg' }, msg),
    h('button', { type: 'button', class: 'u-btn', onClick: () => { clearTimeout(undoTimer); close(); onUndo(); toast('Undone'); } }, 'Undo'));
  host.append(t); setTimeout(() => t.classList.add('show'), 10); undoTimer = setTimeout(close, 5000);
}
// After a task is ticked the list re-renders and slides up under the finger, so a quick second tap would land on the
// next row. Taps on task rows are ignored until the list has settled.
const TICK_ANIM = 260, TICK_GUARD = 600;
const locked = () => Date.now() < ui.lock;
function tickTask(e, t) {
  e.stopPropagation(); if (locked()) return;
  if (t.done) { ui.lock = Date.now() + TICK_GUARD; up(st => M.setTaskDone(st, t.id, false)); return; }
  ui.lock = Date.now() + TICK_ANIM + TICK_GUARD;
  e.currentTarget.closest('.mrow')?.classList.add('fire');
  setTimeout(() => {
    ui.lock = Date.now() + TICK_GUARD; up(st => M.setTaskDone(st, t.id, true));
    undoToast(`Done · ${t.title.length > 34 ? t.title.slice(0, 33) + '…' : t.title}`, () => up(st => M.setTaskDone(st, t.id, false)));
  }, TICK_ANIM);
}

// ───────────────────────────────────────── capture: type a thought, it becomes a task
export function captureBar({ compact = false } = {}) {
  const input = h('input', { type: 'text', placeholder: 'Capture… “call bank tomorrow 20m !”', 'aria-label': 'Capture a task', enterkeyhint: 'done', autocomplete: 'off', maxlength: 200, dataset: { cap: compact ? 'compact' : 'main' } });
  const hint = h('div', { class: 'cap-hint' });
  const paint = () => {
    const p = M.parseCapture(input.value, now()); hint.replaceChildren();
    if (!input.value.trim()) return;
    if (p.due) hint.append(h('span', { class: 'chip' }, '📅 ', dueLabel(p.due)));
    if (p.est) hint.append(h('span', { class: 'chip' }, '⏱ ', p.est >= 60 ? `${p.est / 60}h` : `${p.est}m`));
    if (p.pri) hint.append(h('span', { class: 'chip hot' }, M.PRI[p.pri]));
    if (p.warn) hint.append(h('span', { class: 'chip warnc' }, '⚠ ', p.warn));
    if (!p.title) hint.append(h('span', { class: 'chip warnc' }, 'Add a few words'));
  };
  const submit = () => {
    const p = M.parseCapture(input.value, now()); if (!input.value.trim()) return;
    if (!p.title) { toast('Add a few words — what needs doing?'); input.focus(); return; }
    const id = 't' + Math.random().toString(36).slice(2, 9), view = input.closest('section.view')?.id, key = input.dataset.cap;
    input.value = ''; ui.pop = id; up(s => M.addTask(s, { ...p, id })); if (p.est && p.due) ctx.regenerate?.();
    toast(p.warn ? `Captured · ${p.warn}, so no due date` : 'Captured');
    // the render replaced this input: focus the new one (still inside the tap/Enter) so the phone keyboard stays up
    (document.querySelector(`${view ? '#' + view + ' ' : ''}.capture input[data-cap="${key}"]`) || input).focus();
  };
  input.addEventListener('input', paint); input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  return h('div', { class: `capture ${compact ? 'compact' : ''}` }, h('div', { class: 'cap-row' }, h('span', { class: 'cap-dot', 'aria-hidden': 'true' }), input, h('button', { class: 'btn sm primary', onClick: submit }, 'Add')), hint);
}

// ───────────────────────────────────────── rows
function taskRow(t, { showArea = true } = {}) {
  const s = S(), area = M.taskArea(s, t), aim = s.aims?.[t.aimId], late = !t.done && t.due && t.due < keyOf(now());
  const blk = !t.done && M.taskBlock(s, t);
  const check = h('button', { class: `tick ${t.done ? 'on' : ''} ${ui.pop === t.id ? 'enter' : ''}`, 'aria-label': t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`, style: { '--c': areaColor(area) }, onClick: (e) => tickTask(e, t) }, h('i'));
  return h('div', { class: `mrow task ${t.done ? 'done' : ''} ${t.pri ? 'pri' + t.pri : ''}`, onClick: () => { if (!locked()) taskSheet(t.id); } },
    check,
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, t.title),
      h('div', { class: 'msub' },
        t.due ? h('span', { class: late ? 'late' : '' }, dueLabel(t.due)) : null,
        t.est ? h('span', {}, `${t.est >= 60 ? t.est / 60 + 'h' : t.est + 'm'}`) : null,
        blk ? h('span', { class: 'ok' }, `⏰ ${fmtMinStr(blk.start)}`) : null,
        showArea && area ? h('span', { style: { color: areaColor(area) } }, M.areaOf(area)?.name) : null,
        aim ? h('span', {}, '◆ ', aim.title) : null,
        t.srcApp ? h('span', { class: 'src' }, `from ${t.srcApp}`) : null,
        t.remindAt && !t.done ? h('span', {}, '🔔') : null)),
    !t.done && firstUrl(t.notes) ? h('a', { class: 'btn sm', href: firstUrl(t.notes), target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() }, 'Open ▸') : null,
    t.pri ? h('span', { class: 'flag', title: M.PRI[t.pri] }, t.pri === 2 ? '‼' : '!') : null);
}
const fmtMinStr = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function habitDots(hb, days = 7) {
  const s = S(), n = now(), tk = keyOf(n), wrap = h('div', { class: 'hdots' });
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(startOfDay(n), -i), k = keyOf(d), due = M.habitDue(hb, d), done = M.habitDone(s, hb, k, apps(), tk);
    wrap.append(h('button', { class: `hd ${done ? 'on' : ''} ${due ? '' : 'off'} ${k === tk ? 'today' : ''}`, title: `${DAY_SHORT[d.getDay()]} ${fmtDate(d)}`, 'aria-label': `${DAY_SHORT[d.getDay()]} ${done ? 'done' : 'not done'}`, style: { '--c': areaColor(M.habitArea(s, hb)) },
      onClick: (e) => { e.stopPropagation(); up(st => M.logHabit(st, hb.id, k, !M.habitDone(st, hb, k, apps(), tk))); } }, h('span', {}, DAY_SHORT[d.getDay()].slice(0, 2))));
  }
  return wrap;
}
function habitRow(hb, { dots = true } = {}) {
  const s = S(), n = now(), tk = keyOf(n), done = M.habitDone(s, hb, tk, apps(), tk), auto = !s.habitLog?.[hb.id]?.[tk] && M.autoDone(s, hb, tk, apps(), tk);
  const due = M.habitDue(hb, n), st = M.habitStreak(s, hb, n, apps()), color = areaColor(M.habitArea(s, hb));
  const wk = hb.freq?.type === 'weekly' ? M.habitWeekCount(s, hb, weekStartOf(n), n, apps()) : null;
  const check = h('button', { class: `tick ${done ? 'on' : ''} ${ui.pop === 'h' + hb.id ? 'enter' : ''}`, style: { '--c': color }, 'aria-label': done ? `Undo ${hb.name}` : `Do ${hb.name}`, onClick: (e) => { e.stopPropagation(); ui.pop = done ? '' : 'h' + hb.id; up(x => M.logHabit(x, hb.id, tk, !done)); } }, h('i'));
  return h('div', { class: `mrow habit ${done ? 'done' : ''} ${due ? '' : 'rest'}`, onClick: () => habitSheet(hb.id) },
    check,
    h('div', { class: 'grow' },
      h('div', { class: 'mtitle' }, hb.emoji ? `${hb.emoji} ` : '', hb.name),
      h('div', { class: 'msub' }, h('span', {}, M.habitFreqLabel(hb)), wk != null ? h('span', {}, `${wk}/${hb.freq.n} this week`) : null, auto ? h('span', { class: 'ok' }, `auto · ${hb.link.split(':')[0]}`) : null, !due ? h('span', {}, 'rest day') : null,
        hb.link && ctx.appUrl?.(hb.link.split(':')[0]) ? h('a', { class: 'open-link', href: ctx.appUrl(hb.link.split(':')[0]), target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() }, `Open ${hb.link.split(':')[0]} ▸`) : null),
      dots ? habitDots(hb) : null),
    st.cur > 0 ? h('div', { class: `streak ${st.cur >= 7 ? 'hot' : ''}`, title: `Best ${st.best}` }, h('b', {}, st.cur), h('small', {}, st.unit === 'wk' ? 'wk' : 'day')) : null);
}

// ───────────────────────────────────────── Overview
function brainHero() {
  const s = S(), n = now(), a = apps(), bs = M.brainScore(s, n, a);
  const stats = M.AREAS.map(x => ({ ...x, ...M.areaStats(s, x.id, n, a) }));
  const t = tree(stats, { score: bs.score, onPick: (id) => areaSheet(id) });
  const ins = M.insights(s, n, a);
  const hour = n.getHours(), greet = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = (s.me?.name || '').replace(/^Dr\.?\s*/i, '').split(/\s+/)[0];
  return h('div', { class: 'card space' },
    h('div', { class: 'space-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Your mind'), h('h2', {}, `${greet}${name ? ', ' + name : ''}`)),
      h('button', { class: 'btn sm ghost breathe-btn', onClick: breatheSheet, 'aria-label': 'Breathing exercise' }, h('span', { class: 'bdot' }), 'Breathe')),
    t,
    bs.score == null ? h('div', { class: 'dim tiny center no-score' }, 'Your score appears once you tick a habit, finish a task or check in.')
      : h('div', { class: 'score-parts' }, bs.parts.filter(p => p.value != null).map(p => h('div', { class: 'sp' }, h('span', {}, p.label), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(p.value * 100)}%` } })), h('b', {}, pctTxt(p.value))))),
    ins.length ? h('div', { class: 'insights' }, ins.map(i => h('div', { class: 'insight' }, h('span', { class: 'ping' }), i.text))) : null);
}
function inboxCard(limit = 4) {
  const p = M.inboxPending(S(), apps(), now()); if (!p.length) return null;
  return h('div', { class: 'card inbox' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'From your apps'), h('span', { class: 'pill-n' }, p.length)),
    p.slice(0, limit).map(inboxRow), p.length > limit ? h('div', { class: 'dim tiny' }, `+${p.length - limit} more in Apps`) : null);
}
export const inboxPanel = inboxCard;
export function inboxRow(p) {
  const it = p.item, meta = ctx.appMeta?.(p.app) || {};
  return h('div', { class: 'ibx' }, h('span', { class: 'ibx-ic', style: { '--c': meta.color || 'var(--orange)' } }, meta.icon || '⚡'),
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, it.title), h('div', { class: 'msub' }, h('span', {}, meta.title || p.app), it.date ? h('span', {}, dueLabel(it.date)) : null, it.minutes ? h('span', {}, `${it.minutes}m`) : null, h('span', {}, it.type))),
    h('button', { class: 'btn sm primary', onClick: () => acceptProposal(p) }, it.type === 'event' ? 'Add event' : 'Take'), h('button', { class: 'btn sm ghost', 'aria-label': 'Dismiss', onClick: () => up(s => M.dismissInbox(s, p.ref)) }, '✕'));
}
async function acceptProposal(p) {
  let cal = null; if (p.item.type === 'event' && p.item.start != null) { try { cal = await ctx.addEvent?.(p.item, { quiet: true }); } catch (e) { toast(e.message || 'Could not add the event', 'err'); return; } }
  let tid = ''; up(s => { const r = M.acceptInbox(s, p); tid = r.taskId; return r.state; });
  toast(p.item.type === 'note' ? 'Added to notes' : cal?.how === 'queued' ? 'Taken in: the event goes to your calendar when you are online' : cal ? 'Taken in and added to your calendar' : 'Taken in');   // one toast: addEvent was quiet if (p.item.minutes && p.item.date) ctx.regenerate?.();
}
function trendCard() {
  const s = S(), n = now(), a = apps(), tr = M.trend(s, 8, n, a);
  if (tr.every(w => w.habitRate == null && !w.tasksDone)) return null;   // eight empty weeks are not an insight
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Last 8 weeks'),
    h('div', { class: 'dim tiny' }, 'Habit completion per week'),
    bars(tr.map((w, i) => ({ v: w.habitRate, label: i === 7 ? 'now' : `${w.ws.getDate()}/${w.ws.getMonth() + 1}`, now: i === 7, title: pctTxt(w.habitRate) })), { h: 56 }),
    h('div', { class: 'kv spaced' }, h('span', {}, 'Tasks finished'), h('span', { class: 'grow' }), spark(tr.map(w => w.tasksDone), { w: 120, h: 26 })));
}
function balanceCard() {
  const s = S(), n = now(), a = apps(), live = M.AREAS.map(x => ({ x, st: M.areaStats(s, x.id, n, a) })).filter(o => o.st.score != null);
  if (live.length < 3) return null;
  const w = M.latestWheel(s, 2);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Balance'), h('button', { class: 'btn sm ghost', onClick: () => reflectSheet('wheel') }, 'Wheel of life')),
    radar(M.AREAS.map(x => ({ id: x.id, label: x.name, color: x.color })), M.AREAS.map(x => M.areaStats(s, x.id, n, a).score ?? 0), { ghost: w[0]?.scores ? M.AREAS.map(x => (w[0].scores[x.id] || 0) / 10) : null }),
    h('div', { class: 'dim tiny' }, w[0] ? 'Solid = this week’s activity · dashed = your last wheel check' : 'Based on habits, tasks and objectives this week'));
}
// ───────────────────────────────────────── first run: a guided start that stays until it is done or hidden
const guideHidden = () => S().settings?.mindGuide === 'hidden';
const hideGuide = () => { up(st => ({ ...st, settings: { ...st.settings, mindGuide: 'hidden' } })); toast('Guide hidden — the starter kit is gone too'); };
const KIT_PICKS = ['Evening check-in', 'Walk 20 minutes', 'Read'];   // a light first choice; the rest are one tap away
/** Add kit items with known ids, so one Undo can take the whole batch back. */
function addKit(items) {
  if (!items.length) return;
  const ids = items.map(k => ({ kind: k.kind, id: 'k' + Math.random().toString(36).slice(2, 9) }));
  up(st => items.reduce((x, k, i) => k.kind === 'habit' ? M.addHabit(x, { ...k, id: ids[i].id }) : M.addAim(x, { ...k, id: ids[i].id, milestones: k.milestones.map(t => ({ title: t })) }), st));
  const habits = items.filter(k => k.kind === 'habit').length, aims = items.length - habits;
  undoToast(`Added ${[habits ? plural(habits, 'habit') : '', aims ? plural(aims, 'objective') : ''].filter(Boolean).join(' and ')}`,
    () => up(st => ids.reduce((x, o) => o.kind === 'habit' ? M.deleteHabit(x, o.id) : M.deleteAim(x, o.id), st)));
}
/** Kit habits as toggle chips: choose a few, add them in one go. */
function habitPicker() {
  const kit = M.starterKit(S()).filter(k => k.kind === 'habit'); if (!kit.length) return null;
  if (!ui.kit) ui.kit = new Set(KIT_PICKS);
  const chosen = () => kit.filter(k => ui.kit.has(k.name));
  const add = h('button', { type: 'button', class: 'btn sm primary', onClick: () => addKit(chosen()) });
  const paint = () => { const n = chosen().length; add.textContent = n ? `Add ${plural(n, 'habit')}` : 'Tap to choose'; add.disabled = !n; };
  const chips = kit.map(k => { const on = () => ui.kit.has(k.name); const c = h('button', { type: 'button', class: `kchip ${on() ? 'on' : ''}`, 'aria-pressed': on() ? 'true' : 'false', title: k.why,
    onClick: () => { on() ? ui.kit.delete(k.name) : ui.kit.add(k.name); c.classList.toggle('on', on()); c.setAttribute('aria-pressed', on() ? 'true' : 'false'); paint(); } },
    h('span', { class: 'k-e', 'aria-hidden': 'true' }, k.emoji || '●'), h('span', {}, k.name), k.link ? h('small', { class: 'k-auto' }, 'auto') : null); return c; });
  paint();
  return h('div', { class: 'kit-pick' }, h('div', { class: 'kit' }, chips), h('div', { class: 'row' }, add, h('button', { type: 'button', class: 'btn sm ghost', onClick: () => habitSheet(null) }, 'My own…')));
}
/** Kit objectives: one tap adds one (with its milestones); or write your own. */
function aimPicker() {
  const kit = M.starterKit(S()).filter(k => k.kind === 'aim');
  return h('div', { class: 'kit' }, kit.map(k => h('button', { type: 'button', class: 'kchip', title: k.milestones.join(' · '), onClick: () => addKit([k]) }, h('span', { class: 'k-e', 'aria-hidden': 'true' }, '◆'), h('span', {}, k.title))),
    h('button', { type: 'button', class: 'kchip ghost', onClick: () => aimSheet(null) }, h('span', { class: 'k-e', 'aria-hidden': 'true' }, '✎'), h('span', {}, 'My own…')));
}
/** The guided start: what Mind is for, then three small steps. Stays (ticking off) until all three are done or you hide it. */
function guideCard() {
  const s = S(); if (guideHidden()) return null;
  const has = [Object.keys(s.tasks || {}).length > 0, M.activeHabits(s).length > 0, Object.keys(s.aims || {}).length > 0], done = has.filter(Boolean).length;
  if (done === 3) return null;
  const fresh = M.mindEmpty(s), next = has.indexOf(false);
  const focusCapture = () => { const i = document.querySelector('#view-mind .capture input'); i?.scrollIntoView({ block: 'center', behavior: 'smooth' }); i?.focus(); };
  const step = (i, title, sub, okText, body) => h('li', { class: `g-step ${has[i] ? 'done' : ''} ${i === next ? 'next' : ''}` },
    h('span', { class: 'g-n', 'aria-hidden': 'true' }, has[i] ? '✓' : String(i + 1)),
    h('div', { class: 'g-b' }, h('b', {}, title), h('div', { class: 'dim tiny' }, has[i] ? okText : sub), has[i] ? null : body));
  return h('div', { class: `card guide hello ${fresh ? 'fresh' : ''}`, 'aria-label': 'Set up Mind' },
    h('div', { class: 'row' }, h('div', { class: 'eyebrow grow' }, fresh ? 'Start here · 3 small steps' : `Setting up Mind · ${done} of 3 done`), h('button', { class: 'btn sm ghost', onClick: hideGuide }, 'Hide guide')),
    h('h2', {}, fresh ? 'Mind keeps what your head shouldn’t have to.' : 'Two minutes to finish'),
    fresh ? h('p', { class: 'g-lead' }, 'Tasks, habits and long-term objectives in one place — Citrus fits them around your shifts and shows how you are doing.') : null,
    h('div', { class: 'g-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 3, 'aria-valuenow': done }, h('i', { style: { width: `${Math.round(done / 3 * 100)}%` } })),
    h('ol', { class: 'g-steps' },
      step(0, 'Capture a task', 'Type it the way you would say it: “call bank tomorrow 20m”.', 'Captured. Tick it off when it is done.', fresh ? captureBar() : h('button', { type: 'button', class: 'btn sm', onClick: focusCapture }, 'Type in the capture bar ▾')),
      step(1, 'Pick a habit or two', 'Tap to choose. “auto” ones tick themselves from your apps.', 'Tick it each day on Overview.', habitPicker()),
      step(2, 'Set one objective', 'A long-term outcome. Its milestones roll up into progress.', 'Find it under Aims.', aimPicker())));
}
/** Habits / Aims: the rest of the kit stays on offer until you hide it (only while you have few of your own). */
function kitCard(kind) {
  const s = S(); if (guideHidden()) return null;
  if (kind === 'habit' ? M.activeHabits(s).length >= 3 : Object.keys(s.aims || {}).length >= 2) return null;
  const body = kind === 'habit' ? habitPicker() : M.starterKit(s).some(k => k.kind === 'aim') ? aimPicker() : null; if (!body) return null;
  return h('div', { class: 'card hello kit-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, kind === 'habit' ? 'Starter habits' : 'Starter objectives'), h('button', { class: 'btn sm ghost', onClick: hideGuide }, 'Hide')),
    h('div', { class: 'dim tiny' }, kind === 'habit' ? 'Choose a few. Edit or remove anything later.' : 'One tap adds it with its milestones.'), body);
}
/** First run: what else lives in Mind, without a wall of zeros. */
function alsoCard() {
  return h('div', { class: 'card also' }, h('div', { class: 'title' }, 'Also in Mind'),
    h('div', { class: 'also-row' }, [['reflect', '✎', 'Reflect', 'Two-minute evening check-in'], ['year', '🗓', 'Year', 'Resolutions, quarterly check-ins'], ['library', '📚', 'Library', 'Books, films, anime, games'], ['notes', '📝', 'Notes', 'Quick notes and ideas']]
      .map(([seg, i, t, d]) => h('button', { type: 'button', class: 'also-b', onClick: () => go(seg) }, h('span', { class: 'a-i', 'aria-hidden': 'true' }, i), h('b', {}, t), h('small', {}, d))),
      h('button', { type: 'button', class: 'also-b', onClick: breatheSheet }, h('span', { class: 'a-i', 'aria-hidden': 'true' }, h('span', { class: 'bdot' })), h('b', {}, 'Breathe'), h('small', {}, 'One calm minute'))));
}
function nowCard() {
  const s = S(), list = L.nowPlaying(s).slice(0, 3);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Now'), h('button', { class: 'btn sm ghost', onClick: () => { ui.seg = 'library'; ctx.render(); } }, 'Library'), h('button', { class: 'btn sm ghost', onClick: quickNote }, '+ Note'), h('button', { class: 'btn sm ghost', onClick: quickLog }, '+ Log')),
    list.length ? h('div', { class: 'now-row' }, list.map(m => { const k = L.kindOf(m.kind); return h('button', { class: 'now-chip', style: { '--c': k.color }, onClick: () => { if (m.kind === 'book') logReadingSheet(m.id); else { ui.seg = 'library'; ctx.render(); } } }, h('span', {}, k.emoji), h('b', {}, m.title), m.total ? h('small', {}, `${m.progress || 0}/${m.total}`) : null); })) : h('div', { class: 'dim small' }, 'Nothing in progress. Log what you are reading, watching or playing.'));
}
const go = (seg) => { ui.seg = seg; ctx.render(); window.scrollTo(0, 0); };
/** Today's habits as tappable orbs: one glance, one tap, no long list. */
function habitOrbs() {
  const s = S(), n = now(), tk = keyOf(n), a = apps(), due = M.activeHabits(s).filter(x => M.habitDue(x, n)); if (!due.length) return null;
  return h('div', { class: 'orbs', role: 'group', 'aria-label': 'Today’s habits' }, due.map(hb => {
    const done = M.habitDone(s, hb, tk, a, tk), st = M.habitStreak(s, hb, n, a), color = areaColor(M.habitArea(s, hb)), unit = st.unit === 'wk' ? 'week' : 'day';
    return h('button', { class: `orb-h ${done ? 'on' : ''} ${ui.pop === 'h' + hb.id ? 'enter' : ''}`, style: { '--c': color }, 'aria-pressed': done ? 'true' : 'false', 'aria-label': `${hb.name}${st.cur ? `, ${st.cur} ${unit} streak` : ''}`, title: st.cur ? `${st.cur} ${unit} streak` : hb.name,
      onClick: () => { ui.pop = done ? '' : 'h' + hb.id; up(x => M.logHabit(x, hb.id, tk, !done)); },
      onContextmenu: (e) => { e.preventDefault(); habitSheet(hb.id); } },
      h('span', { class: 'o-i' }, hb.emoji || hb.name.slice(0, 1).toUpperCase()), h('span', { class: 'o-n' }, hb.name.length > 11 ? hb.name.slice(0, 10) + '…' : hb.name), st.cur > 1 ? h('span', { class: 'o-s' }, `🔥${st.cur}${st.unit === 'wk' ? 'w' : ''}`) : null);
  }));
}
/** Tasks for a "Today" card: what is for today first, then — clearly labelled — what is only coming up this week. */
function focusList(fg, opts = {}) {
  return [fg.today.length ? h('div', { class: 'mlist' }, fg.today.map(t => taskRow(t, opts))) : null,
    fg.soon.length ? h('div', { class: 'sub-h' }, fg.today.length ? 'Coming up this week' : 'Nothing due today · coming up this week') : null,
    fg.soon.length ? h('div', { class: 'mlist soon' }, fg.soon.map(t => taskRow(t, opts))) : null];
}
/** One card for the day: habit orbs, then the few tasks that matter. */
function dayCard() {
  const s = S(), n = now(), tk = keyOf(n), fg = M.focusGroups(s, n, 5), habits = M.activeHabits(s).filter(x => M.habitDue(x, n)), left = habits.filter(x => !M.habitDone(s, x, tk, apps(), tk)).length;
  return h('div', { class: 'card day' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Today'), habits.length ? h('span', { class: `dim tiny ${left ? '' : 'ok'}` }, left ? `${habits.length - left}/${habits.length} habits` : 'All habits done ✓') : null,
    h('button', { class: 'btn sm ghost', onClick: () => go('habits') }, 'Habits')),
    habitOrbs(), fg.today.length || fg.soon.length ? focusList(fg) : h('div', { class: 'empty small' }, 'No tasks due. Capture one or enjoy the space.'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onClick: () => go('tasks') }, 'All tasks ▸')));
}
/** Dashboard tiles: each space at a glance, tap to enter. */
function tiles() {
  const s = S(), n = now(), a = apps(), tk = keyOf(n), b = M.taskBuckets(s, n), open = ['overdue', 'today', 'soon', 'later', 'someday'].reduce((t, k) => t + (b[k]?.length || 0), 0);
  const w7 = M.habitWindow(s, addDays(startOfDay(n), -6), n, a), habits = M.activeHabits(s), aims = Object.values(s.aims || {}).filter(x => x.status !== 'done' && !x.archived), aimAvg = aims.length ? aims.reduce((t, x) => t + M.aimProgress(s, x), 0) / aims.length : null;
  const reflected = M.reflectedOn(s, tk), ls = L.libraryStats(s, n), reading = L.nowPlaying(s), notes = Object.keys(s.memos || {}).length, best = Math.max(0, ...habits.map(x => M.habitStreak(s, x, n, a).best || 0));
  const T = (seg, icon, big, label, sub, viz, warn) => h('button', { class: `tile ${warn ? 'warn' : ''} ${big === 0 || big === '–' ? 'idle' : ''}`, onClick: () => go(seg) }, h('div', { class: 't-top' }, h('span', { class: 't-i' }, icon), viz || null), h('b', {}, big), h('span', { class: 't-l' }, label), sub ? h('small', {}, sub) : null);
  return h('div', { class: 'tiles' },
    T('tasks', '✓', open, open === 1 ? 'open task' : 'open tasks', b.overdue.length ? `${b.overdue.length} overdue` : b.today.length ? `${b.today.length} due today` : 'nothing pressing', null, b.overdue.length > 0),
    T('habits', '🔁', pctTxt(w7.rate), 'habits, last 7 days', w7.rate == null ? (habits.length ? 'counts from tomorrow' : 'add one') : best ? `best streak ${best}` : 'start a streak', ring(w7.rate || 0, { size: 34, stroke: 4, color: 'var(--orange)' })),
    T('aims', '🎯', aims.length, aims.length === 1 ? 'objective' : 'objectives', aimAvg == null ? 'set one' : `${pctTxt(aimAvg)} average`, ring(aimAvg || 0, { size: 34, stroke: 4, color: 'var(--cyan)' })),
    T('reflect', '✎', reflected ? 'Done' : 'Open', reflected ? 'checked in today' : 'daily check-in', reflected ? 'nice' : 'two minutes', null, false),
    T('library', '📚', reading.length || ls.doneYear, reading.length ? 'in progress' : 'finished this year', reading[0] ? reading[0].title.slice(0, 22) : `${ls.total} in library`),
    T('notes', '📝', notes, notes === 1 ? 'note' : 'notes', 'journal and ideas'));
}
/** Balance and the 8-week trend share one card instead of two long ones. */
function insightsCard() {
  const bal = balanceCard(), tr = trendCard(); if (!bal && !tr) return null;
  const tabs = [bal ? ['balance', 'Balance'] : null, tr ? ['trend', 'Trend'] : null].filter(Boolean); if (!tabs.some(([k]) => k === ui.insTab)) ui.insTab = tabs[0][0];
  const card = ui.insTab === 'balance' ? bal : tr;
  return h('div', { class: 'insight-tabs' }, tabs.length > 1 ? h('div', { class: 'seg mini' }, tabs.map(([k, l]) => h('button', { class: ui.insTab === k ? 'active' : '', onClick: () => { ui.insTab = k; ctx.render(); } }, l))) : null, card);
}
function nowOrNothing() { return L.nowPlaying(S()).length ? nowCard() : null; }
function overview() {
  // first run: the guide (with its own capture bar) instead of a hero, tiles and insights that would all read 0
  if (M.mindEmpty(S())) return [guideCard() || captureBar(), inboxCard(), nowOrNothing(), alsoCard()];
  // phone: one column in this order; from 1100 px three columns — hero + capture | the day | tiles + insights
  return [guideCard(), h('div', { class: 'ov-grid' },
    h('div', { class: 'ov-col ov-a' }, brainHero(), captureBar()),
    h('div', { class: 'ov-col ov-b' }, inboxCard(), dayCard()),
    h('div', { class: 'ov-col ov-c' }, tiles(), nowOrNothing(), insightsCard()))];
}

// ───────────────────────────────────────── Tasks
function tasksView() {
  const s = S(), b = M.taskBuckets(s, now());
  const group = (title, list, cls = '') => list.length ? h('div', { class: `card ${cls}` }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, title), h('span', { class: 'dim tiny' }, list.length)), h('div', { class: 'mlist' }, list.map(t => taskRow(t)))) : null;
  const any = Object.values(b).slice(0, 5).some(l => l.length);
  return [captureBar(), group('Overdue', b.overdue, 'warn'), group('Today', b.today), group('This week', b.soon), group('Later', b.later), group('Someday', b.someday),
    !any ? h('div', { class: 'card empty' }, 'Nothing open. Type above to capture the next thing.') : null,
    b.done.length ? h('div', { class: 'card' }, h('button', { class: 'row linkish', onClick: () => { ui.doneOpen = !ui.doneOpen; ctx.render(); } }, h('div', { class: 'title grow' }, 'Done'), h('span', { class: 'dim tiny' }, `${b.done.length} ${ui.doneOpen ? '▾' : '▸'}`)),
      ui.doneOpen ? h('div', { class: 'mlist' }, b.done.slice(0, 15).map(t => taskRow(t))) : null) : null];
}
function taskSheet(id, preset = {}) {
  const s = S(), cur = s.tasks?.[id], f = { title: '', due: '', est: 0, pri: 0, aimId: '', area: '', notes: '', ...preset, ...(cur || {}) };
  const sh = ctx.sheet([]); const title = h('input', { type: 'text', value: f.title, placeholder: 'What needs doing?', maxlength: 140 }), notes = h('textarea', { rows: 2, placeholder: 'Notes' }, f.notes);
  const due = h('input', { type: 'date', value: f.due }), est = h('input', { type: 'number', min: 0, max: 480, step: 5, value: f.est || '', placeholder: 'minutes' });
  const remind = h('input', { type: 'datetime-local', value: f.remindAt || '' });
  const at = (d, hh, mm = 0) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); const p2 = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}T${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const blk = cur && M.taskBlock(s, cur);
  sh.box.append(h('h3', {}, cur ? 'Task' : 'New task'), field('', title),
    h('div', { class: 'grid2' }, field('Due', due, h('div', { class: 'seg mini' }, [['Today', 0], ['Tomorrow', 1], ['Next wk', 7]].map(([l, d]) => h('button', { type: 'button', onClick: () => { due.value = keyOf(addDays(now(), d)); } }, l)))), field('Time needed (min)', est)),
    field('Alarm', remind, h('div', { class: 'seg mini' }, [['In 1 h', () => at(new Date(Date.now() + 3600000), new Date(Date.now() + 3600000).getHours(), new Date(Date.now() + 3600000).getMinutes())], ['This evening', () => at(now(), 20)], ['Tomorrow 9:00', () => at(addDays(now(), 1), 9)], ['Clear', () => '']].map(([l, fn]) => h('button', { type: 'button', onClick: () => { remind.value = fn(); } }, l))), h('div', { class: 'dim tiny' }, 'Rings on your phone through Google Calendar (sign in to Google to use it).')),
    field('Priority', pick([[0, 'Normal'], [1, 'High'], [2, 'Urgent']], f.pri, v => { f.pri = +v; })),
    field('Area', areaPick(f.area, v => { f.area = v; })), field('Objective', aimSelect(f.aimId, v => { f.aimId = v; })), field('Notes', notes),
    f.srcApp ? h('div', { class: 'dim tiny' }, `Sent by ${f.srcApp}`) : null,
    blk ? h('div', { class: 'banner ok' }, `Scheduled ${fmtDate(fromKey(blk.date))} at ${fmtMinStr(blk.start)}`) : (est.value || f.est) ? h('div', { class: 'dim tiny' }, 'With a due date and a time estimate, Citrus finds a slot for this around your shifts.') : null,
    h('div', { class: 'row end' }, cur ? confirmBtn('Delete', () => { up(st => M.deleteTask(st, id)); sh.close(); undoToast('Task deleted', () => up(st => M.restore(st, { tasks: { [id]: cur } }))); }) : null, h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: () => {
        if (!title.value.trim()) return toast('Give it a title');
        const v = { title: title.value.trim(), due: due.value, est: +est.value || 0, pri: f.pri, aimId: f.aimId, area: f.area, notes: notes.value, remindAt: remind.value };
        up(st => cur ? M.updateTask(st, id, v) : M.addTask(st, { ...v, src: f.src, srcApp: f.srcApp }));
        sh.close(); if (v.est && v.due) ctx.regenerate?.();
      } }, 'Save')));
  setTimeout(() => !cur && title.focus(), 60);
}
export function openTask(preset) { taskSheet(null, preset); }

// ───────────────────────────────────────── Habits
function habitsView() {
  const s = S(), n = now(), a = apps(), tk = keyOf(n), list = M.activeHabits(s), archived = Object.values(s.habits || {}).filter(x => x.archived);
  const due = list.filter(x => M.habitDue(x, n)), done = due.filter(x => M.habitDone(s, x, tk, a, tk)).length;
  const w7 = M.habitWindow(s, addDays(startOfDay(n), -6), n, a), w30 = M.habitWindow(s, addDays(startOfDay(n), -29), n, a);
  const cells = []; const start = weekStartOf(addDays(n, -7 * 15));
  for (let i = 0; i < 16 * 7; i++) { const d = addDays(start, i), k = keyOf(d); cells.push(d > n ? { key: k, blank: true } : { key: k, v: M.habitWindow(s, d, d, a).rate, title: `${fmtDate(d)} · ${pctTxt(M.habitWindow(s, d, d, a).rate)}`, today: k === tk }); }
  return [
    !list.length ? null : h('div', { class: 'card space slim' }, h('div', { class: 'habit-hero' }, ring(due.length ? done / due.length : 0, { size: 84, stroke: 7, label: `${done}/${due.length}`, sub: 'today', cls: 'breathing' }),
      h('div', { class: 'grow' }, h('div', { class: 'big' }, pctTxt(w7.rate), h('small', {}, ' this week')), h('div', { class: 'dim' }, w7.rate == null ? 'Rates start counting tomorrow' : `${pctTxt(w30.rate)} over 30 days`), h('div', { class: 'dim tiny' }, `Best streak ${Math.max(0, ...list.map(x => M.habitStreak(s, x, n, a).best))}`))),
      list.length ? [h('div', { class: 'dim tiny' }, 'Last 16 weeks'), heat(cells)] : null),
    list.length ? h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Habits'), h('button', { class: 'btn sm', onClick: () => habitSheet(null) }, '+ Habit')), h('div', { class: 'mlist' }, list.map(x => habitRow(x))))
      : h('div', { class: 'card empty' }, h('p', {}, 'Habits that run themselves: tick them, or link one to an app so it counts when the app says you did it.'), h('button', { class: 'btn primary', onClick: () => habitSheet(null) }, 'Add a habit')),
    kitCard('habit'),
    archived.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Paused'), archived.map(x => h('div', { class: 'row' }, h('span', { class: 'grow' }, `${x.emoji || ''} ${x.name}`), h('button', { class: 'btn sm', onClick: () => up(st => M.updateHabit(st, x.id, { archived: false })) }, 'Resume')))) : null];
}
function habitSheet(id) {
  const s = S(), cur = s.habits?.[id], f = { name: '', emoji: '', freq: { type: 'daily' }, area: '', aimId: '', link: '', threshold: 0, minutes: 0, ...(cur || {}) };
  f.freq = { ...f.freq };
  const sh = ctx.sheet([]), n = now(), a = apps();
  const name = h('input', { type: 'text', value: f.name, placeholder: 'e.g. Read 20 pages', maxlength: 60 }), emoji = h('input', { type: 'text', value: f.emoji, class: 'emoji-in', placeholder: '🙂', 'aria-label': 'Emoji', onInput: () => { const g = M.firstGrapheme(emoji.value); if (g !== emoji.value) emoji.value = g; } });   // one emoji, whole (flags, 🧑‍⚕️)
  const mins = h('input', { type: 'number', min: 0, max: 180, step: 5, value: f.minutes || '', placeholder: '0 = no slot' }), thr = h('input', { type: 'number', min: 0, step: 1, value: f.threshold || '', placeholder: 'metric goal' });
  const freqBox = h('div', {}), paintFreq = () => {
    freqBox.replaceChildren(pick([['daily', 'Every day'], ['days', 'Certain days'], ['weekly', 'X per week']], f.freq.type, v => { f.freq = v === 'days' ? { type: 'days', days: [1, 2, 3, 4, 5] } : v === 'weekly' ? { type: 'weekly', n: 3 } : { type: 'daily' }; paintFreq(); }),
      f.freq.type === 'days' ? h('div', { class: 'seg wrap tight' }, DAY_SHORT.map((l, i) => h('button', { type: 'button', class: f.freq.days.includes(i) ? 'active' : '', onClick: (e) => { f.freq.days = f.freq.days.includes(i) ? f.freq.days.filter(x => x !== i) : [...f.freq.days, i]; e.currentTarget.classList.toggle('active'); } }, l[0] + l[1]))) : null,
      f.freq.type === 'weekly' ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { f.freq.n = Math.max(1, f.freq.n - 1); paintFreq(); } }, '−'), h('b', {}, `${f.freq.n}× a week`), h('button', { type: 'button', class: 'btn sm', onClick: () => { f.freq.n = Math.min(7, f.freq.n + 1); paintFreq(); } }, '+')) : null);
  }; paintFreq();
  const remindT = h('input', { type: 'time', value: f.remindTime || '' });
  const linkSel = h('select', {}, h('option', { value: '' }, 'Manual (I tick it)'), h('option', { value: 'reading' }, 'I log a reading session (Library)'), ...Object.entries(a).filter(([, v]) => v).map(([k, v]) => h('option', { value: v.app || k }, `${v.title || k} says I'm done today`)), ...M.metricSeries(s).map(m => h('option', { value: m.key }, `${m.label} (${m.app}) reaches its goal`)));
  linkSel.value = f.link || '';
  const stats = cur && (() => { const st = M.habitStreak(s, cur, n, a), cells = []; const start = weekStartOf(addDays(n, -7 * 19)); for (let i = 0; i < 140; i++) { const d = addDays(start, i), k = keyOf(d); cells.push(d > n ? { key: k, blank: true } : { key: k, v: M.habitDue(cur, d) ? (M.habitDone(s, cur, k, a, keyOf(n)) ? 1 : 0) : null, title: fmtDate(d), today: k === keyOf(n) }); }
    return h('div', { class: 'hstats' }, h('div', { class: 'kv' }, h('span', {}, 'Streak'), h('b', {}, `${st.cur} ${st.unit === 'wk' ? 'weeks' : 'days'}`), h('span', {}, 'Best'), h('b', {}, st.best)), h('div', { class: 'kv' }, h('span', {}, '7 days'), h('b', {}, pctTxt(M.habitRate(s, cur, n, 7, a))), h('span', {}, '30 days'), h('b', {}, pctTxt(M.habitRate(s, cur, n, 30, a)))), heat(cells, { color: areaColor(M.habitArea(s, cur)) })); })();
  sh.box.append(h('h3', {}, cur ? 'Habit' : 'New habit'), h('div', { class: 'row' }, field('', emoji), h('div', { class: 'grow' }, field('', name))), stats, field('How often', freqBox),
    field('Area', areaPick(f.area, v => { f.area = v; })), field('Objective it serves', aimSelect(f.aimId, v => { f.aimId = v; })),
    field('Counts automatically from', linkSel), h('div', { class: 'grid2' }, field('Goal for metric', thr), field('Time to set aside (min)', mins)),
    h('div', { class: 'dim tiny' }, 'If you give it minutes, Citrus finds a slot around your shifts each day.'),
    field('Alarm at (on its days)', remindT, h('div', { class: 'dim tiny' }, 'Rings on your phone through Google Calendar; leave empty for none.')),
    h('div', { class: 'row end' }, cur ? [confirmBtn('Delete', () => { const log = s.habitLog?.[id]; up(st => M.deleteHabit(st, id)); sh.close(); undoToast(`Habit deleted · ${cur.name}`, () => up(st => M.restore(st, { habits: { [id]: cur }, ...(log ? { habitLog: { [id]: log } } : {}) }))); }), h('button', { class: 'btn', onClick: () => { up(st => M.updateHabit(st, id, { archived: true })); sh.close(); } }, 'Pause')] : null, h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
        if (!name.value.trim()) return toast('Name the habit');
        if (f.freq.type === 'days' && !f.freq.days.length) return toast('Pick at least one day, or choose Every day');
        const v = { name: name.value.trim(), emoji: M.firstGrapheme(emoji.value), freq: f.freq, area: f.area, aimId: f.aimId, link: linkSel.value, threshold: +thr.value || 0, minutes: +mins.value || 0, remindTime: remindT.value || '' };
        up(st => cur ? M.updateHabit(st, id, v) : M.addHabit(st, v)); sh.close(); if (v.minutes) ctx.regenerate?.();
      } }, 'Save')));
  setTimeout(() => !cur && name.focus(), 60);
}

// ───────────────────────────────────────── Aims
function aimCard(a) {
  const s = S(), p = M.aimProgress(s, a), left = M.daysLeft(a.deadline, now()), color = areaColor(a.area);
  const tasks = Object.values(s.tasks || {}).filter(t => t.aimId === a.id), habits = M.activeHabits(s).filter(x => x.aimId === a.id);
  return h('div', { class: 'card aim', style: { '--c': color } },
    h('div', { class: 'row top', onClick: () => aimSheet(a.id) }, ring(p, { size: 58, stroke: 6, color, label: pctTxt(p), cls: 'breathing' }),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, a.title), a.why ? h('div', { class: 'dim tiny quote' }, a.why) : null,
        h('div', { class: 'msub' }, a.area ? h('span', { style: { color } }, M.areaOf(a.area)?.name) : null, left != null ? h('span', { class: left < 0 ? 'late' : left < 30 ? 'warnc' : '' }, left < 0 ? `${-left}d past` : `${left}d left`) : null, tasks.length ? h('span', {}, `${tasks.filter(t => t.done).length}/${tasks.length} tasks`) : null, habits.length ? h('span', {}, `${habits.length} habit${habits.length > 1 ? 's' : ''}`) : null, a.link ? h('span', { class: 'ok' }, `live · ${a.link}`) : null))),
    a.milestones?.length ? h('div', { class: 'miles' }, a.milestones.map((m, i) => h('button', { class: `mile ${m.done ? 'on' : ''}`, onClick: () => up(st => M.updateAim(st, a.id, { milestones: st.aims[a.id].milestones.map((x, j) => j === i ? { ...x, done: !x.done } : x) })) }, h('i'), m.title))) : null);
}
function aimsView() {
  const s = S(), list = Object.values(s.aims || {}).sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.deadline || '9').localeCompare(b.deadline || '9') || a.createdAt - b.createdAt);
  return [h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Objectives'), h('button', { class: 'btn sm primary', onClick: () => aimSheet(null) }, '+ Objective')),
    ...list.map(aimCard), kitCard('aim'),
    !list.length ? h('div', { class: 'card empty' }, h('p', {}, 'An objective is a long-term outcome — “Pass Step 1”, “Run 10K”. Break it into milestones; tasks and habits can serve it, and its progress rolls up automatically.')) : null];
}
function aimSheet(id) {
  const s = S(), cur = s.aims?.[id], f = { title: '', why: '', area: '', deadline: '', pct: 0, link: '', status: 'active', ...(cur || {}) };
  const sh = ctx.sheet([]);
  const title = h('input', { type: 'text', value: f.title, placeholder: 'e.g. Pass USMLE Step 1', maxlength: 100 }), why = h('textarea', { rows: 2, placeholder: 'Why does it matter to you?' }, f.why), dl = h('input', { type: 'date', value: f.deadline });
  const ms = h('textarea', { rows: 4, placeholder: 'One milestone per line' }, (cur?.milestones || []).map(m => m.title).join('\n'));
  const pctLab = h('span', {}, `Manual progress ${f.pct || 0}% (used when nothing else applies)`);
  const pctIn = h('input', { type: 'range', min: 0, max: 100, step: 5, value: f.pct, onInput: () => { pctLab.textContent = `Manual progress ${pctIn.value}% (used when nothing else applies)`; } });
  const lk = h('select', {}, h('option', { value: '' }, 'No — milestones / tasks / manual'), ...M.metricSeries(s).filter(m => m.kind === 'progress').map(m => h('option', { value: m.key }, `${m.label} (${m.app}) — live %`))); lk.value = f.link || '';
  const live = cur ? M.aimProgress(s, cur) : 0;
  sh.box.append(h('h3', {}, cur ? 'Objective' : 'New objective'), field('', title), field('Why', why), field('Area', areaPick(f.area, v => { f.area = v; })), field('Deadline', dl),
    field('Milestones', ms), field('Progress is read from', lk), field(pctLab, pctIn),
    cur ? h('div', { class: 'dim tiny' }, `Right now: ${pctTxt(live)}`) : null,
    cur ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => { sh.close(); reflectSheet('premortem', { aimId: id }); } }, 'Pre-mortem'), h('button', { class: 'btn sm', onClick: () => { sh.close(); taskSheet(null, { aimId: id, area: f.area }); } }, '+ Task for this'), h('button', { class: 'btn sm', onClick: () => { sh.close(); habitSheet(null); } }, '+ Habit')) : null,
    h('div', { class: 'row end' }, cur ? [confirmBtn('Delete', () => {
        // deleting unlinks its tasks and habits; Undo links them back
        const tasks = Object.fromEntries(Object.values(s.tasks || {}).filter(t => t.aimId === id).map(t => [t.id, t])), habits = Object.fromEntries(Object.values(s.habits || {}).filter(x => x.aimId === id).map(x => [x.id, x]));
        up(st => M.deleteAim(st, id)); sh.close(); undoToast('Objective deleted', () => up(st => M.restore(st, { aims: { [id]: cur }, tasks, habits })));
      }), h('button', { class: 'btn', onClick: () => { up(st => M.updateAim(st, id, { status: f.status === 'done' ? 'active' : 'done' })); sh.close(); toast(f.status === 'done' ? 'Reopened' : 'Achieved 🎉'); } }, f.status === 'done' ? 'Reopen' : 'Mark achieved')] : null, h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
        if (!title.value.trim()) return toast('Name the objective');
        // keep each milestone's id: same text first (survives reordering, and duplicates stay apart), else the same line (an edit)
        const old = cur?.milestones || [], used = new Set(), lines = ms.value.split('\n').map(x => x.trim()).filter(Boolean);
        const milestones = lines.map((t, i) => { let m = old.find((x, j) => !used.has(j) && x.title === t); if (!m && old[i] && !used.has(i) && !lines.includes(old[i].title)) m = old[i]; if (m) used.add(old.indexOf(m)); return { id: m?.id, title: t, done: !!m?.done }; });
        const v = { title: title.value.trim(), why: why.value.trim(), area: f.area, deadline: dl.value, milestones, pct: +pctIn.value, link: lk.value };
        up(st => cur ? M.updateAim(st, id, { ...v, milestones: milestones.map(m => ({ ...m, id: m.id || Math.random().toString(36).slice(2, 8) })) }) : M.addAim(st, v)); sh.close();
      } }, 'Save')));
  setTimeout(() => !cur && title.focus(), 60);
}

// ───────────────────────────────────────── Reflect
function reflectView() {
  const s = S(), n = now(), sug = M.suggestMethod(s, n), m = M.methodOf(sug.method), list = M.reflectionsList(s), rs = M.reflectionStreak(s, n);
  const mood = M.moodSeries(s, 30, n), w = M.latestWheel(s, 2);
  return [
    h('div', { class: 'card space slim now' }, h('div', { class: 'eyebrow' }, 'Right now'), h('h3', {}, m.name), h('p', { class: 'dim' }, sug.why), h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => reflectSheet(m.id) }, 'Begin'), h('button', { class: 'btn ghost breathe-btn', onClick: breatheSheet }, h('span', { class: 'bdot' }), 'Breathe first'), h('span', { class: 'grow' }), rs ? h('span', { class: 'chip hot' }, `🔥 ${rs} day${rs > 1 ? 's' : ''}`) : null)),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Methods'), h('div', { class: 'methods' }, M.METHODS.map(x => h('button', { class: 'method', onClick: () => reflectSheet(x.id, x.aim ? { aimId: Object.values(s.aims || {})[0]?.id } : {}) }, h('b', {}, x.name), h('small', {}, x.cadence), h('span', {}, x.blurb))))),
    mood.some(x => x.mood) ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Mood & energy · 30 days'), spark(mood.map(x => x.mood), { max: 5, h: 36 }), spark(mood.map(x => x.energy), { max: 5, h: 36, color: 'var(--cyan)' })) : null,
    w[0]?.scores ? h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Wheel of life'), h('span', { class: 'dim tiny' }, fmtDate(fromKey(w[0].date)))), radar(M.AREAS.map(x => ({ id: x.id, label: x.name, color: x.color })), M.AREAS.map(x => (w[0].scores[x.id] || 0) / 10), { ghost: w[1]?.scores ? M.AREAS.map(x => (w[1].scores[x.id] || 0) / 10) : null })) : null,
    list.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Journal'), h('div', { class: 'mlist' }, list.slice(0, 30).map(r => h('div', { class: 'mrow refl', onClick: () => reflectSheet(r.method, { entry: r }) }, h('span', { class: 'mood' }, r.mood ? MOODS[r.mood - 1] : '✎'), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, M.methodOf(r.method)?.name || r.method), h('div', { class: 'msub' }, h('span', {}, fmtDate(fromKey(r.date))), h('span', {}, previewOf(r))))))))
      : h('div', { class: 'card empty' }, 'Your reflections will collect here — a private journal that also feeds your brain score.')];
}
const previewOf = (r) => { const v = Object.values(r.answers || {}).flat().filter(Boolean)[0]; return v ? String(v).slice(0, 70) : ''; };

export function reflectSheet(methodId, opts = {}) {
  const s = S(), m = M.methodOf(methodId); if (!m) return;
  const n = now(), aimId0 = opts.aimId || opts.entry?.aimId || '';
  // reopening a method you already used today opens that entry — saving a blank sheet over it would lose the first text
  const found = !opts.entry && !opts.fresh ? M.findReflection(s, m.id, keyOf(n), aimId0) : null;
  if (m.wheel) return wheelSheet(opts.entry || found);
  const e = opts.entry || found || {}, date = e.date || keyOf(n), aimId = aimId0;
  const answers = JSON.parse(JSON.stringify(e.answers || {})), f = { mood: e.mood || 0, energy: e.energy || 0, rating: e.rating || 0, push: {} };
  const sh = ctx.sheet([]); const aim = s.aims?.[aimId];
  sh.box.append(h('h3', {}, m.name), h('div', { class: 'dim tiny' }, `${m.blurb}${aim ? ` · ${aim.title}` : ''} · ${fmtDate(fromKey(date))}`),
    e.id ? h('div', { class: 'banner refl-edit' }, h('span', { class: 'grow' }, `${date === keyOf(n) ? 'Today’s' : m.id === 'weekly' ? 'This week’s' : 'Your'} entry${e.at ? ` · saved ${new Date(e.at).toTimeString().slice(0, 5)}` : ''} — edit it here.`),
      h('button', { type: 'button', class: 'btn sm ghost', onClick: () => { sh.close(); reflectSheet(m.id, { aimId, fresh: true }); } }, 'New entry')) : null);
  if (m.stats) { const w = M.weekStats(s, weekStartOf(n), n, apps()); sh.box.append(h('div', { class: 'kv weekstats' }, h('span', {}, `Habits ${pctTxt(w.habitRate)}`), h('span', {}, `${w.tasksDone} tasks done`), h('span', {}, `${w.reflect} reflections`), h('span', {}, `${Math.round(w.studyMin / 60 * 10) / 10}h focus time`))); }
  if (m.mood) { sh.box.append(field('Mood', pick(MOODS.map((x, i) => [i + 1, x]), f.mood, v => { f.mood = +v; }, 'emoji')), field('Energy', pick([1, 2, 3, 4, 5].map(x => [x, '⚡'.repeat(x)]), f.energy, v => { f.energy = +v; }))); }
  const inputs = {};
  for (const fd of m.fields) {
    if (fd.type === 'lines') { const cur = answers[fd.k] || []; inputs[fd.k] = Array.from({ length: fd.n }, (_, i) => h('input', { type: 'text', value: cur[i] || '', placeholder: `${i + 1}.`, maxlength: 140 })); sh.box.append(field(fd.label, ...inputs[fd.k]), fd.toTasks ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onChange: (ev) => { f.push[fd.k] = ev.target.checked; } }), 'Turn these into tasks') : null); if (fd.toTasks) f.push[fd.k] = true; }
    else { inputs[fd.k] = h('textarea', { rows: fd.type === 'long' ? 9 : 3, placeholder: fd.type === 'long' ? 'Write whatever is on your mind…' : '' }, answers[fd.k] || ''); sh.box.append(field(fd.label, inputs[fd.k])); }
  }
  if (m.rating) sh.box.append(field('Rate it 1–5', pick([1, 2, 3, 4, 5].map(x => [x, String(x)]), f.rating, v => { f.rating = +v; })));
  sh.box.append(h('div', { class: 'row end' }, e.id ? confirmBtn('Delete', () => { up(st => M.deleteReflection(st, e.id)); sh.close(); undoToast('Entry deleted', () => up(st => M.restore(st, { reflections: { [e.id]: e } }))); }) : null, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
    const out = {}; for (const fd of m.fields) out[fd.k] = fd.type === 'lines' ? inputs[fd.k].map(i => i.value.trim()).filter(Boolean) : inputs[fd.k].value.trim();
    if (!Object.values(out).flat().some(Boolean)) return toast('Write something first');
    up(st => {
      let x = M.saveReflection(st, { ...(e.id ? { id: e.id } : {}), method: m.id, date, aimId, mood: f.mood, energy: f.energy, rating: f.rating, answers: out, createdAt: e.createdAt || Date.now() });
      for (const fd of m.fields) if (fd.toTasks && f.push[fd.k] && !e.id) for (const t of out[fd.k]) x = M.addTask(x, { title: t, due: keyOf(m.id === 'weekly' ? addDays(weekStartOf(n), 7) : addDays(n, 1)), src: `reflect:${m.id}` });   // next week starts on Sunday
      return x;
    });
    sh.close(); toast('Saved');
  } }, 'Save')));
}
function wheelSheet(entry) {
  const s = S(), prev = M.latestWheel(s, 1)[0], scores = { ...(entry?.scores || prev?.scores || Object.fromEntries(M.AREAS.map(a => [a.id, 5]))) };
  const sh = ctx.sheet([]), rad = h('div', { class: 'wheel-rad' }), paint = () => rad.replaceChildren(radar(M.AREAS.map(x => ({ id: x.id, label: x.name, color: x.color })), M.AREAS.map(x => scores[x.id] / 10), { size: 220 }));
  paint(); const note = h('textarea', { rows: 2, placeholder: 'What stands out?' }, entry?.answers?.note || '');
  sh.box.append(h('h3', {}, 'Wheel of life'), h('div', { class: 'dim tiny' }, 'How satisfied are you with each area right now? 1 = starved, 10 = thriving.'), rad,
    ...M.AREAS.map(a => { const out = h('b', {}, scores[a.id]); const r = h('input', { type: 'range', min: 1, max: 10, step: 1, value: scores[a.id], style: { '--c': a.color }, onInput: () => { scores[a.id] = +r.value; out.textContent = r.value; paint(); } }); return h('div', { class: 'wheel-row' }, h('span', {}, `${a.emoji} ${a.name}`), r, out); }),
    field('', note), h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { up(st => M.saveReflection(st, { ...(entry?.id ? { id: entry.id } : {}), method: 'wheel', date: entry?.date || keyOf(now()), scores, answers: { note: note.value.trim() } })); sh.close(); toast('Saved'); } }, 'Save')));
}

// breathing: a 4-in / 6-out pace (longer exhale calms), animated with one transform
export function breatheSheet() {
  const sh = ctx.sheet([]); let count = 0, on = true;
  const label = h('div', { class: 'b-label' }, 'Breathe in'), cnt = h('div', { class: 'dim tiny' }, '0 breaths');
  const orb = h('div', { class: 'b-orb' }, h('i'), h('i'), h('i'));
  const cycle = () => { if (!on || !document.body.contains(orb)) return; label.textContent = 'Breathe in'; setTimeout(() => { if (!on) return; label.textContent = 'Breathe out'; setTimeout(() => { count++; cnt.textContent = `${count} breath${count > 1 ? 's' : ''}`; cycle(); }, 6000); }, 4000); };
  sh.box.append(h('h3', {}, 'Breathe'), h('div', { class: 'dim tiny' }, 'In for 4, out for 6. Follow the glow.'), h('div', { class: 'breathe-stage' }, orb, label), cnt,
    h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onClick: () => { on = false; sh.close(); } }, 'Done')));
  cycle();
  const mo = new MutationObserver(() => { if (!document.body.contains(orb)) { on = false; mo.disconnect(); } }); mo.observe(document.body, { childList: true });
}

// ───────────────────────────────────────── Year
function yearView() {
  const s = S(), n = now(), y = ui.year, list = M.resolutionsOf(s, y), meta = s.yearMeta?.[y], q = M.quarterOf(n), cur = y === n.getFullYear();
  const rv = M.yearReview(s, y, n, apps());
  const themeIn = h('input', { type: 'text', value: meta?.theme || '', placeholder: 'A word or phrase for the year', maxlength: 40, onChange: () => up(st => M.setTheme(st, y, themeIn.value)) });
  const nextPrompt = !cur && y > n.getFullYear() ? 'Planning ahead' : '';
  return [
    h('div', { class: 'card space slim year' }, h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', 'aria-label': 'Previous year', onClick: () => { ui.year--; ctx.render(); } }, '‹'), h('div', { class: 'grow center' }, h('div', { class: 'eyebrow' }, nextPrompt || (cur ? 'This year' : 'Year')), h('h2', {}, String(y))), h('button', { class: 'btn sm ghost', 'aria-label': 'Next year', onClick: () => { ui.year++; ctx.render(); } }, '›')),
      field('Theme', themeIn),
      cur ? h('div', { class: 'yprog' }, h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(((n - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1))) * 100)}%` } })), h('div', { class: 'dim tiny' }, `${Math.round(((n - new Date(y, 0, 1)) / 86400000))} days in · ${Math.round((new Date(y + 1, 0, 1) - n) / 86400000)} left · ${q.toUpperCase()}`)) : null),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${y} resolutions`), h('button', { class: 'btn sm primary', onClick: () => resolutionSheet(null, y) }, '+ Resolution')),
      list.length ? h('div', { class: 'mlist' }, list.map(r => resolutionRow(r, cur ? q : ''))) : h('div', { class: 'empty small' }, 'Pick a few that matter. Fewer, clearer, and each one tied to a target you can check.')),
    list.length || rv.tasks ? h('div', { class: 'card' }, h('div', { class: 'title' }, `${y} so far`), h('div', { class: 'stat-grid' }, [[rv.tasks, 'tasks done'], [pctTxt(rv.habitRate), 'habit rate'], [rv.bestStreak ? `${rv.bestStreak}` : '–', rv.bestName ? `best streak · ${rv.bestName}` : 'best streak'], [rv.reflections, 'reflections'], [pctTxt(rv.avgProgress), 'resolutions']].map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('small', {}, l)))), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => reflectSheet('yearend') }, 'Year in review'))) : null];
}
function resolutionRow(r, q) {
  const s = S(), p = M.resolutionProgress(s, r), color = areaColor(r.area);
  return h('div', { class: 'mrow res', onClick: () => resolutionSheet(r.id, r.year) }, ring(p, { size: 44, stroke: 5, color, label: `${Math.round(p * 100)}`, cls: 'breathing' }),
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, r.title), r.target ? h('div', { class: 'msub' }, h('span', {}, `🎯 ${r.target}`)) : null,
      h('div', { class: 'qs' }, M.QUARTERS.map(k => h('button', { class: `q ${r.checkins?.[k] ? 'on' : ''} ${k === q ? 'now' : ''}`, onClick: (e) => { e.stopPropagation(); checkinSheet(r.id, k); } }, k.toUpperCase())))));
}
function resolutionSheet(id, year) {
  const s = S(), cur = s.resolutions?.[id], f = { title: '', area: '', why: '', target: '', progress: 0, aimId: '', ...(cur || {}) };
  const sh = ctx.sheet([]);
  const title = h('input', { type: 'text', value: f.title, placeholder: 'e.g. Read 24 books', maxlength: 100 }), target = h('input', { type: 'text', value: f.target, placeholder: 'How will you know? e.g. 24 books', maxlength: 120 }), why = h('textarea', { rows: 2, placeholder: 'Why this one?' }, f.why), prLab = h('span', {}, `Manual progress ${f.progress || 0}%`), pr = h('input', { type: 'range', min: 0, max: 100, step: 5, value: f.progress, onInput: () => { prLab.textContent = `Manual progress ${pr.value}%`; } });
  sh.box.append(h('h3', {}, cur ? 'Resolution' : `New ${year} resolution`), field('', title), field('Target', target), field('Why', why), field('Area', areaPick(f.area, v => { f.area = v; })),
    field('Driven by objective (progress follows it)', aimSelect(f.aimId, v => { f.aimId = v; })), field(prLab, pr),
    h('div', { class: 'row end' }, cur ? confirmBtn('Delete', () => { up(st => M.deleteResolution(st, id)); sh.close(); undoToast('Resolution deleted', () => up(st => M.restore(st, { resolutions: { [id]: cur } }))); }) : null, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: () => { if (!title.value.trim()) return toast('Name the resolution'); const v = { title: title.value.trim(), target: target.value.trim(), why: why.value.trim(), area: f.area, aimId: f.aimId, progress: +pr.value }; up(st => cur ? M.updateResolution(st, id, v) : M.addResolution(st, { ...v, year })); sh.close(); } }, 'Save')));
  setTimeout(() => !cur && title.focus(), 60);
}
function checkinSheet(id, q) {
  const s = S(), r = s.resolutions?.[id]; if (!r) return; const c = r.checkins?.[q] || {};
  const sh = ctx.sheet([]), note = h('textarea', { rows: 3, placeholder: 'How is it going? What is in the way?' }, c.note || ''), prLab = h('span', {}, `Progress so far ${c.progress ?? r.progress ?? 0}%`), pr = h('input', { type: 'range', min: 0, max: 100, step: 5, value: c.progress ?? r.progress, onInput: () => { prLab.textContent = `Progress so far ${pr.value}%`; } });
  let feel = c.feel || 0;
  sh.box.append(h('h3', {}, `${q.toUpperCase()} check-in`), h('div', { class: 'dim tiny' }, r.title), field('How on track?', pick([[1, '🌧 Off'], [2, '⛅ Mixed'], [3, '☀ On track']], feel, v => { feel = +v; })), field(prLab, pr), field('', note),
    h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { up(st => M.updateResolution(M.setCheckin(st, id, q, { feel, note: note.value.trim(), progress: +pr.value }), id, { progress: +pr.value })); sh.close(); toast('Checked in'); } }, 'Save')));
}

// ───────────────────────────────────────── an area (from the tree)
function areaSheet(areaId) {
  const s = S(), n = now(), a = M.areaOf(areaId), st = M.areaStats(s, areaId, n, apps());
  const tasks = Object.values(s.tasks || {}).filter(t => !t.done && M.taskArea(s, t) === areaId).slice(0, 6);
  const sh = ctx.sheet([]);
  sh.box.append(h('div', { class: 'row' }, ring(st.score, { size: 56, stroke: 6, color: a.color, label: pctTxt(st.score), cls: 'breathing' }), h('div', { class: 'grow' }, h('h3', {}, `${a.emoji} ${a.name}`), h('div', { class: 'dim tiny' }, st.items ? `${st.aims.length} objectives · ${st.habits.length} habits · ${st.openTasks} open tasks` : 'Nothing here yet'))),
    st.aims.length ? h('div', { class: 'mlist' }, st.aims.map(x => h('div', { class: 'mrow', onClick: () => { sh.close(); aimSheet(x.id); } }, ring(M.aimProgress(s, x), { size: 30, stroke: 4, color: a.color }), h('div', { class: 'grow mtitle' }, x.title)))) : null,
    st.habits.length ? h('div', { class: 'mlist' }, st.habits.map(x => habitRow(x, { dots: false }))) : null,
    tasks.length ? h('div', { class: 'mlist' }, tasks.map(t => taskRow(t, { showArea: false }))) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => { sh.close(); taskSheet(null, { area: areaId }); } }, '+ Task'), h('button', { class: 'btn sm', onClick: () => { sh.close(); habitSheet(null); } }, '+ Habit'), h('button', { class: 'btn sm', onClick: () => { sh.close(); aimSheet(null); } }, '+ Objective')));
}

// ───────────────────────────────────────── receiving: what the apps report (used on the Apps tab)
export function receivedCard() {
  const s = S(), series = M.metricSeries(s), pend = M.inboxPending(s, apps(), now());
  if (!series.length && !pend.length) return null;
  const by = {}; for (const m of series) (by[m.app] ||= []).push(m);
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Received from your apps'),
    pend.length ? h('div', { class: 'inbox-in' }, pend.map(inboxRow)) : null,
    Object.entries(by).map(([app, list]) => recvBlock(app, list)));
}
function recvBlock(app, list) {
  const meta = ctx.appMeta?.(app) || {};
  const val = (m) => `${m.goal ? `${m.last}/${m.goal}` : m.last}${m.unit ? (m.unit === '%' ? '%' : ` ${m.unit}`) : ''}`;
  return h('div', { class: 'recv' }, h('div', { class: 'recv-h' }, h('span', { style: { color: meta.color } }, meta.icon || '⚡'), h('b', {}, meta.title || app)),
    list.slice(0, 6).map(m => h('div', { class: 'recv-m' }, h('span', { class: 'grow' }, m.label), h('span', { class: 'recv-v' }, val(m)),
      h('span', { class: 'recv-s' }, spark(m.dates.slice(-14).map(d => m.cells[d].v), { w: 60, h: 18, fill: false, color: meta.color || 'var(--orange)' })))));
}

// ───────────────────────────────────────── share target / #capture: confirm before it becomes a task
export function captureSheet({ title = '', text = '', url = '', source = '' } = {}) {
  const raw = [title, text].filter(Boolean).join(' — ').trim() || url, p = M.parseCapture(raw.slice(0, 140), now());
  const sh = ctx.sheet([]), t = h('input', { type: 'text', value: p.title, maxlength: 140 }), due = h('input', { type: 'date', value: p.due }), notes = h('textarea', { rows: 2 }, [text && text !== raw ? text : '', url].filter(Boolean).join('\n'));
  sh.box.append(h('h3', {}, 'Capture'), h('div', { class: 'dim tiny' }, source ? `From ${source}` : 'Shared to Citrus'), field('', t), field('Due', due), field('Notes', notes),
    h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Discard'), h('button', { class: 'btn primary', onClick: () => { if (!t.value.trim()) return; up(s => M.addTask(s, { title: t.value, due: due.value, est: p.est, pri: p.pri, notes: notes.value, srcApp: source })); sh.close(); toast('Captured'); } }, 'Add task')));
}

// ───────────────────────────────────────── Today card
export function mindCard() {
  const s = S(), n = now(), a = apps(), tk = keyOf(n), bs = M.brainScore(s, n, a), habits = M.activeHabits(s).filter(x => M.habitDue(x, n)), fg = M.focusGroups(s, n, 3);
  const pend = M.inboxPending(s, a, n), sug = M.suggestMethod(s, n), fresh = M.mindEmpty(s), todayN = fg.today.length;
  const sub = habits.length ? `${habits.filter(x => M.habitDone(s, x, tk, a, tk)).length}/${habits.length} habits · ${todayN ? `${todayN} to do today` : 'nothing due today'}` : fresh ? 'Tasks, habits and objectives in one place' : todayN ? `${todayN} to do today` : 'Nothing due today';
  return h('div', { class: 'card space mind-card' },
    h('div', { class: 'row' }, ring(bs.score == null ? null : bs.score / 100, { size: 46, stroke: 5, label: bs.score == null ? '·' : String(bs.score), cls: 'breathing' }),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Mind'), h('div', { class: 'dim tiny' }, sub)),
      h('button', { class: `btn sm ${fresh ? 'primary' : 'ghost'}`, onClick: () => { ui.seg = 'overview'; ctx.go('mind'); } }, fresh ? 'Set up' : 'Open')),
    habits.length ? h('div', { class: 'hchips' }, habits.map(x => { const done = M.habitDone(s, x, tk, a, tk); return h('button', { class: `hchip ${done ? 'on' : ''}`, style: { '--c': areaColor(M.habitArea(s, x)) }, 'aria-pressed': done, onClick: () => { ui.pop = done ? '' : 'h' + x.id; up(st => M.logHabit(st, x.id, tk, !done)); } }, x.emoji || '●', ' ', x.name); })) : null,
    focusList(fg, { showArea: false }),
    pend.length ? h('button', { class: 'linkish inbox-pill', onClick: () => ctx.go('mind') }, h('span', { class: 'ping' }), `${pend.length} from your apps waiting`) : null,
    !M.reflectedOn(s, tk) && n.getHours() >= 17 ? h('button', { class: 'linkish reflect-nudge', onClick: () => reflectSheet(sug.method) }, '🌙 ', sug.why) : null,
    fresh ? h('div', { class: 'dim tiny' }, 'New here? “Set up” takes a minute: one task, a habit or two, one objective.') : null,
    captureBar({ compact: true }));
}

// ───────────────────────────────────────── the view
const segSub = (id) => { const s = S(); try { switch (id) {
  case 'overview': { const n = M.inboxPending(s, apps(), now()).length; return n ? `${n} from your apps` : 'The day at a glance'; }
  case 'tasks': { const n = Object.values(s.tasks || {}).filter(t => !t.done).length; return n ? `${n} open` : 'Nothing open'; }
  case 'habits': { const hs = M.activeHabits(s); return hs.length ? `${hs.length} active` : 'None yet'; }
  case 'aims': { const n = Object.keys(s.aims || {}).length; return n ? `${n} objective${n === 1 ? '' : 's'}` : 'None yet'; }
  case 'reflect': { const n = M.reflectionsList(s).length; return n ? plural(n, 'entry', 'entries') : 'Start one'; }
  case 'year': return String(new Date().getFullYear());
  case 'library': { const n = Object.keys(s.media || {}).length; return n ? plural(n, 'item') : 'Books, films, games'; }
  case 'notes': { const n = Object.keys(s.memos || {}).length; return n ? plural(n, 'note') : 'Quick notes'; }
} } catch {} return ''; };
function launcher() {
  const by = Object.fromEntries(SEGS.map(x => [x[0], x])), box = ctx.sheet([]);
  const go = (id) => { ui.seg = id; box.close(); ctx.render(); window.scrollTo(0, 0); };
  box.box.append(h('h2', {}, 'Mind'), ...GROUPS.map(([g, ids]) => h('div', { class: 'ml-group' }, h('div', { class: 'ml-h' }, g), h('div', { class: 'ml-grid' }, ids.map(id => { const [, label, icon] = by[id], badge = id === 'overview' ? M.inboxPending(S(), apps(), now()).length : 0;
    return h('button', { class: `ml-tile ${ui.seg === id ? 'on' : ''}`, 'data-seg': id, onClick: () => go(id) }, h('span', { class: 'ml-ic' }, icon), h('span', { class: 'ml-t' }, label), h('span', { class: 'ml-s' }, segSub(id)), badge ? h('span', { class: 'pill-n' }, badge) : null); })))));
}
export function renderMind() {
  const i = SEGS.findIndex(x => x[0] === ui.seg), cur = SEGS[i < 0 ? 0 : i], step = (d) => { ui.seg = SEGS[(Math.max(i, 0) + d + SEGS.length) % SEGS.length][0]; ctx.render(); window.scrollTo(0, 0); };
  const pending = M.inboxPending(S(), apps(), now()).length;
  const seg = h('div', { class: 'mind-nav', role: 'navigation', 'aria-label': 'Mind sections' },
    h('button', { class: 'mn-step', 'aria-label': 'Previous section', onClick: () => step(-1) }, '‹'),
    h('button', { class: 'mn-main', 'aria-haspopup': 'dialog', 'aria-label': `${cur[1]} — change section`, onClick: launcher }, h('span', { class: 'mn-ic' }, cur[2]), h('span', { class: 'mn-txt' }, h('b', {}, cur[1]), h('small', {}, segSub(cur[0]))), pending && cur[0] !== 'overview' ? h('span', { class: 'pill-n' }, pending) : null, h('span', { class: 'mn-grid', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'))),
    h('button', { class: 'mn-step', 'aria-label': 'Next section', onClick: () => step(1) }, '›'));
  const body = { overview, tasks: tasksView, habits: habitsView, aims: aimsView, reflect: reflectView, year: yearView, library: renderLibrary, notes: renderNotes }[ui.seg]();
  ui.pop = '';   // the enter animation plays once
  return [seg, h('div', { class: `mind-body seg-${ui.seg}` }, ...body.flat().filter(Boolean))];
}

// ───────────────────────────────────────── search
export function searchItems() {
  const s = S(), out = [];
  for (const t of Object.values(s.tasks || {})) out.push({ kind: 'Task', title: t.title, sub: t.done ? 'done' : t.due ? dueLabel(t.due) : 'no date', run: () => taskSheet(t.id) });
  for (const x of M.activeHabits(s)) out.push({ kind: 'Habit', title: `${x.emoji || ''} ${x.name}`.trim(), sub: M.habitFreqLabel(x), run: () => habitSheet(x.id) });
  for (const a of Object.values(s.aims || {})) out.push({ kind: 'Objective', title: a.title, sub: pctTxt(M.aimProgress(s, a)), run: () => aimSheet(a.id) });
  out.push(...mediaSearchItems());
  for (const r of Object.values(s.resolutions || {})) out.push({ kind: 'Resolution', title: r.title, sub: String(r.year), run: () => resolutionSheet(r.id, r.year) });
  for (const r of M.reflectionsList(s).slice(0, 60)) out.push({ kind: 'Reflection', title: M.methodOf(r.method)?.name || r.method, sub: `${fmtDate(fromKey(r.date))} ${previewOf(r)}`, run: () => reflectSheet(r.method, { entry: r }) });
  return out;
}
export const addTaskSheet = () => taskSheet(null);
export const addHabitSheet = () => habitSheet(null);
