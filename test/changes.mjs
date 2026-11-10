// Schedule update briefs. Run: node test/changes.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as RC from '../docs/js/changes.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const hrs = (a, b, o) => ({ start: a, end: b, overnight: !!o, durationMin: o ? b + 1440 - a : b - a });
const legend = { D: { hours: hrs(480, 1200), desc: 'Day' }, N: { hours: hrs(1200, 480, 1), desc: 'Night' }, E: { hours: hrs(780, 1320), desc: 'Evening' } };
const mk = (o) => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, o[i + 1] ?? 'D']));
const rota = (people) => ({ id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people, sourceName: 'v.xlsx' });
const prev = rota([{ name: 'Dr Me', id: '1', days: mk({ 12: 'D', 20: 'N', 3: 'D' }) }, { name: 'Dr Ann', id: '2', days: mk({ 12: 'D' }) }, { name: 'Dr Bo', id: '3', days: mk({ 12: '' }) }, { name: 'Dr Gone', id: '9', days: mk({}) }]);
const next = rota([{ name: 'Dr Me', id: '1', days: mk({ 12: 'D', 20: '', 3: 'N' }) }, { name: 'Dr Ann', id: '2', days: mk({ 12: '' }) }, { name: 'Dr Bo', id: '3', days: mk({ 12: 'E' }) }, { name: 'Dr New', id: '7', days: mk({}) }]);
const s = { me: { id: '1', name: 'Dr Me' }, friends: { f: { id: 'f', name: 'Ann A', nick: 'Ann', rotaKey: 'id:2' } }, rotas: { gp: prev } };
const d = RC.diffRota(s, prev, next, new Date(2026, 10, 10));
await t('my changes, ahead vs already past', () => { assert.equal(d.mine.length, 2); const n20 = d.mine.find(c => c.day === 20); assert.ok(n20.ahead); assert.match(n20.from, /^Night 20:00–08:00/); assert.equal(n20.to, 'Off'); assert.ok(!d.mine.find(c => c.day === 3).ahead); });
await t('who works with me: Ann left the 12th, Bo (evening, overlaps 7h) joined', () => { const x = d.withMe.find(w => w.day === 12); assert.deepEqual(x.joined, ['Bo']); assert.deepEqual(x.left, ['Ann']); assert.ok(!d.withMe.some(w => w.day === 3), 'past days not reported'); assert.ok(!x.mine);
  const off2on = RC.diffRota(s, rota([{ name: 'Dr Me', id: '1', days: mk({ 15: '' }) }, { name: 'Dr Ann', id: '2', days: mk({}) }]), rota([{ name: 'Dr Me', id: '1', days: mk({ 15: 'D' }) }, { name: 'Dr Ann', id: '2', days: mk({}) }]), new Date(2026, 10, 10)); const w15 = off2on.withMe.find(w => w.day === 15); assert.ok(w15.mine && w15.count === 1, 'my own new shift: summarised, not counted as colleague changes'); assert.doesNotMatch(RC.headline(off2on), /who works with you/); });
await t('friends separated from everyone else; added and removed people', () => { assert.equal(d.friends.length, 1); assert.equal(d.friends[0].friend, 'Ann'); assert.equal(d.others[0].name, 'Bo'); assert.deepEqual(d.added, ['New']); assert.deepEqual(d.removed, ['Gone']); assert.equal(d.total, 4); assert.equal(d.people, 3); });
await t('headline reads well', () => { const h = RC.headline(d); assert.match(h, /^1 of your shifts changed/); assert.match(h, /in who works with you/); assert.match(h, /1 friend affected/); assert.match(h, /4 changes across 3 people/); });
await t('identical upload records nothing; history capped at 30, newest first; seen + merge', () => {
  assert.equal(RC.recordChanges(s, RC.diffRota(s, prev, prev)), s);
  let st = s; for (let i = 0; i < 35; i++) st = RC.recordChanges(st, { ...d, at: 1000 + i }); assert.equal(RC.changeList(st).length, 30); assert.equal(RC.changeList(st)[0].at, 1034);
  const id = RC.changeList(st)[0].id; st = RC.markSeen(st, [id]); assert.equal(RC.unseen(st).length, 29);
  const m = mergeStates({ ...st, rotaChanges: {} }, st); assert.equal(Object.keys(m.rotaChanges).length, 30); assert.ok(m.rotaChanges[id].seen);
});
await t('nurse schedule: no "your shifts" (you are not in it), friends still tracked', () => { const nr = { ...prev, id: 'nurse-2026-11', unitKind: 'nurse' }, nn = { ...next, id: 'nurse-2026-11', unitKind: 'nurse', people: next.people.filter(p => p.id !== '1') }; const x = RC.diffRota({ ...s, me: { id: 'zz' } }, nr, nn, new Date(2026, 10, 10)); assert.equal(x.mine.length, 0); assert.equal(x.friends.length, 1); });
console.log(fails ? `${fails} FAILED` : 'changes ok'); process.exit(fails ? 1 : 0);
