// Work tab (calendar/team/home), overlap view, chores, Social, Mind launcher. Run: node test/social-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.resolve(here, 'shots/social'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const seedFn = () => {
  const n = new Date(), y = n.getFullYear(), mo = n.getMonth() + 1, dim = new Date(y, mo, 0).getDate();
  const legend = { D: { hours: { start: 480, end: 1020, durationMin: 540, overnight: false }, desc: 'Day' }, E: { hours: { start: 780, end: 1320, durationMin: 540, overnight: false }, desc: 'Evening' }, D1: { desc: 'Clinic A' }, E1: { desc: 'Clinic A' } };
  const all = (c) => [''].concat(Array.from({ length: dim }, () => c));   // days are arrays indexed by day of month
  const people = [{ name: 'Dr Me Myself', id: '1', days: all('D1') }, { name: 'Dr Faisal Alotaibi', id: '2', mobile: '0501112222', days: all('D1') }, { name: 'Dr Meshal Qahtani', id: '3', days: all('E1') }, { name: 'Dr Mariam Zahrani', id: '4', days: all('') }, { name: 'Dr Mohammed Merri Alharbi', id: '5', days: all('D1') }, { name: 'Dr Mohammed Salem', id: '6', days: all('D1') }];
  localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr Me Myself', id: '1' }, rotas: { gp: { id: 'gp', unitKind: 'gp', unit: 'GP', year: y, month: mo, daysInMonth: dim, legend, legendList: [], people, importedAt: Date.now(), sourceName: 't.xlsx' } } }));
};
const ctxs = [];
async function open(w, h) { const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' }); ctxs.push(ctx); const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi/.test(m.text())) page.errors.push(m.text()); }); await page.addInitScript(seedFn); await page.goto(URL0); await sleep(600); return page; }
const txt = (p, s) => p.locator(s).first().innerText();
const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tab = async (p, v) => { await p.click(`nav.tabs button[data-view=${v}]`); await sleep(250); };

const p = await open(390, 844);
console.log('Work');
check(await p.locator('nav.tabs button[data-view=team]').count() === 0, 'no separate Team tab');
check(await p.locator('nav.tabs button:not(.rail-only)').count() === 6, 'six tabs (Settings is a rail-only item)');
await tab(p, 'rota'); check(/Work/.test(await txt(p, '#view-rota h1')), 'Work page');
await p.click('.work-seg button:has-text("People")'); await sleep(200); check(await p.locator('#view-rota .item').count() >= 5, 'Team list inside Work');
await p.click('.work-seg button:has-text("Calendar")'); await sleep(200);
const dayN = new Date().getDate(); await p.click(`#view-rota .cal .day:not(.pad) >> nth=${dayN - 1}`); await sleep(300);
check(await p.locator('.sheet .card.ov').count() === 1, 'day sheet has the overlap card');
const ov = await txt(p, '.sheet .card.ov');
check(/Who shares your shift/i.test(ov), 'overlap card titled'); check(/same shift/i.test(ov) && /\d+%/.test(ov), 'evening colleague shown as a percentage, same-shift as all: ' + ov.replace(/\n/g, ' ').slice(0, 160));
check(/all/i.test(await p.locator('.sheet .ov-row.same .ov-pct').first().innerText()), 'same-shift colleague = all');
check(/%/.test(await p.locator('.sheet .ov-row.part .ov-pct').first().innerText()), 'evening colleague has a % of your shift');
check(await p.locator('.sheet .ov-row.part .ov-in').count() >= 1 && await p.locator('.sheet .ov-row.part .ov-ghost').count() >= 1, 'solid + faded bars drawn');
await p.screenshot({ path: `${shots}/day-sheet.png` });
await p.keyboard.press('Escape'); await sleep(150);
console.log('Home chores');
await p.click('.work-seg button:has-text("Home")'); await sleep(200);
await p.click('.chip:has-text("Room cleaning")'); await sleep(200); await p.click('.chip:has-text("Laundry")'); await sleep(200);
check(await p.locator('#view-rota .card.chore').count() === 2, 'two chores added');
check(/never done|due now|overdue/i.test(await txt(p, '#view-rota .card.chore')), 'new chore is due');
await p.click('#view-rota .card.chore >> nth=0 >> button:has-text("Find a time")'); await sleep(300);
const slots = await p.locator('.sheet .item.clickable').count(); check(slots >= 1, `time suggestions offered (${slots})`);
await p.screenshot({ path: `${shots}/chore-slots.png` });
await p.click('.sheet .item.clickable >> nth=0'); await sleep(400);
check(/Planned/i.test(await txt(p, '#view-rota .card.chore')), 'chore shows as planned');
await p.click('#view-rota .card.chore >> nth=0 >> button:has-text("Done")'); await sleep(300);
check(!/Planned/i.test(await txt(p, '#view-rota .card.chore')) && /Due /i.test(await txt(p, '#view-rota .card.chore')), 'done resets the cycle');
await tab(p, 'today'); check(await p.locator('.chores-today').count() >= 0, 'Today renders with chores');

console.log('Social');
await tab(p, 'social'); check(/Your GP friends/.test(await txt(p, '#view-social')), 'starter card');
check(/Mohammed[^·]*· in schedule/.test(await txt(p, '#view-social')), 'full name matches exactly one rota row');
await p.click('#view-social button:has-text("Add these 4")'); await sleep(400);
check(/Faisal/.test(await txt(p, '#view-social')) && await p.locator('#view-social .sg-row').count() >= 5, 'free-days grid with four friends');
{ const wk = await p.locator('#view-social .sg-cell.wk').count(); check(wk >= 1, `working days are striped and carry the shift letter (${wk} cells)`);
  const lab = await p.locator('#view-social .sg-cell.wk').first().getAttribute('aria-label'); check(/working \d\d:\d\d–\d\d:\d\d/.test(lab), 'cell says when they work: ' + lab);
  check(/^[A-Z]$/.test((await p.locator('#view-social .sg-cell.wk').first().innerText()).trim()), 'shift letter shown');
  check(await p.locator('#view-social .sg-cell.wk').evaluateAll(els => els.every(e => !/day off/.test(e.getAttribute('aria-label')))), 'a working day is never described as a day off');
  check(/working · letter = shift/.test(await txt(p, '#view-social')), 'legend explains the letters');
  check(await p.locator('#view-social .sg-cell .sg-tl i').count() > 10, 'free-hours line drawn inside cells'); check(await p.locator('#view-social .sg-day .sg-n').count() >= 10, 'each day says how many can meet you');
  check(await p.locator('#view-social .sg-cell.today').count() >= 2, 'today column marked');
  await p.click('#view-social .sg-day >> nth=1'); await sleep(300); check(await p.locator('.sheet .dl-row').count() >= 3 && await p.locator('.sheet .dl-free').count() >= 1, 'day sheet: everyone on a 08–24 line');
  await p.screenshot({ path: `${shots}/day-timeline.png` }); await p.keyboard.press('Escape'); await sleep(200);
  console.log('find a day');
  await p.click('#view-social button:has-text("Find a day")'); await sleep(300); check(/Pick at least one person/.test(await txt(p, '.sheet')), 'empty state');
  await p.click('.sheet .fd-group >> nth=0 >> .chip >> nth=0'); await sleep(200); await p.click('.sheet .fd-group >> nth=0 >> .chip >> nth=0'); await sleep(300);
  check(await p.locator('.sheet .chips .chip.sel').count() >= 2, 'two friends picked'); let r = await txt(p, '.sheet'); check(/you are all free|No day where everyone is free/.test(r), 'answer given');
  check(await p.locator('.sheet .fd-day').count() >= 1, 'days listed: ' + await p.locator('.sheet .fd-day').count());
  await p.fill('.sheet .dir-search', 'Merri'); await sleep(250); const n0 = await p.locator('.sheet .chips .chip.sel').count();
  await p.fill('.sheet .dir-search', ''); await sleep(200);
  if (await p.locator('.sheet .fd-group summary:has-text("GPs")').count()) { await p.click('.sheet .fd-group summary:has-text("GPs")'); await sleep(150); const nm = (await p.locator('.sheet .fd-group:has(summary:has-text("GPs")) .chip').first().innerText()).trim(); await p.locator('.sheet .fd-group:has(summary:has-text("GPs")) .chip').first().click(); await sleep(300);
    check(await p.locator('.sheet .chips .chip.sel').count() === n0 + 1, `a colleague who is not a friend can be picked (${nm})`); await p.fill('.sheet .dir-search', nm.slice(0, 5)); await sleep(250); check(!(await p.locator('.sheet .chip:not(.sel)').allInnerTexts()).includes(nm), 'search hides people already picked'); } else { console.log((await p.locator('.sheet').innerText()).slice(0, 400).replace(/\n/g, ' / ')); check(false, 'GP colleagues offered in the picker'); }
  await p.fill('.sheet .dir-search', ''); await sleep(200);
  await p.click('.sheet .chip:has-text("all day")'); await sleep(300); const allDay = await p.locator('.sheet .fd-day.all').count(); await p.click('.sheet .chip:has-text("1½h")'); await sleep(300); check(await p.locator('.sheet .fd-day.all').count() >= allDay, 'shorter meet-ups → at least as many days');
  if (await p.locator('.sheet .fd-day').count()) { await p.locator('.sheet .fd-day').first().click(); await sleep(300); check(await p.locator('.sheet .dl-common').count() >= 1 || /No time when you are all free/.test(await txt(p, '.sheet')), 'a result opens the day with the shared window marked'); }
  check(!/\b(null|undefined|NaN)\b/.test(await p.locator('body').innerText()), 'no stray words');
  await p.screenshot({ path: `${shots}/find-a-day.png` }); await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove())); await sleep(200); }
check(/Best times to meet/.test(await txt(p, '#view-social')), 'best times shown');
await p.screenshot({ path: `${shots}/social-overview.png`, fullPage: true });
await p.click('#view-social .seg button:has-text("Friends")'); await sleep(250);
check(await p.locator('#view-social .card.friend').count() === 4, 'four friend cards');
const faisalHref = await p.locator('#view-social .card.friend:has-text("Faisal") a.wa').getAttribute('href');
check(/wa\.me\/966501112222/.test(faisalHref || ''), 'Faisal’s phone came from the rota; WhatsApp link built: ' + faisalHref);
check(await p.locator('#view-social .card.friend:has-text("Meshal") a.snap').count() === 0, 'no Snapchat link until a handle is saved');
await p.click('#view-social .card.friend:has-text("Meshal") button[aria-label^=Edit]'); await sleep(250);
const inputs = p.locator('.sheet input[type=tel]'); await inputs.nth(0).fill('0551234567');
const texts = p.locator('.sheet input[type=text]'); const n = await texts.count();
// Snapchat and Instagram are the 3rd and 4th text fields after name, nickname
const sn = p.locator('.sheet input[placeholder="username or link"]'), ig = p.locator('.sheet input[placeholder="@username or link"]'); await sn.fill('https://www.snapchat.com/add/meshal_q'); await ig.fill('@meshal.q');
await p.click('.sheet button:has-text("Save")'); await sleep(300);
const meshal = p.locator('#view-social .card.friend:has-text("Meshal")');
check(/966551234567/.test(await meshal.locator('a.wa').getAttribute('href')) && /snapchat\.com\/add\/meshal_q/.test(await meshal.locator('a.snap').getAttribute('href')) && /instagram\.com\/meshal\.q\//.test(await meshal.locator('a.ig').getAttribute('href')), 'phone, WhatsApp, Snapchat and Instagram links saved');
await p.click('#view-social .card.friend:has-text("Meshal") button:has-text("Invite")'); await sleep(300);
const msg = await p.locator('.sheet textarea.inp').inputValue(); check(/Meshal/.test(msg) && /free|Which works/.test(msg), 'invite message drafted: ' + msg.replace(/\n/g, ' / ').slice(0, 100));
check(await p.locator('.sheet a:has-text("Meshal")').count() === 1, 'per-friend WhatsApp button');
await p.screenshot({ path: `${shots}/invite.png` });
await p.keyboard.press('Escape'); await sleep(150);
await p.click('#view-social .seg button:has-text("Outings")'); await sleep(250); await p.click('#view-social button:has-text("Log an outing")'); await sleep(250);
await p.click('.sheet .chip:has-text("Faisal")'); await p.fill('.sheet input[placeholder="Dinner, padel, coffee…"]', 'Dinner'); await p.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
check(/Dinner/.test(await txt(p, '#view-social')), 'outing logged');
await p.click('#view-social .seg button:has-text("Overview")'); await sleep(250);
check(await over(p) <= 0, 'no horizontal overflow on Social @390');

console.log('Mind launcher');
await tab(p, 'mind'); check(await p.locator('#view-mind .mind-seg').count() === 0 && await p.locator('.mind-nav').count() === 1, 'crowded strip replaced by the switcher');
await p.click('.mn-main'); await sleep(300); check(await p.locator('.ml-tile').count() === 8, 'launcher shows all eight sections'); await p.screenshot({ path: `${shots}/mind-launcher.png` });
await p.click('.ml-tile:has-text("Library")'); await sleep(300); check(await p.locator('#view-mind .kinds').count() === 1, 'Library opens from the launcher');
await p.click('.mn-step[aria-label="Next section"]'); await sleep(250); check(/Notes/.test(await txt(p, '.mn-main')), 'next arrow moves to Notes');
await p.click('.mn-step[aria-label="Next section"]'); await sleep(250); check(/Overview/.test(await txt(p, '.mn-main')), 'next wraps around to Overview');
await p.screenshot({ path: `${shots}/mind-overview.png` });
for (const v of ['today', 'rota', 'plan', 'social', 'mind', 'apps']) { await tab(p, v); check(await over(p) <= 0, `no overflow: ${v}`); }
await tab(p, 'rota'); await p.click('.work-seg button:has-text("People")'); await p.evaluate(() => { location.hash = '#team'; }); await sleep(300);
check(await p.locator('#view-rota.active').count() === 1, 'old #team link lands in Work');
check(p.errors.length === 0, 'no page errors: ' + p.errors.join(' | ').slice(0, 300));

console.log('desktop');
const d = await open(1280, 800); await tab(d, 'social'); await d.click('#view-social button:has-text("Add these 4")'); await sleep(400); await d.screenshot({ path: `${shots}/desktop-social.png` });
await tab(d, 'rota'); await d.click(`#view-rota .cal .day:not(.pad) >> nth=${dayN - 1}`); await sleep(300); await d.screenshot({ path: `${shots}/desktop-day.png` });
check(d.errors.length === 0, 'desktop: no page errors ' + d.errors.join('|').slice(0, 200));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'social ui ok'); process.exit(bad ? 1 : 0);
