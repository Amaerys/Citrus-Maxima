// D09 — Library: year card follows the kind filter, MAL ↔ AniList de-duplication, empty shelf, Import picker, reading-log sheet. Run: node test/D09.mjs
import assert from 'node:assert/strict';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
globalThis.location = { href: 'https://citrus.test/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const L = await import('../docs/js/media.js');
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = async (n, fn) => { try { await fn(); console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', e.message); } };
const base = () => ({ media: {}, memos: {}, mediaMeta: {}, deleted: {} });
const one = (s, kind) => Object.values(s.media).filter(m => m.kind === kind);

console.log('logic');
await t('T07-13 libraryStats follows the kind filter', () => {
  let s = base(); const add = (o) => { s = L.addMedia(s, { status: 'done', finishedAt: '2026-05-01', ...o }); };
  add({ kind: 'anime', title: 'A1', rating: 8 }); add({ kind: 'anime', title: 'A2', rating: 9 }); add({ kind: 'book', title: 'B1', rating: 4 }); add({ kind: 'game', title: 'G1', rating: 6, minutes: 600 });
  const now = new Date(2026, 10, 13), all = L.libraryStats(s, now), an = L.libraryStats(s, now, ['anime']);
  assert.equal(all.total, 4); assert.equal(all.avg, 6.75); assert.equal(an.total, 2); assert.equal(an.avg, 8.5); assert.equal(an.doneYear, 2); assert.equal(an.hours, 0);
  assert.equal(an.avg, L.statsOf(s, ['anime'], {}, now).avg, 'same number as the analysis card');
});
const malXml = (rows) => `<myanimelist>${rows.map(([id, t, sc, st = 'Completed']) => `<anime><series_animedb_id>${id}</series_animedb_id><series_title><![CDATA[${t}]]></series_title><series_episodes>25</series_episodes><my_watched_episodes>25</my_watched_episodes><my_finish_date>2024-01-02</my_finish_date><my_score>${sc}</my_score><my_status>${st}</my_status></anime>`).join('')}</myanimelist>`;
const aniItem = (id, idMal, en, ro, score, extra = {}) => ({ status: 'COMPLETED', score, progress: 25, completedAt: { year: 2024, month: 1, day: 2 }, media: { id, idMal, title: { english: en, romaji: ro }, episodes: 25, seasonYear: 2013, genres: ['Action'], coverImage: { medium: '' } }, ...extra });
const mockAni = (entries, seen = []) => async (url, o) => { const q = JSON.parse(o.body).query; seen.push(q); const anime = /type:ANIME/.test(q); return { ok: true, json: async () => ({ data: { MediaListCollection: { lists: [{ entries: anime ? entries : [] }] } } }) }; };
await t('T07-14 fetchAniList asks for idMal and keeps it, with the romaji title as orig', async () => {
  const seen = []; globalThis.fetch = mockAni([aniItem(16498, 16498, 'Attack on Titan', 'Shingeki no Kyojin', 90)], seen);
  const items = await L.fetchAniList('someone'); assert.ok(seen.every(q => /idMal/.test(q)), 'query has idMal');
  assert.deepEqual([items[0].title, items[0].orig, items[0].malId], ['Attack on Titan', 'Shingeki no Kyojin', '16498']);
});
await t('T07-14 MAL first, then AniList: one record, your MAL rating kept', async () => {
  let s = L.upsertMany(base(), L.parseExport(malXml([[16498, 'Shingeki no Kyojin', 9], [1, 'Cowboy Bebop', 10]])).items).state;
  globalThis.fetch = mockAni([aniItem(16498, 16498, 'Attack on Titan', 'Shingeki no Kyojin', 70), aniItem(5, 99, 'Something Else', 'Betsu', 80)]);
  const r = L.upsertMany(s, await L.fetchAniList('x')); s = r.state; const an = one(s, 'anime');
  assert.equal(an.length, 3, 'AoT matched, the other added'); const aot = an.find(m => m.malId === '16498'); assert.equal(aot.rating, 9); assert.equal(r.added, 1);
  assert.equal(L.statsOf(s, ['anime']).ratedN, 3);
});
await t('T07-14 AniList first, then MAL: one record', async () => {
  globalThis.fetch = mockAni([aniItem(16498, 16498, 'Attack on Titan', 'Shingeki no Kyojin', 80)]);
  let s = L.upsertMany(base(), await L.fetchAniList('x')).state; const r = L.upsertMany(s, L.parseExport(malXml([[16498, 'Shingeki no Kyojin', 9]])).items); s = r.state;
  assert.equal(one(s, 'anime').length, 1); assert.equal(r.added, 0); assert.equal(one(s, 'anime')[0].rating, 8, 'your AniList rating is not overwritten');
  assert.equal(L.findMedia(s, { kind: 'anime', title: 'Shingeki no Kyojin', src: 'mal', extId: '16498' })?.title, 'Attack on Titan');
});
await t('T07-14 existing duplicates fold into one on the next AniList sync (tombstone, MAL rating and review kept)', async () => {
  // an older AniList import had no idMal, so both records exist
  let s = L.upsertMany(base(), [{ kind: 'anime', title: 'Attack on Titan', src: 'anilist', extId: '16498', status: 'planned', rating: 0 }]).state;
  s = L.upsertMany(s, [{ ...L.parseExport(malXml([[16498, 'Shingeki no Kyojin', 9]])).items[0], review: 'loved it' }]).state; assert.equal(one(s, 'anime').length, 2, 'the duplicate the beta found');
  const malRec = one(s, 'anime').find(m => m.src === 'mal');
  globalThis.fetch = mockAni([aniItem(16498, 16498, 'Attack on Titan', 'Shingeki no Kyojin', 0, { status: 'COMPLETED' })]);
  s = L.upsertMany(s, await L.fetchAniList('x')).state; const an = one(s, 'anime');
  assert.equal(an.length, 1); assert.deepEqual([an[0].rating, an[0].review, an[0].status, an[0].malId], [9, 'loved it', 'done', '16498']); assert.ok(s.deleted[`media:${malRec.id}`], 'tombstone so other devices drop it too');
  s = L.upsertMany(s, L.parseExport(malXml([[16498, 'Shingeki no Kyojin', 9]])).items).state; assert.equal(one(s, 'anime').length, 1, 're-importing the MAL file does not bring it back');
});
await t('MAL ids are per kind: anime 1 and manga 1 stay apart', () => {
  const s = L.upsertMany(base(), [{ kind: 'anime', title: 'Cowboy Bebop', src: 'mal', extId: '1', status: 'done' }, { kind: 'manga', title: 'Monster', src: 'mal', extId: '1', status: 'done' }]).state;
  assert.equal(Object.keys(s.media).length, 2);
});

// ───────────── UI
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D09'); fs.mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), errors = [];
const rec = (o) => ({ rating: 0, progress: 0, total: 0, year: 0, creator: '', genres: [], cover: '', src: 'manual', extId: '', malId: '', format: '', log: [], quotes: [], startedAt: '', finishedAt: '', minutes: 0, review: '', createdAt: 1, at: 1, status: 'done', ...o });
const seeded = { me: { name: 'Test Doctor', id: '000001' }, media: Object.fromEntries([
  rec({ id: 'a1', kind: 'anime', title: 'Anime One', rating: 8, finishedAt: '2026-03-01' }), rec({ id: 'a2', kind: 'anime', title: 'Anime Two', rating: 9, finishedAt: '2026-04-01' }),
  rec({ id: 'b1', kind: 'book', title: 'Book One', rating: 4, finishedAt: '2026-02-01', total: 300 }), rec({ id: 'b2', kind: 'book', title: 'Book Two', status: 'doing', total: 300, progress: 50 }),
].map(m => [m.id, m])) };
async function open(width, height, state, ui = 'clean') {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' }), p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message)); await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
  await p.addInitScript(([s, u]) => { if (!localStorage.getItem('citrus.state.v1')) localStorage.setItem('citrus.state.v1', JSON.stringify(s)); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); }, [state, ui]);
  await p.goto(URL0); await sleep(600); await p.click('nav.tabs button[data-view=mind]'); await sleep(250); await p.click('.mn-main'); await sleep(150); await p.click('.ml-tile:has-text("Library")'); await sleep(400);
  return { ctx, p };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

console.log('empty library (T07-19)');
{
  const { ctx, p } = await open(390, 844, { me: seeded.me });
  check(await p.locator('#view-mind .lib-welcome').count() === 1, 'one welcome card');
  check(await p.locator('#view-mind .shelf-filter, #view-mind .card.reading, #view-mind .goal-ring').count() === 0, 'no zero-filled stats, rings or filters');
  const wb = await p.locator('#view-mind .lib-welcome').boundingBox(); check(wb && wb.y + wb.height < 844, 'the welcome card is above the fold');
  check(await p.locator('#view-mind .lbw-svc').count() === 5, 'five import shortcuts'); await p.screenshot({ path: `${shots}/phone-empty-clean.png` });
  await p.click('#view-mind .lbw-svc:has-text("MyAnimeList")'); await sleep(300);
  check(await p.locator('#view-mind .imp-row[data-imp=mal][open]').count() === 1, 'shortcut opens Connect on that service');
  console.log('Connect (T07-20)');
  check(await p.locator('#view-mind .imp-row').count() === 5, 'one Import picker with a row per service');
  const txt = await p.locator('#view-mind').innerText(); check(!/Choose CSV file/.test(txt), 'no "Choose CSV file"'); check(await p.locator('#view-mind .imp-row[data-imp=mal] button:has-text("Choose export file")').isVisible(), 'MAL button says "Choose export file"');
  check(await p.locator('#view-mind .imp-row:not([open]) .imp-body').evaluateAll(els => els.length === 4 && els.every(e => !e.checkVisibility())), 'other services stay folded');
  check(await overflow(p) <= 0, 'no sideways scroll @390'); await p.screenshot({ path: `${shots}/phone-connect-clean.png`, fullPage: true });
  await p.click('#view-mind .imp-row[data-imp=steam] summary'); await sleep(200); check(await p.locator('#view-mind .imp-row[data-imp=steam] textarea').isVisible(), 'Steam row opens with its paste box');
  await p.setInputFiles('#view-mind .imp-row[data-imp=mal] input[type=file]', { name: 'animelist.xml', mimeType: 'text/xml', buffer: Buffer.from(malXml([[1, 'Cowboy Bebop', 10]])) }); await sleep(300);
  check(/MyAnimeList file: 1 item\b/.test(await p.locator('#view-mind .preview').innerText()), 'MAL file previews'); await p.click('#view-mind .preview button:has-text("Import")'); await sleep(300);
  check(/MyAnimeList: 1 added/.test(await p.locator('#view-mind .imp').innerText()), 'import result shown in the picker'); check(/^1 item$/.test(await p.locator('#view-mind .imp-row[data-imp=mal] .imp-st').innerText()), 'row shows how many items came from it');
  await ctx.close();
}
console.log('year card follows the kind (T07-13) + reading sheet (T07-23, T07-24)');
for (const [w, hgt, ui] of [[390, 844, 'clean'], [1600, 1000, 'paper'], [390, 844, 'paper'], [1600, 1000, 'clean']]) {
  const { ctx, p } = await open(w, hgt, seeded, ui), tag = `${w < 700 ? 'phone' : 'wide'}-${ui}`;
  if (w === 390 && ui === 'clean') {
    await p.click('#view-mind .kinds button:has-text("Anime")'); await sleep(300);
    const yr = await p.locator('#view-mind .lib-year').innerText(), an = await p.locator('#view-mind .card:has-text("analysed")').innerText();
    check(/8\.5/.test(yr) && /8\.5/.test(an) && !/6\.0|7\.0/.test(yr), `year card and analysis agree (8.5): "${yr.replace(/\n/g, ' ')}"`); check(/anime/i.test(yr), 'year card names the kind');
    await p.click('#view-mind .kinds button:has-text("Games")'); await sleep(300); check(await p.locator('#view-mind .lib-welcome').count() === 1 && /No games yet/.test(await p.locator('#view-mind .lib-welcome').innerText()), 'an empty kind gets its own short welcome');
    check(await p.locator('#view-mind .lbw-svc').count() === 1, 'and only the service that has games');
    await p.click('#view-mind .kinds button:has-text("Books")'); await sleep(300);
    await p.evaluate(() => { const si = window.setInterval, ci = window.clearInterval; window.__iv = new Set(); window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); if (ms === 1000) window.__iv.add(id); return id; }; window.clearInterval = (id) => { window.__iv.delete(id); return ci(id); }; });
    for (const how of ['Escape', 'backdrop']) {
      await p.click('#view-mind .cur-book'); await sleep(250); await p.click('.sheet button:has-text("Timer")'); await sleep(50);
      check(await p.evaluate(() => window.__iv.size) === 1, `timer running (${how})`);
      if (how === 'Escape') await p.keyboard.press('Escape'); else await p.mouse.click(195, 20); await sleep(200);
      check(await p.locator('.sheet').count() === 0 && await p.evaluate(() => window.__iv.size) === 0, `closing by ${how} stops the timer`);
    }
    await p.click('#view-mind .cur-book'); await sleep(250);
    await p.fill('.sheet input[placeholder="pages read"]', '30'); check(/Logs 30 pages: p\. 50 → 80/.test(await p.locator('.sheet .log-hint').innerText()), 'says what will be logged');
    await p.fill('.sheet input[placeholder="now on page…"]', '60'); await sleep(50);
    check(await p.inputValue('.sheet input[placeholder="pages read"]') === '', 'typing the page you are on clears "pages read"'); check(/Logs 10 pages: p\. 50 → 60/.test(await p.locator('.sheet .log-hint').innerText()), 'hint follows the field that wins');
    await p.screenshot({ path: `${shots}/${tag}-logsheet.png` });
    await p.click('.sheet .seg.mini button:has-text("+20")'); check(await p.inputValue('.sheet input[placeholder="now on page…"]') === '', 'a +N chip clears the page field');
    await p.click('.sheet .btn.primary:has-text("Log")'); await sleep(300); check(/p\. 70\/300/.test(await p.locator('#view-mind .cur-book').innerText()), 'logs the 20 pages');
    await p.click('#view-mind .kinds button:has-text("All")'); await sleep(300);
  }
  check(await overflow(p) <= 0, `${tag}: no sideways scroll on the shelf`); await p.screenshot({ path: `${shots}/${tag}-shelf.png`, fullPage: true });
  await p.click('#view-mind .lib-tabs button:has-text("Connect")'); await sleep(250); await p.click('#view-mind .imp-row[data-imp=imdb] summary'); await sleep(200);
  check(await overflow(p) <= 0, `${tag}: no sideways scroll in Connect`); await p.screenshot({ path: `${shots}/${tag}-connect.png`, fullPage: true });
  await ctx.close();
}
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} failed` : '\nD09 ok'); process.exit(bad ? 1 : 0);
