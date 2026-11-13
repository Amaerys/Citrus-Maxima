// D18 — Nurses board: confirmed vs heard vs guessed postings look and read differently everywhere; safe tile taps with undo; paste a posting list;
// 7-day strip; honest "who could be with you"; evening nudge only when it matters; night-tail nurses; wide two-column board. Run: node test/D18.mjs
// Part 1 uses a made-up sheet (made-up names). Part 2 drives the app with the real November files from test/data (READ only; checks avoid real names).
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { parseRotaGrid, serializeRota } from '../docs/js/rota-parser.js';
import * as N from '../docs/js/nurses.js';
import * as NB from '../docs/js/nurse-board.js';
let bad = 0;
const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', String(e.stack || e).split('\n').slice(0, 3).join('\n     ')); } };
const D = (d) => new Date(2026, 10, d);

// ───────── part 1: logic on a made-up sheet (same layout as the real one)
const DAYS = 30, C0 = 9;
function sheet() {
  const g = [], row = (cells) => { const r = Array(C0 + DAYS).fill(null); cells.forEach((v, i) => { if (v !== undefined) r[i] = v; }); g.push(r); return r; };
  const band = (text) => row(Array(C0 + DAYS).fill(text));
  const day = (code, from = 1, to = DAYS) => { const a = []; for (let d = from; d <= to; d++) a[C0 + d - 1] = code; return a; };
  const person = (sn, id, name, title, clinic, codes) => { const r = row([null, `#${sn}`, id, name, title, 'BLS', `5000000${String(sn).padStart(2, '0')}`, 'X', clinic]); codes.forEach((v, i) => { if (v) r[i] = v; }); };
  row([]); row([null, '', 'TEST - Medical']); row([null, '', 'UNIT / DEPT', 'UNIT / DEPT', 'EMERGENCY/CLINIC']); row([null, '', 'Month&Year', 'Month&Year', 'November 2026']); row([]);
  const hd = row([null, '#', 'I.D', 'NAME', 'Title', 'BLS/ACLS', 'Mobile #', 'ACCOM.', 'ASSIGNED CLINIC']); for (let d = 1; d <= DAYS; d++) hd[C0 + d - 1] = d;
  const wd = row([null, '#', 'I.D', 'NAME', 'Title', 'BLS/ACLS', 'Mobile #', 'ACCOM.', 'ASSIGNED CLINIC']); for (let d = 1; d <= DAYS; d++) wd[C0 + d - 1] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][(d - 1) % 7];
  band('Test Project-HMC');
  person(1, 8001, 'Head Quill', 'HN', ' ALL SITES', day('A+'));
  band('Construction Clinics Team Leaders (UPV-LPV)');
  person(2, 800002, 'Lead Ruby (Leader)', 'RN', 'QIC', day('D'));
  person(3, 800003, 'Lead Sage', 'RN', 'QIC', day('D'));
  band('Construction Clinics (UPV-UPO-LPO-LPV)');
  person(4, 800004, 'Fatima Kayla Zed', 'SN', 'QIC', day('D'));
  person(5, 800005, 'Fatima Moss Yen', 'SN', 'QIC', day('D'));
  person(6, 800006, 'Al Nizar Quinn', 'SN', 'QIC', day('D'));
  { const a = day('D', 1, 23); day('END OF CONTRACT', 24, 30).forEach((v, i) => { a[i] = v; }); person(7, 800007, 'Bea Solo', 'SN', 'QIC', a); }
  person(8, 800008, 'Cora Night', 'SN', 'QIC', day('N'));
  band('Aqua Arabia (WW+HG)');
  person(9, 800009, 'Aqua Tess (Leader)', 'SN', 'SF/AA', day('D'));
  row([]);
  row([null, '', ' LEGEND', ' LEGEND', ' LEGEND']); row([null, '', 'D', '08:00-20:00', '12 Hrs']); row([null, '', 'N', '20:00-08:00', '12 Hrs']); row([null, '', 'A+', '10:00-18:00', '8Hrs']);
  return g;
}
const syn = parseRotaGrid(sheet(), { sourceName: 'test.xlsx' }), base = { rotas: { n: serializeRota(syn) }, posts: {}, friends: {} };
const key = (s, nm) => N.keyOfPerson(N.nurses(s).find(p => p.name.startsWith(nm)));
console.log('logic');
await t('short names: surname initial only where two read the same, tiny first names keep the next word, friends count as clashes', () => {
  assert.deepEqual(NB.shortNurseNames(['Fatima Kayla Zed', 'Fatima Moss Yen', 'Al Nizar Quinn', 'Bea Solo', 'Lead Ruby (Leader)']), ['Fatima Z.', 'Fatima Y.', 'Al Nizar', 'Bea', 'Lead']);
  assert.deepEqual(NB.shortNurseNames(['Bea Solo', 'Cora Night'], ['Bea Other']), ['Bea S.', 'Cora']);
  assert.deepEqual(NB.shortNurseNames(['Ann Lee', 'Ann Lane']), ['Ann Lee', 'Ann Lane']);
});
await t('who can tell you the postings: head nurse and construction-clinic leaders, never a fixed group’s leader', () => {
  const src = NB.heardSources(base).map(x => x.name); assert.deepEqual([...src].sort(), ['Head', 'Lead R.', 'Lead S.']);
});
await t('last source: the newest typed tip, never "last time" guesses', () => {
  let s = N.setPost(base, D(3), key(base, 'Bea'), 'UPV', { tip: true, from: 'Sage' }); s.posts[Object.keys(s.posts)[0]].at = 1;
  s = N.setPost(s, D(3), key(base, 'Cora'), 'LPV', { tip: true, from: 'last time', guess: true });
  assert.equal(NB.lastSource(s), 'Sage'); assert.equal(NB.lastSource(base), null);
});
await t('paste: headings, inline sites, numbered lines; ambiguous / unknown / wrong-site names are reported, not guessed', () => {
  const rows = N.rowsFor(base, D(3));
  const r = NB.parsePostingList('Upper Village\n1. Bea\n2. Al Nizar (D)\nLPV: Fatima Zed, Lead Ruby\nUPO - Lead Sage\nFatima\nNobody Here', rows);
  const by = Object.fromEntries(r.hits.map(h => [h.name.split(' ')[0] + (h.name.includes('Zed') ? 'Z' : ''), h.site]));
  assert.deepEqual(by, { Bea: 'UPV', Al: 'UPV', FatimaZ: 'LPV', Lead: 'LPV' });
  assert.ok(r.offsite.some(o => /Sage/.test(o.name) && o.site === 'UPO'), 'leaders cannot go to UPO');
  assert.ok(r.unknown.some(u => u.text === 'fatima' && /2 nurses/.test(u.why)) && r.unknown.some(u => /nobody here/.test(u.text)));
  assert.equal(NB.parsePostingList('Bea', rows).unknown[0].why, 'no site before it');
});
await t('day marks for the strip: confirmed, heard, guessed, open; no schedule = no marks', () => {
  let s = N.setPost(base, D(3), key(base, 'Bea'), 'UPV'); s = N.setPost(s, D(3), key(base, 'Cora'), 'LPV', { tip: true, from: 'Sage' }); s = N.setPost(s, D(3), key(base, 'Al'), 'LPV', { tip: true, from: 'last time', guess: true });
  const [m, x] = NB.dayMarks(s, [D(3), new Date(2026, 11, 3)]);
  assert.deepEqual([m.posted, m.heard, m.guessed, m.open], [1, 1, 1, 6]); assert.equal(x.hasRota, false);
});
await t('"Use last posts" makes guesses, which never count as confirmed or history', () => {
  let s = N.setPost(base, D(2), key(base, 'Bea'), 'UPO'); s = N.applySuggestions(s, D(3));
  assert.equal(N.postOf(s, D(3), key(base, 'Bea')), ''); assert.equal(N.tipOf(s, D(3), key(base, 'Bea')).guess, true); assert.equal(N.history(s, key(base, 'Bea')).length, 1);
});

// ───────── part 2: the app with the real files
const here = path.dirname(new URL(import.meta.url).pathname), root = process.env.DOCS_ROOT || path.resolve(here, '../docs'), shots = path.resolve(here, 'shots/D18'), data = (f) => path.join(here, 'data', f);
if (!fs.existsSync(data('nurses.xlsx'))) { console.log('no nurses.xlsx — UI part skipped'); process.exit(bad ? 1 : 0); }
fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
let saved = null;   // postings made on the first page, carried to the later ones
async function open(time, { w = 390, hgt = 844, ui = 'clean', state = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await ctx.newPage();
  await p.clock.install({ time: new Date(time) });
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi/.test(m.text())) errors.push(m.text()); });
  // every page imports the files itself; only your postings are carried from page to page
  const st = { me: { name: 'Dr. Reem Mahgoub', id: '437326' }, posts: saved || {} };
  await p.addInitScript(([s, u]) => { if (!sessionStorage.getItem('d18')) { localStorage.setItem('citrus.state.v1', s); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u })); sessionStorage.setItem('d18', '1'); } }, [JSON.stringify(st), ui]);
  await p.goto(URL0); await sleep(600);
  await p.click('nav.tabs button[data-view=rota]'); await sleep(200); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx'), data('nurses.xlsx')]); await sleep(2500);
  return { p, close: () => ctx.close() };
}
const tab = async (p, v) => { await p.click(`nav.tabs button[data-view=${v}]`); await sleep(250); };
const board = async (p) => { await tab(p, 'rota'); await p.click('.work-seg button:has-text("Nurses")'); await sleep(300); };
const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const posts = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).posts || {}));

console.log('board (12 Nov, you at the Upper office clinic)');
{
  const { p, close } = await open('2026-11-12T09:30:00+03:00'); await board(p);
  check(await p.locator('#view-rota .nb-strip .nb-day').count() === 7 && /12/.test(await p.locator('#view-rota .nb-day.sel').innerText()), '7-day strip, today selected');
  check(/Head nurse on/.test(await p.locator('#view-rota .nb-staff').innerText()), 'head nurse shown apart, as a supervisor');
  const tileUPO = '#view-rota .post-tile.UPO';
  await p.click('#view-rota .np-row >> nth=0 >> button:has-text("UPO")'); await sleep(300);
  check(await p.locator(`${tileUPO} .post-row.sure`).count() === 1, 'confirmed nurse appears solid in the Upper office tile');
  await p.click(`${tileUPO} .post-row.sure .pr-main`); await sleep(300);
  check(await p.locator('.sheet .nb-state.sure').count() === 1 && await p.locator(`${tileUPO} .post-row.sure`).count() === 1, 'one tap on a posted nurse opens a chooser, it does not delete');
  await p.click('.sheet button:has-text("Clear posting")'); await sleep(300);
  check(await p.locator(`${tileUPO} .post-row`).count() === 0 && await p.locator('.toast.undo').count() === 1, 'clear from the chooser, with an undo toast');
  await p.click('.toast.undo .u-btn'); await sleep(300); check(await p.locator(`${tileUPO} .post-row.sure`).count() === 1, 'undo puts her back, confirmed');
  await p.click(`${tileUPO} .post-row .x`); await sleep(300); check(await p.locator(`${tileUPO} .post-row`).count() === 0 && await p.locator('.toast.undo').count() === 1, '× clears at once, with undo');
  await p.click('.toast.undo .u-btn'); await sleep(300);
  // heard
  await p.click('#view-rota .mode-bar .seg button:has-text("Heard")'); await sleep(250);
  check(await p.locator('#view-rota .nb-from .chip').count() >= 2 && await p.locator('#view-rota .nb-from .nb-src').count() === 1, 'heard-from offers the leaders and a free-text source');
  await p.fill('#view-rota .nb-src', 'Charge desk'); await p.press('#view-rota .nb-src', 'Enter'); await sleep(250);
  await p.click('#view-rota .np-row >> nth=0 >> button:has-text("LPV")'); await sleep(300);
  const lpv = '#view-rota .post-tile.LPV';
  check(await p.locator(`${lpv} .post-row.heard`).count() === 1 && /heard · Charge desk/.test(await p.locator(`${lpv} .post-row.heard`).innerText()), 'heard tip shows in the tile as heard, with its source');
  check(!/nobody yet/.test(await p.locator(lpv).innerText()) && /0\s*\+1\?/.test(await p.locator(`${lpv} .pt-count`).innerText()), 'tile with only a tip: no "nobody yet", one count chip "0 +1?"');
  check(/heard: Lower Village · Charge desk/.test(await p.locator('#view-rota .np-row.heard .tip-line').innerText()), 'unposted row says "heard: Lower Village · source", not a raw code');
  const st = { sure: await p.locator(`${tileUPO} .post-row.sure`).evaluate(e => getComputedStyle(e).borderTopStyle), heard: await p.locator(`${lpv} .post-row.heard`).evaluate(e => getComputedStyle(e).borderTopStyle) };
  check(st.heard === 'dashed' && st.sure !== 'dashed', `heard looks different from confirmed (${st.heard} vs ${st.sure})`);
  await p.screenshot({ path: `${shots}/board-390-clean.png`, fullPage: true });
  // paste: two of the remaining unposted nurses, by first + last name taken from the page
  const nmz = (await p.locator('#view-rota .np-row:not(.heard):not(.guess) .name').allInnerTexts()).slice(0, 2).map(n => n.replace(' ★', '').split(' ')).map(w => `${w[0]} ${w[w.length - 1]}`);
  await p.click('#view-rota .nb-quick button:has-text("Paste")'); await sleep(300);
  await p.fill('.sheet textarea', `Upper office clinic\n1. ${nmz[0]}\n2. ${nmz[1]}\nSomeone Unknown`); await sleep(200);
  check(/Upper office clinic \(2\)/.test(await p.locator('.sheet .nb-paste-out').innerText()) && /Not matched/.test(await p.locator('.sheet .nb-paste-out').innerText()), 'paste preview: 2 matched to the Upper office clinic, the unknown line reported');
  await p.click('.sheet button:has-text("as heard")'); await sleep(300);
  check(await p.locator(`${tileUPO} .post-row.heard`).count() === 2, 'pasted names saved as heard, not confirmed');
  await p.click('#view-rota button:has-text("Confirm heard")'); await sleep(300);
  check(await p.locator(`${tileUPO} .post-row.sure`).count() === 3 && await p.locator(`${lpv} .post-row.sure`).count() === 1, '"Confirm heard" turns every tip into a posting');
  check((await posts(p)).filter(x => x.date === '2026-11-12' && !x.tip).length === 4, 'stored as confirmed');
  check(await over(p) <= 0, 'no sideways scroll on the phone');
  // guess from last time, on the next day
  await p.click('#view-rota .nb-quick button:has-text("Tomorrow")'); await sleep(300);
  const g = p.locator('#view-rota button:has-text("Guess from last time")');
  check(await g.count() === 1, 'next day offers "Guess from last time"'); await g.click(); await sleep(300);
  const ps = (await posts(p)).filter(x => x.date === '2026-11-13');
  check(ps.length > 0 && ps.every(x => x.tip && x.guess), `guesses stored as guesses only (${ps.length})`);
  check(await p.locator('#view-rota .post-row.guess').count() === ps.length && /last time\?/.test(await p.locator('#view-rota .post-row.guess >> nth=0').innerText()), 'guesses look like guesses in the tiles ("last time?")');
  check(await p.locator('#view-rota .post-row.guess >> nth=0').evaluate(e => getComputedStyle(e).borderTopStyle) === 'dotted', 'guess rows are dotted (heard = dashed, confirmed = solid)');
  check(/guess: .* \(last time\)/.test(await p.locator('#view-rota .np-row.guess .tip-line >> nth=0').innerText()), 'unposted row says "guess: … (last time)"');
  await p.click('#view-rota .nb-strip .nb-day >> nth=2'); await sleep(250); check(/Thu 12 Nov/.test(await p.locator('#view-rota .nb-nav').innerText()), 'strip day tap jumps to that day');
  check(await p.locator('#view-rota .nb-day:not(.sel) .nb-dot.guess').count() === 1, 'strip marks the guessed day with a guess dot');
  // swipe left → next day
  await p.locator('#view-rota .nb-nav').evaluate(el => { const T = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 100 }); el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [T(300)] })); el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [T(150)] })); }); await sleep(250);
  check(/Fri 13 Nov/.test(await p.locator('#view-rota .nb-nav').innerText()), 'swipe changes day');
  // Today: confirmed names, and they are told apart from guesses
  await tab(p, 'today'); const tt = await p.locator('#view-today').innerText();
  check(/3 nurses posted with you/.test(tt), 'Today: "3 nurses posted with you"');
  saved = await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).posts);
  await close();
}

console.log('day sheet (Mon 16 Nov, Upper Village, no postings)');
{
  const { p, close } = await open('2026-11-13T09:30:00+03:00'); await tab(p, 'rota'); await p.click('.work-seg button:has-text("Calendar")'); await sleep(250);
  await p.click('#view-rota .cal .day:not(.pad) >> nth=15'); await sleep(400);
  const nr = p.locator('.sheet .card.nr');
  const txt = await nr.innerText({ timeout: 3000 }).catch(() => '');
  check(/Nurses at Upper Village/.test(txt) && /could be sent/.test(txt), 'card leads with "N could be sent", no fake "likely" names');
  check(await p.locator('.sheet .card.nr > .nr-row.maybe:visible').count() <= 6, `no wall of bars: at most 6 shown, the rest folded (${await p.locator('.sheet .card.nr > .nr-row.maybe').count()} shown)`);
  const go = p.locator('.sheet .card.nr button:has-text("Set postings for Mon 16 Nov")'); check(await go.count() === 1, 'button names the day: "Set postings for Mon 16 Nov"');
  await go.click(); await sleep(400);
  check(await p.locator('.sheet-bg').count() === 0 && /Mon 16 Nov/.test(await p.locator('#view-rota .nb-nav').innerText()), 'it closes the day sheet and opens the board on that day');
  await close();
}

console.log('evening nudge and night tail');
{
  let o = await open('2026-11-12T21:30:00+03:00'); await tab(o.p, 'today');
  check(!/Postings for tomorrow/.test(await o.p.locator('#view-today').innerText()), 'no nudge when you are off tomorrow (13 Nov)'); await o.close();
  o = await open('2026-11-15T21:30:00+03:00'); await tab(o.p, 'today');
  check(/Postings for tomorrow at Upper Village/.test(await o.p.locator('#view-today').innerText()), 'nudge when you work tomorrow (16 Nov), naming your site');
  check(await o.p.evaluate(async () => (await import('./js/people-ui.js')).todayScore()) >= 85, 'todayScore ranks the nudge high enough to stay open');
  await o.close();
  o = await open('2026-11-02T03:00:00+03:00'); await tab(o.p, 'today'); const tt = await o.p.locator('#view-today').innerText();
  check(/last night’s shift/.test(tt), 'at 03:00 on a night shift the nurses card is about last night’s shift'); await o.close();
}

console.log('contract end, person sheet');
{
  const { p, close } = await open('2026-11-20T09:30:00+03:00'); await board(p);
  const end = p.locator('#view-rota .nb-end');
  check(await end.count() === 1 && /contract ends Tue 24 Nov · last shift/.test(await end.innerText()), 'board lists the coming contract end once, with the last shift');
  await end.click(); await sleep(400); check(/Contract ends Tue 24 Nov/.test(await p.locator('.sheet').innerText()), 'her sheet says when the contract ends');
  await close();
}

console.log('looks: Paper, wide, 320');
for (const [ui, w] of [['clean', 1600], ['paper', 1600], ['paper', 390], ['clean', 320]]) {
  const { p, close } = await open('2026-11-12T09:30:00+03:00', { w, hgt: w > 500 ? 1000 : 844, ui }); await board(p);
  if (w === 1600) { const [l, r] = [await p.locator('#view-rota .nb-l').boundingBox(), await p.locator('#view-rota .nb-r').boundingBox()]; check(l && r && r.x > l.x + l.width - 1, `${ui} 1600: two columns`); }
  if (ui === 'paper') { const c = await p.locator('#view-rota .chip.sure >> nth=0').evaluate(e => getComputedStyle(e).color); check(c !== 'rgb(255, 207, 92)', `paper ${w}: theme colours`); }
  check(await over(p) <= 0, `${ui} ${w}: no sideways scroll`);
  await p.screenshot({ path: `${shots}/board-${w}-${ui}.png`, fullPage: true }); await close();
}
check(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D18 ok'); process.exit(bad ? 1 : 0);
