// D14 — Briefing, Tonight, day ratings, study: the small-hours night, prep time, countdown past midnight, honest nurse line,
// Copy = what you see, one rating prompt, changeable ratings, sleep-sheet validation, study double taps + undo. Run: node test/D14.mjs
// Unit part on a made-up rota; browser part READS the real test/data/main.xlsx (no names are printed).
import assert from 'node:assert/strict';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const D = await import('../docs/js/daily.js');
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const days = {}; for (let d = 1; d <= 30; d++) days[d] = [3, 4, 10, 11, 17, 18, 24, 25].includes(d) ? 'N1' : [5, 6, 12, 13, 19, 20, 26, 27].includes(d) ? '' : 'D1';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' } }, people: [{ name: 'Dr Me', id: '1', days }, { name: 'Dr Ann', id: '2', days }] };
const s0 = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, settings: {} };
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);

console.log('unit');
await t('T01-06: at 02:00 the plan is for TODAY\'s 08:00 shift, with the sleep still possible', () => {
  const w = D.windDown(s0, at(9, 2)); assert.equal(w.dayWord, 'Today'); assert.ok(w.work && !w.night); assert.ok(w.sleepNow); assert.equal(w.sleepMin, 270, '02:00 → up at 06:30 = 4h30');
  const off = D.windDown(s0, at(6, 2)); assert.equal(off.dayWord, 'Today'); assert.match(off.label, /Day off/);
  assert.equal(D.windDown(s0, at(9, 21)).dayWord, 'Tomorrow');
});
await t('T01-07: "ready for" is the shift start, whatever the prep time', () => {
  const w = D.windDown({ ...s0, settings: { day: { sleepH: 6, prepMin: 60 } } }, at(8, 21, 30)); assert.equal(w.start, 480); assert.equal(w.wake, 420); assert.equal(w.wake + 60, w.start);
});
await t('T01-09: the countdown works when bedtime is after midnight', () => {
  const w = D.windDown({ ...s0, settings: { day: { sleepH: 8, prepMin: 0 } } }, at(8, 21, 30)); assert.equal(w.bed, 0); assert.equal(w.minutesToBed, 150, '21:30 → 00:00');
  const e = D.windDown(s0, at(8, 21, 30)); assert.equal(e.minutesToBed, 60, '21:30 → 22:30'); assert.ok(!e.sleepNow);
  const late = D.windDown(s0, at(8, 23, 30)); assert.ok(late.sleepNow && late.sleepMin === 420, 'past bedtime: sleep now, 7h possible');
});
await t('T01-25: hours are not said twice when the label already has them', () => {
  assert.equal(D.shiftLabel({ label: 'SF shift (13:00–01:00)', hours: hrs(780, 60, 1) }), 'SF shift (13:00–01:00)');
  assert.equal(D.shiftLabel({ label: 'Day · Upper Village', hours: hrs(480, 1200) }), 'Day · Upper Village, 08:00–20:00');
  const b = D.briefing(s0, at(9, 7)); assert.equal((b[0].text.match(/08:00/g) || []).length, 1);
});
await t('D03 nurse outputs: "likely" only with history, otherwise the shared summary; head nurse on its own line', () => {
  const P = (n) => ({ person: { name: n } }), base = { hasNurses: true, confirmed: [], tipped: [], possible: [P('Ann Test'), P('Bo Test')], likely: [], head: [], summary: '2 could be sent, not posted yet' };
  assert.equal(D.nurseLine(base).text, 'Nurses: 2 could be sent, not posted yet', 'no history: no names called "likely"');
  assert.equal(D.nurseLine({ ...base, likely: [P('Ann Test')] }).text, 'Nurses likely with you: Ann');
  assert.equal(D.nurseLine({ ...base, confirmed: [P('Cy Test')] }).text, 'Nurses posted with you: Cy');
  assert.match(D.nurseLine({ ...base, tipped: [{ ...P('Di Test'), guess: true }] }).text, /guessed from last time: Di/);
  assert.equal(D.nurseLine({ ...base, head: [P('Hal Test')] }).head, 'Head nurse on today: Hal'); assert.equal(D.nurseLine(null), null); assert.equal(D.nurseLine({ hasNurses: false }), null);
});
await t('T01-14: Copy text = the date + exactly the card\'s lines', () => {
  const b = D.briefing(s0, at(9, 7)), txt = D.briefingText(b, at(9, 7)); assert.equal(txt.split('\n')[0], 'Monday 9 Nov'); for (const l of b) assert.ok(txt.includes(l.text)); assert.equal(txt.split('\n').length, b.length + 1);
});
await t('T01-10: sleep settings are checked, not silently replaced', () => {
  assert.ok(!D.checkSetting('sleepH', '').ok); assert.ok(!D.checkSetting('prepMin', -5).ok); assert.match(D.checkSetting('prepMin', -5).msg, /15–240/); assert.equal(D.checkSetting('sleepH', '7.5').value, 7.5); assert.equal(D.checkSetting('prepMin', '60').value, 60);
});
await t('T06-22: study blocks for one day, shaped for the Plan tab, never the ones the planner already holds', () => {
  const s = D.saveSubject(s0, { name: 'Anatomy', perWeek: 300, block: 45 }), now = at(9, 7);
  const bl = D.studyBlocksOn(s, at(10, 0), { now }); for (const b of bl) { assert.equal(b.kind, 'study'); assert.match(b.title, /^Study · Anatomy/); assert.ok(b.end - b.start === 45); }
  const planned = (d) => d.getDate() === 9 ? [{ title: 'Anatomy review', start: 1260, end: 1305 }] : []; assert.equal(D.studyBlocksOn(s, at(9, 0), { now, planned }).length, 0);
});

// ───────── browser
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots'); fs.mkdirSync(shots, { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: browser part skipped'); console.log(fails ? `${fails} FAILED` : 'D14 ok'); process.exit(fails ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
const check = (c, m) => { if (!c) { fails++; console.log('  ✗', m); } else console.log('  ✓', m); };
// Fonts and Google are blocked so the page settles fast and offline.
async function open(time, { wide = false, ui = '', w = 390 } = {}) {
  const c = await browser.newContext({ viewport: wide ? { width: 1600, height: 1000 } : { width: w, height: 844 }, isMobile: !wide, hasTouch: !wide, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await c.newPage(), errors = [];
  await c.route(/fonts\.(googleapis|gstatic)\.com|accounts\.google\.com|apis\.google\.com/, r => r.abort()); p.on('pageerror', e => errors.push(e.message));
  await p.clock.install({ time: new Date(time) });
  await p.addInitScript((ui) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); if (ui) localStorage.setItem('citrus.ui', JSON.stringify({ ui })); window.__copied = ''; }, ui);
  await p.goto(URL0); await sleep(700); await shut(p);
  await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2000); await shut(p);
  await p.click('nav.tabs button[data-view=today]'); await sleep(400); await shut(p);
  await p.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (x) => { window.__copied = x; } }, configurable: true }); } catch {} });
  return { c, p, errors };
}
async function shut(p) { for (let i = 0; i < 3 && await p.locator('.sheet-bg').count(); i++) { await p.keyboard.press('Escape'); await sleep(250); } }
const txt = (p, sel) => p.locator(sel).first().innerText().catch(() => '');
const sheet = async (p, name) => { await p.screenshot({ path: path.join(shots, `D14-${name}.png`), fullPage: false }); };

console.log('browser');
{ // Tue 10 Nov 02:00, D1 at 08:00 the same morning
  const { c, p, errors } = await open('2026-11-10T02:00:00+03:00'); const w = await txt(p, '#view-today .wind');
  check(/Today: Day · Upper Village, 08:00–20:00/.test(w) && !/08:00–20:00, 08:00/.test(w), 'T01-06/25: at 02:00 Tonight plans today\'s 08:00 shift, hours once');
  check(/Sleep now: 4h 30m possible/.test(w) && /ready for 08:00/.test(w), 'T01-06/07: "Sleep now: 4h 30m possible", ready for the shift start');
  check(await p.locator('#view-today .rate').count() === 1 && /How was Monday\?/.test(w), 'T01-12: one rating prompt at 02:00, naming the day');
  check(/Overnight/.test(await txt(p, '#view-today .brief2 summary')), 'T01-12: the 02:00 brief is "Overnight", not "Your morning"');
  check(errors.length === 0, 'no page errors (02:00): ' + errors.join('|').slice(0, 160)); await sheet(p, '0200'); await c.close();
}
{ // Tue 3 Nov 21:30, 1.5 h into a night shift
  const { c, p } = await open('2026-11-03T21:30:00+03:00'), w = await p.locator('#view-today .wind').first().textContent().catch(() => '');   // folded: textContent, not innerText
  check(/On shift until/.test(w) && !/Sleep until|Be asleep by/.test(w), 'T01-11: on a night shift Tonight gives no sleep advice');
  check(await p.locator('#view-today .more-today .wind').count() === 1 || !(await p.locator('#view-today .wind').count()), 'T01-11: and it folds under More, below Who\'s in / Nurses'); await c.close();
}
{ // Sun 8 Nov 21:30, D2 tomorrow at 08:00 (a fresh load: no reload in between)
  const { c, p, errors } = await open('2026-11-08T21:30:00+03:00'); let w = await txt(p, '#view-today .wind');
  check(/Be asleep by 22:30/.test(w) && /in 1h\b/.test(w), `T01-09: countdown chip shows (${(w.match(/in \dh[^\n]*/) || [''])[0]})`);
  await p.click('#view-today .wind .rate-f >> nth=2'); await sleep(250);
  check(await p.locator('#view-today .wind .rate-f.sel').count() === 1 && /tap to change/.test(await txt(p, '#view-today .wind .rate')), 'T01-13: the pick stays shown, with "tap to change"');
  await p.click('#view-today .wind .rate-f >> nth=4'); await sleep(250); check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).dayLog['2026-11-08']?.score) === 5, 'T01-13: a mis-tap can be changed');
  await p.click('#view-today button[aria-label="Sleep settings"]'); await sleep(250);
  check(await p.locator('.sheet label[for="sl-sleepH"]').count() === 1 && await p.locator('.sheet #sl-sleepH').count() === 1, 'T01-10: labels are linked to their inputs');
  await p.fill('.sheet #sl-sleepH', ''); await sleep(80); check(/Enter a number/.test(await txt(p, '.sheet #sl-sleepH-err')) && await p.locator('.sheet button:has-text("Save")').isDisabled(), 'T01-10: an empty value says why and Save waits');
  await p.fill('.sheet #sl-prepMin', '-5'); await sleep(80); check(/15–240/.test(await txt(p, '.sheet #sl-prepMin-err')), 'T01-10: a negative prep time says the range');
  await sheet(p, 'sleep-sheet');
  await p.fill('.sheet #sl-sleepH', '6'); await p.fill('.sheet #sl-prepMin', '60'); await sleep(80); await p.click('.sheet button:has-text("Save")'); await sleep(300);
  w = await txt(p, '#view-today .wind'); check(/up at 07:00 to be ready for 08:00/.test(w) && /Be asleep by 01:00/.test(w), 'T01-07: prep 60 → up 07:00, ready for 08:00; bed 01:00');
  check(/in 3h 30m/.test(w), 'T01-09: countdown to a bedtime after midnight');
  await sheet(p, '2130'); check(errors.length === 0, 'no page errors (21:30): ' + errors.join('|').slice(0, 160)); await c.close();
}
for (const ui of ['', 'paper']) for (const wide of [false, true]) { // Mon 9 Nov 07:30: brief, Copy = card, study taps
  const { c, p, errors } = await open('2026-11-09T07:30:00+03:00', { wide, ui }), tag = `${wide ? 1600 : 390}-${ui || 'clean'}`;
  if (!wide && !ui) {
    const lines = await p.locator('#view-today .brief2 .ch-line').allInnerTexts(); await p.click('#view-today .brief2 button:has-text("Copy")'); await sleep(150); const cp = await p.evaluate(() => window.__copied);
    check(lines.length > 2 && lines.every(l => cp.includes(l.replace(/\s+/g, ' ').trim().split(' ').slice(1).join(' ').slice(0, 20))) && cp.split('\n').length === lines.length + 1, 'T01-14: Copy sends the card\'s own lines, nothing else');
    check(!/FSED:|Plan:/.test(cp), 'T01-14: no hidden extras in the copied text');
  }
  await p.evaluate(() => { const d = document.querySelector('#view-today .more-today'); if (d) d.open = true; }); await sleep(100);
  if (await p.locator('#view-today .study-card button:has-text("Set up")').count()) { await p.click('#view-today .study-card button:has-text("Set up")'); await sleep(250); await p.click('.sheet .chip:has-text("Anatomy")'); await sleep(250); await shut(p); await sleep(200); }
  if (!wide && !ui) {
    const plus = p.locator('#view-today button[aria-label*="Log 30 minutes of Anatomy"]'); await plus.dblclick(); await sleep(300);
    const mins = () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).studyLog || {}).reduce((a, x) => a + x.mins, 0));
    check(await mins() === 30, 'T01-24: a double tap on +30 logs 30, not 60');
    check(await p.locator('#view-today button[aria-label*="Take 15 minutes off Anatomy"]').count() === 1, 'T01-24: a −15 shows once something is logged');
    check(await p.locator('#toasts .toast.undo').count() === 1, 'T01-24: an undo toast'); await p.click('#toasts .toast.undo button'); await sleep(250); check(await mins() === 0, 'T01-24: undo takes it back');
  }
  await p.evaluate(() => document.querySelector('#view-today .study-card')?.scrollIntoView()); await sleep(100); await sheet(p, `0730-${tag}`);
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `no sideways scroll (${tag})`); check(errors.length === 0, `no page errors (${tag}): ` + errors.join('|').slice(0, 160)); await c.close();
}
{ // 320 px squeeze, small hours
  const { c, p } = await open('2026-11-10T02:00:00+03:00', { w: 320 }); check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll at 320px'); await sheet(p, '0200-320'); await c.close();
}
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'D14 ok'); process.exit(fails ? 1 : 0);
