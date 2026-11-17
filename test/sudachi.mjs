// Sudachi live: what Citrus reads from its status (week/month counts, now, pick, goals). Run: node test/sudachi.mjs
import assert from 'node:assert/strict';
const SD = await import('../docs/js/sudachi.js');
const s = { apps: { sudachi: { app: 'sudachi', extra: { week: { eps: 3, films: 1, played: 6 }, month: { eps: 9, books: 1 }, now: [{ kind: 'anime', title: 'Test Show', progress: 4, total: 12 }, { x: 1 }], pick: { kind: 'anime', title: 'Test Show', why: 'short after a night', minutes: 24 }, goals: { books: { done: 3, target: 12 }, films: { done: 0, target: 0 } } } } } };
assert.ok(SD.live(s)); assert.ok(!SD.live({}));
assert.equal(SD.countLine(SD.week(s)), '3 eps · 1 film · 6h played'); assert.equal(SD.countLine(SD.week({})), '');
assert.equal(SD.now(s).length, 1); assert.equal(SD.pick(s).minutes, 24); assert.deepEqual(SD.goals(s), [{ kind: 'books', done: 3, target: 12 }]);
console.log('sudachi ok');
// day-bound parts only count on the day the status was written (a status from yesterday shows no "free tonight" / pick / meals)
{ const CL = await import('../docs/js/clementine.js'), KA = await import('../docs/js/calamansi.js'), BG = await import('../docs/js/bergamot.js');
  const old = { today: { date: '2000-01-01' } };
  assert.equal(SD.pick({ apps: { sudachi: { ...old, extra: { pick: { title: 'X' } } } } }), null);
  assert.deepEqual(CL.freeTonight({ apps: { clementine: { ...old, extra: { freeTonight: [{ name: 'A', from: '1', to: '2' }] } } } }), []);
  assert.deepEqual(KA.meals({ apps: { calamansi: { ...old, extra: { meals: { today: [{ title: 'M' }] } } } } }).today, []);
  assert.equal(BG.journaledToday({ apps: { bergamot: { ...old, extra: { journaledToday: true } } } }), false);
  assert.equal(BG.tasks({ apps: { bergamot: { ...old, extra: { tasks: { today: 3 } } } } }).today, 0);
  console.log('stale day parts ok'); }
