// Drive layout (17/11/2026): Settings › Drive layout › Organise — Citrus/ tree, every app folder tagged, only ready apps moved,
// Map.json + README, old Citrus Maxima archived; a fresh device still finds everything by tag. Run: node test/organise.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createFakeGoogle } from './fake-google.mjs';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); }; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const at = new Date(2026, 10, 17, 9, 0);
const g = createFakeGoogle();
const st = (app, extra = {}) => ({ app, title: app, updatedAt: '2026-11-17T05:00:00Z', summary: `${app} ok`, today: { date: '2026-11-17' }, ...extra });
g.seed({ apps: { mandarin: st('mandarin'), sudachi: st('sudachi', { drive: { byTag: true } }), yuzu: st('yuzu'), claude: st('claude', { inbox: [] }) } });
g.put('state.json', g.path(['My Apps', 'hub', 'citrus']), { me: { name: 'Dr Test' }, settings: {} });
g.put('cards.json', g.path(['My Apps', 'Yuzu', 'collection']), { n: 1 });
g.put('old.json', g.path(['Citrus Maxima', 'Apps']), { x: 1 });
// a twin area folder left by an earlier race (two runs at once): it must be merged away, its contents kept
{ const top = g.mkdir('Citrus', 'root'); top.appProperties = { citrusArea: '_root' };
  const a1 = g.mkdir('Archive', top.id); a1.appProperties = { citrusArea: 'archive' };
  const a2 = g.mkdir('Archive', top.id); a2.appProperties = { citrusArea: 'archive' }; a2.createdTime = new Date(Date.now() + 1000).toISOString();
  g.put('note.txt', a2.id, 'keep me', 'text/plain'); }
const browser = await chromium.launch();
async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); await g.attach(ctx);
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.clock.setFixedTime(at); const fixed = at.getTime();
  await page.addInitScript(({ fixed }) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.setItem('citrus.google', JSON.stringify({ access_token: 'tok', exp: fixed + 3600e3, email: 'tester@example.com' })); }, { fixed });
  await page.goto(URL0); await page.waitForSelector('#view-today.active');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('citrus.state.v1') || '{}')?.google?.lastSync > 0, null, { timeout: 15000 }).catch(() => {}); await sleep(1500);
  return page;
}
const A = await device('A');
await A.click('#btnMore'); await sleep(300);
check(await A.locator('.card:has-text("Drive layout")').count() === 1, 'Settings has the Drive layout card');
await A.evaluate(() => { const b = [...document.querySelectorAll('.card button')].find(x => /Organise my Drive/.test(x.textContent)); b.click(); b.disabled = false; b.click(); }); await sleep(3000);   // two taps at once
{ const arch = [...g.files.values()].filter(f => f.name === 'Archive' && !f.trashed); check(arch.length === 1 && [...g.files.values()].some(f => f.name === 'note.txt' && f.parents.includes(arch[0].id)), 'twin area folder merged into the oldest, its file kept'); }
{ const counts = {}; for (const f of g.files.values()) if (!f.trashed && f.mimeType.includes('folder') && f.appProperties?.citrusArea) counts[f.appProperties.citrusArea] = (counts[f.appProperties.citrusArea] || 0) + 1; check(Object.values(counts).every(n => n === 1), 'two taps at once make no twin folders ' + JSON.stringify(counts)); }
const tree = g.tree().join('\n');
const has = (re) => re.test(tree);
check(has(/📁 Citrus\n/) && has(/📁 00 Hub/) && has(/📁 Work/) && has(/📁 Life/) && has(/📁 Learning/) && has(/📁 Medicine/) && has(/📁 Handoffs/) && has(/📁 Archive/), 'Citrus/ tree with its areas');
const folder = (name) => [...g.files.values()].find(f => f.name === name && f.mimeType.includes('folder') && !f.trashed);
const life = folder('Life'), sud = folder('Media - Sudachi');
check(sud && sud.parents.includes(life.id) && sud.appProperties?.citrusApp === 'sudachi', 'Sudachi (finds by tag) moved to Citrus/Life/Media - Sudachi and keeps its tag');
const man = [...g.files.values()].find(f => f.appProperties?.citrusApp === 'mandarin');
check(man && man.name === 'mandarin' && g.find('hub', g.path(['My Apps'], false))?.id === man.parents[0], 'Mandarin tagged but left in hub/ (it does not find by tag yet)');
check([...g.files.values()].some(f => f.appProperties?.citrusApp === 'citrus' && f.name === 'citrus'), 'Citrus folder tagged, not moved while readers are not ready');
check([...g.files.values()].some(f => f.appProperties?.citrusApp === 'yuzu-data' && f.name === 'Yuzu') && [...g.files.values()].some(f => f.appProperties?.citrusApp === 'rotas'), 'Yuzu collection and Rotas tagged');
const cm = folder('Citrus Maxima'); check(cm && cm.parents.includes(folder('Archive').id), 'old Citrus Maxima folder moved to Archive');
const map = g.readJsonAt(['Citrus', '00 Hub'], 'Map.json');
check(map?.citrusMap === 1 && map.apps.find(a => a.id === 'sudachi')?.moved && map.apps.find(a => a.id === 'mandarin')?.waitingFor?.includes('mandarin'), 'Map.json lists every app, where it is and what it waits for');
const readme = g.find('README.md', folder('00 Hub').id); check(readme && /Media - Sudachi/.test(readme.content.toString()), 'README.md for people');
check(g.path(['My Apps'], false), 'My Apps kept while apps still live there');
// a second run changes nothing
const n0 = g.files.size; await A.click('.card:has-text("Drive layout") button:has-text("Organise again")'); await sleep(2000);
check(g.files.size === n0, `running again creates nothing new (${g.files.size - n0} new)`);
check(A.errors.length === 0, 'no page errors (A) ' + A.errors.join(' | '));
// a fresh device: no cached ids, finds its state and Sudachi's moved status by tag
const B = await device('B');
const sB = await B.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1') || '{}'));
check(sB.apps?.sudachi?.summary === 'sudachi ok', 'fresh device reads Sudachi\'s status from its new folder');
check([...g.files.values()].filter(f => f.name === 'state.json' && !f.trashed).length === 1 && [...g.files.values()].filter(f => f.appProperties?.citrusApp === 'citrus').length === 1, 'fresh device uses the one Citrus folder and state.json (no twin made)');
check([...g.files.values()].filter(f => f.name === 'sudachi' && f.mimeType.includes('folder') && !f.trashed).length === 0, 'no old hub/sudachi folder recreated');
await B.click('nav.tabs button[data-view=apps]'); await sleep(400);
check(/All your apps/.test(await B.locator('#view-apps').innerText()) && await B.locator('.dir-app').count() >= 15, 'Apps lists every app in the family by area');
check(B.errors.length === 0, 'no page errors (B) ' + B.errors.join(' | '));
// every app now finds folders by tag: everything moves, My Apps goes to the Archive, and Citrus keeps working
for (const f of [...g.files.values()].filter(f => f.name === 'status.json' && !f.trashed)) { const j = JSON.parse(f.content.toString()); j.drive = { byTag: true }; j.updatedAt = '2026-11-17T05:30:00Z'; f.content = Buffer.from(JSON.stringify(j)); g.touch(f); }
await B.click('#btnMore'); await sleep(300); await B.click('.card:has-text("Drive layout") button:has-text("Sync now"), .card:has-text("Google") button:has-text("Sync now")'); await sleep(2500);
await B.click('#btnMore'); await sleep(300); await B.click('.card:has-text("Drive layout") button:has-text("Organise")'); await sleep(3000);
const t2 = g.tree().join('\n');
check(/📁 00 Hub\n(.|\n)*📁 Citrus\n(.|\n)*state\.json/.test(t2) && folder('Citrus') && [...g.files.values()].find(f => f.appProperties?.citrusApp === 'citrus')?.parents.includes(folder('00 Hub').id), 'Citrus folder moved into 00 Hub once every app is ready');
check([...g.files.values()].find(f => f.appProperties?.citrusApp === 'mandarin')?.parents.includes(folder('Work').id), 'Mandarin moved to Work');
const yd = [...g.files.values()].find(f => f.appProperties?.citrusApp === 'yuzu-data'), yz = [...g.files.values()].find(f => f.appProperties?.citrusApp === 'yuzu');
check(yd && yz && yd.parents.includes(yz.id) && yz.name === 'Flashcards - Yuzu', 'Yuzu collection moved inside Flashcards - Yuzu');
check(folder('Rotas')?.parents.includes(folder('Work').id), 'Rotas moved to Work');
const old = [...g.files.values()].find(f => /My Apps/.test(f.name) && f.mimeType.includes('folder'));
check(old && old.name === 'My Apps (old layout)' && old.parents.includes(folder('Archive').id), 'empty My Apps moved to Archive');
const C = await device('C'); await sleep(1500);
check(!g.path(['My Apps'], false), 'a fresh device after the move recreates no My Apps folder');
check([...g.files.values()].filter(f => f.name === 'state.json' && !f.trashed).length === 1, 'still one state.json');
check(C.errors.length === 0, 'no page errors (C) ' + C.errors.join(' | '));
console.log(g.tree().slice(0, 60).join('\n'));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'organise ok'); process.exit(bad ? 1 : 0);
