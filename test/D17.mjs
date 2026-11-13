// D17 — Apps hub + PWA: constellation scales to many apps, one tab stop per app, service worker precache list,
// Google Fonts offline, network timeout on lie-fi, manifest. Run: node test/D17.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D17'); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let delayMs = 0;   // simulated lie-fi for the shell
const server = http.createServer(async (req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } if (delayMs && /index\.html$/.test(p)) await new Promise(r => setTimeout(r, delayMs)); res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const seed = () => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Test Doctor', id: '100001' } })); };

console.log('service worker precache list');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/'([\w-]+)'/g)].map(m => m[1]));
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
const missing = jsFiles.filter(f => !listed.has(f) && !sw.includes(`./js/${f}.js`));
check(!missing.length, `every docs/js file is precached (${jsFiles.length} files)${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
const extra = [...sw.match(/const JS = \[([^\]]+)\]/)[1].matchAll(/'([\w-]+)'/g)].map(m => m[1]).filter(f => !jsFiles.includes(f));
check(!extra.length, 'no precached js file that does not exist' + (extra.length ? ': ' + extra.join(', ') : ''));
const partsDir = path.join(root, 'css/parts'), parts = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter(f => f.endsWith('.css')) : [];
const partsMax = +(sw.match(/length: (\d+) }, \(_, i\) => `\.\/css\/parts\/D/) || [])[1] || 0;
check(parts.every(f => /^D(\d\d)\.css$/.test(f) && +f.slice(1, 3) <= partsMax), `every css/parts file is precached (${parts.length})`);
check(/fonts\.gstatic\.com/.test(sw) && /fonts\.googleapis\.com/.test(sw), 'Google Fonts are handled by the worker');

console.log('manifest');
const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
check(!!mf.id, 'has an id'); check(mf.icons.some(i => i.purpose === 'maskable') && !mf.icons.some(i => /any maskable|maskable any/.test(i.purpose || '')), 'separate maskable icon');
check(mf.shortcuts.every(s => s.icons?.length), 'shortcuts have icons');
for (const i of [...mf.icons, ...mf.shortcuts.flatMap(s => s.icons)]) if (!fs.existsSync(path.join(root, i.src))) check(false, 'icon exists: ' + i.src);

console.log('offline: precache + fonts');
{
  const FONT_FILE = Buffer.from('d09GMgABAAAAAA', 'base64');   // stand-in bytes: the sandbox cannot reach Google
  let fontHits = 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
  await ctx.route(/fonts\.googleapis\.com/, r => { fontHits++; r.fulfill({ status: 200, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: '/* latin */\n@font-face { font-family: "Manrope"; src: url(https://fonts.gstatic.com/s/manrope/v1/latin.woff2) format("woff2"); unicode-range: U+0000-00FF; }\n/* cyrillic */\n@font-face { font-family: "Manrope"; src: url(https://fonts.gstatic.com/s/manrope/v1/cyr.woff2) format("woff2"); unicode-range: U+0400-045F; }' }); });
  await ctx.route(/fonts\.gstatic\.com/, r => { fontHits++; r.fulfill({ status: 200, headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }, body: FONT_FILE }); });
  const p = await ctx.newPage(); await p.addInitScript(seed);
  p.on('pageerror', e => console.log('    pageerror:', e.message)); await p.goto(URL0); await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 15000))])); await sleep(1500);
  const cached = await p.evaluate(async () => { const out = {}; for (const k of await caches.keys()) { const c = await caches.open(k); out[k] = (await c.keys()).map(r => r.url); } return out; });
  const all = Object.values(cached).flat(), shellKey = Object.keys(cached).find(k => /^citrus-maxima/.test(k)), fontKey = Object.keys(cached).find(k => /fonts/.test(k));
  const notCached = jsFiles.filter(f => !all.some(u => u.endsWith(`/js/${f}.js`)));
  check(!notCached.length, `all ${jsFiles.length} js files in the cache` + (notCached.length ? ': missing ' + notCached.join(', ') : ''));
  check(parts.every(f => all.some(u => u.endsWith('/css/parts/' + f))), 'css/parts files in the cache');
  check(fontKey && cached[fontKey].some(u => /fonts\.googleapis\.com\/css2/.test(u)) && cached[fontKey].some(u => /latin\.woff2/.test(u)), 'font stylesheet + latin font file precached');
  check(fontKey && !cached[fontKey].some(u => /cyr\.woff2/.test(u)), 'other subsets are not precached (cached on use)');
  await ctx.setOffline(true); await ctx.unroute(/fonts\.googleapis\.com/); await ctx.unroute(/fonts\.gstatic\.com/);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort('internetdisconnected'));
  await p.reload(); await sleep(1200);
  check(await p.evaluate(() => !!document.querySelector('nav.tabs') && document.body.innerText.length > 50), 'offline reload renders the app');
  const fontOk = await p.evaluate(async () => { try { const r = await fetch('https://fonts.gstatic.com/s/manrope/v1/latin.woff2', { mode: 'cors' }); return r.ok; } catch { return false; } });
  check(fontOk, 'offline: the font file is served from the cache');
  const cssOk = await p.evaluate(() => [...document.styleSheets].some(s => /fonts\.googleapis/.test(s.href || '')));
  check(cssOk, 'offline: the Google Fonts stylesheet still loads');
  await ctx.setOffline(false); await ctx.unroute(/fonts\.(googleapis|gstatic)\.com/);
  // lie-fi: the shell answers slowly; the cached copy is served after the timeout instead of waiting for the network
  delayMs = 8000; const t0 = Date.now(); await p.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); const dt = Date.now() - t0; delayMs = 0;
  check(dt < 5000, `slow network: shell served from cache in ${(dt / 1000).toFixed(1)} s (network takes 8 s)`);
  check(shellKey === sw.match(/const CACHE = '([^']+)'/)[1] && shellKey !== 'citrus-maxima-cockpit2', `cache version bumped so old clients pick up the new list (${shellKey})`);
  await ctx.close();
}

console.log('constellation');
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
await p.addInitScript(seed);
await p.addInitScript(() => { const words = ['Alpha', 'Atlas', 'Aurora', 'Apex', 'Amber', 'Arc', 'Axis', 'Aqua', 'Astro', 'Anvil', 'Ash', 'Aria', 'Acorn', 'Aloe', 'Ankh'];
  words.forEach((w, i) => localStorage.setItem('citrus.status.' + w.toLowerCase(), JSON.stringify({ app: w.toLowerCase(), title: w + (i % 2 ? ' Notes' : ''), updatedAt: '2026-11-13T05:00:00Z', due: i % 3 ? i : 0, summary: 'test' }))); });
await p.goto(URL0); await sleep(600);
await p.evaluate(() => document.querySelector('nav.tabs button[data-view=apps]')?.click()); await sleep(500);
const geo = await p.evaluate(() => {
  const nodes = [...document.querySelectorAll('.constellation .c-node')], pts = nodes.map(n => { const b = n.querySelector('.c-body').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; });
  let minGap = Infinity; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) - pts[i].r - pts[j].r);
  const icons = nodes.map(n => n.querySelector('.c-icon').textContent), svgEl = document.querySelector('.constellation');
  return { n: nodes.length, minGap, icons, rings: svgEl.getAttribute('class'), hidden: svgEl.getAttribute('aria-hidden'), focusable: nodes.filter(n => n.hasAttribute('tabindex')).length, scrollW: document.documentElement.scrollWidth };
});
check(geo.n >= 21, `${geo.n} apps drawn`); check(/rings-2|rings-3/.test(geo.rings), 'many apps get a second orbit (' + geo.rings + ')');
check(geo.minGap > 4, `stars do not overlap (closest gap ${geo.minGap.toFixed(1)}px)`);
const aIcons = geo.icons.filter(s => /^A/i.test(s)); check(new Set(aIcons.map(s => s.toUpperCase())).size === aIcons.length && !geo.icons.some(s => s === 'A'), 'icon-less apps get distinct monograms, not all "A": ' + aIcons.join(' '));
check(geo.hidden === 'true' && geo.focusable === 0, 'stars are pointer-only (aria-hidden, no tab stops)');
check(geo.scrollW <= 392, 'no sideways scroll at 390px');
await p.screenshot({ path: path.join(shots, 'apps-many-390.png') });
await p.locator('.constellation .c-node').nth(4).click({ force: true }); await sleep(300);
check(await p.locator('.constellation .c-node.on').count() === 1, 'tapping a star still selects it');

console.log('appTabs (keyboard picker)');
const kb = await p.evaluate(async () => {
  const { appTabs, appIcon, layout } = await import('./js/apps-ui.js');
  const items = ['a', 'b', 'c'].map(k => ({ key: k, title: 'App ' + k, icon: '', color: '#888', fresh: true })); const picked = [];
  let sel = 'b', host = document.createElement('div'); document.body.append(host);
  const draw = () => { host.replaceChildren(appTabs(items, sel, (k) => { picked.push(k); sel = k; draw(); }, 'pn')); };
  draw(); const stops = [...host.querySelectorAll('[role=tab]')].filter(b => b.tabIndex === 0).length;
  host.querySelector('[aria-selected=true]').focus();
  const press = async (key) => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };
  await press('ArrowRight'); await press('ArrowRight'); await press('Home'); await press('ArrowLeft');
  const focused = document.activeElement?.dataset?.key, ctrl = host.querySelector('[role=tab]').getAttribute('aria-controls'); host.remove();
  const l1 = layout(6), l2 = layout(12), l3 = layout(40);
  return { stops, picked, focused, ctrl, mono: [appIcon('', 'Sinus Tracker'), appIcon('Y', 'yuzu'), appIcon('🍋', 'Lemon'), appIcon('', '')], rings: [l1.rings.length, l2.rings.length, l3.rings.length], pos: [l1.pos.length, l2.pos.length, l3.pos.length] };
});
check(kb.stops === 1, 'one tab stop for the whole app list');
check(kb.picked.join(',') === 'c,a,a,c' && kb.focused === 'c', 'arrows wrap, Home/End work, focus follows: ' + kb.picked.join(','));
check(kb.ctrl === 'pn', 'tabs point at the detail panel');
check(kb.mono.join('|') === 'ST|Yu|🍋|?', 'monograms: ' + kb.mono.join('|'));
check(kb.rings.join() === '1,2,3' && kb.pos.join() === '6,12,40', 'layout: rings ' + kb.rings.join() + ', every app placed');

for (const [ui, w, hgt] of [['clean', 390, 844], ['paper', 390, 844], ['arcade', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000]]) {
  await p.setViewportSize({ width: w, height: hgt }); await p.evaluate((u) => { localStorage.setItem('citrus.ui', JSON.stringify({ ui: u })); document.documentElement.dataset.ui = u; }, ui); await sleep(250);
  await p.screenshot({ path: path.join(shots, `apps-${ui}-${w}.png`) });
}
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
