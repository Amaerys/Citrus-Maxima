// Drive hardening: changes feed, conflicts, lost answers, duplicates, deleted folders, backups.
// Run: node test/drive.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeGoogle } from './fake-google.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../docs');
const shots = path.resolve(here, 'shots/drive'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const data = (f) => path.resolve(here, 'data', f);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }).listen(0);
const URL0 = `http://localhost:${server.address().port}/index.html`;

const findings = [];
const note = (sev, area, text) => { findings.push({ sev, area, text }); console.log(`  [${sev}] ${area}: ${text}`); };
const ok = (area, text) => console.log(`  ✓ ${area}: ${text}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const ROTAS = [{ name: 'November Schedule - 2026 - P1.xlsx', path: data('main.xlsx') }, { name: '11.1- Upper Village Schedule Nov-2026.xlsx', path: data('uv.xlsx') }, { name: '11- FSED Schedule Nov-2026.xlsx', path: data('fsed.xlsx') }];

async function device(g, { at, width = 390, height = 844, signedIn = false, preset = null, label }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
  await g.attach(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text()); });
  page.on('dialog', d => { page.errors.push('DIALOG: ' + d.message()); d.dismiss(); });
  await page.clock.setFixedTime(at);
  const fixed = at.getTime();
  await page.addInitScript(({ signedIn, fixed, preset }) => {
    if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1');
    if (signedIn) localStorage.setItem('citrus.google', JSON.stringify({ access_token: 'tok-initial', exp: fixed + 3600e3, email: 'tester@example.com', ...(signedIn === 'expired' ? { exp: fixed - 1000 } : {}) }));
    if (preset) for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, { signedIn, fixed, preset });
  await page.goto(URL0);
  await page.waitForSelector('#view-today.active');
  page.label = label;
  return { ctx, page };
}
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1') || 'null'));
const text = (page, sel) => page.locator(sel).innerText();
async function overflow(page, where) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  if (o.sw > o.w + 1) note('P2', 'layout', `${where}: page scrolls sideways (${o.sw}px content in ${o.w}px)`); return o;
}
async function waitSynced(page, ms = 15000) {
  const t0 = Date.now();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('citrus.state.v1') || '{}')?.google?.lastSync > 0, null, { timeout: ms }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#syncDot.busy'), null, { timeout: ms }).catch(() => {});
  return Date.now() - t0;
}
async function tab(page, v) { await page.click(`nav.tabs button[data-view=${v}]`); await sleep(150); }
const shot = (page, name, full = true) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: full });
function errorsOf(page, where) { if (page.errors.length) note('P1', 'runtime', `${where}: ${[...new Set(page.errors)].join(' | ').slice(0, 300)}`); page.errors.length = 0; }

const T = (d, h = 9, m = 0) => new Date(2026, 10, d, h, m);


const C = (page, fn, arg) => page.evaluate(fn, arg);
const count = (g, re) => g.log.filter(l => re.test(l)).length;
const driveFiles = (g, name, parent) => [...g.files.values()].filter(f => f.name === name && !f.trashed && (!parent || f.parents.includes(parent)));
const at = T(4, 9);

const g = createFakeGoogle();
g.seed({ rotaFiles: ROTAS, apps: { yuzu: { app: 'yuzu', updatedAt: '2026-11-04T06:00:00Z', summary: '132 due', asks: [{ date: '2026-11-04', title: 'Yuzu: reviews', minutes: 25 }] } } });
const A = await device(g, { at, signedIn: true, label: 'A' });
await waitSynced(A.page); await sleep(3500);   // first sync + the debounced state save

console.log('\nD1 — nothing changed: one request');
{
  g.log.length = 0;
  await C(A.page, () => window.__citrus.refreshAll(false)); await sleep(300);
  const drive = g.log.filter(l => /drive|upload/.test(l));
  const mode = await C(A.page, () => window.__citrus.rt.syncMode);
  (drive.length <= 2 && mode === 'nothing new' ? ok : (a, b) => note('P1', a, b))('changes feed', `${drive.length} Drive request(s): ${drive.join(', ')} · mode "${mode}"`);
  (!count(g, /upload/) ? ok : (a, b) => note('P2', a, b))('writes', 'nothing uploaded when nothing changed');
}

console.log('\nD2 — another app updates its status: only that file is read');
{
  const hub = g.path(['My Apps', 'hub', 'yuzu'], false); const f = g.find('status.json', hub);
  f.content = Buffer.from(JSON.stringify({ app: 'yuzu', updatedAt: '2026-11-04T08:59:00Z', summary: '7 due', asks: [] })); g.touch(f);
  g.log.length = 0;
  await C(A.page, () => window.__citrus.refreshAll(false)); await sleep(300);
  const sum = await C(A.page, () => window.__citrus.store.get().apps?.yuzu?.summary);
  const lists = count(g, /^GET drive\/files$/);
  (sum === '7 due' && lists === 0 ? ok : (a, b) => note('P1', a, b))('status', `Yuzu now "${sum}" · ${lists} folder listings · ${g.log.filter(l => /drive/.test(l)).length} Drive requests`);
}

console.log('\nD3 — two devices edit at once: both edits survive');
{
  const B = await device(g, { at, signedIn: true, width: 1280, height: 800, label: 'B' });
  await waitSynced(B.page); await sleep(500);
  await B.page.clock.setFixedTime(T(4, 9, 1));
  await C(B.page, () => window.__citrus.store.update(s => ({ ...s, notes: { ...s.notes, '2026-11-20': 'from B' } })));
  await sleep(3500);   // B saves
  // A hasn't pulled: its own edit must not overwrite B's
  await A.page.clock.setFixedTime(T(4, 9, 2));
  await C(A.page, () => window.__citrus.store.update(s => ({ ...s, notes: { ...s.notes, '2026-11-21': 'from A' } })));
  await sleep(4500);
  const remote = g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json');
  const both = remote?.notes?.['2026-11-20'] === 'from B' && remote?.notes?.['2026-11-21'] === 'from A';
  (both ? ok : (a, b) => note('P0', a, b))('conflict', both ? 'A saw B saved first → pulled, merged, wrote both notes' : `Drive has ${JSON.stringify(remote?.notes)}`);
  const local = await C(A.page, () => window.__citrus.store.get().notes);
  (local['2026-11-20'] === 'from B' ? ok : (a, b) => note('P1', a, b))('conflict', 'A shows B\'s note too');
  await C(B.page, () => window.__citrus.refreshAll(false)); await sleep(500);
  const bNotes = await C(B.page, () => window.__citrus.store.get().notes);
  (bNotes['2026-11-21'] === 'from A' ? ok : (a, b) => note('P1', a, b))('changes feed', 'B picked up A\'s note from the feed');
  (!(await C(B.page, () => JSON.stringify(window.__citrus.store.get()).includes('"outbox":[{')))) ? ok('privacy', 'device-only data stays on the device') : 0;
  const st = g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json');
  (!('outbox' in st) && !('google' in st) ? ok : (a, b) => note('P2', a, b))('state.json', 'no outbox / sign-in bookkeeping in the shared file');
  // ping-pong check: two quiet syncs on each side upload nothing
  g.log.length = 0;
  for (const p of [A.page, B.page, A.page, B.page]) { await C(p, () => window.__citrus.refreshAll(false)); await sleep(3000); }
  (!count(g, /upload\/files/) ? ok : (a, b) => note('P1', a, b))('settled', `after merging, quiet syncs upload ${count(g, /upload\/files/)} times (no bouncing between devices)`);
  errorsOf(B.page, 'D3'); await B.ctx.close();
}

console.log('\nD4 — a create whose answer is lost does not make a twin');
{
  g.faults.dropNextCreate = 1;
  const r = await C(A.page, () => window.__citrus.G.uploadAppStatus('My Apps', 'sinus', { app: 'sinus', updatedAt: '2026-11-04T09:00:00Z', summary: 'x' }).then(r => r.id, e => 'ERR ' + e.message));
  const n = driveFiles(g, 'status.json', g.path(['My Apps', 'hub', 'sinus'], false)).length;
  (n === 1 && !String(r).startsWith('ERR') ? ok : (a, b) => note('P1', a, b))('lost answer', `result ${r} · ${n} status.json in hub/sinus`);
}

console.log('\nD5 — the same plan twice is uploaded once');
{
  await C(A.page, () => window.__citrus.publishPlan()); g.log.length = 0;
  await C(A.page, () => window.__citrus.publishPlan());
  (!count(g, /upload/) ? ok : (a, b) => note('P2', a, b))('fingerprint', 'unchanged plan.json not re-uploaded');
}

console.log('\nD6 — twin state.json (from an old race) is healed');
{
  const dir = g.path(['My Apps', 'hub', 'citrus'], false);
  const twin = g.put('state.json', dir, { rotas: {}, plan: {}, updatedAt: 1 }); twin.modifiedTime = '2020-01-01T00:00:00Z';
  await C(A.page, () => window.__citrus.refreshAll(true)); await sleep(1500);
  const n = driveFiles(g, 'state.json', dir).length;
  const rotas = await C(A.page, () => Object.keys(window.__citrus.store.get().rotas).length);
  (n === 1 && rotas === 3 ? ok : (a, b) => note('P1', a, b))('twins', `${n} state.json left, ${rotas} rotas kept (older twin trashed, not merged over)`);
}

console.log('\nD6b — twin status.json in an app folder is healed on sync');
{
  const dir = g.path(['My Apps', 'hub', 'yuzu'], false);
  const old = g.put('status.json', dir, { app: 'yuzu', updatedAt: '2020-01-01T00:00:00Z', summary: 'ancient twin' }); old.modifiedTime = '2020-01-01T00:00:00Z';
  await C(A.page, () => window.__citrus.refreshAll(true)); await sleep(1500);
  const left = driveFiles(g, 'status.json', dir);
  const sum = await C(A.page, () => window.__citrus.store.get().apps?.yuzu?.summary);
  (left.length === 1 && sum !== 'ancient twin' ? ok : (a, b) => note('P1', a, b))('status twins', `${left.length} status.json left in hub/yuzu · Citrus shows "${sum}"`);
}

console.log('\nD7 — Check Drive merges twin folders');
{
  const apps = g.path(['My Apps'], false);
  const twinHub = g.put('hub', apps, Buffer.alloc(0), 'application/vnd.google-apps.folder'); twinHub.createdTime = twinHub.modifiedTime = '2030-01-01T00:00:00Z';
  const kumquat = g.put('kumquat', twinHub.id, Buffer.alloc(0), 'application/vnd.google-apps.folder');
  g.put('status.json', kumquat.id, { app: 'kumquat', summary: 'k' });
  const rep = await C(A.page, () => window.__citrus.G.scanDrive('My Apps'));
  (rep.twinFolders.some(t => t.path === 'My Apps/hub') ? ok : (a, b) => note('P1', a, b))('scan', `found: ${rep.twinFolders.map(t => t.path).join(', ') || 'nothing'}`);
  const r = await C(A.page, (rep) => window.__citrus.G.repairDrive(rep), rep);
  const hubs = driveFiles(g, 'hub', apps).filter(f => f.mimeType.includes('folder'));
  const moved = g.path(['My Apps', 'hub', 'kumquat'], false);
  (hubs.length === 1 && moved ? ok : (a, b) => note('P1', a, b))('repair', `${hubs.length} hub folder, kumquat moved in (${r.moved} moved, ${r.trashed} trashed)`);
  const rep2 = await C(A.page, () => window.__citrus.G.scanDrive('My Apps'));
  (!rep2.twinFolders.length && !rep2.twinFiles.length ? ok : (a, b) => note('P2', a, b))('repair', 'second scan is clean');
  console.log(g.tree().map(l => '      ' + l).join('\n'));
}

console.log('\nD8 — the citrus folder is deleted on Drive: rebuilt');
{
  const dir = g.path(['My Apps', 'hub', 'citrus'], false);
  const f = g.files.get(dir); f.trashed = true; g.touch(f);
  await C(A.page, () => window.__citrus.refreshAll(false)); await sleep(4000);
  const st = g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json');
  (st && Object.keys(st.rotas || {}).length === 3 ? ok : (a, b) => note('P0', a, b))('rebuild', st ? 'new hub/citrus/state.json written with all 3 rotas' : 'state.json not rewritten');
}

console.log('\nD9 — daily backups and restore');
{
  const bdir = g.path(['My Apps', 'hub', 'citrus', 'backups'], false);
  const n = bdir ? [...g.files.values()].filter(f => f.parents.includes(bdir) && !f.trashed).length : 0;
  (n >= 1 ? ok : (a, b) => note('P1', a, b))('backup', `${n} snapshot(s) in hub/citrus/backups`);
  const list = await C(A.page, () => window.__citrus.G.listBackups('My Apps'));
  const snap = list[0] && await C(A.page, (id) => window.__citrus.G.readBackup(id), list[0].id);
  (snap?.rotas && Object.keys(snap.rotas).length === 3 ? ok : (a, b) => note('P1', a, b))('restore', `latest snapshot ${list[0]?.name} readable (${Object.keys(snap?.rotas || {}).length} rotas)`);
}

console.log('\nD10 — offline and flaky');
{
  g.faults.offline = true; await A.ctx.setOffline(true);
  await C(A.page, () => window.__citrus.store.update(s => ({ ...s, notes: { ...s.notes, '2026-11-22': 'offline note' } }))); await sleep(3000);
  const dirty = await C(A.page, () => window.__citrus.rt.saveDirty);
  (dirty ? ok : (a, b) => note('P1', a, b))('offline', 'edit kept as "unsaved to Drive"');
  g.faults.offline = false; await A.ctx.setOffline(false); await sleep(200);
  await C(A.page, () => window.__citrus.refreshAll(false)); await sleep(1500);
  const st = g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json');
  (st?.notes?.['2026-11-22'] === 'offline note' ? ok : (a, b) => note('P1', a, b))('back online', 'the offline edit reached Drive on the next sync');
  g.faults.status500 = 3; g.log.length = 0;
  await C(A.page, () => window.__citrus.refreshAll(true)); await sleep(500);
  const probs = await C(A.page, () => window.__citrus.rt.lastProblems);
  (!probs.length ? ok : (a, b) => note('P2', a, b))('5xx', `3× 500 absorbed (${probs.join('; ') || 'no issues'})`);
}

errorsOf(A.page, 'drive');
await shot(A.page, 'settings', false);
console.log('\n══════════ FINDINGS ══════════');
for (const f of findings) console.log(`[${f.sev}] ${f.area}: ${f.text}`);
console.log(`\n${findings.length} finding(s).`);
await browser.close(); server.close();
process.exit(findings.some(f => f.sev === 'P0' || f.sev === 'P1') ? 1 : 0);
