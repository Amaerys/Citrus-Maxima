// Robustness: hostile / odd inputs, scale, merge. Run: node test/fuzz.mjs
import assert from 'node:assert/strict'; import fs from 'node:fs';
globalThis.location = { href: 'https://citrus.test/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as L from '../docs/js/media.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const pend = []; const t = (n, f) => { pend.push((async () => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } })()); };
const base = () => ({ media: {}, memos: {}, mediaMeta: {}, deleted: {} });

t('parsers never throw on garbage', () => {
  const junk = ['', ' ', '\n\n', 'a', '{', '[]', 'null', '"', '"""', ',,,,\n,,,,', 'Const,Title Type\n', 'Const,Title Type\n,\n', 'Exclusive Shelf,Title\n,\n', '<game>', '<games><game><name>x</name></game></games>', '{"response":{"games":null}}', '{"response":{"games":[{}]}}', '\u0000\u0001', 'x'.repeat(1e6), 'Const,Title Type,Title\n' + 'tt1,Film,' + '"'.repeat(7) + '\n'];
  for (const j of junk) { for (const f of [() => L.parseExport(j), () => L.parseExport(j, { mode: 'dropped' }), () => L.parseSteam(j), () => L.parseCSV(j)]) { let r; try { r = f(); } catch (e) { assert.fail(`threw on ${JSON.stringify(j.slice(0, 30))}: ${e.message}`); } } }
});
t('CSV edge cases: BOM, CRLF, quotes, embedded newlines, semicolons stay in fields', () => {
  const csv = '﻿Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors\r\ntt1,8,2024-01-02,"He said ""hi""\nthere",Film,2020,"A, B","X, Y"\r\ntt2,0,,Plain; title,Film,2021,,\r\n';
  const r = L.parseExport(csv); assert.equal(r.items.length, 2); assert.equal(r.items[0].title, 'He said "hi"\nthere'); assert.deepEqual(r.items[0].genres, ['A', 'B']); assert.equal(r.items[1].title, 'Plain; title');
});
t('hostile titles never become markup/urls; covers are sanitised', () => {
  let s = L.addMedia(base(), { kind: 'book', title: '<img src=x onerror=alert(1)>', cover: 'javascript:alert(1)', creator: 'a'.repeat(500), genres: Array(50).fill('g'.repeat(100)), status: 'done', rating: 99 });
  const m = Object.values(s.media)[0]; assert.equal(m.cover, ''); assert.ok(m.creator.length <= 80); assert.ok(m.genres.length <= 6 && m.genres[0].length <= 30); assert.equal(m.rating, 10);
  s = L.addMedia(base(), { kind: 'nope', title: 'x', status: 'zzz', rating: -5, progress: 'abc', total: NaN }); const n = Object.values(s.media)[0]; assert.equal(n.kind, 'book'); assert.equal(n.status, 'planned'); assert.equal(n.rating, 0); assert.equal(n.progress, 0);
  assert.equal(Object.keys(L.addMedia(base(), { title: '   ' }).media).length, 0);
});
t('5,000 imported items: parse + upsert + stats + ranking stay fast', () => {
  const rows = ['Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors,IMDb Rating,Runtime (mins)']; for (let i = 0; i < 5000; i++) rows.push(`tt${i},${i % 11},20${10 + i % 15}-0${1 + i % 9}-1${i % 9},"Title ${i}",Film,${1950 + i % 70},"Drama, G${i % 40}","Dir ${i % 300}",${(i % 90) / 10 + 1},${60 + i % 90}`);
  const t0 = Date.now(), r = L.parseExport(rows.join('\n')); let s = L.upsertMany(base(), r.items).state; const t1 = Date.now();
  L.statsOf(s, null); L.feedbackOf(s, ['movie']); L.rankPlanned(s, ['movie']); L.yearReview(s, 2020); L.filterShelf(L.mediaList(s), { q: 'title 4', genre: 'Drama', min: 5, sort: 'rating' }); const t2 = Date.now();
  assert.equal(Object.keys(s.media).length, 5000); assert.ok(t1 - t0 < 8000, `import ${t1 - t0}ms`); assert.ok(t2 - t1 < 2000, `analysis ${t2 - t1}ms`);
  console.log(`     import ${t1 - t0}ms, analysis ${t2 - t1}ms`);
});
t('re-import is idempotent and never duplicates', () => {
  const csv = 'Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors\ntt1,8,2024-01-02,A,Film,2020,Drama,X\ntt2,0,,B,Film,2021,Drama,X';
  let s = L.upsertMany(base(), L.parseExport(csv).items).state; const a = JSON.stringify(Object.values(s.media).map(m => [m.title, m.status, m.rating, m.finishedAt]));
  for (let i = 0; i < 3; i++) s = L.upsertMany(s, L.parseExport(csv).items, { sync: true }).state; assert.equal(Object.keys(s.media).length, 2); assert.equal(JSON.stringify(Object.values(s.media).map(m => [m.title, m.status, m.rating, m.finishedAt])), a);
});
t('your own edits survive a non-sync re-import; sync only touches same-service items', () => {
  const csv = 'Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors\ntt1,8,2024-01-02,A,Film,2020,Drama,X';
  let s = L.upsertMany(base(), L.parseExport(csv).items).state; const id = Object.keys(s.media)[0]; s = L.updateMedia(s, id, { rating: 3, status: 'dropped' });
  s = L.upsertMany(s, L.parseExport(csv).items).state; assert.deepEqual([s.media[id].rating, s.media[id].status], [3, 'dropped']);
  let m = L.addMedia(base(), { kind: 'movie', title: 'A', year: 2020, status: 'planned' }); const mid = Object.keys(m.media)[0]; m = L.upsertMany(m, L.parseExport(csv).items, { sync: true }).state; assert.equal(Object.keys(m.media).length, 1); assert.equal(m.media[mid].status, 'done');
});
t('analysis on empty / single / unrated data does not throw or divide by zero', () => {
  const e = base(); for (const k of [null, ['book'], ['game'], ['movie', 'show'], ['manga']]) { const st = L.statsOf(e, k); assert.equal(st.n, 0); assert.equal(st.avg, null); assert.ok(L.feedbackOf(e, k).length); assert.deepEqual(L.rankPlanned(e, k), []); }
  assert.equal(L.yearReview(e, 2026).n, 0); assert.equal(L.gameStats(e).hours, 0); assert.ok(!Number.isNaN(L.gameStats(e).neverShare));
  const one = L.addMedia(e, { kind: 'game', title: 'G', status: 'done', minutes: 90 }); assert.equal(L.gameStats(one).hours, 2); assert.equal(L.statsOf(one, null).avg, null);
  const un = L.addMedia(e, { kind: 'book', title: 'U', status: 'done' }); assert.equal(Object.values(un.media)[0].finishedAt, new Date().toLocaleDateString('en-CA')); assert.equal(L.yearReview(un, 2020).n, 0);
});
t('two devices: edits and deletions merge; tombstones win over stale copies', () => {
  let a = L.addMedia(base(), { id: 'x', kind: 'book', title: 'X', status: 'planned' }); a.updatedAt = 1; let b = JSON.parse(JSON.stringify(a)); b = L.updateMedia(b, 'x', { status: 'done', rating: 9 }); b.updatedAt = 2;
  assert.equal(mergeStates(a, b).media.x.status, 'done'); let c = L.deleteMedia(a, 'x'); c.updatedAt = 3; assert.equal(mergeStates(b, c).media.x, undefined); assert.equal(mergeStates(c, b).media.x, undefined);
  const d1 = L.setMeta(base(), { goal: { book: 10 } }), d2 = L.setMeta(base(), { goal: { book: 20 } }); d2.mediaMeta.at = d1.mediaMeta.at + 5; assert.equal(mergeStates(d1, d2).mediaMeta.goal.book, 20);
});
t('dates: impossible / odd values do not poison the year views', () => {
  let s = base(); for (const d of ['', 'abc', '0000-00-00', '2026-13-45', '1899-01-01', null, undefined]) s = L.addMedia(s, { kind: 'book', title: 'D' + d, status: 'done', rating: 7, finishedAt: d, src: 'goodreads' });
  assert.doesNotThrow(() => { L.yearReview(s, 2026); L.statsOf(s, null); L.filterShelf(L.mediaList(s), { year: 2026 }); });
});
t('shift board: overlapping day/evening/night on one axis, now line, next handover', async () => {
  const { boardModel } = await import('../docs/js/board.js'); const P = (n) => ({ name: n }), E = (n, type, start, end, overnight = false) => ({ person: P(n), code: type, shift: { type, label: type, hours: { start: start * 60, end: end * 60, overnight } } });
  const m = boardModel([E('A', 'D', 7, 19), E('B', 'E', 14, 23), E('C', 'N', 19, 7, true), E('Me', 'D', 7, 19)], { nowMin: 15 * 60, meKey: 'Me' });
  assert.equal(m.axisStart, 420); assert.equal(m.axisEnd, 1860); assert.equal(m.rows.length, 4); assert.equal(m.nowCount, 3); assert.equal(m.rows.find(r => r.me).name, 'Me');
  assert.deepEqual([m.next.t, m.next.arrive, m.next.leave], [19 * 60, 1, 2]); assert.equal(m.peak, 3); assert.equal(m.rows.find(r => r.name === 'C').end, 1860);
  assert.equal(boardModel([E('C', 'N', 19, 7, true)], { nowMin: 2 * 60 }).now, 26 * 60, 'after midnight counts on the night axis'); assert.equal(boardModel([]).rows.length, 0); assert.equal(boardModel([E('X', 'D', 8, 9)]).axisEnd - 8 * 60 >= 720, true);
});
t('real exports (if present) parse to the expected shape', () => {
  const d = '/mnt/user-data/attachments/a1f5476a-0219-5c7e-9801-fd990059411a/'; if (!fs.existsSync(d)) return;
  const g = L.parseExport(fs.readFileSync(d + 'b9685fe4-goodreads_library_export.csv', 'utf8')), i = L.parseExport(fs.readFileSync(d + '3aec3ad0-4f94e9f4-1eca-44e9-bd41-2eb5ed86b2f7.csv', 'utf8'));
  assert.equal(g.items.length, 779); assert.equal(g.items.filter(x => x.status === 'dropped').length, 7); assert.equal(g.items.filter(x => x.status === 'done' && !x.finishedAt).length, 11);
  assert.equal(i.items.length, 407); assert.ok(i.items.every(x => x.finishedAt === '' || /^\d{4}-\d\d-\d\d$/.test(x.finishedAt)));
  const w = L.parseExport(fs.readFileSync(d + '3aec3ad0-4f94e9f4-1eca-44e9-bd41-2eb5ed86b2f7.csv', 'utf8'), { mode: 'planned' }); assert.ok(w.items.every(x => x.status === 'planned' && !x.finishedAt));
});
await Promise.all(pend); console.log(fails ? `\n${fails} failed` : '\nfuzz ok'); process.exit(fails ? 1 : 0);
