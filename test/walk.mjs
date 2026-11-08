// Beta walk: every tab, every Mind segment, every Library kind × sub-tab, at three viewports, with real-size data.
// Collects console/page errors and horizontal overflow; then reloads offline through the service worker. Run: node test/walk.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../docs'), sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const d = '/mnt/user-data/attachments/a1f5476a-0219-5c7e-9801-fd990059411a/', gr = fs.existsSync(d) ? fs.readFileSync(d + 'b9685fe4-goodreads_library_export.csv', 'utf8') : '', im = fs.existsSync(d) ? fs.readFileSync(d + '3aec3ad0-4f94e9f4-1eca-44e9-bd41-2eb5ed86b2f7.csv', 'utf8') : '';
const steam = '<gamesList><games>' + Array.from({ length: 300 }, (_, i) => `<game><appID>${i + 1}</appID><name><![CDATA[Game ${i}]]></name><hoursOnRecord>${(i * 7) % 90}.5</hoursOnRecord></game>`).join('') + '</games></gamesList>';
const browser = await chromium.launch(); const bad = []; let n = 0;
const note = (m) => { bad.push(m); console.log('  ✗', m); };
async function walk(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block' }), page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi|net::ERR/.test(m.text())) errs.push(m.text()); });
  await page.goto(URL0); await sleep(600);
  await page.evaluate(async ({ gr, im, steam }) => { const S = await import('/js/store.js'), L = await import('/js/media.js'); S.update(s => { let st = s; for (const t of [gr, im, steam]) if (t) st = L.upsertMany(st, L.parseExport(t).items || L.parseSteam(t).items || []).state; return st; }); }, { gr, im, steam }).catch(e => errs.push('seed: ' + e.message));
  await page.evaluate(async ({ steam }) => { const S = await import('/js/store.js'), L = await import('/js/media.js'); const r = L.parseSteam(steam); S.update(s => L.upsertMany(s, r.items).state); }, { steam });
  const ov = async (label) => { n++; const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 0) note(`${width}px overflow ${o}px: ${label}`); if (errs.length) { note(`${width}px errors at ${label}: ${errs.splice(0).join(' | ').slice(0, 200)}`); } };
  const click = async (sel, label) => { try { await page.click(sel, { timeout: 2500 }); await sleep(180); await ov(label); } catch (e) { note(`${width}px cannot click ${label} (${sel})`); } };
  for (const v of ['today', 'rota', 'plan', 'mind', 'social', 'apps']) { const sel = width >= 1000 ? `.rail button[data-view=${v}], nav.tabs button[data-view=${v}]` : `nav.tabs button[data-view=${v}]`; await click(sel, `tab ${v}`); }
  await click('nav.tabs button[data-view=mind], .rail button[data-view=mind]', 'mind');
  const mseg = async (sg) => { await click('.mn-main', `mind/open-launcher`); await click(`.ml-tile:has-text("${sg}")`, `mind/${sg}`); };
  for (const sg of ['Overview', 'Tasks', 'Habits', 'Aims', 'Reflect', 'Year', 'Notes']) await mseg(sg);
  await click('.mn-step[aria-label="Next section"]', 'mind/next'); await click('.mn-step[aria-label="Previous section"]', 'mind/prev');
  await mseg('Library');
  await click('nav.tabs button[data-view=rota], .rail button[data-view=rota]', 'work'); for (const sg of ['People', 'Nurses', 'Home', 'Career', 'Calendar']) await click(`.work-seg button:has-text("${sg}")`, `work/${sg}`);
  await click('nav.tabs button[data-view=social], .rail button[data-view=social]', 'social'); for (const sg of ['Friends', 'Outings', 'Overview']) await click(`#view-social .mind-seg button:has-text("${sg}")`, `social/${sg}`);
  await click('nav.tabs button[data-view=mind], .rail button[data-view=mind]', 'mind again');
  const kinds = await page.locator('#view-mind .kinds button').allInnerTexts();
  for (let ki = 0; ki < kinds.length; ki++) { await page.locator('#view-mind .kinds button').nth(ki).click(); await sleep(150); for (const tb of ['Shelf', 'Discover', 'Review', 'Connect']) await click(`#view-mind .lib-tabs button:has-text("${tb}")`, `library/${kinds[ki].trim()}/${tb}`); await click('#view-mind .lib-tabs button:has-text("Shelf")', 'back to shelf'); }
  // a few interactions that touch lots of code
  await page.locator('#view-mind .kinds button').nth(3).click(); await sleep(150); await click('#view-mind .mrow.media >> nth=0', 'open an item'); await click('.sheet .btn:has-text("Cancel")', 'close item');
  await page.screenshot({ path: path.join(here, `shots/walk-${width}.png`), fullPage: false }); await ctx.close();
}
for (const [w, h] of [[360, 740], [768, 1024], [1280, 800]]) await walk(w, h);
// offline: service worker serves the app with no network
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); await page.goto(URL0); await sleep(500);
  await page.evaluate(() => navigator.serviceWorker.ready); await sleep(1500); await page.reload(); await sleep(800); await ctx.setOffline(true);
  try { await page.reload({ timeout: 8000 }); await sleep(800); const ok = await page.evaluate(() => !!document.querySelector('nav.tabs') && document.body.innerText.length > 50); if (!ok) note('offline reload rendered empty'); else console.log('  ✓ offline reload works'); await page.click('nav.tabs button[data-view=mind]'); await sleep(300); await page.click('.mn-main'); await sleep(200); await page.click('.ml-tile:has-text("Library")'); await sleep(300); console.log('  ✓ offline: Mind → Library opens'); }
  catch (e) { note('offline reload failed: ' + e.message.split('\n')[0]); } await ctx.close();
}
await browser.close(); server.close(); console.log(`\n${n} views visited`, bad.length ? `, ${bad.length} problem(s)` : ', all clean'); process.exit(bad.length ? 1 : 0);
