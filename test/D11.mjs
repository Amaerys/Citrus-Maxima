// D11: Work › Calendar — "not in these rotas" is never "30 days off", overnight days, day sheet, correction sheet, legend, sheets.
// Run: node test/D11.mjs   (pure logic first, then the app in Playwright with the clock pinned in Asia/Riyadh)
import assert from 'node:assert/strict';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { parseRotaFile, serializeRota } from '../docs/js/rota-parser.js';
import { legendRows, codeOptions, codeText } from '../docs/js/rota-codes.js';
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, '—', e.message); } };

const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D11'); fs.mkdirSync(shots, { recursive: true });

console.log('pure logic: legend and correction codes');
// a made-up legend in the same shape as the real one ("D1 \ N1", "AL/EL", "Em\L", rows with no code)
const fake = { unitKind: 'gp', legend: {}, people: [{ name: 'Dr. Test One', id: '1', days: { 1: 'D1', 2: 'Annual Leave' } }],
  legendList: [{ code: 'D', desc: '', hoursText: '8:00-20:00' }, { code: 'N', desc: '', hoursText: '20:00-8:00' }, { code: '', desc: 'MCI 2nd Physician' }, { code: 'AL/EL', desc: 'Annual leave / Eid leave' }, { code: 'Em\\L', desc: 'Emergency leave' }, { code: 'D1 \\ N1', desc: 'Upper Village' }] };
const H = (a, b) => ({ start: a * 60, end: b * 60, overnight: b <= a, durationMin: ((b - a + 24) % 24 || 24) * 60 });
Object.assign(fake.legend, { D: { code: 'D', desc: '', hours: H(8, 20) }, N: { code: 'N', desc: '', hours: H(20, 8) }, 'AL/EL': { desc: 'Annual leave / Eid leave' }, AL: { desc: 'Annual leave / Eid leave' }, EL: { desc: 'Annual leave / Eid leave' }, 'EM\\L': { desc: 'Emergency leave' }, EM: { desc: 'Emergency leave' }, L: { desc: 'Emergency leave' }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' } });
await t('legend rows are tidy, with hours, and keep the colour-only lines', () => {
  const { rows, marks } = legendRows(fake);
  const d1 = rows.find(r => r.codes === 'D1 / N1'); assert.ok(d1, 'D1 / N1 row'); assert.equal(d1.what, 'Upper Village'); assert.equal(d1.hours, '08–20 / 20–08');
  assert.ok(rows.some(r => r.codes === 'AL / EL')); assert.ok(rows.some(r => r.codes === 'Em\\L' && r.what === 'Emergency leave'));
  assert.deepEqual(marks, ['MCI 2nd Physician']);
});
await t('correction codes: no "Em" / "L" fragments, leave always offered, site and hours in the words', () => {
  const g = codeOptions(fake, ['D1']), all = g.flatMap(x => x.items.map(i => i.code));
  assert.ok(!all.includes('Em') && !all.includes('L') && !all.includes('EM') && !all.includes('AL/EL'), all.join(','));
  for (const c of ['AL', 'EL', 'SL', 'VL', 'Em\\L', 'D1', 'N1', 'Annual Leave']) assert.ok(all.includes(c), c);
  assert.ok(!all.includes('D') && !all.includes('N'), 'bare D/N only give default hours');
  assert.deepEqual(g.map(x => x.group), ['Day', 'Night', 'Leave']);
  assert.equal(codeText(fake, 'D1'), 'D1 · Upper Village · 08–20'); assert.equal(codeText(fake, 'AL'), 'AL · Annual leave'); assert.equal(codeText(fake, 'EL'), 'EL · Eid leave'); assert.equal(codeText(fake, 'VL'), 'VL · Planned leave');
});
if (fs.existsSync(data('main.xlsx'))) await t('the real GP legend: every row has a code, no bogus split', async () => {
  const r = serializeRota(await parseRotaFile(fs.readFileSync(data('main.xlsx')), 'main.xlsx')), all = codeOptions(r).flatMap(x => x.items.map(i => i.code));
  assert.ok(!all.includes('Em') && !all.includes('L')); assert.ok(legendRows(r).rows.every(x => x.codes && !/\\ /.test(x.codes)));
  assert.ok(legendRows(r).marks.includes('MCI 2nd Physician'));
});

// ───────── in the app
if (!fs.existsSync(data('main.xlsx'))) { console.log(bad ? `${bad} FAILED` : 'D11 ok (no xlsx: app part skipped)'); process.exit(bad ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
const ME = { name: 'Dr. Reem Mahgoub', id: '437326' }, ALL = ['main.xlsx', 'fsed.xlsx', 'uv.xlsx', 'nurses.xlsx'].filter(f => fs.existsSync(data(f))).map(data);
async function open(time, { me = ME, width = 390, height = 844, ui = 'clean', files = ALL, state = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 800, hasTouch: width < 800, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${time}: ${e.message}`)); await p.clock.install({ time: new Date(time) });
  await p.addInitScript(([m, u, st]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('citrus.state.v1', JSON.stringify(m ? { me: m, ...st } : st)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); } }, [me, ui, state]);
  await p.goto(URL0); await sleep(500); await p.click('nav.tabs button[data-view=rota]');
  if (files.length) { await p.locator('#view-rota input[type=file]').first().setInputFiles(files); await sleep(1800); }
  await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove())); await sleep(100);
  return p;
}
const cell = (p, d) => p.locator('#view-rota .cal .day:not(.pad)').nth(d - 1);
const closeAll = (p) => p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));
const sheetText = (p) => p.locator('.sheet').last().innerText().then(x => x.replace(/\s+/g, ' '));

console.log('rotas you are not in (T02-05)');
{
  const p = await open('2026-11-13T09:30:00+03:00', { files: ['fsed.xlsx', 'uv.xlsx', 'nurses.xlsx'].filter(f => fs.existsSync(data(f))).map(data) });
  const view = (await p.locator('#view-rota').innerText()).replace(/\s+/g, ' ');
  check(/You’re not in the November rotas loaded/.test(view), 'the calendar says you are not in the loaded rotas');
  check(!/days off/.test(view) && !/All clear/.test(view) && !/labor law/i.test(view), 'no "30 days off", no "All clear" labor verdict');
  const codes = await p.locator('#view-rota .cal .day:not(.pad) .code').allInnerTexts(); check(codes.length === 30 && codes.every(c => c === '?'), 'every day is "?" (unknown), not "·" (off)');
  check(/not in this rota/.test(await cell(p, 4).getAttribute('aria-label')), 'a day’s name says so too: ' + await cell(p, 4).getAttribute('aria-label'));
  check(await p.locator('#view-rota .cal-note button:has-text("Pick your row")').count() === 1, 'it offers "Pick your row"');
  await cell(p, 4).click(); await sleep(300); const st = await sheetText(p);
  check(/You’re not in these rotas/.test(st) && !/Day off/.test(st) && !/Who could cover/.test(st), 'the day sheet: "not in these rotas", not "Day off", no cover helper');
  await p.screenshot({ path: `${shots}/phone-not-in.png` }); await p.context().close();
}

console.log('overnight shifts in the calendar and the day sheet');
{
  const p = await open('2026-11-13T09:30:00+03:00');
  // Reem: N2 on 1–4 Nov (each until 08:00 next morning), off on 5 Nov
  check(await cell(p, 5).evaluate(e => e.classList.contains('tail')) && !(await cell(p, 6).evaluate(e => e.classList.contains('tail'))), '5 Nov (after the last N2) is marked "after a night"; 6 Nov is not');
  check(/off after your night \(N2 until 08:00\)/.test(await cell(p, 5).getAttribute('aria-label')), '…and its name says until when');
  check(await cell(p, 4).evaluate(e => e.classList.contains('past')) && !(await cell(p, 14).evaluate(e => e.classList.contains('past'))), 'past days are marked past');
  check((await cell(p, 9).locator('.code').getAttribute('class')).includes('s1') && (await cell(p, 8).locator('.code').getAttribute('class')).includes('s2'), 'site stripe: D1 Upper Village vs D2 Lower Village');
  await cell(p, 2).click(); await sleep(300); let st = await sheetText(p);
  check(/Night · Lower Village/.test(st) && /20:00 – 08:00 \(next morning\)/.test(st), '2 Nov: tonight’s N2 runs into the next morning');
  check(/Until 08:00 you’re still on last night’s N2/.test(st), '2 Nov: the morning tail of the 1 Nov night is said too');
  check(/11 days ago/.test(await p.locator('.sheet .ds-head').innerText()), 'the header says how far away the day is, not the date again');
  // the band lines up with your own bar (it used to start late and run off the track)
  const box = async (sel) => p.locator(sel).first().boundingBox();
  const band = await box('.sheet .ov-band2'), mine = await box('.sheet .ov-row.me .ov-in'), track = await box('.sheet .ov-row.me .ov-track');
  check(band && mine && Math.abs(band.x - mine.x) < 1.5 && Math.abs(band.x + band.width - (mine.x + mine.width)) < 1.5 && band.x + band.width <= track.x + track.width + 1, `overlap band = your bar (${band?.x.toFixed(0)}–${(band?.x + band?.width).toFixed(0)} vs ${mine?.x.toFixed(0)}–${(mine?.x + mine?.width).toFixed(0)})`);
  check(await p.locator('.sheet .ov-key .ov-sw.in.N').count() === 1 && await p.locator('.sheet .ov-key .ov-sw.n0').count() === 1, 'the key uses the night colour and names red = alone');
  await p.screenshot({ path: `${shots}/phone-day2-night.png` });
  await closeAll(p); await cell(p, 5).click(); await sleep(300); st = await sheetText(p);
  check(/Off after night/.test(st) && /Your N2 ends 08:00/.test(st), '5 Nov: "Off after night", the N2 ends 08:00');
  check(!/Who could cover/.test(st), 'no cover helper for a past day');
  await closeAll(p); await sleep(150);
  check(await p.locator('#view-rota .cal .day.sel').count() === 0, 'the selected ring goes when the day sheet closes');
  await cell(p, 16).click(); await sleep(300); st = await sheetText(p);
  check(/in 3 days/.test(st) && /Who could cover/.test(st), '16 Nov: "in 3 days", cover helper offered');
  await p.context().close();
}
{
  // "+N" on the wide calendar counts only people with you for at least half the shift (4 Nov: 2h of a 12h night is not company)
  const p = await open('2026-11-13T09:30:00+03:00', { width: 1600, height: 1000 });
  const w4 = await cell(p, 4).locator('.with').count(); await cell(p, 4).click(); await sleep(300);
  const alone = /You’re on your own/.test(await sheetText(p));
  check(!(alone && w4), `4 Nov: no "+N" while the sheet says you are on your own (+N shown: ${w4}, alone: ${alone})`);
  await closeAll(p); await p.screenshot({ path: `${shots}/wide-calendar.png`, fullPage: true });
  await cell(p, 9).click(); await sleep(300); await p.screenshot({ path: `${shots}/wide-day9.png` });
  const band = await p.locator('.sheet .ov-band2').boundingBox(), mine = await p.locator('.sheet .ov-row.me .ov-in').boundingBox();
  check(Math.abs(band.x - mine.x) < 1.5 && Math.abs(band.width - mine.width) < 1.5, 'wide: band = your bar');
  await p.context().close();
}

console.log('correction sheet, planned leave (T02-06, 22, 23)');
{
  const p = await open('2026-11-13T09:30:00+03:00', { state: { swaps: { '2026-11-17': { code: 'VL', with: '', note: 'Planned leave', at: 1 } } } });
  await cell(p, 17).click(); await sleep(300); let st = await sheetText(p);
  check(/On leave \(planned\)/.test(st) && /Instead of D1 · Day · Upper Village 08–20/.test(st), 'leave day hero: "On leave (planned)", instead of D1 Upper Village');
  check(/rota: D1/.test(st), 'the corrected chip names the rota’s code');
  await p.click('.sheet button:has-text("Edit correction")'); await sleep(300); st = await sheetText(p);
  check(/Rota: D1 · Upper Village · 08–20 · your correction: VL · Planned leave/.test(st), 'the correction sheet: "Rota: D1 … · your correction: VL · Planned leave"');
  check(await p.locator('.sheet select').first().inputValue() === 'VL', 'the select holds VL, so Save keeps the leave');
  const vals = await p.locator('.sheet select').first().locator('option').evaluateAll(o => o.map(x => x.value));
  check(!vals.includes('Em') && !vals.includes('L') && vals.includes('AL') && vals.includes('SL') && vals.includes('D1'), 'no bogus codes; leave codes offered');
  check(await p.locator('.sheet select').first().locator('optgroup').evaluateAll(g => g.map(x => x.label).join(',')) === 'Day,Night,Evening,Other,Leave', 'grouped Day / Night / Evening / Other / Leave');
  await p.screenshot({ path: `${shots}/phone-correction.png` });
  await p.click('.sheet button:has-text("Save")'); await sleep(300);
  check(await p.evaluate(() => window.__citrus.store.get().swaps['2026-11-17'].code) === 'VL', 'Save without touching the code keeps VL');
  await p.context().close();
}

console.log('a month with no rota (T02-18)');
{
  const p = await open('2026-11-13T09:30:00+03:00', { state: { swaps: { '2026-12-15': { code: 'VL', with: '', note: 'Planned leave', at: 1 } } } });
  await p.click('#view-rota button[aria-label="Next month"]'); await sleep(300);
  const codes = await p.locator('#view-rota .cal .day:not(.pad) .code').allInnerTexts();
  check(codes.length === 31 && codes.filter(c => c === '?').length === 30 && codes[14] === 'L', 'December draws its grid: "?" days, and the pencilled leave on the 15th');
  const v = (await p.locator('#view-rota').innerText()).replace(/\s+/g, ' ');
  check(/No rota for December 2026 yet/.test(v) && await p.locator('#view-rota button:has-text("Plan leave")').count() === 1, 'a slim note, with Plan leave reachable');
  check(/Nov 2026 · \d files?/.test(v), 'loaded rotas are grouped by month: ' + (v.match(/Nov 2026 · \d files?/) || [''])[0]);
  await cell(p, 15).click(); await sleep(300); const st = await sheetText(p);
  check(/On leave \(planned\)/.test(st) && /can’t tell which shift/.test(st), 'its day sheet shows the planned leave');
  await closeAll(p); await cell(p, 3).click(); await sleep(300);
  check(/Not known yet/.test(await sheetText(p)), 'a December day is "Not known yet", not a day off');
  await closeAll(p); await p.screenshot({ path: `${shots}/phone-december.png`, fullPage: true }); await p.context().close();
}

console.log('sheets: ✕, Escape on stacked sheets, toasts');
{
  const p = await open('2026-11-13T09:30:00+03:00');
  await cell(p, 9).click(); await sleep(300); await p.locator('.sheet .pill').first().click(); await sleep(300);
  await p.locator('.sheet').last().locator('.chip.sw-day').first().click().catch(() => {}); await sleep(300);
  const n = await p.locator('.sheet-bg').count(); check(n === 3, `three sheets stacked (${n})`);
  await p.keyboard.press('Escape'); await sleep(150); check(await p.locator('.sheet-bg').count() === 2, 'Escape closes only the top one');
  await p.keyboard.press('Escape'); await sleep(150); check(await p.locator('.sheet-bg').count() === 1 && /Monday/.test(await p.locator('.sheet h2').first().innerText()), 'then the next; the first day sheet stays');
  await p.locator('.sheet-x').click(); await sleep(150); check(await p.locator('.sheet-bg').count() === 0, 'the ✕ closes it');
  await cell(p, 9).click(); await sleep(300); await p.evaluate(() => { const t = document.createElement('div'); t.className = 'toast show'; t.textContent = 'probe'; (document.getElementById('toasts') || document.body).append(t); });
  const tb = await p.locator('#toasts').boundingBox(), sb = await p.locator('.sheet').boundingBox();
  check(tb && sb && tb.y + tb.height <= sb.y + 2, 'toasts sit above the open sheet, not over its buttons');
  await closeAll(p);
  // calendar writes say once whether they went to Google or wait (FOLLOWUPS: double toast)
  const r = await p.evaluate(async () => { const before = document.querySelectorAll('.toast').length; const r = await window.__citrus.calendarCreate('primary', { title: 'x', start: new Date(), end: new Date() }, {}, { quiet: true }); return { how: r.how, toasts: document.querySelectorAll('.toast').length - before }; });
  check(r.how === 'queued' && r.toasts === 0, 'calendarCreate returns { how: "queued" } and stays quiet when asked');
  await p.context().close();
}

console.log('Today: nurses (T04-05, T04-15)');
if (fs.existsSync(data('nurses.xlsx'))) {
  const p = await open('2026-11-15T21:30:00+03:00'); await p.click('nav.tabs button[data-view=today]'); await sleep(400);
  const nudge = p.locator('#view-today .card:has-text("Tomorrow’s nurse postings"), #view-today .card:has-text("Postings for tomorrow")');
  const inFold = await nudge.count() ? await nudge.first().evaluate(e => !!e.closest('details.more-today')) : null;
  check(inFold === false, `21:30 before a working day: the postings nudge is above the fold (${inFold === null ? 'not drawn' : inFold ? 'folded' : 'open'})`);
  await p.context().close();
}
{
  const p = await open('2026-11-09T09:30:00+03:00'); await p.click('nav.tabs button[data-view=today]'); await sleep(400);
  const pill = p.locator('#view-today .card.hero .tm-line:has-text("Nurses") .tm-pill').last();
  if (await pill.count()) {
    await p.click('nav.tabs button[data-view=rota]'); await p.click('.work-seg button:has-text("Nurses")'); await sleep(200);
    for (let i = 0; i < 3; i++) { const nx = p.locator('#view-rota button[aria-label*="Next"]').first(); if (await nx.count()) await nx.click(); await sleep(120); }
    const away = (await p.locator('#view-rota').innerText()).slice(0, 300);
    await p.click('nav.tabs button[data-view=today]'); await sleep(300); await pill.click(); await sleep(400);
    const v = (await p.locator('#view-rota').innerText()).slice(0, 300);
    check(/9|Mon/.test(v) && v !== away, 'the hero’s nurse pill opens the board on the shift’s day, not where it was left');
  } else console.log('  · no nurse pill on 9 Nov (skipped)');
  await p.context().close();
}

console.log('screens');
for (const [ui, w, hgt] of [['clean', 390, 844], ['paper', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000], ['arcade', 390, 844], ['clean', 320, 700]]) {
  const p = await open('2026-11-13T09:30:00+03:00', { ui, width: w, height: hgt });
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `${ui} ${w}px: no sideways scroll`);
  await p.screenshot({ path: `${shots}/${w}-${ui}-calendar.png`, fullPage: true });
  await cell(p, 2).click(); await sleep(300); await p.screenshot({ path: `${shots}/${w}-${ui}-day2.png` });
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `${ui} ${w}px: day sheet fits`);
  await p.context().close();
}
check(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D11 ok'); process.exit(bad ? 1 : 0);
