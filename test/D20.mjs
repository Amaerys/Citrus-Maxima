// D20 — Apps tab, Settings, search palette, shortcuts, design tokens, merged CSS. Run: node test/D20.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), data = (f) => path.join(here, 'data', f), shots = path.join(here, 'shots/D20'); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };

console.log('source and files');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
check(!fs.existsSync(path.join(root, 'css/parts')) && !/css\/parts/.test(html) && !/css\/parts/.test(sw), 'css/parts merged away: no folder, no <link>, not in sw.js');
check(/from D01:/.test(css) && /from D19:/.test(css) && /from D20:/.test(css), 'app.css carries every developer section');
check(/CU\.todayScore\(\)/.test(app) && /PU\.todayScore\(working\)/.test(app), 'Today ranks Home and Nurses by their own scores');
check(!/function briefText/.test(app), 'the unused briefText is gone');
check(!/#2a1a0a|#12151c/.test(css) && !/color: #5fd38d; }/.test(css), 'no dark-only hex for constellation or avatars');
check(/meta\[name=theme-color\]/.test(html), 'the pre-paint script sets theme-color');
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && f !== 'app.js' && f !== 'util.js').map(f => f.slice(0, -3));
check(jsFiles.every(f => sw.includes(`'${f}'`)), 'sw.js precaches every docs/js file');

console.log('today-model: a guess is labelled as a guess');
{
  const TM = await import(path.join(root, 'js/today-model.js'));
  const r = { year: 2026, month: 11, daysInMonth: 30, unitKind: 'nurse', legend: {}, people: [{ name: 'Nurse Test', id: 'n1', days: { 10: 'D' } }] };
  const gp = { year: 2026, month: 11, daysInMonth: 30, unitKind: 'gp', legend: {}, people: [{ name: 'Dr Me', id: 'm1', days: { 10: 'D1' } }] };
  const s = { me: { name: 'Dr Me', id: 'm1' }, rotas: { a: r, b: gp } };
  const w = (guess) => () => ({ confirmed: [], possible: [], tipped: [{ key: 'id:n1', guess }] });
  const g = TM.daysWithMe(s, 'id:n1', { nursesWithMe: w(true) }), hrd = TM.daysWithMe(s, 'id:n1', { nursesWithMe: w(false) });
  check(g[0]?.how === 'guess (last time)' && hrd[0]?.how === 'heard: with you', `guess → "${g[0]?.how}", tip → "${hrd[0]?.how}"`);
}

if (!fs.existsSync(data('main.xlsx'))) { console.log('no main.xlsx: browser part skipped'); process.exit(bad ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
const NOW = new Date('2026-11-13T21:30:00+03:00');
const statuses = {
  'citrus.status.yuzu': { app: 'yuzu', updatedAt: '2026-11-12T17:00:00Z', today: { date: '2026-11-12', done: true }, asks: [{ date: '2026-11-13', minutes: 25 }], due: 120, pending: ['Leg day'] },
  'citrus.status.orange': { app: 'orange', updatedAt: 'yesterday', summary: 'Push day ' + 'x'.repeat(300), pending: ['Leg day'], url: 'https://orange-fitness.github.io/Orange/?tab=gym#today' },
};
async function open({ width = 390, height = 844, ui = null, size = null, withStatus = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.clock.install({ time: NOW });
  await p.addInitScript(({ statuses, ui, size, withStatus }) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('citrus.state.v1', JSON.stringify({ me: { name: 'Dr. Reem Mahgoub', id: '437326' } }));
    if (withStatus) for (const [k, v] of Object.entries(statuses)) localStorage.setItem(k, JSON.stringify(v));
    if (ui || size) localStorage.setItem('citrus.ui', JSON.stringify({ ...(ui ? { ui } : {}), ...(size ? { size } : {}) }));
    localStorage.setItem('other.app', 'keep me');
  }, { statuses, ui, size, withStatus });
  await p.goto(URL0); await sleep(500);
  await p.click('nav.tabs button[data-view=rota]');
  await p.locator('#view-rota input[type=file]').first().setInputFiles(['main.xlsx', 'nurses.xlsx', 'uv.xlsx', 'fsed.xlsx'].map(data).filter(f => fs.existsSync(f))); await sleep(2500);
  await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove())); await sleep(100);
  return { ctx, p };
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

console.log('Apps tab');
{
  const { ctx, p } = await open();
  await p.click('nav.tabs button[data-view=apps]'); await sleep(300);
  check(await p.locator('#view-apps [role=tablist] [role=tab]').count() >= 6 && await p.locator('#view-apps .constellation[aria-hidden=true]').count() === 1, 'one tab stop per app (appTabs), stars hidden from the keyboard');
  await p.locator('#view-apps [role=tab]:has-text("Yuzu")').click(); await sleep(200);
  const yz = await p.locator('#app-panel').innerText();
  check(!/Done today/.test(yz) && /done on an earlier day/.test(yz), 'yesterday\'s done is not "Done today" (T09-01)');
  check(/25m asked today/.test(yz) && /121 items waiting/.test(yz), 'minutes and items are separate numbers (T09-04): ' + yz.split('\n').slice(0, 4).join(' / '));
  await p.locator('#view-apps [role=tab]:has-text("Orange")').click(); await sleep(200);
  const or = await p.locator('#app-panel').innerText(), href = await p.locator('#app-panel a.btn').getAttribute('href');
  check(/time is unreadable/.test(or) && !/Open it once/.test(or), 'a status with an unreadable time says so, no onboarding hint (T09-07)');
  check(href === 'https://orange-fitness.github.io/Orange/?tab=gym&from=citrus#today', `Open link keeps from=citrus out of the hash (T09-03): ${href}`);
  check(await noOverflow(p), 'a 300-character summary wraps, no sideways page (T09-05)');
  await p.locator('#view-apps [role=tab][aria-selected=true]').focus(); await p.keyboard.press('ArrowRight'); await sleep(200);
  check(!/Orange/.test(await p.locator('#app-panel .nm').innerText()), 'arrow keys move through the apps');
  await p.click('nav.tabs button[data-view=today]'); await sleep(300);
  const card = await p.locator('#view-today .apps-today').innerText().catch(() => '');
  check(/Yuzu/.test(card) && !/done today/.test(card), 'Today › Your apps does not call yesterday "done today"');
  await p.screenshot({ path: `${shots}/apps-phone.png` });
  await ctx.close();
}

console.log('search, shortcuts, layers');
{
  const { ctx, p } = await open({ withStatus: false, width: 1600, height: 1000 });
  const search = async (q) => { await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('.search')?.remove()); await p.keyboard.press('/'); await sleep(80); await p.keyboard.type(q); await sleep(150); return p.locator('.search .res .item').allInnerTexts(); };
  check(!(await search('31/02')).some(t => /\d\d\/\d\d\/\d{4}/.test(t)), '"31/02" offers no rolled-over date (T09-09)');
  check((await search('21/11')).some(t => /Saturday 21\/11\/2026/.test(t)), '"21/11" offers Saturday 21/11/2026');
  check((await search('yuzu')).some(t => /Open Yuzu/.test(t)), 'known apps are found even before they report (T09-08)');
  const n2 = await search('who\'s on N2 tomorrow'); check(n2.some(t => /^N2 tomorrow: \d+/.test(t)), `shift codes with a day: ${n2[0]?.split('\n')[0]}`);
  check((await search('437326')).some(t => /Reem/.test(t) && /you/.test(t)), 'a staff ID finds the person, marked "you"');
  const nurse = await search('nurse'); check(nurse.length >= 5, `"nurse" lists nurses (${nurse.length})`);
  check(/today|tomorrow|\d\d\/\d\d/.test(nurse.join(' ')), 'person results show their shift (T09-29)');
  check(await p.locator('.search input[role=combobox]').count() === 1 && await p.locator('.search [role=listbox] [role=option]').count() > 1, 'combobox + listbox roles');
  await p.keyboard.press('ArrowDown'); await sleep(50);
  check(await p.locator('.search .res .item').nth(1).getAttribute('aria-selected') === 'true', 'ArrowDown moves the highlight (T09-10)');
  const second = (await p.locator('.search .res .item').nth(1).innerText()).split('\n')[0];
  await p.keyboard.press('Enter'); await sleep(250);
  check(await p.locator('.sheet h2').first().innerText().catch(() => '') === second, `Enter opens the highlighted result (${second})`);
  const before = await p.evaluate(() => document.querySelector('section.view.active').id);
  await p.keyboard.press('3'); await sleep(150);
  check(await p.evaluate(() => document.querySelector('section.view.active').id) === before, 'number keys do nothing behind an open sheet (T09-11)');
  await p.keyboard.press('/'); await sleep(100); await p.keyboard.press('Escape'); await sleep(100);
  check(await p.locator('.search').count() === 0 && await p.locator('.sheet').count() === 1, 'Escape closes the search only, the sheet stays');
  await p.keyboard.press('Escape'); await sleep(100); await p.keyboard.press('?'); await sleep(150);
  check(/Keyboard shortcuts/.test(await p.locator('.sheet').innerText().catch(() => '')), '"?" lists the shortcuts (T09-24)');
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.locator('nav.tabs button[data-view=more]').isVisible(), 'Settings is a rail item on desktop');
  await p.keyboard.press(','); await sleep(150);
  check(await p.locator('nav.tabs button[data-view=more]').getAttribute('aria-current') === 'page', 'aria-current on the active tab (T10-23)');
  await p.click('nav.tabs button[data-view=today]'); await sleep(200);
  check(await p.locator('#view-today h1').count() >= 1, 'Today has a heading for screen readers');
  check(/\w+day \d+ \w+/.test(await p.locator('#pageTitle').innerText()), 'the rail top bar shows the date');
  await ctx.close();
}

console.log('Settings, erase, storage full');
{
  const { ctx, p } = await open();
  await p.click('#btnMore'); await sleep(250);
  check(await p.locator('#view-more .card').first().locator('.ui-pick').count() === 1, 'the interface picker is the first card (T09-18)');
  check(await p.locator('nav.tabs button:visible').count() === 6, 'the phone bar keeps six tabs');
  await p.locator('.ui-size button:has-text("L")').click(); await sleep(250);
  const box = await p.locator('.ui-pick').boundingBox(); check(box && box.y >= -5 && box.y < 844, 'the picker stays in view after tapping L');
  await p.locator('button:has-text("Erase this device…")').click(); await sleep(200);
  const sh = await p.locator('.sheet').innerText(); check(/Other apps on this site keep theirs/.test(sh) && /Backup first/.test(sh), 'Erase explains itself in an in-app sheet (T09-19)');
  await p.locator('.sheet button:has-text("Erase this device")').click(); await sleep(800);
  const left = await p.evaluate(() => ({ other: localStorage.getItem('other.app'), status: localStorage.getItem('citrus.status.yuzu'), state: JSON.parse(localStorage.getItem('citrus.state.v1') || '{}') }));
  check(left.other === 'keep me' && !!left.status && !Object.keys(left.state.rotas || {}).length, 'erase removes only Citrus\'s own keys');
  await p.evaluate(async () => { const st = window.__citrus.store; Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; st.update(s => ({ ...s, notes: { ...s.notes, '2026-11-13': 'x' } })); });
  await sleep(600);
  check(await p.locator('.d10-alert[data-id=persist]').count() === 1, 'storage full → a "Not saved on this device" banner');
  await ctx.close();
}

console.log('interfaces and sizes');
{
  for (const [ui, w] of [['clean', 320], ['paper', 320], ['arcade', 320]]) {
    const { ctx, p } = await open({ width: w, height: 700, ui, size: 'large' });
    await p.click('nav.tabs button[data-view=today]'); await sleep(300);
    check(await noOverflow(p), `${ui} at ${w}px, text size L: no sideways page (T09-17)`);
    const navW = await p.evaluate(() => document.querySelector('nav.tabs').getBoundingClientRect().width); check(navW <= w + 1, `${ui}: bottom bar fits (${Math.round(navW)}px)`);
    if (ui === 'paper') {
      const c = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { dim: cs.getPropertyValue('--dim').trim(), day: cs.getPropertyValue('--day').trim(), nav: getComputedStyle(document.querySelector('nav.tabs button.active')).color }; });
      check(/5e667d/i.test(c.dim) && /8a5d00/i.test(c.day), `Paper tokens darkened (dim ${c.dim}, day ${c.day})`);
      check(c.nav === 'rgb(162, 75, 0)', `Paper active tab uses the dark orange (${c.nav})`);
    }
    await p.screenshot({ path: `${shots}/${ui}-${w}-L.png` });
    await ctx.close();
  }
}
check(!errors.length, 'no page errors' + (errors.length ? ': ' + [...new Set(errors)].join(' | ').slice(0, 300) : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} D20 check(s) FAILED` : '\nall D20 checks passed');
process.exit(bad ? 1 : 0);
