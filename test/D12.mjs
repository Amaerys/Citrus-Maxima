// D12 — labor law: contract terms flow from Career, legal 48h ceiling, Art. 107 overtime, labels and grouping. Run: node test/D12.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as L from '../docs/js/labor.js';
import * as C from '../docs/js/career.js';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };

// made-up rota: weeks 1–7 Nov 5×12h = 60h, 8–14 Nov 7×12h, 15–21 Nov 4×12h = 48h, 22–28 Nov 2 nights
const days = {}; for (const d of [1, 2, 3, 4, 5]) days[d] = 'D'; for (const d of [8, 9, 10, 11, 12, 13, 14]) days[d] = 'D'; for (const d of [15, 16, 17, 18]) days[d] = 'D'; days[22] = 'N'; days[23] = 'N';
const hrs = (s, e, o = false) => ({ start: s, end: e, overnight: o, durationMin: (o ? e + 1440 - s : e - s) });
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, true) } }, people: [{ name: 'Dr Test', id: '1', days }] };
const job = (x = {}) => ({ id: 'c', status: 'current', employer: 'Made-up Clinic', start: '2024-03-01', basic: 10000, housing: 2500, leave: 30, hoursWeek: 48, ...x });
const st = (j, labor = {}) => ({ rotas: { gp }, me: { id: '1', name: 'Dr Test' }, jobs: j ? { c: j } : {}, settings: { labor } });

await t('T05-01: contract edits flow into the check; values equal to the contract are not overrides', () => {
  // an old save froze the contract into settings.labor; while equal it is ignored, so editing the contract wins
  const frozen = { muslim: false, hire: '2024-03-01', wage: 10000, leaveDays: 30, weeklyH: 48 };
  assert.deepEqual(Object.keys(L.overrides(st(job(), frozen))), ['muslim']);
  const cfg = L.settings(st(job({ basic: 20000, leave: 21, hoursWeek: 40 }), { muslim: false }));
  assert.equal(cfg.wage, 20000); assert.equal(cfg.leaveDays, 21); assert.equal(cfg.weeklyH, 40); assert.equal(cfg.src.wage, 'contract');
  const mine = L.settings(st(job(), { wage: 9000 })); assert.equal(mine.wage, 9000); assert.equal(mine.src.wage, 'you'); assert.equal(mine.contract.wage, 10000);
});
await t('T05-02: a 60h contract never lifts the 48h legal limit and is itself a violation', () => {
  const r = L.checkMonth(st(job({ hoursWeek: 60 })), 2026, 11); const w = r.weeks.find(x => x.start === '2026-11-01');
  assert.equal(w.cap, 48); assert.equal(w.over, 12); assert.ok(r.findings[0].rule === 'contract' && r.findings[0].level === 'violation', 'contract flag first'); assert.equal(r.totals.overtimeH > 0, true);
  assert.equal(L.settings(st(job({ hoursWeek: 60 }))).weeklyH, 48, 'Today week bar uses the capped figure too'); assert.equal(L.settings(st(job({ hoursWeek: 60 }))).contractH, 60);
  const by = L.checkMonth(st(job(), { weeklyH: 60 }), 2026, 11); assert.equal(by.weeks[0].cap, 48, 'a hand-set 60h is capped too');
});
await t('T05-02: a 40h contract lowers the limit; the legal 48h is still reported', () => {
  const r = L.checkMonth(st(job({ hoursWeek: 40 })), 2026, 11), w1 = r.weeks.find(x => x.start === '2026-11-01'), w3 = r.weeks.find(x => x.start === '2026-11-15');
  assert.equal(w1.cap, 40); assert.equal(w1.legal, 48); assert.equal(w1.over, 20); assert.equal(w1.overLegal, 12); assert.equal(w3.over, 8); assert.equal(w3.overLegal, 0);
  assert.match(r.findings.find(f => f.rule === 'weekly').msg, /over the 40h contract limit, 12h over the legal 48h/); assert.equal(r.totals.cap, 40);
});
await t('Ramadan: 36h for Muslims whatever the contract says', () => {
  const r = L.checkMonth(st(job({ hoursWeek: 60 }), { muslim: true, ramadan: ['2026-11-15', '2026-11-21'] }), 2026, 11); const w = r.weeks.find(x => x.start === '2026-11-15'); assert.equal(w.cap, 36); assert.equal(w.over, 12);
  assert.equal(L.checkMonth(st(job({ hoursWeek: 30 }), { muslim: true, ramadan: ['2026-11-15', '2026-11-21'] }), 2026, 11).weeks.find(x => x.start === '2026-11-15').cap, 30, 'a shorter contract stays lower');
});
await t('FOLLOWUP: overtime pay matches career.js Art. 107 (hourly wage + 50 % of basic hourly)', () => {
  const j = job(), r = L.checkMonth(st(j), 2026, 11); assert.equal(r.totals.otRate, C.overtimeRate(j)); assert.equal(r.totals.otPay, Math.round(r.totals.overtimeH * C.overtimeRate(j)));
  const mine = L.checkMonth(st(j, { wage: 8000 }), 2026, 11); assert.equal(mine.totals.otRate, C.overtimeRate({ ...j, basic: 8000 }), 'hand-set basic keeps the contract allowances');
  assert.equal(L.checkMonth(st(null), 2026, 11, { ...L.DEFAULTS, wage: 12000 }).totals.otRate, 75, 'no contract: basic ÷ 240 × 1.5');
});
await t('T02-14: weekly flags are labelled by their Sun–Sat week in day-month style, pinned to the week start', () => {
  const f = L.checkMonth(st(job()), 2026, 11).findings.find(x => x.rule === 'weekly'); assert.equal(f.label, 'Week of 1–7 Nov'); assert.equal(f.date, '2026-11-01'); assert.doesNotMatch(f.msg, /\d{4}-\d\d/);
  assert.equal(L.weekLabel(new Date(2026, 10, 29)), '29 Nov–5 Dec');
});
await t('T02-15 / T05-27: 12h notes fold into one row; real flags come before notes', () => {
  const r = L.checkMonth(st(job()), 2026, 11), daily = r.findings.filter(f => f.rule === 'daily');
  assert.equal(daily.length, 1); assert.equal(daily[0].dates.length, 18); assert.match(daily[0].label, /18 ×/); assert.equal(r.findings.at(-1).level, 'info');
  const lv = r.findings.map(f => ({ violation: 0, warn: 1, info: 2 })[f.level]); assert.deepEqual(lv, [...lv].sort());
});
await t('T02-12: impossible holiday dates are refused and reported', () => {
  const p = L.parseHolidays('2026-13-45\nfoo\n2026-12-01, 2026-02-30 2026-12-01\n2026-11-03'); assert.deepEqual(p.ok, ['2026-11-03', '2026-12-01']); assert.deepEqual(p.bad, ['2026-13-45', 'foo', '2026-02-30']);
});
await t('T05-27: leave status says how many rota months it could see', () => { const a = L.leaveStatus(st(job()), new Date(2026, 10, 30)); assert.equal(a.seenMonths, 1); assert.equal(a.entitled, 30); });

// ── browser: the sheet saves only what you change; the contract keeps flowing in
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D12'); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); const errors = [];
const check = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
const seed = { me: { name: 'Dr Test', id: '1' }, rotas: { [gp.id]: { ...gp, people: [{ ...gp.people[0], days: Array.from({ length: 31 }, (_, i) => days[i] || '') }], unit: 'GP', legendList: [{ code: 'D', desc: 'Day', hoursText: '08:00–20:00' }, { code: 'N', desc: 'Night', hoursText: '20:00–08:00' }], sourceName: 'made-up.xlsx', importedAt: '2026-11-01T08:00:00Z' } }, jobs: { c: job() }, settings: { labor: { wage: 10000, leaveDays: 30, weeklyH: 48, hire: '2024-03-01' } } };
async function open(vp, ui) {
  const c = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await c.newPage(); p.on('pageerror', e => errors.push(e.stack || e.message));
  await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
  await p.addInitScript(([s, u]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('citrus.state.v1', JSON.stringify(s)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); } }, [seed, ui]);
  await p.goto(URL0); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await sleep(400); return { c, p };
}
const labor = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).settings.labor);
{
  const { c, p } = await open({ width: 390, height: 844 }, 'clean');
  check(await p.locator('#view-rota .lw').count() === 1, 'labor card shown');
  check(/Week of 1–7 Nov · Art\. 98/.test(await p.locator('#view-rota .lw').innerText()), 'card flag names the week, not a day off');
  await p.click('#view-rota .lw button:has-text("Details")'); await sleep(400);
  let l = await labor(p); check(!('wage' in l) && !('leaveDays' in l) && !('weeklyH' in l) && !('hire' in l), 'opening the sheet heals values frozen from the contract: ' + JSON.stringify(l));
  await p.click('.sheet input[type=checkbox] >> nth=1'); await sleep(300); await p.click('.sheet input[type=checkbox] >> nth=1'); await sleep(300);
  l = await labor(p); check(l.muslim === false && !('wage' in l) && !('leaveDays' in l), 'Ramadan on/off saves only muslim: ' + JSON.stringify(l));
  await p.fill('.sheet textarea', '2026-13-45\nfoo\n2026-12-01'); await p.locator('.sheet textarea').dispatchEvent('change'); await sleep(300);
  check(/ignored 2026-13-45, foo/.test(await p.locator('body').innerText()), 'ignored holiday lines are named'); check(JSON.stringify((await labor(p)).holidays) === '["2026-12-01"]', 'only the real date kept');
  await p.locator('.sheet .lw-term input[type=number]').nth(0).fill('9000'); await p.locator('.sheet .lw-term input[type=number]').nth(0).dispatchEvent('change'); await sleep(400);
  check((await labor(p)).wage === 9000 && /contract says 10,000/.test(await p.locator('.sheet').innerText()), 'hand-set wage saved, contract value hinted');
  await p.click('.sheet .lw-term button:has-text("Reset")'); await sleep(400); check(!('wage' in (await labor(p))), 'Reset follows the contract again');
  await p.screenshot({ path: `${shots}/phone-clean-sheet.png`, fullPage: false }); await p.locator('.sheet .lw-terms').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/phone-clean-settings.png` });
  await p.keyboard.press('Escape'); await sleep(200);
  // edit the contract: 20,000 basic, 21 days, 40h — the card must follow
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('citrus.state.v1')); Object.assign(s.jobs.c, { basic: 20000, leave: 21, hoursWeek: 40 }); localStorage.setItem('citrus.state.v1', JSON.stringify(s)); }); await p.reload(); await sleep(700);
  await p.click('nav.tabs button[data-view=rota]'); await sleep(400); const card = await p.locator('#view-rota .lw').innerText();
  check(/over 40h weeks/.test(card) && /\/21/.test(card), 'card follows the edited contract (40h cap, 21 days): ' + card.replace(/\s+/g, ' ').slice(0, 160));
  await p.locator('#view-rota .lw').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/phone-clean-card.png` });
  check(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'no horizontal overflow at 390px'); await c.close();
}
for (const [ui, vp] of [['paper', { width: 390, height: 844 }], ['paper', { width: 1600, height: 1000 }], ['clean', { width: 1600, height: 1000 }], ['arcade', { width: 390, height: 844 }]]) {
  const { c, p } = await open(vp, ui); await p.locator('#view-rota .lw').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/${vp.width}-${ui}-card.png` });
  await p.click('#view-rota .lw button:has-text("Details")'); await sleep(400); await p.screenshot({ path: `${shots}/${vp.width}-${ui}-sheet.png` });
  await p.locator('.sheet .lw-terms').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/${vp.width}-${ui}-settings.png` });
  check(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, `${ui} ${vp.width}: no overflow`); await c.close();
}
// other developers' files are being edited at the same time: only errors raised from the labor files fail this test
const mine = errors.filter(e => /labor/.test(e)), other = [...new Set(errors.filter(e => !/labor/.test(e)).map(e => e.split('\n').slice(0, 2).join(' ')))];
check(mine.length === 0, 'no page errors from labor files: ' + mine.join('|').slice(0, 200)); if (other.length) console.log('  ! errors elsewhere (not D12):', other.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'D12 ok'); process.exit(fails ? 1 : 0);
