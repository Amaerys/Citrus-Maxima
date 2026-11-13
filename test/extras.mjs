// Polls, wishlist, treats, rota birthdays, contract ends. Run: node test/extras.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as X from '../docs/js/extras.js'; import * as F from '../docs/js/social.js'; import { mergeStates } from '../docs/js/store.js'; import fs from 'node:fs'; import { parseRotaFile, serializeRota } from '../docs/js/rota-parser.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const slots = [{ date: '2026-11-12', start: 1200, end: 1380 }, { date: '2026-11-13', start: 1080, end: 1260 }, { date: 'bad', start: 1, end: 2 }];
await t('poll: bad slots dropped, votes only from invited friends, best slot = most yes, ties to the earlier', () => {
  let s = X.savePoll({}, { title: 'Dinner', slots, who: ['a', 'b', 'c'] }); const id = Object.keys(s.polls)[0]; assert.equal(s.polls[id].slots.length, 2);
  s = X.setVote(s, id, 'a', [0, 1]); s = X.setVote(s, id, 'b', [1]); s = X.setVote(s, id, 'zzz', [0]); assert.ok(!('zzz' in s.polls[id].votes)); let r = X.pollResult(s.polls[id]); assert.equal(r.best, 1); assert.deepEqual(r.waiting, ['c']); assert.ok(!r.everyone);
  s = X.setVote(s, id, 'c', [1, 5]); r = X.pollResult(s.polls[id]); assert.ok(r.everyone, 'all three said yes to slot 1; out-of-range vote ignored'); assert.deepEqual(s.polls[id].votes.c, [1]);
  s = X.savePoll({}, { slots: [slots[0], slots[1]], who: ['a', 'b'], votes: { a: [0], b: [1] } }); assert.equal(X.pollResult(Object.values(s.polls)[0]).best, 0, 'tie → earlier');
  assert.equal(X.savePoll({}, { slots: [{ date: 'x', start: 1, end: 2 }], who: ['a'] }).polls, undefined, 'no usable slots → nothing saved');
});
await t('poll text lists numbered options for WhatsApp', () => { const s = X.savePoll({}, { title: 'Dinner', slots, who: ['a'] }), tx = X.pollText(Object.values(s.polls)[0], ['Faisal'], (d) => d.getDate(), (m) => m / 60); assert.match(tx, /Hey Faisal! Dinner\?/); assert.match(tx, /1\) 12 20–23/); assert.match(tx, /2\) 13 18–21/); });
await t('wishlist: kinds, done moves it out, delete leaves a tombstone', () => {
  let s = X.saveWish({}, { name: 'Kabsa place', kind: 'food', url: 'javascript:x', city: 'Riyadh' }); const id = Object.keys(s.wishlist)[0]; assert.equal(s.wishlist[id].url, '', 'only http(s) links'); assert.equal(X.wishList(s).length, 1);
  s = X.saveWish(s, { ...s.wishlist[id], done: '2026-11-01' }); assert.equal(X.wishList(s).length, 0); assert.equal(X.wishList(s, true).length, 1); assert.equal(X.saveWish({}, { name: '  ' }).wishlist, undefined); const d = X.deleteWish(s, id); assert.ok(d.deleted[`wish:${id}`]);
});
await t('treats: nudge compares days since the last one with your own usual gap', () => {
  let s = {}; for (const d of ['2026-09-01', '2026-09-22', '2026-10-13']) s = X.saveTreat(s, { date: d, what: 'Kunafa', cost: 60 }); const n = X.treatNudge(s, new Date(2026, 10, 9)); assert.equal(n.usual, 21); assert.equal(n.since, 27); assert.ok(n.due);
  assert.ok(!X.treatNudge(s, new Date(2026, 9, 20)).due); assert.equal(X.treatNudge({}), null); assert.equal(X.treatNudge(s, new Date(2026, 9, 20)).spent, 60);
});
await t('rota birthdays come from saved contacts; friends are not listed twice; year wraps', () => {
  const rota = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: {}, people: [{ name: 'Dr Ann', id: '2', days: {} }, { name: 'Dr Bo', id: '3', days: {} }] };
  let s = { rotas: { gp: rota }, me: { id: '1' }, contacts: {}, friends: {} }; s = F.setContact(s, 'id:2', { birthday: '1990-11-12' }); s = F.setContact(s, 'id:3', { birthday: '01-03' });
  const b = X.rotaBirthdays(s, new Date(2026, 10, 9), 90); assert.equal(b[0].name, 'Dr Ann'); assert.equal(b[0].inDays, 3); assert.equal(b[1].inDays, 55, 'Jan 3 next year'); assert.equal(X.rotaBirthdays(s, new Date(2026, 10, 9), 10).length, 1);
  const f = F.friendFromPerson(s, rota.people[0], 'id:2', 'work'); assert.equal(X.rotaBirthdays(f, new Date(2026, 10, 9), 90).filter(x => x.key === 'id:2').length, 0, 'now a friend: the friend list owns the birthday');
});
await t('nurses: END OF CONTRACT in the schedule becomes a reminder', () => {
  const n = { id: 'nurse-2026-11', unitKind: 'nurse', year: 2026, month: 11, daysInMonth: 30, legend: {}, people: [{ name: 'Nurse A', id: '9', days: { 28: 'END OF CONTRACT' } }, { name: 'Nurse B', id: '8', days: { 3: 'D' } }] };
  const e = X.contractEnds({ rotas: { n } }, new Date(2026, 10, 9), 60); assert.equal(e.length, 1); assert.equal(e[0].inDays, 19); assert.equal(X.contractEnds({ rotas: { n } }, new Date(2026, 10, 9), 10).length, 0);
});
await t('merge keeps polls, wishlist and treats from both devices', () => { const a = X.saveWish({ polls: {}, wishlist: {}, treats: {} }, { id: 'w1', name: 'A' }), b = X.saveTreat({ polls: {}, wishlist: {}, treats: {} }, { id: 't1', what: 'Cake' }); const m = mergeStates(a, b); assert.ok(m.wishlist.w1); assert.ok(m.treats.t1); });

// ───────── beta fixes (T04-02, T08-06/07/20/21)
await t('contract end: one reminder per nurse = the first END OF CONTRACT day, with the last shift before it', () => {
  const legend = { D: { code: 'D', hours: { start: 480, end: 1200 } }, 'END OF CONTRACT': { code: 'END OF CONTRACT', desc: 'Contract ended' } };
  const n = { id: 'nurse-2026-11', unitKind: 'nurse', year: 2026, month: 11, daysInMonth: 30, legend, people: [{ name: 'Nurse Made Up', id: '9', days: { 21: 'D', 23: 'D', 24: 'END OF CONTRACT', 25: 'END OF CONTRACT', 26: 'END OF CONTRACT', 30: 'END OF CONTRACT' } }] };
  const dec = { ...n, id: 'nurse-2026-12', month: 12, daysInMonth: 31, people: [{ name: 'Nurse Made Up', id: '9', days: { 1: 'END OF CONTRACT', 2: 'END OF CONTRACT' } }] };
  const e = X.contractEnds({ rotas: { n, dec } }, new Date(2026, 10, 13), 60); assert.equal(e.length, 1, 'one row, not one per cell or per month'); assert.equal(e[0].date.getDate(), 24); assert.equal(e[0].inDays, 11); assert.equal(e[0].lastShift.getDate(), 23);
  assert.equal(X.contractEnds({ rotas: { n } }, new Date(2026, 10, 29), 60).length, 0, 'after the first day + 3, it is old news even though later cells still say END');
  const fr = X.contractEnds({ rotas: { n: { ...n, people: [...n.people, { name: 'Nurse Friend', id: '7', days: { 30: 'END OF CONTRACT' } }] } }, friends: { f: { id: 'f', name: 'Nurse Friend', rotaKey: 'id:7' } } }, new Date(2026, 10, 13), 60);
  assert.equal(fr[0].name, 'Nurse Friend', 'friends first'); assert.ok(fr[0].friend);
});
const nurseFile = new URL('./data/nurses.xlsx', import.meta.url).pathname;
if (fs.existsSync(nurseFile)) await t('real nurse sheet: every nurse with END OF CONTRACT appears exactly once', async () => {
  const buf = fs.readFileSync(nurseFile), r = serializeRota(await parseRotaFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'QID-Nov.26_Schedule.xlsx'));
  const withEnd = r.people.filter(p => Object.values(p.days || {}).some(v => /END OF CONTRACT/i.test(v))), e = X.contractEnds({ rotas: { [r.id]: r } }, new Date(2026, 10, 13), 60);
  assert.ok(withEnd.length >= 1); assert.equal(e.length, withEnd.length); assert.equal(new Set(e.map(x => x.key)).size, e.length);
  for (const x of e) { assert.ok(x.lastShift && x.lastShift < x.date, 'last shift before the end'); }
});
await t('poll options: deduped, sorted, past rejected, after-midnight end allowed', () => {
  const now = new Date(2026, 10, 13, 9, 30); let r = X.addSlot([], { date: '2026-11-14', start: 1200, end: 1320 }, now); assert.ok(r.slots);
  r = X.addSlot(r.slots, { date: '2026-11-13', start: 1080, end: 1200 }, now); assert.deepEqual(r.slots.map(x => x.date), ['2026-11-13', '2026-11-14'], 'sorted');
  assert.match(X.addSlot(r.slots, { date: '2026-11-14', start: 1200, end: 1320 }, now).error, /already/); assert.match(X.addSlot([], { date: '2026-11-01', start: 1200, end: 1320 }, now).error, /passed/);
  assert.match(X.addSlot([], { date: '2026-11-13', start: 360, end: 480 }, now).error, /passed/, 'earlier today');
  const late = X.addSlot([], { date: '2026-11-13', start: 1380, end: 60 }, now); assert.deepEqual(late.slots[0], { date: '2026-11-13', start: 1380, end: 1500 }); assert.equal(X.fmtSlotT(1500), '01:00'); assert.equal(X.fmtSlotT(1440), '24:00');
  let s = X.savePoll({}, { slots: [{ date: '2026-11-15', start: 1200, end: 1300 }, { date: '2026-11-14', start: 1380, end: 1500 }, { date: '2026-11-15', start: 1200, end: 1300 }], who: ['a'] }); const p = Object.values(s.polls)[0];
  assert.deepEqual(p.slots.map(x => x.date), ['2026-11-14', '2026-11-15'], 'new poll: deduped + sorted; after-midnight slot kept');
  s = X.setVote(s, p.id, 'a', [1]); assert.deepEqual(Object.values(s.polls)[0].votes.a, [1], 'existing poll keeps slot order so votes stay put');
  assert.match(X.pollText(p, ['A'], (d) => d.getDate(), X.fmtSlotT), /1\) 14 23:00–01:00/);
});
await t('treats: future ones are plans (no negative "since"), a blank one is not saved', () => {
  let s = {}; for (const d of ['2026-10-01', '2026-10-22']) s = X.saveTreat(s, { date: d, what: 'Kunafa' }); s = X.saveTreat(s, { date: '2026-12-25', what: 'Cake' });
  const n = X.treatNudge(s, new Date(2026, 10, 13)); assert.equal(n.since, 22); assert.equal(n.usual, 21); assert.equal(n.next.what, 'Cake'); assert.equal(n.nextIn, 42); assert.ok(!n.due, 'one is already planned');
  assert.equal(X.saveTreat({}, { what: '  ' }).treats, undefined); const only = X.treatNudge(X.saveTreat({}, { date: '2026-12-25', what: 'Cake' }), new Date(2026, 10, 13)); assert.equal(only.since, null); assert.ok(!only.due);
});
await t('poll: "none of these work" replies make "no common time" possible, and can be undone (T08-28)', () => {
  let s = X.savePoll({}, { title: 'D', slots: [{ date: '2026-12-01', start: 1200, end: 1300 }], who: ['a', 'b'] }); const id = Object.keys(s.polls)[0];
  s = X.setVote(s, id, 'a', []); s = X.setVote(s, id, 'b', []); assert.ok(X.pollResult(s.polls[id]).noneFit); s = X.clearVote(s, id, 'b'); assert.deepEqual(X.pollResult(s.polls[id]).waiting, ['b']);
});
console.log(fails ? `${fails} FAILED` : 'extras ok'); process.exit(fails ? 1 : 0);
