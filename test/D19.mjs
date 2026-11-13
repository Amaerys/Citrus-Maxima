// D19 — Plan tab: weekly cockpit, day cards, block actions, Rules / Goals / Move sheets. Run: node test/D19.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const PV = await import('../docs/js/plan-view.js');
const { dayBusy } = await import('../docs/js/planner.js');
const { DEFAULT_RULES, DEFAULT_GOALS } = await import('../docs/js/store.js');

let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = (n, f) => { try { f(); console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', e.message.split('\n').slice(0, 3).join('\n     ')); } };

console.log('D19 plan-view (unit)');
t('parseHM reads 24-hour times and refuses junk', () => {
  assert.equal(PV.parseHM('22:30'), 1350); assert.equal(PV.parseHM('0930'), 570); assert.equal(PV.parseHM('9'), 540); assert.equal(PV.parseHM('7.05'), 425);
  for (const x of ['', '25:00', '12:60', 'abc', null, '1:2']) assert.equal(PV.parseHM(x), null, String(x));
});
t('checkRules: blank keeps the old value, out of range is an error, Plan until must be after Plan from', () => {
  const old = { ...DEFAULT_RULES };
  let r = PV.checkRules({ sleepStart: '', sleepHours: '' }, old); assert.deepEqual(r.errors, {}); assert.equal(r.rules.sleepStart, old.sleepStart); assert.equal(r.rules.sleepHours, old.sleepHours);
  r = PV.checkRules({ sleepHours: '0' }, old); assert.ok(r.errors.sleepHours);
  r = PV.checkRules({ earliestPlan: '22:00', latestPlan: '08:00' }, old); assert.ok(r.errors.latestPlan, 'until before from');
  r = PV.checkRules({ sleepStart: '11:30 PM' }, old); assert.ok(r.errors.sleepStart);
  r = PV.checkRules({ after12h: 'rest', napBeforeNight: false, windDownMin: '45' }, old); assert.equal(r.rules.after12h, 'rest'); assert.equal(r.rules.napBeforeNight, false); assert.equal(r.rules.windDownMin, 45);
});
t('checkGoal: name required, h/week ≥ 0, min ≤ max', () => {
  assert.ok(PV.checkGoal({ name: '', hoursPerWeek: 2, minBlock: 30, maxBlock: 60, priority: 1 }).errors.name);
  assert.ok(PV.checkGoal({ name: 'Gym', hoursPerWeek: -3, minBlock: 30, maxBlock: 60, priority: 1 }).errors.hoursPerWeek);
  assert.ok(PV.checkGoal({ name: 'Gym', hoursPerWeek: 3, minBlock: 90, maxBlock: 60, priority: 1 }).errors.maxBlock);
  const ok = PV.checkGoal({ name: ' Gym ', hoursPerWeek: '0', minBlock: '60', maxBlock: '90', priority: '4' }); assert.deepEqual(ok.errors, {}); assert.equal(ok.goal.name, 'Gym'); assert.equal(ok.goal.hoursPerWeek, 0);
});
// synthetic rota: 1st = night, 2nd = after the night, 3rd = 12h day
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const gp = { id: 'gp', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' } },
  people: [{ name: 'Dr Test', id: '1', days: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, { 1: 'N1', 4: 'D1', 5: 'D1' }[i + 1] || ''])) }] };
const base = { rotas: { gp }, me: { id: '1', name: 'Dr Test' }, rules: { ...DEFAULT_RULES }, goals: DEFAULT_GOALS, plan: {}, prefs: {}, swaps: {}, settings: {} };
t('dayRows: the shift row shows the real hours with leave / home as a note (T06-05)', () => {
  const d = new Date(2026, 10, 4), rows = PV.dayRows(base, dayBusy(base, d));
  const sh = rows.find(r => r.type === 'shift'); assert.equal(sh.time, '08:00–20:00'); assert.match(sh.sub, /leave \d\d:\d\d · home ~\d\d:\d\d/);
  assert.ok(rows.some(r => r.lights && /lights out/.test(r.label)), 'lights-out row');
});
t('dayRows: after a night, the tail and recovery sleep are rows (T06-23)', () => {
  const rows = PV.dayRows(base, dayBusy(base, new Date(2026, 10, 2)));
  assert.ok(rows[0].type === 'shift' && /→ 08:00/.test(rows[0].time), 'night tail first: ' + rows[0].time);
  assert.ok(rows.some(r => r.type === 'sleep' && /Recovery sleep/.test(r.label)), 'recovery sleep row');
});
t('dailyBed: early start tomorrow → bedtime from Settings › Sleep (T01-19)', () => {
  assert.equal(PV.dailyBed(base, new Date(2026, 10, 3)), 480 - 90 - 480 + 1440);   // 22:30
  assert.equal(PV.dailyBed(base, new Date(2026, 10, 10)), null);
});
t('goalWeek counts the Study log of the linked subject, without adding Done twice (T06-21)', () => {
  const s = { ...base, study: { s1: { id: 's1', name: 'Step 1 pathology', app: '', perWeek: 300, block: 60 } }, studyLog: { '2026-11-09:s1': { mins: 90 } },
    plan: { '2026-11-09': [{ id: 'a', goalId: 'g-usmle', start: 600, end: 660, status: 'done' }], '2026-11-10': [{ id: 'b', goalId: 'g-usmle', start: 600, end: 720, status: 'accepted' }] } };
  const w = PV.goalWeek(s, DEFAULT_GOALS[0], new Date(2026, 10, 8), {}, new Date(2026, 10, 10, 9));
  assert.equal(w.done, 90); assert.equal(w.acc, 120); assert.equal(w.subject, 'Step 1 pathology');
});

// ───────── browser
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D19'); fs.mkdirSync(shots, { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: browser part skipped'); process.exit(bad ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); const errors = [];
const seed = { me: { name: 'Dr. Reem Mahgoub', id: '437326' }, study: { sa: { id: 'sa', name: 'Anatomy & imaging', app: 'Anatomy', perWeek: 150, block: 45, at: 1 }, sp: { id: 'sp', name: 'Step 1 pathology', app: 'Step 1 pathology', perWeek: 300, block: 60, at: 1 } } };
async function open(width, time, ui = 'clean', horizon = 7) {
  const phone = width < 800, ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 1000 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.clock.install({ time: new Date(time) });
  await p.addInitScript(([s, u, hz]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(s)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); localStorage.setItem('citrus.planDays', String(hz)); }, [seed, ui, horizon]);
  await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx'), data('uv.xlsx'), data('fsed.xlsx')].filter(fs.existsSync)); await sleep(2500);
  await p.evaluate(() => document.querySelectorAll('.sheet-bg, .toast').forEach(e => e.remove()));
  await p.click('nav.tabs button[data-view=plan]'); await sleep(500);
  return { p, ctx };
}
const st = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')));
const card = (p, k) => p.locator(`#pd-${k}`);
const closeSheets = (p) => p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));

console.log('D19 Plan tab (phone, Fri 13 Nov 09:30)');
{
  const { p, ctx } = await open(390, '2026-11-13T09:30:00+03:00');
  const txt = await p.locator('#view-plan').innerText();
  check(!/\b(null|undefined|NaN)\b/.test(txt), 'no stray words');
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll at 390');
  check(await p.locator('#view-plan .plan-week .pl-pill').count() === 4 && /REST|Rest/.test(await p.locator('#view-plan .plan-week').innerText()), 'week cockpit: rest / study / gym / social tiles');
  check(await p.locator('#view-plan .pl-strip .pl-cell').count() === 7, 'week strip: one cell per visible day');
  check(/Today · Friday 13\/11/.test(txt) && /\nSunday 15\/11/.test(txt) && !/Sun 15\/11 · Sunday/.test(txt), 'day titles say the date once (T06-27)');
  const starts = await card(p, '2026-11-13').locator('.tl-block.suggested .pl-time').allInnerTexts();
  check(starts.length && starts.every(s => s.slice(0, 5) >= '09:30'), `nothing offered in the past today: ${starts.join(', ')}`);
  const mon = await card(p, '2026-11-16').innerText();
  check(/08:00–20:00\s+Day · Upper Village/.test(mon) && /leave \d\d:\d\d · home ~\d\d:\d\d/.test(mon), 'shift row: real hours, leave / home as a note (T06-05)');
  check(/lights out \d\d:\d\d/i.test(mon), 'lights-out row shown (T06-23)');
  check(await card(p, '2026-11-16').locator('.pl-mode').count() === 1 && /12h shift/.test(await card(p, '2026-11-16').locator('.pl-mode').innerText()), 'day label from the planner on the card');
  check(await p.locator('#view-plan .tl-block.studyp').count() >= 1, 'study-plan blocks on the day cards (T06-22): ' + (await p.locator('#view-plan .tl-block.studyp .t').allInnerTexts()).slice(0, 2).join(', '));
  // one action order everywhere: Accept, Move, Skip, then the app slot
  const orders = await p.locator('#view-plan .tl-block.suggested:not(.studyp) .actions').evaluateAll(els => els.map(e => [...e.children].map(c => c.textContent.trim().replace(/[^A-Za-z]/g, '').slice(0, 6) || (c.classList.contains('ph') ? '·' : 'icon')).slice(0, 3).join(',')));
  check(orders.length && orders.every(o => o === 'Accept,Move,Skip'), 'Accept · Move · Skip in the same order on every block (T06-25)');
  await p.screenshot({ path: `${shots}/phone-clean.png`, fullPage: true });

  // move a Saturday suggestion to Sunday (T06-03)
  const sat = card(p, '2026-11-14'), gb = sat.locator('.tl-block.suggested:has-text("German")');
  if (await gb.count()) {
    await gb.locator('button:has-text("Move")').click(); await sleep(200);
    await p.fill('.sheet input[type=date]', '2026-11-15'); await p.fill('.sheet input[name=start]', '06:00'); await p.fill('.sheet input[name=end]', '07:00');
    await p.click('.sheet button:has-text("Save")'); await sleep(500);
    const s = await st(p);
    check((s.plan['2026-11-15'] || []).some(b => /German/.test(b.title) && b.status === 'accepted' && b.start === 360), 'moved block accepted on Sunday 06:00');
    check(await card(p, '2026-11-14').locator('.tl-block.suggested:has-text("German")').count() === 0, 'and gone from Saturday');
    check(await card(p, '2026-11-15').locator('.tl-block.suggested:has-text("German")').count() === 0, 'and Sunday gets no second German suggestion');
  } else check(false, 'Saturday has a German suggestion to move');

  // Move with a blank start is refused (T06-04)
  await card(p, '2026-11-15').locator('.tl-block.acc button:has-text("Move")').first().click(); await sleep(200);
  await p.fill('.sheet input[name=start]', ''); await p.click('.sheet button:has-text("Save")'); await sleep(200);
  check(await p.locator('.sheet').count() === 1 && /Pick a start/.test(await p.locator('.sheet .fe').innerText()), 'blank time: sheet stays open with a reason');
  check((await st(p)).plan['2026-11-15'].every(b => Number.isFinite(b.start)), 'nothing saved as null'); await closeSheets(p);

  // Done: only from the block's day, logs to the subject, undo / remove take it back (T06-18, 19, 20)
  check(await card(p, '2026-11-15').locator('.tl-block.acc button:has-text("Done")').count() === 0, 'no Done on a future day');
  const today = card(p, '2026-11-13'), us = today.locator('.tl-block.suggested:has-text("USMLE")');
  if (await us.count()) {
    await us.locator('button:has-text("Accept")').click(); await sleep(300);
    const blk = (await st(p)).plan['2026-11-13'].find(b => /USMLE/.test(b.title)), mins = blk.end - blk.start;
    await card(p, '2026-11-13').locator('.tl-block.acc:has-text("USMLE") button:has-text("Done")').click(); await sleep(300);
    let s = await st(p); check(s.studyLog?.['2026-11-13:sp']?.mins === mins, `Done logs ${mins} min to Step 1 pathology`);
    await card(p, '2026-11-13').locator('.tl-block.acc:has-text("USMLE") button.pl-done').click(); await sleep(300);
    s = await st(p); check(!s.studyLog?.['2026-11-13:sp'], 'tapping "✓ done" undoes it and takes the minutes back');
    await card(p, '2026-11-13').locator('.tl-block.acc:has-text("USMLE") button:has-text("Done")').click(); await sleep(300);
    await card(p, '2026-11-13').locator('.tl-block.acc:has-text("USMLE") button:has-text("Remove")').click(); await sleep(300);
    s = await st(p); check(!s.studyLog?.['2026-11-13:sp'] && !(s.plan['2026-11-13'] || []).some(b => /USMLE/.test(b.title)), 'removing a done block takes its minutes back');
  } else check(false, 'today has a USMLE suggestion');

  // Skip says what happened (T06-02 UI side)
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(e => e.remove()));
  await card(p, '2026-11-14').locator('.tl-block.suggested:not(.studyp) button:has-text("Skip")').first().click(); await sleep(300);
  check(/moved to \d\d:\d\d|dropped for/.test(await p.locator('.toast').last().innerText().catch(() => '')), 'Skip toast: moved to … / dropped for …');

  // Rules: blanks keep values, an inverted window is refused, 24-hour fields (T06-14, 15, 26)
  await p.click('#view-plan button:has-text("Rules")'); await sleep(250);
  check(await p.locator('.sheet input[type=time]').count() === 0 && await p.inputValue('.sheet input[name=sleepStart]') === '23:30', 'Rules times are 24-hour text fields');
  check(await p.locator('.sheet select[name=after12h]').count() === 1 && await p.locator('.sheet input[name=windDownMin]').count() === 1 && await p.locator('.sheet input[name=napBeforeNight]').count() === 1, 'new planner rules in the sheet');
  await p.fill('.sheet input[name=earliestPlan]', '22:00'); await p.fill('.sheet input[name=latestPlan]', '08:00'); await p.click('.sheet button:has-text("Save rules")'); await sleep(200);
  check(await p.locator('.sheet').count() === 1 && /after/.test(await p.locator('.sheet .rs-f.bad .fe').first().innerText()), 'Plan until before Plan from is refused inline');
  await p.fill('.sheet input[name=earliestPlan]', '08:00'); await p.fill('.sheet input[name=latestPlan]', '23:00'); await p.fill('.sheet input[name=sleepStart]', ''); await p.fill('.sheet input[name=sleepHours]', '');
  await p.click('.sheet button:has-text("Save rules")'); await sleep(300);
  let s = await st(p); check(await p.locator('.sheet').count() === 0 && s.rules.sleepStart === 1410 && s.rules.sleepHours === 7.5, 'blank fields keep their old values');
  // Goals (T06-16)
  await p.click('#view-plan button:has-text("Edit goals")'); await sleep(250);
  const gym = p.locator('.sheet .goal-row').nth(3); await gym.locator('[name=minBlock]').fill('90'); await gym.locator('[name=maxBlock]').fill('60'); await p.locator('.sheet .goal-row').nth(0).locator('[name=name]').fill('');
  await p.click('.sheet button:has-text("Save goals")'); await sleep(200);
  check(await p.locator('.sheet .rs-f.bad').count() === 2, 'goal checks: name required, min ≤ max');
  await p.click('.sheet button:has-text("Cancel")'); await sleep(200); check(await p.locator('.sheet').count() === 0, 'Cancel closes');
  await ctx.close();
}

console.log('D19 night run (Paper, Sun 1 Nov) and 320px');
{
  const { p, ctx } = await open(320, '2026-11-01T09:30:00+03:00', 'paper', 3);
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll at 320');
  const t2 = await card(p, '2026-11-02').innerText();
  check(/→ 08:00/.test(t2) && /Recovery sleep/.test(t2), 'between nights: night tail and recovery sleep shown');
  check(await p.locator('#view-plan .tl-block.rest').count() >= 1, 'nap / rest-before-night blocks styled as rest');
  await p.click('#view-plan button:has-text("Rules")'); await sleep(250);
  check(await p.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth; }), 'Rules sheet fits 320px');
  await p.screenshot({ path: `${shots}/phone-320-paper-rules.png` }); await closeSheets(p);
  await p.click('#view-plan button:has-text("Edit goals")'); await sleep(250);
  check(await p.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth; }), 'Goals sheet fits 320px');
  await closeSheets(p); await p.screenshot({ path: `${shots}/phone-320-paper.png`, fullPage: true });
  await ctx.close();
}

console.log('D19 wide (1600)');
{
  const { p, ctx } = await open(1600, '2026-11-13T09:30:00+03:00', 'clean', 7);
  const tops = await p.locator('#view-plan .plan-day').evaluateAll(els => els.slice(0, 3).map(e => Math.round(e.getBoundingClientRect().top)));
  check(tops.length === 3 && tops[0] === tops[1] && tops[1] === tops[2], 'day cards side by side');
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
  await p.screenshot({ path: `${shots}/wide-clean.png` });
  await p.click('nav.tabs button[data-view=today], .rail button[data-view=today]'); await sleep(400);
  check(await p.locator('#view-today .plan-card').count() === 0 && await p.locator('#view-today .ck-plan .plan-day').count() >= 1, 'wide Today: plan only once, in its column (T06-24)');
  await ctx.close();
}

console.log('D19 Today plan card on a work day');
{
  const { p, ctx } = await open(390, '2026-11-16T21:50:00+03:00', 'clean', 3);
  await p.click('nav.tabs button[data-view=today]'); await sleep(400);
  const pc = p.locator('#view-today .plan-card');
  if (await pc.count() === 0) await p.click('#view-today .more-today summary').catch(() => {});
  const txt = await pc.innerText().catch(() => '');
  check(/Nothing extra today|Yuzu|USMLE|German|rest/i.test(txt) && txt.split('\n').length > 1, 'plan card never empty: ' + txt.replace(/\n/g, ' ').slice(0, 80));
  await ctx.close();
}

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
