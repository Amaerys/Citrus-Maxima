// "What changed" brief after a schedule is uploaded again, plus the card that keeps unseen updates in view.
import { h, fromKey, DAY_SHORT, MONTHS } from './util.js';
import * as RC from './changes.js';
let ctx = null;
export function initChanges(c) { ctx = c; }
const S = () => ctx.S(), UNIT = { gp: 'GP rota', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurses' };
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()}`; };
const when = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(t).toLocaleDateString(); };
const chRow = (c) => h('div', { class: `rc-row ${c.ahead ? '' : 'past'}` }, h('b', {}, fd(c.date)), h('span', { class: 'rc-from' }, c.from), h('span', { class: 'rc-arr' }, '→'), h('span', { class: 'rc-to' }, c.to));

function block(d) {
  const ahead = d.mine.filter(c => c.ahead), past = d.mine.filter(c => !c.ahead);
  return h('div', { class: 'card rc' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, `${UNIT[d.unitKind] || d.unitKind} · ${MONTHS[d.month - 1]} ${d.year}`), h('div', { class: 'tiny dim' }, `${when(d.at)}${d.source ? ` · ${d.source}` : ''}`)), !d.seen ? h('span', { class: 'chip sel' }, 'new') : null),
    h('div', { class: 'small', style: { margin: '6px 0' } }, RC.headline(d)),
    d.unitKind !== 'nurse' ? h('div', { class: 'rc-sec' }, h('div', { class: 'title' }, 'Your shifts'), ahead.length ? ahead.map(chRow) : h('div', { class: 'small muted' }, 'No change to your shifts ahead.'), past.length ? h('details', {}, h('summary', { class: 'tiny dim' }, `${past.length} past day${past.length > 1 ? 's' : ''} corrected`), past.map(chRow)) : null) : null,
    d.withMe.length ? h('div', { class: 'rc-sec' }, h('div', { class: 'title' }, 'Who works with you'), d.withMe.map(x => x.mine ? h('details', { class: 'rc-row' }, h('summary', {}, h('b', {}, fd(x.date)), ` your new shift: with ${x.count} ${x.count === 1 ? 'person' : 'people'}`), h('div', { class: 'tiny rc-in' }, x.joined.join(', '))) : h('div', { class: 'rc-row' }, h('b', {}, fd(x.date)), h('span', { class: 'grow' }, x.joined.length ? h('span', { class: 'rc-in' }, `+ ${x.joined.join(', ')}`) : null, x.joined.length && x.left.length ? '  ' : null, x.left.length ? h('span', { class: 'rc-out' }, `− ${x.left.join(', ')}`) : null)))) : null,
    d.friends.length ? h('div', { class: 'rc-sec' }, h('div', { class: 'title' }, 'Friends'), d.friends.map(f => { const a = f.changes.filter(c => c.ahead); return h('details', { open: a.length <= 3 ? '' : null }, h('summary', { class: 'small' }, h('b', {}, f.friend), ` · ${a.length} ahead${f.changes.length > a.length ? `, ${f.changes.length - a.length} past` : ''}`), (a.length ? a : f.changes).map(chRow)); })) : null,
    d.added.length || d.removed.length ? h('div', { class: 'rc-sec' }, h('div', { class: 'title' }, 'People'), d.added.length ? h('div', { class: 'small rc-in' }, `Added: ${d.added.join(', ')}`) : null, d.removed.length ? h('div', { class: 'small rc-out' }, `Removed: ${d.removed.join(', ')}`) : null) : null,
    d.others.length ? h('details', { class: 'rc-sec' }, h('summary', { class: 'title' }, `Everyone else (${d.others.length})`), d.others.map(p => h('details', {}, h('summary', { class: 'small' }, `${p.name} · ${p.changes.length}`), p.changes.map(chRow)))) : null);
}

/** Opens the brief for these updates (or all recent ones) and marks them seen. */
export function briefSheet(list) {
  const items = list && list.length ? list : RC.changeList(S()).slice(0, 10);
  ctx.sheet([h('h2', {}, items.length > 1 ? 'Schedule updates' : 'What changed'), items.length ? items.map(block) : h('div', { class: 'small muted' }, 'No updates yet. Upload a newer version of a schedule and the changes show up here.')]);
  const ids = items.filter(x => !x.seen).map(x => x.id); if (ids.length) ctx.update(s => RC.markSeen(s, ids));
}

/** Card for Work → Calendar and Today while there are unseen updates (or the latest one, in Work). */
export function updatesCard({ today = false } = {}) {
  const s = S(), un = RC.unseen(s), last = RC.changeList(s)[0]; if (!last || (today && !un.length)) return null;
  const show = un.length ? un : [last], mine = show.reduce((a, d) => a + d.mine.filter(c => c.ahead).length, 0);
  return h('div', { class: `card rc-card ${un.length ? 'new' : ''}` }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, un.length ? `Schedule updated${un.length > 1 ? ` ×${un.length}` : ''}` : 'Last schedule update'),
    h('div', { class: 'small' }, un.length ? (mine ? `${mine} of your shifts changed` : 'Your shifts are the same') : RC.headline(last)), h('div', { class: 'tiny dim' }, show.map(d => `${UNIT[d.unitKind] || d.unitKind} ${MONTHS[d.month - 1].slice(0, 3)} · ${when(d.at)}`).join(' · '))),
    h('button', { class: `btn sm ${un.length ? 'primary' : ''}`, onClick: () => briefSheet(un.length ? un : null) }, un.length ? 'See changes' : 'History')));
}
