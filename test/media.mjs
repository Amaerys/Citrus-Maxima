// Library + notes logic. Run: node test/media.mjs
import assert from 'node:assert/strict';
import { mergeStates } from '../docs/js/store.js';
import * as L from '../docs/js/media.js';
import { normalizeStatus } from '../docs/js/inbound.js';
globalThis.location = { href: 'https://citrus.test/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let fails = 0; const t = (n, fn) => { try { fn(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.message); } };
const base = () => ({ media: {}, memos: {}, mediaMeta: {}, deleted: {}, tasks: {}, plan: {}, goals: [], notes: {} });
const Q = '"';
t('Goodreads CSV: shelves, ratings x2, dates, dedupe on re-import', () => {
  const csv = ['Book Id,Title,Author,ISBN13,My Rating,Number of Pages,Original Publication Year,Date Read,Exclusive Shelf,My Review',
    `1,${Q}Dune (Dune, #1)${Q},Frank Herbert,${Q}=${Q}${Q}9780441013593${Q}${Q}${Q},5,612,1965,2024/03/15,read,${Q}great, ${Q}${Q}epic${Q}${Q}${Q}`,
    '2,Neuromancer,William Gibson,,0,271,1984,,to-read,', '3,Piranesi,Susanna Clarke,,4,272,2020,,currently-reading,'].join('\n');
  const r = L.parseExport(csv); assert.equal(r.source, 'Goodreads'); assert.equal(r.items.length, 3);
  assert.deepEqual([r.items[0].title, r.items[0].rating, r.items[0].status, r.items[0].finishedAt, r.items[0].review], ['Dune', 10, 'done', '2024-03-15', 'great, "epic"']);
  assert.equal(r.items[1].status, 'planned'); assert.equal(r.items[2].status, 'doing');
  const a = L.upsertMany(base(), r.items); assert.equal(a.added, 3); const b = L.upsertMany(a.state, r.items); assert.equal(b.added, 0); assert.equal(Object.keys(b.state.media).length, 3);
});
t('IMDb CSV: kinds, episodes skipped, import never overwrites your rating', () => {
  const csv = 'Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors\ntt1,9,2024-01-02,Arrival,Movie,2016,"Drama, Sci-Fi",Denis Villeneuve\ntt2,8,2024-02-02,Severance,TV Series,2022,Drama,\ntt3,7,2024-02-03,Pilot,TV Episode,2022,,';
  const r = L.parseExport(csv); assert.equal(r.source, 'IMDb'); assert.deepEqual(r.items.map(i => i.kind), ['movie', 'show']);
  const s = L.addMedia(base(), { kind: 'movie', title: 'Arrival', rating: 6, status: 'done' }); const x = L.upsertMany(s, r.items);
  assert.equal(Object.values(x.state.media).find(m => m.title === 'Arrival').rating, 6); assert.ok(L.parseExport('a,b\n1,2').error.startsWith('Not recognised'));
});
t('Steam paste parsing; re-import updates playtime but keeps your status and rating', () => {
  const r = L.parseSteam(JSON.stringify({ response: { games: [{ appid: 1, name: 'Hades', playtime_forever: 600 }, { appid: 2, name: 'Celeste', playtime_forever: 0 }] } }));
  assert.equal(r.items.length, 2); let s = L.upsertMany(base(), r.items).state; const id = Object.values(s.media).find(m => m.title === 'Hades').id;
  s = L.updateMedia(s, id, { status: 'done', rating: 10 }); s = L.upsertMany(s, [{ kind: 'game', title: 'Hades', minutes: 900, src: 'steam', extId: 1 }]).state;
  const h = s.media[id]; assert.deepEqual([h.minutes, h.rating, h.status], [900, 10, 'done']); assert.ok(L.parseSteam('nope').error); assert.ok(L.parseSteam('{"response":{}}').error);
});
t('library stats, memo search/tags, media + memo merge with tombstones', () => {
  let s = L.addMedia(base(), { id: 'a', kind: 'book', title: 'A', status: 'done', rating: 8, finishedAt: '2026-03-01' }); s = L.addMedia(s, { id: 'b', kind: 'book', title: 'B', status: 'done', rating: 6, finishedAt: '2026-04-01' }); s = L.setGoal(s, 'book', 24);
  const st = L.libraryStats(s, new Date(2026, 10, 7)); assert.equal(st.doneYear, 2); assert.equal(st.avg, 7); assert.equal(st.goal.book, 24);
  let m = L.addMemo(s, { id: 'm1', title: 'Ideas', body: 'build a Mars rover', tags: '#space, #fun' }); m = L.addMemo(m, { id: 'm2', body: 'milk', pinned: true });
  assert.equal(L.memoList(m, { q: 'rover' }).length, 1); assert.equal(L.memoList(m)[0].id, 'm2'); assert.deepEqual(L.memoList(m, { tag: 'space' }).map(x => x.id), ['m1']);
  m.updatedAt = 1; let o = JSON.parse(JSON.stringify(m)); o = L.deleteMedia(o, 'a'); o = L.deleteMemo(o, 'm2'); o.updatedAt = 2;
  const g = mergeStates(m, o); assert.equal(g.media.a, undefined); assert.equal(g.memos.m2, undefined); assert.ok(g.media.b && g.memos.m1);
});
t('inbound actions: valid kept, javascript: urls dropped and reported', () => {
  const p = normalizeStatus({ app: 'yuzu', updatedAt: new Date().toISOString(), actions: [{ id: 'review', label: 'Start reviews', url: 'https://x.github.io/Y/#review', minutes: 30 }, { id: 'bad', label: 'x', url: 'javascript:alert(1)' }] });
  assert.equal(p.actions.length, 1); assert.equal(p.actions[0].id, 'review'); assert.ok(p.issues.some(i => i.startsWith('actions[1]')));
});
t('empty urls stay empty (never become the page address)', () => {
  const p = normalizeStatus({ app: 'x', updatedAt: new Date().toISOString(), inbox: [{ id: 'a', title: 'T' }] }); assert.equal(p.inbox[0].url, ''); assert.equal(p.url, '');
  assert.equal(Object.values(L.addMedia(base(), { title: 'A', kind: 'book' }).media)[0].cover, '');
});
console.log(fails ? `\n${fails} failed` : '\nlibrary logic ok'); process.exit(fails ? 1 : 0);
