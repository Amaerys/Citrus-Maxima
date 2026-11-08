// Today: briefing, wind-down + rating, study planner — real rota, fixed clock. Run: node test/daily-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f); fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: skipped'); process.exit(0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0; const errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
await p.clock.install({ time: new Date('2026-11-09T07:30:00+03:00') });
await p.addInitScript(() => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); });
await p.goto(URL0); await p.clock.resume?.(); await sleep(600); await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2200); await p.click('nav.tabs button[data-view=today]'); await sleep(400);
let t = await p.locator('#view-today').innerText(); check(await p.locator('#view-today .brief2').count() === 1 && /Your morning/.test(t), 'morning briefing card'); check(/rostered this week/.test(t), 'week load line'); check(!/\b(null|undefined|NaN)\b/.test(t), 'no stray words on Today');
check(await p.locator('#view-today .rate').count() === 1 && /How was yesterday\?/.test(t), 'asks how yesterday was'); await p.click('#view-today .rate-f >> nth=3'); await sleep(250);
check(await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).dayLog || {})[0]?.score) === 4, 'rating saved'); check(await p.locator('#view-today .rate').count() === 0, 'question goes away once answered');
check(/Study/.test(t) && /Set up/.test(t), 'study card invites set-up'); await p.click('#view-today button:has-text("Set up")'); await sleep(250); await p.click('.sheet .chip:has-text("Step 1 pathology")'); await sleep(250); await p.click('.sheet .chip:has-text("Anatomy")'); await sleep(250);
check(await p.locator('.sheet .cr-key').count() >= 1 || /No free windows/.test(await p.locator('.sheet').innerText()), 'week plan lists blocks or says why not'); await p.keyboard.press('Escape'); await sleep(250);
check(await p.locator('#view-today .study-row').count() === 2, 'two subjects on Today'); await p.click('#view-today button[aria-label*="Log 30 minutes of Anatomy"]'); await sleep(250); t = await p.locator('#view-today').innerText(); check(/30 of 150 min this week/.test(t) && /🔥 1 day/.test(t), 'logging study updates the week bar and the streak');
await p.screenshot({ path: path.join(here, 'shots/today-daily.png'), fullPage: true });
await p.clock.setFixedTime(new Date('2026-11-09T21:30:00+03:00')); await p.reload(); await sleep(900); t = await p.locator('#view-today').innerText(); check(/Tonight/.test(t) && /Tomorrow:/.test(t), 'evening wind-down appears after 18:00'); check(/Be asleep by|Sleep until|no alarm|Day off tomorrow|On leave/.test(t), 'bedtime advice or day-off note');
await p.click('#view-today .rate-f >> nth=1'); await sleep(250); check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).dayLog['2026-11-09']?.score) === 2, 'evening rating saved for today');
await p.click('#view-today button[aria-label="Sleep settings"]'); await sleep(250); await p.fill('.sheet input >> nth=0', '7'); await p.click('.sheet button:has-text("Save")'); await sleep(250); check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).settings.day.sleepH) === 7, 'sleep target saved');
await p.screenshot({ path: path.join(here, 'shots/today-evening.png'), fullPage: true });
check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no overflow'); check(errors.length === 0, 'no page errors: ' + errors.join('|').slice(0, 200));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'daily ui ok'); process.exit(bad ? 1 : 0);
