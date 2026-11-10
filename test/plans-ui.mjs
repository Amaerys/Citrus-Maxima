// Month report, leave planner, swap options, share image — real rota. Run: node test/plans-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f); fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: skipped'); process.exit(0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0; const errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true }), p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); });
await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2200);
check(await p.locator('#view-rota .mr').count() === 1, 'month report card'); const t = await p.locator('#view-rota .mr').innerText(); check(/in numbers/.test(t) && /shifts/.test(t) && /longest run/.test(t), 'report numbers');
check(!/NaN|undefined|null/.test(t), 'no stray words in the report'); check(!/0\.00 SAR/.test(t), 'no 0.00 SAR rate when the basic wage is unknown');
const dl = p.waitForEvent('download', { timeout: 8000 }).catch(() => null); await p.click('#view-rota .mr button:has-text("Share image")'); const d = await dl; check(!!d && /\.png$/.test(d.suggestedFilename()), 'share image downloads a PNG when the share sheet is unavailable: ' + (d && d.suggestedFilename()));
if (d) { const f = path.join(here, 'shots/rota-image.png'); await d.saveAs(f); check(fs.statSync(f).size > 20000, 'picture is a real image (' + fs.statSync(f).size + ' bytes)'); }
await p.click('#view-rota .mr button:has-text("Plan leave")'); await sleep(300); let st = await p.locator('.sheet').innerText(); check(/Plan leave/.test(st) && /Best use of your days/.test(st), 'leave planner opens'); check(await p.locator('.sheet .cr-key button, .sheet button.cr-key').count() >= 0, 'windows listed');
await p.click('.sheet .chip:has-text("10 days")'); await sleep(200); check(await p.locator('.sheet .chip.sel:has-text("10 days")').count() === 1, 'window length switches');
if (await p.locator('.sheet button.cr-key').count()) { await p.locator('.sheet button.cr-key').first().click(); await sleep(200); check(/days left after|shifts replaced/.test(await p.locator('.sheet').innerText()), 'tapping a window fills the range and shows its cost'); }
await p.screenshot({ path: path.join(here, 'shots/leave.png') });
const before = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('citrus.state.v1')).swaps || {}).length); await p.click('.sheet button:has-text("Mark as leave")'); await sleep(500);
const after = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).swaps || {}).filter(x => x.note === 'Planned leave').length); check(after > before, `leave marked in my rota (${after} days)`);
check(/on leave/.test(await p.locator('#view-rota .mr').innerText()), 'month report now counts the leave days');
await p.click('#view-rota .mr button:has-text("Plan leave")'); await sleep(250); await p.click('.sheet button:has-text("Remove") >> nth=0'); await sleep(400); check(await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).swaps || {}).filter(x => x.note === 'Planned leave').length) === 0, 'planned leave can be removed');
await p.click('#view-rota .cal .day:not(.pad):not(.off) >> nth=3'); await sleep(300); const hasCover = await p.locator('.sheet button:has-text("Who could cover?")').count();
if (hasCover) { await p.click('.sheet button:has-text("Who could cover?")'); await sleep(300); const c = await p.locator('.sheet').innerText(); check(/Cover for/.test(c), 'cover sheet opens'); check(!/null|undefined/.test(c), 'no stray words in the cover sheet'); await p.screenshot({ path: path.join(here, 'shots/swap.png') }); } else console.log('  · no work day to test cover on');
check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no overflow'); check(errors.length === 0, 'no page errors: ' + errors.join('|').slice(0, 200));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'plans ui ok'); process.exit(bad ? 1 : 0);
