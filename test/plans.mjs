// Month report, leave planner and swap finder on a synthetic rota. Run: node test/plans.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as P from '../docs/js/plans.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const me = {}, ann = {}, bo = {}; for (let d = 1; d <= 30; d++) { me[d] = d % 3 === 0 ? '' : 'D1'; ann[d] = d % 3 === 0 ? 'D1' : ''; bo[d] = 'D1'; } me[10] = 'N1'; ann[10] = '';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' }, VL: { desc: 'Leave' } }, people: [{ name: 'Dr Me', id: '1', days: me }, { name: 'Dr Ann', id: '2', days: ann }, { name: 'Dr Bo', id: '3', days: bo }] };
const s = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, settings: {}, jobs: { j: { id: 'j', status: 'current', start: '2025-01-01', basic: 6000, leave: 25, hoursWeek: 48 } } };
await t('month report: counts, hours, nights, weekend work, longest run', () => { const r = P.monthReport(s, 2026, 11); assert.equal(r.work, 20); assert.equal(r.nights, 1); assert.equal(r.hours, 240); assert.ok(r.longestStreak >= 2); assert.equal(r.basic, 6000); assert.ok(r.weekend >= 1); assert.equal(r.work + r.off + r.leave, 30); });
await t('leave planner: calendar days are billed; shifts covered counted; entitlement left', () => {
  const e = P.evalLeave(s, new Date(2026, 10, 2), new Date(2026, 10, 8), new Date(2026, 10, 1)); assert.equal(e.days, 7); assert.equal(e.billable, 7); assert.equal(e.covered, 5, '2..8 minus the off days 3,6'); assert.equal(e.noticeBy, '2026-10-03'); assert.equal(e.leftAfter, 25 - 7); assert.ok(e.enough);
  assert.equal(P.evalLeave(s, new Date(2026, 10, 9), new Date(2026, 10, 1)), null);
});
await t('best windows: ranked by shifts replaced, non-overlapping', () => { const w = P.bestWindows(s, 3, { now: new Date(2026, 9, 31), horizon: 25, top: 3 }); assert.ok(w.length >= 2); assert.ok(w[0].covered >= w[w.length - 1].covered); for (let i = 1; i < w.length; i++) assert.ok(Math.abs(new Date(w[i].from) - new Date(w[i - 1].from)) >= 3 * 864e5); });
await t('swap finder: only colleagues who are off that day and work on a day I am off', () => {
  const r = P.swapOptions(s, new Date(2026, 10, 4), { now: new Date(2026, 10, 1) }); assert.equal(r.options.length, 1, 'Ann is off on 4 and works on my off days; Bo works that day'); assert.equal(r.options[0].person.name, 'Dr Ann'); assert.ok(r.options[0].gives.length >= 1); assert.ok(r.options[0].gives.every(g => new Date(g.date).getDate() % 3 === 0));
  assert.deepEqual(P.swapOptions(s, new Date(2026, 10, 3), { now: new Date(2026, 10, 1) }).options, [], 'nothing to hand over on a day off');
});
await t('planned leave is written as corrections, counted as leave, and can be cleared', () => {
  const r = P.applyLeave(s, new Date(2026, 10, 12), new Date(2026, 10, 14), 1); assert.equal(r.days, 3); assert.equal(r.state.swaps['2026-11-12'].code, 'VL'); assert.equal(Object.keys(s.swaps || {}).length, 0, 'original state untouched');
  const rep = P.monthReport(r.state, 2026, 11); assert.equal(rep.leave, 3); assert.ok(rep.work < P.monthReport(s, 2026, 11).work);
  const c = P.clearLeave(r.state, new Date(2026, 10, 12), new Date(2026, 10, 14)); assert.equal(Object.keys(c.swaps).length, 0); assert.ok(c.deleted['swap:2026-11-12']);
});
console.log(fails ? `${fails} FAILED` : 'plans ok'); process.exit(fails ? 1 : 0);
