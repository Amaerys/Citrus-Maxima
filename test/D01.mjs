// D01: Today hero "now" (nights after midnight), Who's in (last night's crew), who-is-me picker, safe Restore, sheets as dialogs.
// Run: node test/D01.mjs   (pure logic first, then the app in Playwright with the clock pinned in Asia/Riyadh)
import assert from 'node:assert/strict';
import { boardModel } from '../docs/js/board.js';
import { heroFocus, shortNames, withLastNight, teamAtSite } from '../docs/js/today-model.js';
import { checkBackup, describeCounts } from '../docs/js/backup-check.js';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, '—', e.message); } };

console.log('pure logic');
const E = (n, type, start, end, site = 'Upper Village') => ({ person: { name: n, id: n }, code: type, shift: { kind: 'work', type: type[0], label: type, site, hours: { start: start * 60, end: end * 60, overnight: end <= start, durationMin: 720 } } });
t('02:00: last night’s crew is in now, tonight’s crew is not', () => {
  const today = [E('Tonight1', 'N1', 20, 8), E('Day1', 'D1', 8, 20)], prev = [E('Last1', 'N1', 20, 8), E('Last2', 'N1', 20, 8), E('PrevDay', 'D1', 8, 20)];
  const m = boardModel(withLastNight(today, prev, 120), { nowMin: 120, keyOf: (p) => p.name, wrap: false });
  assert.equal(m.nowCount, 2); assert.deepEqual(m.rows.filter(r => r.prev).map(r => r.name).sort(), ['Last1', 'Last2']);
  assert.equal(m.now, 120); assert.equal(m.next.t, 480); assert.ok(m.rows.every(r => r.x1 > r.x0 || r.x1 === r.x0));
  // after 08:00 the night crew is gone from the board
  assert.equal(withLastNight(today, prev, 8 * 60).length, 2);
  // the board is for another day: nothing carried
  assert.equal(withLastNight(today, prev, null).length, 2);
});
t('the old wrap is gone for callers that ask (wrap:false)', () => { const m = boardModel([E('N', 'N1', 20, 8)], { nowMin: 120, wrap: false }); assert.equal(m.now, null); assert.equal(m.nowCount, 0); });
const W = (a, b) => ({ start: new Date(a), end: new Date(b) });
const night = { code: 'N2', shift: { type: 'N', hours: { overnight: true } }, window: W('2026-11-04T20:00:00+03:00', '2026-11-05T08:00:00+03:00') };
const tonight = { code: 'N2', shift: { type: 'N', hours: {} }, window: W('2026-11-05T20:00:00+03:00', '2026-11-06T08:00:00+03:00') };
const day = { code: 'D1', shift: { type: 'D', hours: {} }, window: W('2026-11-09T08:00:00+03:00', '2026-11-09T20:00:00+03:00') };
const tmrDay = { code: 'D1', shift: { type: 'D', hours: {} }, window: W('2026-11-10T08:00:00+03:00', '2026-11-10T20:00:00+03:00') };
const md = (today, tail, mine = today ? { shift: { kind: 'work' } } : { shift: { kind: 'off' } }) => ({ info: { mine }, today, overnightTail: tail, afterNight: !!tail });
t('hero: the night you are on at 03:00 wins over tonight’s shift', () => { const f = heroFocus(new Date('2026-11-05T03:00:00+03:00'), md(tonight, night), md(null, null), { tag: 'prev' }); assert.equal(f.kind, 'tail'); assert.equal(f.entry, night); assert.equal(f.info.tag, 'prev'); });
t('hero: after the night ends it is today again', () => { assert.equal(heroFocus(new Date('2026-11-05T08:00:00+03:00'), md(tonight, night), md(null, null), {}).kind, 'today'); assert.equal(heroFocus(new Date('2026-11-05T09:00:00+03:00'), md(null, night), md(null, null), {}).kind, 'none'); });
t('hero: after a day shift, tomorrow’s shift', () => { const f = heroFocus(new Date('2026-11-09T21:30:00+03:00'), md(day, null), md(tmrDay, null), {}); assert.equal(f.kind, 'tomorrow'); assert.equal(f.doneToday, true); assert.equal(heroFocus(new Date('2026-11-09T21:30:00+03:00'), md(day, null), md(null, null), {}).kind, 'done'); });
t('hero: a free evening turns to tomorrow, a free morning does not', () => { assert.equal(heroFocus(new Date('2026-11-09T19:00:00+03:00'), md(null, null), md(tmrDay, null), {}).kind, 'tomorrow'); assert.equal(heroFocus(new Date('2026-11-09T10:00:00+03:00'), md(null, null), md(tmrDay, null), {}).kind, 'none'); });
t('names stay unique when first names collide', () => {
  const n = shortNames([{ name: 'Dr. Ahmed Abdulbaqi', id: '1' }, { name: 'Dr. Ahmed Elhassan', id: '2' }, { name: 'Dr. Mariam Ali', id: '3' }, { name: 'Dr. Mohammed Faisal Omar', id: '4' }, { name: 'Dr. Mohammed Fathi Saleh', id: '5' }]);
  assert.equal(n.get('id:1'), 'Ahmed A.'); assert.equal(n.get('id:2'), 'Ahmed E.'); assert.equal(n.get('id:3'), 'Mariam'); assert.equal(n.get('id:4'), 'Mohammed Omar'); assert.equal(n.get('id:5'), 'Mohammed Saleh');
});
t('team = your site only; other sites counted', () => {
  const mine = E('Me', 'D1', 8, 20), same = E('Same', 'D1', 8, 20), eve = E('Eve', 'E2', 10, 22), lv = E('Lv', 'D2', 8, 20, 'Lower Village');
  const r = teamAtSite({ mine, withMe: [same], alsoAtSite: [eve], gp: [mine, same, eve, lv] });
  assert.deepEqual(r.rows.map(x => x.entry.person.name), ['Same', 'Eve']); assert.equal(r.otherSites, 1); assert.equal(r.rows[0].same, true);
  assert.equal(teamAtSite({ mine: { shift: { kind: 'off' } } }).rows.length, 0);
});
t('restore check: not a backup', () => { for (const j of [null, 5, 'x', [], {}, { rotas: 5 }, { rotas: [] }]) assert.equal(checkBackup(j).ok, false, JSON.stringify(j)); });
t('restore check: damaged parts are dropped and listed', () => {
  const r = checkBackup({ me: { name: 'Dr. Test', id: '1' }, rotas: { x: { people: 'no' }, good: { people: [{ name: 'A', days: {} }], legend: {}, year: 2026, month: 11, unitKind: 'gp' } }, plan: { '2026-11-13': 'str', '2026-11-14': [{ id: 'a' }, 7] }, tasks: { a: 'oops', b: { title: 'ok' } }, notes: { '2026-11-13': 'text stays' }, goals: 'nope' });
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.state.rotas), ['good']); assert.equal(r.state.plan['2026-11-13'], undefined); assert.equal(r.state.plan['2026-11-14'].length, 1);
  assert.deepEqual(Object.keys(r.state.tasks), ['b']); assert.equal(r.state.notes['2026-11-13'], 'text stays'); assert.equal(r.state.goals, undefined); assert.ok(r.dropped.length >= 4);
  assert.equal(r.summary.me, 'Dr. Test'); assert.deepEqual(r.summary.rotas, ['GP Nov 2026']); assert.match(describeCounts(r.summary.counts), /1 rota · 1 plan day · 1 task/);
});

// ───────── in the app
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D01'); fs.mkdirSync(shots, { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log(bad ? `${bad} FAILED` : 'D01 ok (no xlsx: app part skipped)'); process.exit(bad ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
const ME = { name: 'Dr. Reem Mahgoub', id: '437326' }, FILES = ['main.xlsx', 'fsed.xlsx', 'uv.xlsx', 'nurses.xlsx'].filter(f => fs.existsSync(data(f))).map(data);
async function open(time, { me = ME, width = 390, height = 844, ui = 'clean', files = FILES } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 800, hasTouch: width < 800, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${time}: ${e.message}`)); await p.clock.install({ time: new Date(time) });
  await p.addInitScript(([m, u]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('citrus.state.v1', JSON.stringify(m ? { me: m } : {})); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); } }, [me, ui]);
  await p.goto(URL0); await sleep(500); await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles(files); await sleep(2200);
  return p;
}
const today = async (p) => { await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove())); await p.click('nav.tabs button[data-view=today]'); await sleep(350); };
const heroText = (p) => p.locator('#view-today .card.hero').innerText().then(x => x.replace(/\s+/g, ' '));
const meOf = (p) => p.evaluate(() => window.__citrus.store.get().me);

console.log('who is me: never guessed');
{
  const p = await open('2026-11-09T09:30:00+03:00', { me: null });
  check(await meOf(p) === null, 'after the first import nobody is picked silently');
  check(await p.locator('.sheet .me-pick').count() === 1 && await p.locator('.sheet[role=dialog]').count() === 1, '"Which one is you?" opens straight away, as a dialog');
  await p.fill('.sheet .me-pick input[type=search]', 'reem'); await sleep(150);
  const rows = await p.locator('.sheet .me-row').count(); check(rows === 1, `search narrows the list (${rows} row)`);
  await p.click('.sheet .me-row'); await sleep(300); const me = await meOf(p);
  check(me?.id === '437326' && await p.locator('.sheet-bg').count() === 0, 'tapping your row saves you: ' + me?.name);
  await today(p); check(/Day · Upper Village/.test(await heroText(p)), 'Today now shows your D1');
  await p.click('#btnMore'); await sleep(300); check(await p.locator('#me-select optgroup').count() >= 2, 'Settings › Me lists GP and specialist rows, grouped');
  await p.context().close();
}
{
  const p = await open('2026-11-09T09:30:00+03:00', { me: { name: 'Dr. Reem Mahgoub', id: '999999' } }); await today(p);
  const hero = await heroText(p); check(/not in the November GP rota/.test(hero) && !/Day off/.test(hero), 'an ID the rota does not have is flagged, not shown as a day off');
  await p.click('#view-today .card.hero button:has-text("That’s me")'); await sleep(300); check((await meOf(p)).id === '437326' && /Day · Upper Village/.test(await heroText(p)), '"That’s me" takes the row with your exact name');
  await p.context().close();
}

console.log('hero and Who’s in after midnight');
{
  const p = await open('2026-11-05T03:00:00+03:00'); await today(p);
  const hero = await heroText(p);
  check(/Night · Lower Village/.test(hero) && /5h left · ends 08:00/.test(hero) && !/Off, after a night/.test(hero), '03:00 on the N2 from yesterday: the hero shows the shift you are on, 5h left');
  check(await p.locator('#view-today .card.hero .sp-bar').count() === 1, 'with its progress bar');
  check(/until 08:00/.test(await p.locator('#view-today .dial').textContent()) && /N2 until 08:00/.test(await p.locator('#view-today .dial').getAttribute('aria-label')), 'the dial names the running night');
  const board = p.locator('#view-today .card.board'); const sum = await board.locator('.row .dim').first().innerText();
  const prevRows = await board.locator('.bd-row.prev').count(), meRow = await board.locator('.bd-row.me.prev').count();
  check(prevRows >= 1 && meRow === 1 && sum.startsWith(`${prevRows} in now`), `Who's in counts last night's crew (${sum}; ${prevRows} carried, you among them)`);
  await p.screenshot({ path: `${shots}/phone-0300-night.png` }); await p.context().close();
}
{
  const p = await open('2026-11-04T02:00:00+03:00'); await today(p);
  const hero = await heroText(p); check(/since yesterday/.test(hero) && /Next Night · Lower Village 20:00–08:00 · in 18h/.test(hero) && !/Starts in 18h/.test(hero), '02:00 between two nights: the running one leads, tonight is "Next"');
  check(/Mishal/.test(await p.locator('#view-today .card.hero .tm').innerText()), 'team pills are the colleagues on with you now');
  await p.context().close();
}
{
  const p = await open('2026-11-09T07:30:00+03:00'); await today(p);
  const pills = await p.locator('#view-today .card.hero .tm-line').first().locator('.tm-pill').allInnerTexts();
  check(pills.some(x => /Mariam/.test(x)) && pills.some(x => /other sites/.test(x)) && !pills.some(x => /Amro|Elamin|Abdulhameed/.test(x)), 'Doctors = your site only, other sites as a count: ' + pills.join(', ').replace(/\n/g, ' '));
  const sum = await p.locator('#view-today .card.board .row .dim').first().innerText(); check(/^2 in now/.test(sum) && await p.locator('#view-today .card.board .bd-row.prev').count() === 2, `07:30 at Upper Village: the 2 night doctors still in, not tonight's (${sum})`);
  check(await p.locator('#view-today .card.hero .tm-line:has-text("Nurses") .tm-pill').count() <= 6 && !/\d\d%/.test(await heroText(p)), 'no 25% nurse guesses in the hero');
  check(/Ali\s*09–21/.test(await heroText(p)), 'specialist with hours');
  const wd = p.locator('#view-today .week button.wd'); check(await wd.count() === 7 && /Monday 9 November, D1/.test(await wd.first().getAttribute('aria-label')), 'week strip days are named buttons');
  check(/60h this week · 12h over 48h · Sun 8–Sat 14/.test(await p.locator('#view-today .wk-hours').innerText()), 'the hours bar names its Sun–Sat week');
  await p.screenshot({ path: `${shots}/phone-0730-day.png` });
  // sheets: the top one closes first, focus and Back behave
  await wd.nth(1).click(); await sleep(300); check(await p.locator('.sheet[role=dialog][aria-modal=true][aria-labelledby]').count() === 1, 'day sheet is a labelled modal dialog');
  await p.locator('.sheet .pill').first().click(); await sleep(300); check(await p.locator('.sheet-bg').count() === 2, 'person sheet opens on top');
  await p.keyboard.press('Escape'); await sleep(200); check(await p.locator('.sheet-bg').count() === 1 && /Tuesday/.test(await p.locator('.sheet h2').first().innerText()), 'Escape closes the top sheet, the day sheet stays');
  await p.goBack(); await sleep(300); check(await p.locator('.sheet-bg').count() === 0 && await p.evaluate(() => document.querySelector('section.view.active').id) === 'view-today', 'Back closes the last sheet and stays on Today');
  check(await p.evaluate(() => !document.documentElement.classList.contains('sheet-open')), 'page scrolls again');
  await p.context().close();
}
{
  const p = await open('2026-11-09T21:30:00+03:00'); await today(p);
  const hero = await heroText(p); check(/shift done ✓/.test(hero) && /Tomorrow · Day · Upper Village/.test(hero) && /Ahmed E\./.test(hero), 'evening after the shift: the hero turns to tomorrow and its team');
  await p.context().close();
}
{
  const p = await open('2026-11-30T21:30:00+03:00', { me: { name: 'Dr. Abeer Eshag', id: '437765' } }); await today(p);
  const hero = await heroText(p); check(/December not loaded/.test(hero) && !/Tomorrow off/.test(hero), '30 Nov with no December rota: tomorrow is unknown, not off');
  check(await p.locator('#view-today .week .wd.unk').count() === 6, 'unknown days are drawn as "?"');
  const wk = await p.locator('#view-today .wk-hours').innerText().catch(() => ''); check(!wk || /so far · Dec not loaded/.test(wk), 'week hours do not claim a full week: ' + wk);
  await p.context().close();
}

console.log('restore');
{
  const p = await open('2026-11-09T09:30:00+03:00'); await p.click('#btnMore'); await sleep(300);
  const inp = p.locator('#view-more input[type=file][accept*=json]'), file = (name, obj) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  const rotasNow = () => p.evaluate(() => Object.keys(window.__citrus.store.get().rotas).length), before = await rotasNow();
  await inp.setInputFiles(file('junk.json', '{not json')); await sleep(300); check(await rotasNow() === before && await p.locator('.sheet-bg').count() === 0, 'not-JSON: refused, nothing changed');
  await inp.setInputFiles(file('five.json', { rotas: 5 })); await sleep(300); check(await rotasNow() === before && /no rotas section/.test(await p.locator('#toasts').innerText()), '{"rotas":5}: refused with a reason');
  await inp.setInputFiles(file('empty.json', { rotas: {} })); await sleep(300); check(await p.locator('.sheet:has-text("Restore this backup?")').count() === 1, '{"rotas":{}} asks first (shows what it holds)');
  await p.click('.sheet button:has-text("Cancel")'); await sleep(200); check(await rotasNow() === before && (await meOf(p))?.id === '437326', 'Cancel: nothing changed');
  await inp.setInputFiles(file('empty.json', { rotas: {} })); await sleep(300); check(await p.locator('.sheet').count() === 1, 'the same file can be picked again');
  await p.click('.sheet button:has-text("Cancel")'); await sleep(200);
  await inp.setInputFiles(file('mal.json', { me: { name: 'Dr. Reem Mahgoub', id: '437326' }, rotas: { x: { people: 'no' } }, plan: { '2026-11-13': 'str' }, tasks: { a: 5 } })); await sleep(300);
  check(/Left out: \d+ damaged/.test(await p.locator('.sheet').innerText()), 'a damaged backup lists what it leaves out');
  await p.click('.sheet button:has-text("Replace everything")'); await sleep(500);
  check(await rotasNow() === 0, 'Replace: the backup is in place'); await p.click('nav.tabs button[data-view=today]'); await sleep(300);
  check(await p.locator('#view-today .card').count() >= 1, 'and every tab still draws (Today has cards)');
  for (const v of ['rota', 'plan', 'mind', 'social', 'apps']) { await p.click(`nav.tabs button[data-view=${v}]`); await sleep(150); }
  check(errors.length === 0, 'no page errors after the restore: ' + errors.join(' | ').slice(0, 200));
  await p.click('#btnMore'); await sleep(300); check(await p.locator('#view-more button:has-text("Undo restore")').count() === 1, 'Settings offers "Undo restore"');
  await p.click('#view-more button:has-text("Undo restore")'); await sleep(500); check(await rotasNow() === before, `Undo brings the ${before} rotas back`);
  await p.screenshot({ path: `${shots}/phone-settings.png` }); await p.context().close();
}

console.log('screens');
for (const [ui, w, hgt] of [['clean', 390, 844], ['paper', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000], ['arcade', 390, 844], ['clean', 320, 700]]) {
  const p = await open('2026-11-05T03:00:00+03:00', { ui, width: w, height: hgt }); await today(p);
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `${ui} ${w}px: no sideways scroll`);
  await p.screenshot({ path: `${shots}/${w}-${ui}-night.png`, fullPage: w > 800 }); await p.context().close();
}
check(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D01 ok'); process.exit(bad ? 1 : 0);
