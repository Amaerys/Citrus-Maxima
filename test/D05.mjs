// D05 beta fixes: one contract-end reminder per nurse, poll options (dedupe, sort, past, after midnight), "Plan it" keeps the picked slot, future/blank treats.
// Run: node test/D05.mjs   (clock pinned to Fri 13 Nov 2026 09:30 Riyadh; phone + wide, Clean + Paper)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D05'); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const hasNurses = fs.existsSync(data('nurses.xlsx'));
// made-up friends; one treat 30 days ago so the overview has something to nudge
const state = { me: { name: 'Dr. Reem Mahgoub', id: '437326' }, friends: { f1: { id: 'f1', name: 'Faisal Test', phone: '0501111111', kind: 'gp', at: 1 }, f2: { id: 'f2', name: 'Meshal Test', kind: 'gp', at: 1 } }, treats: { t1: { id: 't1', date: '2026-10-14', what: 'Kunafa', for: 'The team', cost: 50, at: 1 } }, contacts: {} };

for (const [vw, ui] of [['phone', 'clean'], ['phone', 'paper'], ['wide', 'clean'], ['wide', 'paper']]) {
  console.log(`${vw} · ${ui}`); const errors = [];
  const ctx = await browser.newContext({ ...(vw === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 1000 } }), deviceScaleFactor: 1, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' '))); await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
  await p.addInitScript(([s, u]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(s)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); }, [state, ui]);
  await p.goto(URL0); await sleep(600);
  const toastText = async () => (await p.locator('#toasts').innerText().catch(() => '')) || '';
  if (hasNurses) { await p.click('nav.tabs button[data-view=rota]'); await p.locator('#view-rota input[type=file]').first().setInputFiles([data('nurses.xlsx')]); await sleep(2000); }
  await p.click('nav.tabs button[data-view=social]'); await sleep(300);
  // T04-02 / T08-07: one contract-end row per nurse
  if (hasNurses) {
    const rows = await p.locator('#view-social .nudge:has(.ch-ic:has-text("📄"))').allInnerTexts();
    check(rows.length === 1, `one contract-end row (got ${rows.length})`); check(/Last shift \w{3} 23 Nov · contract ends Tue 24 Nov · in 11 days/.test(rows[0] || ''), 'row says "Last shift Mon 23 Nov · contract ends Tue 24 Nov · in 11 days"');
    await p.locator('#view-social .card:has-text("let it slip")').first().screenshot({ path: `${shots}/${vw}-${ui}-nudges.png` });
  }
  check(/Treat for the team\?/.test(await p.locator('#view-social').innerText()), 'treat nudge still shows when due');
  // T08-21: poll options
  await p.click('#view-social .mind-seg button:has-text("Plans")'); await sleep(250);
  await p.click('#view-social button:has-text("New poll")'); await sleep(250); await p.click('.sheet .chip:has-text("Faisal")'); await sleep(150);
  const slotRows = () => p.locator('.sheet .x-slot').count();
  const addOpt = async (d, a, b) => { await p.fill('.sheet .x-add input[type=date]', d); await p.fill('.sheet .x-add input[type=time] >> nth=0', a); await p.fill('.sheet .x-add input[type=time] >> nth=1', b); await p.click('.sheet .x-add button:has-text("Add")'); await sleep(150); };
  await addOpt('2026-11-14', '23:00', '01:00'); check(/next day at 01:00/.test(await p.locator('.sheet .x-hint').innerText()), 'hint: ends the next day');
  check(await slotRows() === 1 && /23:00–01:00/.test(await p.locator('.sheet .x-slots').innerText()) && await p.locator('.sheet .x-slot .x-next').count() === 1, 'after-midnight option accepted with a +1 badge');
  await addOpt('2026-11-14', '23:00', '01:00'); check(await slotRows() === 1 && /already/.test(await toastText()), 'same option twice is refused');
  await addOpt('2026-11-01', '20:00', '22:00'); check(await slotRows() === 1 && /passed/.test(await toastText()), 'past day is refused');
  await addOpt('2026-11-13', '20:00', '22:00'); const order = await p.locator('.sheet .x-slot').allInnerTexts(); check(order.length === 2 && /13 Nov/.test(order[0]) && /14 Nov/.test(order[1]), 'options sorted by day');
  const sugg = p.locator('.sheet .chips').nth(1).locator('.chip');
  if (await sugg.count()) { const n0 = await slotRows(); await sugg.first().click(); await sleep(120); await sugg.first().click(); await sleep(120); check(await slotRows() === n0, 'tapping a suggestion twice toggles it, no duplicate'); }
  if (vw === 'phone') await p.locator('.sheet').screenshot({ path: `${shots}/${vw}-${ui}-poll-sheet.png` });
  await p.click('.sheet button:has-text("Create poll")'); await sleep(300);
  // T08-06: Plan it uses the picked slot
  await p.locator('#view-social .poll-slot').nth(1).locator('button:has-text("Pick")').click(); await sleep(250);
  await p.click('#view-social .poll button:has-text("Plan it")'); await sleep(300); const inv = await p.locator('.sheet').last().innerText();
  check(/Sat 14 Nov · 23:00–/.test(inv) && !/Fri 13 Nov · /.test(inv), 'invite opens on the picked slot (Sat 14 23:00)'); check(/Dinner/.test(await p.locator('.sheet textarea').last().inputValue()), 'invite message keeps the poll title');
  await p.keyboard.press('Escape'); await sleep(250); await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));
  // T08-20: treats
  await p.click('#view-social button:has-text("＋ Log")'); await sleep(250); await p.click('.sheet button:has-text("Save")'); await sleep(150); check(await p.locator('.sheet').count() >= 1 && /What did you bring/.test(await toastText()), 'blank treat refused');
  await p.fill('.sheet input >> nth=0', 'Cake'); await p.fill('.sheet input[type=date]', '2026-12-25'); await p.click('.sheet button:has-text("Save")'); await sleep(300);
  const tc = await p.locator('#view-social .card:has-text("Team treats")').innerText(); check(/30 days since the last treat/.test(tc) && !/-\d+ day/.test(tc), 'future treat does not change "since" (still 30 days)');
  check(/next: Cake in 42 days/.test(tc) && await p.locator('#view-social .chip.x-plan').count() === 1, 'future treat shown as planned'); check(await p.locator('#view-social .chip.late:has-text("due")').count() === 0, 'a planned treat silences the "due" nudge');
  check(!/\b(null|undefined|NaN)\b/.test(await p.locator('#view-social').innerText()), 'no stray words');
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no horizontal overflow');
  await p.screenshot({ path: `${shots}/${vw}-${ui}-plans.png`, fullPage: vw === 'phone' });
  const mine = errors.filter(e => /extras/.test(e)); for (const e of errors.filter(e => !mine.includes(e))) console.log('  ! page error outside D05 files:', e.slice(0, 160)); check(mine.length === 0, 'no page errors in extras*.js ' + mine.join('|').slice(0, 200)); await ctx.close();
}
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D05 ok'); process.exit(bad ? 1 : 0);
