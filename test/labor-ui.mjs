// Labor-law card in Work → Calendar. Run: node test/labor-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0; const errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }), p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); });
await p.goto(URL0); await sleep(600);
await p.click('nav.tabs button[data-view=rota]'); await sleep(200);
if (fs.existsSync(data('main.xlsx'))) { await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2000); }
check(await p.locator('#view-rota .lw').count() === 1, 'labor card on the calendar'); check(/labor law/i.test(await p.locator('#view-rota .lw').innerText()), 'titled');
await p.click('#view-rota .lw button:has-text("Details")'); await sleep(300);
check(await p.locator('.sheet .lw-weeks tr').count() >= 5, 'weeks table'); check(/not a legal ruling/.test(await p.locator('.sheet').innerText()), 'disclaimer');
await p.click('.sheet input[type=checkbox] >> nth=1'); await sleep(400); check(await p.locator('.sheet input[type=date]').count() >= 3, 'Ramadan dates appear when switched on');
await p.fill('.sheet input[type=number] >> nth=0', '12000'); await p.locator('.sheet input[type=number]').first().dispatchEvent('change'); await sleep(500);
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).settings.labor); check(st.wage === 12000 && st.muslim === true, 'settings saved: ' + JSON.stringify(st).slice(0, 80));
await p.screenshot({ path: path.join(here, 'shots/labor.png') }); await p.keyboard.press('Escape'); await sleep(200);
check(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'no overflow'); check(errors.length === 0, 'no page errors: ' + errors.join('|').slice(0, 200));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'labor ui ok'); process.exit(bad ? 1 : 0);
