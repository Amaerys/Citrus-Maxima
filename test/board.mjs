import assert from 'node:assert/strict'; import { overlapModel } from '../docs/js/board.js';
const e = (n, start, end, overnight) => ({ person: { name: n }, shift: { type: 'x', hours: { start, end, overnight } } });
const m = overlapModel(e('me', 480, 1020), [e('same', 480, 1020), e('eve', 780, 1320), e('night', 1260, 540, true), e('early', 360, 600)]);
assert.deepEqual(m.rows.map(r => r.entry.person.name), ['same', 'eve', 'early']);   // night barely touches 08:00 on the next day? it ends 09:00 next day, so no overlap
assert.equal(m.rows[0].pct, 1); assert.equal(m.rows[1].overlap, 240); assert.equal(m.rows[2].overlap, 120);
assert.deepEqual(m.alone, []); assert.equal(m.covered, 540);
const solo = overlapModel(e('me', 480, 1020), [e('eve', 900, 1320)]); assert.deepEqual(solo.alone, [[480, 900]]); assert.equal(solo.covered, 120);
const n = overlapModel(e('me', 1260, 540, true), [e('n2', 1260, 540, true), e('e', 780, 1320)]); assert.equal(n.rows[0].overlap, 720); assert.equal(n.rows[1].overlap, 60);
assert.equal(overlapModel({ shift: {} }, []), null); assert.deepEqual(overlapModel(e('me', 0, 60), []).rows, []);
console.log('board overlap ok');
