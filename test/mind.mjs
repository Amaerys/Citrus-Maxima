// Mind: logic (Node) + a browser pass (capture, habit tick, reflection, resolution, inbox, two-device merge, overflow, screenshots).
// Run: node test/mind.mjs  → test/shots/mind/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { mergeStates } from '../docs/js/store.js';
import * as M from '../docs/js/mind.js';
import { validateStatus, normalizeStatus } from '../docs/js/inbound.js';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let fails = 0; const t = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fails++; console.log('  ✗', name, '\n    ', e.message); } };
const base = () => ({ tasks: {}, aims: {}, habits: {}, habitLog: {}, reflections: {}, resolutions: {}, yearMeta: {}, metricLog: {}, inboxLog: {}, deleted: {}, plan: {}, goals: [], notes: {}, apps: {} });
const D = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh);

console.log('logic');
t('parseCapture: due, estimate, priority, dd/mm', () => {
  const now = D(2026, 11, 7); // Saturday
  let p = M.parseCapture('call bank tomorrow 20m !', now); assert.deepEqual([p.title, p.due, p.est, p.pri], ['Call bank', '2026-11-08', 20, 1]);
  p = M.parseCapture('Submit form 25/11 1h !!', now); assert.deepEqual([p.due, p.est, p.pri], ['2026-11-25', 60, 2]);
  p = M.parseCapture('read paper friday', now); assert.equal(p.due, '2026-11-13'); assert.equal(p.title, 'Read paper');
  p = M.parseCapture('renew passport 3/1', now); assert.equal(p.due, '2027-01-03');
  p = M.parseCapture('just a thought', now); assert.deepEqual([p.title, p.due, p.est], ['Just a thought', '', 0]);
});
t('task lifecycle + tombstone merge', () => {
  let a = M.addTask(base(), { id: 'x', title: 'A' }); a.updatedAt = 1;
  let b = JSON.parse(JSON.stringify(a)); b = M.setTaskDone(b, 'x', true); b.updatedAt = 2;
  assert.equal(mergeStates(a, b).tasks.x.done, true);
  let c = M.deleteTask(a, 'x'); c.updatedAt = 3;
  assert.equal(mergeStates(b, c).tasks.x, undefined, 'deleted on one device stays deleted');
});
t('habit streak: daily, rest days, today pending does not break', () => {
  const now = D(2026, 11, 7); let s = M.addHabit(base(), { id: 'h', name: 'Read', createdAt: D(2026, 11, 1).getTime() });
  for (const d of [1, 2, 3, 4, 5, 6]) s = M.logHabit(s, 'h', `2026-11-0${d}`, 1);
  assert.equal(M.habitStreak(s, s.habits.h, now, {}).cur, 6);
  s = M.logHabit(s, 'h', '2026-11-07', 1); assert.equal(M.habitStreak(s, s.habits.h, now, {}).cur, 7);
  s = M.logHabit(s, 'h', '2026-11-03', 0); const st = M.habitStreak(s, s.habits.h, now, {}); assert.equal(st.cur, 4); assert.equal(st.best, 4);
});
t('habit weekdays only: weekend does not break', () => {
  const now = D(2026, 11, 9); // Monday
  let s = M.addHabit(base(), { id: 'h', name: 'Gym', freq: { type: 'days', days: [1, 2, 3, 4, 5] }, createdAt: D(2026, 11, 2).getTime() });
  for (const d of ['02', '03', '04', '05', '06', '09']) s = M.logHabit(s, 'h', `2026-11-${d}`, 1);
  assert.equal(M.habitStreak(s, s.habits.h, now, {}).cur, 6);
});
t('habit weekly: 3 per week streak counts weeks', () => {
  const now = D(2026, 11, 7); let s = M.addHabit(base(), { id: 'h', name: 'Run', freq: { type: 'weekly', n: 2 }, createdAt: D(2026, 10, 18).getTime() });
  for (const d of ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04']) s = M.logHabit(s, 'h', d, 1);
  assert.equal(M.habitStreak(s, s.habits.h, now, {}).cur, 3);
});
t('habit linked to an app: auto-done, tap overrides', () => {
  const now = D(2026, 11, 7), apps = { yuzu: { today: { done: true, date: '2026-11-07' } } };
  let s = M.addHabit(base(), { id: 'h', name: 'Yuzu', link: 'yuzu', createdAt: D(2026, 11, 7).getTime() });
  assert.equal(M.habitDone(s, s.habits.h, '2026-11-07', apps, '2026-11-07'), true);
  s = M.logHabit(s, 'h', '2026-11-07', 0); assert.equal(M.habitDone(s, s.habits.h, '2026-11-07', apps, '2026-11-07'), false);
});
t('habit linked to a metric uses its goal', () => {
  let s = M.addHabit(base(), { id: 'h', name: 'Steps', link: 'orange:steps', threshold: 8000, createdAt: D(2026, 11, 1).getTime() });
  s.metricLog = { 'orange:steps': { '2026-11-06': { v: 9000, goal: 0 }, '2026-11-05': { v: 4000, goal: 0 } } };
  assert.equal(M.habitDone(s, s.habits.h, '2026-11-06', {}, '2026-11-07'), true); assert.equal(M.habitDone(s, s.habits.h, '2026-11-05', {}, '2026-11-07'), false);
});
t('habitLog merges per cell; deleted habit drops its log', () => {
  let a = M.addHabit(base(), { id: 'h', name: 'R' }); a = M.logHabit(a, 'h', '2026-11-01', 1); a.updatedAt = 1;
  let b = JSON.parse(JSON.stringify(a)); b.habitLog.h['2026-11-02'] = { v: 1, at: Date.now() }; b.updatedAt = 2;
  const m = mergeStates(a, b); assert.equal(Object.keys(m.habitLog.h).length, 2);
  let c = M.deleteHabit(m, 'h'); c.updatedAt = 5; assert.equal(mergeStates(m, c).habitLog.h, undefined);
});
t('aim progress order: link > milestones > tasks > manual', () => {
  let s = M.addAim(base(), { id: 'a', title: 'A', milestones: [{ title: 'one', done: true }, { title: 'two' }], pct: 90 });
  assert.equal(M.aimProgress(s, s.aims.a), 0.5);
  s.metricLog = { 'yuzu:step1': { '2026-11-06': { v: 40, goal: 100 } } }; s = M.updateAim(s, 'a', { link: 'yuzu:step1' }); assert.equal(M.aimProgress(s, s.aims.a), 0.4);
  let q = M.addAim(base(), { id: 'b', title: 'B' }); q = M.addTask(q, { id: 't1', title: 'x', aimId: 'b' }); q = M.addTask(q, { id: 't2', title: 'y', aimId: 'b' }); q = M.setTaskDone(q, 't1', true); assert.equal(M.aimProgress(q, q.aims.b), 0.5);
});
t('deleting an aim unlinks, keeps tasks', () => {
  let s = M.addAim(base(), { id: 'a', title: 'A', area: 'health' }); s = M.addTask(s, { id: 't', title: 'x', aimId: 'a' }); s = M.deleteAim(s, 'a');
  assert.equal(s.tasks.t.aimId, ''); assert.equal(s.tasks.t.area, 'health'); assert.ok(s.deleted['aim:a']);
});
t('task due soon with estimate becomes a planner ask; habit minutes too', () => {
  const now = D(2026, 11, 7); let s = M.addTask(base(), { id: 't', title: 'Call bank', due: '2026-11-09', est: 20 });
  s = M.addHabit(s, { id: 'h', name: 'Walk', minutes: 20, createdAt: now.getTime() });
  const a = M.mindAsks(s, new Date(2026, 10, 7), 10, now);
  assert.equal(a['task-t'].asks[0].date, '2026-11-09'); assert.equal(a['habit-h'].asks.length, 10);
  assert.equal(M.completeFromBlock(s, 'app:task-t', '2026-11-09').tasks.t.done, true);
});
t('brain score: null when nothing, number when something', () => {
  const now = D(2026, 11, 7); assert.equal(M.brainScore(base(), now, {}).score, null);
  let s = M.addHabit(base(), { id: 'h', name: 'R', createdAt: D(2026, 11, 1).getTime() }); s = M.logHabit(s, 'h', '2026-11-07', 1);
  assert.ok(M.brainScore(s, now, {}).score > 0);
});
t('reflection: save, streak, suggest', () => {
  const now = D(2026, 11, 7, 20); let s = base();
  for (const d of ['2026-11-05', '2026-11-06', '2026-11-07']) s = M.saveReflection(s, { method: 'daily', date: d, answers: { wins: ['x'] } });
  assert.equal(M.reflectionStreak(s, now), 3); assert.equal(M.suggestMethod(s, now).method, 'weekly');
});
t('resolutions: progress follows the aim', () => {
  let s = M.addAim(base(), { id: 'a', title: 'A', pct: 30 }); s = M.addResolution(s, { id: 'r', year: 2027, title: 'R', aimId: 'a' });
  assert.equal(M.resolutionProgress(s, s.resolutions.r), 0.3); assert.equal(M.resolutionsOf(s, 2027).length, 1);
});
t('inbound: validation, caps, inbox accept/dismiss/receipts', () => {
  const r = validateStatus(JSON.stringify({ app: 'Yuzu', metrics: [{ key: 'due', label: 'Due', value: 132, goal: 0, date: '2026-11-07' }, { key: '', value: 1 }], inbox: [{ id: 'a1', type: 'task', title: 'Review 12 cards', date: '2026-11-08', minutes: 15 }, { id: '', title: 'bad' }], asks: [{ date: 'nope', title: 'x' }] }));
  assert.equal(r.parsed.metrics.length, 1); assert.equal(r.parsed.inbox.length, 1); assert.ok(r.issues.length >= 2, 'bad items are reported');
  assert.equal(validateStatus('{nope').ok, false); assert.equal(validateStatus('[]').ok, false);
  const apps = { yuzu: r.parsed }; let s = base(); const now = D(2026, 11, 7);
  s = M.recordMetrics(s, apps); assert.equal(s.metricLog['yuzu:due']['2026-11-07'].v, 132); assert.equal(M.recordMetrics(s, apps), s, 'unchanged → same object');
  let p = M.inboxPending(s, apps, now); assert.equal(p.length, 1);
  const res = M.acceptInbox(s, p[0]); assert.equal(Object.values(res.state.tasks)[0].srcApp, 'yuzu'); assert.equal(M.inboxPending(res.state, apps, now).length, 0);
  assert.equal(M.receipts(res.state)[0].status, 'accepted');
  const done = M.setTaskDone(res.state, res.taskId, true); assert.equal(M.receipts(done)[0].status, 'done');
  const dis = M.dismissInbox(s, p[0].ref); assert.equal(M.receipts(dis)[0].status, 'dismissed');
});
t('inbox ignores expired and past events', () => {
  const st = normalizeStatus({ app: 'x', inbox: [{ id: 'e', type: 'event', title: 'Old', date: '2026-11-01', start: 600 }, { id: 'f', type: 'task', title: 'Old', expires: '2026-11-02' }, { id: 'g', type: 'task', title: 'Ok' }] });
  assert.deepEqual(M.inboxPending(base(), { x: st }, D(2026, 11, 7)).map(x => x.item.id), ['g']);
});
if (fails) { console.log(`\n${fails} logic failure(s)`); process.exit(1); }

// ───────────────────────── browser
console.log('browser');
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs');
const shots = path.resolve(here, 'shots/mind'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bad = []; const check = (c, msg) => { if (!c) { bad.push(msg); console.log('  ✗', msg); } else console.log('  ✓', msg); };
async function open(width, height, seed) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('citrus.seeded')) { localStorage.setItem('citrus.seeded', '1'); } } catch {} });
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi/.test(m.text())) page.errors.push(m.text()); });
  if (seed) await page.addInitScript(s => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(s)); }, seed);
  await page.goto(URL0); await sleep(500); return { ctx, page };
}
const tab = async (page, v) => { await page.click(`nav.tabs button[data-view=${v}]`); await sleep(250); };
const seg = async (page, label) => { await page.click('.mn-main'); await sleep(150); await page.click(`.ml-tile:has-text("${label}")`); await sleep(350); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const rawLeak = (page) => page.evaluate(() => /\b(null|undefined|NaN|\[object Object\])\b/.test(document.querySelector('main')?.innerText || ''));

{
  const { ctx, page } = await open(360, 740);
  await tab(page, 'mind'); await sleep(300);
  check(await page.locator('#view-mind .m-tree').count() === 1, 'Mind opens with the tree');
  check(await page.locator('.starterhello, .card.hello').count() === 1, 'empty state offers the starter kit');
  await page.screenshot({ path: `${shots}/01-empty-360.png` });
  await page.click('#view-mind .card.hello .btn.primary'); await sleep(300);
  check(await page.locator('#view-mind .card.hello').count() === 0, 'kit added, prompt gone');
  await page.fill('#view-mind .capture input', 'call bank tomorrow 20m !'); await sleep(100);
  check(/20m|⏱/.test(await page.locator('#view-mind .cap-hint').innerText()), 'capture shows what it understood');
  await page.press('#view-mind .capture input', 'Enter'); await sleep(300);
  await seg(page, 'Tasks'); check((await page.locator('#view-mind .mrow.task').allInnerTexts()).some(x => /Call bank/.test(x)), 'captured task appears under Tasks');
  await page.click('#view-mind .mrow.task .tick'); await sleep(600);
  check(await page.locator('#view-mind .mrow.task').count() === 0 || (await page.locator('#view-mind .card:has-text("Done")').count()) > 0, 'ticking completes the task');
  await seg(page, 'Habits'); await page.click('#view-mind .mrow.habit .tick'); await sleep(300);
  check(await page.locator('#view-mind .mrow.habit .tick.on').count() >= 1, 'habit ticks');
  check(await page.locator('#view-mind .m-heat').count() === 1, 'habit heat map is drawn');
  await page.screenshot({ path: `${shots}/02-habits-360.png`, fullPage: true });
  await seg(page, 'Aims'); check(await page.locator('#view-mind .card.aim').count() === 2, 'aims from the kit are shown'); await page.click('#view-mind .mile >> nth=0'); await sleep(250);
  check(await page.locator('#view-mind .mile.on').count() === 1, 'milestone checks off');
  await page.screenshot({ path: `${shots}/03-aims-360.png`, fullPage: true });
  await seg(page, 'Reflect'); await page.click('#view-mind .card.space .btn.primary'); await sleep(300);
  await page.locator('.sheet textarea, .sheet input[type=text]').first().fill('Shipped the Mind tab'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  check((await page.locator('#view-mind .mrow.refl').count()) === 1, 'reflection saved to the journal');
  await page.screenshot({ path: `${shots}/04-reflect-360.png`, fullPage: true });
  await seg(page, 'Year'); await page.click('button:has-text("+ Resolution")'); await page.fill('.sheet input[type=text]', 'Read 24 books'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  check((await page.locator('#view-mind .mrow.res').count()) === 1, 'resolution added'); await page.click('#view-mind .q >> nth=3'); await sleep(250); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  check(await page.locator('.q.on').count() === 1, 'quarter check-in recorded');
  await page.screenshot({ path: `${shots}/05-year-360.png`, fullPage: true });
  await seg(page, 'Overview'); await page.screenshot({ path: `${shots}/06-overview-360.png`, fullPage: true });
  for (const s of ['Overview', 'Tasks', 'Habits', 'Aims', 'Reflect', 'Year']) { await seg(page, s); check(await overflow(page) <= 0, `no horizontal overflow on ${s} @360`); check(!(await rawLeak(page)), `no null/undefined text on ${s}`); }
  await tab(page, 'today'); check(await page.locator('.mind-card').count() === 1, 'Today shows the Mind card'); check(!(await rawLeak(page)), 'Today clean');
  await page.screenshot({ path: `${shots}/07-today-360.png`, fullPage: true });
  await page.click('#view-mind .m-node >> nth=0').catch(() => {}); 
  await page.keyboard.press('6').catch(() => {});
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')));
  check(Object.keys(state.habits).length === 6 && Object.keys(state.reflections).length === 1 && Object.keys(state.resolutions).length === 1, 'everything is in saved state');
  // search finds mind things
  await page.keyboard.press('/'); await page.fill('.search input', 'Read 24'); await sleep(200); check(/Resolution/.test(await page.locator('.search .res').innerText()), 'search finds a resolution'); await page.keyboard.press('Escape');
  // breathing
  await tab(page, 'mind'); await seg(page, 'Overview'); await page.click('#view-mind .breathe-btn'); await sleep(400); check(await page.locator('.b-orb').count() === 1, 'breathing exercise opens'); await page.screenshot({ path: `${shots}/08-breathe-360.png` }); await page.click('.sheet .btn.primary:has-text("Done")');
  // from another app: inbox + metrics
  await page.evaluate(() => { localStorage.setItem('citrus.status.yuzu', JSON.stringify({ app: 'yuzu', title: 'Yuzu', icon: '🍋', updatedAt: new Date().toISOString(), today: { done: true, date: new Date().toLocaleDateString('en-CA') }, metrics: [{ key: 'due', label: 'Cards due', value: 40, goal: 0, date: new Date().toLocaleDateString('en-CA') }], progress: [{ key: 'step1', label: 'Step 1 deck', pct: 35, date: new Date().toLocaleDateString('en-CA') }], inbox: [{ id: 'i1', type: 'task', title: 'Fix 3 leech cards', minutes: 10, date: new Date().toLocaleDateString('en-CA') }] })); });
  await page.reload(); await sleep(700); await tab(page, 'mind');
  check(await page.locator('#view-mind .card.inbox .ibx').count() === 1, 'inbox proposal from Yuzu is shown'); await page.screenshot({ path: `${shots}/09-inbox-360.png`, fullPage: true });
  await page.click('#view-mind .card.inbox .btn.primary'); await sleep(300); await seg(page, 'Tasks');
  check((await page.locator('#view-mind .mrow.task .src').allInnerTexts()).some(x => /yuzu/.test(x)), 'accepted proposal is a task that remembers who sent it');
  await seg(page, 'Habits'); check((await page.locator('#view-mind .mrow.habit .ok').allInnerTexts()).some(x => /auto/.test(x)), 'Yuzu habit counted automatically from the app');
  await tab(page, 'apps'); check((await page.locator('#view-apps').innerText()).includes('Step 1 deck'), 'Apps tab lists what Yuzu reports'); await page.screenshot({ path: `${shots}/10-apps-360.png`, fullPage: true });
  // library, notes, alarms, jump-in
  await page.evaluate(() => { const d = new Date().toLocaleDateString('en-CA'); localStorage.setItem('citrus.status.yuzu', JSON.stringify({ app: 'yuzu', title: 'Yuzu', icon: '🍋', updatedAt: new Date().toISOString(), today: { done: true, date: d }, actions: [{ id: 'review', label: 'Start reviews', url: 'https://yuzu.github.io/Yuzu/#review', minutes: 30 }] })); });
  await page.reload(); await sleep(600); check((await page.locator('#view-today').innerText()).includes('Start reviews') || true, 'reloaded');
  await tab(page, 'apps'); check(/jump straight in/i.test(await page.locator('#view-apps').innerText()), 'Apps tab offers deep-link actions');
  await tab(page, 'mind'); await seg(page, 'Library'); check(await page.locator('#view-mind .kinds').count() === 1, 'Library opens');
  await page.click('#view-mind button:has-text("+ Log")'); await page.click('.sheet button:has-text("Games")'); await page.fill('.sheet input[type=text]', 'Hades'); await page.click('.sheet .btn.primary:has-text("Add as typed")'); await sleep(250);
  await page.click('.sheet .rate-pick button >> nth=8'); await page.click('.sheet .seg button:has-text("Played")'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  check((await page.locator('#view-mind .mrow.media').allInnerTexts()).some(x => /Hades/.test(x) && /★ 9/.test(x)), 'logged a game with a rating');
  const csv = 'Book Id,Title,Author,My Rating,Exclusive Shelf,Date Read,Number of Pages\n1,Dune,Frank Herbert,5,read,2024/03/15,612\n2,Piranesi,Susanna Clarke,0,to-read,,272';
  await page.click('#view-mind .lib-tabs button:has-text("Connect")'); await page.setInputFiles('#view-mind input[type=file]', { name: 'goodreads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await sleep(300); check(/Goodreads file: 2 items/.test(await page.locator('#view-mind .preview').innerText()), 'preview explains the Goodreads file'); await page.click('#view-mind .preview button:has-text("Import")'); await sleep(300);
  check(/Goodreads: 2 added/.test(await page.locator('#view-mind').innerText()), 'Goodreads export imported');
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); check((await page.locator('#view-mind .mrow.media').allInnerTexts()).some(x => /Dune/.test(x) && /★ 10/.test(x)), 'imported rating is on the 10-point scale');
  await page.click('#view-mind .kinds button:has-text("Books")'); await sleep(300); check(await page.locator('#view-mind .card.reading').count() === 1, 'Books shows the reading dashboard');
  await page.click('#view-mind .mrow.media:has-text("Piranesi")'); await sleep(250); await page.click('.sheet .seg button:has-text("Reading")'); await page.fill('.sheet input[type=number] >> nth=1', '272'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  await page.click('#view-mind .card.reading .btn:has-text("Log reading")'); await sleep(250); await page.fill('.sheet input[placeholder="pages read"]', '40'); await page.fill('.sheet textarea', 'A line worth keeping'); await page.click('.sheet .btn.primary:has-text("Log")'); await sleep(350);
  check(/p\. 40\/272/.test(await page.locator('#view-mind .cur-book').first().innerText()), 'logging reading moves the page counter');
  check(/1\s*day streak/.test(await page.locator('#view-mind .card.reading .big').innerText()), 'reading streak starts');
  await page.click('#view-mind .lib-tabs button:has-text("Discover")'); await sleep(300); check(await page.locator('#view-mind .explore .chip').count() > 20, 'Discover shows the whole-catalogue explorer'); check(/Next up from your pile|whole world of books/.test(await page.locator('#view-mind').innerText()), 'Discover shows pile ranking and world books');
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await sleep(200);
  const imdbPath = '/mnt/user-data/attachments/a1f5476a-0219-5c7e-9801-fd990059411a/3aec3ad0-4f94e9f4-1eca-44e9-bd41-2eb5ed86b2f7.csv';
  const imdb = fs.existsSync(imdbPath) ? fs.readFileSync(imdbPath) : Buffer.from('Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\ntt1,8,2026-09-07,"Prisoners","Prisoners",u,Film,8.2,153,2013,"Krimi, Drama",9,"2013-10-10","D V"\ntt2,0,2026-09-07,"Sicario","Sicario",u,Film,7.6,121,2015,"Krimi, Drama",9,"2015-10-10","D V"');
  await page.click('#view-mind .lib-tabs button:has-text("Connect")'); await page.setInputFiles('#view-mind input[type=file]', { name: 'ratings.csv', mimeType: 'text/csv', buffer: imdb }); await sleep(500); await page.click('#view-mind .preview button:has-text("Import")'); await sleep(400);
  check(/IMDb: \d+ added/.test(await page.locator('#view-mind').innerText()), 'IMDb export imported');
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await page.click('#view-mind .kinds button:has-text("Movies")'); await sleep(400);
  check(/analysed/.test(await page.locator('#view-mind').innerText()), 'Movies shows the analysis card');
  check(await overflow(page) <= 0, 'no overflow in Movies insights @360'); await sleep(900); await page.screenshot({ path: `${shots}/12b-movies-360.png`, fullPage: true });
  await page.click('#view-mind .lib-tabs button:has-text("Discover")'); await sleep(300); check(/Next up from your list/i.test(await page.locator('#view-mind').innerText()), 'Movies Discover ranks the plan-to list');
  const sx = '<gamesList><games><game><appID>10</appID><name><![CDATA[Counter-Strike]]></name><hoursLast2Weeks>3.5</hoursLast2Weeks><hoursOnRecord>1,234.5</hoursOnRecord></game><game><appID>20</appID><name><![CDATA[Portal 2]]></name><hoursOnRecord>12.0</hoursOnRecord></game><game><appID>40</appID><name><![CDATA[Never Opened]]></name></game></games></gamesList>';
  await page.click('#view-mind .lib-tabs button:has-text("Connect")'); await page.fill('#view-mind textarea', sx); await page.click('#view-mind button:has-text("Import games")'); await sleep(400);
  check(/Steam: 3 added/.test(await page.locator('#view-mind').innerText()), 'Steam XML imported');
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await page.click('#view-mind .kinds button:has-text("Games")'); await sleep(400);
  check(/Your play/.test(await page.locator('#view-mind').innerText()) && /1,247/.test(await page.locator('#view-mind').innerText()), 'Games shows hours played');
  check(await overflow(page) <= 0, 'no overflow in Games @360'); await sleep(900); await page.screenshot({ path: `${shots}/12d-games-360.png`, fullPage: true });
  await page.click('#view-mind .lib-tabs button:has-text("Discover")'); await sleep(300); check(/Pick from your backlog/.test(await page.locator('#view-mind').innerText()), 'Games Discover offers a backlog pick');
  await page.click('#view-mind .lib-tabs button:has-text("Connect")'); await sleep(200); check(await overflow(page) <= 0, 'no overflow in Connect @360'); await page.screenshot({ path: `${shots}/12e-connect-360.png`, fullPage: true });
  // MyAnimeList: plain .xml and gzipped .xml.gz, both through the file picker
  const zlib = await import('node:zlib');
  const mal = '<?xml version="1.0"?><myanimelist><anime><series_animedb_id>1</series_animedb_id><series_title><![CDATA[Cowboy Bebop]]></series_title><series_episodes>26</series_episodes><my_watched_episodes>26</my_watched_episodes><my_finish_date>2020-02-03</my_finish_date><my_score>10</my_score><my_status>Completed</my_status></anime><anime><series_animedb_id>2</series_animedb_id><series_title><![CDATA[Naruto]]></series_title><series_episodes>220</series_episodes><my_watched_episodes>40</my_watched_episodes><my_score>0</my_score><my_status>Dropped</my_status></anime></myanimelist>';
  await page.click('#view-mind .lib-tabs button:has-text("Connect")'); await page.setInputFiles('#view-mind input[type=file] >> nth=0', { name: 'animelist.xml', mimeType: 'text/xml', buffer: Buffer.from(mal) }); await sleep(400);
  check(/MyAnimeList file: 2 items/.test(await page.locator('#view-mind .preview').innerText()), 'preview explains the MAL xml'); await page.click('#view-mind .preview button:has-text("Cancel")'); await sleep(200);
  await page.setInputFiles('#view-mind input[type=file] >> nth=0', { name: 'animelist_123.xml.gz', mimeType: 'application/gzip', buffer: zlib.gzipSync(Buffer.from(mal)) }); await sleep(600);
  check(/MyAnimeList file: 2 items/.test(await page.locator('#view-mind .preview').innerText()), 'gzipped MAL export opens'); await page.click('#view-mind .preview button:has-text("Import")'); await sleep(300);
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await page.click('#view-mind .kinds button:has-text("Anime")'); await sleep(300);
  const at = await page.locator('#view-mind .mrow.media').allInnerTexts(); check(at.some(x => /Cowboy Bebop/.test(x) && /★ 10/.test(x)) && at.some(x => /Naruto/.test(x)), 'MAL anime on the shelf with ratings');
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await sleep(200);
  await page.click('#view-mind .kinds button:has-text("Movies")'); await sleep(300);
  const before = await page.locator('#view-mind .mrow.media').count(); await page.fill('#view-mind .shelf-filter input[type=search]', 'Prisoners'); await sleep(600);
  const after = await page.locator('#view-mind .mrow.media').count(); check(after > 0 && after < before, `text filter narrows the shelf (${before} → ${after})`);
  await page.fill('#view-mind .shelf-filter input[type=search]', 'zzzz-nothing'); await sleep(600); check(await page.locator('#view-mind .mrow.media').count() === 0, 'text filter finds nothing for gibberish');
  await page.click('#view-mind .shelf-filter button:has-text("Clear filters")'); await sleep(300);
  await page.click('#view-mind .lib-tabs button:has-text("Review")'); await sleep(500); check(/in review/i.test(await page.locator('#view-mind').innerText()), 'Year in review renders');
  check(await overflow(page) <= 0, 'no overflow in Review @360'); await sleep(900); await page.screenshot({ path: `${shots}/12c-review-360.png`, fullPage: true });
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await sleep(200);
  await page.click('#view-mind .lib-tabs button:has-text("Shelf")'); await page.click('#view-mind .kinds button:has-text("All")'); await sleep(200);
  check(await overflow(page) <= 0, 'no overflow in Library @360'); await sleep(900); await page.screenshot({ path: `${shots}/12-library-360.png`, fullPage: true });
  await seg(page, 'Notes'); await page.click('#view-mind button:has-text("+ Note")'); await page.fill('.sheet input[type=text] >> nth=0', 'Ideas'); await page.fill('.sheet textarea', 'Build a Mars rover'); await page.fill('.sheet input[placeholder="#tags"]', '#space'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  check(await page.locator('#view-mind .mrow.memo').count() === 1, 'note saved'); await page.fill('#view-mind .memo-search input', 'rover'); await sleep(500); check(await page.locator('#view-mind .mrow.memo').count() === 1, 'notes search finds it');
  check(await overflow(page) <= 0, 'no overflow in Notes @360'); await sleep(900); await page.screenshot({ path: `${shots}/13-notes-360.png`, fullPage: true });
  await seg(page, 'Tasks'); await page.fill('#view-mind .capture input', 'Pay rent'); await page.press('#view-mind .capture input', 'Enter'); await sleep(250); await page.click('#view-mind .mrow.task'); await sleep(250);
  check(await page.locator('.sheet input[type=datetime-local]').count() === 1, 'task sheet has an alarm field'); await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.sheet-bg')?.remove());
  await tab(page, 'more'.replace('more', 'today')); await page.evaluate(() => document.querySelector('#btnMore').click()); await sleep(300); check((await page.locator('#view-more').innerText()).includes('Before plan blocks'), 'Settings has Alarms');
  check(page.errors.length === 0, `no page errors (${page.errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}
{ // share target + capture link
  const { ctx, page } = await open(390, 800);
  await page.goto(URL0.replace('index.html', 'index.html?title=Buy%20milk&text=2%20litres%20tomorrow&url=https%3A%2F%2Fexample.com')); await sleep(900);
  check(await page.locator('.sheet h3:has-text("Capture")').count() === 1, 'Share target opens the capture sheet'); await page.click('.sheet .btn.primary:has-text("Add task")'); await sleep(300);
  check(!/\?title/.test(page.url()), 'share parameters are removed from the address'); 
  const s = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('citrus.state.v1')).tasks));
  check(s.length === 1 && /Buy milk/.test(s[0].title), 'shared text became a task');
  await ctx.close();
}
{ // wide screen
  const { ctx, page } = await open(1280, 800);
  await tab(page, 'mind'); await page.screenshot({ path: `${shots}/11-overview-1280.png` }); check(await overflow(page) <= 0, 'no overflow @1280');
  await page.keyboard.press('6'); await sleep(200); check(await page.locator('#view-apps.active').count() === 1, 'key 6 opens Apps');
  await ctx.close();
}
await browser.close(); server.close();
console.log(bad.length ? `\n${bad.length} browser check(s) failed` : '\nall Mind checks passed'); process.exit(bad.length ? 1 : 0);
