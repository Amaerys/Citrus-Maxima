// Library: what you watch, read and play — records, imports (Goodreads / IMDb CSV, AniList, Steam), suggestions, notes.
// Records are maps id → {…, at} like the rest of Mind, so devices merge key by key and deletions leave tombstones.
import { keyOf, fromKey, addDays, startOfDay, uid, safeUrl } from './util.js';

const rec = (o) => Object.values(o || {});
export const KINDS = [
  { id: 'anime', name: 'Anime', emoji: '🍥', color: '#ff8fa3', unit: 'ep' },
  { id: 'show', name: 'Shows', emoji: '📺', color: '#8e9bff', unit: 'ep' },
  { id: 'movie', name: 'Movies', emoji: '🎬', color: '#ffc857', unit: '' },
  { id: 'manga', name: 'Comics & manga', emoji: '🗯', color: '#c98bff', unit: 'ch' },
  { id: 'book', name: 'Books', emoji: '📚', color: '#5fd38d', unit: 'p' },
  { id: 'game', name: 'Games', emoji: '🎮', color: '#4fb3ff', unit: 'h' },
];
const READ = (k) => k === 'book' || k === 'manga';
export const kindOf = (id) => KINDS.find(k => k.id === id) || KINDS[0];
export const STATUS = { planned: 'Plan to', doing: 'In progress', done: 'Finished', paused: 'Paused', dropped: 'Dropped' };
export const statusWord = (kind, st) => ({ planned: READ(kind) ? 'Want to read' : kind === 'game' ? 'Backlog' : 'Plan to watch', doing: READ(kind) ? 'Reading' : kind === 'game' ? 'Playing' : 'Watching', done: READ(kind) ? 'Read' : kind === 'game' ? 'Played' : 'Watched', paused: 'Paused', dropped: 'Dropped' }[st]);
const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ───────────────────────────── records
export function addMedia(s, f) {
  const title = String(f.title || '').trim().slice(0, 140); if (!title) return s;
  const kind = KINDS.some(k => k.id === f.kind) ? f.kind : 'book', now = Date.now(), id = f.id || uid();
  const m = { id, kind, title, status: STATUS[f.status] ? f.status : 'planned', rating: Math.max(0, Math.min(10, +f.rating || 0)), progress: Math.max(0, +f.progress || 0), total: Math.max(0, +f.total || 0),
    year: +f.year || 0, creator: String(f.creator || '').slice(0, 80), genres: (f.genres || []).map(g => String(g).slice(0, 30)).slice(0, 6), cover: f.cover ? safeUrl(f.cover) : '', src: f.src || 'manual', extId: f.extId ? String(f.extId) : '',
    format: ['paper', 'ebook', 'audio'].includes(f.format) ? f.format : '', log: Array.isArray(f.log) ? f.log.slice(-400) : [], quotes: Array.isArray(f.quotes) ? f.quotes.slice(-100) : [], startedAt: f.startedAt || '', finishedAt: f.finishedAt || '', minutes: Math.max(0, +f.minutes || 0), review: String(f.review || '').slice(0, 800), runtime: Math.max(0, Math.min(900, +f.runtime || 0)), pub: Math.max(0, Math.min(10, +f.pub || 0)), createdAt: f.createdAt || now, at: now };
  if (m.status === 'done' && !m.finishedAt) m.finishedAt = keyOf(new Date());
  return { ...s, media: { ...s.media, [id]: m } };
}
export function updateMedia(s, id, patch) {
  const m = s.media?.[id]; if (!m) return s; const n = { ...m, ...patch, at: Date.now() };
  if (patch.status === 'done' && !n.finishedAt) n.finishedAt = keyOf(new Date());
  if (patch.status === 'done' && n.total && !patch.progress) n.progress = n.total;
  if (patch.status === 'doing' && !n.startedAt) n.startedAt = keyOf(new Date());
  return { ...s, media: { ...s.media, [id]: n } };
}
export function deleteMedia(s, id) { const media = { ...s.media }; delete media[id]; return { ...s, media, deleted: { ...(s.deleted || {}), [`media:${id}`]: Date.now() } }; }
export const mediaList = (s, kind = '') => rec(s.media).filter(m => !kind || m.kind === kind);
export function findMedia(s, { kind, title, year, src, extId }) {
  const nt = norm(title);
  return rec(s.media).find(m => (extId && m.src === src && m.extId === String(extId)) || (m.kind === kind && norm(m.title) === nt && (!year || !m.year || m.year === year)));
}
/** Add or fill in: your own rating/status are never overwritten by an import unless the record has none. */
export function upsertMedia(s, f) {
  const cur = findMedia(s, f); if (!cur) return { state: addMedia(s, f), added: 1 };
  const patch = {};
  if (!cur.rating && f.rating) patch.rating = f.rating; if (!cur.total && f.total) patch.total = f.total; if (!cur.creator && f.creator) patch.creator = f.creator;
  if (!cur.extId && f.extId) { patch.extId = String(f.extId); patch.src = f.src; } if (!cur.cover && f.cover) patch.cover = safeUrl(f.cover) || undefined;
  if (!cur.genres?.length && f.genres?.length) patch.genres = f.genres; if (!cur.finishedAt && f.finishedAt) patch.finishedAt = f.finishedAt;
  if (f.minutes && f.minutes > (cur.minutes || 0)) patch.minutes = f.minutes;
  if (!cur.runtime && f.runtime) patch.runtime = f.runtime; if (!cur.pub && f.pub) patch.pub = f.pub;
  if (f.progress && f.progress > (cur.progress || 0)) patch.progress = f.progress;
  if (cur.status === 'planned' && f.status && f.status !== 'planned') patch.status = f.status;
  return Object.keys(patch).length ? { state: updateMedia(s, cur.id, patch), added: 0, updated: 1 } : { state: s, added: 0 };
}
export function upsertMany(s, list) { let st = s, added = 0, updated = 0; for (const f of list) { const r = upsertMedia(st, f); st = r.state; added += r.added || 0; updated += r.updated || 0; } return { state: st, added, updated, skipped: list.length - added - updated }; }


// ───────────────────────────── reading log: sessions, pace, finish estimates, highlights
export function logReading(s, id, { pages = 0, minutes = 0, date = '', pageNow = null } = {}) {
  const b = s.media?.[id]; if (!b) return { state: s, finished: false };
  const d = date || keyOf(new Date()), before = b.progress || 0;
  let read = Math.max(0, Math.round(+pages || 0)); if (pageNow != null && pageNow !== '') read = Math.max(0, Math.round(+pageNow) - before);
  const unit = b.kind === 'book' ? read : 0, mins = Math.max(0, Math.min(1440, Math.round(+minutes || 0)));
  if (!read && !mins) return { state: s, finished: false };
  const progress = b.total ? Math.min(b.total, before + read) : before + read, finished = !!b.total && progress >= b.total;
  const log = [...(b.log || []), { d, p: read, m: mins }].slice(-400);
  const st = updateMedia(s, id, { log, progress, status: finished ? 'done' : 'doing', ...(b.format === 'audio' && mins ? {} : {}) });
  return { state: st, finished, unit };
}
export const sessionsOf = (s) => rec(s.media).flatMap(m => (m.log || []).map(x => ({ ...x, id: m.id })));
export const readToday = (s, key) => rec(s.media).some(m => (m.log || []).some(x => x.d === key));
export function readingStats(s, now = new Date()) {
  const y = String(now.getFullYear()), all = sessionsOf(s), yr = all.filter(x => x.d.startsWith(y)), days = new Set(all.map(x => x.d));
  let streak = 0, d = startOfDay(now); if (!days.has(keyOf(d))) d = addDays(d, -1); while (days.has(keyOf(d))) { streak++; d = addDays(d, -1); }
  const from = keyOf(addDays(startOfDay(now), -13)), last14 = all.filter(x => x.d >= from);
  const pace = last14.length ? last14.reduce((a, x) => a + x.p, 0) / 14 : 0, mpace = last14.length ? last14.reduce((a, x) => a + x.m, 0) / 14 : 0;
  const done = rec(s.media).filter(m => m.kind === 'book' && m.status === 'done' && (m.finishedAt || '').startsWith(y));
  const goal = s.mediaMeta?.goals?.book || 0, doy = Math.floor((startOfDay(now) - new Date(now.getFullYear(), 0, 0)) / 86400000), expected = goal ? goal * doy / 365 : 0;
  const authors = {}, genres = {}; for (const m of done) { if (m.creator) authors[m.creator] = (authors[m.creator] || 0) + 1; for (const g of m.genres || []) { const k = lc(g); if (k && !BROAD.test(k)) genres[k] = (genres[k] || 0) + 1; } }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const span = done.filter(m => m.startedAt && m.finishedAt).map(m => Math.max(1, Math.round((fromKey(m.finishedAt) - fromKey(m.startedAt)) / 86400000) + 1));
  return { pagesYear: done.reduce((a, m) => a + (m.total || 0), 0) || yr.reduce((a, x) => a + x.p, 0), loggedPages: yr.reduce((a, x) => a + x.p, 0), minutesYear: yr.reduce((a, x) => a + x.m, 0), streak, pace, mpace, readToday: days.has(keyOf(now)),
    booksYear: done.length, goal, expected, ahead: goal ? done.length - expected : null, authors: top(authors), genres: top(genres), avgDays: span.length ? Math.round(span.reduce((a, x) => a + x, 0) / span.length) : null,
    longest: done.filter(m => m.total).sort((a, b) => b.total - a.total)[0] || null, shortest: done.filter(m => m.total).sort((a, b) => a.total - b.total)[0] || null,
    weekPages: Array.from({ length: 7 }, (_, i) => { const k = keyOf(addDays(startOfDay(now), i - 6)); return { k, p: all.filter(x => x.d === k).reduce((a, x) => a + x.p, 0) }; }) };
}
/** Date you'd finish at your recent pace (or 20 pages a day when there is no history). */
export function finishEta(s, b, now = new Date()) {
  if (b.kind !== 'book' || !b.total || b.status !== 'doing') return null;
  const left = b.total - (b.progress || 0); if (left <= 0) return null;
  const mine = (b.log || []).filter(x => x.d >= keyOf(addDays(startOfDay(now), -13))), pace = mine.length ? mine.reduce((a, x) => a + x.p, 0) / 14 : readingStats(s, now).pace || 20;
  const days = Math.max(1, Math.ceil(left / Math.max(3, pace))); return { days, date: keyOf(addDays(startOfDay(now), days)), left, pace: Math.round(pace) };
}
export function addQuote(s, id, { text, page = 0 }) { const b = s.media?.[id], t = String(text || '').trim().slice(0, 600); return b && t ? updateMedia(s, id, { quotes: [...(b.quotes || []), { id: uid(), t, p: +page || 0, d: keyOf(new Date()) }].slice(-100) }) : s; }
export function removeQuote(s, id, qid) { const b = s.media?.[id]; return b ? updateMedia(s, id, { quotes: (b.quotes || []).filter(q => q.id !== qid) }) : s; }
export const allQuotes = (s) => rec(s.media).flatMap(m => (m.quotes || []).map(q => ({ ...q, book: m.title, author: m.creator, bookId: m.id }))).sort((a, b) => b.d.localeCompare(a.d));

// ───────────────────────────── stats
export function libraryStats(s, now = new Date()) {
  const y = String(now.getFullYear()), all = rec(s.media), done = all.filter(m => m.status === 'done'), thisYear = done.filter(m => (m.finishedAt || '').startsWith(y));
  const rated = done.filter(m => m.rating);
  const dist = Array.from({ length: 10 }, (_, i) => rated.filter(m => m.rating === i + 1).length);
  const byKind = Object.fromEntries(KINDS.map(k => [k.id, { doing: all.filter(m => m.kind === k.id && m.status === 'doing').length, planned: all.filter(m => m.kind === k.id && m.status === 'planned').length, done: done.filter(m => m.kind === k.id).length, year: thisYear.filter(m => m.kind === k.id).length }]));
  const months = Array.from({ length: 12 }, (_, i) => thisYear.filter(m => +m.finishedAt.slice(5, 7) === i + 1).length);
  return { total: all.length, doneYear: thisYear.length, avg: rated.length ? rated.reduce((a, m) => a + m.rating, 0) / rated.length : null, dist, byKind, months, hours: Math.round(all.reduce((a, m) => a + (m.kind === 'game' ? m.minutes || 0 : 0), 0) / 60), goal: s.mediaMeta?.goals || {} };
}
export const nowPlaying = (s) => rec(s.media).filter(m => m.status === 'doing').sort((a, b) => b.at - a.at);
export function setMeta(s, patch) { return { ...s, mediaMeta: { ...(s.mediaMeta || {}), ...patch, at: Date.now() } }; }
export function setGoal(s, kind, n) { return setMeta(s, { goals: { ...(s.mediaMeta?.goals || {}), [kind]: Math.max(0, +n || 0) } }); }

// ───────────────────────────── notes (memos)
export function addMemo(s, f) { const id = f.id || uid(), now = Date.now(); return { ...s, memos: { ...s.memos, [id]: { id, title: String(f.title || '').trim().slice(0, 100), body: String(f.body || '').slice(0, 20000), tags: parseTags(f.tags), pinned: !!f.pinned, createdAt: f.createdAt || now, at: now } } }; }
export function updateMemo(s, id, patch) { const m = s.memos?.[id]; return m ? { ...s, memos: { ...s.memos, [id]: { ...m, ...patch, ...(patch.tags != null ? { tags: parseTags(patch.tags) } : {}), at: Date.now() } } } : s; }
export function deleteMemo(s, id) { const memos = { ...s.memos }; delete memos[id]; return { ...s, memos, deleted: { ...(s.deleted || {}), [`memo:${id}`]: Date.now() } }; }
export const parseTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(/[,#\s]+/)).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
export function memoList(s, { q = '', tag = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return rec(s.memos).filter(m => (!tag || m.tags.includes(tag)) && (!needle || `${m.title} ${m.body} ${m.tags.join(' ')}`.toLowerCase().includes(needle))).sort((a, b) => (b.pinned - a.pinned) || b.at - a.at);
}
export const memoTags = (s) => { const c = {}; for (const m of rec(s.memos)) for (const t of m.tags) c[t] = (c[t] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t]) => t); };

// ───────────────────────────── CSV (Goodreads / IMDb exports)
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false; const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else cur += c;
  }
  row.push(cur); if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(x => x.trim()); return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const dateKeyOf = (v) => { const m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(v || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
const unExcel = (v) => String(v || '').replace(/^="?|"$/g, '');
/** Detects which export it is by its columns. Returns {source, items} or {error}. */
const DE_GENRE = { Krimi: 'Crime', Kriegsfilm: 'War', Familienfilm: 'Family', Abenteuer: 'Adventure', Komödie: 'Comedy', Liebesfilm: 'Romance', Dokumentarfilm: 'Documentary', Biografie: 'Biography', Geschichte: 'History', Historienfilm: 'History', Musikfilm: 'Music', Sport: 'Sport', Sportfilm: 'Sport', Western: 'Western', Zeichentrick: 'Animation', Kurzfilm: 'Short', Fantasy: 'Fantasy', Science: 'Sci-Fi', 'Sci-Fi': 'Sci-Fi', Musical: 'Musical', Mystery: 'Mystery', Horror: 'Horror', Thriller: 'Thriller', Drama: 'Drama', Animation: 'Animation', Action: 'Action', Reality: 'Reality', Talkshow: 'Talk-Show', Nachrichten: 'News' };
export function parseExport(text) {
  const rows = parseCSV(text); if (!rows.length) return { error: 'That file has no rows.' };
  const cols = Object.keys(rows[0]);
  if (cols.includes('Exclusive Shelf') && cols.includes('Title')) {
    const items = rows.filter(r => r.Title).map(r => {
      const shelf = r['Exclusive Shelf'], rating = +r['My Rating'] || 0, isbn = unExcel(r.ISBN13 || r.ISBN);
      return { kind: 'book', title: r.Title.replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, ''), creator: r.Author, year: +r['Original Publication Year'] || +r['Year Published'] || 0, total: +r['Number of Pages'] || 0,
        genres: (r.Bookshelves || '').split(',').map(x => x.trim()).filter(x => x && !/^(to-read|read|currently-reading)$/.test(x)).slice(0, 8), status: shelf === 'read' ? 'done' : shelf === 'currently-reading' ? 'doing' : shelf === 'to-read' ? 'planned' : 'planned', rating: rating * 2, finishedAt: dateKeyOf(r['Date Read']), review: r['My Review'] || '', src: 'goodreads', extId: r['Book Id'] || isbn };
    });
    return { source: 'Goodreads', items };
  }
  if (cols.includes('Const') && cols.includes('Title Type')) {
    const items = rows.filter(r => r.Title && !/episode|episode|video ?game|videospiel|podcast/i.test(r['Title Type'])).map(r => {
      const rated = +r['Your Rating'] || 0, type = r['Title Type'];
      return { kind: /serie|mini/i.test(type) ? 'show' : 'movie', title: r.Title, creator: r.Directors || r.Creators || '', year: +r.Year || 0, genres: (r.Genres || '').split(',').map(x => x.trim()).filter(Boolean).map(g => DE_GENRE[g] || g),
        status: rated ? 'done' : 'planned', rating: rated, finishedAt: dateKeyOf(r['Date Rated']), src: 'imdb', extId: r.Const, runtime: +r['Runtime (mins)'] || 0, pub: +r['IMDb Rating'] || 0 };
    });
    return { source: 'IMDb', items };
  }
  return { error: 'Not recognised. Use the Goodreads library export (My Books → Import and export) or an IMDb ratings/watchlist export.' };
}

// ───────────────────────────── AniList (public GraphQL, CORS-enabled, no key)
const ANI = 'https://graphql.anilist.co';
async function anilist(query, variables) {
  const r = await fetch(ANI, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({})); if (j.errors?.length) throw new Error(j.errors[0].message === 'Private User' ? 'That AniList profile is private' : j.errors[0].message || 'AniList error'); if (!r.ok) throw new Error(`AniList ${r.status}`);
  return j.data;
}
const ST = { COMPLETED: 'done', CURRENT: 'doing', REPEATING: 'doing', PLANNING: 'planned', PAUSED: 'paused', DROPPED: 'dropped' };
const aniEntry = (e, kind) => { const c = e.completedAt || {}, m = e.media;
  return { kind, title: m.title.english || m.title.romaji, year: m.seasonYear || m.startDate?.year || 0, total: (kind === 'manga' ? m.chapters || m.volumes : m.episodes) || 0, progress: e.progress || 0, genres: m.genres || [], cover: m.coverImage?.medium || '',
    status: ST[e.status] || 'planned', rating: e.score ? Math.round(e.score / 10) : 0, finishedAt: c.year ? `${c.year}-${String(c.month || 1).padStart(2, '0')}-${String(c.day || 1).padStart(2, '0')}` : '', src: 'anilist', extId: m.id, creator: '' }; };
export async function fetchAniList(user) {
  const out = []; let firstErr = null;
  for (const [type, kind] of [['ANIME', 'anime'], ['MANGA', 'manga']]) {
    try {
      const d = await anilist(`query($u:String){MediaListCollection(userName:$u,type:${type}){lists{entries{status score(format:POINT_100) progress completedAt{year month day} media{id title{romaji english} episodes chapters volumes seasonYear startDate{year} genres coverImage{medium}}}}}}`, { u: user });
      for (const l of d.MediaListCollection?.lists || []) for (const e of l.entries || []) out.push(aniEntry(e, kind));
    } catch (e) { if (!firstErr) firstErr = e; if (type === 'ANIME') throw e; }
  }
  return out;
}
export async function searchAnime(q, kind = 'anime') {
  const d = await anilist(`query($q:String){Page(perPage:8){media(search:$q,type:${kind === 'manga' ? 'MANGA' : 'ANIME'},sort:SEARCH_MATCH){id title{romaji english} episodes chapters volumes seasonYear startDate{year} genres coverImage{medium}}}}`, { q });
  return (d.Page?.media || []).map(m => ({ kind, title: m.title.english || m.title.romaji, year: m.seasonYear || m.startDate?.year || 0, total: (kind === 'manga' ? m.chapters || m.volumes : m.episodes) || 0, genres: m.genres || [], cover: m.coverImage?.medium || '', src: 'anilist', extId: m.id }));
}
export async function animeSuggestions(s, dismissed = [], kind = 'anime') {
  const top = rec(s.media).filter(m => m.kind === kind && m.src === 'anilist' && m.extId && m.status === 'done' && m.rating >= 8).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const have = new Set(rec(s.media).filter(m => m.kind === kind).map(m => norm(m.title))), seen = new Set(), out = [];
  for (const m of top) {
    let d; try { d = await anilist(`query($id:Int){Media(id:$id){recommendations(perPage:6,sort:RATING_DESC){nodes{rating mediaRecommendation{id title{romaji english} episodes chapters volumes seasonYear startDate{year} genres coverImage{medium} averageScore}}}}}`, { id: +m.extId }); } catch { continue; }
    for (const n of d.Media?.recommendations?.nodes || []) {
      const r = n.mediaRecommendation; if (!r) continue; const title = r.title.english || r.title.romaji;
      if (have.has(norm(title)) || seen.has(r.id) || dismissed.includes(`anilist:${r.id}`)) continue; seen.add(r.id);
      out.push({ key: `anilist:${r.id}`, item: { kind, title, year: r.seasonYear || r.startDate?.year || 0, total: (kind === 'manga' ? r.chapters || r.volumes : r.episodes) || 0, genres: r.genres || [], cover: r.coverImage?.medium || '', src: 'anilist', extId: r.id, status: 'planned' }, reason: `Because you rated ${m.title} ${m.rating}/10`, score: r.averageScore ? `${r.averageScore}%` : '' });
    }
  }
  return out.slice(0, 12);
}

// ───────────────────────────── Open Library (CORS-enabled, no key)
const OL = 'https://openlibrary.org';
const olJson = async (path) => { const r = await fetch(`${OL}${path}`); if (!r.ok) throw new Error(`Open Library ${r.status}`); return r.json(); };
const olItem = (d) => ({ kind: 'book', title: d.title, creator: (d.author_name || [])[0] || '', year: d.first_publish_year || 0, total: d.number_of_pages_median || 0, genres: (d.subject || []).slice(0, 4), cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', src: 'openlibrary', extId: d.key || '' });
const OLF = 'key,title,author_name,author_key,first_publish_year,number_of_pages_median,cover_i,subject,ratings_average,ratings_count,want_to_read_count,edition_count';
const lc = (x) => String(x || '').toLowerCase().trim();
const olCand = (d) => ({ item: olItem(d), q: { avg: d.ratings_average || 0, n: d.ratings_count || 0, want: d.want_to_read_count || 0, subjects: (d.subject || []).map(lc) } });
const gbItem = (v) => { const i = v.volumeInfo || {}; return { kind: 'book', title: i.title || '', creator: (i.authors || [])[0] || '', year: +String(i.publishedDate || '').slice(0, 4) || 0, total: i.pageCount || 0, genres: (i.categories || []).slice(0, 4), cover: (i.imageLinks?.thumbnail || '').replace(/^http:/, 'https:'), src: 'googlebooks', extId: `gb:${v.id}` }; };
/** Whole-catalogue search: Open Library (tens of millions of works) plus Google Books, merged and de-duplicated. */
export async function searchBooks(q) {
  const [ol, gb] = await Promise.allSettled([
    olJson(`/search.json?q=${encodeURIComponent(q)}&limit=8&fields=${OLF}`).then(j => (j.docs || []).map(d => olCand(d).item)),
    fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books&fields=items(id,volumeInfo(title,authors,publishedDate,pageCount,categories,imageLinks/thumbnail))`).then(r => r.ok ? r.json() : { items: [] }).then(j => (j.items || []).map(gbItem)),
  ]);
  if (ol.status === 'rejected' && gb.status === 'rejected') throw new Error('Could not reach the book catalogues');
  const out = [], seen = new Set();
  for (const it of [...(ol.value || []), ...(gb.value || [])]) { const k = norm(it.title) + '|' + norm(it.creator.split(' ').pop()); if (!it.title || seen.has(k)) continue; seen.add(k); out.push(it); }
  return out.slice(0, 12);
}

// ───────────────────────────── taste: what your ratings and shelves say you like
const BROAD = /^(fiction|nonfiction|non-fiction|general|accessible book|protected daisy|in library|large type books|reading level|open library|new york times|english|american|literature|books and reading|lending library|history|novel|novels|read|to-read|currently-reading|favorites|favourites|owned|kindle|audiobook|ebook|books|wishlist|library|default|unread|dnf|re-read|reference)/i;
export function bookTaste(s, extra = {}) {
  const subj = {}, auth = {}, loved = [];
  for (const b of mediaList(s, 'book')) {
    const w = b.status === 'done' && b.rating ? (b.rating - 5.5) / 4.5 : b.status === 'doing' ? 0.25 : 0; if (!w) continue;
    if (w >= 0.5) loved.push(b);
    if (b.creator) auth[b.creator] = (auth[b.creator] || 0) + w;
    for (const g of [...(b.genres || []), ...(extra[norm(b.title)] || [])]) { const k = lc(g); if (!k || BROAD.test(k)) continue; subj[k] = (subj[k] || 0) + w; }
  }
  const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { subjects: rank(subj).filter(([, w]) => w > 0), avoid: rank(subj).filter(([, w]) => w < -0.4).map(([k]) => k), authors: rank(auth).filter(([, w]) => w > 0.5), loved: loved.sort((a, b) => b.rating - a.rating), weights: subj };
}
/** Your own to-read pile, ordered by how well each book fits your taste. Works offline — no catalogue needed. */
export function pileRanking(s, n = 10) {
  const t = bookTaste(s), A = Object.fromEntries(t.authors), W = t.weights, out = [];
  for (const b of mediaList(s, 'book')) {
    if (b.status !== 'planned') continue;
    const a = A[b.creator] || 0, gs = (b.genres || []).map(lc).filter(g => g && !BROAD.test(g)), g = gs.length ? gs.reduce((x, k) => x + (W[k] || 0), 0) / Math.sqrt(gs.length) : 0;
    const len = b.total ? (b.total <= 350 ? 0.25 : b.total > 700 ? -0.3 : 0) : 0, score = a * 1.6 + g + len;
    if (score <= 0) continue;
    const topG = gs.filter(k => (W[k] || 0) > 0).sort((x, y) => W[y] - W[x]).slice(0, 2);
    const reason = a > 0.5 ? `You rated ${b.creator} highly` : topG.length ? `Same shelves as books you loved: ${topG.join(', ')}` : 'Short and a good fit';
    out.push({ key: `pile:${b.id}`, media: b, reason, score });
  }
  const seen = new Set();   // two editions of the same book count once
  return out.sort((x, y) => y.score - x.score).filter(x => { const k = `${lc(x.media.creator)}|${norm(x.media.title).split(' ').slice(0, 3).join(' ')}`; return !seen.has(k) && seen.add(k); }).slice(0, n);
}
const subjCache = () => { try { return JSON.parse(localStorage.getItem('citrus.olsubj') || '{}'); } catch { return {}; } };
async function enrichSubjects(s, max = 8) {
  const cache = subjCache(); let fetched = 0;
  for (const b of bookTaste(s).loved) {
    const k = norm(b.title); if (cache[k] || fetched >= max) continue; fetched++;
    try { const j = await olJson(`/search.json?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.creator || '')}&limit=1&fields=subject`); cache[k] = (j.docs?.[0]?.subject || []).map(lc).filter(x => !BROAD.test(x)).slice(0, 14); } catch { cache[k] = []; }
  }
  if (fetched) try { localStorage.setItem('citrus.olsubj', JSON.stringify(cache)); } catch {}
  return cache;
}

// ───────────────────────────── explore the whole catalogue
export const EXPLORE = [
  ['fantasy', '🐉', 'Fantasy', 'fantasy'], ['scifi', '🚀', 'Science fiction', 'science fiction'], ['mystery', '🕵️', 'Mystery', 'mystery'], ['horror', '🕯', 'Horror', 'horror'], ['romance', '💞', 'Romance', 'romance'], ['historical', '🏛', 'Historical fiction', 'historical fiction'],
  ['literary', '✒️', 'Literary fiction', 'literary fiction'], ['classics', '📜', 'Classics', 'classics', '[* TO 1950]'], ['philosophy', '🧠', 'Philosophy', 'philosophy'], ['psychology', '🔍', 'Psychology', 'psychology'], ['science', '🔬', 'Science', 'popular science'], ['history', '🗺', 'History', 'world history'],
  ['biography', '🪪', 'Biography', 'biography'], ['medicine', '🩺', 'Medicine', 'medicine'], ['poetry', '🪶', 'Poetry', 'poetry'], ['short', '📖', 'Short stories', 'short stories'], ['essays', '📝', 'Essays', 'essays'], ['graphic', '🎨', 'Graphic novels', 'graphic novels'],
  ['russian', '🇷🇺', 'Russian', 'russian literature'], ['japanese', '🇯🇵', 'Japanese', 'japanese literature'], ['latam', '🌎', 'Latin American', 'latin american literature'], ['african', '🌍', 'African', 'african literature'], ['arabic', '🕌', 'Arabic', 'arabic literature'], ['french', '🇫🇷', 'French', 'french literature'],
  ['german', '🇩🇪', 'German', 'german literature'], ['indian', '🇮🇳', 'Indian', 'indian literature'], ['persian', '🏺', 'Persian', 'persian literature'], ['chinese', '🇨🇳', 'Chinese', 'chinese literature'], ['nordic', '❄️', 'Nordic', 'scandinavian literature'], ['korean', '🇰🇷', 'Korean', 'korean literature'], ['nobel', '🏅', 'Nobel laureates', 'nobel prize winners'],
];
async function topInSubject(subject, { before = '', limit = 24, minRatings = 20 } = {}) {
  const q = `subject:"${subject}"${before ? ` first_publish_year:${before}` : ''}`;
  const j = await olJson(`/search.json?q=${encodeURIComponent(q)}&sort=rating&limit=${limit}&fields=${OLF}`);
  return (j.docs || []).map(olCand).filter(c => c.q.n >= minRatings && c.q.avg >= 3.6);
}
export async function exploreCatalogue(id, s, dismissed = []) {
  const e = EXPLORE.find(x => x[0] === id); if (!e) return [];
  const have = new Set(mediaList(s, 'book').map(m => norm(m.title))), seen = new Set(), taste = bookTaste(s);
  return (await topInSubject(e[3], { before: e[4] || '' })).map(c => ({ ...c, score: quality(c.q) + tasteMatch(c.q, taste) * 0.5 })).sort((a, b) => b.score - a.score)
    .filter(c => !have.has(norm(c.item.title)) && !dismissed.includes(`ol:${c.item.extId}`) && !seen.has(c.item.extId) && seen.add(c.item.extId))
    .slice(0, 12).map(c => ({ key: `ol:${c.item.extId}`, item: { ...c.item, status: 'planned' }, reason: `Top rated in ${e[2]}`, score: c.q.avg ? `${c.q.avg.toFixed(1)}/5 · ${c.q.n.toLocaleString('en')} ratings` : '' }));
}
const quality = (q) => Math.max(0, Math.min(1, (q.avg - 3) / 2)) * Math.min(1, Math.log10(q.n + 1) / 3) * 0.7 + Math.min(1, Math.log10(q.want + 1) / 4) * 0.3;
const tasteMatch = (q, t) => Math.max(0, Math.min(1, q.subjects.reduce((x, k) => x + Math.max(0, t.weights[k] || 0), 0) / 3));
export const forYouSuggestions = (...a) => worldSuggestions(...a);
/** Lanes of recommendations drawn from the whole catalogue, each explained, scored by your taste × quality × popularity. */
export async function worldSuggestions(s, dismissed = []) {
  const extra = await enrichSubjects(s), taste = bookTaste(s, extra), have = new Set(mediaList(s, 'book').map(m => norm(m.title))), seen = new Set();
  const day = Math.floor(Date.now() / 86400000);
  const tasks = [];
  taste.authors.slice(0, 3).forEach(([a, w]) => tasks.push({ id: `a:${a}`, title: `More from ${a}`, run: async () => (await olJson(`/search.json?author=${encodeURIComponent(a)}&sort=rating&limit=10&fields=${OLF}`)).docs.map(olCand).filter(c => c.q.n >= 5) }));
  const subs = taste.subjects.map(([k]) => k).slice(0, 12);
  subs.slice(0, 3).forEach(k => tasks.push({ id: `s:${k}`, title: `Top rated in “${k}”`, run: () => topInSubject(k, { minRatings: 30 }) }));
  if (subs[0]) tasks.push({ id: 'classics', title: `Classics in “${subs[0]}”`, run: () => topInSubject(subs[0], { before: '[* TO 1965]', minRatings: 40 }) });
  subs.slice(3, 6).forEach(k => tasks.push({ id: `adj:${k}`, title: `Next door: “${k}”`, run: () => topInSubject(k, { minRatings: 25 }) }));
  const world = EXPLORE.filter(e => /literature$/.test(e[3])); for (let i = 0; i < 2; i++) { const e = world[(day * 2 + i) % world.length]; tasks.push({ id: `w:${e[0]}`, title: `Around the world: ${e[2]}`, run: () => topInSubject(e[3], { minRatings: 15 }) }); }
  const res = await Promise.allSettled(tasks.map(t => t.run())), lanes = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const items = r.value.map(c => ({ c, sc: quality(c.q) * 0.5 + tasteMatch(c.q, taste) * 0.5 })).sort((a, b) => b.sc - a.sc)
      .filter(({ c }) => c.item.title && !have.has(norm(c.item.title)) && !dismissed.includes(`ol:${c.item.extId}`) && !seen.has(c.item.extId) && !c.q.subjects.some(x => taste.avoid.includes(x)))
      .slice(0, 6).map(({ c }) => { seen.add(c.item.extId); return { key: `ol:${c.item.extId}`, item: { ...c.item, status: 'planned' }, reason: tasks[i].title, score: c.q.avg ? `${c.q.avg.toFixed(1)}/5 · ${c.q.n.toLocaleString('en')}` : '' }; });
    if (items.length) lanes.push({ id: tasks[i].id, title: tasks[i].title, items });
  });
  return { lanes, taste: { subjects: subs.slice(0, 6), authors: taste.authors.slice(0, 4).map(a => a[0]), based: taste.loved.length } };
}

// ───────────────────────────── Steam: the browser can't call Steam directly, so you paste what the API returns
export function steamUrl(key, id) { return `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}&include_appinfo=1&include_played_free_games=1&format=json`; }
export function parseSteam(text) {
  let j; try { j = JSON.parse(text); } catch { return { error: 'That is not JSON. Open the link, select everything on the page and paste it here.' }; }
  const games = j?.response?.games; if (!Array.isArray(games)) return { error: j?.response && !Object.keys(j.response).length ? 'Steam returned nothing — set your Game details to Public in Steam › Privacy.' : 'No games found in that.' };
  return { source: 'Steam', items: games.filter(g => g.name).map(g => ({ kind: 'game', title: g.name, minutes: g.playtime_forever || 0, status: g.playtime_forever > 0 ? 'doing' : 'planned', src: 'steam', extId: g.appid })) };
}

// ───────────────────────────── suggestions cache (this device only)
export function cacheGet(kind) { try { const c = JSON.parse(localStorage.getItem(`citrus.sugg.${kind}`) || 'null'); return c && Date.now() - c.at < 12 * 3600000 ? c.list : null; } catch { return null; } }
export function cacheSet(kind, list) { try { localStorage.setItem(`citrus.sugg.${kind}`, JSON.stringify({ at: Date.now(), list })); } catch {} }
export function cacheClear() { try { for (const k of KINDS) localStorage.removeItem(`citrus.sugg.${k.id}`); } catch {} }
export function dismissSuggestion(s, key) { return setMeta(s, { dismissed: [...new Set([...(s.mediaMeta?.dismissed || []), key])].slice(-300) }); }


// ───────────────────────────── analysis for every kind: stats, taste, ranking, feedback, year in review (all offline, from your own ratings)
const splitNames = (x) => String(x || '').split(',').map(v => v.trim()).filter(Boolean);
const countOf = (arr) => { const o = {}; arr.forEach(k => { if (k) o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
const listOf = (s, kinds) => rec(s.media).filter(m => !kinds || (Array.isArray(kinds) ? kinds : [kinds]).includes(m.kind));
const yearOf = (m) => (m.finishedAt || '').slice(0, 4);
/** Genres/makers (directors, authors, studios) you rate highly or poorly, weighted by how far each rating is from "meh". */
export function tasteOf(s, kinds) {
  const gen = {}, mk = {}, loved = [];
  for (const m of listOf(s, kinds)) {
    if (m.status !== 'done' || !m.rating) continue; const w = (m.rating - 5.5) / 4.5; if (w >= 0.5) loved.push(m);
    for (const g of m.genres || []) gen[g] = (gen[g] || 0) + w;
    for (const d of splitNames(m.creator)) mk[d] = (mk[d] || 0) + w;
  }
  const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { genres: rank(gen), makers: rank(mk).filter(([, w]) => w >= 1), genreW: gen, makerW: mk, loved: loved.sort((a, b) => b.rating - a.rating) };
}
export const screenTaste = (s) => tasteOf(s, ['movie', 'show']);
/** Everything the Insights card needs for a set of kinds (optionally one finish-year). */
export function statsOf(s, kinds, { year = '' } = {}, now = new Date()) {
  const all = listOf(s, kinds).filter(m => m.status === 'done'), done = year ? all.filter(m => yearOf(m) === String(year)) : all, rated = done.filter(m => m.rating);
  const hist = Array(10).fill(0); rated.forEach(m => hist[Math.min(9, m.rating - 1)]++);
  const gAvg = {}; rated.forEach(m => (m.genres || []).forEach(g => { (gAvg[g] ||= []).push(m.rating); }));
  const genreAvg = Object.entries(gAvg).filter(([, a]) => a.length >= 3).map(([g, a]) => [g, a.reduce((x, y) => x + y, 0) / a.length, a.length]).sort((a, b) => b[1] - a[1]);
  const mins = done.reduce((t, m) => t + (m.kind === 'movie' ? m.runtime || 0 : m.kind === 'book' ? m.minutes || 0 : m.kind === 'game' ? (m.progress || 0) * 60 : 0), 0);
  const vs = rated.filter(m => m.pub), gap = vs.length ? vs.reduce((t, m) => t + (m.rating - m.pub), 0) / vs.length : null, hot = vs.map(m => ({ m, d: m.rating - m.pub })).sort((a, b) => b.d - a.d);
  const yr = String(year || now.getFullYear()), inYear = all.filter(m => yearOf(m) === yr);
  return { n: done.length, byKind: Object.fromEntries(KINDS.map(k => [k.id, done.filter(m => m.kind === k.id).length])), avg: rated.length ? rated.reduce((t, m) => t + m.rating, 0) / rated.length : null, ratedN: rated.length, hist,
    months: Array.from({ length: 12 }, (_, i) => inYear.filter(m => +m.finishedAt.slice(5, 7) === i + 1).length), years: countOf(all.map(yearOf)).sort((a, b) => a[0].localeCompare(b[0])), hours: Math.round(mins / 60),
    pages: done.filter(m => m.kind === 'book').reduce((t, m) => t + (m.total || 0), 0), genres: countOf(done.flatMap(m => m.genres || [])).slice(0, 10), genreAvg, makers: countOf(done.flatMap(m => splitNames(m.creator))).filter(([, n]) => n > 1).slice(0, 8),
    decades: countOf(done.filter(m => m.year).map(m => `${Math.floor(m.year / 10) * 10}s`)).sort((a, b) => a[0].localeCompare(b[0])), gap, overrated: hot.slice(-3).reverse().filter(x => x.d <= -2).map(x => x.m), underrated: hot.slice(0, 3).filter(x => x.d >= 2).map(x => x.m),
    top: rated.slice().sort((a, b) => b.rating - a.rating || (b.finishedAt || '').localeCompare(a.finishedAt || '')).slice(0, 8), worst: rated.filter(m => m.rating <= 4).sort((a, b) => a.rating - b.rating).slice(0, 4) };
}
export const screenStats = (s, now = new Date()) => { const t = statsOf(s, ['movie', 'show'], {}, now); return { ...t, movies: t.byKind.movie, shows: t.byKind.show, yearCount: t.months.reduce((a, b) => a + b, 0) }; };
/** Plain-language read-outs of your taste: patterns, not just numbers. */
export function feedbackOf(s, kinds, now = new Date()) {
  const st = statsOf(s, kinds, {}, now), out = []; if (st.ratedN < 5) return ['Rate five or more finished items and Citrus will start telling you what it notices.'];
  const harsh = st.hist.slice(0, 5).reduce((a, b) => a + b, 0) / st.ratedN, kind = st.hist.slice(7).reduce((a, b) => a + b, 0) / st.ratedN;
  out.push(kind > 0.55 ? `You’re a generous rater: ${Math.round(kind * 100)}% of your ratings are 8 or higher, so a 10 from you says less than a 7 from a tough critic.` : harsh > 0.4 ? `You’re a tough critic: ${Math.round(harsh * 100)}% of your ratings are 5 or lower.` : `Your ratings are balanced, with an average of ${st.avg.toFixed(1)}.`);
  if (st.genreAvg.length > 1) { const hi = st.genreAvg[0], lo = st.genreAvg[st.genreAvg.length - 1]; out.push(`${hi[0]} is where you’re happiest (avg ${hi[1].toFixed(1)} over ${hi[2]}).${hi[1] - lo[1] >= 1 ? ` ${lo[0]} lets you down most (avg ${lo[1].toFixed(1)}).` : ''}`); }
  if (st.genres[0] && st.n > 20 && st.genres[0][1] / st.n > 0.5) out.push(`${Math.round(st.genres[0][1] / st.n * 100)}% of what you finish is ${st.genres[0][0]}. Something far outside it might surprise you.`);
  if (st.gap != null && Math.abs(st.gap) >= 0.4) out.push(st.gap > 0 ? `You rate ${st.gap.toFixed(1)} points above the public score on average.` : `You rate ${(-st.gap).toFixed(1)} points below the public score on average.`);
  const t = tasteOf(s, kinds); if (t.makers.length) out.push(`Names you keep coming back to and rating well: ${t.makers.slice(0, 3).map(([n]) => n).join(', ')}.`);
  const yrs = st.years.filter(([y]) => y), best = yrs.slice().sort((a, b) => b[1] - a[1])[0]; if (best && yrs.length > 1) out.push(`${best[0]} was your biggest year so far, with ${best[1]} finished.`);
  return out;
}
/** Your own backlog, ordered by fit: genres and makers you rated highly, nudged by the public score. */
export function rankPlanned(s, kinds, n = 10) {
  const t = tasteOf(s, kinds), out = [];
  for (const m of listOf(s, kinds)) {
    if (m.status !== 'planned') continue;
    const gs = m.genres || [], g = gs.length ? gs.reduce((x, k) => x + (t.genreW[k] || 0), 0) / Math.sqrt(gs.length) : 0;
    const d = splitNames(m.creator).reduce((x, k) => x + Math.max(0, t.makerW[k] || 0), 0), q = m.pub ? (m.pub - 6.5) / 3 : 0, score = g + d * 0.6 + q;
    if (score <= 0) continue;
    const topG = gs.filter(k => (t.genreW[k] || 0) > 0).sort((a, b) => t.genreW[b] - t.genreW[a]).slice(0, 2), dd = splitNames(m.creator).find(k => (t.makerW[k] || 0) >= 1);
    out.push({ key: `watch:${m.id}`, media: m, score, reason: dd ? `You rated ${dd} highly` : topG.length ? `Matches what you love: ${topG.join(', ')}` : 'Well rated by others' });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}
export const watchlistRanking = (s, n = 10) => rankPlanned(s, ['movie', 'show'], n);
/** Year in review across everything: totals per kind, highs and lows, busiest month, taste of the year. */
export function yearReview(s, year, now = new Date()) {
  const y = String(year), done = rec(s.media).filter(m => m.status === 'done' && yearOf(m) === y), rated = done.filter(m => m.rating), st = statsOf(s, null, { year: y }, now);
  const best = rated.slice().sort((a, b) => b.rating - a.rating || (b.finishedAt || '').localeCompare(a.finishedAt || ''));
  const per = KINDS.map(k => { const l = done.filter(m => m.kind === k.id), r = l.filter(m => m.rating); return { kind: k, n: l.length, avg: r.length ? r.reduce((t, m) => t + m.rating, 0) / r.length : null, top: r.slice().sort((a, b) => b.rating - a.rating)[0] || null }; }).filter(x => x.n);
  const busy = st.months.indexOf(Math.max(...st.months)), prev = rec(s.media).filter(m => m.status === 'done' && yearOf(m) === String(+y - 1)).length;
  const pages = done.filter(m => m.kind === 'book').reduce((t, m) => t + (m.total || 0), 0);
  const lines = [];
  if (done.length) lines.push(`You finished ${done.length} things in ${y}${prev ? ` (${done.length >= prev ? '+' : ''}${done.length - prev} vs ${+y - 1})` : ''}.`);
  if (st.genres[0]) lines.push(`Your year leaned ${st.genres.slice(0, 2).map(g => g[0]).join(' and ')}.`);
  if (st.months[busy] > 1) lines.push(`${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][busy]} was your busiest month, with ${st.months[busy]}.`);
  if (pages) lines.push(`${pages.toLocaleString('en')} pages read.`);
  if (st.hours) lines.push(`About ${st.hours} hours of films, reading and play logged.`);
  return { year: y, n: done.length, avg: st.avg, per, best: best.slice(0, 5), worst: rated.filter(m => m.rating <= 4).slice(0, 3), months: st.months, genres: st.genres.slice(0, 6), makers: st.makers.slice(0, 4), lines, pages, hours: st.hours, years: [...new Set(rec(s.media).filter(m => m.status === 'done' && yearOf(m)).map(yearOf))].sort().reverse() };
}
/** Shelf filter: free text, genre, rating floor, finish year, sort. */
export function filterShelf(list, { q = '', genre = '', min = 0, year = '', sort = 'recent' } = {}) {
  const nq = norm(q); let out = list.filter(m => (!nq || norm(`${m.title} ${m.creator}`).includes(nq)) && (!genre || (m.genres || []).includes(genre)) && (!min || m.rating >= min) && (!year || yearOf(m) === String(year)));
  const by = { recent: (a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '') || b.at - a.at, rating: (a, b) => b.rating - a.rating || (b.finishedAt || '').localeCompare(a.finishedAt || ''), title: (a, b) => a.title.localeCompare(b.title), year: (a, b) => b.year - a.year }[sort];
  return by ? out.slice().sort(by) : out;
}
export const genresOf = (list) => countOf(list.flatMap(m => m.genres || [])).slice(0, 24);
