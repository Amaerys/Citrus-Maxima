// Polls, wishlist, treats, rota birthdays, contract ends. Run: node test/extras.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as X from '../docs/js/extras.js'; import * as F from '../docs/js/social.js'; import { mergeStates } from '../docs/js/store.js';
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
await t('merge keeps polls, wishlist and treats from both devices', () => { const a = X.saveWish({ polls: {}, wishlist: {}, treats: {} }, { id: 'w1', name: 'A' }), b = X.saveTreat({ polls: {}, wishlist: {}, treats: {} }, { id: 't1' }); const m = mergeStates(a, b); assert.ok(m.wishlist.w1); assert.ok(m.treats.t1); });
console.log(fails ? `${fails} FAILED` : 'extras ok'); process.exit(fails ? 1 : 0);
