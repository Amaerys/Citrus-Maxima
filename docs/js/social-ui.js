// Social: friends, their handles, free days, best times to meet, invitations, outings. A view of its own.
import { h, toast, keyOf, fromKey, addDays, startOfDay, relDay, fmtMin, DAY_SHORT, MONTHS } from './util.js';
import * as F from './social.js';
import * as XU from './extras-ui.js';
import * as L from './media.js';

let ctx = null, seg = 'overview', picked = null;
export function initSocial(c) { ctx = c; }
const S = () => ctx.S();
const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
const ini = (n) => String(n).replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const av = (f) => h('span', { class: `av sc-av ${f.kind}` }, ini(f.name));
const dayLabel = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
const win = (w) => `${fmtMin(w[0])}–${fmtMin(w[1] % 1440 === 0 ? 1440 - 1 : w[1])}`.replace('23:59', '24:00');
const nameOf = (id) => { const f = S().friends?.[id]; return f ? F.shortName(f) : '?'; };
export const goSocial = (s) => { seg = s; };

// ───────────── buttons for reaching someone
function reach(f, size = 'sm') {
  const l = F.links(f), mk = (href, label, text) => href ? h('a', { class: `btn ${size} ghost sc-btn ${label}`, href, target: '_blank', rel: 'noopener', 'aria-label': `${text} ${f.name}` }, text) : h('span', { class: `btn ${size} ghost sc-btn off`, 'aria-hidden': 'true' }, text);
  return h('div', { class: 'sc-reach' }, mk(l.tel, 'call', '📞'), mk(l.wa, 'wa', '💬'), mk(l.snap, 'snap', '👻'), mk(l.insta, 'ig', '📸'));
}

// ───────────── adding people
const STARTERS = [
  { id: 'gp', title: 'Your GP friends', kind: 'gp', blurb: 'Added from your rota, so their shifts and free days work straight away. Phone numbers come from the rota where it has them.',
    entries: ['Faisal', 'Meshal', 'Mariam', 'Mohammed Merri'].map(q => ({ q, nick: q.includes(' ') ? `${q.split(' ')[0]} ${q.split(' ')[1][0]}.` : q, every: 21 })) },
  { id: 'nurse', title: 'Your nurses', kind: 'nurse', blurb: 'Linked to the nurses’ schedule. Cresilda can tell you who is posted where; Arnalyn is pulled out this month, so her shifts are entered by hand.',
    entries: [
      { q: 'Cresilda Belleza', nick: 'Cresilda', every: 30, note: 'Team leader and a close friend. She suggests the posting list to the Head Nurse (Odai), so she can tell me who goes where.' },
      { q: 'Areej Patuguial', nick: 'Areej', every: 14, fav: true, note: 'Work daughter 💛' },
      { q: 'Fatima Marwati', nick: 'Fatima M.', every: 14, fav: true, note: 'Work daughter 💛' },
      { q: 'Arnalyn Akam', nick: 'Arnalyn', every: 14, fav: true, note: 'Work daughter 💛. Pulled out to the Narjis HMC branch this month, so her shifts are not in my schedule.' }] },
];
const startersLeft = () => { const s = S(), have = F.friendList(s), norm = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return STARTERS.map(g => ({ ...g, left: g.entries.filter(e => { const m = F.matchRota(s, e.q); return !have.some(f => (m.length === 1 && f.rotaKey === m[0].key) || norm(f.name) === norm(e.q) || norm(f.name).startsWith(norm(e.q))); }) })).filter(g => g.left.length); };
function addStarter(g, entries) {
  const pending = [];
  ctx.update(st => { let x = st; for (const e of entries) { const m = F.matchRota(x, e.q);
    if (m.length === 1) x = F.addFriend(x, { name: m[0].name.replace(/^Dr\.?\s*/i, ''), nick: e.nick, kind: g.kind, rotaKey: m[0].key, phone: m[0].mobile || '', notes: e.note || '', fav: !!e.fav, every: e.every });
    else { x = F.addFriend(x, { name: e.q, nick: e.nick, kind: g.kind, notes: e.note || '', fav: !!e.fav, every: e.every }); if (m.length > 1) pending.push(e.q); } } return x; });
  ctx.render(); if (pending.length) toast(`More than one match for ${pending.join(', ')}: open them and pick the right rota row`);
}
function starterCard(g) {
  const s = S(), list = g ? [g] : startersLeft();
  return list.map(gr => h('div', { class: 'card sc-start' }, h('div', { class: 'title' }, gr.title), h('div', { class: 'small muted' }, gr.blurb),
    h('div', { class: 'chips', style: { margin: '10px 0' } }, (gr.left || gr.entries).map(e => { const m = F.matchRota(s, e.q); return h('span', { class: `chip ${m.length === 1 ? 'sel' : ''}` }, `${e.nick} · ${m.length === 1 ? 'in schedule' : m.length > 1 ? `${m.length} matches` : 'not in a schedule'}`); })),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => addStarter(gr, gr.left || gr.entries) }, `Add ${(gr.left || gr.entries).length === 1 ? 'her' : 'these ' + (gr.left || gr.entries).length}`), h('button', { class: 'btn grow', onClick: () => friendSheet(null) }, 'Someone else'), gr.id === 'gp' ? contactsButton() : null)));
}
function contactsButton() {
  const file = h('input', { type: 'file', accept: '.vcf,text/vcard,text/x-vcard', style: { display: 'none' }, onChange: async (e) => { const f = e.target.files?.[0]; if (!f) return; const list = F.parseVCF(await f.text()); e.target.value = ''; chooseContacts(list); } });
  const direct = !!(navigator.contacts && navigator.contacts.select);
  return [file, h('button', { class: 'btn grow', onClick: async () => { if (direct) { try { const r = await navigator.contacts.select(['name', 'tel'], { multiple: true }); chooseContacts(r.map(c => ({ name: (c.name || [])[0] || '', phone: (c.tel || [])[0] || '' })).filter(c => c.name)); } catch { file.click(); } } else file.click(); } }, direct ? 'From contacts' : 'From .vcf file')];
}
function chooseContacts(list) {
  if (!list.length) return toast('No contacts found in that file', 'err');
  const have = new Set(F.friendList(S()).map(f => f.name.toLowerCase())), ticks = list.slice(0, 300).map(c => ({ c, on: false, dupe: have.has(c.name.toLowerCase()) }));
  const box = ctx.sheet([h('h2', {}, 'Pick friends'), h('div', { class: 'small muted' }, `${list.length} contacts. Only the ones you tick are added.`),
    h('div', { class: 'list', style: { maxHeight: '55vh', overflow: 'auto', margin: '10px 0' } }, ticks.map(t => h('label', { class: 'item' }, h('input', { type: 'checkbox', disabled: t.dupe, onChange: (e) => { t.on = e.target.checked; } }), h('div', { class: 'grow' }, h('div', { class: 'name' }, t.c.name), h('div', { class: 'meta' }, t.dupe ? 'already added' : t.c.phone || ''))))),
    h('button', { class: 'btn primary', onClick: () => { const add = ticks.filter(t => t.on).map(t => t.c); ctx.update(s => add.reduce((x, c) => F.addFriend(x, { ...c, kind: 'other' }), s)); box.close(); ctx.render(); toast(`${add.length} added`); } }, 'Add ticked')]);
}

// ───────────── editor
export function friendSheet(f) {
  const s0 = S(), v = f || { kind: 'other', every: 21, sched: {}, weeklyOff: [] }, sched = { ...(v.sched || {}) }, weekly = new Set(v.weeklyOff || []);
  const inp = (k, ph = '', type = 'text') => h('input', { type, value: v[k] || '', placeholder: ph });
  const name = inp('name', 'Name'), nick = inp('nick', 'What you call them'), phone = inp('phone', '05… or +966…', 'tel'), wa = inp('whatsapp', 'if different from phone', 'tel'), snap = inp('snap', 'username or link'), ig = inp('insta', '@username or link'), place = inp('place', 'Area / where they live (for picking spots)'), bd = inp('birthday', 'YYYY-MM-DD or MM-DD');
  const kind = h('select', {}, F.FRIEND_KINDS.map(k => h('option', { value: k.id, selected: k.id === v.kind }, k.label))), every = h('input', { type: 'number', min: 0, max: 365, value: v.every ?? 21 }), notes = h('textarea', { rows: 2, placeholder: 'Food they like, allergies, what to avoid…' }, v.notes || '');
  const rotaOpts = [{ key: '', name: 'Not in the rota (I enter their shifts)' }, ...F.matchRota(s0, '').concat(Object.values(s0.rotas || {}).flatMap(r => r.people).filter((p, i, a) => a.findIndex(q => q.name === p.name) === i).map(p => ({ key: p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`, name: p.name, mobile: p.mobile })).filter(p => p.name !== s0.me?.name))];
  const uniq = rotaOpts.filter((o, i, a) => a.findIndex(q => q.key === o.key) === i), rota = h('select', {}, uniq.map(o => h('option', { value: o.key, selected: o.key === (v.rotaKey || '') }, o.name)));
  rota.addEventListener('change', () => { const o = uniq.find(x => x.key === rota.value); if (o?.mobile && !phone.value) phone.value = o.mobile; if (o?.name && !name.value) name.value = o.name.replace(/^Dr\.?\s*/i, ''); });
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i)), CYCLE = ['', 'D', 'E', 'N', 'off', 'leave'];
  const cells = days.map(d => { const k = keyOf(d), b = h('button', { type: 'button', class: `sc-paint c-${sched[k] || 'none'}`, onClick: () => { const n = CYCLE[(CYCLE.indexOf(sched[k] || '') + 1) % CYCLE.length]; if (n) sched[k] = n; else delete sched[k]; b.className = `sc-paint c-${n || 'none'}`; b.lastChild.textContent = n || '·'; } }, h('small', {}, `${DAY_SHORT[d.getDay()][0]}${d.getDate()}`), h('b', {}, sched[k] || '·')); return b; });
  const wk = DAY_SHORT.map((n, i) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: weekly.has(i), onChange: (e) => e.target.checked ? weekly.add(i) : weekly.delete(i) }), ' ' + n));
  const paint = h('details', { open: !v.rotaKey || Object.keys(sched).length > 0 }, h('summary', {}, v.rotaKey ? 'Shifts I enter by hand (used when the schedule has nothing, e.g. pulled out)' : 'Their shifts'), h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Tap a day to cycle: D day · E evening · N night · off · leave. Clear = unknown.'), h('div', { class: 'sc-paints' }, cells), h('div', { class: 'tiny dim', style: { margin: '8px 0 4px' } }, 'Always off on:'), h('div', { class: 'chips' }, wk));
  const save = () => { if (!name.value.trim()) return toast('Give them a name', 'err'); const data = { name: name.value, nick: nick.value, kind: kind.value, phone: phone.value, whatsapp: wa.value, snap: snap.value, insta: ig.value, place: place.value, birthday: bd.value.trim(), every: +every.value || 0, notes: notes.value, rotaKey: rota.value, sched, weeklyOff: [...weekly] };
    ctx.update(s => f ? F.updateFriend(s, f.id, data) : F.addFriend(s, data)); box.close(); ctx.render(); };
  const box = ctx.sheet([h('h2', {}, f ? f.name : 'New friend'), field('Name', name), field('Nickname', nick), field('Type', kind),
    h('div', { class: 'grid2' }, field('Phone', phone), field('WhatsApp', wa)), h('div', { class: 'grid2' }, field('Snapchat', snap), field('Instagram', ig)),
    field('Their rota row', rota), paint, field('Area', place), h('div', { class: 'grid2' }, field('Birthday', bd), field('See them every (days, 0 = off)', every)), field('Notes', notes),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: save }, 'Save'), f ? h('button', { class: 'btn danger', onClick: () => { if (confirm(`Remove ${f.name}?`)) { ctx.update(s => F.deleteFriend(s, f.id)); box.close(); ctx.render(); } } }, 'Remove') : null)]);
}

// ───────────── free-days grid
const T0 = 8 * 60, T1 = 24 * 60, pct = (m) => Math.max(0, Math.min(100, (m - T0) / (T1 - T0) * 100));
/** Thin timeline at the bottom of a cell: green where they are free (08:00 → 24:00). */
const tl = (wins) => h('span', { class: 'sg-tl' }, wins.map(([a, b]) => h('i', { style: { left: `${pct(a)}%`, width: `${Math.max(4, pct(b) - pct(a))}%` } })));
const isBday = (f, d) => !!f.birthday && f.birthday.slice(-5) === keyOf(d).slice(5);
const outingOn = (s, f, d) => F.outingList(s).some(o => o.date === keyOf(d) && (!f || o.who.includes(f.id)));
const mark = (x) => x.status === 'work' ? String(x.type || 'W')[0].toUpperCase() : x.status === 'leave' ? 'L' : x.afterNight ? 'z' : '';
const stateText = (x, wins) => { const free = wins.map(win).join(', '), tm = (m) => fmtMin(Math.min(m, 1439)); if (x.status === 'work') return `working${x.start != null ? ` ${tm(x.start)}–${tm(x.end % 1440 || 1439)}` : ''}${x.type === 'N' || x.end > 1440 ? ' (night)' : ''}${free ? `, free ${free}` : ', no free time'}`; if (x.status === 'leave') return `on leave${free ? `, free ${free}` : ''}`; if (x.status === 'off') return `${x.afterNight ? 'off after a night' : 'day off'}${free ? `, free ${free}` : ''}`; return free || (x.status === 'unknown' ? 'no shift info' : 'busy'); };

function gridCard() {
  const s = S(), fr = F.friendList(s), start = startOfDay(new Date()), N = window.innerWidth < 520 ? 10 : 14, days = Array.from({ length: N }, (_, i) => addDays(start, i));
  const me = days.map(d => F.meState(s, d, ctx.busyOf(d))), st = fr.map(f => days.map(d => F.dayState(s, f, d)));
  const meets = days.map((d, i) => fr.filter((f, r) => me[i].windows.some(a => st[r][i].windows.some(b => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) >= 90))).length);
  const allFree = days.map((_, i) => fr.length && meets[i] === fr.length);
  const cell = (x, wins, label, d, extra = {}) => { const free = wins.length ? (wins.some(w => w[1] - w[0] >= 480) ? 'all' : 'part') : x.status === 'unknown' ? 'unknown' : 'busy';
    return h('button', { class: `sg-cell ${free} ${x.status === 'work' ? 'wk' : ''} ${+d === +start ? 'today' : ''}`, title: label, 'aria-label': label, onClick: () => daySheet(d) }, h('b', {}, mark(x)), extra.bday ? h('em', { class: 'sg-badge' }, '🎂') : extra.outing ? h('em', { class: 'sg-badge dot' }) : null, wins.length ? tl(wins) : null); };
  return h('div', { class: 'card sg' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Who is free'), h('button', { class: 'btn sm', onClick: () => findSheet() }, '🔎 Find a day')),
    h('div', { class: 'sg-wrap', style: { '--n': N } },
      h('div', { class: 'sg-row sg-head' }, h('span', { class: 'sg-name' }), days.map((d, i) => h('button', { class: `sg-day ${[5, 6].includes(d.getDay()) ? 'we' : ''} ${allFree[i] ? 'best' : ''} ${i === 0 ? 'today' : ''}`, 'aria-label': `${dayLabel(d)}: ${meets[i]} of ${fr.length} can meet you`, onClick: () => daySheet(d) }, h('small', {}, DAY_SHORT[d.getDay()][0]), d.getDate(), h('i', { class: `sg-n ${meets[i] ? '' : 'zero'}` }, meets[i])))),
      h('div', { class: 'sg-row me' }, h('span', { class: 'sg-name' }, 'You'), days.map((d, i) => cell(me[i], me[i].windows, `You, ${dayLabel(d)}: ${stateText(me[i], me[i].windows)}`, d, { outing: outingOn(s, null, d) }))),
      ...fr.map((f, r) => { const off = st[r].filter(x => x.free === 'all').length; return h('div', { class: 'sg-row' }, h('button', { class: 'sg-name', onClick: () => friendSheet(f) }, F.shortName(f), h('small', {}, off ? `${off} off` : st[r].every(x => x.free === 'unknown') ? 'no info' : '')),
        days.map((d, i) => cell(st[r][i], st[r][i].windows, `${F.shortName(f)}, ${dayLabel(d)}: ${stateText(st[r][i], st[r][i].windows)}${isBday(f, d) ? ' · birthday' : ''}`, d, { bday: isBday(f, d), outing: outingOn(s, f, d) }))); })),
    h('div', { class: 'sg-key' }, [['all', '', 'day off'], ['part', '', 'partly free'], ['part wk', 'D', 'working · letter = shift'], ['busy wk', 'N', 'working, no gap'], ['unknown', '', 'no info']].map(([c, t, l]) => h('span', { class: 'sg-k' }, h('i', { class: `sg-cell ${c}` }, h('b', {}, t)), l)),
      h('span', { class: 'sg-k' }, h('i', { class: 'sg-cell part' }, h('b', {}, 'z')), 'after a night'), h('span', { class: 'sg-k' }, h('i', { class: 'sg-cell part' }, h('span', { class: 'sg-tl' }, h('i', { style: { left: '60%', width: '40%' } }))), 'green line = free hours 08–24'), h('span', { class: 'sg-k' }, h('i', { class: 'sg-n' }, '3'), 'can meet you that day')));
}

/** One day, everyone on a 08:00–24:00 line: red = working, green = free, orange band = when you are all free. */
function daySheet(d, people = null) {
  const s = S(), list = people || F.friendList(s), me = F.meState(s, d, ctx.busyOf(d)), st = list.map(f => ({ f, x: F.dayState(s, f, d) }));
  const common = F.commonFree(s, list, { from: d, days: 1, busyOf: ctx.busyOf, minMin: 60 })[0];
  const band = common?.window ? h('i', { class: 'dl-common', style: { left: `${pct(common.window[0])}%`, width: `${pct(common.window[1]) - pct(common.window[0])}%` } }) : null;
  const work = (x) => { if (x.status !== 'work' || x.start == null) return []; const a = x.start, b = x.end; return b > 1440 ? [[a, 1440], [0, b - 1440]] : [[a, b]]; };
  const line = (label, x, sub) => h('div', { class: 'dl-row' }, h('div', { class: 'dl-name' }, h('b', {}, label), h('small', {}, sub)), h('div', { class: 'dl-bar' }, band ? band.cloneNode() : null, ...work(x).map(([a, b]) => h('i', { class: 'dl-work', style: { left: `${pct(a)}%`, width: `${Math.max(1, pct(b) - pct(a))}%` } })), ...x.windows.map(([a, b]) => h('i', { class: 'dl-free', style: { left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` } }))));
  ctx.sheet([h('h2', {}, `${dayLabel(d)} · ${relDay(d)}`),
    common?.window ? h('div', { class: 'cr-key soon' }, h('div', { class: 'grow' }, h('b', {}, common.all ? `Everyone free ${win(common.window)}` : `${common.free.length} of ${list.length} free together ${win(common.window)}`), common.missing.length || common.unknown.length ? h('div', { class: 'tiny dim' }, [common.missing.length ? `not free: ${common.missing.map(F.shortName).join(', ')}` : '', common.unknown.length ? `no info: ${common.unknown.map(F.shortName).join(', ')}` : ''].filter(Boolean).join(' · ')) : null), list.length ? h('button', { class: 'btn sm', onClick: () => { document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); inviteSheet(common.free.filter(f => S().friends?.[f.id]).map(f => f.id), { date: d, window: common.window, who: common.free.map(f => f.id) }); } }, 'Invite') : null) : h('div', { class: 'small muted' }, 'No time when you are all free that day.'),
    h('div', { class: 'dl' }, h('div', { class: 'dl-axis' }, h('span', {}), h('div', {}, ['08', '12', '16', '20', '24'].map(t => h('small', {}, t)))), line('You', me, stateText(me, me.windows)), st.map(({ f, x }) => line(F.shortName(f), x, stateText(x, x.windows))))]);
}

// ───────────── find a day for any group of people in the app
let pick = new Set(), pickMin = 120, pickDays = 21, pickMe = true;
export function findSheet(preset) {
  if (preset) pick = new Set(preset);
  const wrap = h('div', {}), box = ctx.sheet([wrap]); let q = '';
  const everyone = () => { const s = S(), seen = new Set(), out = []; for (const f of F.friendList(s)) { out.push({ key: f.id, name: F.shortName(f), full: f.name, group: 'Friends', rec: f }); if (f.rotaKey) seen.add(f.rotaKey); }
    for (const p of ctx.allPeople()) { if (seen.has(p.key) || ctx.isMeKey?.(p.key)) continue; const u = [...p.units]; out.push({ key: p.key, name: p.name.replace(/^Dr\.?\s*/i, ''), full: p.name, group: u.includes('nurse') ? 'Nurses' : u.includes('gp') ? 'GPs' : 'Specialists', rec: null }); } return out; };
  const paint = () => {
    const all = everyone(), byKey = new Map(all.map(x => [x.key, x])), chosen = [...pick].map(k => byKey.get(k)).filter(Boolean), s = S();
    const people = chosen.map(c => c.rec || F.personRecord(s, c.key, c.full)), res = people.length ? F.commonFree(s, people, { days: pickDays, withMe: pickMe, minMin: pickMin, busyOf: ctx.busyOf }) : [];
    const good = res.filter(r => r.all), near = res.filter(r => !r.all && r.window && r.missing.length + r.unknown.length === 1 && people.length > 1).slice(0, 5), unknownAll = chosen.filter((c, i) => res.length && res.every(r => r.unknown.includes(people[i])));
    const matches = q ? all.filter(x => !pick.has(x.key) && x.full.toLowerCase().includes(q.toLowerCase())).slice(0, 12) : [];
    const groups = ['Friends', 'GPs', 'Specialists', 'Nurses'].map(g => [g, all.filter(x => x.group === g && !pick.has(x.key))]).filter(([, l]) => l.length);
    const search = h('input', { type: 'search', class: 'dir-search', placeholder: 'Search anyone in the app', value: q, onInput: (e) => { q = e.target.value; paint(); const i = wrap.querySelector('.dir-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    const chip = (x, on) => h('button', { class: `chip ${on ? 'sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', onClick: () => { on ? pick.delete(x.key) : pick.add(x.key); paint(); } }, on ? `${x.name} ✕` : x.name);
    const dayRow = (r) => h('button', { class: `fd-day ${r.all ? 'all' : ''} ${r.weekend ? 'we' : ''}`, onClick: () => daySheet(r.date, people) }, h('div', { class: 'fd-date' }, h('b', {}, `${DAY_SHORT[r.date.getDay()]} ${r.date.getDate()}`), h('small', {}, MONTHS[r.date.getMonth()].slice(0, 3))),
      h('div', { class: 'grow' }, h('div', {}, win(r.window), r.window[1] - r.window[0] >= 480 ? h('span', { class: 'chip sel', style: { marginLeft: '6px' } }, 'all day') : null), !r.all ? h('div', { class: 'tiny dim' }, r.missing.length ? `${r.missing.map(F.shortName).join(', ')} can't` : `no info for ${r.unknown.map(F.shortName).join(', ')}`) : null), h('span', { class: 'fd-go' }, '›'));
    wrap.replaceChildren(h('h2', {}, 'Find a day'), h('div', { class: 'small muted' }, 'Pick anyone: friends, colleagues, nurses. You get the days you are all free.'),
      chosen.length ? h('div', { class: 'chips', style: { margin: '8px 0' } }, chosen.map(x => chip(x, true)), h('button', { class: 'chip ghost', onClick: () => { pick.clear(); paint(); } }, 'Clear')) : null,
      search, matches.length ? h('div', { class: 'chips', style: { margin: '6px 0' } }, matches.map(x => chip(x, false))) : null,
      !q ? groups.map(([g, l]) => h('details', { class: 'fd-group', open: g === 'Friends' ? '' : null }, h('summary', { class: 'tiny dim' }, `${g} (${l.length})`), h('div', { class: 'chips' }, l.slice(0, 80).map(x => chip(x, false))))) : null,
      h('div', { class: 'row wrap', style: { margin: '10px 0 4px', gap: '6px' } }, h('div', { class: 'chips' }, [[90, '1½h'], [120, '2h'], [240, '4h'], [480, 'all day']].map(([m, l]) => h('button', { class: `chip ${pickMin === m ? 'sel' : ''}`, onClick: () => { pickMin = m; paint(); } }, l))), h('div', { class: 'chips' }, [[14, '2 wks'], [21, '3 wks'], [42, '6 wks']].map(([n, l]) => h('button', { class: `chip ${pickDays === n ? 'sel' : ''}`, onClick: () => { pickDays = n; paint(); } }, l))),
        h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: pickMe, onChange: (e) => { pickMe = e.target.checked; paint(); } }), ' include me')),
      !chosen.length ? h('div', { class: 'empty small' }, 'Pick at least one person.') : h('div', { class: 'fd-res' },
        unknownAll.length ? h('div', { class: 'lw-flag warn' }, `No schedule for ${unknownAll.map(x => x.name).join(', ')}: add their shifts on their friend card, or they can never count as free.`) : null,
        h('div', { class: 'title' }, good.length ? `${good.length} day${good.length > 1 ? 's' : ''} you are all free` : 'No day where everyone is free'),
        (() => { const whole = good.filter(r => r.window[1] - r.window[0] >= 480), part = good.filter(r => r.window[1] - r.window[0] < 480); return [whole.length && part.length ? h('div', { class: 'tiny dim', style: { margin: '6px 0 2px' } }, `Whole day (${whole.length})`) : null, whole.map(dayRow), whole.length && part.length ? h('div', { class: 'tiny dim', style: { margin: '8px 0 2px' } }, `Part of the day (${part.length})`) : null, part.map(dayRow)]; })(),
        near.length ? [h('div', { class: 'title', style: { marginTop: '10px' } }, 'All but one'), near.map(dayRow)] : null,
        good.length && chosen.every(c => c.rec) ? h('button', { class: 'btn primary', style: { marginTop: '10px' }, onClick: () => { document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); ctx.update(st => XU_poll(st, chosen.map(c => c.key), good.slice(0, 4))); toast('Poll created in Social → Plans'); ctx.render(); } }, 'Make a poll from the best days') : null));
  };
  paint();
}
const XU_poll = (st, who, days) => ({ ...st, polls: { ...(st.polls || {}), ['p' + Date.now().toString(36)]: { id: 'p' + Date.now().toString(36), title: 'Meet up', slots: days.map(r => ({ date: r.key, start: r.window[0], end: Math.min(r.window[1], r.window[0] + 180) })), who, votes: {}, status: 'open', chosen: -1, at: Date.now() } } });

// ───────────── best times and invitations
function meetCard(m, small) {
  const names = m.who.map(nameOf);
  return h('div', { class: 'meet' }, h('div', { class: 'meet-when' }, h('b', {}, dayLabel(m.date)), h('span', { class: 'dim tiny' }, relDay(m.date))), h('div', { class: 'grow' }, h('div', { class: 'name' }, win(m.window), m.dayLong ? ' · all day' : ''), h('div', { class: 'tiny dim' }, names.join(', ') + (m.missing.length ? ` · not ${m.missing.map(nameOf).join(', ')}` : ''))), h('button', { class: 'btn sm primary', onClick: () => inviteSheet(m.who, m) }, 'Invite'));
}
function bestCard() {
  const s = S(), list = F.meetups(s, { busyOf: ctx.busyOf, days: 21 }).slice(0, 5);
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Best times to meet'), list.length ? list.map(m => meetCard(m)) : h('div', { class: 'small muted' }, 'No overlap yet. Add shift info for your friends (link them to the rota, or paint their days) and the best slots appear here.'));
}
function nudgeCard() {
  const s = S(), od = F.friendList(s).map(f => ({ f, d: F.overdue(s, f) })).filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3), bd = F.birthdays(s, new Date(), 30).slice(0, 3);
  const extra = XU.nudgeRows(); if (!od.length && !bd.length && !extra.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Don’t let it slip'), extra,
    od.map(({ f, d }) => h('div', { class: 'row nudge' }, av(f), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'tiny dim' }, `${F.lastSeen(s, f.id) ? `last seen ${relDay(fromKey(F.lastSeen(s, f.id)))}` : 'not seen yet'} · ${d} day${d === 1 ? '' : 's'} past your ${f.every}-day gap`)), reach(f), h('button', { class: 'btn sm', onClick: () => inviteSheet([f.id]) }, 'Invite'))),
    bd.map(({ f, inDays }) => h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '🎂'), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'tiny dim' }, inDays === 0 ? 'Birthday today' : `Birthday in ${inDays} day${inDays === 1 ? '' : 's'}`)), h('button', { class: 'btn sm', onClick: () => inviteSheet([f.id], null, `Surprise for ${F.shortName(f)}’s birthday`) }, 'Plan'))));
}

export function inviteSheet(ids, meet = null, what = '') {
  const s = S(), fr = F.friendList(s), sel = new Set(ids || []); let choice = meet ? [meet] : [], idea = what;
  const body = h('div'), msgBox = h('textarea', { rows: 5, class: 'inp' }), calc = () => (meet ? [] : F.meetups(s, { ids: [...sel], busyOf: ctx.busyOf, days: 21 }).slice(0, 3));
  const fmtT = (m) => fmtMin(Math.min(m, 1439)), ideasFor = () => { const c = choice[0]; const watch = L.rankPlanned?.(s, ['movie'])?.[0]?.item?.title || ''; const g = L.mediaList(s).find(x => x.kind === 'game' && x.status === 'planned')?.title || ''; return F.ideas({ window: c?.window, size: sel.size + 1, date: c?.date, watch, backlogGame: g, birthday: F.birthdays(s, new Date(), 14).find(b => sel.has(b.friend.id))?.friend.name }); };
  const rebuildMsg = () => { msgBox.value = choice.length ? F.inviteText({ names: [...sel].map(nameOf), choices: choice, what: idea, fmtDay: (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`, fmtT }) : `Hey ${[...sel].map(nameOf).join(', ') || 'everyone'}! ${idea ? idea + '? ' : ''}When are you free?`; };
  const paint = () => {
    if (!meet) choice = choice.filter(c => c.who.every(w => sel.has(w)) || true);
    const opts = meet ? [meet] : calc(); if (!meet && !choice.length) choice = opts.slice(0, 1);
    const ideas = ideasFor();
    body.replaceChildren(
      h('div', { class: 'chips' }, fr.map(f => h('label', { class: `chip ${sel.has(f.id) ? 'sel' : ''}` }, h('input', { type: 'checkbox', checked: sel.has(f.id), style: { display: 'none' }, onChange: (e) => { e.target.checked ? sel.add(f.id) : sel.delete(f.id); if (!meet) choice = []; paint(); } }), F.shortName(f)))),
      meet ? h('div', { class: 'small', style: { margin: '10px 0' } }, `${dayLabel(meet.date)} · ${win(meet.window)}`) : [h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'Times that suit everyone selected (tick the ones to offer)'),
        opts.length ? opts.map(o => h('label', { class: 'item' }, h('input', { type: 'checkbox', checked: choice.some(c => c.key === o.key && c.window[0] === o.window[0]), onChange: (e) => { choice = e.target.checked ? [...choice, o] : choice.filter(c => c !== o && !(c.key === o.key && c.window[0] === o.window[0])); rebuildMsg(); } }), h('div', { class: 'grow' }, h('div', { class: 'name' }, dayLabel(o.date), ' · ', win(o.window)), h('div', { class: 'tiny dim' }, o.who.map(nameOf).join(', '))))) : h('div', { class: 'small muted' }, sel.size ? 'No shared free time found in 3 weeks.' : 'Pick at least one friend.')],
      h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'What to do'), h('div', { class: 'chips' }, ideas.map(i => h('button', { class: `chip ${idea === i.title ? 'sel' : ''}`, title: i.why, onClick: () => { idea = i.title; rebuildMsg(); paint(); } }, `${i.icon} ${i.title}`))), idea ? h('div', { class: 'tiny dim' }, ideas.find(i => i.title === idea)?.why || '') : null,
      h('div', { style: { height: '10px' } }), msgBox,
      h('div', { class: 'row wrap', style: { marginTop: '10px' } }, [...sel].map(id => { const f = s.friends[id]; const u = F.waWith(f, msgBox.value); return u ? h('a', { class: 'btn grow', href: u, target: '_blank', rel: 'noopener', onClick: (e) => { e.currentTarget.href = F.waWith(f, msgBox.value); } }, `💬 ${F.shortName(f)}`) : h('span', { class: 'btn grow ghost', title: 'No number saved' }, `${F.shortName(f)} — no number`); }),
        h('button', { class: 'btn', onClick: async () => { try { await navigator.clipboard.writeText(msgBox.value); toast('Message copied'); } catch { msgBox.select(); toast('Select and copy the message', 'err'); } } }, 'Copy')),
      h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn primary grow', disabled: !choice.length || !sel.size, onClick: async () => { const c = choice[0]; ctx.update(x => F.logOuting(x, { date: c.key, who: [...sel], what: idea, planned: true })); try { await ctx.addEvent({ title: `${idea || 'Meet up'} with ${[...sel].map(nameOf).join(', ')}`, date: c.key, start: fmtT(c.window[0]), end: fmtT(Math.min(c.window[0] + 120, c.window[1])), minutes: 120, text: 'Planned in Citrus.' }); toast('Planned and added to your calendar'); } catch { toast('Planned (connect Google to add it to your calendar)'); } box.close(); ctx.render(); } }, 'Save as planned')));
    rebuildMsg();
  };
  const box = ctx.sheet([h('h2', {}, 'Plan a meet-up'), body]); paint();
}

// ───────────── logging
export function outingSheet(o) {
  const s = S(), fr = F.friendList(s), who = new Set(o?.who || []), date = h('input', { type: 'date', value: o?.date || keyOf(new Date()) }), what = h('input', { value: o?.what || '', placeholder: 'Dinner, padel, coffee…' }), where = h('input', { value: o?.where || '', placeholder: 'Where' }), rating = h('select', {}, [0, 1, 2, 3, 4, 5].map(n => h('option', { value: n, selected: n === (o?.rating || 0) }, n ? '★'.repeat(n) : 'No rating'))), notes = h('textarea', { rows: 2 }, o?.notes || '');
  const box = ctx.sheet([h('h2', {}, o ? 'Edit outing' : 'Log an outing'), h('div', { class: 'chips' }, fr.map(f => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: who.has(f.id), onChange: (e) => e.target.checked ? who.add(f.id) : who.delete(f.id) }), ' ' + F.shortName(f)))), field('Date', date), field('What', what), field('Where', where), field('How was it', rating), field('Notes', notes),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { ctx.update(x => F.logOuting(x, { id: o?.id, date: date.value, who: [...who], what: what.value, where: where.value, rating: +rating.value, notes: notes.value, planned: o ? o.planned && date.value > keyOf(new Date()) : false })); box.close(); ctx.render(); } }, o?.planned ? 'Mark as happened' : 'Save'), o ? h('button', { class: 'btn danger', onClick: () => { ctx.update(x => F.deleteOuting(x, o.id)); box.close(); ctx.render(); } }, 'Delete') : null)]);
}

// ───────────── segments
const friendCard = (f) => { const s = S(), next = F.meetups(s, { ids: [f.id], busyOf: ctx.busyOf, days: 21 })[0], ls = F.lastSeen(s, f.id), od = F.overdue(s, f), kindLabel = F.FRIEND_KINDS.find(k => k.id === f.kind)?.label;
  return h('div', { class: 'card friend' }, h('div', { class: 'row' }, av(f), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name, f.fav ? ' ⭐' : ''), h('div', { class: 'tiny dim' }, [kindLabel, f.place, f.rotaKey ? 'linked to schedule' : '', ls ? `seen ${relDay(fromKey(ls))}` : ''].filter(Boolean).join(' · ')), f.notes ? h('div', { class: 'tiny fr-note' }, f.notes) : null), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${f.name}`, onClick: () => friendSheet(f) }, '⋯')),
    reach(f, ''), (() => { const st = F.dayState(s, f, new Date()); return st.why && st.free === 'unknown' ? h('div', { class: 'chip pull' }, `${st.why}: not in the schedule`) : null; })(), h('div', { class: 'row wrap fr-foot' }, next ? h('span', { class: 'chip sel' }, `Free together: ${dayLabel(next.date)} ${win(next.window)}`) : h('span', { class: 'chip' }, 'No shared time found'), od ? h('span', { class: 'chip late' }, `${od}d overdue`) : null, h('button', { class: 'btn sm grow', onClick: () => inviteSheet([f.id]) }, 'Invite'))); };
function friendsSeg() { const fr = F.friendList(S()); return [...starterCard(), ...fr.map(friendCard), h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => friendSheet(null) }, '+ Add a friend'), fr.length ? contactsButton() : null)]; }
function outingsSeg() {
  const s = S(), list = F.outingList(s), today = keyOf(new Date()), up = list.filter(o => o.planned && o.date >= today).reverse(), past = list.filter(o => !(o.planned && o.date >= today));
  const row = (o) => h('div', { class: 'item clickable', onClick: () => outingSheet(o) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, o.what || 'Meet-up', o.where ? ` · ${o.where}` : ''), h('div', { class: 'meta' }, `${relDay(fromKey(o.date))} · ${o.who.map(nameOf).join(', ') || 'solo'}${o.rating ? ' · ' + '★'.repeat(o.rating) : ''}`)), o.planned ? h('span', { class: 'chip sel' }, o.date <= today ? 'did it happen?' : 'planned') : null);
  const y = String(new Date().getFullYear()), yr = past.filter(o => !o.planned && o.date.startsWith(y));
  return [h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => outingSheet(null) }, 'Log an outing'), h('button', { class: 'btn grow', onClick: () => inviteSheet([]) }, 'Plan one')),
    up.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Coming up'), h('div', { class: 'list' }, up.map(row))) : null,
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'History'), past.length ? [h('div', { class: 'tiny dim' }, `${yr.length} meet-up${yr.length === 1 ? '' : 's'} this year`), h('div', { class: 'list' }, past.slice(0, 40).map(row))] : h('div', { class: 'small muted' }, 'Nothing logged yet.'))];
}
function overviewSeg() {
  const fr = F.friendList(S()); if (!fr.length) return starterCard();
  return [gridCard(), bestCard(), nudgeCard(), ...starterCard()];
}

export function renderSocial() {
  const SEGS = [['overview', 'Overview'], ['friends', 'Friends'], ['outings', 'Outings'], ['plans', 'Plans']];
  const body = seg === 'friends' ? friendsSeg() : seg === 'outings' ? outingsSeg() : seg === 'plans' ? XU.renderPlans() : overviewSeg();
  return [h('h1', {}, 'Social'), h('div', { class: 'seg mind-seg', role: 'tablist' }, SEGS.map(([id, l]) => h('button', { class: seg === id ? 'active' : '', role: 'tab', 'aria-selected': seg === id ? 'true' : 'false', onClick: () => { seg = id; ctx.render(); } }, l))), ...body];
}
/** Small card for Today: who is free together soon. */
export function todayCard() {
  const s = S(); if (!F.friendList(s).length) return null; const top = F.meetups(s, { busyOf: ctx.busyOf, days: 7 }).slice(0, 2); if (!top.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Friends'), h('button', { class: 'btn sm ghost', onClick: () => ctx.go('social') }, 'Open')), top.map(m => meetCard(m)));
}
