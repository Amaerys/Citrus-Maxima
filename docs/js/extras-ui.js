// Social → Plans: time polls, place wishlist, team treats; plus nudges (rota birthdays, nurses' contract ends, treat reminder) for the Overview.
import { h, toast, keyOf, fromKey, DAY_SHORT, MONTHS } from './util.js';
import * as X from './extras.js';
import * as F from './social.js';
// social-ui imports this file too; the cycle is safe because inviteSheet is only called on a tap, long after both modules loaded.
import * as SU from './social-ui.js';
let ctx = null, wishKind = 'all';
export function initExtras(c) { ctx = c; }
const S = () => ctx.S(), fd = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`, field = (l, ...x) => h('div', { class: 'field' }, h('label', {}, l), ...x);
const first = (f) => (f.nick || f.name).split(' ')[0];
const tm = (sl) => `${X.fmtSlotT(sl.start)}–${X.fmtSlotT(sl.end)}`, nextDay = (sl) => sl.end > 1440 ? h('span', { class: 'x-next', title: 'ends the next day' }, '+1') : null;
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
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
  const s = S(), r = X.pollResult(p), fr = p.who.map(id => s.friends?.[id]).filter(Boolean), today = keyOf(new Date());
  return h('div', { class: `poll ${p.status === 'closed' ? 'closed' : ''}` }, h('div', { class: 'row' }, h('b', { class: 'grow' }, p.title), r.everyone ? h('span', { class: 'chip sel' }, 'everyone can') : r.noneFit ? h('span', { class: 'chip late' }, 'no common time') : h('span', { class: 'chip' }, `${r.answered.length}/${p.who.length} answered`)),
    p.slots.map((sl, i) => h('div', { class: `poll-slot ${p.chosen === i ? 'chosen' : r.best === i && p.chosen < 0 ? 'best' : ''} ${sl.date < today ? 'x-past' : ''}` }, h('div', { class: 'grow' }, h('b', {}, fd(fromKey(sl.date))), ' ', h('span', { class: 'dim' }, tm(sl)), nextDay(sl), r.counts[i].length ? h('span', { class: 'x-yes tiny' }, ` · ${r.counts[i].length} yes`) : null),
      h('div', { class: 'chips' }, fr.map(f => h('button', { class: `chip ${(p.votes[f.id] || []).includes(i) ? 'sel' : ''}`, 'aria-pressed': String((p.votes[f.id] || []).includes(i)), 'aria-label': `${first(f)} ${(p.votes[f.id] || []).includes(i) ? 'can' : 'not yet'} ${fd(fromKey(sl.date))}`, onClick: () => ctx.update(x => { const cur = x.polls[p.id].votes[f.id] || [], next = cur.includes(i) ? cur.filter(n => n !== i) : [...cur, i]; return X.setVote(x, p.id, f.id, next); }) }, first(f)))),
      p.status === 'open' ? h('button', { class: 'btn sm ghost', onClick: () => ctx.update(x => X.savePoll(x, { ...x.polls[p.id], status: 'closed', chosen: i })) }, 'Pick') : null)),
    // Replies at a glance; tap someone who said none of these work (T08-28), tap again to undo. Friends with a yes can't be marked none.
    p.status === 'open' && fr.length ? h('div', { class: 'poll-replies' }, h('span', { class: 'tiny dim' }, 'Replies:'), fr.map(f => { const v = p.votes[f.id], none = Array.isArray(v) && !v.length, yes = Array.isArray(v) && v.length > 0;
      return h('button', { class: `chip ${none ? 'late' : yes ? 'sel' : 'ghost'}`, disabled: yes, 'aria-label': `${first(f)}: ${yes ? 'said yes to some' : none ? 'none of these work (tap to undo)' : 'not answered (tap if none work)'}`, onClick: () => ctx.update(x => none ? X.clearVote(x, p.id, f.id) : X.setVote(x, p.id, f.id, [])) }, `${first(f)} ${yes ? '✓' : none ? '✕ none' : '…'}`); })) : null,
    h('div', { class: 'row wrap', style: { marginTop: '6px' } }, p.status === 'open' ? h('button', { class: 'btn sm grow', onClick: () => sendPoll(p) }, 'Send on WhatsApp') : h('button', { class: 'btn sm grow', onClick: () => ctx.update(x => X.savePoll(x, { ...x.polls[p.id], status: 'open', chosen: -1 })) }, 'Reopen'),
      p.chosen >= 0 ? h('button', { class: 'btn sm', onClick: () => planIt(p, r) }, 'Plan it') : null, h('button', { class: 'btn sm ghost', 'aria-label': `Delete poll ${p.title}`, onClick: () => { if (confirm('Delete this poll?')) ctx.update(x => X.deletePoll(x, p.id)); } }, '🗑')));
}
/** Open the invite sheet on the slot that was picked (not a fresh guess), with the friends who said yes to it. */
function planIt(p, r) {
  const s = S(), sl = p.slots[p.chosen]; if (!sl) return; const alive = (ids) => ids.filter(id => s.friends?.[id]), yes = alive(r.counts[p.chosen] || []), who = yes.length ? yes : alive(p.who);
  SU.inviteSheet(who, { date: fromKey(sl.date), key: sl.date, window: [sl.start, sl.end], who, missing: [], all: true, unknownN: 0, dayLong: sl.end - sl.start >= 480 }, p.title);
}
function sendPoll(p) {
  const s = S(), fr = p.who.map(id => s.friends?.[id]).filter(Boolean), text = X.pollText(p, fr.map(first), (d) => fd(d), X.fmtSlotT);
  const box = ctx.sheet([h('h2', {}, 'Send the poll'), h('div', { class: 'small muted' }, 'One message per friend, or copy it for a group chat.'), h('pre', { class: 'poll-text' }, text),
    h('div', { class: 'list' }, fr.map(f => { const u = F.waWith(f, text); return u ? h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener' }, `WhatsApp ${first(f)}`) : h('span', { class: 'btn ghost', style: { opacity: .5 } }, `${first(f)}: no number saved`); })),
    h('button', { class: 'btn grow', onClick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy', 'err'); } } }, 'Copy for a group chat')]);
}
function pollSheet() {
  const s = S(), fr = F.friendList(s), sel = new Set(); let slots = []; if (!fr.length) return toast('Add some friends first', 'err');
  const title = h('input', { value: 'Dinner', placeholder: 'What for?' }), list = h('div', { class: 'x-slots' }), who = h('div', { class: 'chips' }, fr.map(f => h('button', { class: 'chip', 'aria-pressed': 'false', onClick: (e) => { sel.has(f.id) ? sel.delete(f.id) : sel.add(f.id); e.currentTarget.classList.toggle('sel', sel.has(f.id)); e.currentTarget.setAttribute('aria-pressed', String(sel.has(f.id))); suggest(); } }, first(f))));
  const today = keyOf(new Date()), date = h('input', { type: 'date', value: today, min: today }), st = h('input', { type: 'time', value: '20:00', onInput: () => hint() }), en = h('input', { type: 'time', value: '22:00', onInput: () => hint() }), hm = (v) => { const [a, b] = String(v || '').split(':').map(Number); return a * 60 + b; };
  const late = h('div', { class: 'tiny dim x-hint' }), hint = () => { late.textContent = en.value && st.value && hm(en.value) < hm(st.value) ? `Ends the next day at ${en.value}` : ''; };
  const add = (x) => { const r = X.addSlot(slots, x); if (r.error) { toast(r.error, 'err'); return false; } slots = r.slots; paint(); return true; };
  const paint = () => { list.replaceChildren(...(slots.length ? slots.map((x) => h('div', { class: 'row x-slot' }, h('div', { class: 'grow small' }, h('b', {}, fd(fromKey(x.date))), ' ', tm(x), nextDay(x)), h('button', { class: 'btn sm ghost', 'aria-label': `Remove ${fd(fromKey(x.date))} ${tm(x)}`, onClick: () => { slots = slots.filter(y => y !== x); paint(); } }, '✕'))) : [h('div', { class: 'tiny dim' }, 'No options yet — tap a suggestion or add a time below.')])); paintSugg(); };
  // suggestions toggle: a second tap removes the option instead of adding it twice
  const sugg = h('div', { class: 'chips' }); let found = [];
  const slotOf = (m) => ({ date: keyOf(m.date), start: m.window[0], end: Math.min(m.window[1], m.window[0] + 180) }), same = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end;
  const paintSugg = () => sugg.replaceChildren(...found.map(m => { const x = slotOf(m), on = slots.some(y => same(y, x)); return h('button', { class: `chip ${on ? 'sel' : ''}`, 'aria-pressed': String(on), onClick: () => { if (on) { slots = slots.filter(y => !same(y, x)); paint(); } else add(x); } }, `${fd(m.date)} ${X.fmtSlotT(m.window[0])}`); }));
  const suggest = () => { const ids = [...sel]; found = ids.length ? F.meetups(s, { ids, busyOf: ctx.busyOf, days: 21 }).slice(0, 4).sort((a, b) => a.date - b.date || a.window[0] - b.window[0]) : []; paintSugg(); };
  const box = ctx.sheet([h('h2', {}, 'New time poll'), field('What for?', title), h('div', { class: 'title' }, 'Who'), who, h('div', { class: 'tiny dim', style: { margin: '10px 0 4px' } }, 'Times when you and the people you picked are all free'), sugg,
    h('div', { class: 'title', style: { marginTop: '10px' } }, 'Options'), list, h('div', { class: 'row wrap x-add' }, field('Day', date), field('From', st), field('To', en), h('button', { class: 'btn', onClick: () => add({ date: date.value, start: hm(st.value), end: hm(en.value) }) }, 'Add')), late,
    h('button', { class: 'btn primary', onClick: () => { if (!sel.size) return toast('Pick at least one friend', 'err'); if (!slots.length) return toast('Add at least one option', 'err'); ctx.update(x => X.savePoll(x, { title: title.value, slots, who: [...sel] })); box.close(); ctx.render(); } }, 'Create poll')]);
  paint();
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
  const s = S(), l = X.treatList(s).slice(0, 6), n = X.treatNudge(s), today = keyOf(new Date());
  const head = !n ? null : n.last ? h('b', {}, n.since === 0 ? 'Brought something today' : `${days(n.since)} since the last treat`) : h('b', {}, 'First treat planned');
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Team treats'), h('button', { class: 'btn sm', onClick: () => treatSheet() }, '＋ Log')),
    n ? h('div', { class: `cr-key ${n.due ? 'soon' : ''}` }, h('div', { class: 'grow' }, head, h('div', { class: 'tiny dim' }, [n.last ? `Your usual gap is about ${days(n.usual)}` : '', n.next ? `next: ${n.next.what} ${n.nextIn === 1 ? 'tomorrow' : `in ${days(n.nextIn)}`}` : '', n.spent ? `${Math.round(n.spent)} SAR this month` : ''].filter(Boolean).join(' · '))), n.due ? h('span', { class: 'chip late' }, 'due') : null) : h('div', { class: 'small muted' }, 'Log the food or gifts you bring for the team and it reminds you when it has been a while.'),
    l.map(t => h('div', { class: `row small ${t.date > today ? 'x-planned' : ''}` }, h('span', { class: 'ch-ic sm' }, '🍰'), h('div', { class: 'grow x-treat' }, h('div', { class: 'name' }, t.what, h('span', { class: 'dim' }, ` for ${t.for === 'The team' ? 'the team' : t.for}`)), h('div', { class: 'tiny dim' }, `${fd(fromKey(t.date))}${t.cost ? ` · ${Math.round(t.cost)} SAR` : ''}`)), t.date > today ? h('span', { class: 'chip x-plan' }, 'planned') : null, h('button', { class: 'btn sm ghost', 'aria-label': `Delete ${t.what}`, onClick: () => ctx.update(x => X.deleteTreat(x, t.id)) }, '✕'))));
}
function treatSheet() {
  const v = { date: keyOf(new Date()), what: '', for: 'The team', cost: 0 }, I = (k, p = {}) => h('input', { value: v[k], ...p, onInput: (e) => { v[k] = p.type === 'number' ? +e.target.value : e.target.value; } });
  const box = ctx.sheet([h('h2', {}, 'Log a treat'), field('What', I('what', { placeholder: 'Kunafa, coffee, a gift…' })), field('For', I('for')), h('div', { class: 'row wrap' }, field('Date', I('date', { type: 'date' })), field('Cost (SAR)', I('cost', { type: 'number', inputmode: 'numeric', min: 0 }))), h('div', { class: 'tiny dim' }, 'A future date saves it as planned.'),
    h('button', { class: 'btn primary', onClick: () => { if (!String(v.what || '').trim()) return toast('What did you bring?', 'err'); ctx.update(x => X.saveTreat(x, v)); box.close(); ctx.render(); } }, 'Save')]);
}

// ───────── nudges for the Overview
export function nudgeRows() {
  const s = S(), now = new Date(), out = [], bd = X.rotaBirthdays(s, now, 21).slice(0, 3), all = X.contractEnds(s, now, 45), ce = all.slice(0, 3), tn = X.treatNudge(s), tk = keyOf(now);
  for (const b of bd) out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '🎂'), h('div', { class: 'grow' }, h('div', { class: 'name' }, b.name), h('div', { class: 'tiny dim' }, b.inDays === 0 ? 'Birthday today' : `Birthday in ${days(b.inDays)} (${fd(b.date)})`))));
  for (const c of ce) {
    const f = c.friend ? F.friendList(s).find(x => x.rotaKey === c.key) : null, last = c.lastShift ? (keyOf(c.lastShift) === tk ? 'Last shift today' : `Last shift ${fd(c.lastShift)}`) : '';
    const when = c.inDays < 0 ? `contract ended ${fd(c.date)} (${days(-c.inDays)} ago)` : c.inDays === 0 ? 'contract ends today' : `contract ends ${fd(c.date)} · in ${days(c.inDays)}`;
    out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '📄'), h('div', { class: 'grow' }, h('div', { class: 'name' }, f ? F.shortName(f) : c.name), h('div', { class: 'tiny dim' }, last && c.inDays >= 0 ? `${last} · ${when}` : when[0].toUpperCase() + when.slice(1))),
      f && c.inDays >= 0 ? h('button', { class: 'btn sm', onClick: () => SU.inviteSheet([f.id], null, `Farewell for ${F.shortName(f)}`) }, 'Plan') : null));
  }
  if (all.length > ce.length) out.push(h('div', { class: 'tiny dim x-more' }, `+${all.length - ce.length} more nurse contract end${all.length - ce.length === 1 ? '' : 's'} in the next 45 days`));
  if (tn?.due) out.push(h('div', { class: 'row nudge' }, h('span', { class: 'ch-ic sm' }, '🍰'), h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Treat for the team?'), h('div', { class: 'tiny dim' }, `${days(tn.since)} since the last one (usually every ${tn.usual})`))));
  return out;
}
