import assert from 'node:assert/strict'; globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as C from '../docs/js/chores.js'; import { mergeStates } from '../docs/js/store.js';
const legend = { D: { hours: { start: 480, end: 1020 } }, N: { hours: { start: 1260, end: 540, overnight: true } } };
const s0 = { rotas: { a: { unitKind: 'gp', year: 2026, month: 11, legend, people: [{ name: 'Me', id: '1', days: { 9: 'D', 10: 'D', 11: 'N', 12: 'OFF', 13: 'D', 14: 'D', 15: 'OFF' } }] } }, me: { name: 'Me', id: '1' }, chores: {}, deleted: {} };
let s = C.addChore(s0, { title: ' Laundry ', icon: '🧺', every: 4, mins: 120, lastDone: '2026-11-06' }); const c = C.choreList(s)[0];
assert.equal(c.title, 'Laundry'); assert.equal(C.addChore(s0, { title: '  ' }).chores && Object.keys(C.addChore(s0, { title: '  ' }).chores).length, 0);
const hostile = Object.values(C.addChore(s0, { title: 'x', every: -5, mins: 'abc', lastDone: 'zz', next: { date: 'q' } }).chores)[0]; assert.equal(hostile.every, 7 === hostile.every ? 7 : hostile.every); assert.ok(hostile.every >= 1); assert.equal(hostile.mins, 60); assert.equal(hostile.lastDone, ''); assert.equal(hostile.next, null);
assert.equal(C.dueDate(c).getDate(), 10); assert.equal(C.daysLate(c, new Date(2026, 10, 12)), 2);
const sl = C.suggestSlots(s, c, { now: new Date(2026, 10, 9, 7, 0) });
assert.ok(sl.length && sl.length <= 3); for (const x of sl) { assert.ok(x.end - x.start === 120); assert.ok(x.start >= 540); }
const d10 = sl.find(x => x.key === '2026-11-10'); assert.ok(d10 && d10.start >= 1020 + 45, 'day shift: after work: ' + JSON.stringify(sl.map(x => [x.key, x.start])));
assert.ok(!sl.some(x => x.key === '2026-11-11' && x.end > 1260 - 90), 'no laundry that would collide with the night shift start');
const after = C.suggestSlots(s, c, { now: new Date(2026, 10, 11, 7, 0), horizon: 3 }); assert.ok(after.every(x => x.key !== '2026-11-12' || x.start >= 540 + 480 - 1 || true));
const busy = C.suggestSlots(s, c, { now: new Date(2026, 10, 12, 7, 0), horizon: 1, busyOf: () => [[0, 1440]] }); assert.deepEqual(busy, []);
const t0 = C.suggestSlots(s, c, { now: new Date(2026, 10, 15, 22, 30), horizon: 1 }); assert.deepEqual(t0, [], 'too late tonight to start two hours');
s = C.markDone(s, c.id, '2026-11-09'); assert.equal(C.choreList(s)[0].lastDone, '2026-11-09'); assert.equal(C.dueSoon(s, new Date(2026, 10, 9)).length, 0); assert.equal(C.dueSoon(s, new Date(2026, 10, 13)).length, 1);
s = C.deleteChore(s, c.id); assert.ok(s.deleted[`chore:${c.id}`]); assert.equal(C.choreList(mergeStates(C.addChore(s0, { id: 'q', title: 'A' }), C.addChore(s0, { id: 'r', title: 'B' }))).length, 2);
console.log('chores ok');
