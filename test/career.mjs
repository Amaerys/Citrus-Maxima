// Career model (synthetic numbers, no real contract data). Run: node test/career.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as C from '../docs/js/career.js'; import * as L from '../docs/js/labor.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const job = { employer: 'Acme Clinics', status: 'current', start: '2025-01-01', end: '2027-01-01', basic: 6000, housing: 1500, transport: 500, other: 0, leave: 25, hoursWeek: 48, renewNoticeDays: 90, renews: true, trialDays: 90 };
const now = new Date(2026, 0, 1); let s = C.saveJob({ jobs: {} }, job); const cur = C.currentJob(s);
await t('save, clean and find the current job; total package', () => { assert.equal(cur.employer, 'Acme Clinics'); assert.equal(C.total(cur), 8000); assert.equal(C.saveJob({ jobs: {} }, { ...job, basic: -5, leave: 'x' }).jobs && Object.values(C.saveJob({ jobs: {} }, { ...job, basic: -5 }).jobs)[0].basic, 0); });
await t('end-of-service: half a month per year for 5 years, resign factors by length of service', () => {
  const e = C.endOfService(cur, now); assert.ok(Math.abs(e.years - 1) < 0.01); assert.ok(Math.abs(e.onTotal - 4000) < 40); assert.equal(e.resignFactor, 0, 'under 2 years: nothing on resignation');
  const e7 = C.endOfService({ ...cur, start: '2019-01-01' }, now); assert.ok(Math.abs(e7.months - (2.5 + 2)) < 0.02, 'five half-months then full months: 7y = 2.5+2'); assert.equal(e7.resignFactor, 2 / 3);
});
await t('key dates: renewal-notice deadline is 90 days before the end; trial period; countdown', () => {
  const k = C.keyDates(cur, now), r = k.find(x => x.id === 'renew'); assert.equal(r.date, '2026-10-03'); assert.equal(k.find(x => x.id === 'trial').date, '2025-04-01'); assert.equal(k.find(x => x.id === 'end').days, 365);
  assert.equal(C.upcoming(cur, new Date(2026, 8, 20), 30).map(x => x.id).join(), 'renew');
});
await t('hourly value and overtime rate as the contract words it', () => { assert.equal(C.overtimeRate(cur), 37.5, '6000/240×1.5'); const w = 52 - 25 / 7; assert.equal(C.hourly(cur), Math.round(96000 / (48 * w) * 10) / 10); });
await t('flags: low leave, long hours, rejected on Qiwa, low basic share', () => {
  const f = C.flags({ ...cur, leave: 15, hoursWeek: 60, qiwa: 'Rejected by employee', basic: 1500 }).map(x => x.msg).join('|'); assert.match(f, /below the legal minimum/); assert.match(f, /48h limit/); assert.match(f, /rejected/); assert.match(f, /Basic is only/);
});
await t('labor check takes leave days, hours and wage from the current contract; hand settings win', () => {
  const cfg = L.settings({ ...s, settings: {} }); assert.equal(cfg.hire, '2025-01-01'); assert.equal(cfg.wage, 6000); assert.equal(cfg.leaveDays, 25); assert.equal(L.settings({ ...s, settings: { labor: { wage: 5000 } } }).wage, 5000); assert.equal(L.settings({ ...s, settings: { labor: { wage: 0 } } }).wage, 6000);
  assert.equal(L.leaveStatus({ rotas: {}, me: null, ...s }, new Date(2026, 5, 1), cfg).entitled, 25, 'contract gives 25, more than the legal 21');
});
await t('offers: scored against the current job; better pay/leave/feel scores higher; unrated feelings are neutral', () => {
  const a = C.cleanOffer({ employer: 'A', basic: 9000, housing: 2000, hoursWeek: 40, leave: 30, feel: { culture: 5, growth: 4, place: 4, stability: 4 } }), b = C.cleanOffer({ employer: 'B', basic: 5000, hoursWeek: 60, leave: 21 });
  const ra = C.scoreOffer(a, cur), rb = C.scoreOffer(b, cur); assert.ok(ra.score > rb.score + 20, `${ra.score} vs ${rb.score}`); assert.ok(ra.score <= 100 && rb.score >= 0); assert.ok(C.compare(a, cur).some(x => /\+/.test(x)));
});
await t('postings stay linked to their job and carry aspect ratings; delete leaves a tombstone; devices merge', () => {
  let st = C.saveJob(s, { ...job, id: 'p1', employer: 'Acme Clinics', postingOf: cur.id, status: 'past', aspects: { food: 1, housing: 9 } }); const p = st.jobs.p1; assert.equal(p.postingOf, cur.id); assert.equal(p.aspects.food, 1); assert.equal(p.aspects.housing, 5, 'clamped'); assert.equal(p.aspects.people, 0);
  const del = C.deleteJob(st, 'p1'); assert.equal(Object.keys(del.jobs).length, 1); assert.ok(del.deleted['job:p1']);
  const m = mergeStates(C.saveJob({ jobs: {}, offers: {} }, { ...job, id: 'x1' }), C.saveJob({ jobs: {}, offers: {} }, { ...job, id: 'x2', employer: 'Other' })); assert.equal(Object.keys(m.jobs).length, 2);
});
console.log(fails ? `${fails} FAILED` : 'career ok'); process.exit(fails ? 1 : 0);
