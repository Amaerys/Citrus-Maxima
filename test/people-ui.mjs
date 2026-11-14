// Real files: GP rota + nurses' schedule + FSED/UV specialists → directory, postings, "nurses with me". Run: node test/people-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.resolve(here, 'shots/people'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const data = (f) => path.join(here, 'data', f); if (!fs.existsSync(data('nurses.xlsx'))) { console.log('no nurses.xlsx — skipped'); process.exit(0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage(); const errors = [];
await p.clock.install({ time: new Date('2026-11-09T07:30:00+03:00') });   // the real November files: pin the day so checks don't drift with the calendar
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi/.test(m.text())) errors.push(m.text()); });
await p.addInitScript(() => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); });
await p.goto(URL0); await sleep(600);
const txt = (s) => p.locator(s).first().innerText(), over = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tab = async (v) => { await p.click(`nav.tabs button[data-view=${v}]`); await sleep(250); }, work = async (l) => { await tab('rota'); await p.click(`.work-seg button:has-text("${l}")`); await sleep(250); };

console.log('import');
await tab('rota'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx'), data('nurses.xlsx'), data('fsed.xlsx'), data('uv.xlsx')]); await sleep(2500);
const keys = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('citrus.state.v1')).rotas));
check(keys.includes('nurse-2026-11') && keys.includes('gp-2026-11') && keys.includes('fsed-2026-11') && keys.includes('uv-2026-11'), 'all four schedules kept separately: ' + keys.join(', '));
check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).me.id) === '437326', 'nurse schedule did not change who "me" is');

console.log('nurses with me (day sheet)');
await p.click('.work-seg button:has-text("Calendar")'); await sleep(250); await p.click('#view-rota .cal .day:not(.pad) >> nth=8'); await sleep(400);
const sheetTxt = await p.locator('.sheet').innerText();
check(/Nurses at Upper Village/i.test(sheetTxt), 'card "Nurses at Upper Village" on a day I work there');
const maybe = await p.locator('.sheet .nr-row.maybe, .sheet .nr-chip').count(); check(maybe >= 5, `possible nurses listed (${maybe})`);
const names = await p.locator('.sheet .nr-row .nr-name span.ellipsis, .sheet .nr-chip').allTextContents(); check(!names.some(n => /Narita|Dhanya|Sillina|Kharmina/.test(n)), 'FSED / Aqua Arabia / Plateau nurses are never offered');
check(/candidates? for/i.test(sheetTxt) && /Who could be (with you|sent)/.test(sheetTxt), 'leads with how many could be sent (no fake "likely" names), not "nobody posted"'); check(await p.locator('.sheet .card.ov').count() === 1, 'doctor overlap card is still there, nurses are not mixed into it: ' + (await p.locator('.sheet .card.ov').innerText()).replace(/\n/g, ' ').slice(0, 120));
await p.screenshot({ path: `${shots}/day-nurses.png` }); await p.keyboard.press('Escape'); await sleep(150);

console.log('nurses board');
await work('Nurses'); check(/nurses on shift/.test(await txt('#view-rota')), 'staffing line');
const before = await p.locator('#view-rota .np-row').count(); check(before > 5, `unposted list (${before})`);
await p.click('#view-rota .np-row >> nth=0 >> button:has-text("UPV")'); await sleep(300);
check(await p.locator('#view-rota .np-row').count() === before - 1, 'posting moves a nurse out of the unposted list'); check(await p.locator('#view-rota .post-tile.UPV .post-row').count() === 1, 'she appears under Upper Village');
await p.screenshot({ path: `${shots}/nurses-board.png`, fullPage: true });
await p.click('.work-seg button:has-text("Calendar")'); await sleep(200); await p.click('#view-rota .cal .day:not(.pad) >> nth=8'); await sleep(400);
check(/1 posted with you/i.test(await p.locator('.sheet').innerText()), 'day sheet now says 1 posted with you'); check(await p.locator('.sheet .nr-row.sure').count() === 1, 'confirmed row has solid bar');
await p.screenshot({ path: `${shots}/day-nurses-posted.png` }); await p.keyboard.press('Escape'); await sleep(150);
await work('Nurses'); await p.click('#view-rota .post-tile.UPV .post-row .pr-main >> nth=0'); await sleep(250); check(await p.locator('#view-rota .post-tile.UPV .post-row').count() === 1 && await p.locator('.sheet .nb-state').count() === 1, 'tapping a posted nurse opens a chooser, it does not delete');
await p.click('.sheet button:has-text("Clear posting")'); await sleep(250); check(await p.locator('#view-rota .np-row').count() === before, 'clear from the chooser');
await p.click('#view-rota button:has-text("Tomorrow")'); await sleep(250); check(/Tue 10 Nov/.test(await txt('#view-rota')), 'day navigation');
check(await over() <= 0, 'no overflow on Nurses');

console.log('directory');
await work('People'); const chips = (await p.locator('#view-rota .dir-seg button').allInnerTexts()).map(c => c.replace(/\s+/g, ' ')); check(chips.some(c => /Nurses 50/.test(c)) && chips.some(c => /GPs 31/.test(c)) && chips.some(c => /Spec/.test(c)), 'categories with counts: ' + chips.join(' | '));
await p.click('#view-rota .dir-seg button:has-text("Nurses")'); await sleep(250); check(await p.locator('#view-rota .dir-item').count() === 50, 'all 50 nurses listed');
await p.click('#view-rota .chip:has-text("Team leaders")'); await sleep(250); check(await p.locator('#view-rota .dir-item').count() === 6, 'group filter: 6 team leaders'); await p.click('#view-rota .chip:has-text("All")'); await sleep(150);
await p.fill('#view-rota .dir-search', 'cresilda'); await sleep(200); check(await p.locator('#view-rota .dir-item').count() === 1, 'search by name');
check(/tel:\+966501215648/.test(await p.locator('#view-rota .dir-item a.call').getAttribute('href')) && /wa\.me\/966501215648/.test(await p.locator('#view-rota .dir-item a.wa').getAttribute('href')), 'phone and WhatsApp from the schedule’s mobile column');
await p.fill('#view-rota .dir-search', '0561666913'); await sleep(200); check(/Odai/.test(await txt('#view-rota .dir-item')), 'search by phone number finds the head nurse');
await p.fill('#view-rota .dir-search', 'cresilda'); await sleep(200); await p.click('#view-rota .dir-item .name'); await sleep(350);
check(/Team leaders/.test(await p.locator('.sheet').innerText()) && /Nurse/.test(await p.locator('.sheet .card .title >> nth=0').innerText()), 'person sheet shows nurse details'); check(await p.locator('.sheet .prota .pr-day').count() >= 28, 'her pretty month is there');
await p.screenshot({ path: `${shots}/person-sheet.png` }); await p.click('.sheet button:has-text("numbers & socials")'); await sleep(250);
await p.fill('.sheet input[placeholder="username or link"]', 'https://www.snapchat.com/add/cresi_b'); await p.fill('.sheet input[placeholder="@username or link"]', '@cresi.b'); await p.fill('.sheet input[type=date]', '1990-11-12'); await p.click('.sheet button:has-text("Save")'); await sleep(350);
check(await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).contacts || {}).some(c => c.birthday === '1990-11-12')), 'birthday saved on a nurse contact');
check(/snapchat.com\/add\/cresi_b/.test(await p.locator('.sheet').innerText().then(() => p.locator('.sheet a.snap').getAttribute('href'))), 'person sheet refreshes with the new handles'); await p.keyboard.press('Escape'); await sleep(200);
check(/snapchat\.com\/add\/cresi_b/.test(await p.locator('#view-rota .dir-item a.snap').getAttribute('href')) && /instagram\.com\/cresi\.b/.test(await p.locator('#view-rota .dir-item a.ig').getAttribute('href')), 'Snapchat and Instagram saved on a nurse, shown in the list');
await p.click('#view-rota .dir-item .name'); await sleep(300); await p.click('.sheet button:has-text("Edit contact")'); await sleep(250); await p.click('.sheet button:has-text("Add to friends")'); await sleep(400);
await tab('social'); await p.click('#view-social .seg button:has-text("Friends")'); await sleep(250); check(/Cresilda/.test(await txt('#view-social')) && await p.locator('#view-social .card.friend:has-text("Cresilda") a.snap').count() === 1, 'added to Social with her handles carried over');
await work('People'); await p.fill('#view-rota .dir-search', ''); await p.click('#view-rota .dir-seg button:has-text("Specialists")'); await sleep(250); const sp = await p.locator('#view-rota .dir-item').count(); check(sp >= 5, `ER specialists (FSED + villages) listed (${sp})`);
await p.fill('#view-rota .dir-search', 'tareq'); await sleep(200); check(/Tareq/.test(await txt('#view-rota .dir-item')), 'FSED consultant found');
await p.click('#view-rota .dir-seg button:has-text("GPs")'); await p.fill('#view-rota .dir-search', 'mariam'); await sleep(250); check(/Mariam Mahgoub/.test(await txt('#view-rota .dir-item')), 'GP found');
check(await over() <= 0, 'no overflow on People'); await p.screenshot({ path: `${shots}/directory.png` });

console.log('individual rota');
await work('People'); await p.click('#view-rota .dir-seg button:has-text("Nurses")'); await p.fill('#view-rota .dir-search', 'cresilda'); await sleep(250); await p.click('#view-rota .dir-item .name'); await sleep(350);
check(await p.locator('.sheet .pr-stats > div').count() >= 4, 'stat tiles'); check(await p.locator('.sheet .pr-day.today, .sheet .pr-day').count() >= 28, 'day tiles');
await p.click('.sheet .pr-day:not(.t-off) >> nth=0'); await sleep(200); check(await p.locator('.sheet .pr-detail').count() === 1, 'tap a day shows detail'); check(/Open that day/.test(await txt('.sheet .pr-detail')), 'detail links to the day');
check(await p.locator('.sheet .pr-key').count() >= 1, 'legend'); await p.screenshot({ path: `${shots}/individual-rota.png` });
const pm = await p.locator('.sheet .prota .btn.icon').count(); check(pm === 0, 'one month loaded: no dead month arrows'); await p.keyboard.press('Escape'); await sleep(200);

console.log('roster grid');
await p.fill('#view-rota .dir-search', ''); await p.click('#view-rota .view-mode button:has-text("Roster grid")'); await sleep(350);
check(await p.locator('#view-rota .rg-c').count() > 500, 'grid cells: ' + await p.locator('#view-rota .rg-c').count()); check(await p.locator('#view-rota .rg-foot').count() >= 1, 'on-duty footer');
check(await over() <= 0, 'page itself does not overflow (grid scrolls inside)');
await p.click('#view-rota .chips .chip:has-text("Nurses")'); await sleep(300); check(await p.locator('#view-rota .rg-sec').count() >= 5, 'nurse group headers in grid');
await p.fill('#view-rota .dir-search', 'cresilda'); await sleep(300); check(await p.locator('#view-rota .rg-name:not(.rg-corner):not(.rg-foot)').count() === 1, 'grid filter by name');
await p.click('#view-rota .rg-c >> nth=3'); await sleep(250); check(await p.locator('.sheet button:has-text("Open their rota")').count() === 1, 'cell opens day detail'); await p.click('.sheet button:has-text("Open their rota")'); await sleep(300); check(await p.locator('.sheet .prota').count() === 1, '→ individual rota');
await p.keyboard.press('Escape'); await sleep(200); await p.screenshot({ path: `${shots}/roster.png` });
await p.click('#view-rota .view-mode button:has-text("List")'); await sleep(250);

console.log('Today');
await tab('today'); check(/Nurses/.test(await p.locator('#view-today').innerText()) && /could be with you|posted with you/.test(await p.locator('#view-today').innerText()), 'Today card about nurses at my site');
check(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'people ui ok'); process.exit(bad ? 1 : 0);
