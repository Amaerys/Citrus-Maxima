// Mandarin live: its corrected days overlay Citrus's old corrections inside its window. Run: node test/mandarin.mjs
import assert from 'node:assert/strict';
const MD = await import('../docs/js/mandarin.js');
const s = { swaps: { '2026-11-10': { code: 'D1' }, '2026-11-20': { code: 'N1' }, '2026-10-01': { code: 'X' } }, apps: { mandarin: { app: 'mandarin', actions: [{ id: 'leave', url: 'https://x.test/#leave', label: 'Leave' }], _shifts: { days: [
  { date: '2026-11-10', kind: 'work', code: 'D2' }, { date: '2026-11-17', kind: 'work', code: 'D1', corrected: true }, { date: '2026-11-18', kind: 'off', code: '', corrected: true }, { date: '2026-11-20', kind: 'work', code: 'N2' }] } } } };
assert.ok(MD.live(s)); assert.ok(!MD.live({ apps: {} }));
const o = MD.withMandarin(s);
assert.equal(o.swaps['2026-11-17'].code, 'D1'); assert.equal(o.swaps['2026-11-18'].code, '');
assert.ok(!o.swaps['2026-11-10'] && !o.swaps['2026-11-20'], 'stale Citrus corrections inside the window go');
assert.equal(o.swaps['2026-10-01'].code, 'X', 'older history stays');
assert.equal(MD.withMandarin(s), o, 'memoised'); assert.equal(MD.withMandarin({ swaps: {} }).swaps && true, true);
assert.equal(MD.link(s, 'leave'), 'https://x.test/#leave'); assert.equal(MD.link(s, 'nope'), MD.SITE);
assert.deepEqual(MD.nextDays(s, new Date(2026, 10, 17), 2).map(d => d.date), ['2026-11-17', '2026-11-18']);
console.log('mandarin ok');
