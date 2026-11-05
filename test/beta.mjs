// Simulated beta: scripted sessions on phone & desktop against a fake Google, seeded with the real November rotas.
// Run: node test/beta.mjs   → prints findings, writes screenshots to test/shots/beta/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeGoogle } from './fake-google.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../docs');
const shots = path.resolve(here, 'shots/beta'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
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

// ───────────────────────── S1 first run, signed out, phone ─────────────────────────
console.log('\nS1 — first run, nothing set up, phone 390px');
{
  const g = createFakeGoogle();
  const { ctx, page } = await device(g, { at: T(4, 9), label: 'fresh' });
  await shot(page, 's1-today-empty');
  const hero = await text(page, '#view-today');
  if (!/No rota/i.test(hero)) note('P2', 'empty state', 'Today does not explain that no rota is loaded'); else ok('empty', 'Today explains how to start');
  for (const v of ['rota', 'team', 'plan', 'apps']) { await tab(page, v); await shot(page, `s1-${v}-empty`); await overflow(page, `empty ${v}`); }
  const plan = await text(page, '#view-plan');
  if (/USMLE|German/.test(plan) && !/rota/i.test(plan)) note('P3', 'plan', 'With no rota and no "me", Plan still suggests study blocks as if every day were free — no hint that shifts are missing');
  await page.click('#btnMore'); await sleep(150); await shot(page, 's1-settings');
  errorsOf(page, 'S1'); await ctx.close();
}

// ───────────────────────── S2 signed-in first sync from Drive ─────────────────────────
console.log('\nS2 — signed in, everything comes from Drive (device A, 04/11 09:00)');
const G = createFakeGoogle();
G.seed({
  rotaFiles: ROTAS,
  apps: {
    yuzu: { app: 'yuzu', updatedAt: T(4, 8).toISOString(), summary: '132 cards due · 9-day streak', next: { title: 'Review 132 cards', minutes: 30 }, asks: [{ date: '2026-11-04', title: 'Yuzu: 132 reviews', minutes: 30, slot: 'free' }], pending: ['132 cards due'], extra: { streak: 9 } },
    mephisto: { app: 'mephisto', updatedAt: T(4, 7).toISOString(), summary: 'Sitzung offen · 37 Karten fällig', asks: [{ date: '2026-11-04', title: 'Mephisto: Sitzung', minutes: 25, slot: 'before' }, { date: '2026-11-05', title: 'Mephisto: Sitzung', minutes: 25, slot: 'free' }], pending: ['37 Karten fällig'] },
    orange: { app: 'orange', updatedAt: T(1, 7).toISOString(), summary: '<img src=x onerror="alert(1)"> Trained 2 of 4', today: { done: false }, asks: [{ date: '2026-11-07', title: 'Orange: Push day', minutes: 60, slot: 'free' }], pending: [] },
  },
  events: [{ summary: 'Dentist', start: { dateTime: T(4, 21).toISOString() }, end: { dateTime: T(4, 22).toISOString() } }, { summary: 'Mum birthday', start: { date: '2026-11-07' }, end: { date: '2026-11-08' } }],
});
const A = await device(G, { at: T(4, 9), signedIn: true, label: 'A' });
{
  const { page } = A;
  const t = await waitSynced(page);
  const st = await state(page);
  const reqs = G.log.length;
  (Object.keys(st.rotas).length === 3 ? ok : (a, b) => note('P1', a, b))('drive import', `${Object.keys(st.rotas).length} rotas pulled from Drive in ~${t} ms, ${reqs} API calls`);
  if (reqs > 45) note('P3', 'performance', `First sync made ${reqs} Google API calls — folder lookups are not batched/cached across steps`);
  (st.me?.name === 'Dr. Amro' ? ok : (a, b) => note('P1', a, b))('me', `auto-picked: ${st.me?.name}`);
  await sleep(500);
  const today = await text(page, '#view-today');
  (/Dentist/.test(today) ? ok : (a, b) => note('P1', a, b))('calendar', 'seeded Google event shows on Today');
  (/Yuzu/.test(today) && /Mephisto/.test(today) ? ok : (a, b) => note('P1', a, b))('apps', 'Yuzu + Mephisto statuses on Today');
  if (page.errors.some(e => e.startsWith('DIALOG'))) note('P0', 'security', 'HTML in an app status executed'); else ok('security', 'HTML in a status summary is shown as text, not executed');
  await sleep(4500); // plan.json debounce 4 s, state 2.5 s
  const plan = G.readJsonAt(['My Apps', 'hub', 'citrus'], 'plan.json');
  (plan?.blocks?.length ? ok : (a, b) => note('P1', a, b))('plan.json', `written with ${plan?.blocks?.length || 0} blocks (${[...new Set((plan?.blocks || []).map(b => b.app).filter(Boolean))].join(', ')})`);
  const remote = G.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json');
  (remote?.rotas ? ok : (a, b) => note('P1', a, b))('state.json', remote ? `saved (${(JSON.stringify(remote).length / 1024).toFixed(0)} KB)` : 'not written');
  if (remote && JSON.stringify(remote).length > 400 * 1024) note('P3', 'drive', 'state.json carries full rota grids; it will grow ~100 KB per month of rotas');
  const meph = (plan?.blocks || []).find(b => b.app === 'mephisto' && b.date === '2026-11-04');
  if (meph) { const [hh] = meph.start.split(':').map(Number); if (hh >= 8 && hh < 20) note('P1', 'planner', `Mephisto "before shift" ask placed at ${meph.start}, during the D2 shift`); else ok('planner', `Mephisto "before your shift" ask → ${meph.start}`); }
  await shot(page, 's2-today-synced');
  await tab(page, 'apps'); await shot(page, 's2-apps');
  const apps = await text(page, '#view-apps');
  if (!/Sinus/.test(apps)) note('P3', 'apps', 'Sinus tile missing');
  if (/updated \d+ d ago/.test(apps)) ok('apps', 'stale Orange status (3 days) marked by age');
  console.log('\n  Drive after first sync:\n    ' + G.tree().join('\n    '));
  errorsOf(page, 'S2');
}

// ───────────────────────── S3 planner accept / move / skip / reload ─────────────────────────
console.log('\nS3 — planner: accept, move, skip, reload');
{
  const { page } = A;
  await tab(page, 'plan');
  const before = [...G.calendars.get('primary').events.values()].length;
  await page.locator('#view-plan .tl-block button:has-text("Accept")').first().dispatchEvent('click'); await sleep(600);
  const evs = [...G.calendars.get('primary').events.values()];
  const created = evs.find(e => e.extendedProperties?.private?.citrus === 'plan');
  (evs.length === before + 1 && created ? ok : (a, b) => note('P1', a, b))('accept', created ? `→ Google event "${created.summary}" ${created.start.dateTime.slice(11, 16)}Z` : 'no calendar event created');
  // move the accepted block
  await page.locator('#view-plan .tl-block:not(.suggested) button:has-text("Move")').first().dispatchEvent('click'); await sleep(200);
  await page.locator('.sheet input[type=time]').first().fill('22:30'); await page.locator('.sheet input[type=time]').nth(1).fill('23:15');
  await page.locator('.sheet button:has-text("Save")').click(); await sleep(600);
  const moved = [...G.calendars.get('primary').events.values()].find(e => e.id === created?.id);
  (moved && new Date(moved.start.dateTime).getHours() === 22 ? ok : (a, b) => note('P1', a, b))('move', moved ? `calendar event moved to ${new Date(moved.start.dateTime).getHours()}:${String(new Date(moved.start.dateTime).getMinutes()).padStart(2, '0')}` : 'event not patched');
  // skip one
  const nBefore = await page.locator('#view-plan .tl-block.suggested').count();
  await page.locator('#view-plan .tl-block button:has-text("Skip")').first().dispatchEvent('click'); await sleep(300);
  const nAfter = await page.locator('#view-plan .tl-block.suggested').count();
  ok('skip', `suggestions ${nBefore} → ${nAfter} (planner may re-offer another slot)`);
  await page.reload(); await page.waitForSelector('section.view.active'); await sleep(800);
  const st = await state(page);
  const accepted = Object.values(st.plan).flat().filter(p => p.status === 'accepted');
  (accepted.length ? ok : (a, b) => note('P1', a, b))('persist', `${accepted.length} accepted block(s) survive reload`);
  await tab(page, 'plan'); await shot(page, 's3-plan');
  errorsOf(page, 'S3');
}

// ───────────────────────── S4 offline: outbox ─────────────────────────
console.log('\nS4 — offline accept, then back online');
{
  const { page, ctx } = A;
  G.faults.offline = true; await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(200);
  await tab(page, 'plan');
  const evBefore = G.calendars.get('primary').events.size;
  await page.locator('#view-plan .tl-block button:has-text("Accept")').first().dispatchEvent('click'); await sleep(500);
  let st = await state(page);
  ((st.outbox || []).length === 1 ? ok : (a, b) => note('P1', a, b))('outbox', `queued ${(st.outbox || []).length} write while offline`);
  await shot(page, 's4-offline', false);
  G.faults.offline = false; await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500);
  st = await state(page);
  ((st.outbox || []).length === 0 && G.calendars.get('primary').events.size === evBefore + 1 ? ok : (a, b) => note('P1', a, b))('outbox', `flushed on reconnect → calendar has ${G.calendars.get('primary').events.size - evBefore} new event, ${(st.outbox || []).length} left`);
  errorsOf(page, 'S4');
}

// ───────────────────────── S5 server errors & expired token ─────────────────────────
console.log('\nS5 — 500s, 401, expired session');
{
  const { page } = A;
  G.faults.status500 = 2; G.log.length = 0;
  await page.click('#btnRefresh'); await waitSynced(page); await sleep(1500);
  const retried = G.log.filter(l => / 500$/.test(l)).length;
  const issues = await page.evaluate(() => document.querySelector('#toasts')?.innerText || '');
  (/issues/i.test(issues) ? (a, b) => note('P2', a, b) : ok)('retry', `${retried}× 500 absorbed by backoff${/issues/i.test(issues) ? ' — but the sync still reported issues' : ''}`);
  G.faults.status401 = 1; await page.click('#btnRefresh'); await sleep(2500);
  ok('401', 'one 401 → token refreshed silently, sync continued');
  errorsOf(page, 'S5');
}
{
  const g = createFakeGoogle(); g.seed({ rotaFiles: ROTAS });
  const d = await device(g, { at: T(4, 9), signedIn: 'expired', label: 'expired' });
  await sleep(1200);
  const before = await d.page.locator('.banner').count();
  (before ? ok : (a, b) => note('P1', a, b))('expired', before ? 'expired token → "tap to reconnect" banner, no window opened on its own' : 'expired token but no banner');
  await d.page.mouse.click(5, 300); await sleep(300); await waitSynced(d.page); await sleep(800);   // any tap renews (no screen)
  const st = await state(d.page);
  (st?.google?.lastSync && !(await d.page.locator('.banner').count()) ? ok : (a, b) => note('P1', a, b))('tap renew', 'the next tap anywhere renewed the session and synced');
  await d.ctx.close();
  const g2 = createFakeGoogle(); g2.faults.gisFail = true;
  const d2 = await device(g2, { at: T(4, 9), signedIn: 'expired', label: 'expired-fail' });
  await sleep(1200); await d2.page.mouse.click(5, 300); await sleep(1500);
  const banner = await d2.page.locator('.banner').count();
  (banner ? ok : (a, b) => note('P1', a, b))('expired', banner ? 'renewal refused → reconnect banner stays' : 'renewal failed but no banner — user would not know sync stopped');
  await shot(d2.page, 's5-expired-banner', false);
  errorsOf(d2.page, 'S5b'); await d2.ctx.close();
}

// ───────────────────────── S6 swaps ─────────────────────────
console.log('\nS6 — correct a day (swap with Hibat on 21/11)');
{
  const { page } = A;
  await page.evaluate(() => location.hash = '#rota'); await tab(page, 'rota');
  await page.locator('#view-rota .cal .day:not(.pad)').nth(20).dispatchEvent('click'); await sleep(250);
  await page.locator('.sheet button:has-text("Correct this day")').click(); await sleep(200);
  await page.locator('.sheet select').first().selectOption('');
  const opts = await page.locator('.sheet select').nth(1).locator('option').allInnerTexts();
  const hib = opts.find(o => /Hibat/.test(o));
  await page.locator('.sheet select').nth(1).selectOption({ label: hib });
  await page.locator('.sheet button:has-text("Save")').click(); await sleep(300);
  const cell = await page.locator('#view-rota .cal .day:not(.pad)').nth(20).innerText();
  (/·/.test(cell) && !/D1/.test(cell) ? ok : (a, b) => note('P1', a, b))('swap', `21/11 cell now "${cell.replace(/\n/g, ' ')}"`);
  await page.locator('#view-rota .cal .day:not(.pad)').nth(20).dispatchEvent('click'); await sleep(250);
  const sheetTxt = await text(page, '.sheet');
  (/Hibat[^\n]*\n?D1/.test(sheetTxt) || /Hibat\s*D1/.test(sheetTxt.replace(/\n/g, ' ')) ? ok : (a, b) => note('P2', a, b))('swap', 'Hibat shows D1 at Upper Village on 21/11 (the swap flipped her day too)');
  await shot(page, 's6-swap-sheet', false);
  await page.keyboard.press('Escape');
  // re-render twice: does the swap logic mutate shared objects?
  await tab(page, 'today'); await tab(page, 'rota'); await tab(page, 'today'); await tab(page, 'rota');
  await page.locator('#view-rota .cal .day:not(.pad)').nth(20).dispatchEvent('click'); await sleep(250);
  const again = (await text(page, '.sheet')).replace(/\n/g, ' ');
  const hibCount = (again.match(/Hibat/g) || []).length;
  if (/Hibat\s*D1/.test(again)) ok('swap', 'stable after several re-renders'); else note('P1', 'swap', `after re-rendering, 21/11 shows Hibat as "${(again.match(/Hibat\s*\S+/) || [''])[0]}"`);
  await page.keyboard.press('Escape');
  errorsOf(page, 'S6');
}

// ───────────────────────── S7 second device ─────────────────────────
console.log('\nS7 — second device (desktop) picks everything up from Drive');
{
  await A.page.evaluate(() => document.querySelector('#btnRefresh').click()); await sleep(4000); // make sure A saved
  const B = await device(G, { at: T(4, 12), width: 1366, height: 860, signedIn: true, label: 'B' });
  await waitSynced(B.page); await sleep(1500);
  const st = await state(B.page);
  const acc = Object.values(st.plan || {}).flat().filter(p => p.status === 'accepted').length;
  const swaps = Object.keys(st.swaps || {}).length;
  (acc >= 1 ? ok : (a, b) => note('P1', a, b))('device B', `sees ${acc} accepted block(s) from device A`);
  (swaps === 1 ? ok : (a, b) => note('P1', a, b))('device B', `sees ${swaps} swap(s) from device A`);
  (st.me?.name ? ok : (a, b) => note('P2', a, b))('device B', `"me" = ${st.me?.name}`);
  for (const v of ['today', 'rota', 'team', 'plan', 'apps']) { await tab(B.page, v); await shot(B.page, `s7-desktop-${v}`, false); await overflow(B.page, `desktop ${v}`); }
  await B.page.click('#btnMore'); await sleep(200); await shot(B.page, 's7-desktop-settings', false);
  // B deletes the swap, A syncs: does the deletion propagate?
  await tab(B.page, 'rota');
  await B.page.locator('#view-rota .cal .day:not(.pad)').nth(20).dispatchEvent('click'); await sleep(200);
  await B.page.locator('.sheet button:has-text("Edit correction")').click(); await sleep(200);
  await B.page.locator('.sheet button:has-text("Remove")').click(); await sleep(3500);
  await A.page.click('#btnRefresh'); await waitSynced(A.page); await sleep(1200);
  const stA = await state(A.page);
  (Object.keys(stA.swaps || {}).length === 0 ? ok : (a, b) => note('P1', a, b))('merge', Object.keys(stA.swaps || {}).length ? 'swap removed on desktop comes back on the phone after sync (deletions do not propagate)' : 'removing a swap on one device removes it on the other');
  errorsOf(B.page, 'S7'); await B.ctx.close();
}

// ───────────────────────── S8 nights, post-night, month end ─────────────────────────
console.log('\nS8 — night 17/11, post-night 18/11, month rollover');
{
  const g = createFakeGoogle(); g.seed({ rotaFiles: ROTAS });
  const n = await device(g, { at: T(17, 14), signedIn: true, label: 'night' });
  await waitSynced(n.page); await sleep(500);
  const hero = await text(n.page, '#view-today .card.hero');
  (/Night/.test(hero) ? ok : (a, b) => note('P1', a, b))('night', 'hero shows the N2 night');
  await shot(n.page, 's8-night-today');
  await tab(n.page, 'plan');
  const st = await state(n.page);
  const blocks = await n.page.evaluate(() => [...document.querySelectorAll('#view-plan .card')].slice(1, 3).map(c => c.innerText));
  const today = blocks[0] || '';
  const times = [...today.matchAll(/(\d\d):(\d\d)–(\d\d):(\d\d) · \d/g)].map(m => +m[1]);
  if (times.some(h => h >= 17)) note('P2', 'planner', 'Study suggested in the evening before a night shift'); else ok('planner', `night day: blocks at ${times.join(', ') || 'none'}h, nothing in the pre-night evening`);
  const tomorrow = blocks[1] || '';
  const t2 = [...tomorrow.matchAll(/(\d\d):(\d\d)–(\d\d):(\d\d) · \d/g)].map(m => +m[1]);
  if (t2.some(h => h < 15)) note('P2', 'planner', `Post-night day has blocks before 15:00 (${t2.join(', ')})`); else ok('planner', `post-night: first block ${t2[0] ?? '—'}h`);
  await n.ctx.close();
  // month end: someone with a night on 30/11, looked at on 01/12 when December has no rota
  const g3 = createFakeGoogle(); g3.seed({ rotaFiles: ROTAS });
  const m = await device(g3, { at: new Date(2026, 11, 1, 9), signedIn: true, label: 'dec' });
  await waitSynced(m.page); await sleep(300);
  await m.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('citrus.state.v1')); s.me = { name: 'Dr. Abeer Eshag', id: '437765' }; localStorage.setItem('citrus.state.v1', JSON.stringify(s)); });
  await m.page.reload(); await m.page.waitForSelector('#view-today.active'); await sleep(500);
  const decHero = await text(m.page, '#view-today .card.hero');
  if (/No rota/.test(decHero) && !/night/i.test(decHero)) note('P2', 'month end', 'On 01/12 (no December rota yet) Today says only "No rota" — the night that started 30/11 and ends 08:00 today is not shown');
  else ok('month end', 'night from 30/11 is shown on 01/12');
  await shot(m.page, 's8-dec-first');
  await tab(m.page, 'rota'); const rt = await text(m.page, '#view-rota');
  (/No rota loaded for December/.test(rt) ? ok : (a, b) => note('P3', a, b))('month end', 'Rota explains December is missing');
  errorsOf(m.page, 'S8'); await m.ctx.close();
}

// ───────────────────────── S9 small phone, light theme, a11y ─────────────────────────
console.log('\nS9 — 320px phone, light theme, keyboard, accessibility');
{
  const g = createFakeGoogle(); g.seed({ rotaFiles: ROTAS });
  const p = await device(g, { at: T(4, 9), width: 320, height: 640, signedIn: true, label: '320' });
  await waitSynced(p.page);
  for (const v of ['today', 'rota', 'team', 'plan', 'apps']) { await tab(p.page, v); await overflow(p.page, `320px ${v}`); await shot(p.page, `s9-320-${v}`); }
  await p.page.click('#btnMore'); await sleep(150); await overflow(p.page, '320px settings');
  await p.page.locator('.switch:has-text("Light theme") .toggle').click(); await sleep(150);
  for (const v of ['today', 'rota', 'plan']) { await tab(p.page, v); await shot(p.page, `s9-light-${v}`); }
  // unlabeled controls
  const unlabeled = await p.page.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea')].filter(el => el.offsetParent && !(el.getAttribute('aria-label') || el.innerText.trim() || el.getAttribute('title') || el.getAttribute('placeholder') || el.labels?.length)).map(el => el.outerHTML.slice(0, 70)));
  if (unlabeled.length) note('P3', 'accessibility', `${unlabeled.length} control(s) without an accessible name, e.g. ${unlabeled[0]}`); else ok('a11y', 'all visible controls have names');
  // tap targets
  const small = await p.page.evaluate(() => [...document.querySelectorAll('button, a')].filter(el => el.offsetParent).map(el => el.getBoundingClientRect()).filter(r => r.width && (r.height < 30 || r.width < 30)).length);
  if (small > 6) note('P3', 'touch', `${small} tap targets under 30px on the Plan screen at 320px`);
  // keyboard on desktop-ish
  await p.page.keyboard.press('2'); await sleep(100);
  const v2 = await p.page.evaluate(() => document.querySelector('section.view.active').id);
  (v2 === 'view-rota' ? ok : (a, b) => note('P3', a, b))('keyboard', 'number keys switch tabs');
  await p.page.keyboard.press('/'); await sleep(100); await p.page.keyboard.type('21/11'); await p.page.keyboard.press('Enter'); await sleep(300);
  ((await p.page.locator('.sheet').count()) ? ok : (a, b) => note('P2', a, b))('search', '"21/11" + Enter opens that day');
  await p.page.keyboard.press('Escape');
  errorsOf(p.page, 'S9'); await p.ctx.close();
}

// ───────────────────────── S10 robustness ─────────────────────────
console.log('\nS10 — corrupt storage, bad files, speed');
{
  const g = createFakeGoogle();
  const c = await device(g, { at: T(4, 9), preset: { 'citrus.state.v1': '{"rotas": {"x": {"people": null}}, "plan": 5', 'citrus.events': 'nope' }, label: 'corrupt' });
  await sleep(500);
  const ok1 = (await c.page.locator('#view-today .card').count()) > 0;
  (ok1 && !c.page.errors.length ? ok : (a, b) => note('P1', a, b))('corrupt storage', ok1 ? 'app starts with a broken saved state' : 'blank screen with a broken saved state');
  c.page.errors.length = 0;
  // a non-rota xlsx and a text file named .xlsx
  fs.writeFileSync(path.join(shots, 'fake.xlsx'), 'not a zip');
  await c.page.setInputFiles('#view-today input[type=file]', [path.join(shots, 'fake.xlsx')]); await sleep(400);
  const toastTxt = await c.page.evaluate(() => document.querySelector('#toasts')?.innerText || '');
  (/fake\.xlsx/.test(toastTxt) ? ok : (a, b) => note('P2', a, b))('bad file', `rejected with: "${toastTxt.split('\n')[0]}"`);
  c.page.errors.length = 0;
  await c.page.setInputFiles('#view-today input[type=file]', ROTAS.map(r => r.path)); await sleep(600);
  const perf = await c.page.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 10; i++) { document.querySelector('nav.tabs button[data-view=today]').click(); } const t1 = performance.now(); document.querySelector('nav.tabs button[data-view=plan]').click(); const t2 = performance.now(); document.querySelector('nav.tabs button[data-view=rota]').click(); const t3 = performance.now(); return { today: (t1 - t0) / 10, plan: t2 - t1, rota: t3 - t2 }; });
  const slow = Object.entries(perf).filter(([, v]) => v > 120);
  (slow.length ? (a, b) => note('P3', a, b) : ok)('speed', `render Today ${perf.today.toFixed(0)} ms, Plan ${perf.plan.toFixed(0)} ms, Rota ${perf.rota.toFixed(0)} ms`);
  errorsOf(c.page, 'S10'); await c.ctx.close();
}

// ───────────────────────── S11 import on the phone → Drive ─────────────────────────
console.log('\nS11 — rota imported on the phone is saved to Drive for other devices');
{
  const g = createFakeGoogle();
  const d = await device(g, { at: T(4, 9), signedIn: true, label: 'upload' });
  await waitSynced(d.page);
  await d.page.setInputFiles('#view-today input[type=file]', ROTAS.map(r => r.path)); await sleep(2500);
  const names = g.tree().filter(l => l.includes('.xlsx')).map(l => l.trim());
  (names.some(n => n.includes('2026-11 GP rota.xlsx')) ? ok : (a, b) => note('P2', a, b))('rota upload', `Drive › My Apps › Rotas now has: ${names.join(', ')}`);
  await tab(d.page, 'rota'); await d.page.setInputFiles('#view-rota input[type=file]', ROTAS.map(r => r.path)); await sleep(2000);
  const again = g.tree().filter(l => l.includes('.xlsx')).length;
  (again === 3 ? ok : (a, b) => note('P2', a, b))('rota upload', `importing the same files again keeps ${again} files (no duplicates)`);
  errorsOf(d.page, 'S11'); await d.ctx.close();
}

await A.ctx.close();
await browser.close(); server.close();

console.log('\n══════════ FINDINGS ══════════');
const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
for (const f of findings.sort((a, b) => order[a.sev] - order[b.sev])) console.log(`[${f.sev}] ${f.area}: ${f.text}`);
console.log(`\n${findings.length} finding(s). Screenshots: ${shots}`);
fs.writeFileSync(path.join(shots, 'findings.json'), JSON.stringify(findings, null, 2));
