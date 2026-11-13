// D07 — Home chores: urgency order, honest calendar toasts, one calendar copy per chore, rota gaps, long-shift evenings, validation.
// Run: node test/D07.mjs   (made-up people and rota only)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
globalThis.location ??= { href: 'https://x/' }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D07'); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };

// ---------- unit: chores.js ----------
const C = await import('../docs/js/chores.js');
const legend = { D: { hours: { start: 480, end: 1200, durationMin: 720, overnight: false }, desc: 'Day' }, S: { hours: { start: 480, end: 1020, durationMin: 540, overnight: false }, desc: 'Short day' }, N: { hours: { start: 1200, end: 480, durationMin: 720, overnight: true }, desc: 'Night' } };
const days = ['']; for (let d = 1; d <= 30; d++) days[d] = d % 7 === 0 ? '' : d % 7 === 3 ? 'N' : d % 7 === 4 ? '' : d % 2 ? 'D' : 'S';
const rota = { id: 'gp', unitKind: 'gp', unit: 'GP', year: 2026, month: 11, daysInMonth: 30, legend, legendList: [], people: [{ name: 'Dr Test Person', id: '9', days }, { name: 'Dr Other Made', id: '8', days }] };
const base = { me: { name: 'Dr Test Person', id: '9' }, rotas: { gp: rota }, chores: {}, deleted: {}, settings: {} };
console.log('chores.js');
{
  const now = new Date(2026, 10, 13, 9, 30);
  let s = C.addChore(base, { id: 'a', title: 'Change bed sheets', every: 14, mins: 20, lastDone: '2026-11-10' }, now);
  s = C.addChore(s, { id: 'b', title: 'Laundry', every: 4, mins: 120, lastDone: '2026-11-05' }, now);
  s = C.addChore(s, { id: 'c', title: 'Groceries', every: 7, mins: 60, lastDone: '2026-11-12', next: { date: '2026-11-14', start: 600 } }, now);
  s = C.addChore(s, { id: 'd', title: 'Bathroom', every: 7, mins: 45, lastDone: '2026-11-03' }, now);
  check(C.choreList(s, now).map(c => c.id).join() === 'b,d,c,a', 'urgency order: most overdue, overdue, planned, then due date: ' + C.choreList(s, now).map(c => c.title).join(', '));
  const fut = C.addChore(base, { id: 'f', title: 'X', lastDone: '2027-05-01' }, now).chores.f; check(fut.lastDone === '2026-11-13', 'future last-done clamps to today');
  check(C.validate({ title: 'X', every: 0, mins: 60, lastDone: '2027-01-01' }, null, now).every && C.validate({ title: 'X', every: 7, mins: 60, lastDone: '2027-01-01' }, null, now).lastDone, 'repeat 0 and a future date are reported, not silently changed');
  check(C.validate({ title: 'laundry', every: 4, mins: 60 }, s, now).dup && !C.validate({ id: 'b', title: 'laundry', every: 4, mins: 60 }, s, now).dup, 'duplicate title (any case) flagged, but not against itself');
  const zwj = C.addChore(base, { id: 'z', title: 'Cook', icon: '🧑‍🍳 extra' }, now).chores.z.icon; check(zwj === '🧑‍🍳', 'ZWJ emoji icon kept whole: ' + zwj);
  const n = C.addChore(base, { id: 'n', title: 'N', next: { date: '2026-11-14', start: 600, eventId: 'ev1', calendarId: 'primary', key: 'k1' } }, now).chores.n.next; check(n.eventId === 'ev1' && n.key === 'k1' && n.calendarId === 'primary', 'planned slot keeps its calendar ids');
  check(C.lastDoneFrom('today', { every: 4 }, now) === '2026-11-13' && C.lastDoneFrom('week', { every: 4 }, now) === '2026-11-06' && C.lastDoneFrom('few', { every: 4 }, now) === '2026-11-11', '"last done?" answers become dates');
  // fresh chores don't flood Today; older never-done ones still show
  const fresh = C.addChore(base, { id: 'p', title: 'Room cleaning', every: 7, mins: 60, at: +now - 1000 }, now); check(C.dueSoon(fresh, now).length === 0, 'just-added chore waits on Home, not Today');
  check(C.dueSoon(fresh, new Date(+now + 2 * 864e5)).length === 1, '…and shows on Today after a day');
  // long-shift evenings: D is 08–20 (12h); a 2h laundry must not land at 20:45 that day
  const lau = s.chores.b, sl = C.suggestSlots(s, lau, { now, horizon: 10, count: 10 });
  const longDays = sl.filter(x => days[x.date.getDate()] === 'D' && x.date.getMonth() === 10);
  check(!longDays.length, 'no 2h chore after a 12h day: ' + sl.map(x => `${x.key} ${x.start}`).join(' '));
  const short = C.suggestSlots(s, { ...lau, mins: 20 }, { now, horizon: 10, count: 10 }).filter(x => x.after); check(short.length >= 1 && short.every(x => /^[DS]$/.test(x.after)), 'short chores may go after work, labelled with the shift: ' + short.map(x => x.after).join());
  const s9 = C.suggestSlots(s, { ...lau, mins: 60 }, { now, horizon: 10, count: 10 }).find(x => days[x.date.getDate()] === 'S' && x.after); check(!s9 || s9.after === 'S', '9h day: evening slot says "after S"');
  // December has no rota: slots are still offered, flagged unknown, and the gap is reported
  const late = new Date(2026, 10, 28, 9, 30), s2 = C.addChore(base, { id: 'g', title: 'Laundry', every: 4, mins: 120, lastDone: '2026-11-28' }, late);
  const dec = C.suggestSlots(s2, s2.chores.g, { now: late, count: 4 }); check(dec.some(x => x.unknown && x.date.getMonth() === 11), 'December days offered as "rota unknown": ' + dec.map(x => x.key + (x.unknown ? '?' : '')).join(' '));
  check(C.rotaGaps(s2, { now: late }).some(d => d.getMonth() === 11) && !C.rotaGaps(s2, { now: late }).some(d => d.getMonth() === 10), 'rota gaps = December days only');
}

// ---------- browser ----------
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); const errors = [];
async function open(w, hgt, ui = 'clean', at = '2026-11-13T09:30:00+03:00') {
  const cx = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await cx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.clock.install({ time: new Date(at) });
  await p.addInitScript(({ st, ui }) => {
    if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ ...st, rotas: { gp: { ...st.rotas.gp, importedAt: Date.now() } } }));
    localStorage.setItem('citrus.ui', JSON.stringify({ ui, size: 'normal' }));
    window.__toasts = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true });
  }, { st: base, ui });
  await p.goto(URL0); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await sleep(250); await p.click('.work-seg button:has-text("Home")'); await sleep(250); return p;
}
const outbox = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).outbox || []);
const toasts = (p) => p.evaluate(() => { const t = window.__toasts; window.__toasts = []; return t; });
const chore = (p, name) => p.locator(`#view-rota .card.chore:has(.name:text-is("${name}"))`);

console.log('Home on the phone (not signed in)');
let p = await open(390, 844);
await p.click('.chip:has-text("Laundry")'); await sleep(200); await p.click('.chip:has-text("Change bed sheets")'); await sleep(200);
check(await p.locator('#view-rota .card.chore').count() === 2, 'two chores added');
check(await chore(p, 'Laundry').locator('.ch-ask button').count() === 3, 'new chore asks "last done?"');
await chore(p, 'Change bed sheets').locator('.ch-ask button:has-text("Today")').click(); await sleep(200);
check(/Due /.test(await chore(p, 'Change bed sheets').innerText()) && !(await chore(p, 'Change bed sheets').locator('.ch-ask').count()), 'answered: due in 14 days, question gone');
check((await p.locator('#view-rota .card.chore .name').first().innerText()) === 'Laundry', 'due-now chore sorts above the later one');
await chore(p, 'Laundry').locator('button:has-text("Find a time")').click(); await sleep(300);
const names = await p.locator('.sheet .ch-slots .item .name').allInnerTexts(); check(names.length >= 1, 'slots offered: ' + names.join(' | '));
check(names.every(n => !/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/.test(n) && !/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Today|Tomorrow)/.test(n)), 'no doubled weekday ("Sun Sun 15/11", "Fri Today")');
check(await p.evaluate(() => getComputedStyle(document.querySelector('.sheet .ch-slots .item')).textAlign) === 'left', 'slot rows left-aligned');
check(!names.some(n => /20:45/.test(n)), 'no 2h laundry right after a 12h day');
await p.screenshot({ path: `${shots}/phone-slots.png` });
await toasts(p); await p.locator('.sheet .ch-slots .item').first().click(); await sleep(400);
let ts = await toasts(p); check(ts.length === 1 && /sign in/.test(ts[0]) && !/added to your calendar/.test(ts[0]), 'one honest toast: ' + ts.join(' / '));
let ob = await outbox(p); check(ob.length === 1 && ob[0].type === 'create', 'one create queued');
const firstStart = ob[0].payload.start;
check(/Planned/.test(await chore(p, 'Laundry').innerText()), 'card shows the plan');
await chore(p, 'Laundry').locator('button:has-text("Re-plan")').click(); await sleep(300);
const n2 = await p.locator('.sheet .ch-slots .item').count(); await p.locator('.sheet .ch-slots .item').nth(n2 - 1).click(); await sleep(400);
ob = await outbox(p); check(ob.length === 1 && ob[0].payload.start !== firstStart, 're-plan moves the queued event instead of adding a second');
ts = await toasts(p); check(ts.length === 1 && /removed|dropped/.test(ts[0]), 're-plan toast says the old time is gone: ' + ts.join(' / '));
await chore(p, 'Laundry').locator('button:has-text("Done")').click(); await sleep(400);
ob = await outbox(p); check(ob.length === 0, 'done early removes the future planned event');
check(await p.locator('.toast.ch-toast button:has-text("Undo")').count() === 1 && await p.locator('.toast.ch-toast button:has-text("yesterday")').count() === 1, 'done toast has Undo and "It was yesterday"');
await p.screenshot({ path: `${shots}/phone-done-toast.png` });
await p.locator('.toast.ch-toast button:has-text("yesterday")').click(); await sleep(300);
check(/last Yesterday/.test(await chore(p, 'Laundry').innerText()), 'logged as done yesterday');
// validation
await p.click('.chip:has-text("Your own")'); await sleep(250);
await p.fill('.sheet input[placeholder^="e.g."]', 'laundry'); await p.click('.sheet button:has-text("Save")'); await sleep(200);
check(/already have/i.test(await p.locator('.sheet .ch-err').innerText()), 'duplicate title warned');
await p.fill('.sheet input[placeholder^="e.g."]', 'Supercalifragilisticexpialidociousandthensomemorex'); await p.fill('.sheet input[type=number] >> nth=0', '0'); await p.click('.sheet button:has-text("Save")'); await sleep(200);
check(/1–365/.test(await p.locator('.sheet .ch-err').innerText()), 'repeat 0 shows a hint');
await p.fill('.sheet input[type=number] >> nth=0', '10'); await p.fill('.sheet input[aria-label=Icon]', '🧑‍🍳'); await p.click('.sheet button:has-text("Save")'); await sleep(300);
check(await p.locator('.sheet').count() === 0, 'saved after fixing');
check(await chore(p, 'Supercalifragilisticexpialidociousandthensomemorex').locator('.ch-ic').innerText() === '🧑‍🍳', 'ZWJ icon intact on the card');
await p.setViewportSize({ width: 320, height: 700 }); await sleep(300);
check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, '320px: long title wraps, no sideways scroll');
await p.screenshot({ path: `${shots}/phone-320.png`, fullPage: true });
await p.setViewportSize({ width: 390, height: 844 }); await sleep(200); await p.screenshot({ path: `${shots}/phone-home-clean.png`, fullPage: true });
await p.click('nav.tabs button[data-view=today]'); await sleep(400); check(!/\b(undefined|NaN|null)\b/.test(await p.locator('#view-today').innerText()), 'Today renders cleanly');
await p.context().close();

console.log('Paper + wide, Today card');
p = await open(1600, 1000, 'paper');
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('citrus.state.v1')); s.chores = { x1: { id: 'x1', title: 'Laundry', icon: '🧺', every: 4, mins: 120, lastDone: '2026-11-06', next: null, at: 1 }, x2: { id: 'x2', title: 'Room cleaning', icon: '🧹', every: 7, mins: 60, lastDone: '2026-11-10', next: null, at: 1 }, x3: { id: 'x3', title: 'Groceries', icon: '🛒', every: 7, mins: 60, lastDone: '2026-11-07', next: { date: '2026-11-14', start: 600 }, at: 1 } }; localStorage.setItem('citrus.state.v1', JSON.stringify(s)); });
await p.reload(); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await sleep(250); await p.click('.work-seg button:has-text("Home")'); await sleep(250);
check(/3 days overdue/.test(await p.locator('#view-rota .card.chore').first().innerText()), 'overdue first on Home');
check(/1 overdue · 1 planned/.test(await p.locator('#view-rota .ch-sum').innerText()), 'summary line');
await p.screenshot({ path: `${shots}/wide-home-paper.png` });
await p.click('nav.tabs button[data-view=today]'); await sleep(400);
const tc = p.locator('.chores-today'); check(await tc.count() === 1 && /1 overdue/.test(await tc.innerText()), 'Today card with an overdue badge');
await tc.locator('button[aria-label="Laundry done"]').click(); await sleep(300);
check(await p.locator('.toast.ch-toast button:has-text("Undo")').count() === 1, 'Today ✓ offers Undo');
await p.locator('.toast.ch-toast button:has-text("Undo")').click(); await sleep(300);
check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).chores.x1.lastDone) === '2026-11-06', 'Undo restores last done');
await p.screenshot({ path: `${shots}/wide-today-paper.png` });
await p.setViewportSize({ width: 390, height: 844 }); await p.click('nav.tabs button[data-view=rota]'); await sleep(250); await p.click('.work-seg button:has-text("Home")'); await sleep(250); check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'Paper phone: no sideways scroll'); await p.screenshot({ path: `${shots}/phone-home-paper.png` });
await p.context().close();

console.log('December gap, Clean wide');
p = await open(1600, 1000, 'clean', '2026-11-28T09:30:00+03:00');
await p.click('.chip:has-text("Laundry")'); await sleep(200); await chore(p, 'Laundry').locator('button:has-text("Find a time")').click(); await sleep(300);
check(/No rota for December/.test(await p.locator('.sheet').innerText()), 'sheet says December has no rota');
check(await p.locator('.sheet .ch-slots .item.unknown').count() >= 1, 'December days offered, marked rota unknown');
await p.screenshot({ path: `${shots}/wide-december-clean.png` });
await p.context().close();

check(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(bad ? `${bad} failed` : 'all passed'); process.exit(bad ? 1 : 0);
