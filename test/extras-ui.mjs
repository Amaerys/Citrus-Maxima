// Social → Plans (poll, wishlist, treats), nurse birthday + contract-end nudges. Run: node test/extras-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'); fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0; const errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }), p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
const today = new Date(), iso = (n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
await p.addInitScript(([a, b, c]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' }, friends: { f1: { id: 'f1', name: 'Faisal Al Test', phone: '0501111111', kind: 'gp', at: 1 }, f2: { id: 'f2', name: 'Meshal Test', kind: 'gp', at: 1 }, f3: { id: 'f3', name: 'Mariam Test', kind: 'gp', at: 1 } }, treats: { t1: { id: 't1', date: a, what: 'Kunafa', for: 'The team', cost: 50, at: 1 }, t0: { id: 't0', date: b, what: 'Coffee', for: 'The team', cost: 30, at: 1 } }, contacts: {} })); }, [iso(-30), iso(-52), 0]);
await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=social]'); await sleep(250);
let t = await p.locator('#view-social').innerText(); check(/Treat for the team\?/.test(t), 'overview nudges you when the usual treat gap has passed'); check(!/null|undefined|NaN/.test(t), 'no stray words');
await p.click('#view-social .mind-seg button:has-text("Plans")'); await sleep(250); t = await p.locator('#view-social').innerText(); check(/Time polls/.test(t) && /Wishlist/.test(t) && /Team treats/.test(t), 'three cards'); check(/30 days since the last treat/.test(t) && await p.locator('#view-social .chip.late:has-text("due")').count() === 1, 'treat tracker says it is due');
// poll
await p.click('#view-social button:has-text("New poll")'); await sleep(250); await p.click('.sheet .chip:has-text("Faisal")'); await p.click('.sheet .chip:has-text("Meshal")'); await p.fill('.sheet input[type=date]', iso(3)); await p.click('.sheet button:has-text("Add")'); await sleep(150);
check(/20:00/.test(await p.locator('.sheet').innerText()) || /8:00/.test(await p.locator('.sheet').innerText()), 'option added'); await p.click('.sheet button:has-text("Create poll")'); await sleep(350);
check(await p.locator('#view-social .poll').count() === 1 && /0\/2 answered/.test(await p.locator('#view-social .poll').innerText()), 'poll created');
await p.click('#view-social .poll .chip:has-text("Faisal")'); await sleep(200); await p.click('#view-social .poll .chip:has-text("Meshal")'); await sleep(250); check(/everyone can/.test(await p.locator('#view-social .poll').innerText()), 'both said yes: everyone can');
await p.click('#view-social .poll button:has-text("Pick")'); await sleep(250); check(await p.locator('#view-social .poll-slot.chosen').count() === 1, 'a slot can be picked'); await p.click('#view-social .poll button:has-text("Reopen")'); await sleep(200);
await p.click('#view-social .poll button:has-text("Send on WhatsApp")'); await sleep(250); const sh = await p.locator('.sheet').innerText(); check(/Which of these work/.test(sh) && await p.locator('.sheet a[href*="wa.me"]').count() === 1 && /no number saved/.test(sh), 'send sheet: WhatsApp link only for friends with a number'); await p.keyboard.press('Escape'); await sleep(200);
// wishlist
await p.click('#view-social button:has-text("＋ Add")'); await sleep(250); await p.fill('.sheet input >> nth=0', 'Najd Village'); await p.click('.sheet button:has-text("Save")'); await sleep(300); check(/Najd Village/.test(await p.locator('#view-social').innerText()), 'wish added');
await p.click('#view-social button[aria-label="Done Najd Village"]'); await sleep(250); check(/Been there \(1\)/.test(await p.locator('#view-social').innerText()), 'ticking it moves it to "been there"');
// treats
await p.click('#view-social button:has-text("＋ Log")'); await sleep(250); await p.fill('.sheet input >> nth=0', 'Cake'); await p.click('.sheet button:has-text("Save")'); await sleep(300); t = await p.locator('#view-social').innerText(); check(/Cake/.test(t) && /Brought something today/.test(t) && !/\bdue\b/.test(t), 'logging a treat clears the reminder');
await p.screenshot({ path: path.join(here, 'shots/social-plans.png'), fullPage: true });
check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no overflow'); check(errors.length === 0, 'no page errors: ' + errors.join('|').slice(0, 200));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'extras ui ok'); process.exit(bad ? 1 : 0);
