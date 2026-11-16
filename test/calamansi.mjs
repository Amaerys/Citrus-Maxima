// Calamansi live: what Citrus reads from its status (chores, meals, shopping, fridge, bills, the briefing line). Run: node test/calamansi.mjs
import assert from 'node:assert/strict';
const KA = await import('../docs/js/calamansi.js');
const s = { apps: { calamansi: { app: 'calamansi', extra: { chores: [{ title: 'Laundry', icon: '🧺', late: 2, status: '2 days overdue' }, { title: 'Sheets', status: 'due in 3 days' }, { nope: 1 }],
  meals: { today: [{ slot: 'dinner', label: 'Dinner', title: 'Air-fryer salmon', icon: '🐟', done: false }], tomorrow: [], batch: { date: '2099-01-02', title: 'Chicken rice', portions: 4 } },
  shopping: { open: 3, items: ['Eggs', 'Milk', 'Rice'] }, fridge: [{ name: 'Spinach', days: 1 }], bills: [{ title: 'Internet', due: '2099-01-05', amount: 300 }] } } } };
assert.ok(KA.live(s)); assert.ok(!KA.live({}));
assert.equal(KA.chores(s).length, 2); assert.equal(KA.todayLine(s), 'Due at home: Laundry');
assert.equal(KA.meals(s).today[0].title, 'Air-fryer salmon'); assert.equal(KA.meals(s).batch.portions, 4);
assert.deepEqual(KA.shopping(s), { open: 3, items: ['Eggs', 'Milk', 'Rice'] }); assert.equal(KA.fridge(s)[0].days, 1); assert.equal(KA.bills(s)[0].amount, 300);
assert.deepEqual(KA.chores({ apps: { calamansi: { extra: 'junk' } } }), []);
console.log('calamansi ok');
