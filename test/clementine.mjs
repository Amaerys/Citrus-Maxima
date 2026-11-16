// Clementine live: what Citrus reads from its status (dates, free tonight, coming up, the briefing line). Run: node test/clementine.mjs
import assert from 'node:assert/strict';
const CL = await import('../docs/js/clementine.js');
const s = { apps: { clementine: { app: 'clementine', extra: { birthdays: [{ name: 'Tess Example', label: 'birthday', birthday: true, inDays: 0, age: 30, date: '2099-01-01' }, { name: 'Bo Example', label: 'anniversary', inDays: 5 }, { bad: 1 }],
  freeTonight: [{ name: 'Tess', from: '18:00', to: '23:00' }], upcoming: [{ date: '2099-01-02', start: '19:30', what: 'Dinner', who: ['Tess', 'Bo'] }] } } } };
assert.ok(CL.live(s)); assert.ok(!CL.live({}));
assert.equal(CL.dates(s).length, 2); assert.equal(CL.dates(s)[0].name, 'Tess Example');
assert.equal(CL.todayLine(s), "Tess Example's birthday (30)");
assert.equal(CL.freeTonight(s)[0].to, '23:00'); assert.equal(CL.upcoming(s)[0].who, 'Tess, Bo');
assert.deepEqual(CL.dates({ apps: { clementine: { extra: 'junk' } } }), []);
console.log('clementine ok');
