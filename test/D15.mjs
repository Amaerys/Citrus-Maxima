// D15 — schedule update briefs: "Who works with you" uses the day sheet's rule (same site, ≥2h shared). Run: node test/D15.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as RC from '../docs/js/changes.js';
import { dayInfo } from '../docs/js/model.js'; import { overlapModel } from '../docs/js/board.js';
import { parseRotaFile, serializeRota } from '../docs/js/rota-parser.js';
const here = path.dirname(new URL(import.meta.url).pathname), data = (f) => path.join(here, 'data', f);
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };

// made-up two-site rota: D1/E1 at "North", D2 at "South", N1 night at North
const hrs = (a, b, o) => ({ start: a, end: b, overnight: !!o, durationMin: o ? b + 1440 - a : b - a });
const legend = { D: { hours: hrs(480, 1200), desc: 'Day' }, E: { hours: hrs(780, 1320), desc: 'Evening' }, N: { hours: hrs(1200, 480, 1), desc: 'Night' },
  D1: { desc: 'North', hours: hrs(480, 1200) }, D2: { desc: 'South', hours: hrs(480, 1200) }, E1: { desc: 'North', hours: hrs(780, 1320) }, N1: { desc: 'North', hours: hrs(1200, 480, 1) }, L1: { desc: 'North', hours: hrs(1080, 1260) } };
const mk = (o) => Object.fromEntries(Object.entries(o));
const rota = (people) => ({ id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people });
const P = (id, name, days) => ({ id, name: `Dr ${name}`, days: mk(days) });
const s = { me: { id: '1', name: 'Dr Me' }, friends: {} };
const T = new Date(2026, 10, 1);

await t('exact membership: Ann + Cy + Di(2h boundary) at North, Bo/Ed at South are "elsewhere"', () => {
  const people = (mine) => [P('1', 'Me', { 10: mine }), P('2', 'Ann', { 10: 'D1' }), P('3', 'Bo', { 10: 'D2' }), P('4', 'Cy', { 10: 'E1' }), P('5', 'Di', { 10: 'L1' }), P('6', 'Ed', { 10: 'D2' })];
  const x = RC.diffRota(s, rota(people('')), rota(people('D1')), T).withMe.find(w => w.day === 10);
  // L1 18:00–21:00 shares 18:00–20:00 = 120 min with D1: the day sheet's overlapCount threshold is ≥120, so Di counts
  assert.deepEqual([...x.names].sort(), ['Ann', 'Cy', 'Di']); assert.equal(x.count, 3); assert.equal(x.site, 'North'); assert.equal(x.elsewhere, 2);
});

await t('colleague moves site: shown as left (T02-04 "− Hibat Allah" case), and a South change is not "with you"', () => {
  const prev = rota([P('1', 'Me', { 12: 'D1' }), P('2', 'Ann', { 12: 'D1' }), P('3', 'Bo', { 12: 'D2' })]);
  const next = rota([P('1', 'Me', { 12: 'D1' }), P('2', 'Ann', { 12: 'D2' }), P('3', 'Bo', { 12: '' })]);
  const d = RC.diffRota(s, prev, next, T), x = d.withMe.find(w => w.day === 12);
  assert.deepEqual(x.left, ['Ann']); assert.deepEqual(x.joined, []); assert.equal(x.count, 0); assert.ok(!x.mine);
  assert.match(RC.headline(d), /1 change in who works with you/, 'Bo leaving South is not a change in who works with you');
});

await t('overnight: a North evening sharing 2h of my night counts, a 1h one does not', () => {
  const prev = rota([P('1', 'Me', { 5: 'N1' }), P('2', 'Ann', {}), P('3', 'Bo', {})]);
  const next = rota([P('1', 'Me', { 5: 'N1' }), P('2', 'Ann', { 5: 'E1' }), P('3', 'Bo', { 5: 'L1' })]);
  const x = RC.diffRota(s, prev, next, T).withMe.find(w => w.day === 5);
  assert.deepEqual(x.joined, ['Ann'], 'E1 13:00–22:00 shares 20:00–22:00; L1 18:00–21:00 only 1h');
});

await t('my own day off: no "with you" line', () => {
  const d = RC.diffRota(s, rota([P('1', 'Me', { 7: 'D1' }), P('2', 'Ann', { 7: 'D1' })]), rota([P('1', 'Me', {}), P('2', 'Ann', { 7: 'D1' })]), T);
  assert.ok(!d.withMe.some(w => w.day === 7)); assert.equal(d.mine.length, 1);
});

if (fs.existsSync(data('main.xlsx'))) {
  const b = fs.readFileSync(data('main.xlsx')), r = serializeRota(await parseRotaFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), 'main.xlsx'));
  const me = { name: 'Dr. Reem Mahgoub', id: '437326' }, st = { me, friends: {}, rotas: { [r.id]: r } };
  await t('real GP rota: brief count = day sheet count on every one of my shifts', () => {
    const prev = { ...r, people: r.people.map(p => p.id === me.id ? { ...p, days: {} } : p) }, d = RC.diffRota(st, prev, r, new Date(r.year, r.month - 1, 1));
    const mineDays = d.withMe.filter(w => w.mine); assert.ok(mineDays.length >= 10, `${mineDays.length} of my shifts compared`);
    for (const w of mineDays) {
      const info = dayInfo(st, new Date(r.year, r.month - 1, w.day)), m = overlapModel(info.mine, [...info.withMe, ...info.alsoAtSite]);
      const sheet = (m?.rows || []).filter(x => x.overlap >= 120).length;
      assert.equal(w.count, sheet, `day ${w.day}: brief ${w.count} vs day sheet ${sheet}`); assert.equal(w.site, info.mine.shift.site);
      assert.ok(w.count < 10, `day ${w.day}: ${w.count} is a site team, not the whole rota`);
    }
  });
} else console.log('  - no main.xlsx: real-rota check skipped');

// UI: the brief's "Who works with you" lines (no reload: the store is changed in-page so the stored rota is not re-read)
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs').catch(() => ({}));
if (chromium && fs.existsSync(data('main.xlsx'))) {
  const http = await import('node:http'), root = path.resolve(here, '../docs');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
  await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), shots = path.join(here, 'shots'); fs.mkdirSync(shots, { recursive: true });
  for (const [ui, vp] of [['clean', { width: 390, height: 844 }], ['paper', { width: 1600, height: 1000 }], ['arcade', { width: 390, height: 844 }], ['paper', { width: 390, height: 844 }], ['clean', { width: 320, height: 700 }], ['clean', { width: 1600, height: 1000 }]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack).split('\n')[1]));
    await p.clock.install({ time: new Date('2026-11-09T08:00:00+03:00') });
    await p.addInitScript((ui) => { localStorage.setItem('citrus.ui', JSON.stringify({ ui })); if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } })); }, ui);
    await p.goto(URL0); await sleep(600); await p.evaluate((ui) => document.documentElement.setAttribute('data-ui', ui), ui); await p.click('nav.tabs button[data-view=rota]');
    const upload = async () => { await p.locator('#view-rota input[type=file]').first().setInputFiles([data('main.xlsx')]); await sleep(2200); };
    await upload();
    // pretend the stored version had me off on 16 and a colleague at another site on 17
    await p.evaluate(async () => { const store = await import('./js/store.js'); store.update(st => { const rotas = { ...st.rotas }, id = Object.keys(rotas).find(k => rotas[k].unitKind === 'gp'), r = rotas[id];
      rotas[id] = { ...r, people: r.people.map(x => x.id === '437326' ? { ...x, days: { ...x.days, 16: '' } } : x) }; return { ...st, rotas }; }); });
    await upload();
    const sec = p.locator('.sheet .rc-sec:has(.title:text-is("Who works with you"))'), txt = (await sec.count()) ? await sec.innerText() : '';
    const m = /Mon 16\s+new shift\s+with (\d+) (?:people|person) at ([^\n·]+?)\s*(?:·|\n|$)/i.exec(txt);
    if (!m) console.log(txt.slice(0, 300));
    const line = m ? `${m[2]} · ${m[1]}` : 'none';
    console.log(`  ${m && +m[1] < 6 ? '✓' : '✗'} ${ui} ${vp.width}px: Mon 16 brief → ${line}`); if (!m || +m[1] >= 6) fails++;
    if (errors.length) { fails++; console.log('  ✗ page errors', errors.join('|').slice(0, 200)); }
    await sleep(3200); await p.locator('.sheet').screenshot({ path: path.join(shots, `D15-brief-${ui}-${vp.width}.png`) }).catch(() => p.screenshot({ path: path.join(shots, `D15-brief-${ui}-${vp.width}.png`) }));
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (over) { fails++; console.log('  ✗ horizontal scroll'); }
    await ctx.close();
  }
  await browser.close(); server.close();
}
console.log(fails ? `${fails} FAILED` : 'D15 ok'); process.exit(fails ? 1 : 0);
