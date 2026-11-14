// A posting sent into the inbox shows on the nurse board for its day and on Today; "Add as heard" there puts it on the board. Run: node test/inbox-board.mjs
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
const status = { app: 'claude', title: 'Claude', updatedAt: '2026-11-14T10:00:00Z', inbox: [{ id: 'team-x', type: 'posting', date: '2026-11-15', from: 'Tester', site: 'mine', postings: [{ nurse: 'Testa Quill' }, { nurse: 'Bea Moss' }] }] };
const state = { me: { name: 'Dr Me', id: '1' }, rotas: { gp, n: nurse }, apps: { claude: status } };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.clock.install({ time: new Date(2026, 10, 14, 19, 0) });
await p.addInitScript(([st, ss]) => { if (!localStorage.getItem('citrus.state.v1')) { localStorage.setItem('citrus.state.v1', JSON.stringify(st)); } }, [state, status]);
await p.goto(URL0); await sleep(1000);
const today = await p.locator('#view-today').innerText();
check(/From your apps/.test(today), 'Today shows the inbox card');
await p.click('nav.tabs button[data-view=rota]'); await sleep(300); await p.click('.work-seg button:has-text("Nurses")'); await sleep(300);
await p.click('.nb-quick .chip:has-text("Tomorrow")'); await sleep(300);
check(await p.locator('.card.nb-inbox').count() === 1, 'the nurse board for tomorrow shows the sent postings');
await p.click('.card.nb-inbox button:has-text("Add as heard")'); await sleep(400);
check(await p.locator('.card.nb-inbox').count() === 0, 'gone after adding');
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')));
check(Object.values(st.posts || {}).filter(x => x.tip && x.site === 'UPV').length === 2, 'two heard postings at Upper Village');
check(errs.length === 0, 'no page errors ' + errs.join(' | '));
await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'inbox-board ok'); process.exit(bad ? 1 : 0);
