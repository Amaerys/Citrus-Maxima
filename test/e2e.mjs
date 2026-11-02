import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (p.endsWith('/')) p += 'index.html';
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const out = path.resolve(root, '../test/shots'); fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Fake "today" = 17 Nov 2026 (a night shift day for Dr. Amro) so views are interesting
await page.addInitScript(() => {
  const fixed = new Date(2026, 10, 4, 10, 30);
  const _D = Date;
  class D extends _D { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } }
  window.Date = D;
});
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForSelector('#view-today .card');
await page.screenshot({ path: `${out}/01-empty.png` });

// import files
const files = ['main.xlsx', 'uv.xlsx', 'fsed.xlsx'].map(f => path.resolve(root, '../test/data', f));
await page.setInputFiles('#view-today input[type=file]', files);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-today.png`, fullPage: true });

const todayText = await page.innerText('#view-today');
console.log('TODAY >>>\n' + todayText.slice(0, 900));

await page.click('nav.tabs button[data-view=rota]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-rota.png`, fullPage: true });
// open day 21
await page.click('#view-rota .cal .day:not(.pad) >> nth=20');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/04-day-sheet.png` });
console.log('DAY SHEET >>>\n' + (await page.innerText('.sheet')).slice(0, 700));
await page.click('.sheet-bg', { position: { x: 10, y: 10 } });

await page.click('nav.tabs button[data-view=team]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/05-team.png`, fullPage: true });
await page.click('#view-team .item >> nth=1');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/06-person.png` });
console.log('PERSON >>>\n' + (await page.innerText('.sheet')).slice(0, 400));
await page.click('.sheet-bg', { position: { x: 10, y: 10 } });

await page.click('nav.tabs button[data-view=plan]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/07-plan.png`, fullPage: true });
console.log('PLAN >>>\n' + (await page.innerText('#view-plan')).slice(0, 1800));
// accept first suggestion
const acc = page.locator('#view-plan button:has-text("Accept")').first();
if (await acc.count()) { await acc.click(); await page.waitForTimeout(300); }
await page.click('#view-plan button:has-text("Edit goals")'); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/08-goals.png` });
await page.click('.sheet-bg', { position: { x: 10, y: 10 } });
await page.click('#view-plan button:has-text("Rules")'); await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/09-rules.png` });
await page.click('.sheet-bg', { position: { x: 10, y: 10 } });

await page.click('nav.tabs button[data-view=apps]'); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/09b-apps.png`, fullPage: true }); await page.click('#btnMore');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/10-more.png`, fullPage: true });

// desktop pass
const dctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 });
const dp = await dctx.newPage(); dp.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
await dp.addInitScript(() => { const fixed = new Date(2026, 10, 4, 10, 30); const _D = Date; class D extends _D { constructor(...a) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } } window.Date = D; });
await dp.goto(`http://localhost:${port}/index.html`); await dp.waitForTimeout(500);
await dp.setInputFiles('#view-today input[type=file]', files); await dp.waitForTimeout(800);
await dp.screenshot({ path: `${out}/20-desktop-today.png` });
await dp.click('nav.tabs button[data-view=plan]'); await dp.waitForTimeout(400); await dp.screenshot({ path: `${out}/21-desktop-plan.png` });
await dp.click('nav.tabs button[data-view=apps]'); await dp.waitForTimeout(300); await dp.screenshot({ path: `${out}/22-desktop-apps.png` });
await dp.click('nav.tabs button[data-view=rota]'); await dp.waitForTimeout(300); await dp.screenshot({ path: `${out}/23-desktop-rota.png` });
await dp.keyboard.press('/'); await dp.waitForTimeout(200); await dp.keyboard.type('mal'); await dp.waitForTimeout(200); await dp.screenshot({ path: `${out}/24-desktop-search.png` }); await dp.keyboard.press('Escape');
await dctx.close();

// reload persists?
await page.reload(); await page.waitForTimeout(600);
const persisted = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('citrus.state.v1')).rotas));
console.log('persisted rotas:', persisted);

console.log('\nERRORS:', errors.length ? errors : 'none');
await browser.close(); server.close();
