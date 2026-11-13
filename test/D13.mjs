// D13 — safe even swaps, honest leave planner, holiday overtime, share picture. Run: node test/D13.mjs
// Part 1: pure logic on synthetic rotas (made-up people). Part 2: the real rota in a browser (clock pinned), screenshots in test/shots/D13.
process.env.TZ = 'Asia/Riyadh';
import assert from 'node:assert/strict';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import('../docs/js/plans.js'), { parseRotaFile } = await import('../docs/js/rota-parser.js');
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D13'); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', String(e.stack).split('\n').slice(0, 3).join('\n     ')); } };

// synthetic GP rota, November 2026 (1 Nov is a Sunday)
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const legend = { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, E: { hours: hrs(600, 1320) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' }, E1: { desc: 'Upper Village' }, VL: { desc: 'Leave' } };
const rotaOf = (people) => ({ id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people: people.map(([name, id, days]) => ({ name, id, days })) });
const st = (people, extra = {}) => ({ rotas: { gp: rotaOf(people) }, me: { id: '1', name: 'Dr Me' }, settings: {}, ...extra });
const NOW = new Date(2026, 10, 1, 9, 30), day = (d) => new Date(2026, 10, d);
const fromKeyD = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const gives = (r, id) => (r.options.find(o => o.person.id === id)?.gives || []).map(g => +g.date.slice(8));

console.log('even swaps (P0: never a dangerous stretch, never the past)');
await t('a day shift straight after my night is never offered (rest gap < 11h)', () => {
  // me: N1 on 14 (ends 15 Nov 08:00), off 15 and 16, D1 on 23. Ann: off 23, works D1 on 15 and 16.
  const r = P.swapOptions(st([['Dr Me', '1', { 14: 'N1', 23: 'D1' }], ['Dr Ann', '2', { 15: 'D1', 16: 'D1' }]]), day(23), { now: NOW });
  assert.deepEqual(gives(r, '2'), [16], '15 D1 starts the moment my night ends; 16 is fine'); assert.ok(r.left.rest >= 1, 'the left-out trade is counted');
});
await t('the colleague is protected too: no taking my day shift right after their own night (unless the trade takes that night off them)', () => {
  const r = P.swapOptions(st([['Dr Me', '1', { 23: 'D1' }], ['Dr Ann', '2', { 22: 'N1', 25: 'D1' }]]), day(23), { now: NOW });
  assert.deepEqual(gives(r, '2'), [22], 'giving me her 22nd night frees her; her 25th would leave her a night then my 08:00 start'); assert.equal(r.left.rest, 1);
});
await t('an evening into a next-morning day (10h) is left out as well', () => {
  const r = P.swapOptions(st([['Dr Me', '1', { 10: 'E1', 23: 'D1' }], ['Dr Ann', '2', { 11: 'D1' }]]), day(23), { now: NOW });
  assert.deepEqual(gives(r, '2'), []);
});
await t('no swap that puts either doctor on 7 days in a row', () => {
  const mine = { 20: 'D1' }; for (let d = 2; d <= 7; d++) mine[d] = 'D1'; // 6 in a row, 8 Nov off
  const r = P.swapOptions(st([['Dr Me', '1', mine], ['Dr Ann', '2', { 8: 'D1', 12: 'D1' }]]), day(20), { now: NOW });
  assert.deepEqual(gives(r, '2'), [12], '8 Nov would be my 7th day'); assert.equal(r.left.run, 1);
  const theirs = {}; for (let d = 17; d <= 22; d++) theirs[d] = 'D1'; theirs[12] = 'D1';
  const r2 = P.swapOptions(st([['Dr Me', '1', { 23: 'D1' }], ['Dr Ann', '2', theirs]]), day(23), { now: NOW });
  assert.ok(!gives(r2, '2').includes(12), 'trading their 12th for my 23rd would make 17–23 their 7 in a row'); assert.ok(r2.left.run >= 1); assert.ok(gives(r2, '2').includes(20), 'taking a day out of their run is fine');
});
await t('past or started shifts: no swap for them, and none offered in return', () => {
  const s = st([['Dr Me', '1', { 10: 'D1', 23: 'D1' }], ['Dr Ann', '2', { 12: 'D1', 13: 'D1', 16: 'D1' }]]);
  const r = P.swapOptions(s, day(10), { now: new Date(2026, 10, 13, 9, 30) }); assert.equal(r.past, true); assert.equal(r.options.length, 0);
  assert.deepEqual(gives(P.swapOptions(s, day(23), { now: new Date(2026, 10, 13, 9, 30) }), '2'), [16], '12 is past and 13 D1 is already under way');
});
await t('shift type is tagged per offered day; "same type" only when every shown day matches', () => {
  const s = st([['Dr Me', '1', { 23: 'D1' }], ['Dr Ann', '2', { 16: 'N1', 27: 'D1' }], ['Dr Bo', '3', { 17: 'D1', 27: 'D1' }]]);
  const r = P.swapOptions(s, day(23), { now: NOW }), ann = r.options.find(o => o.person.id === '2'), bo = r.options.find(o => o.person.id === '3');
  assert.deepEqual(ann.gives.map(g => [g.type, g.sameType]), [['D', true], ['N', false]]); assert.equal(ann.allSame, false); assert.equal(bo.allSame, true);
});
await t('leave days are not "days off" to work on', () => {
  const r = P.swapOptions(st([['Dr Me', '1', { 23: 'D1', 16: 'VL' }], ['Dr Ann', '2', { 16: 'D1' }]]), day(23), { now: NOW }); assert.equal(r.options.length, 0);
});

console.log('leave planner');
await t('dates without a rota are never "off anyway" (T02-07)', () => {
  const e = P.evalLeave(st([['Dr Me', '1', { 2: 'D1' }]]), new Date(2026, 11, 13), new Date(2026, 11, 19), NOW);
  assert.equal(e.noRota, 7); assert.equal(e.covered, 0); assert.equal(e.offDays, 0);
  const mix = P.evalLeave(st([['Dr Me', '1', { 29: 'D1' }]]), day(28), new Date(2026, 11, 2), NOW); assert.equal(mix.noRota, 2); assert.equal(mix.covered, 1); assert.equal(mix.offDays, 2);
});
await t('short notice is flagged, and windows inside 30 days are tagged and ranked after', () => {
  const s = st([['Dr Me', '1', Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, (i + 1) % 3 ? 'D1' : '']))]]);
  assert.equal(P.evalLeave(s, day(16), day(19), new Date(2026, 10, 13)).shortNotice, true);
  assert.equal(P.evalLeave(s, day(16), day(19), new Date(2026, 9, 1)).shortNotice, false);
  const w = P.bestWindows(s, 3, { now: new Date(2026, 9, 20), horizon: 45 }); assert.ok(w.length); assert.ok(w.every((x, i) => !i || x.short >= w[i - 1].short), 'notice-respecting windows first');
  assert.ok(w.some(x => x.short) && w.some(x => !x.short));
});
await t('overlapping requests: already-planned days are not counted again; two requests stay two rows; remove one + undo', () => {
  const s0 = st([['Dr Me', '1', { 16: 'D1', 17: 'D1', 20: 'D1', 21: 'D1' }]]);
  const a = P.applyLeave(s0, day(16), day(19), 1, 'a'); assert.equal(a.days, 4);
  const e = P.evalLeave(a.state, day(18), day(21), NOW); assert.equal(e.already, 2); assert.equal(e.billable, 2); assert.equal(e.covered, 2);
  const b = P.applyLeave(a.state, day(18), day(21), 2, 'b'); assert.equal(b.days, 2, 'only 20–21 are new'); assert.equal(b.already, 2);
  const rows = P.plannedLeave(b.state); assert.deepEqual(rows.map(r => [r.from, r.to, r.id]), [['2026-11-16', '2026-11-19', 'a'], ['2026-11-20', '2026-11-21', 'b']]);
  const c = P.clearLeave(b.state, fromKeyD(rows[1].from), fromKeyD(rows[1].to), rows[1].id); assert.deepEqual(P.plannedLeave(c).map(r => r.id), ['a']);
  const u = P.restoreLeave(c, rows[1].entries); assert.equal(P.plannedLeave(u).length, 2); assert.ok(!u.deleted['swap:2026-11-20'], 'tombstone lifted');
});
await t('balance after counts other planned leave ahead', () => {
  const s0 = st([['Dr Me', '1', { 16: 'D1' }]], { jobs: { j: { id: 'j', status: 'current', start: '2025-01-01', basic: 6000, leave: 21 } } });
  const s1 = P.applyLeave(s0, day(16), day(19), 1).state, e = P.evalLeave(s1, day(25), day(26), NOW); assert.equal(e.leftAfter, 21 - 4 - 2);
});

console.log('month report');
await t('work on a public holiday is overtime (T02-11); law check off drops the verdict (T02-13)', () => {
  const s = st([['Dr Me', '1', { 3: 'D1', 4: 'D1' }]], { jobs: { j: { id: 'j', status: 'current', start: '2025-01-01', basic: 4800 } } });
  const base = P.monthReport(s, 2026, 11); assert.equal(base.overtimeH, 0);
  const hol = P.monthReport({ ...s, settings: { labor: { holidays: ['2026-11-04'] } } }, 2026, 11); assert.equal(hol.holidayH, 12); assert.equal(hol.overtimeH, 12); assert.ok(hol.otPay > 0);
  assert.equal(P.monthReport({ ...s, settings: { labor: { on: false } } }, 2026, 11).lawOn, false);
});


// ───────── the real rota
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: browser part skipped'); process.exit(bad ? 1 : 0); }
const buf = fs.readFileSync(data('main.xlsx')), rota = await parseRotaFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'main.xlsx');
const real = { rotas: { [rota.id]: rota }, me: { id: '437326', name: 'Dr. Reem Mahgoub' }, settings: {} };
console.log('real rota');
await t('cover for 10 Nov never offers a day shift on 5 Nov (the morning my N2 ends) — and past dates are refused on 13 Nov', () => {
  const r = P.swapOptions(real, day(10), { now: NOW }); assert.ok(r.options.length > 0); assert.ok(r.options.every(o => o.gives.every(g => g.date !== '2026-11-05' || g.type === 'N')), 'only a night (12h later) may follow my night');
  assert.equal(P.swapOptions(real, day(10), { now: new Date(2026, 10, 13, 9, 30) }).past, true);
  const late = P.swapOptions(real, day(23), { now: new Date(2026, 10, 13, 9, 30) }); assert.ok(late.options.every(o => o.gives.every(g => g.date > '2026-11-13')), 'only days ahead');
});

console.log('browser');
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
for (const [vw, ui] of [['phone', 'clean'], ['wide', 'paper'], ['phone', 'paper'], ['wide', 'clean']]) {
  const phone = vw === 'phone', errors = [];
  const bc = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', acceptDownloads: true }), p = await bc.newPage();
  p.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack).split('\n')[1]));
  await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
  await p.addInitScript((ui) => { localStorage.setItem('citrus.ui', JSON.stringify({ ui })); if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); }, ui);
  await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2000);
  console.log(` ${vw} · ${ui}`);
  // cover for 23 Nov (D1): every offered day lies ahead, never a day straight after a night of mine, type per day.
  // The block is mounted straight from plans-ui.js (same module instance as the app), so the check does not depend on the day sheet.
  const mount = (d) => p.evaluate(async (d) => { document.querySelector('#d13-cover')?.remove(); const m = await import('./js/plans-ui.js'); const el = m.swapBlock(new Date(2026, 10, d), () => {});
    const bg = document.createElement('div'); bg.id = 'd13-cover'; bg.className = 'sheet-bg'; const sh = document.createElement('div'); sh.className = 'sheet'; sh.innerHTML = '<div class="handle"></div><h2>Cover for ' + d + ' Nov</h2>'; if (el) sh.append(el); bg.append(sh); document.body.append(bg); return sh.innerText; }, d);
  const c = await mount(23); check(/Even swaps/.test(c) && /Checked for rest/.test(c), 'even swaps say they are rest-checked');
  const offered = await p.locator('#d13-cover .sw-gives .chip').allInnerTexts(); check(offered.length > 0 && offered.every(x => !/ (1[0-3]|[1-9]) Nov/.test(x)), 'only days after today offered: ' + offered.slice(0, 4).join(', '));
  check(await p.locator('#d13-cover .sw-gives .chip.D, #d13-cover .sw-gives .chip.N, #d13-cover .sw-gives .chip.E, #d13-cover .sw-gives .chip.other').count() === offered.length, 'each offered day carries its own type');
  await sleep(400); await p.screenshot({ path: `${shots}/${vw}-${ui}-swaps.png` });
  check(/already started or passed/.test(await mount(10)), 'past shift: the finder says it is for shifts ahead'); await p.evaluate(() => document.querySelector('#d13-cover')?.remove());
  // leave planner opens on dates the rota covers (December is not loaded)
  await p.click('#view-rota .mr button:has-text("Plan leave")'); await sleep(300); const lt = await p.locator('.sheet').innerText();
  check(!/off on every one of these days anyway/.test(lt), 'leave planner never calls unloaded days "off anyway"');
  check(/short notice|Less than 30 days/.test(lt), 'November dates are flagged as short notice');
  await p.locator('.sheet input[type=date]').first().fill('2026-12-13'); await p.locator('.sheet input[type=date]').first().dispatchEvent('change'); await sleep(200);
  await p.locator('.sheet input[type=date]').nth(1).fill('2026-12-19'); await p.locator('.sheet input[type=date]').nth(1).dispatchEvent('change'); await sleep(200);
  const dec = await p.locator('.sheet').innerText(); check(/No rota loaded for these dates yet/.test(dec) && !/anyway/.test(dec), 'December range: "No rota loaded" instead of "off anyway"');
  await sleep(300); await p.screenshot({ path: `${shots}/${vw}-${ui}-leave.png` });
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no horizontal overflow');
  if (vw === 'phone') {
    while (await p.locator('.sheet').count()) { await p.keyboard.press('Escape'); await sleep(150); }
    const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null); await p.click('#view-rota .mr button:has-text("Share image")'); const d = await dl;
    if (d) { const f = `${shots}/share-${ui}.png`; await d.saveAs(f); const head = fs.readFileSync(f); check(head.readUInt32BE(20) === 1160, 'share picture sized to 5 rows (1160px tall, got ' + head.readUInt32BE(20) + ')'); } else check(false, 'share picture downloads');
  }
  const mine = errors.filter(e => /plans/.test(e)); check(mine.length === 0, 'no page errors: ' + mine.join('|').slice(0, 200));
  await bc.close();
}
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D13 ok'); process.exit(bad ? 1 : 0);
