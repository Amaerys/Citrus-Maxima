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
function gridCard() {
  const s = S(), fr = F.friendList(s), start = startOfDay(new Date()), N = window.innerWidth < 520 ? 10 : 14, days = Array.from({ length: N }, (_, i) => addDays(start, i));
  const me = days.map(d => F.myWindows(s, d, ctx.busyOf(d))), st = fr.map(f => days.map(d => F.dayState(s, f, d)));
  const allFree = days.map((_, i) => me[i].length && fr.length && st.every(r => r[i].free === 'all' || r[i].free === 'part'));
  const letter = (x) => String(x.type || 'W')[0].toUpperCase(), tm = (m) => fmtMin(Math.min(m, 1439));
  const stateText = (x, wins) => { const free = wins.map(win).join(', '); if (x.status === 'work') return `working${x.start != null ? ` ${tm(x.start)}–${tm(x.end % 1440 || 1439)}` : ''}${x.type === 'N' || x.end > 1440 ? ' (night)' : ''}${free ? `, free ${free}` : ', no free time'}`; if (x.status === 'leave') return `on leave${free ? `, free ${free}` : ''}`; if (x.status === 'off') return `day off${free ? `, free ${free}` : ''}`; return free || (x.status === 'unknown' ? 'no shift info' : 'busy'); };
  const cell = (cls, title, onClick, txt = '') => h('button', { class: `sg-cell ${cls}`, title, 'aria-label': title, onClick }, txt);
  return h('div', { class: 'card sg' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Who is free'), h('span', { class: 'tiny dim' }, `next ${N} days`)),
    h('div', { class: 'sg-wrap', style: { '--n': N } },
      h('div', { class: 'sg-row sg-head' }, h('span', { class: 'sg-name' }), days.map((d, i) => h('span', { class: `sg-day ${[5, 6].includes(d.getDay()) ? 'we' : ''} ${allFree[i] ? 'best' : ''}` }, h('small', {}, DAY_SHORT[d.getDay()][0]), d.getDate()))),
      h('div', { class: 'sg-row me' }, h('span', { class: 'sg-name' }, 'You'), days.map((d, i) => { const m = F.meState(s, d, ctx.busyOf(d)); return cell(`${me[i].length ? (me[i].some(w => w[1] - w[0] >= 480) ? 'all' : 'part') : 'busy'}${m.status === 'work' ? ' wk' : ''}`, `You, ${dayLabel(d)}: ${stateText(m, me[i])}`, () => daySheet(d), m.status === 'work' ? letter(m) : ''); })),
      ...fr.map((f, r) => h('div', { class: 'sg-row' }, h('button', { class: 'sg-name', onClick: () => friendSheet(f) }, F.shortName(f)), days.map((d, i) => cell(`${st[r][i].free}${st[r][i].status === 'work' ? ' wk' : ''}`, `${F.shortName(f)}, ${dayLabel(d)}: ${stateText(st[r][i], st[r][i].windows)}`, () => daySheet(d), st[r][i].status === 'work' ? letter(st[r][i]) : ''))))),
    h('div', { class: 'chips sg-key' }, h('span', { class: 'chip' }, h('i', { class: 'sg-dot all' }), 'day off, free'), h('span', { class: 'chip' }, h('i', { class: 'sg-dot part' }), 'partly free'), h('span', { class: 'chip' }, h('i', { class: 'sg-dot part wk' }), 'working, free around it (letter = shift)'), h('span', { class: 'chip' }, h('i', { class: 'sg-dot busy' }), 'working, no gap'), h('span', { class: 'chip' }, h('i', { class: 'sg-dot unknown' }), 'no info')));
}
function daySheet(d) {
  const s = S(), fr = F.friendList(s), mine = F.myWindows(s, d, ctx.busyOf(d));
  const row = (label, wins, extra) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, label), h('div', { class: 'meta' }, extra || '')), h('b', {}, wins.length ? wins.map(win).join(' · ') : '—'));
  ctx.sheet([h('h2', {}, `${dayLabel(d)} · ${relDay(d)}`), h('div', { class: 'list' }, row('You', mine, mine.length ? '' : 'working or booked'), fr.map(f => { const x = F.dayState(s, f, d); return row(F.shortName(f), x.windows, x.free === 'unknown' ? 'no shift info for this day' : x.afterNight ? 'after a night shift' : x.status === 'work' ? `working ${x.type}` : x.status === 'leave' ? 'on leave' : x.status === 'off' ? 'off' : ''); }))]);
}

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
