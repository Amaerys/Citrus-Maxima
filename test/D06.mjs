// D06 — Career: exact Labor Law maths (Art. 84/85/107), dates, import/merge, and the Career UI. Made-up employers and salaries only.
// Run: node test/D06.mjs        (unit tests always; Playwright part unless NO_UI=1)
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as C from '../docs/js/career.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', String(e.stack || e).split('\n').slice(0, 3).join('\n     ')); } };
const D = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 9, 30); }, NOW = D('2026-11-13');
const near = (a, b, eps = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} ≠ ${b}`);
const job = (o) => C.cleanJob({ employer: 'Made-up Clinic', basic: 6000, housing: 1500, transport: 500, leave: 21, hoursWeek: 48, status: 'current', ...o });

console.log('Art. 84 / 85 end-of-service');
await t('years are calendar-exact: anniversaries are whole numbers, 29 Feb works', () => {
  assert.equal(C.yearsBetween(D('2020-03-01'), D('2022-03-01')), 2); assert.equal(C.yearsBetween(D('2020-02-29'), D('2021-02-28')), 1); assert.equal(C.yearsBetween(D('2021-01-01'), D('2021-01-01')), 0);
  near(C.yearsBetween(D('2023-05-13'), D('2026-11-13')), 3 + 184 / 365, 1e-12, '3 years + 184 of 365 days');
});
await t('T05-03: a past job counts to its end date (inclusive), not to today', () => {
  const j = job({ status: 'past', start: '2018-01-01', end: '2021-12-31', basic: 5000, housing: 1250, transport: 0 });
  assert.equal(C.yearsServed(j, NOW), 4); const e = C.endOfService(j, NOW); assert.equal(e.months, 2); assert.equal(e.onTotal, 12500); assert.equal(e.resignFactor, 1 / 3); assert.equal(e.resignOnTotal, Math.round(12500 / 3));
  assert.equal(C.yearsServed(job({ status: 'past', start: '2020-01-01', left: '2020-12-31', end: '2022-12-31' }), NOW), 1, 'left wins over end');
  assert.equal(C.yearsServed(job({ status: 'past', start: '2025-01-01', end: '2027-12-31' }), NOW), C.yearsBetween(D('2025-01-01'), NOW), 'a past job with a future end is capped at today');
  assert.equal(C.yearsServed(job({ start: '2024-11-13', end: '2025-11-12' }), NOW), 2, 'a current (renewed) job counts to today');
});
await t('half a month a year for 5 years, a full month after; parts of a year pro rata', () => {
  const at = (start) => C.endOfService(job({ start, basic: 7000, housing: 2000, transport: 1000 }), NOW); // package 10,000
  assert.equal(at('2025-11-13').onTotal, 5000); assert.equal(at('2021-11-13').onTotal, 25000); assert.equal(at('2019-11-13').months, 4.5); assert.equal(at('2019-11-13').onTotal, 45000); assert.equal(at('2014-11-13').months, 9.5);
  assert.equal(at('2019-11-13').onBasic, 31500, 'basic-only figure: 4.5 × 7,000');
  const f = at('2023-05-13'), y = 3 + 184 / 365; near(f.months, y / 2, 1e-12); assert.equal(f.onTotal, Math.round(y / 2 * 10000));
  const g = at('2020-05-13'), y2 = 6 + 184 / 365; near(g.months, 2.5 + (y2 - 5), 1e-12); assert.equal(g.onTotal, Math.round((2.5 + y2 - 5) * 10000));
});
await t('Art. 85 resignation share switches exactly on the 2 / 5 / 10-year anniversaries', () => {
  const f = (start) => C.endOfService(job({ start }), NOW).resignFactor;
  assert.equal(f('2024-11-14'), 0, 'one day short of 2 years'); assert.equal(f('2024-11-13'), 1 / 3); assert.equal(f('2021-11-14'), 1 / 3); assert.equal(f('2021-11-13'), 2 / 3); assert.equal(f('2016-11-14'), 2 / 3); assert.equal(f('2016-11-13'), 1);
  const e = C.endOfService(job({ start: '2019-11-13', basic: 7000, housing: 2000, transport: 1000 }), NOW); assert.equal(e.resignOnTotal, 30000, '2/3 of 45,000'); assert.equal(C.endOfService(job({ start: '2025-09-01' }), NOW).resignOnTotal, 0, 'under 2 years: nothing');
});
await t('T05-11: next Art. 85 step date', () => {
  const s = C.nextStep(job({ start: '2025-01-01' }), NOW); assert.equal(s.years, 2); assert.equal(s.date, '2027-01-01'); assert.equal(s.days, 49); assert.equal(s.factor, 1 / 3);
  assert.equal(C.nextStep(job({ start: '2024-11-13' }), NOW).years, 5, 'on the anniversary the next step is 5 years'); assert.equal(C.nextStep(job({ start: '2010-01-01' }), NOW), null); assert.equal(C.nextStep(job({ start: '2025-01-01', status: 'past' }), NOW), null);
});

console.log('Art. 107 overtime, hourly value');
await t('T05-04: overtime = hourly wage (package ÷ 240) + 50 % of basic hourly; basic-only floor shown too', () => {
  const o = C.overtime(job({ basic: 6000, housing: 1500, transport: 500 })); assert.equal(o.hourlyWage, 33.33); assert.equal(o.basicHourly, 25); assert.equal(o.full, 45.83); assert.equal(o.basicOnly, 37.5); assert.equal(C.overtimeRate(job({ basic: 6000, housing: 1500, transport: 500 })), 45.83);
  assert.equal(C.overtime(job({ basic: 8000, housing: 2000, transport: 800 })).full, Math.round((10800 / 240 + 8000 / 240 / 2) * 100) / 100);
});
await t('T05-30: real hourly value from rostered hours', () => {
  const r = C.realHourly(job({ basic: 6000, housing: 1500, transport: 500, hoursWeek: 48 }), [{ key: '2026-11', hours: 200 }, { key: '2026-12', hours: 0 }]);
  assert.equal(r.length, 1); assert.equal(r[0].perHour, 40); assert.equal(r[0].contractH, 208); assert.equal(r[0].overH, -8);
});

console.log('Contract dates');
await t('T05-05: renewal notice defaults to 60 days; an explicit 0 says so instead of inventing one', () => {
  const j = job({ start: '2025-03-01', end: '2027-02-28', renews: true }); assert.equal(j.renewNoticeDays, 60); assert.equal(C.keyDates(j, NOW).find(k => k.id === 'renew').date, '2026-12-30');
  assert.match(C.flags(j, NOW).map(f => f.msg).join('|'), /60 days before the end/);
  const z = job({ start: '2025-03-01', end: '2027-02-28', renewNoticeDays: 0 }); assert.equal(C.keyDates(z, NOW).some(k => k.id === 'renew'), false); assert.match(C.flags(z, NOW).map(f => f.msg).join('|'), /Add the notice period/);
  assert.equal(C.keyDates(job({ start: '2025-03-01', end: '2027-02-28', renews: false }), NOW).some(k => k.id === 'renew'), false);
});
await t('T05-26: a renewing contract rolls forward by its own length once the end has passed', () => {
  const j = job({ start: '2024-03-01', end: '2027-02-28' }), later = D('2027-03-15'), term = C.currentTerm(j, later);
  assert.deepEqual([term.start, term.end, term.renewals, term.months], ['2027-03-01', '2030-02-28', 1, 36]);
  const k = C.keyDates(j, later); assert.equal(k.find(x => x.id === 'end').date, '2030-02-28'); assert.equal(k.find(x => x.id === 'renew').date, '2029-12-30'); assert.ok(k.find(x => x.id === 'renewed'));
  assert.equal(C.currentTerm({ ...j, renews: false }, later).end, '2027-02-28', 'no rolling when it does not renew'); assert.equal(C.currentTerm({ ...j, status: 'past' }, later).end, '2027-02-28');
  assert.equal(C.currentTerm(job({ start: '2025-01-01', end: '2025-01-10' }), D('2025-01-25')).end, '2025-01-30', 'odd lengths roll by days');
  assert.equal(C.upcoming(j, later, 4000).some(x => x.id === 'renewed'), false, 'Today never nags about a past renewal');
});
await t('flags: 30 days leave after 5 years, trial period limits', () => {
  assert.match(C.flags(job({ start: '2019-01-01', leave: 25 }), NOW).map(f => f.msg).join('|'), /at least 30 days/);
  assert.doesNotMatch(C.flags(job({ start: '2024-01-01', leave: 25 }), NOW).map(f => f.msg).join('|'), /30 days/);
  assert.equal(C.flags(job({ trialDays: 120 }), NOW).find(f => /trial/.test(f.msg)).level, 'warn'); assert.equal(C.flags(job({ trialDays: 200 }), NOW).find(f => /trial/.test(f.msg)).level, 'violation');
});
await t('T05-21: durations floor and carry (no "12 months", "2y 12m")', () => {
  const s = (start, end) => C.served(job({ status: 'past', start, end }), NOW);
  assert.deepEqual(s('2016-06-01', '2017-05-31'), { y: 1, m: 0, d: 0 }); assert.deepEqual(s('2020-01-01', '2022-12-20'), { y: 2, m: 11, d: 20 }); assert.deepEqual(s('2026-01-01', '2026-02-11'), { y: 0, m: 1, d: 11 });
});
await t('T05-24: date order is validated', () => {
  assert.deepEqual(C.jobErrors({ employer: 'X', start: '2025-01-01', end: '2024-01-01' }), ['“Contract ends” is before “Start”']); assert.equal(C.jobErrors({ employer: 'X', start: '2025-01-01', left: '2024-12-01' }).length, 1); assert.equal(C.jobErrors({ employer: ' ' })[0], 'Add the employer'); assert.equal(C.jobErrors({ employer: 'X', start: '2025-01-01', end: '2026-01-01' }).length, 0);
  assert.deepEqual(C.cleanJob({ employer: 'X', terms: 'one\n\ntwo' }).terms, ['one', 'two'], 'terms typed one per line');
});

console.log('One current job, import, export');
await t('T05-10: saving a new current job moves the old one to past, left the day before', () => {
  let s = C.saveJob({ jobs: {} }, { id: 'a', employer: 'Old Made-up', status: 'current', start: '2022-01-01', end: '2027-12-31' });
  s = C.saveJob(s, { id: 'b', employer: 'New Made-up', status: 'current', start: '2026-10-01' });
  assert.equal(s.jobs.a.status, 'past'); assert.equal(s.jobs.a.left, '2026-09-30'); assert.equal(C.currentJob(s).id, 'b');
  let t2 = C.saveJob({ jobs: {} }, { id: 'a', employer: 'Old', status: 'current', start: '2020-01-01', end: '2021-12-31' }); t2 = C.saveJob(t2, { id: 'b', employer: 'New', status: 'current', start: '2024-01-01' }); assert.equal(t2.jobs.a.left, '', 'term already ended: no made-up left date');
  const p = C.saveJob(s, { id: 'p', employer: 'New Made-up', postingOf: 'b', status: 'current', start: '2026-10-05' }); assert.equal(p.jobs.b.status, 'current', 'a posting never demotes its job');
});
const FILE = { jobs: [{ status: 'current', employer: 'Made-up Health', start: '2024-03-01', end: '2027-02-28', basic: 9000, housing: 2250 }, { status: 'past', employer: 'Made-up Old', start: '2018-01-01', end: '2021-12-31', basic: 4000 }], offers: [{ employer: 'Offer X', role: 'GP', basic: 11000 }], labor: { muslim: true } };
await t('T05-08: importing the same id-less file twice does not duplicate', () => {
  const a = C.importCareer({ jobs: {}, offers: {} }, FILE), b = C.importCareer(a.state, FILE);
  assert.equal(Object.keys(b.state.jobs).length, 2); assert.equal(Object.keys(b.state.offers).length, 1); assert.equal(b.counts.jobsUpdated, 2); assert.equal(b.counts.jobsAdded, 0); assert.equal(Object.values(b.state.jobs).filter(j => j.status === 'current').length, 1);
  assert.equal(C.importSummary(a.counts), '2 jobs, 1 offer, labor settings'); assert.equal(C.importSummary(b.counts), '2 jobs (2 updated), 1 offer (1 updated), labor settings');
});
await t('T05-09: offers-only and labor-only files load; junk is refused', () => {
  assert.equal(Object.keys(C.importCareer({}, { offers: [{ employer: 'Only offer' }] }).state.offers).length, 1);
  assert.equal(C.importCareer({ settings: { a: 1 } }, { labor: { muslim: true } }).state.settings.labor.muslim, true);
  for (const bad of [{}, [], null, { jobs: [] }, { foo: 1 }]) assert.throws(() => C.importCareer({}, bad));
});
await t('postings in a file stay linked when ids are remapped onto existing jobs', () => {
  const s0 = C.saveJob({ jobs: {} }, { id: 'mine', employer: 'Made-up Health', status: 'current', start: '2024-03-01' });
  const r = C.importCareer(s0, { jobs: [{ id: 'f1', employer: 'Made-up Health', status: 'current', start: '2024-03-01' }, { id: 'f2', postingOf: 'f1', employer: 'Made-up Health', site: 'Site Z', city: 'Nowhere' }] });
  assert.equal(Object.keys(r.state.jobs).length, 2); assert.equal(C.postingsOf(r.state, 'mine').length, 1);
});
await t('a file with two current jobs keeps only the latest one current', () => {
  const r = C.importCareer({}, { jobs: [{ id: 'x', employer: 'B', status: 'current', start: '2025-06-01' }, { id: 'y', employer: 'A', status: 'current', start: '2021-01-01' }] });
  assert.equal(r.state.jobs.x.status, 'current'); assert.equal(r.state.jobs.y.status, 'past'); assert.equal(r.state.jobs.y.left, '2025-05-31'); assert.equal(r.counts.demoted.length, 1);
});
await t('T05-25: export round-trips jobs, offers and labor settings', () => {
  const s = C.importCareer({ settings: {} }, FILE).state, back = C.importCareer({}, JSON.parse(JSON.stringify(C.exportData(s)))).state;
  assert.equal(Object.keys(back.jobs).length, 2); assert.equal(Object.keys(back.offers).length, 1); assert.equal(back.settings.labor.muslim, true);
});

console.log('Offers');
const cur = job({ start: '2024-01-01', basic: 6000, housing: 1500, transport: 500, leave: 21 });
await t('T05-12: 1 = awful scores below unrated (neutral 3) and 5 above', () => {
  const sc = (f) => C.scoreOffer(C.cleanOffer({ employer: 'O', basic: 7000, feel: { culture: f, growth: f, place: f, stability: f } }), cur).score;
  assert.ok(sc(1) < sc(0)); assert.equal(sc(0), sc(3)); assert.ok(sc(5) > sc(3));
});
await t('T05-12: housing provided counts in pay; ticket/insurance only with a value', () => {
  const plain = C.cleanOffer({ employer: 'P', basic: 8000 }), housed = C.cleanOffer({ employer: 'H', basic: 8000, housed: true });
  assert.equal(C.offerValue(housed, cur).housed, 1500, 'valued like the current housing allowance'); assert.equal(C.offerValue(housed, null).housed, 2000, 'or 25 % of basic');
  assert.equal(C.offerValue(C.cleanOffer({ ...housed, housedValue: 3000 }), cur).value, 11000); assert.ok(C.scoreOffer(housed, cur).score > C.scoreOffer(plain, cur).score);
  const tk = C.cleanOffer({ employer: 'T', basic: 8000, ticket: true }); assert.deepEqual(C.offerValue(tk, cur).unpriced, ['ticket']); assert.equal(C.offerValue({ ...tk, ticketValue: 2400 }, cur).extras, 200);
  assert.equal(C.offerValue(C.cleanOffer({ employer: 'HH', basic: 8000, housing: 1000, housed: true }), cur).housed, 0, 'no double count with a housing allowance');
});
await t('T05-23: compare lines are per offer; the end-of-service / fixed-term context comes once', () => {
  const o = C.cleanOffer({ employer: 'O', basic: 9000 }), lines = C.compare(o, cur).join('|'); assert.doesNotMatch(lines, /end-of-service|Art\. 77/); assert.match(lines, /\+1,000 SAR a month/);
  const ctx = C.compareContext(job({ start: '2023-01-01', end: '2027-12-31' }), NOW); assert.deepEqual(ctx.map(c => c.id), ['eos', 'term']); assert.equal(ctx[1].date, '2027-12-31'); assert.match(ctx[0].text, /33 %/);
});

// ───────── UI
if (process.env.NO_UI !== '1') {
  const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
  const http = await import('node:http'), fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os');
  const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots'); fs.mkdirSync(shots, { recursive: true });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
  await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd06-')), file = path.join(dir, 'career.json'), offersOnly = path.join(dir, 'offers.json');
  fs.writeFileSync(file, JSON.stringify({ jobs: [
    { status: 'current', employer: 'Made-up Health Co', role: 'GP', city: 'Riyadh', start: '2024-03-01', end: '2027-02-28', basic: 10000, housing: 2500, transport: 1000, leave: 30, hoursWeek: 48, renewNoticeDays: 60, renews: true, terms: ['Made-up clause'] },
    { status: 'past', employer: 'Old Fake Clinic', city: 'Jeddah', start: '2018-01-01', end: '2021-12-31', basic: 5000, housing: 1250, leave: 21, hoursWeek: 54, again: 'no', rating: 2, aspects: { food: 1 } },
    { status: 'past', employer: 'No City Ltd', start: '2016-06-01', left: '2017-05-31', basic: 3000, leave: 21, hoursWeek: 48 },
    { postingOf: '', employer: 'Made-up Health Co', site: 'Remote site A', city: 'Nowhere', status: 'past', weeks: 3, aspects: { housing: 1 } }] }));
  fs.writeFileSync(offersOnly, JSON.stringify({ offers: [{ employer: 'Offer Alpha', basic: 12000, housing: 3000, hoursWeek: 44, leave: 30 }, { employer: 'Offer Beta', basic: 9000, housed: true, status: 'declined' }] }));
  const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
  const check = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
  const open = async (vp, ui) => {
    const cx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vp.width < 600, hasTouch: vp.width < 600, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await cx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
    await p.addInitScript((ui) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Test Doctor', id: '000001' } })); if (ui) localStorage.setItem('citrus.ui', JSON.stringify({ ui })); }, ui);
    await p.goto(URL0); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await sleep(200); await p.click('.work-seg button:has-text("Career")'); await sleep(250); return { cx, p };
  };
  console.log('Career UI (phone, Clean)');
  { const { cx, p } = await open({ width: 390, height: 844 });
    await p.locator('#view-rota input[type=file]').first().setInputFiles(file); await sleep(500);
    // Link the posting to the current job (ids are generated on import).
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('citrus.state.v1')); const js = Object.values(s.jobs); const cur = js.find(j => j.status === 'current'), post = js.find(j => j.site === 'Remote site A'); post.postingOf = cur.id; localStorage.setItem('citrus.state.v1', JSON.stringify(s)); });
    await p.reload(); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await sleep(150); await p.click('.work-seg button:has-text("Career")'); await sleep(250);
    const txt = await p.locator('#view-rota').innerText();
    check(/If you resign/.test(txt) && /If they end it/.test(txt), 'T05-11: resign vs end-it figures on the summary');
    const eosY = (C.yearsBetween(D('2024-03-01'), NOW)), full = Math.round(eosY / 2 * 13500);
    check(txt.includes(`${full.toLocaleString('en-US')} SAR`), `T05-11: full award ${full} matches Art. 84`); check(txt.includes(`${Math.round(full / 3).toLocaleString('en-US')} SAR`), 'T05-11: resignation pays a third after 2 years');
    check(/1 Mar 2029/.test(txt), 'T05-11: date of the next Art. 85 step (5 years)');
    check(await p.locator('#view-rota .cr-now .cr-post').count() === 1, 'T05-13: posting of the current job shown under it');
    const old = await p.locator('#view-rota .cr-past:has-text("Old Fake Clinic")').innerText(); check(/· 4 years/.test(old) && !/8y/.test(old), 'T05-03/21: past job shows 4 years, not counted to today: ' + old.split('\n')[1]);
    const nc = await p.locator('#view-rota .cr-past:has-text("No City Ltd")').innerText(); check(/1 year/.test(nc) && !/ · $/m.test(nc) && !/12 months/.test(nc), 'T05-21/22: "1 year", no stray separator');
    await p.click('#view-rota .cr-now button:has-text("Full terms")'); await sleep(150); const det = await p.locator('#view-rota .cr-det').innerText();
    check(/77\.08 SAR an hour/.test(det) && /On basic alone: 62\.5/.test(det), 'T05-04: overtime label and maths agree (77.08; basic-only 62.5)');
    check(await p.locator('#view-rota .cr-tl .cr-seg-j').count() === 3, 'T05-28: timeline has one node per job'); await p.locator('#view-rota .cr-tl-item:has-text("Old Fake Clinic")').click(); await sleep(400);
    check(await p.locator('#view-rota .cr-past:has-text("Old Fake Clinic") .cr-det').count() === 1, 'T05-28: timeline node opens its card');
    await p.screenshot({ path: path.join(shots, 'D06-career-390-clean.png'), fullPage: true });
    await p.locator('#view-rota input[type=file]').first().setInputFiles(file); await sleep(400);
    check(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('citrus.state.v1')).jobs).length) === 4, 'T05-08: same file twice, no duplicates');
    await p.locator('#view-rota input[type=file]').first().setInputFiles(offersOnly); await sleep(400);
    check(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('citrus.state.v1')).offers || {}).length) === 2, 'T05-09: offers-only file loads');
    await p.click('#view-rota .view-mode button:has-text("Next job")'); await sleep(250); const nx = await p.locator('#view-rota').innerText();
    check((nx.match(/End-of-service so far/g) || []).length === 1 && /28 Feb 2027/.test(nx) && !/2027-02-28/.test(nx), 'T05-23: context once, app date format');
    check(/Declined \(1\)/.test(nx) && !/Offer Beta/.test(nx), 'T05-23: declined offers collapsed'); check(/Remote site A/.test(nx) && !/: \(/.test(nx), 'T05-22: lesson line is clean');
    await p.click('#view-rota button:has-text("Add an offer")'); await sleep(250);
    check(await p.locator('.sheet .cr-rate').count() === 4 && await p.locator('.sheet .cr-rate button.on:has-text("–")').count() === 4, 'T05-12: feelings start as "not rated" with visible values');
    await p.fill('.sheet input >> nth=0', 'Offer Gamma'); await p.locator('.sheet .cr-rate').first().locator('button:has-text("1")').click(); await p.click('.sheet button:has-text("Housing provided")'); await sleep(100);
    check(await p.locator('.sheet input[placeholder="2500"]').count() === 1, 'T05-12: housing worth field appears, prefilled hint from current housing'); await p.click('.sheet button:has-text("Save")'); await sleep(300);
    check(await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).offers).find(o => o.employer === 'Offer Gamma')?.feel.culture) === 1, 'T05-12: a rating of 1 is stored as 1');
    await p.screenshot({ path: path.join(shots, 'D06-next-390-clean.png'), fullPage: true });
    await p.click('#view-rota .view-mode button:has-text("My jobs")'); await sleep(200); await p.click('#view-rota .cr-actions button:has-text("Add a job")'); await sleep(250);
    check(await p.locator('.sheet details.cr-more summary:has-text("Contract details")').count() === 1, 'T05-24: contract details section');
    await p.fill('.sheet input >> nth=0', 'Bad Dates'); await p.locator('.sheet input[type=date]').nth(0).fill('2025-05-01'); await p.locator('.sheet input[type=date]').nth(1).fill('2024-05-01'); await p.click('.sheet button:has-text("Save")'); await sleep(200);
    check(/before “Start”/.test(await p.locator('.sheet .cr-err').innerText()), 'T05-24: end before start is refused'); await p.keyboard.press('Escape'); await cx.close(); }
  console.log('Career UI (320 squeeze, wide, Paper)');
  { const { cx, p } = await open({ width: 320, height: 700 }); await p.locator('#view-rota input[type=file]').first().setInputFiles(file); await sleep(500);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px: no horizontal scroll');
    check(await p.evaluate(() => [...document.querySelectorAll('#view-rota .cr-actions .btn')].every(b => b.scrollWidth <= b.clientWidth + 1)), 'T05-28: action buttons are not cut at 320px');
    await p.screenshot({ path: path.join(shots, 'D06-career-320.png'), fullPage: true }); await cx.close(); }
  for (const ui of ['', 'paper']) { const { cx, p } = await open({ width: 1600, height: 1000 }, ui); await p.locator('#view-rota input[type=file]').first().setInputFiles(file); await sleep(500);
    const cols = await p.evaluate(() => [...document.querySelectorAll('#view-rota .cr-col')].map(c => Math.round(c.getBoundingClientRect().left)));
    check(cols.length === 2 && cols[1] - cols[0] > 300, `T05-28: two columns at 1600px ${ui || 'clean'}`); await p.screenshot({ path: path.join(shots, `D06-career-1600-${ui || 'clean'}.png`), fullPage: true });
    if (ui === 'paper') { await p.setViewportSize({ width: 390, height: 844 }); await sleep(200); await p.screenshot({ path: path.join(shots, 'D06-career-390-paper.png'), fullPage: true }); await p.click('#view-rota .view-mode button:has-text("Next job")'); await sleep(200); await p.setViewportSize({ width: 1600, height: 1000 }); await sleep(200); await p.screenshot({ path: path.join(shots, 'D06-next-1600-paper.png'), fullPage: true }); }
    await cx.close(); }
  check(errors.length === 0, 'no page errors ' + errors.join('|').slice(0, 300)); await browser.close(); server.close();
}
console.log(fails ? `${fails} FAILED` : 'D06 ok'); process.exit(fails ? 1 : 0);
