// People: one directory for every schedule you have (GPs, ER specialists, nurses) with numbers and social handles,
// the nurses' postings board, and who will work with you. Used by Work → People / Nurses, the day sheet and Today.
import { h, toast, keyOf, addDays, startOfDay, relDay, fmtMin, fmtDur, DAY_SHORT, MONTHS } from './util.js';
const initials = (n) => String(n).replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
import { dayInfo, allPeople, isMe, sharedShifts } from './model.js';
import { interpretCode } from './rota-parser.js';
import * as F from './social.js';
import * as N from './nurses.js';

let mode = 'confirm', heardFrom = null, dirMode = 'list', rMonth = null, rUnit = '', pMonth = {};
let ctx = null, query = '', cat = 'all', ngroup = 'all', onlyToday = false, nDate = startOfDay(new Date());
export function initPeople(c) { ctx = c; }
const S = () => ctx.S();
const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayLabel = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
export const goNurses = (date) => { if (date) nDate = startOfDay(date); };

const CATS = [['all', 'All'], ['gp', 'GPs'], ['spec', 'Specialists'], ['nurse', 'Nurses']];
const catOf = (units) => units.includes('nurse') ? 'nurse' : units.includes('gp') ? 'gp' : 'spec';
const unitWord = { gp: 'GP', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurse' };

// ───────── reach buttons (rota number + whatever you saved)
export function reachRow(p, key, size = 'sm') {
  const l = F.reachLinks(S(), p, key), mk = (href, cls, t, label) => href ? h('a', { class: `btn ${size} ghost sc-btn ${cls}`, href, target: cls === 'call' ? undefined : '_blank', rel: 'noopener', 'aria-label': `${label} ${p.name}`, onClick: (e) => e.stopPropagation() }, t) : h('span', { class: `btn ${size} ghost sc-btn off`, 'aria-hidden': 'true' }, t);
  return h('div', { class: 'sc-reach' }, mk(l.tel, 'call', '📞', 'Call'), mk(l.wa, 'wa', '💬', 'WhatsApp'), mk(l.snap, 'snap', '👻', 'Snapchat'), mk(l.insta, 'ig', '📸', 'Instagram'));
}
export function contactSheet(p, key) {
  const c = F.contactOf(S(), key), v = (k) => c[k] || '';
  const phone = h('input', { type: 'tel', value: v('phone'), placeholder: p.mobile ? `${p.mobile} (from the rota)` : '05… or +966…' }), wa = h('input', { type: 'tel', value: v('whatsapp'), placeholder: 'if different from phone' }), snap = h('input', { value: v('snap'), placeholder: 'username or link' }), ig = h('input', { value: v('insta'), placeholder: '@username or link' }), note = h('textarea', { rows: 2, placeholder: 'Anything worth remembering' }, v('note'));
  const bday = h('input', { type: 'date', value: /^\d{4}-/.test(c.birthday || '') ? c.birthday : '' });
  const box = ctx.sheet([h('h2', {}, p.name), h('div', { class: 'small muted' }, 'Saved on your devices and in your Drive only.'), field('Phone', phone), field('WhatsApp', wa), h('div', { class: 'grid2' }, field('Snapchat', snap), field('Instagram', ig)), field('Note', note), field('Birthday', bday),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { ctx.update(s => F.setContact(s, key, { phone: phone.value, whatsapp: wa.value, snap: snap.value, insta: ig.value, note: note.value, birthday: bday.value })); document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); ctx.render(); ctx.personSheet(p); } }, 'Save'),
      c.friend ? h('span', { class: 'chip sel' }, 'In your friends') : h('button', { class: 'btn grow', onClick: () => { ctx.update(s => F.friendFromPerson(F.setContact(s, key, { phone: phone.value, whatsapp: wa.value, snap: snap.value, insta: ig.value, note: note.value, birthday: bday.value }), p, key, catOf(personUnits(key)) === 'nurse' ? 'nurse' : 'gp')); document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); toast(`${p.name.replace(/^Dr\.?\s*/i, '')} added to Social`); ctx.render(); } }, 'Add to friends'))]);
}
const personUnits = (key) => { const u = []; for (const r of Object.values(S().rotas)) if (r.people.some(x => ctx.personKeyOf(x) === key)) u.push(r.unitKind); return u; };

/** Block shown at the top of a person's sheet. */
export function personBlock(p) {
  const s = S(), key = ctx.personKeyOf(p), c = F.contactOf(s, key), units = personUnits(key), isN = units.includes('nurse'), np = isN ? N.nurses(s).find(x => ctx.personKeyOf(x) === key) : null, now = startOfDay(new Date());
  const out = [reachRow(p, key, ''), h('div', { class: 'row wrap', style: { gap: '6px', margin: '4px 0 8px' } }, c.note ? h('span', { class: 'small muted grow' }, c.note) : h('span', { class: 'grow' }), h('button', { class: 'btn sm ghost', onClick: () => contactSheet(p, key) }, F.links({ phone: c.phone || p.mobile, snap: c.snap, insta: c.insta }).snap || c.insta || c.phone ? '✎ Edit contact' : '＋ Add numbers & socials'))];
  if (np) {
    const g = N.GROUPS[np.group], row = N.rowsFor(s, now).find(r => r.key === key), hist = N.history(s, key).slice(0, 5);
    out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Nurse'), h('div', { class: 'small' }, [g?.label, np.clinic ? `clinic ${np.clinic}` : '', np.leader ? 'team leader' : '', np.fa ? 'first aider' : ''].filter(Boolean).join(' · ')),
      row ? h('div', { class: 'small', style: { marginTop: '6px' } }, `Today: ${row.shift.label}${row.post ? ` · at ${N.siteLabel(row.post)}` : N.isFloater(row.group) ? ' · not posted yet' : ''}`) : null,
      hist.length ? h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Recent postings: ' + hist.map(x => `${x.date.slice(5)} ${x.site}`).join(' · ')) : null));
  }
  return out;
}

// ───────── directory
const todayShift = (s, key, date) => { for (const r of Object.values(s.rotas)) { if (r.year !== date.getFullYear() || r.month !== date.getMonth() + 1) continue; const p = r.people.find(x => ctx.personKeyOf(x) === key); if (p) { const sh = interpretCode(p.days[date.getDate()] || '', r.legend, r.unitKind); if (sh.kind === 'work' || sh.kind === 'leave') return { sh, code: p.days[date.getDate()] || '', unit: r.unitKind }; } } return null; };
export function renderDirectory() {
  const s = S(), people = allPeople(s);
  if (!people.length) return h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '👥'), 'Import a schedule to see people'));
  const modeSeg = h('div', { class: 'seg view-mode', role: 'tablist', style: { marginBottom: '10px' } }, [['list', 'List'], ['roster', 'Roster grid']].map(([k, l]) => h('button', { class: dirMode === k ? 'active' : '', role: 'tab', onClick: () => { dirMode = k; ctx.render(); } }, l)));
  if (dirMode === 'roster') return [modeSeg, ...renderRoster()];
  const today = startOfDay(new Date()), counts = { all: people.length }; people.forEach(p => { const c = catOf(p.units); counts[c] = (counts[c] || 0) + 1; });
  const input = h('input', { type: 'search', placeholder: 'Search name, title, clinic or number', value: query, class: 'dir-search', onInput: (e) => { query = e.target.value; paintList(); } });
  const seg = h('div', { class: 'seg dir-seg', role: 'tablist' }, CATS.filter(([k]) => counts[k]).map(([k, l]) => h('button', { class: cat === k ? 'active' : '', role: 'tab', onClick: () => { cat = k; if (k !== 'nurse') onlyToday = onlyToday; ctx.render(); } }, `${l} ${counts[k] || 0}`)));
  const nurseMap = new Map(N.nurses(s).map(n => [ctx.personKeyOf(n), n]));
  const groupBar = cat === 'nurse' ? h('div', { class: 'chips', style: { margin: '10px 0 2px' } }, [['all', 'All'], ...Object.entries(N.GROUPS).filter(([g]) => N.nurses(s).some(n => n.group === g)).map(([g, v]) => [g, v.label])].map(([g, l]) => h('button', { class: `chip ${ngroup === g ? 'sel' : ''}`, onClick: () => { ngroup = g; ctx.render(); } }, l)), h('button', { class: `chip ${onlyToday ? 'sel' : ''}`, onClick: () => { onlyToday = !onlyToday; ctx.render(); } }, 'On shift today')) : cat !== 'all' ? h('div', { class: 'chips', style: { margin: '10px 0 2px' } }, h('button', { class: `chip ${onlyToday ? 'sel' : ''}`, onClick: () => { onlyToday = !onlyToday; ctx.render(); } }, 'On shift today')) : null;
  const list = h('div', { class: 'list' }), countEl = h('div', { class: 'tiny dim', style: { margin: '8px 2px' } });
  const rows = people.filter(p => cat === 'all' || catOf(p.units) === cat).map(p => ({ p, n: nurseMap.get(p.key), t: todayShift(s, p.key, today), shared: sharedShifts(s, p.key).length }))
    .filter(x => cat !== 'nurse' || ngroup === 'all' || x.n?.group === ngroup).filter(x => !onlyToday || x.t?.sh.kind === 'work').sort((a, b) => (b.t?.sh.kind === 'work') - (a.t?.sh.kind === 'work') || b.shared - a.shared || a.p.name.localeCompare(b.p.name));
  function paintList() {
    const q = query.toLowerCase().trim(), digits = q.replace(/\D/g, '');
    const shown = rows.filter(({ p, n }) => { if (!q) return true; const c = F.contactOf(s, p.key); return p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q) || (n?.clinic || '').toLowerCase().includes(q) || (N.GROUPS[n?.group]?.label || '').toLowerCase().includes(q) || (digits.length >= 3 && [p.mobile, c.phone, c.whatsapp].some(x => String(x || '').replace(/\D/g, '').includes(digits))) || (c.snap || '').toLowerCase().includes(q) || (c.insta || '').toLowerCase().includes(q); });
    countEl.textContent = `${shown.length} ${shown.length === 1 ? 'person' : 'people'}`;
    list.replaceChildren(...[...shown.slice(0, 150).map(({ p, n, t, shared }) => {
      const post = n && t?.sh.kind === 'work' ? (N.GROUPS[n.group]?.fixed || N.postOf(s, today, p.key)) : '', g = n ? N.GROUPS[n.group]?.label : '';
      return h('div', { class: 'item clickable dir-item', onClick: () => ctx.personSheet(p) }, h('div', { class: `avatar ${catOf(p.units)}` }, initials(p.name)),
        h('div', { class: 'grow' }, h('div', { class: 'name row' }, p.name, isMe(s, p) ? h('span', { class: 'chip sel', style: { padding: '1px 7px', fontSize: '10px' } }, 'you') : null, F.contactOf(s, p.key).friend ? h('span', { class: 'tiny', title: 'friend' }, '⭐') : null),
          h('div', { class: 'meta' }, [n ? g : p.title, n?.leader ? 'leader' : '', cat === 'all' || !n ? p.units.map(u => unitWord[u]).join(' + ') : '', shared ? `${shared} shifts with you` : ''].filter(Boolean).join(' · '))),
        t ? h('span', { class: 'sh-mini' }, ctx.shiftChip(t.sh, t.code), post ? h('small', {}, post.length > 4 ? post : post) : null) : null, reachRow(p, p.key));
    }), shown.length > 150 ? h('div', { class: 'tiny dim', style: { padding: '8px' } }, `Showing 150 of ${shown.length}: search to narrow down`) : null].filter(Boolean));
  }
  paintList();
  return [modeSeg, h('div', { class: 'row', style: { marginTop: '4px' } }, input), seg, groupBar, countEl, h('div', { class: 'card', style: { padding: '4px 6px' } }, list)];
}

// ───────── nurses: day board
const siteTile = (id, rows, date, tips = []) => h('div', { class: `post-tile ${id}` }, h('div', { class: 'row' }, h('b', { class: 'grow' }, N.siteLabel(id)), h('span', { class: 'chip' }, rows.length), tips.length ? h('span', { class: 'chip tip', title: 'heard, not confirmed' }, `+${tips.length}?`) : null),
  tips.map(r => h('button', { class: 'post-row tip', title: `Heard${r.tip.from ? ' from ' + r.tip.from : ''} — tap to clear`, onClick: () => ctx.update(s => N.setPost(s, date, r.key, '')) }, ctx.shiftChip(r.shift, r.code), h('span', { class: 'ellipsis' }, r.person.name.split(' ').slice(0, 2).join(' ') + ' ?'), h('span', { class: 'x' }, '×'))),
  rows.length ? rows.sort((a, b) => a.shift.type.localeCompare(b.shift.type) || a.person.name.localeCompare(b.person.name)).map(r => h('button', { class: 'post-row', title: 'Change or clear', onClick: () => ctx.update(s => N.setPost(s, date, r.key, '')) }, ctx.shiftChip(r.shift, r.code), h('span', { class: 'ellipsis' }, r.person.name.split(' ').slice(0, 2).join(' ')), h('span', { class: 'x' }, '×'))) : h('div', { class: 'tiny dim' }, 'nobody yet'));
export function renderNurses() {
  const s = S(), date = nDate, rota = N.nurseRotaFor(s, date), out = [];
  const nav = h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn icon', 'aria-label': 'Previous day', onClick: () => { nDate = addDays(nDate, -1); ctx.render(); } }, '‹'), h('div', { class: 'grow', style: { textAlign: 'center' } }, h('b', {}, dayLabel(date)), h('div', { class: 'tiny dim' }, relDay(date))), h('button', { class: 'btn icon', 'aria-label': 'Next day', onClick: () => { nDate = addDays(nDate, 1); ctx.render(); } }, '›'));
  out.push(nav, h('div', { class: 'chips', style: { marginBottom: '10px' } }, h('button', { class: 'chip', onClick: () => { nDate = startOfDay(new Date()); ctx.render(); } }, 'Today'), h('button', { class: 'chip', onClick: () => { nDate = addDays(startOfDay(new Date()), 1); ctx.render(); } }, 'Tomorrow')));
  if (!rota) { out.push(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '🩺'), `No nurse schedule for ${MONTHS[date.getMonth()]} ${date.getFullYear()}`), h('div', { class: 'row', style: { justifyContent: 'center' } }, ctx.importButton('Import nurse schedule')))); return out; }
  const st = N.staffing(s, date), floaters = st.rows.filter(r => N.isFloater(r.group) && r.group !== 'head'), unposted = floaters.filter(r => !r.post), sug = unposted.filter(r => r.suggest);
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `${st.total} nurses on shift`), h('div', { class: 'chips' }, Object.entries(st.byShift).sort().map(([t, n]) => h('span', { class: 'chip' }, `${t} ${n}`)), unposted.length ? h('span', { class: 'chip late' }, `${unposted.length} not posted`) : floaters.length ? h('span', { class: 'chip sel' }, 'all posted') : null)));
  const myInfo = dayInfo(s, date), w = myInfo.mine ? N.workingWithMe(s, date, myInfo.mine) : null;
  { const wc = myInfo.mine ? withMeCard(date, myInfo.mine, true) : null; if (wc) out.push(wc); }
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Postings'), sug.length ? h('button', { class: 'btn sm', onClick: () => { ctx.update(x => N.applySuggestions(x, date)); toast(`${sug.length} posted from where they went last`); } }, `Use last posts (${sug.length})`) : null),
    h('div', { class: 'post-grid' }, N.SITES.map(t => siteTile(t.id, st.rows.filter(r => r.post === t.id), date, st.rows.filter(r => !r.post && r.tip?.site === t.id))))));
  const leaders = N.nurses(s).filter(n => n.leader), friendKeys = new Set(F.friendList(s).map(f => f.rotaKey));
  if (heardFrom === null) heardFrom = (leaders.find(n => friendKeys.has(ctx.personKeyOf(n))) || { name: '' }).name.split(' ')[0];
  const modeBar = h('div', { class: 'mode-bar' }, h('div', { class: 'seg' }, [['confirm', 'Confirmed'], ['heard', 'Heard it']].map(([k, l]) => h('button', { class: mode === k ? 'active' : '', onClick: () => { mode = k; ctx.render(); } }, l))),
    mode === 'heard' ? h('div', { class: 'chips', style: { marginTop: '8px' } }, h('span', { class: 'tiny dim', style: { alignSelf: 'center' } }, 'from'), ...leaders.map(n => n.name.split(' ')[0]).filter((v, i, a) => a.indexOf(v) === i).map(nm => h('button', { class: `chip ${heardFrom === nm ? 'sel' : ''}`, onClick: () => { heardFrom = nm; ctx.render(); } }, nm)), h('button', { class: `chip ${heardFrom === '' ? 'sel' : ''}`, onClick: () => { heardFrom = ''; ctx.render(); } }, 'someone else')) : null,
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, mode === 'heard' ? 'A tip: what you heard before it is official. It shows as “might be with you”, never as confirmed, and is replaced when you confirm.' : 'Confirmed: where they were actually sent.'));
  const put = (r, id) => ctx.update(x => N.setPost(x, date, r.key, id, mode === 'heard' ? { tip: true, from: heardFrom } : {}));
  if (unposted.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `Not posted yet (${unposted.length})`), modeBar, h('div', { class: 'tiny dim', style: { margin: '10px 0 6px' } }, 'Tap where each one goes. The faint one is where they went last time.'),
    unposted.sort((a, b) => a.shift.type.localeCompare(b.shift.type) || a.person.name.localeCompare(b.person.name)).map(r => h('div', { class: 'row np-row' }, h('div', { class: 'grow', onClick: () => ctx.personSheet(r.person), style: { minWidth: 0 } }, h('div', { class: 'name ellipsis' }, r.person.name, r.person.leader ? ' ★' : ''), h('div', { class: 'tiny dim' }, `${r.shift.label.replace(/ ·.*/, '')} ${r.shift.hours ? hm(r.shift.hours.start) + '–' + hm(r.shift.hours.end % 1440 || 1440) : ''} · ${N.GROUPS[r.group]?.label || ''}`), r.tip ? h('div', { class: 'tiny tip-line' }, `heard: ${r.tip.site}${r.tip.from ? ' · ' + r.tip.from : ''}`) : null),
      h('div', { class: 'np-btns' }, r.choices.map(id => h('button', { class: `btn sm ${r.tip?.site === id ? 'tip' : r.suggest === id ? 'sug' : 'ghost'}`, onClick: () => put(r, id) }, id)))))));
  const fixed = st.rows.filter(r => r.fixed);
  if (fixed.length) { const by = {}; fixed.forEach(r => (by[r.fixed] ||= []).push(r)); out.push(h('details', { class: 'card' }, h('summary', {}, `Fixed posts (${fixed.length}): ${Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`), Object.entries(by).map(([k, v]) => h('div', { style: { marginTop: '8px' } }, h('div', { class: 'tiny dim' }, k), h('div', { class: 'chips' }, v.map(r => h('button', { class: 'chip', onClick: () => ctx.personSheet(r.person) }, `${r.person.name.split(' ')[0]} ${r.shift.type}`))))))); }
  out.push(h('div', { class: 'tiny dim', style: { margin: '6px 2px' } }, 'The schedule only says who works which shift. Where the construction-clinic nurses go (Upper/Lower Village, Upper/Lower office clinic) is decided the night before, so you enter it here and the app learns from it.'));
  return out;
}

// ───────── nurses with you (day sheet)
export function withMeCard(date, mine, onBoard = false) {
  const s = S(), w = N.workingWithMe(s, date, mine); if (!w || !w.hasNurses) return null;
  const [m0, m1] = [mine.shift.hours.start, mine.shift.hours.overnight || mine.shift.hours.end <= mine.shift.hours.start ? mine.shift.hours.end + 1440 : mine.shift.hours.end], len = m1 - m0, pc = (x) => `${Math.max(0, Math.min(100, (x - m0) / len * 100)).toFixed(1)}%`;
  const bar = (r, cls) => h('span', { class: 'nr-bar', 'aria-hidden': 'true' }, h('i', { class: cls, style: { left: pc(r.from), width: `${Math.max(2, (r.to - r.from) / len * 100).toFixed(1)}%` } }));
  const row = (r, kind) => h('button', { class: `nr-row ${kind}`, onClick: () => ctx.personSheet(r.person) }, h('span', { class: 'nr-name' }, h('span', { class: 'ellipsis' }, r.person.name.split(' ').slice(0, 2).join(' ')), h('small', {}, `${r.shift.type} ${hm(r.shift.hours.start)}–${hm(r.shift.hours.end % 1440 || 1440)}${r.person.leader ? ' · leader' : ''}`)), bar(r, kind), h('span', { class: 'nr-pct' }, r.pct >= 0.995 ? 'all' : `${Math.round(r.pct * 100)}%`, kind === 'maybe' ? h('small', {}, r.seen ? `~${Math.round(r.chance * 100)}% here` : 'new') : kind === 'heard' ? h('small', {}, r.heardFrom ? `heard: ${r.heardFrom}` : 'heard') : null));
  const poss = w.possible.slice(0, 10), heard = w.tipped || [];
  return h('div', { class: 'card nr' }, h('div', { class: 'title' }, w.site ? `Nurses at ${N.siteLabel(w.site)}` : 'Nurses on your shift'),
    h('div', { class: `ov-head ${w.confirmed.length ? 'ok' : 'warn'}` }, w.confirmed.length ? `${w.confirmed.length} posted with you${w.possible.length ? ` · ${w.possible.length} more could join` : ''}` : heard.length ? `${heard.length} heard, ${w.possible.length} more could be sent to you` : w.possible.length ? `Likely with you${w.site ? ' at ' + N.siteLabel(w.site) : ''}: ${w.possible.length} nurses could be sent` : w.unposted ? 'No postings yet and nobody overlaps your shift' : 'No nurses overlap your shift'),
    w.confirmed.map(r => row(r, 'sure')),
    heard.length ? [h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'What you heard'), heard.map(r => row(r, 'heard'))] : null,
    poss.length ? [h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, (w.confirmed.length || heard.length ? `Could still be sent to you (${w.possible.length})` : `Who could be with you (${w.possible.length})`) + ', most likely first'), poss.map(r => row(r, 'maybe'))] : null,
    w.possible.length > poss.length ? h('div', { class: 'tiny dim' }, `+${w.possible.length - poss.length} more`) : null,
    h('div', { class: 'row wrap', style: { marginTop: '10px' } }, onBoard ? null : h('button', { class: 'btn sm', onClick: () => { goNurses(date); ctx.go('rota', 'nurses'); } }, w.unposted ? 'Set today’s postings' : 'Open postings'), w.elsewhere ? h('span', { class: 'tiny dim' }, `${w.elsewhere} posted elsewhere`) : null));
}

// ───────── Today
export function todayCard() {
  const s = S(), now = new Date(), cards = [];
  if (!N.nurseRotas(s).length) return null;
  const info = dayInfo(s, now), w = info.mine ? N.workingWithMe(s, now, info.mine) : null;
  if (w && w.hasNurses && (w.confirmed.length || w.possible.length)) cards.push(h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, '🩺'), h('div', { class: 'grow' }, h('div', { class: 'name' }, w.confirmed.length ? `${w.confirmed.length} nurse${w.confirmed.length === 1 ? '' : 's'} posted with you` : `${w.possible.length} nurses could be with you`), h('div', { class: 'tiny dim' }, w.confirmed.length ? w.confirmed.slice(0, 3).map(r => r.person.name.split(' ')[0]).join(', ') : w.unposted ? 'not posted yet' : '')), h('button', { class: 'btn sm', onClick: () => { goNurses(now); ctx.go('rota', 'nurses'); } }, 'Open')));
  if (now.getHours() >= 17) { const tm = addDays(startOfDay(now), 1), n = N.unpostedFor(s, tm); if (n) cards.push(h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, '🌙'), h('div', { class: 'grow' }, h('div', { class: 'name' }, `Tomorrow’s nurse postings`), h('div', { class: 'tiny dim' }, `${n} not set yet`)), h('button', { class: 'btn sm primary', onClick: () => { goNurses(tm); ctx.go('rota', 'nurses'); } }, 'Set'))); }
  return cards.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Nurses'), cards) : null;
}

// ───────── shared bits for rota views
const hh = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0');
const tClass = (sh) => sh.kind === 'leave' ? 'leave' : sh.kind === 'other' ? 'other' : sh.kind === 'off' ? 'off' : /^[DNE]$/.test(sh.type) ? sh.type : sh.type === 'M' ? 'E' : 'A';
const hoursShort = (sh) => sh.hours ? `${hh(sh.hours.start)}–${hh(sh.hours.end % 1440 || 1440)}` : '';
const monthsOf = (s, key) => Object.values(s.rotas).filter(r => r.people.some(x => ctx.personKeyOf(x) === key)).sort((a, b) => a.year - b.year || a.month - b.month);
const monthStats = (r, p, myShared) => { let work = 0, nights = 0, mins = 0, leave = 0, off = 0; for (let d = 1; d <= r.daysInMonth; d++) { const sh = interpretCode(p.days[d] || '', r.legend, r.unitKind); if (sh.kind === 'work') { work++; if (sh.type === 'N' || sh.hours?.overnight) nights++; mins += sh.hours?.durationMin || 0; } else if (sh.kind === 'leave') leave++; else if (sh.kind === 'off') off++; } return { work, nights, hours: Math.round(mins / 60), leave, off, withMe: myShared }; };

/** One person's month, laid out to be read at a glance: tinted weekend, hours under every code, a ring on today, a dot on days you share, stats and a legend. Tap a day for the details. */
export function personRota(p) {
  const s = S(), key = ctx.personKeyOf(p), all = monthsOf(s, key); if (!all.length) return null;
  const today = new Date(), nowKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
  const pick = () => { const want = pMonth[key]; return all.find(r => r.id === want) || all.find(r => `${r.year}-${r.month}` === nowKey) || all[all.length - 1]; };
  const wrap = h('div', { class: 'card prota' }); let cur = pick(), sel = null;
  const sharedDates = new Set(sharedShifts(s, key).map(x => keyOf(x.date)));
  function paint() {
    const r = cur, person = r.people.find(x => ctx.personKeyOf(x) === key), first = new Date(r.year, r.month - 1, 1), idx = all.indexOf(r);
    const shared = [...sharedDates].filter(k => k.startsWith(`${r.year}-${String(r.month).padStart(2, '0')}`)).length, st = monthStats(r, person, shared);
    const grid = h('div', { class: 'pr-grid' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => h('span', { class: `pr-dow ${i >= 5 ? 'we' : ''}` }, x)));
    for (let i = 0; i < first.getDay(); i++) grid.append(h('span', { class: 'pr-pad' }));
    const used = new Map();
    for (let d = 1; d <= r.daysInMonth; d++) {
      const date = new Date(r.year, r.month - 1, d), code = person.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), cls = tClass(sh), isToday = +startOfDay(today) === +date, dk = keyOf(date);
      if (code && sh.kind !== 'off') used.set(code, sh);
      grid.append(h('button', { class: `pr-day t-${cls} ${date.getDay() >= 5 ? 'we' : ''} ${isToday ? 'today' : ''} ${sel === d ? 'sel' : ''}`, 'aria-label': `${dayLabel(date)}: ${sh.kind === 'off' ? 'off' : sh.label}`, onClick: () => { sel = sel === d ? null : d; paint(); } },
        h('i', { class: 'pr-n' }, d), h('b', {}, sh.kind === 'off' ? '' : sh.kind === 'leave' ? 'L' : code.length > 4 ? '•' : code), h('small', {}, sh.kind === 'work' ? hoursShort(sh) : ''), sharedDates.has(dk) ? h('em', { class: 'pr-with', title: 'You work this shift together' }) : null));
    }
    wrap.replaceChildren(
      h('div', { class: 'row' }, h('button', { class: 'btn icon sm', disabled: idx <= 0, 'aria-label': 'Previous month', onClick: () => { cur = all[idx - 1]; pMonth[key] = cur.id; sel = null; paint(); } }, '‹'),
        h('div', { class: 'grow', style: { textAlign: 'center' } }, h('b', {}, `${MONTHS[r.month - 1]} ${r.year}`), h('div', { class: 'tiny dim' }, UNIT_LABELS[r.unitKind] || r.unit)), h('button', { class: 'btn icon sm', disabled: idx >= all.length - 1, 'aria-label': 'Next month', onClick: () => { cur = all[idx + 1]; pMonth[key] = cur.id; sel = null; paint(); } }, '›')),
      h('div', { class: 'pr-stats' }, [[st.work, 'shifts'], [st.hours, 'hours'], [st.nights, 'nights'], [st.off, 'days off'], st.leave ? [st.leave, 'leave'] : null, st.withMe ? [st.withMe, 'with you'] : null].filter(Boolean).map(([n, l]) => h('div', {}, h('b', {}, n), h('small', {}, l)))), grid,
      sel ? dayDetail(r, person, sel) : null,
      h('div', { class: 'pr-legend' }, [...used.entries()].slice(0, 10).map(([code, sh]) => h('span', { class: `pr-key t-${tClass(sh)}` }, h('b', {}, code.length > 6 ? code.slice(0, 5) + '…' : code), ' ', sh.kind === 'work' ? [sh.label.replace(/ ·.*/, ''), sh.hours ? ` ${hoursShort(sh)}` : ''] : sh.label))));
  }
  function dayDetail(r, person, d) {
    const date = new Date(r.year, r.month - 1, d), code = person.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), lines = [];
    if (sh.kind === 'work') lines.push(`${sh.label}${sh.hours ? ` · ${hoursShort(sh)} · ${fmtDur(sh.hours.durationMin)}` : ''}${sh.site ? ` · ${sh.site}` : ''}`); else lines.push(sh.kind === 'off' ? 'Day off' : sh.label);
    let extra = null;
    if (r.unitKind === 'nurse') { const row = N.rowsFor(s, date).find(x => x.key === key); if (row) { const t = N.tipOf(s, date, key); lines.push(row.post ? `At ${N.siteLabel(row.post)}${row.fixed ? '' : ' (posted)'}` : t ? `Heard: ${N.siteLabel(t.site)}${t.from ? ' from ' + t.from : ''}` : N.isFloater(row.group) ? 'Not posted yet' : ''); } }
    else if (sh.kind === 'work') { const info = dayInfo(s, date), same = (info.bySite[sh.site || sh.label] || []).filter(e => e.shift.type === sh.type && ctx.personKeyOf(e.person) !== key); if (same.length) extra = h('div', { class: 'tiny dim' }, `Same shift: ${same.slice(0, 6).map(e => e.person.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]).join(', ')}${same.length > 6 ? ` +${same.length - 6}` : ''}`); }
    return h('div', { class: 'pr-detail' }, h('b', {}, `${dayLabel(date)} · ${relDay(date)}`), lines.filter(Boolean).map(l => h('div', { class: 'small' }, l)), extra, h('button', { class: 'btn sm ghost', onClick: () => { document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); ctx.openDay(date); } }, 'Open that day'));
  }
  paint(); return wrap;
}
const UNIT_LABELS = { gp: 'GP rota', fsed: 'FSED specialists', uv: 'Upper Village specialists', lv: 'Lower Village specialists', nurse: 'Nurses' };

// ───────── whole roster: everyone × every day of the month
export function renderRoster() {
  const s = S(), rotas = Object.values(s.rotas); if (!rotas.length) return [h('div', { class: 'card empty' }, 'No schedules loaded')];
  const nowD = new Date(); if (!rMonth) rMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  const y = rMonth.getFullYear(), mo = rMonth.getMonth() + 1, ofMonth = rotas.filter(r => r.year === y && r.month === mo);
  const nav = h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: 'btn icon sm', 'aria-label': 'Previous month', onClick: () => { rMonth = new Date(y, mo - 2, 1); rUnit = ''; ctx.render(); } }, '‹'), h('b', { class: 'grow', style: { textAlign: 'center' } }, `${MONTHS[mo - 1]} ${y}`), h('button', { class: 'btn icon sm', 'aria-label': 'Next month', onClick: () => { rMonth = new Date(y, mo, 1); rUnit = ''; ctx.render(); } }, '›'));
  if (!ofMonth.length) return [nav, h('div', { class: 'card empty' }, `No schedule loaded for ${MONTHS[mo - 1]} ${y}`)];
  const r = ofMonth.find(x => x.id === rUnit) || ofMonth.find(x => x.unitKind === 'gp') || ofMonth[0];
  const picker = ofMonth.length > 1 ? h('div', { class: 'chips', style: { marginBottom: '8px' } }, ofMonth.map(x => h('button', { class: `chip ${x.id === r.id ? 'sel' : ''}`, onClick: () => { rUnit = x.id; ctx.render(); } }, `${UNIT_LABELS[x.unitKind] || x.unit} · ${x.people.length}`))) : null;
  const q = query.toLowerCase().trim(), people = r.people.filter(p => !q || p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
  const input = h('input', { type: 'search', placeholder: 'Filter this roster', value: query, class: 'dir-search', style: { marginBottom: '8px' }, onInput: (e) => { query = e.target.value; ctx.render(); const i = document.querySelector('#view-rota .dir-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } });
  const todayN = nowD.getFullYear() === y && nowD.getMonth() + 1 === mo ? nowD.getDate() : 0, cols = r.daysInMonth;
  const dow = (d) => new Date(y, mo - 1, d).getDay(), counts = Array.from({ length: cols }, () => 0), cells = [];
  const head = [h('span', { class: 'rg-name rg-corner' }, ''), ...Array.from({ length: cols }, (_, i) => h('span', { class: `rg-h ${dow(i + 1) >= 5 ? 'we' : ''} ${todayN === i + 1 ? 'today' : ''}` }, h('small', {}, 'SMTWTFS'[dow(i + 1)]), i + 1))];
  let lastGroup = null;
  for (const p of people) {
    if (r.unitKind === 'nurse' && p.group !== lastGroup) { lastGroup = p.group; cells.push(h('div', { class: 'rg-sec', style: { gridColumn: `1 / span ${cols + 1}` } }, N.GROUPS[p.group]?.label || '')); }
    const me = isMe(s, p), key = ctx.personKeyOf(p);
    cells.push(h('button', { class: `rg-name ${me ? 'me' : ''}`, title: p.name, onClick: () => ctx.personSheet(p) }, p.name.replace(/^Dr\.?\s*/i, '').replace(/\s*-\s*TL$/, '').split(' ').slice(0, 2).join(' ')));
    for (let d = 1; d <= cols; d++) {
      const code = p.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), cls = tClass(sh); if (sh.kind === 'work') counts[d - 1]++;
      cells.push(h('button', { class: `rg-c t-${cls} ${dow(d) >= 5 ? 'we' : ''} ${todayN === d ? 'today' : ''}`, 'aria-label': `${p.name}, ${d} ${MONTHS[mo - 1]}: ${sh.kind === 'off' ? 'off' : sh.label}`, onClick: () => ctx.sheet([h('h2', {}, p.name), h('div', { class: 'small muted' }, `${dayLabel(new Date(y, mo - 1, d))}`), h('div', { class: 'card' }, h('b', {}, sh.kind === 'off' ? 'Day off' : sh.label), sh.hours ? h('div', { class: 'small' }, `${hoursShort(sh)} · ${fmtDur(sh.hours.durationMin)}`) : null, sh.site ? h('div', { class: 'small' }, sh.site) : null), h('button', { class: 'btn', onClick: () => { document.querySelectorAll('.sheet-bg').forEach(e => e.remove()); ctx.personSheet(p); } }, 'Open their rota')]) }, sh.kind === 'off' ? '' : sh.kind === 'leave' ? 'L' : code.length > 3 ? '•' : code));
    }
  }
  cells.push(h('span', { class: 'rg-name rg-foot' }, 'On duty'), ...counts.map((n, i) => h('span', { class: `rg-f ${todayN === i + 1 ? 'today' : ''}` }, n)));
  return [nav, picker, input, h('div', { class: 'rg-scroll' }, h('div', { class: 'rg', style: { '--cols': cols } }, ...head, ...cells)), h('div', { class: 'tiny dim', style: { margin: '6px 2px' } }, `${people.length} people · tap a name for their rota, a cell for that day · Fri/Sat tinted`)];
}
