// Library + notes logic. Run: node test/media.mjs
import assert from 'node:assert/strict';
import { mergeStates } from '../docs/js/store.js';
import * as L from '../docs/js/media.js';
import { normalizeStatus } from '../docs/js/inbound.js';
globalThis.location = { href: 'https://citrus.test/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let fails = 0; const pend = []; const t = (n, fn) => { try { const r = fn(); if (r && r.then) pend.push(r.then(() => console.log('  ✓', n), (e) => { fails++; console.log('  ✗', n, '\n    ', e.message); })); else console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.message); } };
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
t('reading log: pace, finish, ETA, highlights, reading habit link', async () => {
  const { autoDone } = await import('../docs/js/mind.js');
  const today = new Date(); const k = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let s = L.addMedia(base(), { id: 'b', kind: 'book', title: 'Dune', total: 400, status: 'planned' });
  s = L.logReading(s, 'b', { pages: 30, minutes: 40, date: k(1) }).state; s = L.logReading(s, 'b', { pageNow: 100, date: k(0) }).state;
  assert.equal(s.media.b.status, 'doing'); assert.equal(s.media.b.progress, 100); assert.equal(s.media.b.log.length, 2);
  const st = L.readingStats(s, today); assert.equal(st.streak, 2); assert.equal(st.readToday, true); assert.ok(st.pace > 0);
  const eta = L.finishEta(s, s.media.b, today); assert.equal(eta.left, 300); assert.ok(eta.days > 1);
  assert.equal(autoDone(s, { link: 'reading' }, k(0), {}, k(0)), true); assert.equal(autoDone(s, { link: 'reading' }, k(5), {}, k(0)), false);
  s = L.addQuote(s, 'b', { text: 'Fear is the mind-killer', page: 12 }); assert.equal(L.allQuotes(s).length, 1);
  const f = L.logReading(s, 'b', { pages: 999 }); assert.equal(f.finished, true); assert.equal(f.state.media.b.status, 'done'); assert.equal(f.state.media.b.progress, 400);
});
t('world recommender (mocked catalogue): lanes scored by taste, owned books and dismissed excluded', async () => {
  let s = base(); s = L.addMedia(s, { kind: 'book', title: 'Dune', creator: 'Frank Herbert', status: 'done', rating: 10, genres: ['science-fiction'] });
  s = L.addMedia(s, { kind: 'book', title: 'Neuromancer', creator: 'William Gibson', status: 'done', rating: 9, genres: ['science-fiction', 'cyberpunk'] });
  const doc = (title, author, key, subj, avg, n) => ({ title, author_name: [author], key, subject: subj, ratings_average: avg, ratings_count: n, want_to_read_count: n * 3, first_publish_year: 1980 });
  const calls = []; globalThis.fetch = async (url) => { calls.push(url); const u = decodeURIComponent(url); const docs = /author=/.test(u) ? [doc('Hyperion', 'Dan Simmons', '/w/1', ['science-fiction'], 4.3, 900)] : [doc('Dune', 'Frank Herbert', '/w/2', ['science-fiction'], 4.5, 9000), doc('Foundation', 'Isaac Asimov', '/w/3', ['science-fiction'], 4.2, 5000), doc('Obscure', 'Nobody', '/w/4', ['x'], 5, 2), doc('Cozy', 'A', '/w/5', ['romance'], 4.0, 400)]; return { ok: true, json: async () => ({ docs }) }; };
  const r = await L.worldSuggestions(s, ['ol:/w/3']); const all = r.lanes.flatMap(l => l.items.map(i => i.item.title));
  assert.ok(all.includes('Hyperion')); assert.ok(!all.includes('Dune'), 'owned book excluded'); assert.ok(!all.includes('Foundation'), 'dismissed excluded'); assert.ok(!all.includes('Obscure'), 'too few ratings excluded');
  assert.equal(new Set(all).size, all.length, 'no duplicates across lanes'); assert.ok(r.taste.subjects.includes('science-fiction'));
  const ex = await L.exploreCatalogue('scifi', s); assert.ok(ex.length && ex.every(x => x.item.title !== 'Dune'));
  const found = await L.searchBooks('dune').catch(() => []); assert.ok(Array.isArray(found));
});
t('pile ranking: favours authors and shelves you rated highly, collapses editions', () => {
  let s = L.addMedia(base(), { kind: 'book', title: 'Anna Karenina', creator: 'Leo Tolstoy', status: 'done', rating: 10, genres: ['classics'] });
  s = L.addMedia(s, { kind: 'book', title: 'The Death of Ivan Ilych', creator: 'Leo Tolstoy', status: 'planned', total: 90 }); s = L.addMedia(s, { kind: 'book', title: 'The Death of Ivan Ilych and Other Stories', creator: 'Leo Tolstoy', status: 'planned' });
  s = L.addMedia(s, { kind: 'book', title: 'Random Thriller', creator: 'Someone', status: 'planned', genres: ['thriller'] });
  const p = L.pileRanking(s); assert.equal(p.length, 1); assert.match(p[0].media.title, /Ivan Ilych/);
});

// German-localised IMDb export
{
  const hdr = 'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors';
  const t = [hdr,
    'tt1,7,2026-09-07,"Prisoners","Prisoners",u,Film,8.2,153,2013,"Krimi, Drama",9,"2013-10-10","D V"',
    'tt2,9,2026-09-08,"Dark","Dark",u,Fernsehserie,8.7,60,2017,"Drama, Mystery",9,"2017-12-01",""',
    'tt3,8,2026-09-08,"Chernobyl","Chernobyl",u,Miniserie,9.3,60,2019,"Drama",9,"2019-05-06",""',
    'tt4,8,2026-09-08,"Ep","Ep",u,Fernsehepisode,9,60,2019,"Drama",9,"2019-05-06",""',
    'tt5,6,2026-09-08,"TVM","TVM",u,Fernsehfilm,7,90,2019,"Drama",9,"2019-05-06",""'].join('\n');
  const r = L.parseExport(t);
  const k = r.items.map(i => i.kind).join();
  if (k !== 'movie,show,show,movie' || r.items[0].genres[0] !== 'Crime') { console.error('FAIL german imdb', k, r.items[0].genres); process.exit(1); }
  console.log('ok german imdb');
}

// screen taste, stats, watchlist
{
  let st = { media: {}, deleted: {} };
  const add = (o) => { st = L.addMedia(st, o); };
  add({ kind: 'movie', title: 'A', status: 'done', rating: 9, genres: ['Thriller', 'Crime'], creator: 'D V', year: 2013, runtime: 120, pub: 8, finishedAt: '2026-03-01' });
  add({ kind: 'movie', title: 'B', status: 'done', rating: 3, genres: ['Comedy'], creator: 'X', year: 1999, runtime: 90, pub: 7, finishedAt: '2026-04-01' });
  add({ kind: 'movie', title: 'C', status: 'planned', genres: ['Thriller'], creator: 'D V', year: 2020, pub: 7.5 });
  add({ kind: 'movie', title: 'D', status: 'planned', genres: ['Comedy'], creator: 'Y', year: 2020, pub: 6 });
  const sc = L.screenStats(st, new Date('2026-06-01')), wl = L.watchlistRanking(st);
  assert.equal(sc.movies, 2); assert.equal(sc.hours, 4); assert.equal(sc.yearCount, 2); assert.equal(sc.hist[8], 1);
  assert.equal(wl[0].media.title, 'C'); assert.ok(!wl.some(x => x.media.title === 'D')); assert.equal(sc.overrated[0].title, 'B');
  console.log('  ✓ screen stats + watchlist ranking');
}

// all-kinds analysis: stats, feedback, year in review, filters
{
  let st = { media: {}, deleted: {} };
  const add = (o) => { st = L.addMedia(st, { status: 'done', ...o }); };
  add({ kind: 'book', title: 'B1', rating: 9, genres: ['Fantasy'], creator: 'Au', total: 300, finishedAt: '2026-02-01' });
  add({ kind: 'book', title: 'B2', rating: 8, genres: ['Fantasy', 'Epic'], creator: 'Au', total: 500, finishedAt: '2026-02-20' });
  add({ kind: 'manga', title: 'M1', rating: 9, genres: ['Action'], finishedAt: '2026-03-02' });
  add({ kind: 'game', title: 'G1', rating: 4, genres: ['RPG'], progress: 30, finishedAt: '2025-12-01' });
  add({ kind: 'movie', title: 'F1', rating: 8, genres: ['Drama'], runtime: 100, finishedAt: '2026-05-01' });
  add({ kind: 'movie', title: 'F2', rating: 7, genres: ['Drama'], runtime: 100, finishedAt: '2026-05-02' });
  const ys = L.yearReview(st, 2026), all = L.statsOf(st, null), bk = L.statsOf(st, ['book']);
  assert.equal(ys.n, 5); assert.equal(ys.pages, 800); assert.deepEqual(ys.per.map(x => x.kind.id).sort(), ['book', 'manga', 'movie']); assert.equal(ys.best[0].rating, 9);
  assert.equal(all.n, 6); assert.equal(bk.pages, 800); assert.equal(L.feedbackOf(st, null).length > 1, true);
  assert.equal(L.filterShelf(L.mediaList(st), { genre: 'Fantasy', sort: 'rating' }).map(m => m.title).join(), 'B1,B2');
  assert.equal(L.filterShelf(L.mediaList(st), { year: 2025 }).length, 1); assert.equal(L.filterShelf(L.mediaList(st), { min: 9 }).length, 2); assert.equal(L.filterShelf(L.mediaList(st), { q: 'f1' }).length, 1);
  assert.equal(L.statusWord('manga', 'done'), 'Read');
  console.log('  ✓ all-kinds stats, feedback, year in review, filters');
}

// Steam: XML + JSON, statuses, game stats
{
  const xml = '<?xml version="1.0"?><gamesList><games><game><appID>10</appID><name><![CDATA[Counter-Strike]]></name><hoursLast2Weeks>3.5</hoursLast2Weeks><hoursOnRecord>1,234.5</hoursOnRecord></game><game><appID>20</appID><name><![CDATA[Portal 2]]></name><hoursOnRecord>12.0</hoursOnRecord></game><game><appID>30</appID><name><![CDATA[Tried It]]></name><hoursOnRecord>0.4</hoursOnRecord></game><game><appID>40</appID><name><![CDATA[Never Opened]]></name></game></games></gamesList>';
  const r = L.parseSteam(xml), by = Object.fromEntries(r.items.map(x => [x.title, x]));
  assert.equal(r.items.length, 4); assert.equal(by['Counter-Strike'].minutes, 74070); assert.equal(by['Counter-Strike'].status, 'doing'); assert.equal(by['Portal 2'].status, 'done'); assert.equal(by['Tried It'].status, 'dropped'); assert.equal(by['Never Opened'].status, 'planned');
  assert.ok(by['Portal 2'].cover.includes('/apps/20/')); assert.ok(L.parseSteam('<profile>private</profile>').error);
  const j = L.parseSteam(JSON.stringify({ response: { games: [{ appid: 7, name: 'Hades', playtime_forever: 600, rtime_last_played: 1760000000 }] } })); assert.equal(j.items[0].status, 'done'); assert.equal(j.items[0].finishedAt, '2025-10-09');
  const st = L.upsertMany({ media: {}, deleted: {} }, r.items).state, g = L.gameStats(st, new Date('2026-06-01'));
  assert.equal(g.n, 4); assert.equal(g.played, 3); assert.equal(g.never, 1); assert.equal(g.hours, 1247); assert.equal(g.top[0].title, 'Counter-Strike');
  assert.ok(L.steamListUrl('76561198000000000').includes('/profiles/')); assert.ok(L.steamListUrl('gabe').includes('/id/gabe/'));
  console.log('  ✓ steam xml/json parsing, statuses, game stats');
}

// undated imports stay undated; old "today" stamps are repaired
{
  const csv = 'Book Id,Title,Author,My Rating,Exclusive Shelf,Date Read,Number of Pages\n1,Alice,Carroll,4,read,,200\n2,Dune,Herbert,5,read,2019/03/15,600';
  let s = L.upsertMany({ media: {}, deleted: {} }, L.parseExport(csv).items).state; const by = (t) => Object.values(s.media).find(m => m.title === t);
  assert.equal(by('Alice').finishedAt, ''); assert.equal(by('Dune').finishedAt, '2019-03-15');
  const today = new Date().toLocaleDateString('en-CA'); s = { ...s, media: { ...s.media, [by('Alice').id]: { ...by('Alice'), finishedAt: today, createdAt: Date.now() } } };
  const r = L.repairDates(s); assert.equal(r.fixed, 1); assert.equal(Object.values(r.state.media).find(m => m.title === 'Alice').finishedAt, ''); assert.equal(Object.values(r.state.media).find(m => m.title === 'Dune').finishedAt, '2019-03-15');
  assert.equal(L.addMedia({ media: {}, deleted: {} }, { kind: 'book', title: 'Manual', status: 'done' }).media && Object.values(L.addMedia({ media: {}, deleted: {} }, { kind: 'book', title: 'Manual', status: 'done' }).media)[0].finishedAt, today);
  console.log('  ✓ undated imports stay undated, old today-stamps repaired');
}

// list types: watched / watchlist / dropped, did-not-finish, sync
{
  const hdr = 'Const,Title,Title Type,Year,Genres,Directors,Created';
  const lst = (rows) => [hdr, ...rows].join('\n'), row = (id, t, ty = 'Film') => `tt${id},"${t}",${ty},2020,"Drama","X",2025-01-01`;
  const watch = L.parseExport(lst([row(1, 'W1'), row(2, 'W2', 'Fernsehserie')]), { mode: 'planned' }), drop = L.parseExport(lst([row(2, 'W2', 'Fernsehserie'), row(3, 'D1')]), { mode: 'dropped' });
  assert.deepEqual(watch.items.map(i => i.status), ['planned', 'planned']); assert.deepEqual(drop.items.map(i => i.status), ['dropped', 'dropped']); assert.ok(watch.items.every(i => !i.finishedAt));
  assert.equal(L.parseExport(lst([row(5, 'U')]), { mode: 'done' }).items[0].status, 'done'); assert.equal(L.parseExport(lst([row(5, 'U')])).items[0].status, 'planned');
  let s = L.upsertMany({ media: {}, deleted: {} }, watch.items).state; s = L.upsertMany(s, drop.items, { dropped: true }).state; const by = (t) => Object.values(s.media).find(m => m.title === t);
  assert.equal(by('W1').status, 'planned'); assert.equal(by('W2').status, 'dropped'); assert.equal(by('W2').kind, 'show'); assert.equal(by('D1').status, 'dropped');
  const rated = L.parseExport('Const,Your Rating,Date Rated,Title,Title Type,Year,Genres,Directors\ntt1,8,2024-05-05,W1,Film,2020,Drama,X'); s = L.upsertMany(s, rated.items).state; assert.equal(by('W1').status, 'done'); assert.equal(by('W1').finishedAt, '2024-05-05');
  s = L.upsertMany(s, drop.items.slice(1), { dropped: true }).state; assert.equal(by('W1').status, 'done', 'dropped list never demotes a rated film');
  const gr = L.parseExport('Book Id,Title,Author,My Rating,Exclusive Shelf,Date Read,Number of Pages\n1,A,x,0,did-not-finish,,10\n2,B,x,0,currently-reading,,10\n3,C,x,0,to-read,,10'); assert.deepEqual(gr.items.map(i => i.status), ['dropped', 'doing', 'planned']);
  let g = L.upsertMany({ media: {}, deleted: {} }, [{ ...gr.items[1], status: 'done', finishedAt: '2026-11-07' }]).state; g = L.upsertMany(g, [gr.items[1]], { sync: true }).state; assert.equal(Object.values(g.media)[0].status, 'doing'); assert.equal(Object.values(g.media)[0].finishedAt, '');
  const sm = L.summariseImport(rated.items); assert.deepEqual([sm.n, sm.done, sm.from], [1, 1, '2024-05-05']);
  console.log('  ✓ imdb list types, did-not-finish, sync correction, preview summary');
}

// original titles + English in brackets
await (async () => {
  try {
    const hdr = 'Const,Your Rating,Date Rated,Title,Original Title,Title Type,Year,Genres,Directors';
    const csv = [hdr, 'tt1,8,2024-01-02,"Die Frau die singt - Incendies","Incendies",Film,2010,Drama,X', 'tt2,7,2024-01-02,"Gefangen","Prisoners",Film,2013,Drama,X', 'tt3,9,2024-01-02,"Parasit","Gisaengchung",Film,2019,Drama,X'].join('\n');
    const r = L.parseExport(csv); assert.deepEqual(r.items.map(i => i.title), ['Incendies', 'Prisoners', 'Gisaengchung']); assert.equal(r.items[0].alt, 'Die Frau die singt - Incendies');
    let s = L.upsertMany({ media: {}, deleted: {} }, r.items).state; assert.equal(L.needsEnglish(s).length, 3);
    const realFetch = globalThis.fetch; globalThis.fetch = async (url) => { const ids = [...decodeURIComponent(url).matchAll(/"(tt\d+)"/g)].map(m => m[1]); const lab = { tt1: 'Incendies', tt2: 'Prisoners', tt3: 'Parasite' }; return { ok: true, json: async () => ({ results: { bindings: ids.filter(i => lab[i]).map(i => ({ id: { value: i }, l: { value: lab[i] } })) } }) }; };
    const fetched = await L.fetchEnglishTitles(L.needsEnglish(s).map(m => m.extId)); globalThis.fetch = realFetch;
    const res = L.applyEnglish(s, fetched);
    const by = (t) => Object.values(res.state.media).find(m => m.orig === t); assert.equal(res.named, 1); assert.equal(by('Gisaengchung').title, 'Gisaengchung (Parasite)'); assert.equal(by('Incendies').title, 'Incendies'); assert.equal(by('Prisoners').title, 'Prisoners'); assert.equal(L.needsEnglish(res.state).length, 0);
    const again = L.upsertMany(res.state, L.parseExport(csv).items, { sync: true }).state; assert.equal(Object.values(again.media).find(m => m.orig === 'Gisaengchung').title, 'Gisaengchung (Parasite)', 're-import keeps the bracket');
    const old = L.upsertMany({ media: {}, deleted: {} }, [{ kind: 'movie', title: 'Gefangen', src: 'imdb', extId: 'tt2', status: 'done', rating: 7, finishedAt: '2024-01-02' }]).state; const fixed = L.upsertMany(old, r.items.slice(1, 2), { sync: true }).state; assert.equal(Object.values(fixed.media)[0].title, 'Prisoners', 'sync replaces the old German title');
    console.log('  ✓ original titles with English in brackets (Wikidata, mocked)');
  } catch (e) { fails++; console.log('  ✗ original titles', e.message); }
})();

await Promise.all(pend); console.log(fails ? `\n${fails} failed` : '\nlibrary logic ok'); process.exit(fails ? 1 : 0);