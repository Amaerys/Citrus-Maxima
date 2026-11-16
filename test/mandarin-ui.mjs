// Mandarin live: Work becomes the Mandarin panel, Today drops the work cards it owns, its corrections win. Run: node test/mandarin-ui.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { parseRotaGrid, serializeRota } from '../docs/js/rota-parser.js';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); }; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// made-up nurse sheet: 3 day floaters in Nov 2026
const DAYS = 30, C0 = 9, g = [], row = (cells) => { const r = Array(C0 + DAYS).fill(null); cells.forEach((v, i) => { if (v !== undefined) r[i] = v; }); g.push(r); return r; };
row([]); row([null, '', 'TEST - Medical']); row([null, '', 'UNIT / DEPT', 'UNIT / DEPT', 'EMERGENCY/CLINIC']); row([null, '', 'Month&Year', 'Month&Year', 'November 2026']); row([]);
const hd = row([null, '#', 'I.D', 'NAME', 'Title', 'BLS/ACLS', 'Mobile #', 'ACCOM.', 'ASSIGNED CLINIC']); for (let d = 1; d <= DAYS; d++) hd[C0 + d - 1] = d;
row(Array(C0 + DAYS).fill('Construction Clinics (UPV-UPO-LPO-LPV)'));
for (const [i, nm] of ['Testa Quill', 'Bea Moss', 'Cora Yen'].entries()) { const r = row([null, `#${i + 1}`, 900 + i, nm, 'SN', 'BLS', '', 'X', 'QIC']); for (let d = 1; d <= DAYS; d++) r[C0 + d - 1] = 'D'; }
row([]); row([null, '', ' LEGEND', ' LEGEND', ' LEGEND']); row([null, '', 'D', '08:00-20:00', '12 Hrs']);
const nurse = serializeRota(parseRotaGrid(g, { sourceName: 'n.xlsx' }));
const gpLegend = { D1: { desc: 'Upper Village', hours: { start: 480, end: 1200, durationMin: 720, overnight: false } } };
const gp = { id: 'gp', unitKind: 'gp', unit: 'GP', year: 2026, month: 11, daysInMonth: 30, legend: gpLegend, legendList: [], people: [{ name: 'Dr Me', id: '1', days: [''].concat(Array(30).fill('D1')) }], importedAt: 1, sourceName: 'g.xlsx' };
const status0 = { app: 'claude', title: 'Claude', updatedAt: '2026-11-14T10:00:00Z', inbox: [{ id: 'team-x', type: 'posting', date: '2026-11-15', from: 'Tester', site: 'mine', postings: [{ nurse: 'Testa Quill' }, { nurse: 'Bea Moss' }] }] };
const mandarin = { app: 'mandarin', title: 'Mandarin', summary: 'today D1 Upper Village 08:00–20:00', updatedAt: '2026-11-14T10:00:00Z', actions: [{ id: 'nurses', label: 'Nurses', url: 'https://mandarin-work.github.io/Mandarin/#nurses' }],
  _shifts: { days: [{ date: '2026-11-15', kind: 'off', code: '', corrected: true }, { date: '2026-11-16', kind: 'work', code: 'D1', site: 'Upper Village', start: '08:00', end: '20:00' }] } };
const state = { me: { name: 'Dr Me', id: '1' }, rotas: { gp, n: nurse }, apps: { claude: status0, mandarin, clementine: { app: 'clementine', title: 'Clementine', summary: '2 friends free tonight', updatedAt: '2026-11-14T10:00:00Z', actions: [{ id: 'free', label: 'Free', url: 'https://clementine-social.github.io/Clementine/?do=free' }], extra: { birthdays: [{ name: 'Tess Example', label: 'birthday', birthday: true, inDays: 0, date: '2026-11-15' }], freeTonight: [{ name: 'Bo', from: '18:00', to: '23:00' }], upcoming: [] } }, calamansi: { app: 'calamansi', title: 'Calamansi', summary: '1 chore due', updatedAt: '2026-11-14T10:00:00Z', actions: [{ id: 'shop', label: 'Shop', url: 'https://calamansi-food.github.io/Calamansi/?do=shop' }], extra: { chores: [{ title: 'Laundry', late: 2, status: '2 days overdue' }], meals: { today: [{ label: 'Dinner', title: 'Air-fryer salmon' }], tomorrow: [] }, shopping: { open: 2, items: ['Eggs', 'Milk'] }, fridge: [], bills: [] } } } };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.clock.install({ time: new Date(2026, 10, 15, 9, 0) });
await p.addInitScript((st) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(st)); }, state);
await p.goto(URL0); await sleep(1000);
const today = await p.locator('#view-today').innerText();
{ const titles = (await p.locator("#view-today .card .title").allInnerTexts()).join(" / "); check(!/Nurses|Schedule update|Contract/.test(titles), "no Citrus work cards on Today: " + titles); }
check(!/From your apps[\s\S]*Tester sent/.test(today), 'posting items are left to Mandarin');
check(/off|Off|day off/i.test(today), 'Mandarin says I am off today (corrected) and Today follows: ' + today.slice(0, 160).replace(/\n/g, ' | '));
await p.click('nav.tabs button[data-view=rota]'); await sleep(400);
const work = await p.locator('#view-rota').innerText();
check(/Open Mandarin/.test(work) && /Your next days/.test(work) && /D1 · Upper Village · 08:00–20:00/.test(work), 'Work shows the Mandarin panel with next days');
check(await p.locator('.work-seg button:has-text("Nurses")').count() === 0, 'old Work sections gone');
await p.screenshot({ path: '/tmp/claude-0/-home-claude/a1f5476a-0219-5c7e-9801-fd990059411a/scratchpad/mandarin-panel.png' }); await p.click('.work-seg button:has-text("Home")'); await sleep(300); check(await p.locator('#view-rota').innerText().then(x => !/Open Mandarin/.test(x) && /Open Calamansi/.test(x) && /Laundry/.test(x) && /Air-fryer salmon/.test(x) && /Eggs, Milk/.test(x)), 'Home is the Calamansi panel');
await p.screenshot({ path: '/tmp/claude-0/-home-claude/a1f5476a-0219-5c7e-9801-fd990059411a/scratchpad/mandarin-work.png' });
await p.click('nav.tabs button[data-view=social]'); await sleep(400);
{ const soc = await p.locator('#view-social').innerText(); check(/Open Clementine/.test(soc) && /Free with you today/.test(soc) && /Tess Example/.test(soc), 'Social shows the Clementine panel'); }
await p.click('nav.tabs button[data-view=today]'); await sleep(400);
{ const td = await p.locator('#view-today').innerText(); check(/Tess Example's birthday/.test(td) || /Tess Example today/.test(td), 'Today shows the birthday from Clementine'); check(/Laundry/.test(td), 'Today shows the overdue chore from Calamansi'); }
check(errs.length === 0, 'no page errors ' + errs.join(' | '));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'mandarin-ui ok'); process.exit(bad ? 1 : 0);
