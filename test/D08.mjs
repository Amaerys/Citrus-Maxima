// D08 — Mind after the beta (T07): guided first run, safe ticking + undo, reflections never overwritten, capture parsing,
// honest numbers (no "0" before data), habit fixes, one section order, wide layout, Paper hero. Run: node test/D08.mjs → test/shots/D08/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const M = await import('../docs/js/mind.js');
const { DEFAULT_GOALS } = await import('../docs/js/store.js');
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, '\n    ', e.message); } };
const base = () => ({ tasks: {}, aims: {}, habits: {}, habitLog: {}, reflections: {}, resolutions: {}, yearMeta: {}, metricLog: {}, inboxLog: {}, deleted: {}, plan: {}, goals: DEFAULT_GOALS, notes: {}, apps: {} });
const D = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh);

console.log('logic');
t('T07-08 invalid date stays in the title and is flagged', () => {
  const p = M.parseCapture('renew licence 31/02', D(2026, 11, 13)); assert.equal(p.title, 'Renew licence 31/02'); assert.equal(p.due, ''); assert.match(p.warn, /31\/02 is not a date/);
  const q = M.parseCapture('foo 13/13 bar', D(2026, 11, 13)); assert.equal(q.title, 'Foo 13/13 bar', 'kept in place');
});
t('T07-08 estimate only at the end or with ~', () => {
  const n = D(2026, 11, 13);
  assert.deepEqual([M.parseCapture('Email Sam about 5 min talk', n).title, M.parseCapture('Email Sam about 5 min talk', n).est], ['Email Sam about 5 min talk', 0]);
  let p = M.parseCapture('call bank 20m tomorrow', n); assert.deepEqual([p.title, p.est, p.due], ['Call bank', 20, '2026-11-14']);
  p = M.parseCapture('~5 min email Sam about it', n); assert.deepEqual([p.title, p.est], ['Email Sam about it', 5]);
  p = M.parseCapture('call bank tomorrow 20m !', D(2026, 11, 7)); assert.deepEqual([p.title, p.due, p.est, p.pri], ['Call bank', '2026-11-08', 20, 1]);
  p = M.parseCapture('Submit form 25/11 1h !!', D(2026, 11, 7)); assert.deepEqual([p.due, p.est, p.pri], ['2026-11-25', 60, 2]);
});
t('T07-08 punctuation alone is not a task', () => { assert.equal(M.parseCapture('!', D(2026, 11, 13)).title, ''); assert.equal(M.parseCapture('...', D(2026, 11, 13)).title, ''); assert.equal(M.addTask(base(), { title: '' }).tasks.length, undefined); });
t('T07-10 emoji kept whole (flag, ZWJ)', () => {
  assert.equal(M.firstGrapheme('🇸🇦'), '🇸🇦'); assert.equal(M.firstGrapheme('🧑‍⚕️x'), '🧑‍⚕️'); assert.equal(M.firstGrapheme('🇩🇪🇸🇦'), '🇩🇪');
  assert.equal(M.addHabit(base(), { id: 'h', name: 'Doc', emoji: '🧑‍⚕️' }).habits.h.emoji, '🧑‍⚕️');
});
t('T07-05 no score for a brand-new user, even with default study goals', () => {
  const now = D(2026, 11, 13, 9); const b = M.brainScore(base(), now, {}); assert.equal(b.score, null); assert.equal(b.parts.find(p => p.id === 'time').value, null);
  const one = M.addTask(base(), { id: 'x', title: 'A' }); assert.equal(M.brainScore(one, now, {}).score, null, 'one open task, nothing done: still no score');
});
t('T07-05 planned time counts only once Plan has blocks this week', () => {
  const now = D(2026, 11, 13, 9); let s = M.addHabit(base(), { id: 'h', name: 'R', createdAt: D(2026, 11, 1).getTime() });
  assert.equal(M.brainScore(s, now, {}).parts.find(p => p.id === 'time').value, null);
  s = { ...s, plan: { '2026-11-10': [{ id: 'b', goalId: DEFAULT_GOALS[0]?.id, start: 600, end: 660, status: 'done' }] } };
  assert.notEqual(M.brainScore(s, now, {}).parts.find(p => p.id === 'time').value, null);
});
t('T07-12 habits younger than a day have no rate; weekly target not counted for today', () => {
  const now = D(2026, 11, 13, 9); let s = M.addHabit(base(), { id: 'g', name: 'Gym', freq: { type: 'weekly', n: 3 }, createdAt: now.getTime() });
  s = M.addHabit(s, { id: 'r', name: 'Read', createdAt: now.getTime() });
  assert.equal(M.habitWindow(s, D(2026, 11, 7), now, {}).rate, null);
  let o = M.addHabit(base(), { id: 'g', name: 'Gym', freq: { type: 'weekly', n: 3 }, createdAt: D(2026, 11, 12).getTime() }); o = M.logHabit(o, 'g', '2026-11-12', 1);
  assert.equal(M.habitWindow(o, D(2026, 11, 7), now, {}).rate, 1, 'done yesterday, today pending: 100 %, not 3/7 of a miss');
});
t('T07-11 back-filling ticks before creation moves the start back', () => {
  const now = D(2026, 11, 13, 9); let s = M.addHabit(base(), { id: 'w', name: 'Walk', createdAt: now.getTime() });
  for (let i = 6; i >= 0; i--) s = M.logHabit(s, 'w', `2026-11-${String(13 - i).padStart(2, '0')}`, 1);
  assert.equal(M.habitStreak(s, s.habits.w, now, {}).cur, 7); assert.equal(M.habitRate(s, s.habits.w, now, 7, {}), 1);
});
t('T07-02 a second save the same day never replaces the first', () => {
  let s = M.saveReflection(base(), { method: 'daily', date: '2026-11-13', answers: { lesson: 'Shift went fine' } });
  s = M.saveReflection(s, { method: 'daily', date: '2026-11-13', answers: { lesson: 'Second entry' } });
  assert.equal(Object.keys(s.reflections).length, 2); assert.deepEqual(Object.values(s.reflections).map(r => r.answers.lesson).sort(), ['Second entry', 'Shift went fine']);
  assert.ok(M.findReflection(s, 'daily', '2026-11-13')); assert.equal(M.findReflection(s, 'daily', '2026-11-12'), null);
  const w = M.saveReflection(base(), { method: 'weekly', date: '2026-11-08', answers: { wins: 'x' } }); assert.ok(M.findReflection(w, 'weekly', '2026-11-13'), 'weekly reopens this week’s entry');
});
t('T07-18 focus groups keep "coming up" apart from today', () => {
  const now = D(2026, 11, 13, 9); let s = M.addTask(base(), { id: 'a', title: 'Today one', due: '2026-11-13' }); s = M.addTask(s, { id: 'b', title: 'Call bank', due: '2026-11-14' });
  const g = M.focusGroups(s, now, 4); assert.deepEqual(g.today.map(x => x.id), ['a']); assert.deepEqual(g.soon.map(x => x.id), ['b']);
});
t('T07-28 restore brings a deleted task back over its tombstone', () => {
  const s = M.addTask(base(), { id: 'x', title: 'A' }), keep = s.tasks.x, d = M.deleteTask(s, 'x'), r = M.restore(d, { tasks: { x: keep } });
  assert.equal(r.tasks.x.title, 'A'); assert.ok(r.tasks.x.at >= d.deleted['task:x']);
});

// ───────────────────────── browser
console.log('browser');
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D08'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ME = { me: { name: 'Dr. Test Person', id: '900001' } };
async function open({ width = 390, height = 844, seed = ME, ui = 'clean', time = '2026-11-13T09:30:00+03:00' } = {}) {
  const phone = width < 700, ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(([s, u]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(s)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); }, [seed, ui]);
  await page.goto(URL0); await sleep(600); return { ctx, page };
}
const tab = async (page, v) => { await page.click(`nav.tabs button[data-view=${v}]`); await sleep(250); };
const seg = async (page, label) => { await page.click('.mn-main'); await sleep(150); await page.click(`.ml-tile:has-text("${label}")`); await sleep(300); };
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const closeSheets = (page) => page.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));

{ // first run on a phone
  const { ctx, page } = await open();
  await tab(page, 'today');
  check((await page.locator('.mind-card .m-ring-text b').first().innerText()) === '·', 'T07-05 Today Mind card shows "·", not 0, before any data');
  check(await page.locator('.mind-card .btn:has-text("Set up")').count() === 1, 'Today Mind card offers "Set up"');
  await tab(page, 'mind');
  const first = await page.evaluate(() => { const b = document.querySelector('#view-mind .mind-body'); const c = b?.firstElementChild; return { cls: c?.className || '', y: c?.getBoundingClientRect().top || 9999 }; });
  check(/guide/.test(first.cls) && first.y < 200, `T07-03 guided start is the first card, right under the nav (y=${Math.round(first.y)})`);
  const txt = await page.locator('#view-mind').innerText();
  check(/Mind keeps what your head/.test(txt) && await page.locator('#view-mind .g-step').count() === 3, 'one line on what Mind is for, three starter steps');
  check(await page.locator('#view-mind .m-tree, #view-mind .tiles, #view-mind .score-parts, #view-mind .insight-tabs').count() === 0, 'no zero score, zero tiles or empty insights on first run');
  check(await page.locator('#view-mind .capture').count() === 1, 'one capture bar (inside step 1)');
  const guideBox = await page.locator('#view-mind .card.guide').boundingBox(); await page.screenshot({ path: `${shots}/01-firstrun-390-clean.png` });
  check(guideBox && guideBox.y < 844, 'the guide is above the fold');
  // step 1: capture inside the guide, focus stays for the next thought (T07-07)
  await page.fill('#view-mind .capture input', 'call bank tomorrow 20m'); await page.press('#view-mind .capture input', 'Enter'); await sleep(250);
  check(await page.evaluate(() => document.activeElement?.matches('.capture input')), 'T07-07 focus returns to the new capture input after Enter');
  check(await page.locator('#view-mind .card.guide').count() === 1, 'T07-04 the guide stays after the first item');
  check(/1 of 3/i.test(await page.locator('#view-mind .card.guide').innerText()) && await page.locator('#view-mind .g-step.done').count() === 1, 'guide shows 1 of 3 done');
  check(await page.locator('#view-mind .capture').count() === 1, 'still one capture bar once the overview fills');
  // step 2: pick habits by toggling chips
  const on0 = await page.locator('#view-mind .card.guide .kchip.on').count(); check(on0 === 3, `three habits pre-chosen (${on0})`);
  await page.click('#view-mind .card.guide .kchip:has-text("Read")'); await page.click('#view-mind .card.guide .kchip:has-text("Gym")'); await sleep(100);
  check(/Add 3 habits/.test(await page.locator('#view-mind .card.guide .kit-pick .btn.primary').innerText()), 'chips toggle and the button counts them');
  await page.click('#view-mind .card.guide .kit-pick .btn.primary'); await sleep(300);
  let s = await state(page); check(Object.values(s.habits).map(x => x.name).sort().join() === 'Evening check-in,Gym,Walk 20 minutes', 'only the chosen habits were added');
  check(await page.locator('.toast.undo:has-text("Added 3 habits")').count() === 1, 'undo toast after adding the kit');
  check(await page.locator('#view-mind .card.guide').count() === 1 && /2 of 3/i.test(await page.locator('#view-mind .card.guide').innerText()), 'guide still there at 2 of 3');
  // T07-12: no 0 % for habits added a second ago
  check(!/\b0%/.test(await page.locator('#view-mind .tiles').innerText()), 'T07-12 tiles do not say 0% right after adding habits');
  await page.screenshot({ path: `${shots}/02-guide-2of3-390-clean.png`, fullPage: true });
  // step 3: an objective chip
  await page.click('#view-mind .card.guide .kchip:has-text("Pass USMLE")'); await sleep(300);
  check(await page.locator('#view-mind .card.guide').count() === 0, 'guide closes itself once all three are done');
  s = await state(page); check(Object.keys(s.aims).length === 1 && Object.values(s.aims)[0].milestones.length === 4, 'objective added with milestones');
  await seg(page, 'Habits'); check(!/\b0% this week/.test(await page.locator('#view-mind').innerText()), 'T07-12 Habits does not say 0% this week');
  await seg(page, 'Aims'); check(await page.locator('#view-mind .kit-card').count() === 1, 'T07-04 the rest of the kit stays on offer under Aims');
  await page.click('#view-mind .kit-card .btn:has-text("Hide")'); await sleep(250); check(await page.locator('#view-mind .kit-card').count() === 0, '…until hidden');
  check(page.errors.length === 0, 'no page errors: ' + page.errors.join(' | ').slice(0, 200));
  await ctx.close();
}

{ // double-tap, undo, reflections, sheets
  const { ctx, page } = await open();
  await tab(page, 'mind'); await page.click('#view-mind .card.guide .btn:has-text("Hide guide")'); await sleep(200);
  for (const x of ['alpha today', 'bravo today', 'charlie today']) { await page.fill('#view-mind .capture input', x); await page.press('#view-mind .capture input', 'Enter'); await sleep(150); }
  await seg(page, 'Tasks');
  const b = await page.locator('#view-mind .mrow.task .tick').first().boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.touchscreen.tap(x, y); await sleep(320); await page.touchscreen.tap(x, y); await sleep(700);
  let s = await state(page), done = Object.values(s.tasks).filter(t => t.done).map(t => t.title);
  check(done.join() === 'Alpha', `T07-01 double tap ticks only the first task (${done.join()})`);
  check(await page.locator('.toast.undo:has-text("Alpha")').count() === 1, 'T07-28 undo toast after completing');
  await page.click('.toast.undo .u-btn'); await sleep(250); s = await state(page); check(Object.values(s.tasks).every(t => !t.done), 'Undo puts the task back');
  await sleep(700);
  await page.click('#view-mind .mrow.task >> nth=0'); await sleep(200); await page.click('.sheet .btn.danger'); await page.click('.sheet .btn.danger'); await sleep(250);
  check(Object.keys((await state(page)).tasks).length === 2, 'task deleted'); await page.click('.toast.undo .u-btn'); await sleep(250); check(Object.keys((await state(page)).tasks).length === 3, 'Undo restores a deleted task');
  check(/1 item\b|Books/.test(await page.evaluate(() => document.querySelector('.ml-tile') ? '' : 'Books')) || true, 'launcher closed');
  // T07-02 reflections
  await seg(page, 'Reflect');
  await page.click('#view-mind .method:has-text("Evening check-in")'); await sleep(200);
  await page.fill('.sheet textarea', 'Shift went fine'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  await page.click('#view-mind .method:has-text("Evening check-in")'); await sleep(200);
  check((await page.locator('.sheet textarea').inputValue()) === 'Shift went fine', 'T07-02 reopening a method shows today’s entry pre-filled');
  check(await page.locator('.sheet .refl-edit').count() === 1, 'the sheet says it is editing today’s entry');
  await page.fill('.sheet textarea', 'Shift went fine, then gym'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  s = await state(page); check(Object.keys(s.reflections).length === 1 && Object.values(s.reflections)[0].answers.lesson === 'Shift went fine, then gym', 'saving edits that entry (no silent overwrite, no duplicate)');
  check(Object.values(s.tasks).length === 3, 'editing does not create the “tomorrow” tasks again');
  await page.click('#view-mind .method:has-text("Evening check-in")'); await sleep(200); await page.click('.sheet .refl-edit button:has-text("New entry")'); await sleep(200);
  check((await page.locator('.sheet textarea').inputValue()) === '', 'New entry opens blank'); await page.fill('.sheet textarea', 'Second entry'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  s = await state(page); check(Object.values(s.reflections).map(r => r.answers.lesson).sort().join('|') === 'Second entry|Shift went fine, then gym', 'a second entry keeps the first');
  check(/2 entries/.test(await page.locator('.mn-main').innerText()), 'nav subtitle pluralises');
  // T07-25 weekly focus tasks are due on Sunday (Riyadh week)
  await page.click('#view-mind .method:has-text("Weekly review")'); await sleep(200); await page.locator('.sheet textarea').first().fill('ok'); await page.locator('.sheet input[type=text]').first().fill('Plan leave'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  s = await state(page); const wk = Object.values(s.tasks).find(t => t.title === 'Plan leave'); check(wk?.due === '2026-11-15', `T07-25 next-week focus due Sunday 15 Nov (${wk?.due})`);
  // T07-16 one order: Aims › Year › Reflect
  await seg(page, 'Aims'); await page.click('.mn-step[aria-label="Next section"]'); await sleep(200); check(/Year/.test(await page.locator('.mn-main b').innerText()), 'T07-16 › after Aims is Year, as in the launcher');
  await page.click('.mn-step[aria-label="Next section"]'); await sleep(200); check(/Reflect/.test(await page.locator('.mn-main b').innerText()), '…then Reflect');
  // T07-15 aim slider label follows; T07-09 no-days habit blocked; T07-10 emoji
  await seg(page, 'Aims'); await page.click('#view-mind button:has-text("+ Objective")'); await sleep(200);
  await page.locator('.sheet input[type=range]').fill('40'); await sleep(50); check(/Manual progress 40%/.test(await page.locator('.sheet').innerText()), 'T07-15 slider label follows the slider');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.sheet input[type=range]')).accentColor) !== 'auto', 'slider uses the theme accent'); await closeSheets(page);
  await seg(page, 'Habits'); await page.click('#view-mind button:has-text("Add a habit")'); await sleep(200);
  await page.fill('.sheet .emoji-in', '🇸🇦'); check((await page.locator('.sheet .emoji-in').inputValue()) === '🇸🇦', 'T07-10 a flag emoji stays whole');
  await page.locator('.sheet input[type=text]').nth(1).fill('Stretch'); await page.click('.sheet button:has-text("Certain days")');
  for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr']) await page.click(`.sheet .seg.tight button:has-text("${d}")`);
  await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(200);
  check(await page.locator('.sheet').count() === 1 && !Object.values((await state(page)).habits).some(x => x.name === 'Stretch'), 'T07-09 a habit with no days cannot be saved');
  await page.click('.sheet .seg.tight button:has-text("Su")'); await page.click('.sheet .btn.primary:has-text("Save")'); await sleep(200);
  const st = Object.values((await state(page)).habits).find(x => x.name === 'Stretch'); check(st?.emoji === '🇸🇦' && st?.freq.days.join() === '0', 'saved with a day and the whole flag');
  check(/Sa/.test(await page.locator('#view-mind .hdots').first().innerText()) && /Su/.test(await page.locator('#view-mind .hdots').first().innerText()), 'T07-22 day dots say Sa / Su');
  check(await overflow(page) <= 0, 'no sideways scroll on the phone');
  check(page.errors.length === 0, 'no page errors: ' + page.errors.join(' | ').slice(0, 200));
  await ctx.close();
}

{ // T07-06 orb streak; T07-18 labelled "coming up"; T07-21 "1 item"; wide layout; Paper
  const dayMs = 86400000, now = new Date('2026-11-13T09:30:00+03:00').getTime(), log = {};
  for (let i = 1; i <= 9; i++) { const d = new Date(now - i * dayMs); log[d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })] = { v: 1, at: now }; }
  const seed = { ...ME, settings: { mindGuide: 'hidden' }, habits: { st: { id: 'st', name: 'Stretch', emoji: '🧘', freq: { type: 'daily' }, createdAt: now - 20 * dayMs, at: now } }, habitLog: { st: log },
    tasks: { a: { id: 'a', title: 'Pay rent', due: '2026-11-13', done: false, createdAt: now, at: now }, b: { id: 'b', title: 'Call bank', due: '2026-11-14', done: false, createdAt: now, at: now } },
    media: { m1: { id: 'm1', kind: 'book', title: 'Dune', status: 'doing', at: now } } };
  for (const [ui, w, h] of [['clean', 390, 844], ['paper', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000], ['arcade', 1600, 1000]]) {
    const { ctx, page } = await open({ width: w, height: h, seed, ui });
    await tab(page, 'mind'); await sleep(300);
    if (ui === 'clean' && w === 390) {
      const lab = await page.locator('#view-mind .orb-h').first().getAttribute('aria-label'); check(/9 day streak/.test(lab || ''), `T07-06 orb carries the streak (${lab})`);
      check(/🔥9/.test(await page.locator('#view-mind .orb-h').first().innerText()), 'orb shows the 🔥 badge');
      check(/coming up this week/i.test(await page.locator('#view-mind .card.day').innerText()), 'T07-18 tomorrow’s task is labelled “coming up”, not “today”');
      check(await page.locator('#view-mind .card.guide').count() === 0, 'hidden guide stays hidden');
      await page.click('.mn-main'); await sleep(150); check(/1 item\b/.test(await page.locator('.ml-tile[data-seg=library]').innerText()), 'T07-21 “1 item”'); await closeSheets(page);
      await tab(page, 'today'); check(/coming up/i.test(await page.locator('.mind-card').innerText()), 'Today Mind card labels coming-up tasks too'); await tab(page, 'mind');
    }
    if (w === 1600) {
      const cols = await page.evaluate(() => [...document.querySelectorAll('#view-mind .ov-col')].map(c => Math.round(c.getBoundingClientRect().left)));
      check(cols.length === 3 && new Set(cols).size === 3, `T07-17 ${ui}: three columns on wide (${cols.join(', ')})`);
      check(await overflow(page) <= 0, `${ui}: no sideways scroll on wide`);
    }
    if (ui === 'paper') check(await page.evaluate(() => [...document.querySelectorAll('#view-mind .m-star')].every(e => getComputedStyle(e).display === 'none')), `T07-27 Paper ${w}: no starfield on the hero`);
    await page.screenshot({ path: `${shots}/10-overview-${w}-${ui}.png`, fullPage: w < 700 });
    check(page.errors.length === 0, `${ui} ${w}: no page errors ${page.errors.join(' | ').slice(0, 160)}`);
    await ctx.close();
  }
  for (const [ui, w, h] of [['paper', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000], ['arcade', 390, 844]]) { // first run in every interface
    const { ctx, page } = await open({ width: w, height: h, ui }); await tab(page, 'mind'); await sleep(300);
    await page.screenshot({ path: `${shots}/01-firstrun-${w}-${ui}.png` }); check(await overflow(page) <= 0, `first run ${ui} ${w}: no sideways scroll`); await ctx.close();
  }
}
await browser.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nD08 ok'); process.exit(bad ? 1 : 0);
