// Saudi labor-law checks. Run: node test/labor.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as L from '../docs/js/labor.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const days = {}; for (const d of [1, 2, 3, 4, 5]) days[d] = 'D'; for (const d of [8, 9, 10, 11, 12, 13, 14]) days[d] = 'D'; for (const d of [15, 16, 17, 18]) days[d] = 'D'; days[22] = 'N'; days[23] = 'N'; days[29] = 'X'; days[30] = 'VL';
const hrs = (s, e, o = false) => ({ start: s, end: e, overnight: o, durationMin: (o ? e + 1440 - s : e - s) });
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, true) }, X: { hours: hrs(480, 1320) }, VL: { desc: 'Annual leave' } }, people: [{ name: 'Dr Me', id: '1', days }] };
const s = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, settings: {} };
await t('weekly overtime: 5×12h is 60h, 12h over the 48h limit; counts only whole weeks', () => {
  const r = L.checkMonth(s, 2026, 11), w1 = r.weeks.find(w => w.start === '2026-11-01'); assert.equal(w1.hours, 60); assert.equal(w1.over, 12); assert.ok(w1.restOk);
  assert.equal(r.weeks.find(w => w.start === '2026-11-15').over, 0, '4×12h = 48h is legal');
});
await t('seven days in a row breaks the weekly-rest rule', () => { const r = L.checkMonth(s, 2026, 11); assert.equal(r.weeks.find(w => w.start === '2026-11-08').restOk, false); assert.ok(r.findings.some(f => f.rule === 'rest' && f.date === '2026-11-08')); assert.equal(r.level, 'violation'); });
await t('a 14h day is flagged against the 12h limit; a 12h day is only info', () => {
  const r = L.checkMonth(s, 2026, 11); assert.ok(r.findings.some(f => f.rule === 'span' && f.date === '2026-11-29' && f.level === 'violation')); const d = r.findings.find(f => f.rule === 'daily' && f.date === '2026-11-02'); assert.equal(d.level, 'info');
});
await t('overnight shifts are split across the week boundary and never double counted', () => { const r = L.checkMonth(s, 2026, 11); assert.equal(r.weeks.find(w => w.start === '2026-11-22').hours, 24); });
await t('totals: overtime hours, compensatory leave at 1.5h per hour, pay only with a wage', () => {
  let r = L.checkMonth(s, 2026, 11); assert.equal(r.totals.overtimeH, 48); assert.equal(r.totals.compLeaveH, 72); assert.equal(r.totals.otPay, null);
  r = L.checkMonth(s, 2026, 11, { ...L.DEFAULTS, wage: 12000 }); assert.equal(r.totals.otPay, Math.round(48 * 50 * 1.5), 'basic 12000 ÷ 240 = 50/h');
});
await t('Ramadan cuts the weekly limit to 36h for Muslims only', () => {
  const on = { ...L.DEFAULTS, muslim: true, ramadan: ['2026-11-15', '2026-11-21'] }, r = L.checkMonth(s, 2026, 11, on); const w = r.weeks.find(w => w.start === '2026-11-15'); assert.equal(w.cap, 36); assert.equal(w.over, 12); assert.ok(r.findings.some(f => f.rule === 'ramadan'));
  assert.equal(L.checkMonth(s, 2026, 11, { ...on, muslim: false }).weeks.find(w => w.start === '2026-11-15').cap, 48);
});
await t('public holidays: fixed dates plus the ones you add; working one is flagged', () => {
  assert.ok(L.isHoliday(L.DEFAULTS, new Date(2026, 8, 23))); assert.ok(!L.isHoliday(L.DEFAULTS, new Date(2026, 10, 3)));
  const r = L.checkMonth(s, 2026, 11, { ...L.DEFAULTS, holidays: ['2026-11-03'] }); assert.ok(r.findings.some(f => f.rule === 'holiday' && f.date === '2026-11-03'));
});
await t('annual leave: 21 days, 30 after five years; counts leave in the current leave year', () => {
  const now = new Date(2026, 10, 30); const a = L.leaveStatus(s, now, { ...L.DEFAULTS, hire: '2023-03-01' }); assert.equal(a.entitled, 21); assert.equal(a.used, 1); assert.equal(a.left, 20); assert.equal(a.next5, '2028-03-01');
  assert.equal(L.leaveStatus(s, now, { ...L.DEFAULTS, hire: '2018-01-10' }).entitled, 30); assert.equal(L.leaveStatus(s, now, { ...L.DEFAULTS }), null);
});
console.log(fails ? `${fails} FAILED` : 'labor ok'); process.exit(fails ? 1 : 0);
