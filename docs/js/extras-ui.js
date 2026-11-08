// Social → Plans: time polls, place wishlist, team treats; plus nudges (rota birthdays, nurses' contract ends, treat reminder) for the Overview.
import { h, toast, keyOf, fromKey, fmtMin, DAY_SHORT, MONTHS } from './util.js';
import * as X from './extras.js';
import * as F from './social.js';
let ctx = null, wishKind = 'all';
export function initExtras(c) { ctx = c; }
const S = () => ctx.S(), fd = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`, field = (l, ...x) => h('div', { class: 'field' }, h('label', {}, l), ...x);
const first = (f) => (f.nick || f.name).split(' ')[0];
const av = (f) => h('span', { class: 'avatar sm' }, (f.nick || f.name)[0]?.toUpperCase());

export function renderPlans() { return [pollsCard(), wishCard(), treatCard()]; }

// ───────── polls
function pollsCard() {
  const s = S(), polls = X.pollList(s);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Time polls'), h('button', { class: 'btn sm', onClick: () => pollSheet() }, '＋ New poll')),
    !polls.length ? h('div', { class: 'small muted' }, 'Ask a few friends which time works. Send the options on WhatsApp, then tap who said yes.') : null,
    polls.map(p => pollRow(p)));
}
function pollRow(p) {
  const s = S(), r = X.pollResult(p), fr = p.who.map(id => s.friends?.[id]).filter(Boolean);
  return h('div', { class: `poll ${p.status === 'closed' ? 'closed' : ''}` }, h('div', { class: 'row' }, h('b', { class: 'grow' }, p.title), r.everyone ? h('span', { class: 'chip sel' }, 'everyone can') : r.noneFit ? h('span', { class: 'chip late' }, 'no common time') : h('span', { class: 'chip' }, `${r.answered.length}/${p.who.length} answered`)),
    p.slots.map((sl, i) => h('div', { class: `poll-slot ${p.chosen === i ? 'chosen' : r.best === i && p.chosen < 0 ? 'best' : ''}` }, h('div', { class: 'grow' }, h('b', {}, fd(fromKey(sl.date))), ' ', h('span', { class: 'dim' }, `${fmtMin(sl.start)}–${fmtMin(Math.min(sl.end, 1439))}`)),
      h('div', { class: 'chips' }, fr.map(f => h('button', { class: `chip ${(p.votes[f.id] || []).includes(i) ? 'sel' : ''}`, 'aria-label': `${first(f)} ${(p.votes[f.id] || []).includes(i) ? 'can' : 'not yet'} ${fd(fromKey(sl.date))}`, onClick: () => ctx.update(x => { const cur = x.polls[p.id].votes[f.id] || [], next = cur.includes(i) ? cur.filter(n => n !== i) : [...cur, i]; return X.setVote(x, p.id, f.id, next); }) }, first(f)))),
      p.status === 'open' ? h('button', { class: 'btn sm ghost', onClick: () => ctx.update(x => X.savePoll(x, { ...x.polls[p.id], status: 'closed', chosen: i })) }, 'Pick') : null)),
    r.waiting.length && p.status === 'open' ? h('div', { class: 'tiny dim' }, `Not answered yet: ${r.waiting.map(id => first(s.friends[id] || { name: '?' })).join(', ')}`) : null,
    h('div', { class: 'row wrap', style: { marginTop: '6px' } }, p.status === 'open' ? h('button', { class: 'btn sm grow', onClick: () => sendPoll(p) }, 'Send on WhatsApp') : h('button', { class: 'btn sm grow', onClick: () => ctx.update(x => X.savePoll(x, { ...x.polls[p.id], status: 'open', chosen: -1 })) }, 'Reopen'),
      p.chosen >= 0 ? h('button', { class: 'btn sm', onClick: () => ctx.invite?.(p.who, p.title) }, 'Plan it') : null, h('button', { class: 'btn sm ghost', 'aria-label': `Delete poll ${p.title}`, onClick: () => { if (confirm('Delete this poll?')) ctx.update(x => X.deletePoll(x, p.id)); } }, '🗑')));
}
function sendPoll(p) {
  const s = S(), fr = p.who.map(id => s.friends?.[id]).filter(Boolean), text = X.pollText(p, fr.map(first), (d) => fd(d), fmtMin);
  const box = ctx.sheet([h('h2', {}, 'Send the poll'), h('div', { class: 'small muted' }, 'One message per friend, or copy it for a group chat.'), h('pre', { class: 'poll-text' }, text),
    h('div', { class: 'list' }, fr.map(f => { const u = F.waWith(f, text); return u ? h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener' }, `WhatsApp ${first(f)}`) : h('span', { class: 'btn ghost', style: { opacity: .5 } }, `${first(f)}: no number saved`); })),
    h('button', { class: 'btn grow', onClick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy', 'err'); } } }, 'Copy for a group chat')]);
}
function pollSheet() {
  const s = S(), fr = F.friendList(s), sel = new Set(), slots = []; if (!fr.length) return toast('Add some friends first', 'err');
  const title = h('input', { value: 'Dinner', placeholder: 'What for?' }), list = h('div', {}), who = h('div', { class: 'chips' }, fr.map(f => h('button', { class: 'chip', 'aria-pressed': 'false', onClick: (e) => { sel.has(f.id) ? sel.delete(f.id) : sel.add(f.id); e.currentTarget.classList.toggle('sel', sel.has(f.id)); suggest(); } }, first(f))));
  const date = h('input', { type: 'date', value: keyOf(new Date()) }), st = h('input', { type: 'time', value: '20:00' }), en = h('input', { type: 'time', value: '22:00' }), hm = (v) => { const [a, b] = v.split(':').map(Number); return a * 60 + b; };
  const paint = () => list.replaceChildren(...slots.map((x, i) => h('div', { class: 'row' }, h('div', { class: 'grow small' }, `${fd(fromKey(x.date))} ${fmtMin(x.start)}–${fmtMin(x.end)}`), h('button', { class: 'btn sm ghost', 'aria-label': 'Remove option', onClick: () => { slots.splice(i, 1); paint(); } }, '✕'))));
  const sugg = h('div', { class: 'chips' }); const suggest = () => { const ids = [...sel]; sugg.replaceChildren(...(ids.length ? F.meetups(s, { ids, busyOf: ctx.busyOf, days: 21 }).slice(0, 4).map(m => h('button', { class: 'chip', onClick: () => { if (slots.length < 8) { slots.push({ date: keyOf(m.date), start: m.window[0], end: Math.min(m.window[1], m.window[0] + 180) }); paint(); } } }, `${fd(m.date)} ${fmtMin(m.window[0])}`)) : [])); };
  const box = ctx.sheet([h('h2', {}, 'New time poll'), field('What for?', title), h('div', { class: 'title' }, 'Who'), who, h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'Times when you and the people you picked are all free'), sugg,
    h('div', { class: 'title', style: { marginTop: '10px' } }, 'Options'), list, h('div', { class: 'row wrap' }, field('Day', date), field('From', st), field('To', en), h('button', { class: 'btn', onClick: () => { if (hm(en.value) <= hm(st.value)) return toast('End must be after start', 'err'); if (slots.length >= 8) return toast('Eight options at most', 'err'); slots.push({ date: date.value, start: hm(st.value), end: hm(en.value) }); paint(); } }, 'Add')),
    h('button', { class: 'btn primary', onClick: () => { if (!sel.size) return toast('Pick at least one friend', 'err'); if (!slots.length) return toast('Add at least one option', 'err'); ctx.update(x => X.savePoll(x, { title: title.value, slots, who: [...sel] })); box.close(); ctx.render(); } }, 'Create poll')]);
}

// ───────── wishlist
function wishCard() {
  const s = S(), all = X.wishList(s), list = all.filter(w => wishKind === 'all' || w.kind === wishKind), done = X.wishList(s, true);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Wishlist'), h('button', { class: 'btn sm', onClick: () => wishSheet() }, '＋ Add')),
    all.length ? h('div', { class: 'chips', style: { margin: '6px 0' } }, [['all', 'All'], ...X.WISH_KINDS.map(k => [k[0], `${k[1]} ${k[2].split(' ')[0]}`])].map(([k, l]) => h('button', { class: `chip ${wishKind === k ? 'sel' : ''}`, onClick: () => { wishKind = k; ctx.render(); } }, l))) : h('div', { class: 'small muted' }, 'Restaurants, trips and ideas to try with friends.'),
    list.map(w => h('div', { class: 'row wish' }, h('span', { class: 'ch-ic sm' }, X.WISH_KINDS.find(k => k[0] === w.kind)?.[1] || '📍'), h('div', { class: 'grow' }, h('div', { class: 'name' }, w.url ? h('a', { href: w.url, target: '_blank', rel: 'noopener' }, w.name) : w.name), h('div', { class: 'tiny dim' }, [w.city, w.note].filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm ghost', 'aria-label': `Plan ${w.name}`, onClick: () => ctx.invite?.(w.with || [], w.name) }, 'Plan'), h('button', { class: 'btn sm ghost', 'aria-label': `Done ${w.name}`, onClick: () => ctx.update(x => X.saveWish(x, { ...x.wishlist[w.id], done: keyOf(new Date()) })) }, '✓'), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${w.name}`, onClick: () => wishSheet(w) }, '✎'))),
    done.length ? h('details', {}, h('summary', { class: 'tiny dim' }, `Been there (${done.length})`), done.map(w => h('div', { class: 'row small' }, h('div', { class: 'grow' }, w.name), h('span', { class: 'tiny dim' }, w.done), h('button', { class: 'btn sm ghost', 'aria-label': `Put ${w.name} back`, onClick: () => ctx.update(x => X.saveWish(x, { ...x.wishlist[w.id], done: '' })) }, '↩')))) : null);
}
function wishSheet(w) {
  const v = { ...(w || { kind: 'food' }) }, I = (k, p = {}) => h('input', { value: v[k] || '', ...p, onInput: (e) => { v[k] = e.target.value; } });
  const box = ctx.sheet([h('h2', {}, w ? 'Edit' : 'Add to wishlist'), field('Name', I('name', { placeholder: 'Where or what' })), h('div', { class: 'chips' }, X.WISH_KINDS.map(([k, ic, l]) => h('button', { class: `chip ${v.kind === k ? 'sel' : ''}`, onClick: (e) => { v.kind = k; e.currentTarget.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, `${ic} ${l}`))),
    field('City', I('city')), field('Link', I('url', { placeholder: 'https://…' })), field('Note', I('note')), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: () => { if (!String(v.name || '').trim()) return toast('Give it a name', 'err'); ctx.update(x => X.saveWish(x, v)); box.close(); ctx.render(); } }, 'Save'), w ? h('button', { class: 'btn danger', onClick: () => { ctx.update(x => X.deleteWish(x, w.id)); box.close(); ctx.render(); } }, 'Delete') : null)]);
}

// ───────── team treats
function treatCard() {
  const s = S(), l = X.treatList(s).slice(0, 6), n = X.treatNudge(s);
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Team treats'), h('button', { class: 'btn sm', onClick: () => treatSheet() }, '＋ Log')),
    n ? h('div', { class: `cr-key ${n.due ? 'soon' : ''}` }, h('div', { class: 'grow' }, h('b', {}, n.since === 0 ? 'Brought something today' : `${n.since} day${n.since > 1 ? 's' : ''} since the last treat`), h('div', { class: 'tiny dim' }, `Your usual gap is about ${n.usual} days${n.spent ? ` · ${Math.round(n.spent)} SAR this month` : ''}`)), n.due ? h('span', { class: 'chip late' }, 'due') : null) : h('div', { class: 'small muted' }, 'Log the food or gifts you bring for the team and it reminds you when it has been a while.'),
    l.map(t => h('div', { class: 'row small' }, h('span', { class: 'ch-ic sm' }, '🍰'), h('div', { class: 'grow' }, `${t.what} for ${t.for}`), h('span', { class: 'tiny dim' }, `${t.date.slice(5)}${t.cost ? ` · ${Math.round(t.cost)} SAR` : ''}`), h('button', { class: 'btn sm ghost', 'aria-label': `Delete ${t.what}`, onClick: () => ctx.update(x => X.deleteTreat(x, t.id)) }, '✕'))));
}
function treatSheet() {
  const v = { date: keyOf(new Date()), what: '', for: 'The team', cost: 0 }, I = (k, p = {}) => h('input', { value: v[k], ...p, onInput: (e) => { v[k] = p.type === 'number' ? +e.target.value : e.target.value; } });
  const box = ctx.sheet([h('h2', {}, 'Log a treat'), field('What', I('what', { placeholder: 'Kunafa, coffee, a gift…' })), field('For', I('for')), h('div', { class: 'row wrap' }, field('Date', I('date', { type: 'date' })), field('Cost (SAR)', I('cost', { type: 'number', inputmode: 'numeric' }))), h('button', { class: 'btn primary', onClick: () => { ctx.update(x => X.saveTreat(x, v)); box.close(); ctx.render(); } }, 'Save')]);
}

// ───────── nudges for the Overview
export function nudgeRows() {
  const s = S(), out = [], bd = X.rotaBirthdays(s, new Date(), 21).slice(0, 3), ce = X.contractEnds(s, new Date(), 45).slice(0, 3), tn = X.treatNudge(s);
  for (const b of bd) out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '🎂'), h('div', { class: 'grow' }, h('div', { class: 'name' }, b.name), h('div', { class: 'tiny dim' }, b.inDays === 0 ? 'Birthday today' : `Birthday in ${b.inDays} day${b.inDays > 1 ? 's' : ''} (${fd(b.date)})`))));
  for (const c of ce) out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '📄'), h('div', { class: 'grow' }, h('div', { class: 'name' }, c.name), h('div', { class: 'tiny dim' }, c.inDays < 0 ? `Contract ended ${-c.inDays} day${c.inDays < -1 ? 's' : ''} ago` : c.inDays === 0 ? 'Contract ends today' : `Contract ends ${fd(c.date)} (${c.inDays} days)`))));
  if (tn?.due) out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '🍰'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Treat for the team?'), h('div', { class: 'tiny dim' }, `${tn.since} days since the last one (usually every ${tn.usual})`))));
  return out;
}
