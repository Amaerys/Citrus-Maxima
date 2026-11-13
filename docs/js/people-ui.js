// People: one directory for every schedule you have (GPs, ER specialists, nurses) with numbers and social handles,
// the nurses' postings board, and who will work with you. Used by Work → People / Nurses, the day sheet and Today.
import { h, toast, keyOf, addDays, startOfDay, relDay, fmtMin, fmtDur, DAY_SHORT, MONTHS } from './util.js';
const initials = (n) => String(n).replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
import { dayInfo, allPeople, isMe, sharedShifts } from './model.js';
import { interpretCode } from './rota-parser.js';
import * as F from './social.js';
import * as N from './nurses.js';
import * as PL from './people-logic.js';
import * as NB from './nurse-board.js';
import { contractEnds } from './extras.js';
import { undoToast } from './mind-ui.js';

let mode = 'confirm', heardFrom = null, dirMode = 'list', rMonth = null, rUnit = '', rQuery = '', rZoom = false, pMonth = {};
// onShift: '' (everyone) | 'today' (rostered today) | 'now' (on shift this minute, last night's tail included)
let ctx = null, query = '', cat = 'all', ngroup = 'all', onShift = '', nDate = startOfDay(new Date());
export function initPeople(c) { ctx = c; }
const S = () => ctx.S();
let fid = 0;   // labels are tied to their inputs (screen readers, tap on the label focuses the field)
const field = (label, input, note = null) => { const id = input.id || (input.id = `pf-${++fid}`); return h('div', { class: 'field' }, label ? h('label', { for: id }, label) : null, input, note); };
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayLabel = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
export const goNurses = (date) => { if (date) nDate = startOfDay(date); };
const closeSheets = () => document.querySelectorAll('.sheet-bg').forEach(e => e.remove());
/** A sheet that ignores the second tap of a double tap (it would land on the backdrop and close the sheet at once). */
const steadySheet = (content) => { const r = ctx.sheet(content), bg = r.box?.parentElement, t0 = Date.now(); bg?.addEventListener('click', (e) => { if (e.target === bg && Date.now() - t0 < 350) e.stopImmediatePropagation(); }, true); return r; };

const CATS = [['all', 'All', 'All'], ['gp', 'GPs', 'GPs'], ['spec', 'Specialists', 'Spec'], ['nurse', 'Nurses', 'Nurses']];
const catOf = (units) => units.includes('nurse') ? 'nurse' : units.includes('gp') ? 'gp' : 'spec';
const unitWord = PL.UNIT_WORDS;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ───────── reach buttons (your saved number when it dials, otherwise the rota's)
function reachOf(p, key) {
  const c = F.contactOf(S(), key), phone = PL.phoneInUse(c.phone, p.mobile), wa = PL.dialable(c.whatsapp) ? c.whatsapp : phone;
  return { c, phone, links: F.links({ phone, whatsapp: wa, snap: c.snap, insta: c.insta }) };
}
export function reachRow(p, key, size = 'sm') {
  const l = reachOf(p, key).links, mk = (href, cls, t, label) => href ? h('a', { class: `btn ${size} ghost sc-btn ${cls}`, href, target: cls === 'call' ? undefined : '_blank', rel: 'noopener', 'aria-label': `${label} ${p.name}`, title: label, onClick: (e) => e.stopPropagation() }, t) : h('span', { class: `btn ${size} ghost sc-btn off`, 'aria-hidden': 'true' }, t);
  return h('div', { class: 'sc-reach' }, mk(l.tel, 'call', '📞', 'Call'), mk(l.wa, 'wa', '💬', 'WhatsApp'), mk(l.snap, 'snap', '👻', 'Snapchat'), mk(l.insta, 'ig', '📸', 'Instagram'));
}
export function contactSheet(p, key) {
  const c = F.contactOf(S(), key), v = (k) => c[k] || '';
  const note = (inp, check) => { const el = h('div', { class: 'tiny pc-note', 'aria-live': 'polite' }); const run = () => { const r = check(inp.value); el.textContent = r.text; el.className = `tiny pc-note ${r.bad ? 'bad' : r.text ? 'ok' : ''}`; inp.toggleAttribute('aria-invalid', !!r.bad); return !r.bad; }; inp.addEventListener('input', run); run(); return { el, run }; };
  const phoneCheck = (x) => !x.trim() ? { text: '' } : PL.dialable(x) ? { text: `→ +${PL.dialable(x)}` } : { bad: true, text: 'Not a phone number. Use 05… or +966…, or clear it to use the rota’s.' };
  const handleCheck = (site) => (x) => { const r = PL.checkHandle(x); return !x.trim() ? { text: '' } : r.warn ? { bad: true, text: r.warn } : { text: `→ ${site}${r.handle}` }; };
  const phone = h('input', { type: 'tel', value: v('phone'), autocomplete: 'off', placeholder: p.mobile ? `${p.mobile} (from the rota)` : '05… or +966…' }), wa = h('input', { type: 'tel', value: v('whatsapp'), placeholder: 'if different from phone' }), snap = h('input', { value: v('snap'), placeholder: 'username or link', autocapitalize: 'off' }), ig = h('input', { value: v('insta'), placeholder: '@username or link', autocapitalize: 'off' }), noteEl = h('textarea', { rows: 2, placeholder: 'Anything worth remembering' }, v('note'));
  const bday = h('input', { type: 'date', value: /^\d{4}-/.test(c.birthday || '') ? c.birthday : '' });
  const checks = [note(phone, phoneCheck), note(wa, phoneCheck), note(snap, handleCheck('snapchat.com/add/')), note(ig, handleCheck('instagram.com/'))];
  // a junk value would replace the rota number and remove Call: refuse to save it and say which field is wrong
  const patch = () => { const bad = checks.map((k, i) => [k.run(), [phone, wa, snap, ig][i]]).find(([ok]) => !ok); if (bad) { bad[1].focus(); toast('Fix the highlighted field first', 'err'); return null; }
    return { phone: phone.value.trim(), whatsapp: wa.value.trim(), snap: PL.checkHandle(snap.value).handle, insta: PL.checkHandle(ig.value).handle, note: noteEl.value, birthday: bday.value || (c.birthday && !/^\d{4}-/.test(c.birthday) ? c.birthday : '') }; };
  const units = personUnits(key);
  ctx.sheet([h('h2', {}, p.name), h('div', { class: 'small muted' }, 'Saved on your devices and in your Drive only.'),
    field('Phone', phone, checks[0].el), field('WhatsApp', wa, checks[1].el), h('div', { class: 'grid2' }, field('Snapchat', snap, checks[2].el), field('Instagram', ig, checks[3].el)), field('Note', noteEl), field('Birthday', bday),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { const pt = patch(); if (!pt) return; ctx.update(s => F.setContact(s, key, pt)); closeSheets(); ctx.render(); ctx.personSheet(p); } }, 'Save'),
      c.friend ? h('span', { class: 'chip sel' }, 'In your friends') : h('button', { class: 'btn grow', onClick: () => { const pt = patch(); if (!pt) return;
        ctx.update(s => { let x = F.friendFromPerson(F.setContact(s, key, pt), p, key, PL.friendKind(units)); const fr = F.friendList(x).find(f => f.rotaKey === key);
          // the birthday you saved (or just typed) must survive becoming a friend: friendFromPerson may not carry it yet
          if (fr && pt.birthday && !fr.birthday) x = F.updateFriend(x, fr.id, { birthday: pt.birthday }); return x; });
        closeSheets(); toast(`${p.name.replace(/^Dr\.?\s*/i, '')} added to Social`); ctx.render(); } }, 'Add to friends'))]);
}
const personUnits = (key) => { const u = []; for (const r of Object.values(S().rotas)) if (r.people.some(x => ctx.personKeyOf(x) === key)) u.push(r.unitKind); return u; };

/** Block shown at the top of a person's sheet. */
export function personBlock(p) {
  const s = S(), key = ctx.personKeyOf(p), { c, phone } = reachOf(p, key), units = personUnits(key), isN = units.includes('nurse'), np = isN ? N.nurses(s).find(x => ctx.personKeyOf(x) === key) : null, now = startOfDay(new Date());
  const shown = (x) => { const d = PL.dialable(x); return d ? `+${d}` : x; };
  // say which number the buttons dial when it is not the rota's, so two numbers on one sheet make sense
  const numLine = c.phone && !PL.dialable(c.phone) ? h('div', { class: 'tiny pc-note bad' }, `Saved phone “${c.phone}” is not a number, so Call uses ${p.mobile ? 'the rota’s ' + shown(p.mobile) : 'nothing'}. Edit the contact to fix it.`)
    : c.phone && PL.phoneKey(c.phone) !== PL.phoneKey(p.mobile) ? h('div', { class: 'tiny dim' }, `Call and WhatsApp use your saved ${shown(phone)}${p.mobile ? ` · rota: ${shown(p.mobile)}` : ''}`) : null;
  const out = [reachRow(p, key, ''), numLine, h('div', { class: 'row wrap', style: { gap: '6px', margin: '4px 0 8px' } }, c.note ? h('span', { class: 'small muted grow' }, c.note) : h('span', { class: 'grow' }), h('button', { class: 'btn sm ghost', onClick: () => contactSheet(p, key) }, PL.hasContact(c) ? '✎ Edit contact' : '＋ Add numbers & socials'))];
  if (np) {
    const g = N.GROUPS[np.group], row = N.rowsFor(s, now).find(r => r.key === key), hist = N.history(s, key).slice(0, 5), end = contractEnds(s, now, 60).find(e => e.key === key);
    // today's place in the same three looks as the board: confirmed / heard ? / guess (last time?)
    const where = !row ? null : row.post ? h('span', { class: 'nb-t sure' }, ` · ✓ at ${N.siteLabel(row.post)}`) : row.tip ? h('span', { class: `nb-t ${row.tip.guess ? 'guess' : 'heard'}` }, ` · ${tipText(row.tip)} · not confirmed`) : N.isFloater(row.group) ? h('span', { class: 'dim' }, ' · not posted yet') : null;
    out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Nurse'), h('div', { class: 'small' }, [g?.label, np.clinic ? `clinic ${np.clinic}` : '', np.leader ? 'team leader' : '', np.fa ? 'first aider' : ''].filter(Boolean).join(' · '), np.pulledOut ? h('span', { class: 'chip late nb-tag' }, `pulled out → ${np.pulledOut}`) : null),
      end ? h('div', { class: 'small nb-end', style: { marginTop: '6px' } }, `⏳ Contract ${end.inDays < 0 ? 'ended' : 'ends'} ${dayLabel(end.date)}${end.lastShift ? ` · last shift ${dayLabel(end.lastShift)}` : ''}${end.inDays > 0 ? ` (in ${plural(end.inDays, 'day')})` : ''}`) : null,
      row ? h('div', { class: 'small', style: { marginTop: '6px' } }, `Today: ${row.shift.label}`, where) : null,
      hist.length ? h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Recent confirmed postings: ' + hist.map(x => `${x.date.slice(5)} ${x.site}`).join(' · ')) : null));
  }
  return out;
}

// ───────── directory
const STATE_WORD = { now: 'on now', tail: 'on now', later: 'later', ended: 'done' };
const ORDER = { now: 0, tail: 0, later: 1, '': 2, ended: 3 };
export function renderDirectory() {
  const s = S(), people = allPeople(s);
  if (!people.length) return h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '👥'), 'Import a schedule to see people'), h('div', { class: 'row', style: { justifyContent: 'center' } }, ctx.importButton('Import schedules')));
  const modeSeg = h('div', { class: 'seg view-mode', role: 'tablist', style: { marginBottom: '10px' } }, [['list', 'List'], ['roster', 'Roster grid']].map(([k, l]) => h('button', { class: dirMode === k ? 'active' : '', role: 'tab', 'aria-selected': String(dirMode === k), onClick: () => { dirMode = k; ctx.render(); } }, l)));
  if (dirMode === 'roster') return [modeSeg, ...renderRoster()];
  const now = new Date(), today = startOfDay(now), counts = { all: people.length }; people.forEach(p => { const c = catOf(p.units); counts[c] = (counts[c] || 0) + 1; });
  if (!counts[cat]) cat = 'all';
  const input = h('input', { type: 'search', placeholder: 'Search name, title, unit, clinic, note or number', value: query, class: 'dir-search', 'aria-label': 'Search people', onInput: (e) => { query = e.target.value; paintList(); } });
  const seg = h('div', { class: 'seg dir-seg', role: 'tablist' }, CATS.filter(([k]) => counts[k]).map(([k, l, sh]) => h('button', { class: cat === k ? 'active' : '', role: 'tab', 'aria-selected': String(cat === k), 'aria-label': `${l} ${counts[k]}`, onClick: () => { cat = k; ctx.render(); } }, h('span', { class: 'l-long' }, l), h('span', { class: 'l-short' }, sh), h('small', {}, counts[k] || 0))));
  const nurseMap = new Map(N.nurses(s).map(n => [ctx.personKeyOf(n), n]));
  const base = people.filter(p => cat === 'all' || catOf(p.units) === cat).map(p => { const st = PL.shiftState(s, p.key, now), t = st?.yesterday ? st.today : st; return { p, n: nurseMap.get(p.key), st, t, c: F.contactOf(s, p.key), shared: sharedShifts(s, p.key).length }; })
    .filter(x => cat !== 'nurse' || ngroup === 'all' || x.n?.group === ngroup);
  const isToday = (x) => x.t?.sh.kind === 'work', isNow = (x) => x.st?.state === 'now' || x.st?.state === 'tail';
  const nToday = base.filter(isToday).length, nNow = base.filter(isNow).length;
  // the shift filter is visible on every tab, so a filter set on GPs can never silently hide people on All
  const shiftChips = [h('button', { class: `chip ${onShift === 'today' ? 'sel' : ''}`, 'aria-pressed': String(onShift === 'today'), onClick: () => { onShift = onShift === 'today' ? '' : 'today'; ctx.render(); } }, `On shift today · ${nToday}`),
    h('button', { class: `chip ${onShift === 'now' ? 'sel' : ''}`, 'aria-pressed': String(onShift === 'now'), title: 'On shift at this minute, including nights that started yesterday', onClick: () => { onShift = onShift === 'now' ? '' : 'now'; ctx.render(); } }, `On now · ${nNow}`)];
  const groupBar = h('div', { class: 'chips dir-chips' }, cat === 'nurse' ? [['all', 'All'], ...Object.entries(N.GROUPS).filter(([g]) => N.nurses(s).some(n => n.group === g)).map(([g, v]) => [g, v.label])].map(([g, l]) => h('button', { class: `chip ${ngroup === g ? 'sel' : ''}`, onClick: () => { ngroup = g; ctx.render(); } }, l)) : null, cat === 'nurse' ? h('span', { class: 'dir-sep', 'aria-hidden': 'true' }) : null, ...shiftChips);
  const list = h('div', { class: 'list dir-list' }), countEl = h('div', { class: 'tiny dim', style: { margin: '8px 2px' } });
  const rows = base.filter(x => onShift === 'today' ? isToday(x) : onShift === 'now' ? isNow(x) : true)
    .sort((a, b) => (isToday(b) || isNow(b)) - (isToday(a) || isNow(a)) || (ORDER[a.st?.state ?? ''] ?? 2) - (ORDER[b.st?.state ?? ''] ?? 2) || b.shared - a.shared || a.p.name.localeCompare(b.p.name));
  function paintList() {
    const shown = rows.filter(({ p, n, c }) => PL.matches(query, { p, units: p.units, clinic: n?.clinic, group: N.GROUPS[n?.group]?.label, contact: c }));
    countEl.textContent = `${shown.length} ${shown.length === 1 ? 'person' : 'people'}${onShift ? ` · ${onShift === 'now' ? 'on now' : 'on shift today'}` : ''}`;
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty dir-empty' }, query ? `Nobody matches “${query}”` : 'Nobody here', h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '8px' } }, query ? h('button', { class: 'btn sm', onClick: () => { query = ''; input.value = ''; paintList(); } }, 'Clear search') : null, onShift ? h('button', { class: 'btn sm', onClick: () => { onShift = ''; ctx.render(); } }, 'Show everyone') : null)));
      return;
    }
    list.replaceChildren(...[...shown.slice(0, 150).map(({ p, n, st, t, c, shared }) => {
      const post = n && t?.sh.kind === 'work' ? (N.GROUPS[n.group]?.fixed || N.postOf(s, today, p.key)) : '', g = n ? N.GROUPS[n.group]?.label : '';
      const units = cat === 'all' || !n ? p.units.map(u => unitWord[u]).filter(w => w && w.toLowerCase() !== String(p.title || '').toLowerCase()).join(' + ') : '';
      const chipOf = st?.yesterday ? st : t, stWord = st?.state === 'tail' ? `till ${hm(st.sh.hours.end)}` : st?.state === 'later' ? `from ${hm(st.sh.hours.start)}` : STATE_WORD[st?.state] || '';
      return h('div', { class: `item clickable dir-item ${st?.state === 'ended' ? 'done' : ''} ${isNow({ st }) ? 'on' : ''}`, onClick: () => ctx.personSheet(p) }, h('div', { class: `avatar ${catOf(p.units)}` }, initials(p.name)),
        h('div', { class: 'grow' }, h('div', { class: 'name row' }, h('span', { class: 'dir-nm' }, p.name), isMe(s, p) ? h('span', { class: 'chip sel dir-you' }, 'you') : null, c.friend ? h('span', { class: 'tiny', title: 'friend' }, '⭐') : null, n && Object.values(n.days || {}).some(v => /PULL\s*OUT/i.test(String(v))) ? h('span', { class: 'chip pull dir-pull', title: 'Pulled out to another branch this month: her shifts here are not in the schedule' }, 'pulled out') : null),
          h('div', { class: 'meta' }, [n ? g : p.title, n?.leader ? 'leader' : '', units, shared ? `${plural(shared, 'shift')} with you` : ''].filter(Boolean).join(' · '))),
        chipOf ? h('span', { class: 'sh-mini' }, ctx.shiftChip(chipOf.sh, chipOf.code), post || stWord ? h('small', {}, [post, stWord].filter(Boolean).join(' · ')) : null) : null, reachRow(p, p.key));
    }), shown.length > 150 ? h('div', { class: 'tiny dim', style: { padding: '8px' } }, `Showing 150 of ${shown.length}: search to narrow down`) : null].filter(Boolean));
  }
  paintList();
  return [modeSeg, h('div', { class: 'row', style: { marginTop: '4px' } }, input), seg, groupBar, countEl, h('div', { class: 'card dir-card' }, list)];
}
// ───────── nurses: day board
// Three kinds of "where", with one look and one wording on every screen, so a guess is never read as a posting:
// CONFIRMED (a fact: solid green), HEARD (a tip from a leader: amber, dashed, "?"), GUESS ("Use last posts": dotted, grey, "last time?").
const kindOf = (r) => r.post ? 'sure' : r.tip?.guess ? 'guess' : r.tip ? 'heard' : '';
const tipText = (t, long = true) => !t ? '' : t.guess ? `guess: ${long ? N.siteLabel(t.site) : t.site} (last time)` : `heard: ${long ? N.siteLabel(t.site) : t.site}${t.from ? ' · ' + t.from : ''}`;
const hrs = (sh) => sh.hours ? `${hm(sh.hours.start)}–${hm(sh.hours.end % 1440 || 1440)}` : '';
/** Short names that never read as someone else: "Fatima K." next to your friend Fatima M., "Al Nizar" not "Al"; a friend's nickname wins. */
function nurseNames(s) {
  const list = N.nurses(s), fr = F.friendList(s), byKey = new Map(fr.filter(f => f.rotaKey).map(f => [f.rotaKey, f]));
  const short = NB.shortNurseNames(list.map(n => n.name), fr.filter(f => !list.some(n => N.keyOfPerson(n) === f.rotaKey)).map(f => f.nick || f.name));
  return new Map(list.map((n, i) => { const k = N.keyOfPerson(n), f = byKey.get(k); return [k, f?.nick || short[i]]; }));
}
let names = new Map();
const nm = (r) => names.get(r.key) || r.person.name.split(' ').slice(0, 2).join(' ');
const dayWord = (date) => { const d = Math.round((startOfDay(date) - startOfDay(new Date())) / 864e5); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : dayLabel(date); };
/** Keep a posting record so a clear can be undone exactly (confirmed stays confirmed, a tip keeps its source). */
const recOf = (s, date, key) => { const x = s.posts?.[`${keyOf(date)}:${key}`]; return x ? { site: x.site, opt: x.tip ? { tip: true, from: x.from || '', guess: !!x.guess } : {} } : null; };
function clearPost(r, date) {
  const prev = recOf(S(), date, r.key); ctx.update(s => N.setPost(s, date, r.key, ''));
  if (prev) undoToast(`${nm(r)} cleared from ${N.siteLabel(prev.site)}`, () => ctx.update(s => N.setPost(s, date, r.key, prev.site, prev.opt)));
}
/** Tap on a nurse in a site tile: confirm a tip, move her, or clear (with undo). One tap never deletes anything. */
function postSheet(r, date) {
  const k = kindOf(r), site = r.post || r.tip?.site, go = (id) => { closeSheets(); ctx.update(s => N.setPost(s, date, r.key, id)); toast(`${nm(r)} confirmed at ${N.siteLabel(id)}`); };
  steadySheet([h('h2', {}, r.person.name), h('div', { class: 'small muted' }, [dayLabel(date), `${r.shift.type} ${hrs(r.shift)}`, N.GROUPS[r.group]?.label].filter(Boolean).join(' · ')),
    h('div', { class: `nb-state ${k}` }, k === 'sure' ? `Confirmed at ${N.siteLabel(site)}` : k === 'heard' ? `Heard: ${N.siteLabel(site)}${r.tip.from ? ' — from ' + r.tip.from : ''} · not confirmed` : `Guess: ${N.siteLabel(site)} — where she went last time · not confirmed`),
    k !== 'sure' ? h('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px' }, onClick: () => go(site) }, `✓ Confirm ${N.siteLabel(site)}`) : null,
    h('div', { class: 'tiny dim', style: { margin: '12px 0 6px' } }, k === 'sure' ? 'Move to' : 'She went somewhere else'),
    h('div', { class: 'nb-move' }, r.choices.filter(id => id !== site).map(id => h('button', { class: 'btn', onClick: () => go(id) }, N.siteLabel(id)))),
    h('div', { class: 'row wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn danger grow', onClick: () => { closeSheets(); clearPost(r, date); } }, k === 'sure' ? 'Clear posting' : 'Forget this tip'), h('button', { class: 'btn ghost grow', onClick: () => { closeSheets(); ctx.personSheet(r.person); } }, 'Her schedule'))]);
}
function siteTile(id, rows, date, tips = []) {
  const sure = rows.sort((a, b) => a.shift.type.localeCompare(b.shift.type) || nm(a).localeCompare(nm(b))), heard = tips.filter(r => !r.tip.guess), guess = tips.filter(r => r.tip.guess);
  const row = (r) => { const k = kindOf(r); return h('div', { class: `post-row ${k}` }, h('button', { class: 'pr-main', title: k === 'sure' ? 'Move or clear' : 'Confirm, move or forget', onClick: () => postSheet(r, date) }, ctx.shiftChip(r.shift, r.code), h('span', { class: 'ellipsis' }, nm(r)), k === 'sure' ? null : h('small', { class: 'pr-why' }, k === 'guess' ? 'last time?' : `heard${r.tip.from ? ' · ' + r.tip.from : ''}`)), h('button', { class: 'x', 'aria-label': `Clear ${nm(r)}`, title: 'Clear (can undo)', onClick: () => clearPost(r, date) }, '×')); };
  return h('div', { class: `post-tile ${id}` }, h('div', { class: 'row' }, h('b', { class: 'grow' }, N.siteLabel(id)),
    h('span', { class: 'chip pt-count', title: `${sure.length} confirmed${heard.length ? `, ${heard.length} heard` : ''}${guess.length ? `, ${guess.length} guessed` : ''}` }, h('b', {}, sure.length), heard.length ? h('span', { class: 'pt-heard' }, ` +${heard.length}?`) : null, guess.length ? h('span', { class: 'pt-guess' }, ` ~${guess.length}`) : null)),
    sure.map(row), heard.map(row), guess.map(row), !sure.length && !tips.length ? h('div', { class: 'tiny dim' }, 'nobody yet') : null);
}
/** The 7 days around the board's day: a dot per day for confirmed (green), heard (amber ring) or guesses only (grey ring), and your shift. */
function dayStrip(s, date) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 3)), marks = NB.dayMarks(s, days), today = +startOfDay(new Date());
  return h('div', { class: 'nb-strip', role: 'tablist', 'aria-label': 'Days' }, marks.map(m => { const mine = dayInfo(s, m.date).mine, work = mine?.shift.kind === 'work', sel = +m.date === +date;
    const dot = !m.hasRota ? '' : m.posted ? (m.open ? 'part' : 'done') : m.heard ? 'heard' : m.guessed ? 'guess' : '';
    return h('button', { class: `nb-day ${sel ? 'sel' : ''} ${+m.date === today ? 'today' : ''} ${m.hasRota ? '' : 'none'} ${m.date.getDay() >= 5 ? 'we' : ''}`, role: 'tab', 'aria-selected': String(sel),
      'aria-label': `${dayLabel(m.date)}${work ? `, you: ${mine.code}` : ''}${m.hasRota ? `, ${m.posted} confirmed, ${m.heard} heard, ${m.open - m.heard - m.guessed} open` : ', no schedule'}`, onClick: () => { nDate = m.date; ctx.render(); } },
      h('small', {}, DAY_SHORT[m.date.getDay()].slice(0, 2)), h('b', {}, m.date.getDate()), h('span', { class: `nb-me ${work ? '' : 'off'}` }, work ? mine.code : '·'), h('i', { class: `nb-dot ${dot}`, 'aria-hidden': 'true' })); }));
}
/** Paste the leader's message ("UPV: Cresilda, Editha …"): names are matched to today's floating nurses and saved as heard (or confirmed). */
function pasteSheet(date) {
  const s = S(), rows = N.rowsFor(s, date).filter(r => N.isFloater(r.group) && r.group !== 'head');
  const ta = h('textarea', { rows: 7, placeholder: 'Upper Village: Name, Name\nLPV\n1. Name\n2. Name', 'aria-label': 'Posting list', 'data-nodirty': '' }), out = h('div', { class: 'nb-paste-out', 'aria-live': 'polite' });
  const src = h('input', { value: heardFrom || NB.lastSource(s) || '', placeholder: 'Who sent it (e.g. the team leader)', 'aria-label': 'From' });
  let res = { hits: [], unknown: [], offsite: [] };
  const save = (tip) => { if (!res.hits.length) return; heardFrom = src.value.trim(); ctx.update(x => res.hits.reduce((a, m) => N.setPost(a, date, m.key, m.site, tip ? { tip: true, from: heardFrom } : {}), x)); closeSheets(); toast(`${plural(res.hits.length, 'nurse')} saved as ${tip ? 'heard' : 'confirmed'}`); };
  const b1 = h('button', { class: 'btn primary grow', onClick: () => save(true) }, 'Save as heard'), b2 = h('button', { class: 'btn grow', onClick: () => save(false) }, 'Save as confirmed');
  const paint = () => { res = NB.parsePostingList(ta.value, rows); const by = {}; res.hits.forEach(m => (by[m.site] ||= []).push(m));
    out.replaceChildren(...Object.entries(by).map(([site, l]) => h('div', { class: 'small' }, h('b', {}, `${N.siteLabel(site)} (${l.length}) `), l.map(m => names.get(m.key) || m.name).join(', '))),
      ...res.offsite.map(m => h('div', { class: 'tiny pc-note bad' }, `${m.name}: cannot be posted to ${m.site}`)), res.unknown.length ? h('div', { class: 'tiny dim' }, `Not matched: ${res.unknown.map(u => `“${u.text}” (${u.why})`).join(', ')}`) : null);
    b1.disabled = b2.disabled = !res.hits.length; b1.textContent = res.hits.length ? `Save ${res.hits.length} as heard` : 'Save as heard'; };
  ta.addEventListener('input', paint); paint();
  ctx.sheet([h('h2', {}, `Paste postings · ${dayLabel(date)}`), h('div', { class: 'small muted' }, 'Paste the message with the postings. Names are matched to the nurses on shift that day; nothing is saved until you choose.'), field('Message', ta), field('From', src), out, h('div', { class: 'row wrap', style: { marginTop: '10px' } }, b1, b2)]);
}
let swipeX = null;
export function renderNurses() {
  const s = S(), date = nDate, rota = N.nurseRotaFor(s, date); names = nurseNames(s);
  const to = (d) => { nDate = d; ctx.render(); };
  const nav = h('div', { class: 'row nb-nav' }, h('button', { class: 'btn icon', 'aria-label': 'Previous day', onClick: () => to(addDays(nDate, -1)) }, '‹'), h('div', { class: 'grow', style: { textAlign: 'center' } }, h('b', {}, dayLabel(date)), h('div', { class: 'tiny dim' }, relDay(date))), h('button', { class: 'btn icon', 'aria-label': 'Next day', onClick: () => to(addDays(nDate, 1)) }, '›'));
  const today = startOfDay(new Date()), quick = h('div', { class: 'chips nb-quick' }, h('button', { class: `chip ${+date === +today ? 'sel' : ''}`, onClick: () => to(today) }, 'Today'), h('button', { class: `chip ${+date === +addDays(today, 1) ? 'sel' : ''}`, onClick: () => to(addDays(today, 1)) }, 'Tomorrow'), rota ? h('button', { class: 'chip', onClick: () => pasteSheet(date) }, '📋 Paste list') : null);
  const board = h('div', { class: 'nb-board', onTouchstart: (e) => { const t = e.touches[0]; swipeX = e.target.closest('input, textarea, .nb-strip') ? null : [t.clientX, t.clientY]; }, onTouchend: (e) => { if (!swipeX) return; const t = e.changedTouches[0], dx = t.clientX - swipeX[0], dy = t.clientY - swipeX[1]; swipeX = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 45) to(addDays(nDate, dx < 0 ? 1 : -1)); } }, nav, dayStrip(s, date), quick);
  if (!rota) { board.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '🩺'), `No nurse schedule for ${MONTHS[date.getMonth()]} ${date.getFullYear()}`), h('div', { class: 'row', style: { justifyContent: 'center' } }, ctx.importButton('Import nurse schedule')))); return board; }
  const st = N.staffing(s, date), floaters = st.rows.filter(r => N.isFloater(r.group) && r.group !== 'head'), unposted = floaters.filter(r => !r.post), sug = unposted.filter(r => r.suggest);
  const heardN = unposted.filter(r => r.tip && !r.tip.guess).length, guessN = unposted.filter(r => r.tip?.guess).length, openN = unposted.length - heardN - guessN, head = st.rows.filter(r => r.group === 'head');
  const ends = contractEnds(s, date, 21).filter(e => e.inDays >= 0);
  const staff = h('div', { class: 'card nb-o1 nb-staff' }, h('div', { class: 'row wrap nb-staff-h' }, h('div', { class: 'title' }, `${st.total} nurses on shift`), h('div', { class: 'chips' }, Object.entries(st.byShift).sort().map(([t, n]) => h('span', { class: 'chip' }, `${t} ${n}`)))),
    h('div', { class: 'nb-meter', role: 'img', 'aria-label': `${floaters.length - unposted.length} confirmed, ${heardN} heard, ${guessN} guessed, ${openN} open` }, ['sure', 'heard', 'guess', 'open'].map((k, i) => { const n = [floaters.length - unposted.length, heardN, guessN, openN][i]; return n ? h('i', { class: k, style: { flexGrow: n } }) : null; })),
    h('div', { class: 'chips nb-legend' }, h('span', { class: 'chip sure' }, `✓ ${floaters.length - unposted.length} confirmed`), heardN ? h('span', { class: 'chip tip' }, `${heardN} heard?`) : null, guessN ? h('span', { class: 'chip guess' }, `${guessN} guesses`) : null, openN ? h('span', { class: 'chip late' }, `${openN} open`) : floaters.length && !unposted.length ? h('span', { class: 'chip sel' }, 'all confirmed') : null),
    head.length ? h('div', { class: 'tiny dim nb-line' }, `Head nurse on: ${head.map(r => `${nm(r)} ${hrs(r.shift)}`).join(', ')} · supervises all sites`) : null,
    ends.map(e => h('button', { class: 'tiny nb-line nb-end', onClick: () => { const p = N.nurses(s).find(n => N.keyOfPerson(n) === e.key); if (p) ctx.personSheet(p); } }, `⏳ ${names.get(e.key) || e.name}: contract ends ${dayLabel(e.date)}${e.lastShift ? ` · last shift ${dayLabel(e.lastShift)}` : ''}${e.inDays ? ` (in ${plural(e.inDays, 'day')})` : ' (today)'}`)));
  const myInfo = dayInfo(s, date), wc = myInfo.mine ? withMeCard(date, myInfo.mine, true) : null; if (wc) wc.classList.add('nb-o2');
  const confirmHeard = unposted.filter(r => r.tip && !r.tip.guess);
  const posts = h('div', { class: 'card nb-o3' }, h('div', { class: 'row wrap' }, h('div', { class: 'title grow' }, 'Postings'),
      confirmHeard.length ? h('button', { class: 'btn sm', title: 'Turn every heard tip into a confirmed posting', onClick: () => { ctx.update(x => confirmHeard.reduce((a, r) => N.setPost(a, date, r.key, r.tip.site), x)); undoToast(`${plural(confirmHeard.length, 'tip')} confirmed`, () => ctx.update(x => confirmHeard.reduce((a, r) => N.setPost(a, date, r.key, r.tip.site, { tip: true, from: r.tip.from }), x))); } }, `✓ Confirm heard (${confirmHeard.length})`) : null,
      sug.length ? h('button', { class: 'btn sm guess', title: 'Saved as guesses (dotted), never as confirmed postings', onClick: () => { ctx.update(x => N.applySuggestions(x, date)); undoToast(`${sug.length} saved as ${sug.length === 1 ? 'a guess' : 'guesses'} (last time) — confirm each`, () => ctx.update(x => sug.reduce((a, r) => N.setPost(a, date, r.key, ''), x))); } }, `Guess from last time (${sug.length})`) : null),
    h('div', { class: 'post-grid' }, N.SITES.map(t => siteTile(t.id, st.rows.filter(r => r.post === t.id), date, st.rows.filter(r => !r.post && r.tip?.site === t.id)))),
    h('div', { class: 'tiny dim nb-key' }, h('span', { class: 'k sure' }, 'confirmed'), h('span', { class: 'k heard' }, 'heard ?'), h('span', { class: 'k guess' }, 'guess (last time?)'), ' · tap a name to confirm, move or clear'));
  // where the tip came from: the head nurse and team leaders only; the last source you used is picked again
  const srcs = NB.heardSources(s); if (heardFrom === null) heardFrom = NB.lastSource(s) ?? (srcs.find(x => F.friendList(s).some(f => f.rotaKey === x.key)) || srcs[0] || { name: '' }).name;
  const other = heardFrom && !srcs.some(x => x.name === heardFrom);
  const modeBar = h('div', { class: 'mode-bar' }, h('div', { class: 'seg' }, [['confirm', '✓ Confirmed'], ['heard', 'Heard it ?']].map(([k, l]) => h('button', { class: mode === k ? 'active' : '', 'aria-pressed': String(mode === k), onClick: () => { mode = k; ctx.render(); } }, l))),
    mode === 'heard' ? h('div', { class: 'chips nb-from' }, h('span', { class: 'tiny dim', style: { alignSelf: 'center' } }, 'from'), ...srcs.map(x => h('button', { class: `chip ${heardFrom === x.name ? 'sel' : ''}`, onClick: () => { heardFrom = x.name; ctx.render(); } }, x.name)),
      h('input', { class: `nb-src ${other ? 'sel' : ''}`, value: other ? heardFrom : '', placeholder: 'someone else…', 'aria-label': 'Heard from someone else', 'data-nodirty': '', onChange: (e) => { heardFrom = e.target.value.trim(); ctx.render(); } })) : null,
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, mode === 'heard' ? 'A tip: what you heard before it is official. It shows as “heard ?”, never as confirmed, until you confirm it.' : 'Confirmed: where they were actually sent.'));
  const put = (r, id) => ctx.update(x => N.setPost(x, date, r.key, id, mode === 'heard' ? { tip: true, from: heardFrom } : {}));
  const np = unposted.length ? h('div', { class: 'card nb-o4' }, h('div', { class: 'title' }, `Not confirmed yet (${unposted.length})`), modeBar, h('div', { class: 'tiny dim', style: { margin: '10px 0 6px' } }, 'Tap where each one goes. Amber = heard, dotted = guess, dashed orange = where they went last time.'),
    unposted.sort((a, b) => (!!a.tip - !!b.tip) || a.shift.type.localeCompare(b.shift.type) || nm(a).localeCompare(nm(b))).map(r => { const k = kindOf(r);
      return h('div', { class: `row np-row ${k}` }, h('div', { class: 'grow', onClick: () => ctx.personSheet(r.person), style: { minWidth: 0 } }, h('div', { class: 'name ellipsis' }, r.person.name, r.person.leader ? ' ★' : ''), h('div', { class: 'tiny dim' }, `${r.shift.label.replace(/ ·.*/, '')} ${hrs(r.shift)} · ${N.GROUPS[r.group]?.label || ''}`), r.tip ? h('div', { class: `tiny tip-line ${k}` }, tipText(r.tip)) : null),
        h('div', { class: 'np-btns' }, r.choices.map(id => h('button', { class: `btn sm ${r.tip?.site === id ? k === 'guess' ? 'guess' : 'tip' : r.suggest === id ? 'sug' : 'ghost'}`, title: r.tip?.site === id ? tipText(r.tip) : r.suggest === id ? 'where she went last time' : N.siteLabel(id), onClick: () => put(r, id) }, id)))); })) : null;
  const fixed = st.rows.filter(r => r.fixed); let fx = null;
  if (fixed.length) { const by = {}; fixed.forEach(r => (by[r.fixed] ||= []).push(r)); fx = h('details', { class: 'card nb-o5' }, h('summary', {}, `Fixed posts (${fixed.length}): ${Object.entries(by).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`), Object.entries(by).map(([k, v]) => h('div', { style: { marginTop: '8px' } }, h('div', { class: 'tiny dim' }, k), h('div', { class: 'chips' }, v.map(r => h('button', { class: 'chip', onClick: () => ctx.personSheet(r.person) }, `${nm(r)} ${r.shift.type}`)))))); }
  const note = h('div', { class: 'tiny dim nb-o6', style: { margin: '6px 2px' } }, 'The schedule only says who works which shift. Where the construction-clinic nurses go (Upper/Lower Village, Upper/Lower office clinic) is decided the night before, so you enter it here and the app learns from confirmed postings only. Swipe the board to change day.');
  // wide: what you act on (with you, not confirmed) on the left, the sites and the day's facts on the right; phone: one column in order
  board.append(h('div', { class: 'nb' }, h('div', { class: 'nb-l' }, wc, np), h('div', { class: 'nb-r' }, staff, posts, fx, note)));
  return board;
}

// ───────── nurses with you (day sheet, board)
export function withMeCard(date, mine, onBoard = false) {
  const s = S(), w = N.workingWithMe(s, date, mine); if (!w || !w.hasNurses) return null; names = nurseNames(s);
  const [m0, m1] = [mine.shift.hours.start, mine.shift.hours.overnight || mine.shift.hours.end <= mine.shift.hours.start ? mine.shift.hours.end + 1440 : mine.shift.hours.end], len = m1 - m0, pc = (x) => `${Math.max(0, Math.min(100, (x - m0) / len * 100)).toFixed(1)}%`;
  const bar = (r, cls) => h('span', { class: 'nr-bar', 'aria-hidden': 'true' }, h('i', { class: cls, style: { left: pc(r.from), width: `${Math.max(2, (r.to - r.from) / len * 100).toFixed(1)}%` } }));
  const label = (r) => `${r.shift.type} ${hrs(r.shift)}${r.person.leader ? ' · leader' : ''}`;
  const right = (r, kind) => kind === 'maybe' ? h('small', {}, r.known ? `~${Math.round(r.chance * 100)}% here` : 'no history') : kind === 'heard' ? h('small', {}, r.heardFrom ? `heard · ${r.heardFrom}` : 'heard') : kind === 'guess' ? h('small', {}, 'last time?') : h('small', {}, 'confirmed');
  const row = (r, kind) => h('button', { class: `nr-row ${kind}`, onClick: () => { closeSheets(); ctx.personSheet(r.person); } }, h('span', { class: 'nr-name' }, h('span', { class: 'ellipsis' }, nm(r) + (kind === 'heard' || kind === 'guess' ? ' ?' : '')), h('small', {}, label(r))), bar(r, kind), h('span', { class: 'nr-pct' }, r.pct >= 0.995 ? 'all' : `${Math.round(r.pct * 100)}%`, right(r, kind)));
  const heard = w.tipped.filter(r => !r.guess), guess = w.tipped.filter(r => r.guess), poss = w.possible;
  // nobody known and everyone overlapping the whole shift: ten identical bars say nothing, so the names go in one compact, folded list
  const flat = poss.length > 3 && !poss.some(r => r.known) && poss.every(r => Math.abs(r.pct - poss[0].pct) < 0.01);
  const shown = flat ? [] : poss.slice(0, w.confirmed.length || heard.length ? 4 : 6), moreRows = flat ? [] : poss.slice(shown.length);
  const more = moreRows.length ? h('details', { class: 'nr-more' }, h('summary', {}, `Show ${moreRows.length} more`), moreRows.map(r => row(r, 'maybe'))) : null;
  const chips = flat ? h('details', { class: 'nr-more', open: onBoard && !w.confirmed.length && !heard.length ? '' : null }, h('summary', {}, `Who could be sent (${poss.length}) · ${poss[0].pct >= 0.995 ? 'all cover your whole shift' : `each covers ${Math.round(poss[0].pct * 100)}%`}`),
    h('div', { class: 'chips nr-chips' }, poss.map(r => h('button', { class: `chip nr-chip ${r.friend ? 'fr' : ''}`, title: label(r), onClick: () => { closeSheets(); ctx.personSheet(r.person); } }, r.friend ? '⭐ ' : '', nm(r), h('small', {}, ` ${r.shift.type}`))))) : null;
  const go = onBoard ? null : h('button', { class: 'btn sm', onClick: () => { closeSheets(); goNurses(date); ctx.go('rota', 'nurses'); } }, w.unposted ? (dayWord(date) === 'today' ? 'Set today’s postings' : `Set postings for ${dayLabel(date)}`) : 'Open postings');
  const sub = (t, n) => h('div', { class: 'nr-sub' }, t, n != null ? h('b', {}, n) : null);
  return h('div', { class: 'card nr' }, h('div', { class: 'title' }, w.site ? `Nurses at ${N.siteLabel(w.site)}` : 'Nurses on your shift'),
    h('div', { class: `ov-head ${w.confirmed.length ? 'ok' : 'warn'}` }, w.summary || (w.unposted ? 'No postings yet and nobody else overlaps your shift' : 'No nurses overlap your shift')),
    w.head?.length && !onBoard ? h('div', { class: 'tiny dim nr-head' }, `Head nurse on: ${w.head.map(r => `${nm(r)} ${hrs(r.shift)}`).join(', ')} · supervises, not posted`) : null,
    w.confirmed.length ? [sub('✓ Confirmed with you ', w.confirmed.length), w.confirmed.map(r => row(r, 'sure'))] : null,
    heard.length ? [sub('Heard, not confirmed ', heard.length), heard.map(r => row(r, 'heard'))] : null,
    guess.length ? [sub('Guesses from last time ', guess.length), guess.map(r => row(r, 'guess'))] : null,
    shown.length ? [sub(`${w.confirmed.length || heard.length ? 'Could still be sent to you' : 'Who could be with you'} · most likely first `, poss.length), shown.map(r => row(r, 'maybe')), more] : chips,
    h('div', { class: 'row wrap', style: { marginTop: '10px' } }, go, w.elsewhere ? h('span', { class: 'tiny dim' }, `${w.elsewhere} posted elsewhere`) : null, w.tippedElsewhere ? h('span', { class: 'tiny dim' }, `· ${w.tippedElsewhere} heard elsewhere`) : null));
}

// ───────── Today
/** Your shift that the nurses' card is about: last night's shift while its tail is still running (03:00 on a night), else today's. */
function myShiftNow(s, now) {
  const yd = addDays(startOfDay(now), -1), y = dayInfo(s, yd).mine, yh = y?.shift.kind === 'work' && y.shift.hours;
  if (yh && (yh.overnight || yh.end <= yh.start) && now < addDays(yd, 1).getTime() + (yh.end % 1440) * 6e4) return { date: yd, mine: y, live: true };
  const t = dayInfo(s, now).mine, th = t?.shift.kind === 'work' && t.shift.hours, d0 = startOfDay(now).getTime();
  return { date: startOfDay(now), mine: t, live: !!th && now >= d0 + th.start * 6e4 && now < d0 + (th.end <= th.start ? th.end + 1440 : th.end) * 6e4 };
}
/** Tomorrow's postings, worth a nudge only when you work tomorrow and somebody who could be at your site is not confirmed yet. */
function eveningNudge(s, now) {
  if (now.getHours() < 17) return null;
  const tm = addDays(startOfDay(now), 1), mine = dayInfo(s, tm).mine; if (mine?.shift.kind !== 'work' || myShiftNow(s, now).live) return null;
  const w = N.workingWithMe(s, tm, mine); if (!w?.hasNurses) return null;
  const open = w.possible.length, heard = w.tipped.filter(r => !r.guess).length, guess = w.tipped.length - heard;
  return open + w.tipped.length ? { tm, w, open, heard, guess } : null;
}
/** Rank for Today (app.js): the evening nudge is the moment this card exists for, so it must not fold into "More for today". */
export function todayScore(working = false) { if (!ctx) return 0; const s = S(); if (!s?.rotas) return 0; if (!N.nurseRotas(s).length) return 0; return eveningNudge(s, new Date()) ? 88 : working || myShiftNow(s, new Date()).live ? 86 : 25; }
// Today must never break the app's start-up: no ctx yet (initPeople not called), no state, no rota or no "me" → no card.
export function todayCard() { try { return todayCardInner(); } catch (e) { console.warn('nurses today card', e); return null; } }
function todayCardInner() {
  if (!ctx) return null;
  const s = S(), now = new Date(), cards = [];
  if (!s?.rotas || !N.nurseRotas(s).length) return null; names = nurseNames(s);
  const cur = myShiftNow(s, now), w = cur.mine ? N.workingWithMe(s, cur.date, cur.mine) : null;
  if (w && w.hasNurses && (w.confirmed.length || w.possible.length || w.tipped.length)) {
    const heard = w.tipped.filter(r => !r.guess), guess = w.tipped.filter(r => r.guess), list = (l, q = '') => l.slice(0, 3).map(r => nm(r) + q).join(', ') + (l.length > 3 ? ` +${l.length - 3}` : '');
    const head = w.confirmed.length ? `${plural(w.confirmed.length, 'nurse')} posted with you` : heard.length ? `${heard.length} heard to be with you` : `${plural(w.possible.length, 'nurse')} could be with you`;
    cards.push(h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, '🩺'), h('div', { class: 'grow' }, h('div', { class: 'name' }, head, cur.date < startOfDay(now) ? h('span', { class: 'tiny dim' }, ' · last night’s shift') : null),
      w.confirmed.length ? h('div', { class: 'tiny nr-t sure' }, '✓ ' + list(w.confirmed)) : null,
      heard.length ? h('div', { class: 'tiny nr-t heard' }, 'heard: ' + list(heard, '?')) : null,
      guess.length ? h('div', { class: 'tiny nr-t guess' }, 'guess: ' + list(guess, '?') + ' (last time)') : null,
      !w.confirmed.length && !heard.length ? h('div', { class: 'tiny dim' }, w.likely.length ? `likely: ${list(w.likely)} · not posted yet` : 'not posted yet') : null),
      h('button', { class: 'btn sm', onClick: () => { goNurses(cur.date); ctx.go('rota', 'nurses'); } }, 'Open')));
  }
  const nz = eveningNudge(s, now);
  if (nz) cards.push(h('div', { class: 'row ch-line nb-nudge' }, h('span', { class: 'ch-ic sm' }, '🌙'), h('div', { class: 'grow' }, h('div', { class: 'name' }, `Postings for tomorrow${nz.w.site ? ' at ' + N.siteLabel(nz.w.site) : ''}`),
    h('div', { class: 'tiny dim' }, [nz.open ? `${nz.open} could be sent to you, not set` : '', nz.heard ? `${nz.heard} heard` : '', nz.guess ? `${nz.guess} guessed` : ''].filter(Boolean).join(' · ') + ' · confirm when you hear')),
    h('button', { class: 'btn sm primary', onClick: () => { goNurses(nz.tm); ctx.go('rota', 'nurses'); } }, 'Set')));
  return cards.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Nurses'), cards) : null;
}

// ───────── shared bits for rota views
const hh = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0');
const tClass = PL.tClass, stCls = (code) => { const n = PL.siteNo(code); return n ? `st-${n}` : ''; };
const hoursShort = (sh) => sh.hours ? `${hh(sh.hours.start)}–${hh(sh.hours.end % 1440 || 1440)}` : '';
const monthsOf = (s, key) => Object.values(s.rotas).filter(r => r.people.some(x => ctx.personKeyOf(x) === key)).sort((a, b) => a.year - b.year || a.month - b.month);
const UNIT_LABELS = { gp: 'GP rota', fsed: 'FSED specialists', uv: 'Upper Village specialists', lv: 'Lower Village specialists', nurse: 'Nurses' };
/** "Day · Upper Village · 08–20 · 12h" — the site once, and a plain note when the rota gives no hours. */
function shiftLine(sh) {
  if (sh.kind !== 'work') return sh.kind === 'off' ? 'Day off' : sh.label;
  return [sh.label, shiftDetail(sh)].filter(Boolean).join(' · ');
}
const shiftDetail = (sh) => [sh.hours ? `${hoursShort(sh)} · ${fmtDur(sh.hours.durationMin)}` : 'no hours in the rota', sh.site && !sh.label.includes(sh.site) ? sh.site : ''].filter(Boolean).join(' · ');
/** Who else has the same shift that day in the same rota (same code for GPs: D1 is Upper Village, D2 Lower). */
function sameShift(r, p, d, sh) {
  if (sh.kind !== 'work') return [];
  return r.people.filter(x => x !== p && (x.days[d] || '') && interpretCode(x.days[d] || '', r.legend, r.unitKind).kind === 'work' && (r.unitKind === 'gp' ? (x.days[d] || '').toUpperCase() === (p.days[d] || '').toUpperCase() : interpretCode(x.days[d] || '', r.legend, r.unitKind).type === sh.type));
}
const firstOf = (n) => n.replace(/^Dr\.?\s*/i, '').split(' ')[0];

/** One person's month, laid out to be read at a glance: tinted weekend, hours under every code, a ring on today, a dot on days you share, stats and a legend. Tap a day for the details. */
export function personRota(p) {
  const s = S(), key = ctx.personKeyOf(p), all = monthsOf(s, key); if (!all.length) return null;
  const today = new Date(), nowKey = `${today.getFullYear()}-${today.getMonth() + 1}`, mine = isMe(s, p);
  const pick = () => { const want = pMonth[key]; return all.find(r => r.id === want) || all.find(r => `${r.year}-${r.month}` === nowKey) || all[all.length - 1]; };
  const wrap = h('div', { class: 'card prota' }); let cur = pick(), sel = null;
  const sharedDates = new Set(mine ? [] : sharedShifts(s, key).map(x => keyOf(x.date)));
  function paint() {
    const r = cur, person = r.people.find(x => ctx.personKeyOf(x) === key), first = new Date(r.year, r.month - 1, 1), idx = all.indexOf(r);
    const shared = [...sharedDates].filter(k => k.startsWith(`${r.year}-${String(r.month).padStart(2, '0')}`)).length, st = PL.monthStats(r, person);
    const grid = h('div', { class: 'pr-grid' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => h('span', { class: `pr-dow ${i >= 5 ? 'we' : ''}` }, x)));
    for (let i = 0; i < first.getDay(); i++) grid.append(h('span', { class: 'pr-pad' }));
    const used = new Map();
    for (let d = 1; d <= r.daysInMonth; d++) {
      const date = new Date(r.year, r.month - 1, d), code = person.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), cls = tClass(sh), isToday = +startOfDay(today) === +date, dk = keyOf(date);
      if (code && sh.kind !== 'off') used.set(code, sh);
      grid.append(h('button', { class: `pr-day t-${cls} ${stCls(code)} ${date.getDay() >= 5 ? 'we' : ''} ${isToday ? 'today' : ''} ${sel === d ? 'sel' : ''}`, 'aria-label': `${dayLabel(date)}: ${shiftLine(sh)}${sharedDates.has(dk) ? ', with you' : ''}`, 'aria-pressed': String(sel === d), onClick: () => { sel = sel === d ? null : d; paint(); } },
        h('i', { class: 'pr-n' }, d), h('b', {}, sh.kind === 'off' ? '' : sh.kind === 'leave' ? 'L' : code.length > 4 ? '•' : code), h('small', {}, sh.kind === 'work' ? (sh.hours ? hoursShort(sh) : 'no hrs') : ''), sharedDates.has(dk) ? h('em', { class: 'pr-with', title: 'You work this shift together' }) : null));
    }
    // nights are N only; SF 13–01 / A2 14–02 get their own "late" tile. Hours carry a "+" when some shifts have none in the rota.
    const tiles = [[st.work, plural(st.work, 'shift').replace(/^\d+ /, '')], [`${st.hours}${st.noHours ? '+' : ''}`, 'hours'], [st.nights, st.nights === 1 ? 'night' : 'nights'], st.late ? [st.late, 'late'] : null, [st.off, 'days off'], st.leave ? [st.leave, 'leave'] : null, shared ? [shared, 'with you'] : null].filter(Boolean);
    const many = all.length > 1;
    wrap.replaceChildren(
      h('div', { class: 'row' }, many ? h('button', { class: 'btn icon sm', disabled: idx <= 0, 'aria-label': 'Previous month', onClick: () => { cur = all[idx - 1]; pMonth[key] = cur.id; sel = null; paint(); } }, '‹') : null,
        h('div', { class: 'grow', style: { textAlign: 'center' } }, h('b', {}, `${MONTHS[r.month - 1]} ${r.year}`), h('div', { class: 'tiny dim' }, UNIT_LABELS[r.unitKind] || r.unit)), many ? h('button', { class: 'btn icon sm', disabled: idx >= all.length - 1, 'aria-label': 'Next month', onClick: () => { cur = all[idx + 1]; pMonth[key] = cur.id; sel = null; paint(); } }, '›') : null),
      h('div', { class: 'pr-stats', style: { '--n': tiles.length, '--n2': tiles.length > 5 ? Math.ceil(tiles.length / 2) : tiles.length, '--n3': tiles.length > 4 ? Math.ceil(tiles.length / 2) : tiles.length } }, tiles.map(([n, l]) => h('div', {}, h('b', {}, n), h('small', {}, l)))),
      st.noHours ? h('div', { class: 'tiny dim pr-note' }, `${plural(st.noHours, 'shift')} without hours in the rota (${[...new Set([...Array(r.daysInMonth)].map((_, i) => person.days[i + 1] || '').filter(c => { const x = interpretCode(c, r.legend, r.unitKind); return x.kind === 'work' && !x.hours; }))].join(', ')}), not in the total`) : null,
      grid,
      sel ? dayDetail(r, person, sel) : null,
      h('div', { class: 'pr-legend' }, [...used.entries()].slice(0, 10).map(([code, sh]) => h('span', { class: `pr-key t-${tClass(sh)} ${stCls(code)}` }, h('b', {}, code.length > 6 ? code.slice(0, 5) + '…' : code), ' ', sh.kind === 'work' ? [sh.label.replace(/ ·.*/, '').replace(/ \(.*\)$/, ''), PL.siteNo(code) && sh.site ? ` ${sh.site}` : '', sh.hours ? ` ${hoursShort(sh)}` : ''] : sh.label))));
  }
  function dayDetail(r, person, d) {
    const date = new Date(r.year, r.month - 1, d), code = person.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), lines = [shiftLine(sh)];
    let extra = null;
    if (r.unitKind === 'nurse') { const row = N.rowsFor(s, date).find(x => x.key === key); if (row) { const t = N.tipOf(s, date, key); lines.push(row.post ? `At ${N.siteLabel(row.post)}${row.fixed ? '' : ' (confirmed)'}` : t ? `${t.guess ? `Guess: ${N.siteLabel(t.site)} (last time)` : `Heard: ${N.siteLabel(t.site)}${t.from ? ' from ' + t.from : ''}`} · not confirmed` : N.isFloater(row.group) ? 'Not posted yet' : ''); } }
    else if (sh.kind === 'work') { const info = dayInfo(s, date), same = (info.bySite[sh.site || sh.label] || []).filter(e => e.shift.type === sh.type && ctx.personKeyOf(e.person) !== key); if (same.length) extra = h('div', { class: 'tiny dim' }, `Same shift: ${same.slice(0, 6).map(e => firstOf(e.person.name)).join(', ')}${same.length > 6 ? ` +${same.length - 6}` : ''}`); }
    return h('div', { class: 'pr-detail' }, h('b', {}, dayLabel(date), h('span', { class: 'dim' }, ` · ${PL.relWords(date, today)}`)), lines.filter(Boolean).map(l => h('div', { class: 'small' }, l)), extra, h('button', { class: 'btn sm ghost', onClick: () => { closeSheets(); ctx.openDay(date); } }, 'Open that day'));
  }
  paint(); return wrap;
}

// ───────── whole roster: everyone × every day of the month
/** Tap on a roster cell: the shift, who else has it, and the way to the day or the person. */
function cellSheet(r, p, d) {
  const date = new Date(r.year, r.month - 1, d), code = p.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), same = sameShift(r, p, d, sh);
  steadySheet([h('h2', {}, p.name), h('div', { class: 'small muted' }, `${dayLabel(date)} · ${PL.relWords(date)}`),
    h('div', { class: 'card rg-cell-card' }, h('div', { class: 'row' }, sh.kind === 'off' ? null : ctx.shiftChip(sh, code), h('b', { class: 'grow' }, sh.kind === 'off' ? 'Day off' : sh.label)), sh.kind === 'work' ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, shiftDetail(sh)) : null,
      same.length ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'tiny dim' }, `Same shift (${same.length})`), h('div', { class: 'chips', style: { marginTop: '4px' } }, same.slice(0, 12).map(x => h('button', { class: 'chip', onClick: () => { closeSheets(); ctx.personSheet(x); } }, firstOf(x.name))), same.length > 12 ? h('span', { class: 'chip' }, `+${same.length - 12}`) : null)) : sh.kind === 'work' ? h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, 'Nobody else on this shift in this rota') : null),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn grow', onClick: () => { closeSheets(); ctx.openDay(date); } }, 'Open that day'), h('button', { class: 'btn grow', onClick: () => { closeSheets(); ctx.personSheet(p); } }, 'Open their rota'))]);
}
export function renderRoster() {
  const s = S(), rotas = Object.values(s.rotas); if (!rotas.length) return [h('div', { class: 'card empty' }, 'No schedules loaded', h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } }, ctx.importButton('Import schedules')))];
  const nowD = new Date(); if (!rMonth) rMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
  const y = rMonth.getFullYear(), mo = rMonth.getMonth() + 1, ofMonth = rotas.filter(r => r.year === y && r.month === mo);
  // the unit you picked (GP / Nurses / FSED…) stays picked when you change month
  const nav = h('div', { class: 'row', style: { marginBottom: '8px' } }, h('button', { class: 'btn icon sm', 'aria-label': 'Previous month', onClick: () => { rMonth = new Date(y, mo - 2, 1); ctx.render(); } }, '‹'), h('b', { class: 'grow', style: { textAlign: 'center' } }, `${MONTHS[mo - 1]} ${y}`), h('button', { class: 'btn icon sm', 'aria-label': 'Next month', onClick: () => { rMonth = new Date(y, mo, 1); ctx.render(); } }, '›'));
  if (!ofMonth.length) {
    const near = [...rotas].sort((a, b) => Math.abs((a.year * 12 + a.month) - (y * 12 + mo)) - Math.abs((b.year * 12 + b.month) - (y * 12 + mo)))[0];
    return [nav, h('div', { class: 'card empty' }, h('div', {}, `No schedule loaded for ${MONTHS[mo - 1]} ${y}`), h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '10px' } }, h('button', { class: 'btn', onClick: () => { rMonth = new Date(near.year, near.month - 1, 1); ctx.render(); } }, `Go to ${MONTHS[near.month - 1]} ${near.year}`), ctx.importButton('Import schedules')))];
  }
  const r = ofMonth.find(x => x.unitKind === rUnit) || ofMonth.find(x => x.unitKind === 'gp') || ofMonth[0];
  const picker = ofMonth.length > 1 ? h('div', { class: 'chips', style: { marginBottom: '8px' } }, ofMonth.map(x => h('button', { class: `chip ${x.id === r.id ? 'sel' : ''}`, onClick: () => { rUnit = x.unitKind; ctx.render(); } }, `${UNIT_LABELS[x.unitKind] || x.unit} · ${x.people.length}`))) : null;
  const nurseMap = r.unitKind === 'nurse' ? new Map(N.nurses(s).map(n => [ctx.personKeyOf(n), n])) : new Map();
  // same matcher as the list (name, title, unit, clinic, group, saved note/handles, number); its own text, so the two boxes never leak into each other
  const people = r.people.filter(p => { const n = nurseMap.get(ctx.personKeyOf(p)); return PL.matches(rQuery, { p, units: [r.unitKind], clinic: n?.clinic || p.clinic, group: N.GROUPS[p.group]?.label, contact: F.contactOf(s, ctx.personKeyOf(p)) }); });
  const input = h('input', { type: 'search', placeholder: 'Filter this roster', value: rQuery, class: 'dir-search rg-search', 'aria-label': 'Filter this roster', onInput: (e) => { rQuery = e.target.value; ctx.render(); const i = document.querySelector('#view-rota .rg-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } });
  const zoom = h('button', { class: `chip ${rZoom ? 'sel' : ''}`, 'aria-pressed': String(rZoom), title: 'Bigger cells, easier to tap', onClick: () => { rZoom = !rZoom; ctx.render(); } }, '🔍 Big cells');
  const todayN = nowD.getFullYear() === y && nowD.getMonth() + 1 === mo ? nowD.getDate() : 0, cols = r.daysInMonth, gp = r.unitKind === 'gp';
  const dow = (d) => new Date(y, mo - 1, d).getDay(), clinic = Array(cols).fill(0), offsite = Array(cols).fill(0), cells = [], used = new Map();
  const head = [h('span', { class: 'rg-name rg-corner' }, ''), ...Array.from({ length: cols }, (_, i) => h('span', { class: `rg-h ${dow(i + 1) >= 5 ? 'we' : ''} ${todayN === i + 1 ? 'today' : ''}` }, h('small', {}, 'SMTWTFS'[dow(i + 1)]), i + 1))];
  const names = PL.shortNames(r.people.map(x => x.name)), short = new Map(r.people.map((p, i) => [p, names[i]]));
  let lastGroup = null;
  for (const p of people) {
    // a sticky label inside the full-width bar, so the group name stays in view when the grid scrolls sideways
    if (r.unitKind === 'nurse' && p.group !== lastGroup) { lastGroup = p.group; cells.push(h('div', { class: 'rg-sec', style: { gridColumn: `1 / span ${cols + 1}` } }, h('span', { class: 'rg-sec-l' }, N.GROUPS[p.group]?.label || ''))); }
    const me = isMe(s, p);
    cells.push(h('button', { class: `rg-name ${me ? 'me' : ''}`, title: p.name, onClick: () => ctx.personSheet(p) }, h('span', { class: 'rg-nm' }, short.get(p)), h('span', { class: 'rg-nm rg-full' }, p.name.replace(/^Dr\.?\s*/i, '').replace(/\s*-\s*TL$/, ''))));
    const whole = PL.wholeMonth(r, p);
    if (whole) { const sh = interpretCode(whole, r.legend, r.unitKind); used.set(whole, sh); cells.push(h('button', { class: `rg-c rg-span t-${tClass(sh)}`, style: { gridColumn: `span ${cols}` }, 'aria-label': `${p.name}: ${sh.label} all month`, onClick: () => ctx.personSheet(p) }, h('span', { class: 'rg-span-l' }, `${sh.label} · all month`))); continue; }
    for (let d = 1; d <= cols; d++) {
      const code = p.days[d] || '', sh = interpretCode(code, r.legend, r.unitKind), cls = tClass(sh);
      if (sh.kind === 'work') (gp && PL.isOffSite(sh) ? offsite : clinic)[d - 1]++;
      if (code && sh.kind !== 'off') used.set(code, sh);
      cells.push(h('button', { class: `rg-c t-${cls} ${stCls(code)} ${dow(d) >= 5 ? 'we' : ''} ${todayN === d ? 'today' : ''}`, 'aria-label': `${p.name}, ${d} ${MONTHS[mo - 1]}: ${shiftLine(sh)}`, onClick: () => cellSheet(r, p, d) }, sh.kind === 'off' ? '' : sh.kind === 'leave' ? 'L' : code.length > 3 ? '•' : code));
    }
  }
  if (!people.length) cells.push(h('div', { class: 'rg-none', style: { gridColumn: `1 / span ${cols + 1}` } }, h('span', {}, `Nobody in this roster matches “${rQuery}”`)));
  // GP footer: clinic coverage apart from admin days, HQ and off-site projects, which are not cover for the Qiddiya clinics
  const foot = (label, arr, cls = '', title = '') => [h('span', { class: `rg-name rg-foot ${cls}`, title }, label), ...arr.map((n, i) => h('span', { class: `rg-f ${cls} ${todayN === i + 1 ? 'today' : ''}` }, n || ''))];
  if (people.length) { if (gp && offsite.some(Boolean)) cells.push(...foot('In clinics', clinic, '', 'Day, evening, night and SF shifts at the Qiddiya clinics'), ...foot('Admin / off-site', offsite, 'rg-f2', 'Admin days, HQ, Nairiya, SABIC compound')); else cells.push(...foot('On duty', clinic)); }
  const legend = [...used.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).slice(0, 24).map(([code, sh]) => h('span', { class: `rg-key` }, h('i', { class: `rg-sw t-${tClass(sh)} ${stCls(code)}`, 'aria-hidden': 'true' }), h('b', {}, code.length > 6 ? code.slice(0, 5) + '…' : code), ' ', sh.kind === 'work' ? [sh.label.replace(/ \(.*\)$/, ''), sh.hours ? ` ${hoursShort(sh)}` : ''] : sh.label));
  return [nav, picker, h('div', { class: 'row rg-tools' }, input, zoom), h('div', { class: 'rg-scroll' }, h('div', { class: `rg ${rZoom ? 'zoom' : ''}`, style: { '--cols': cols } }, ...head, ...cells)),
    legend.length ? h('div', { class: 'rg-legend' }, legend) : null,
    h('div', { class: 'tiny dim', style: { margin: '6px 2px' } }, `${plural(people.length, 'person').replace('persons', 'people')} · tap a name for their rota, a cell for that day · Fri/Sat tinted${gp ? ' · edge stripe = site' : ''}`)];
}
