// Re-uploading a schedule shows what changed. Run: node test/changes-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f); fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: skipped'); process.exit(0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)); let bad = 0; const errors = [];
const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
await p.clock.install({ time: new Date('2026-11-09T08:00:00+03:00') });
await p.addInitScript(() => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' }, friends: { f1: { id: 'f1', name: 'Faisal', rotaKey: '', at: 1 } } })); });
await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=rota]');
const upload = async () => { await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2200); };
await upload(); check(await p.locator('.sheet .rc').count() === 0, 'first upload: no brief (nothing to compare with)');
// pretend the stored version was older: change my 20th and 25th, and a colleague's 15th
const info = await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('citrus.state.v1')), r = Object.values(st.rotas).find(x => x.unitKind === 'gp'), me = r.people.find(x => x.id === '437326'), other = r.people.find(x => x.id !== '437326');
  const was = { d20: me.days[20], d25: me.days[25], o: other.days[15] }; me.days[20] = me.days[20] ? '' : 'D'; me.days[25] = me.days[25] ? '' : 'D'; other.days[15] = other.days[15] === 'D' ? 'N' : 'D'; localStorage.setItem('citrus.state.v1', JSON.stringify(st)); return { ...was, other: other.name }; });
await p.reload(); await sleep(700); await p.click('nav.tabs button[data-view=rota]'); await upload();
check(await p.locator('.sheet .rc').count() === 1, 'second upload opens "What changed"'); const t = await p.locator('.sheet').innerText();
check(/2 of your shifts changed/.test(t), 'headline counts my changed shifts'); check(await p.locator('.sheet .rc-sec:has-text("Your shifts") .rc-row').count() === 2, 'both of my days listed with old → new');
check(/Fri 20|Wed 25/.test(t) && /→/.test(t), 'dates and arrows'); check(/Everyone else|Friends/.test(t), 'others listed'); check(!/\b(null|undefined|NaN)\b/.test(t), 'no stray words');
await p.screenshot({ path: path.join(here, 'shots/what-changed.png'), fullPage: true }); await p.keyboard.press('Escape'); await sleep(250);
check(await p.locator('#view-rota .rc-card').count() === 1 && /Last schedule update/.test(await p.locator('#view-rota .rc-card').innerText()), 'Work keeps the last update (already seen)');
await p.click('#view-rota .rc-card button:has-text("History")'); await sleep(250); check(await p.locator('.sheet .rc').count() === 1, 'history opens'); await p.keyboard.press('Escape'); await sleep(200);
await upload(); check(await p.locator('.sheet .rc').count() === 0, 'same file again: no brief'); check(/nothing changed/i.test(await p.locator('body').innerText()), 'says nothing changed');
// unseen update shows on Today
await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('citrus.state.v1')); for (const v of Object.values(st.rotaChanges)) v.seen = false; localStorage.setItem('citrus.state.v1', JSON.stringify(st)); }); await p.reload(); await sleep(700); await p.click('nav.tabs button[data-view=today]'); await sleep(300);
check(await p.locator('#view-today .rc-card.new').count() === 1 && /2 of your shifts changed/.test(await p.locator('#view-today .rc-card').innerText()), 'Today shows an unseen update');
await p.click('#view-today .rc-card button:has-text("See changes")'); await sleep(300); await p.keyboard.press('Escape'); await sleep(250); check(await p.locator('#view-today .rc-card').count() === 0, 'gone from Today once seen');
check(errors.length === 0, 'no page errors: ' + errors.join('|').slice(0, 200)); await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'changes ui ok'); process.exit(bad ? 1 : 0);
