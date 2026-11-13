// D02 — People: night counts, "with you" on your own sheet, the shift filter on every tab, phone search, junk phones,
// birthday kept when a contact becomes a friend, roster footer/legend/labels. Run: node test/D02.mjs
// Real rota files are only READ here; no name or number from them is written into this file.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { parseRotaFile, serializeRota, interpretCode } from '../docs/js/rota-parser.js';
import * as PL from '../docs/js/people-logic.js';
import { sharedShifts } from '../docs/js/model.js';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D02'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), `${m} (${JSON.stringify(a)})`);

// ───────── unit: pure helpers
console.log('phones');
check(PL.phoneMatch('0512345678', ['512345678']), '05… finds a rota number stored without 0');
check(PL.phoneMatch('+966512345678', ['512345678']), '+966… finds it');
check(PL.phoneMatch('+966 51 234 5678', ['512345678']), 'spaces are ignored');
check(PL.phoneMatch('00966512345678', ['0512345678']), '00966… finds a saved 05… number');
check(PL.phoneMatch('512345', ['512345678']), 'a partial number still matches');
check(!PL.phoneMatch('05', ['512345678']), 'two digits match nobody');
check(!PL.phoneMatch('0599999999', ['512345678']), 'a different number does not match');
eq(PL.dialable('abc'), '', 'letters are not a phone'); eq(PL.dialable('0551234567'), '966551234567', '05… dials with 966');
eq(PL.phoneInUse('abc', '512345678'), '512345678', 'a junk saved phone falls back to the rota number');
eq(PL.phoneInUse('0551234567', '512345678'), '0551234567', 'a good saved phone wins');
console.log('handles');
eq(PL.checkHandle('snapchat.com/add/sample.one').handle, 'sample.one', 'snapchat link without https');
eq(PL.checkHandle('https://www.instagram.com/sample_two/?hl=en').handle, 'sample_two', 'instagram link with query');
eq(PL.checkHandle('@@sample!!').handle, 'sample', '@@name!! is cleaned');
check(!!PL.checkHandle('my snap is sample').warn, 'a sentence is rejected with a reason');
console.log('shifts');
const sh = (type, start, end, overnight) => ({ kind: 'work', type, hours: { start, end, overnight, durationMin: 720 } });
check(PL.isNight(sh('N', 1200, 480, true)), 'N is a night'); check(!PL.isNight(sh('SF', 780, 60, true)), 'SF 13–01 is not a night'); check(!PL.isNight(sh('A2', 840, 120, true)), 'A2 14–02 is not a night');
check(PL.isLate(sh('SF', 780, 60, true)) && !PL.isLate(sh('D', 480, 1200, false)), 'SF is a late shift, D is not');
check(PL.isNight(sh('X', 1080, 360, true)), 'an overnight shift from 18:00 counts as a night');
eq(PL.siteNo('D1'), 1, 'D1 → site 1'); eq(PL.siteNo('N2'), 2, 'N2 → site 2'); eq(PL.siteNo('SF'), 0, 'SF has no site number');
check(PL.isOffSite({ kind: 'work', type: 'AD', site: '' }) && PL.isOffSite({ kind: 'work', type: 'D', site: 'SABIC Compound - Morning Shift' }) && !PL.isOffSite({ kind: 'work', type: 'D', site: 'Upper Village' }), 'admin / compound are off-site, the village is a clinic');
eq(PL.tClass({ kind: 'work', type: 'SF', hours: { start: 780, end: 60, overnight: true } }), 'L', 'SF gets the late colour'); eq(PL.tClass({ kind: 'work', type: 'AD', hours: null }), 'adm', 'admin day is neutral');
console.log('names');
const nm = PL.shortNames(['Dr. Alpha Beta Gamma', 'Dr. Alpha Beta Gemini', 'Dr. Alpha Delta', 'Dr. Omega Zed', 'Solo']);
check(new Set(nm).size === nm.length, 'short names are unique: ' + nm.join(' | ')); eq(nm[3], 'Omega Z.', 'first name + surname initial'); eq(nm[4], 'Solo', 'one-word name kept');
console.log('search');
const pX = { name: 'Dr. Sample Person', title: 'Consultant', mobile: '512345678' };
check(PL.matches('fsed', { p: pX, units: ['fsed'] }), 'unit word FSED finds a specialist'); check(PL.matches('karak', { p: pX, contact: { note: 'likes karak' } }), 'saved note is searchable');
check(PL.matches('+966512345678', { p: pX }), 'number with +966'); check(!PL.matches('nobody', { p: pX }), 'no false match');
check(PL.hasContact({ whatsapp: '0551234567' }) && PL.hasContact({ birthday: '1990-01-02' }) && PL.hasContact({ note: 'x' }) && !PL.hasContact({}), 'any saved field means "Edit contact"');
eq(PL.friendKind(['fsed']), 'other', 'specialists become "other" friends'); eq(PL.friendKind(['nurse']), 'nurse', 'nurses stay nurses');
eq(PL.relWords(new Date(2026, 10, 9), new Date(2026, 10, 13)), '4 days ago', 'relative words, never a repeated date');
console.log('who is on now');
const fake = { rotas: { g: { year: 2026, month: 11, daysInMonth: 30, unitKind: 'gp', legend: { N: { hours: { start: 1200, end: 480, overnight: true, durationMin: 720 } }, D: { hours: { start: 480, end: 1200, overnight: false, durationMin: 720 } } }, people: [{ id: '1', name: 'A', days: { 12: 'N' } }, { id: '2', name: 'B', days: { 13: 'D' } }] } } };
eq(PL.shiftState(fake, 'id:1', new Date(2026, 10, 13, 7, 0))?.state, 'tail', 'last night’s doctor is on at 07:00');
eq(PL.shiftState(fake, 'id:1', new Date(2026, 10, 13, 9, 0)), null, '…and gone at 09:00');
eq(PL.shiftState(fake, 'id:2', new Date(2026, 10, 13, 21, 30))?.state, 'ended', 'day shift has ended at 21:30');
eq(PL.shiftState(fake, 'id:2', new Date(2026, 10, 13, 9, 30))?.state, 'now', 'day shift is on at 09:30');

if (!fs.existsSync(data('main.xlsx')) || !fs.existsSync(data('nurses.xlsx'))) { console.log(bad ? `${bad} FAILED` : 'D02 unit ok (no rota files: browser part skipped)'); process.exit(bad ? 1 : 0); }
const load = async (f) => { const b = fs.readFileSync(data(f)); return serializeRota(await parseRotaFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f)); };
const gp = await load('main.xlsx'), nurse = await load('nurses.xlsx');
const count = (r, p, re) => Object.values(p.days).filter(c => re.test(String(c).trim())).length;
const sfDoc = gp.people.map(p => [p, count(gp, p, /^SF$/i)]).sort((a, b) => b[1] - a[1])[0], a2N = nurse.people.find(p => count(nurse, p, /^A2$/i));
console.log('real rota: night counts');
{ const st = PL.monthStats(gp, sfDoc[0]); eq([st.late >= sfDoc[1], st.nights === count(gp, sfDoc[0], /^N\d?$/i)], [true, true], `the doctor with ${sfDoc[1]} SF shifts: ${st.nights} nights, ${st.late} late`); }
if (a2N) { const st = PL.monthStats(nurse, a2N); eq([st.nights, st.late], [count(nurse, a2N, /^N$/i), count(nurse, a2N, /^A2$/i)], 'nurse with an A2: nights are only her N shifts'); }
const meP = gp.people.find(p => p.id && p.mobile && Object.values(p.days).filter(c => /^[DN]\d$/.test(c)).length > 10), meKey = `id:${meP.id}`;
const st0 = { me: { name: meP.name, id: meP.id }, rotas: { [gp.id]: gp } };
eq(sharedShifts(st0, meKey), [], 'sharedShifts with yourself is empty');
check(gp.people.some(p => p !== meP && sharedShifts(st0, `id:${p.id}`).length > 0), 'colleagues still share shifts with you');
const noHours = gp.people.find(p => Object.values(p.days).some(c => { const x = interpretCode(c, gp.legend, 'gp'); return x.kind === 'work' && !x.hours; }));
if (noHours) check(PL.monthStats(gp, noHours).noHours > 0, 'shifts without hours are counted apart');

// ───────── browser
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
async function open(opts = {}) {
  const { w = 390, hgt = 844, ui = 'clean', time = '2026-11-13T09:30:00+03:00', mobile = w < 800, seed = {} } = opts;
  const c = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await c.newPage();
  await p.clock.install({ time: new Date(time) });
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(([me, ui, seed]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me, ...seed })); localStorage.setItem('citrus.ui', JSON.stringify({ ui })); }, [st0.me, ui, seed]);
  await p.goto(URL0); await sleep(500);
  await p.click('nav.tabs button[data-view=rota]'); await sleep(200);
  await p.locator('#view-rota input[type=file]').first().setInputFiles(['main.xlsx', 'nurses.xlsx', 'fsed.xlsx', 'uv.xlsx'].map(data).filter(f => fs.existsSync(f))); await sleep(2500);
  await p.click('.work-seg button:has-text("People")'); await sleep(250);
  return { c, p };
}
const S = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')));
const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const search = async (p, q) => { await p.fill('#view-rota .dir-search', q); await sleep(200); };
const sheetOf = async (p, q) => { await search(p, q); await p.click('#view-rota .dir-item .dir-nm >> nth=0'); await sleep(350); };
const closeAll = (p) => p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));

{
  const { c, p } = await open();
  console.log('own sheet');
  await sheetOf(p, meP.name);
  const stats = await p.locator('.sheet .pr-stats').innerText();
  check(!/with you/.test(stats), 'no "with you" tile on your own sheet'); check(await p.locator('.sheet .pr-with').count() === 0, 'no "with you" dots on your own sheet');
  await p.screenshot({ path: `${shots}/own-sheet-390.png` }); await closeAll(p);
  await search(p, meP.name); check(!/with you/.test(await p.locator('#view-rota .dir-item >> nth=0').innerText()), 'your own row does not say "shifts with you"');
  console.log('nights');
  await sheetOf(p, sfDoc[0].name); const t = (await p.locator('.sheet .pr-stats').innerText()).replace(/\s+/g, ' ');
  check(/\b0 nights\b/.test(t) && new RegExp(`\\b${sfDoc[1]} late\\b`).test(t), `SF doctor: 0 nights, ${sfDoc[1]} late → "${t}"`);
  await p.click('.sheet .pr-day:not(.t-off) >> nth=0'); await sleep(150); const det = await p.locator('.sheet .pr-detail').innerText();
  check(!/\d\d\/\d\d/.test(det.split('\n')[0]), 'day detail does not repeat the date: ' + det.split('\n')[0]);
  await closeAll(p);
  console.log('shift filter on every tab');
  await search(p, ''); const total = +(await p.locator('#view-rota .dir-seg button >> nth=0').getAttribute('aria-label')).match(/\d+/)[0];
  await p.click('#view-rota .dir-seg button:has-text("GPs")'); await sleep(200); await p.click('#view-rota .chip:has-text("On shift today")'); await sleep(200);
  const gpToday = await p.locator('#view-rota .dir-item').count(); await p.click('#view-rota .dir-seg button >> nth=0'); await sleep(200);
  check(await p.locator('#view-rota .chip.sel:has-text("On shift today")').count() === 1, 'All tab shows the active "On shift today" chip'); check(/on shift today/.test(await p.locator('#view-rota .tiny.dim >> nth=0').innerText().catch(() => '')) || /on shift today/.test(await p.innerText('#view-rota')), 'count line says the list is filtered');
  await p.click('#view-rota .chip:has-text("On shift today")'); await sleep(200);
  check(await p.locator('#view-rota .dir-item').count() === Math.min(150, total), `turning it off shows everyone again (${total})`); check(gpToday > 0, `GPs on shift today: ${gpToday}`);
  await p.click('#view-rota .chip:has-text("On now")'); await sleep(200); const nowN = await p.locator('#view-rota .dir-item').count(); check(nowN > 0 && nowN < total, `On now at 09:30: ${nowN}`); await p.click('#view-rota .chip:has-text("On now")'); await sleep(150);
  console.log('phone search');
  const withMob = gp.people.find(x => x.mobile && /^5\d{8}$/.test(String(x.mobile)));
  for (const q of ['0' + withMob.mobile, '+966' + withMob.mobile, '+966 ' + String(withMob.mobile).replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3')]) { await search(p, q); check(await p.locator(`#view-rota .dir-item:has-text("${withMob.name}")`).count() === 1, `search in the form ${q.startsWith('+966 ') ? '+966 5x xxx xxxx' : q.startsWith('+') ? '+9665…' : '05…'} finds the person`); }
  console.log('junk phone keeps Call');
  const other = gp.people.find(x => x !== meP && x !== withMob && x.mobile);
  await sheetOf(p, other.name); await p.click('.sheet button:has-text("numbers & socials")'); await sleep(250);
  await p.fill('.sheet input[type=tel] >> nth=0', 'abc'); await p.click('.sheet button:has-text("Save")'); await sleep(250);
  check(await p.locator('.sheet .pc-note.bad').count() >= 1, 'a junk phone is flagged'); await p.screenshot({ path: `${shots}/contact-bad-phone-390.png` }); check(!Object.values((await S(p)).contacts || {}).some(x => x.phone === 'abc'), '…and not saved');
  await closeAll(p);
  // an old junk phone saved before this check existed: seed it and open a fresh page (no reload of a live state)
  { const o = await open({ seed: { contacts: { [`id:${other.id}`]: { key: `id:${other.id}`, phone: 'abc', at: 1 } } } }); await search(o.p, other.name);
    check(/tel:\+966/.test(await o.p.locator('#view-rota .dir-item a.call').getAttribute('href').catch(() => '')), 'an old junk phone still falls back to the rota number for Call');
    await sheetOf(o.p, other.name); check(/not a number/.test(await o.p.locator('.sheet').innerText()), 'the sheet explains the saved phone is not a number'); await o.c.close(); }
  console.log('birthday into friends');
  const bdP = gp.people.find(x => x !== meP && x !== other && x !== withMob);
  await sheetOf(p, bdP.name); await p.click('.sheet button:has-text("numbers & socials")'); await sleep(250);
  await p.fill('.sheet input[type=date]', '1995-03-14'); await p.click('.sheet button:has-text("Save")'); await sleep(350);
  check(/Edit contact/.test(await p.locator('.sheet').innerText()), 'a birthday alone turns the button into "Edit contact"');
  await p.click('.sheet button:has-text("Edit contact")'); await sleep(250); await p.click('.sheet button:has-text("Add to friends")'); await sleep(400);
  const fr = Object.values((await S(p)).friends || {}).find(f => f.rotaKey === `id:${bdP.id}`);
  check(fr && fr.birthday === '1995-03-14', 'the saved birthday is on the new friend: ' + fr?.birthday); check(fr?.kind === 'gp', 'GP becomes a GP friend');
  check(await over(p) <= 0, 'no sideways scroll on People');
  console.log('roster'); if (errors.length) console.log(errors);
  await search(p, ''); await p.click('#view-rota .view-mode button:has-text("Roster grid")'); await sleep(350); 
  check(await p.locator('#view-rota .rg-foot').count() === 2 && /In clinics/.test(await p.innerText('#view-rota')), 'GP footer splits clinics from admin / off-site');
  check(await p.locator('#view-rota .rg-legend .rg-key').count() >= 5, 'roster has a legend'); check(await p.locator('#view-rota .rg-span').count() >= 1, 'a whole-month "Transferred" row is one label');
  const names = await p.locator('#view-rota .rg-name:not(.rg-corner):not(.rg-foot)').allInnerTexts(); check(new Set(names).size === names.length, `roster names are unique (${names.length})`);
  await p.screenshot({ path: `${shots}/roster-gp-390.png` });
  await p.click('#view-rota .rg-c:not(.t-off) >> nth=5'); await sleep(250); check(/Open that day/.test(await p.locator('.sheet').innerText()) && /Same shift|Nobody else/.test(await p.locator('.sheet').innerText()), 'cell sheet: same-shift people and Open that day'); await closeAll(p);
  await p.fill('#view-rota .rg-search', 'zzzz'); await sleep(250); check(/Nobody in this roster matches/.test(await p.innerText('#view-rota')), 'empty roster filter says so'); await p.fill('#view-rota .rg-search', ''); await sleep(250);
  await p.click('#view-rota .chips .chip:has-text("Nurses")'); await sleep(300);
  await p.locator('#view-rota .rg-scroll').evaluate(e => e.scrollLeft = 500); await sleep(100);
  const lab = await p.locator('#view-rota .rg-sec-l >> nth=1').boundingBox(), box = await p.locator('#view-rota .rg-scroll').boundingBox();
  check(lab && lab.x >= box.x - 1, `nurse group label stays in view when scrolled (x=${Math.round(lab?.x)})`);
  await p.screenshot({ path: `${shots}/roster-nurses-scrolled-390.png` });
  await p.click('#view-rota button[aria-label="Next month"]'); await sleep(250); check(/Go to November 2026/.test(await p.innerText('#view-rota')), 'empty month offers a way back'); await p.click('#view-rota button:has-text("Go to November 2026")'); await sleep(250);
  check(await p.locator('#view-rota .rg-sec').count() >= 3, 'the unit you picked (Nurses) stays picked across months');
  check(await over(p) <= 0, 'no sideways scroll on the roster page');
  await c.close();
}
// widths × interfaces: screenshots to look at, and no overflow / errors anywhere
for (const [w, ui] of [[320, 'clean'], [390, 'paper'], [1600, 'clean'], [1600, 'paper'], [390, 'arcade']]) {
  const { c, p } = await open({ w, hgt: w > 800 ? 1000 : 844, ui, time: w === 1600 ? '2026-11-13T21:30:00+03:00' : undefined });
  await p.screenshot({ path: `${shots}/${ui}-${w}-dir.png` });
  check(await over(p) <= 0, `${ui} ${w}px directory: no sideways scroll`);
  if (w === 320) { const hgt = await p.locator('#view-rota .dir-seg button >> nth=2').evaluate(e => e.getBoundingClientRect().height); check(hgt < 40, `segments stay one line at 320px (${hgt}px)`); }
  await sheetOf(p, sfDoc[0].name); await p.screenshot({ path: `${shots}/${ui}-${w}-person.png` }); await closeAll(p);
  await search(p, ''); await p.click('#view-rota .view-mode button:has-text("Roster grid")'); await sleep(350); await p.screenshot({ path: `${shots}/${ui}-${w}-roster.png` });
  check(await over(p) <= 0, `${ui} ${w}px roster: no sideways scroll`);
  await p.click('#view-rota .view-mode button:has-text("List")'); await sleep(150);
  await c.close();
}
check(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D02 ok'); process.exit(bad ? 1 : 0);
