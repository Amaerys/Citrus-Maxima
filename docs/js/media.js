// Library: what you watch, read and play — records, imports (Goodreads / IMDb CSV, AniList, Steam), suggestions, notes.
// Records are maps id → {…, at} like the rest of Mind, so devices merge key by key and deletions leave tombstones.
import { keyOf, addDays, startOfDay, uid, safeUrl } from './util.js';

const rec = (o) => Object.values(o || {});
export const KINDS = [
  { id: 'anime', name: 'Anime', emoji: '🍥', color: '#ff8fa3', unit: 'ep' },
  { id: 'show', name: 'Shows', emoji: '📺', color: '#8e9bff', unit: 'ep' },
  { id: 'movie', name: 'Movies', emoji: '🎬', color: '#ffc857', unit: '' },
  { id: 'book', name: 'Books', emoji: '📚', color: '#5fd38d', unit: 'p' },
  { id: 'game', name: 'Games', emoji: '🎮', color: '#4fb3ff', unit: 'h' },
];
export const kindOf = (id) => KINDS.find(k => k.id === id) || KINDS[0];
export const STATUS = { planned: 'Plan to', doing: 'In progress', done: 'Finished', paused: 'Paused', dropped: 'Dropped' };
export const statusWord = (kind, st) => ({ planned: kind === 'book' ? 'Want to read' : kind === 'game' ? 'Backlog' : 'Plan to watch', doing: kind === 'book' ? 'Reading' : kind === 'game' ? 'Playing' : 'Watching', done: kind === 'book' ? 'Read' : kind === 'game' ? 'Played' : 'Watched', paused: 'Paused', dropped: 'Dropped' }[st]);
const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ───────────────────────────── records
export function addMedia(s, f) {
  const title = String(f.title || '').trim().slice(0, 140); if (!title) return s;
  const kind = KINDS.some(k => k.id === f.kind) ? f.kind : 'book', now = Date.now(), id = f.id || uid();
  const m = { id, kind, title, status: STATUS[f.status] ? f.status : 'planned', rating: Math.max(0, Math.min(10, +f.rating || 0)), progress: Math.max(0, +f.progress || 0), total: Math.max(0, +f.total || 0),
    year: +f.year || 0, creator: String(f.creator || '').slice(0, 80), genres: (f.genres || []).map(g => String(g).slice(0, 30)).slice(0, 6), cover: f.cover ? safeUrl(f.cover) : '', src: f.src || 'manual', extId: f.extId ? String(f.extId) : '',
    startedAt: f.startedAt || '', finishedAt: f.finishedAt || '', minutes: Math.max(0, +f.minutes || 0), review: String(f.review || '').slice(0, 800), createdAt: f.createdAt || now, at: now };
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
  if (f.progress && f.progress > (cur.progress || 0)) patch.progress = f.progress;
  if (cur.status === 'planned' && f.status && f.status !== 'planned') patch.status = f.status;
  return Object.keys(patch).length ? { state: updateMedia(s, cur.id, patch), added: 0, updated: 1 } : { state: s, added: 0 };
}
export function upsertMany(s, list) { let st = s, added = 0, updated = 0; for (const f of list) { const r = upsertMedia(st, f); st = r.state; added += r.added || 0; updated += r.updated || 0; } return { state: st, added, updated, skipped: list.length - added - updated }; }

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
export function parseExport(text) {
  const rows = parseCSV(text); if (!rows.length) return { error: 'That file has no rows.' };
  const cols = Object.keys(rows[0]);
  if (cols.includes('Exclusive Shelf') && cols.includes('Title')) {
    const items = rows.filter(r => r.Title).map(r => {
      const shelf = r['Exclusive Shelf'], rating = +r['My Rating'] || 0, isbn = unExcel(r.ISBN13 || r.ISBN);
      return { kind: 'book', title: r.Title.replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, ''), creator: r.Author, year: +r['Original Publication Year'] || +r['Year Published'] || 0, total: +r['Number of Pages'] || 0,
        status: shelf === 'read' ? 'done' : shelf === 'currently-reading' ? 'doing' : shelf === 'to-read' ? 'planned' : 'planned', rating: rating * 2, finishedAt: dateKeyOf(r['Date Read']), review: r['My Review'] || '', src: 'goodreads', extId: r['Book Id'] || isbn };
    });
    return { source: 'Goodreads', items };
  }
  if (cols.includes('Const') && cols.includes('Title Type')) {
    const items = rows.filter(r => r.Title && !/episode|video game|podcast/i.test(r['Title Type'])).map(r => {
      const rated = +r['Your Rating'] || 0, type = r['Title Type'];
      return { kind: /series|mini/i.test(type) ? 'show' : 'movie', title: r.Title, creator: r.Directors || r.Creators || '', year: +r.Year || 0, genres: (r.Genres || '').split(',').map(x => x.trim()).filter(Boolean),
        status: rated ? 'done' : 'planned', rating: rated, finishedAt: dateKeyOf(r['Date Rated']), src: 'imdb', extId: r.Const };
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
export async function fetchAniList(user) {
  const d = await anilist(`query($u:String){MediaListCollection(userName:$u,type:ANIME){lists{entries{status score(format:POINT_100) progress completedAt{year month day} media{id title{romaji english} episodes seasonYear genres coverImage{medium}}}}}}`, { u: user });
  const out = [];
  for (const l of d.MediaListCollection?.lists || []) for (const e of l.entries || []) {
    const c = e.completedAt || {};
    out.push({ kind: 'anime', title: e.media.title.english || e.media.title.romaji, year: e.media.seasonYear || 0, total: e.media.episodes || 0, progress: e.progress || 0, genres: e.media.genres || [], cover: e.media.coverImage?.medium || '',
      status: ST[e.status] || 'planned', rating: e.score ? Math.round(e.score / 10) : 0, finishedAt: c.year ? `${c.year}-${String(c.month || 1).padStart(2, '0')}-${String(c.day || 1).padStart(2, '0')}` : '', src: 'anilist', extId: e.media.id });
  }
  return out;
}
export async function searchAnime(q) {
  const d = await anilist(`query($q:String){Page(perPage:8){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} episodes seasonYear genres coverImage{medium}}}}`, { q });
  return (d.Page?.media || []).map(m => ({ kind: 'anime', title: m.title.english || m.title.romaji, year: m.seasonYear || 0, total: m.episodes || 0, genres: m.genres || [], cover: m.coverImage?.medium || '', src: 'anilist', extId: m.id }));
}
export async function animeSuggestions(s, dismissed = []) {
  const top = rec(s.media).filter(m => m.kind === 'anime' && m.src === 'anilist' && m.extId && m.status === 'done' && m.rating >= 8).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const have = new Set(rec(s.media).filter(m => m.kind === 'anime').map(m => norm(m.title))), seen = new Set(), out = [];
  for (const m of top) {
    let d; try { d = await anilist(`query($id:Int){Media(id:$id){recommendations(perPage:6,sort:RATING_DESC){nodes{rating mediaRecommendation{id title{romaji english} episodes seasonYear genres coverImage{medium} averageScore}}}}}`, { id: +m.extId }); } catch { continue; }
    for (const n of d.Media?.recommendations?.nodes || []) {
      const r = n.mediaRecommendation; if (!r) continue; const title = r.title.english || r.title.romaji;
      if (have.has(norm(title)) || seen.has(r.id) || dismissed.includes(`anilist:${r.id}`)) continue; seen.add(r.id);
      out.push({ key: `anilist:${r.id}`, item: { kind: 'anime', title, year: r.seasonYear || 0, total: r.episodes || 0, genres: r.genres || [], cover: r.coverImage?.medium || '', src: 'anilist', extId: r.id, status: 'planned' }, reason: `Because you rated ${m.title} ${m.rating}/10`, score: r.averageScore ? `${r.averageScore}%` : '' });
    }
  }
  return out.slice(0, 12);
}

// ───────────────────────────── Open Library (CORS-enabled, no key)
const OL = 'https://openlibrary.org';
const olJson = async (path) => { const r = await fetch(`${OL}${path}`); if (!r.ok) throw new Error(`Open Library ${r.status}`); return r.json(); };
const olItem = (d) => ({ kind: 'book', title: d.title, creator: (d.author_name || [])[0] || '', year: d.first_publish_year || 0, total: d.number_of_pages_median || 0, genres: (d.subject || []).slice(0, 4), cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', src: 'openlibrary', extId: d.key || '' });
export async function searchBooks(q) { const j = await olJson(`/search.json?q=${encodeURIComponent(q)}&limit=8&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject`); return (j.docs || []).map(olItem); }
const GENERIC = /^(fiction|nonfiction|non-fiction|general|accessible book|protected daisy|in library|large type books|reading level|open library|new york times|english|american|literature|books and reading|lending library)/i;
export async function bookSuggestions(s, dismissed = []) {
  const books = rec(s.media).filter(m => m.kind === 'book'), liked = books.filter(m => m.status === 'done' && m.rating >= 8).sort((a, b) => b.rating - a.rating);
  const have = new Set(books.map(m => norm(m.title))), seen = new Set(), out = [];
  const push = (d, reason) => { const it = olItem(d); const k = `ol:${it.extId}`; if (!it.title || have.has(norm(it.title)) || seen.has(k) || dismissed.includes(k)) return; seen.add(k); out.push({ key: k, item: { ...it, status: 'planned' }, reason, score: d.ratings_average ? `${d.ratings_average.toFixed(1)}/5` : '' }); };
  const authors = [...new Set(liked.map(m => m.creator).filter(Boolean))].slice(0, 3);
  for (const a of authors) { try { const j = await olJson(`/search.json?author=${encodeURIComponent(a)}&sort=rating&limit=6&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,ratings_average`); const src = liked.find(m => m.creator === a); for (const d of j.docs || []) push(d, `More from ${a}, who you rated ${src.rating}/10`); } catch {} }
  for (const b of liked.slice(0, 3)) {
    try {
      const f = await olJson(`/search.json?title=${encodeURIComponent(b.title)}&limit=1&fields=subject`); const subs = (f.docs?.[0]?.subject || []).filter(x => !GENERIC.test(x)).slice(0, 2);
      for (const sub of subs) { const j = await olJson(`/search.json?subject=${encodeURIComponent(sub)}&sort=rating&limit=6&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,ratings_average`); for (const d of j.docs || []) push(d, `Similar to ${b.title} (${sub})`); }
    } catch {}
  }
  return out.slice(0, 14);
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
