// Library (anime · shows · movies · books · games) and Notes screens. Mind's segment bar mounts them; mind-ui hands over the shared context.
import { h, toast, fromKey, fmtDate, keyOf } from './util.js';
import * as L from './media.js';
import { ring, bars } from './mind-viz.js';

let ctx = null;
export function initMedia(c) { ctx = c; }
const S = () => ctx.S();
const up = (fn) => ctx.update(fn);
const ui = { f: { q: '', genre: '', min: 0, year: '', sort: 'recent' }, year: '', kind: '', tab: 'shelf', q: '', tag: '', busy: '', sugg: {}, suggErr: '', importMsg: '' };

const field = (label, ...inputs) => h('div', { class: 'field' }, label ? h('label', {}, label) : null, ...inputs);
function pick(options, value, onPick, cls = '') {
  const box = h('div', { class: `seg wrap ${cls}` }); const paint = (v) => { for (const b of box.children) b.classList.toggle('active', b.dataset.v === String(v)); };
  for (const [v, label, color] of options) box.append(h('button', { type: 'button', dataset: { v: String(v) }, style: color ? { '--c': color } : null, onClick: () => { paint(v); onPick(v); } }, label));
  paint(value); return box;
}
const confirmBtn = (label, fn) => { const b = h('button', { class: 'btn danger', onClick: () => { if (b.dataset.sure) fn(); else { b.dataset.sure = 1; b.textContent = 'Tap again to confirm'; setTimeout(() => { delete b.dataset.sure; b.textContent = label; }, 3000); } } }, label); return b; };
const stars = (r) => r ? `★ ${r}` : '';

// ───────────────────────────────────────── Library
function kindBar() {
  return h('div', { class: 'seg wrap kinds' }, [['', 'All', null], ...L.KINDS.map(k => [k.id, `${k.emoji} ${k.name}`, k.color])].map(([id, label, color]) =>
    h('button', { class: ui.kind === id ? 'active' : '', style: color ? { '--c': color } : null, onClick: () => { ui.kind = id; ctx.render(); } }, label)));
}
function subBar() {
  return h('div', { class: 'seg lib-tabs' }, [['shelf', 'Shelf'], ['discover', 'Discover'], ['review', 'Review'], ['connect', 'Connect']].map(([id, l]) => h('button', { class: ui.tab === id ? 'active' : '', onClick: () => { ui.tab = id; ctx.render(); } }, l)));
}
function mediaRow(m) {
  const k = L.kindOf(m.kind), pct = m.total ? Math.min(1, m.progress / m.total) : null;
  return h('div', { class: 'mrow media', onClick: () => mediaSheet(m.id) },
    m.cover ? h('img', { class: 'cover', src: m.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph', style: { '--c': k.color } }, k.emoji),
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, m.title),
      h('div', { class: 'msub' }, h('span', { style: { color: k.color } }, L.statusWord(m.kind, m.status)), m.creator ? h('span', {}, m.creator) : null, m.year ? h('span', {}, String(m.year)) : null,
        m.kind === 'game' && m.minutes ? h('span', {}, `${Math.round(m.minutes / 60)}h`) : null, m.finishedAt && m.status === 'done' ? h('span', {}, fmtDate(fromKey(m.finishedAt))) : null),
      pct != null && m.status === 'doing' ? h('div', { class: 'bar thin' }, h('i', { style: { width: `${Math.round(pct * 100)}%`, background: k.color } })) : null),
    m.status === 'doing' && m.kind === 'book' ? h('button', { class: 'btn sm', onClick: (e) => { e.stopPropagation(); logReadingSheet(m.id); } }, 'Log') : m.status === 'doing' && m.total && m.kind !== 'game' ? h('button', { class: 'btn sm', 'aria-label': `One more ${k.unit}`, onClick: (e) => { e.stopPropagation(); bump(m); } }, `+1 ${k.unit}`) : null,
    m.rating ? h('span', { class: 'rate' }, stars(m.rating)) : null);
}
function bump(m) { const n = Math.min(m.total || 9e9, (m.progress || 0) + 1); up(s => L.updateMedia(s, m.id, { progress: n, ...(m.total && n >= m.total ? { status: 'done' } : {}) })); if (m.total && n >= m.total) toast(`Finished ${m.title} 🎉`); }

function readingDash() {
  const s = S(), now = new Date(), st = L.readingStats(s, now), cur = L.mediaList(s, 'book').filter(m => m.status === 'doing').sort((a, b) => b.at - a.at);
  const ahead = st.ahead == null ? null : Math.round(st.ahead * 10) / 10, week = Math.max(1, ...st.weekPages.map(x => x.p));
  return h('div', { class: 'card space slim reading' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, 'Reading'), h('div', { class: 'big' }, st.streak, h('small', {}, st.streak === 1 ? ' day streak' : ' day streak')),
      h('div', { class: 'dim tiny' }, [st.pace ? `${Math.round(st.pace)} pages a day lately` : 'Log a session to start your pace', st.minutesYear ? `${Math.round(st.minutesYear / 60)}h read this year` : ''].filter(Boolean).join(' · '))),
    h('button', { class: `btn ${st.readToday ? '' : 'primary'}`, onClick: () => { const c = cur[0]; if (c) logReadingSheet(c.id); else addSheet({ kind: 'book', status: 'doing' }); } }, st.readToday ? '+ More' : 'Log reading')),
    bars(st.weekPages.map((x, i) => ({ v: x.p / week, label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][fromKey(x.k).getDay()], now: i === 6, title: `${x.p} pages` })), { h: 34, color: 'var(--green)' }),
    ahead != null ? h('div', { class: `pace ${ahead >= 0 ? 'ok' : 'warnc'}` }, ahead >= 0 ? `${ahead === 0 ? 'Right on' : ahead + ' book' + (ahead === 1 ? '' : 's') + ' ahead of'} pace for your ${st.goal}-book goal` : `${-ahead} book${-ahead === 1 ? '' : 's'} behind pace for your ${st.goal}-book goal`) : null,
    cur.slice(0, 3).map(b => { const e = L.finishEta(s, b, now), p = b.total ? (b.progress || 0) / b.total : 0; return h('div', { class: 'cur-book', onClick: () => logReadingSheet(b.id) }, h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, b.title), h('div', { class: 'msub' }, h('span', {}, b.creator || ''), b.total ? h('span', {}, `p. ${b.progress || 0}/${b.total}`) : null, e ? h('span', { class: 'ok' }, `done ~${fmtDate(fromKey(e.date))}`) : null), b.total ? h('div', { class: 'bar thin' }, h('i', { style: { width: `${Math.round(p * 100)}%`, background: 'var(--green)' } })) : null), h('span', { class: 'rate' }, b.total ? `${Math.round(p * 100)}%` : '')); }));
}
function booksInsights() {
  const s = S(), st = L.readingStats(s, new Date()); if (!st.booksYear) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Your ${new Date().getFullYear()} in books`), h('div', { class: 'stat-grid' }, [[st.booksYear, 'books'], [st.pagesYear.toLocaleString('en'), 'pages'], [st.avgDays ? `${st.avgDays}d` : '–', 'avg to finish'], [st.longest ? st.longest.total : '–', 'longest (pages)']].map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l)))),
    st.authors.length ? h('div', { class: 'dim small' }, 'Most read: ', st.authors.map(([a, n]) => `${a} (${n})`).join(', ')) : null, st.genres.length ? h('div', { class: 'tags' }, st.genres.map(([g, n]) => h('span', { class: 'chip' }, `${g} · ${n}`))) : null,
    L.allQuotes(s).length ? h('div', { class: 'quote-of' }, (() => { const q = L.allQuotes(s)[Math.floor(Date.now() / 86400000) % L.allQuotes(s).length]; return [h('i', {}, `“${q.t}”`), h('small', {}, ` — ${q.author || q.book}`)]; })()) : null);
}
const KN = (kinds) => kinds ? (Array.isArray(kinds) ? kinds : [kinds]) : null;
const chips = (arr, fn) => h('div', { class: 'tags' }, arr.map(fn));
const worksChip = (m) => h('span', { class: 'chip', onClick: () => mediaSheet(m.id) }, `${m.title} · ${m.rating}`);
/** Stats + patterns for the selected kind (or everything). Same card for books, games, anime, films … */
function insights() {
  const s = S(), kinds = ui.kind ? [ui.kind] : null, st = L.statsOf(s, kinds, {}, new Date()); if (!st.n) return null;
  const mx = Math.max(1, ...st.hist), tp = L.tasteOf(s, kinds), fb = L.feedbackOf(s, kinds, new Date()), k1 = ui.kind ? L.kindOf(ui.kind) : null;
  const cells = [[st.n, 'finished'], [st.avg != null ? st.avg.toFixed(1) : '–', 'avg rating'], ...(ui.kind === 'book' || !ui.kind ? [[st.pages ? st.pages.toLocaleString('en') : '–', 'pages']] : []), ...(st.hours ? [[`${st.hours}h`, 'logged time']] : [])].slice(0, 4);
  return h('div', { class: 'card' }, h('div', { class: 'title' }, k1 ? `Your ${k1.name.toLowerCase()}, analysed` : 'Everything, analysed'),
    h('div', { class: 'stat-grid' }, cells.map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l)))),
    fb.map(t => h('div', { class: 'fb small' }, t)),
    st.ratedN ? [h('div', { class: 'dim tiny' }, 'How you rate (1–10)'), bars(st.hist.map((v, i) => ({ v: v / mx, label: String(i + 1), title: `${v} rated ${i + 1}` })), { h: 44, color: 'var(--cyan)' })] : null,
    st.years.length > 1 ? [h('div', { class: 'dim tiny' }, 'Finished per year'), chips(st.years.slice(-8), ([y, n]) => h('span', { class: 'chip', onClick: () => { ui.f.year = y; ui.tab = 'shelf'; ctx.render(); } }, `${y} · ${n}`))] : null,
    st.decades.length > 1 ? [h('div', { class: 'dim tiny' }, 'By release decade'), chips(st.decades, ([d, n]) => h('span', { class: 'chip' }, `${d} · ${n}`))] : null,
    st.genreAvg.length ? [h('div', { class: 'dim tiny' }, 'Genres by your average rating'), chips(st.genreAvg.slice(0, 8), ([g, a, n]) => h('span', { class: 'chip hot', onClick: () => { ui.f.genre = g; ctx.render(); } }, `${g} · ${a.toFixed(1)} (${n})`))] : st.genres.length ? [h('div', { class: 'dim tiny' }, 'Genres'), chips(st.genres.slice(0, 8), ([g, n]) => h('span', { class: 'chip', onClick: () => { ui.f.genre = g; ctx.render(); } }, `${g} · ${n}`))] : null,
    st.makers.length ? h('div', { class: 'dim small' }, 'Most often: ', st.makers.map(([d, n]) => `${d} (${n})`).join(', ')) : null,
    st.underrated.length ? [h('div', { class: 'dim tiny' }, 'You loved more than the crowd'), chips(st.underrated, worksChip)] : null,
    st.overrated.length ? [h('div', { class: 'dim tiny' }, 'The crowd loved more than you'), chips(st.overrated, worksChip)] : null,
    st.top.length ? [h('div', { class: 'dim tiny' }, 'Your top rated'), chips(st.top, worksChip)] : null,
    tp.loved.length ? null : null);
}
/** Filters above the shelf: text, genre, minimum rating, year finished, sort. */
function filterBar(list) {
  const f = ui.f, genres = L.genresOf(list), years = [...new Set(list.map(m => (m.finishedAt || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = (val, opts, set, label) => h('select', { 'aria-label': label, onChange: (e) => { set(e.target.value); ctx.render(); } }, opts.map(([v, l]) => h('option', { value: v, ...(String(val) === String(v) ? { selected: true } : {}) }, l)));
  const q = h('input', { type: 'search', placeholder: 'Search title or creator', value: f.q, 'aria-label': 'Search shelf', onInput: (e) => { f.q = e.target.value; clearTimeout(ui.qt); ui.qt = setTimeout(() => { ctx.render(); const el = document.querySelector('#view-mind .shelf-filter input'); if (el) { el.focus(); el.setSelectionRange(f.q.length, f.q.length); } }, 250); } });
  const active = f.q || f.genre || f.min || f.year;
  return h('div', { class: 'card slim shelf-filter' }, q, h('div', { class: 'filter-row' },
    sel(f.genre, [['', 'Any genre'], ...genres.map(([g, n]) => [g, `${g} (${n})`])], v => f.genre = v, 'Genre'),
    sel(f.min, [[0, 'Any rating'], [6, '6+'], [7, '7+'], [8, '8+'], [9, '9+'], [10, '10']], v => f.min = +v, 'Minimum rating'),
    sel(f.year, [['', 'Any year'], ...years.map(y => [y, y])], v => f.year = v, 'Year finished'),
    sel(f.sort, [['recent', 'Newest'], ['rating', 'Top rated'], ['title', 'A–Z'], ['year', 'Release year']], v => f.sort = v, 'Sort')),
    active ? h('button', { class: 'btn sm ghost', onClick: () => { ui.f = { q: '', genre: '', min: 0, year: '', sort: f.sort }; ctx.render(); } }, 'Clear filters') : null);
}
/** Backlog ranked by your taste, for kinds without a free online catalogue (and as a first lane for the rest). */
function backlogCard(kinds) {
  const s = S(), dis = s.mediaMeta?.dismissed || [], wl = L.rankPlanned(s, kinds, 12).filter(x => !dis.includes(x.key)).slice(0, 8), ki = kinds.length === 1 ? L.kindOf(kinds[0]) : null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `${ki ? ki.emoji : '✨'} Next up from your list`),
    wl.length ? [h('div', { class: 'dim tiny' }, 'Your plan-to list ranked by genres and creators you rated highly, nudged by the public score. Works offline.'),
      h('div', { class: 'mlist' }, wl.map(x => { const m = x.media, k = L.kindOf(m.kind); return h('div', { class: 'mrow media', onClick: () => mediaSheet(m.id) }, m.cover ? h('img', { class: 'cover', src: m.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph', style: { '--c': k.color } }, k.emoji), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, m.title), h('div', { class: 'msub' }, m.creator ? h('span', {}, m.creator) : null, m.year ? h('span', {}, String(m.year)) : null, m.pub ? h('span', { class: 'ok' }, `Public ${m.pub}`) : null), h('div', { class: 'dim tiny' }, x.reason)), h('button', { class: 'btn sm ghost', 'aria-label': 'Not interested', onClick: (e) => { e.stopPropagation(); up(st => L.dismissSuggestion(st, x.key)); } }, '✕')); }))]
      : h('div', { class: 'dim small' }, `Rate a few finished items and put others on your plan-to list (add them, or import an IMDb watchlist, Goodreads to-read shelf, or Steam library). Citrus will rank them for you.`));
}
/** Year in review across all kinds. */
function review() {
  const s = S(), now = new Date(), ys = L.yearReview(s, ui.year || now.getFullYear(), now), years = [...new Set([String(now.getFullYear()), ...ys.years])];
  const mx = Math.max(1, ...ys.months);
  return [h('div', { class: 'seg wrap' }, years.map(y => h('button', { class: String(ui.year || now.getFullYear()) === y ? 'active' : '', onClick: () => { ui.year = y; ctx.render(); } }, y))),
    !ys.n ? h('div', { class: 'card empty' }, `Nothing finished in ${ys.year} yet. Log and rate what you finish, and this page becomes your year in review.`) : [
      h('div', { class: 'card space' }, h('div', { class: 'eyebrow' }, `${ys.year} in review`), h('div', { class: 'big' }, ys.n, h('small', {}, ' finished')), h('div', { class: 'dim tiny' }, ys.avg != null ? `Average rating ${ys.avg.toFixed(1)}/10` : ''),
        ys.lines.map(t => h('div', { class: 'fb small' }, t)), bars(ys.months.map((v, i) => ({ v: v / mx, label: 'JFMAMJJASOND'[i], now: i === now.getMonth() && ys.year === String(now.getFullYear()), title: `${v}` })), { h: 44, color: 'var(--cyan)' })),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'By category'), h('div', { class: 'mlist' }, ys.per.map(x => h('div', { class: 'mrow', onClick: () => { ui.kind = x.kind.id; ui.f = { q: '', genre: '', min: 0, year: ys.year, sort: 'rating' }; ui.tab = 'shelf'; ctx.render(); } }, h('span', { class: 'cover ph', style: { '--c': x.kind.color } }, x.kind.emoji), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, `${x.kind.name} · ${x.n}`), h('div', { class: 'msub' }, x.avg != null ? h('span', {}, `avg ${x.avg.toFixed(1)}`) : null, x.top ? h('span', { class: 'ok' }, `best: ${x.top.title}`) : null)))))),
      ys.best.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Best of the year'), h('div', { class: 'mlist' }, ys.best.map(mediaRow))) : null,
      ys.genres.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your genres'), chips(ys.genres, ([g, n]) => h('span', { class: 'chip hot' }, `${g} · ${n}`)), ys.makers.length ? h('div', { class: 'dim small' }, 'Repeat names: ', ys.makers.map(([d, n]) => `${d} (${n})`).join(', ')) : null) : null,
      ys.worst.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Not for you'), h('div', { class: 'mlist' }, ys.worst.map(mediaRow))) : null]];
}
function shelf() {
  const s = S(), list = L.mediaList(s, ui.kind), st = L.libraryStats(s, new Date()), y = new Date().getFullYear();
  const shown = L.filterShelf(list, ui.f), groups = ['doing', 'planned', 'paused', 'done', 'dropped'].map(g => [g, shown.filter(m => m.status === g)]).filter(([, l]) => l.length);
  const goal = (k) => st.goal[k] || 0;
  const goalKinds = (ui.kind ? [ui.kind] : ['book']).filter(k => goal(k) || k === 'book');
  return [
    ui.kind === 'book' || !ui.kind ? readingDash() : null,
    h('div', { class: 'card space slim' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, `${y} so far`), h('div', { class: 'big' }, st.doneYear, h('small', {}, ' finished')), h('div', { class: 'dim tiny' }, st.avg != null ? `Average rating ${st.avg.toFixed(1)}/10 · ${st.total} in library${st.hours ? ` · ${st.hours}h played` : ''}` : `${st.total} in library`)),
      goalKinds.map(k => { const g = goal(k), n = st.byKind[k].year; return h('button', { class: 'goal-ring', onClick: () => goalSheet(k), 'aria-label': `${L.kindOf(k).name} goal` }, ring(g ? n / g : null, { size: 64, stroke: 6, color: L.kindOf(k).color, label: g ? `${n}/${g}` : String(n), sub: L.kindOf(k).name.toLowerCase(), cls: 'breathing' })); })),
      st.doneYear ? bars(st.months.map((v, i) => ({ v: Math.min(1, v / Math.max(1, ...st.months)), label: 'JFMAMJJASOND'[i], now: i === new Date().getMonth(), title: `${v}` })), { h: 40, color: 'var(--cyan)' }) : null),
    ui.kind === 'book' ? booksInsights() : null,
    insights(),
    filterBar(list),
    h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Your shelf'), h('button', { class: 'btn sm primary', onClick: () => addSheet() }, '+ Log')),
    ...groups.map(([g, l]) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, g === 'doing' ? 'Now' : L.STATUS[g] === 'Plan to' ? 'Up next' : L.STATUS[g]), h('span', { class: 'dim tiny' }, l.length)), h('div', { class: 'mlist' }, l.slice(0, g === 'done' ? 30 : 60).map(mediaRow)))),
    !groups.length ? h('div', { class: 'card empty' }, h('p', {}, 'Log what you watch, read and play, rate it, and Citrus learns your taste. Import from Goodreads, IMDb, AniList or Steam under Connect.'), h('div', { class: 'row center' }, h('button', { class: 'btn primary', onClick: () => addSheet() }, 'Log something'), h('button', { class: 'btn', onClick: () => { ui.tab = 'connect'; ctx.render(); } }, 'Connect'))) : null,
  ];
}

// ───────────────────────────────────────── Discover
async function loadSuggestions(kind) {
  ui.busy = kind; ui.suggErr = ''; ctx.render();
  try {
    const s = S(), dis = s.mediaMeta?.dismissed || [];
    ui.sugg[kind] = kind === 'book' ? await L.worldSuggestions(s, dis) : await L.animeSuggestions(s, dis, kind); L.cacheSet(kind, ui.sugg[kind]);
  } catch (e) { ui.suggErr = e.message || 'Could not reach the service'; }
  ui.busy = ''; ctx.render();
}
async function runExplore(id) {
  ui.exploring = id; ui.exploreErr = ''; ctx.render();
  try { ui.explore = { id, items: await L.exploreCatalogue(id, S(), S().mediaMeta?.dismissed || []) }; } catch (e) { ui.exploreErr = e.message || 'Could not reach Open Library'; ui.explore = null; }
  ui.exploring = ''; ctx.render();
}
function bookDiscover() {
  const s = S(), dis = s.mediaMeta?.dismissed || [], out = [], pile = L.pileRanking(s, 6).filter(x => !dis.includes(x.key));
  if (ui.sugg.book == null) ui.sugg.book = L.cacheGet('book'); const w = ui.sugg.book && ui.sugg.book.lanes ? ui.sugg.book : null;
  if (pile.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Next up from your pile'), h('div', { class: 'dim tiny' }, `Ranked from the ${L.mediaList(s, 'book').filter(m => m.status === 'planned').length} books on your want-to-read shelf by how well they match what you rated highly.`),
    h('div', { class: 'mlist' }, pile.map(x => { const m = x.media; return h('div', { class: 'mrow media', onClick: () => mediaSheet(m.id) }, m.cover ? h('img', { class: 'cover', src: m.cover, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph', style: { '--c': L.kindOf('book').color } }, '📚'), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, m.title), h('div', { class: 'msub' }, h('span', {}, m.creator || ''), m.total ? h('span', {}, `${m.total} pages`) : null), h('div', { class: 'dim tiny' }, x.reason)), h('button', { class: 'btn sm primary', onClick: (e) => { e.stopPropagation(); up(st => L.updateMedia(st, m.id, { status: 'doing' })); toast('Started'); } }, 'Start')); }))));
  const rated = L.mediaList(s, 'book').filter(m => m.status === 'done' && m.rating >= 8).length;
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, '📚 From the whole world of books'), h('button', { class: 'btn sm', disabled: ui.busy === 'book', onClick: () => loadSuggestions('book') }, ui.busy === 'book' ? 'Searching…' : w ? 'Refresh' : 'Find books')),
    h('div', { class: 'dim tiny' }, 'Drawn from Open Library’s catalogue of tens of millions of books, scored by your taste × reader ratings × popularity.'),
    !rated ? h('div', { class: 'dim small' }, 'Rate a few finished books 8/10 or higher and Citrus learns your taste. Until then, explore below.') : null,
    w ? h('div', { class: 'tags' }, [...w.taste.subjects.map(x => h('span', { class: 'chip hot' }, x)), ...w.taste.authors.map(x => h('span', { class: 'chip' }, x))]) : null,
    ui.suggErr && !ui.busy ? h('div', { class: 'late small' }, ui.suggErr) : null));
  for (const lane of (w?.lanes || [])) { const items = lane.items.filter(x => !dis.includes(x.key)); if (items.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, lane.title), h('div', { class: 'mlist' }, items.map(suggRow)))); }
  out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Explore'), h('button', { class: 'btn sm', onClick: () => runExplore(L.EXPLORE[Math.floor(Math.random() * L.EXPLORE.length)][0]) }, '🎲 Surprise me')),
    h('div', { class: 'explore' }, L.EXPLORE.map(([id, emoji, label]) => h('button', { class: `chip xp ${ui.explore?.id === id || ui.exploring === id ? 'hot' : ''}`, onClick: () => runExplore(id) }, `${emoji} ${label}`))),
    ui.exploring ? h('div', { class: 'dim small' }, 'Searching the catalogue…') : null, ui.exploreErr ? h('div', { class: 'late small' }, ui.exploreErr) : null,
    ui.explore?.items?.length ? h('div', { class: 'mlist' }, ui.explore.items.map(suggRow)) : ui.explore ? h('div', { class: 'dim small' }, 'Nothing new here — you may have it all.') : null));
  return out;
}
function discover() {
  const s = S(); if (ui.kind === 'book') return bookDiscover();
  if (!ui.kind) return [backlogCard(null), ...bookDiscover(), ...discoverKinds(['anime', 'manga'])];
  const online = ui.kind === 'anime' || ui.kind === 'manga';
  return [backlogCard([ui.kind]), ...(online ? discoverKinds([ui.kind]) : [])];
}
function discoverKinds(kinds) {
  const s = S();
  if (!kinds.length) return [h('div', { class: 'card empty' }, 'Nothing to suggest yet.')];
  const out = [];
  for (const k of kinds) {
    if (ui.sugg[k] == null) ui.sugg[k] = L.cacheGet(k);
    const rated = L.mediaList(s, k).filter(m => m.status === 'done' && m.rating >= 8).length, list = (ui.sugg[k] || []).filter(x => !(s.mediaMeta?.dismissed || []).includes(x.key));
    const ki = L.kindOf(k);
    out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${ki.emoji} ${ki.name} for you`), h('button', { class: 'btn sm', disabled: ui.busy === k, onClick: () => loadSuggestions(k) }, ui.busy === k ? 'Finding…' : ui.sugg[k] ? 'Refresh' : 'Find some')),
      !rated ? h('div', { class: 'dim small' }, `Rate a few ${ki.name.toLowerCase()} 8/10 or higher and Citrus will suggest more like them${k === 'anime' || k === 'manga' ? ' (from AniList only, because it needs their IDs)' : ''}.`) : null,
      ui.suggErr && ui.busy === '' ? h('div', { class: 'late small' }, ui.suggErr) : null,
      list.length ? h('div', { class: 'mlist' }, list.map(x => suggRow(x))) : (rated && ui.sugg[k] ? h('div', { class: 'dim small' }, 'Nothing new right now — rate more, or refresh later.') : null)));
  }
  return out;
}
function suggRow(x) {
  const it = x.item, k = L.kindOf(it.kind);
  return h('div', { class: 'mrow media' }, it.cover ? h('img', { class: 'cover', src: it.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph', style: { '--c': k.color } }, k.emoji),
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, it.title), h('div', { class: 'msub' }, it.creator ? h('span', {}, it.creator) : null, it.year ? h('span', {}, String(it.year)) : null, x.score ? h('span', { class: 'ok' }, x.score) : null), h('div', { class: 'dim tiny' }, x.reason)),
    h('button', { class: 'btn sm primary', onClick: () => { up(s => L.upsertMedia(s, { ...it, status: 'planned' }).state); toast('Added to your list'); } }, '+ List'),
    h('button', { class: 'btn sm ghost', 'aria-label': 'Not interested', onClick: () => up(s => L.dismissSuggestion(s, x.key)) }, '✕'));
}

// ───────────────────────────────────────── Connect (imports)
function connect() {
  const s = S(), meta = s.mediaMeta || {};
  const aniIn = h('input', { type: 'text', value: meta.anilist || '', placeholder: 'AniList username', autocomplete: 'off', spellcheck: false });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' }, onChange: async () => { const f = file.files[0]; if (!f) return; importText(await f.text(), f.name); file.value = ''; } });
  const key = h('input', { type: 'password', placeholder: 'Steam Web API key (stays in this box)', autocomplete: 'off' }), sid = h('input', { type: 'text', value: meta.steamId || '', placeholder: 'SteamID64 (17 digits)', inputmode: 'numeric' }), link = h('div', { class: 'tiny' }), paste = h('textarea', { rows: 3, placeholder: 'Paste the page’s text here…', spellcheck: false });
  const paintLink = () => { link.replaceChildren(); if (key.value && /^\d{17}$/.test(sid.value.trim())) link.append(h('a', { class: 'btn sm', href: L.steamUrl(key.value.trim(), sid.value.trim()), target: '_blank', rel: 'noopener noreferrer' }, '1 · Open Steam data'), h('span', { class: 'dim' }, ' then copy everything on that page')); };
  key.addEventListener('input', paintLink); sid.addEventListener('input', paintLink);
  return [
    h('div', { class: 'card' }, h('div', { class: 'title' }, '🍥 AniList'), h('div', { class: 'dim small' }, 'Live: your anime and manga lists, scores and progress. Public profiles only. Safe to run again — it never overwrites your own ratings.'),
      field('', aniIn), h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !!ui.busy, onClick: async () => {
        const u = aniIn.value.trim(); if (!u) return toast('Enter your AniList username'); ui.busy = 'ani'; toast('Fetching…');
        try { const items = await L.fetchAniList(u); let r; up(s => { const x = L.upsertMany(s, items); r = x; return L.setMeta(x.state, { anilist: u, anilistAt: Date.now() }); }); ui.importMsg = `AniList: ${r.added} added, ${r.updated} updated, ${r.skipped} unchanged`; toast(ui.importMsg, 'ok'); }
        catch (e) { toast(e.message, 'err'); } ui.busy = ''; ctx.render();
      } }, meta.anilist ? 'Sync now' : 'Connect'), meta.anilistAt ? h('span', { class: 'dim tiny' }, `last ${new Date(meta.anilistAt).toLocaleDateString('en-GB')}`) : null)),
    h('div', { class: 'card' }, h('div', { class: 'title' }, '📚🎬 Goodreads · IMDb files'), h('div', { class: 'dim small' }, 'Neither offers a connection for apps, so Citrus reads their export files. Goodreads: My Books → Import and export → Export library. IMDb: your Ratings or Watchlist page → ⋯ → Export. Re-import any time; duplicates are merged. Kindle books you track on Goodreads come through this way.'),
      h('div', { class: 'row' }, file, h('button', { class: 'btn primary', onClick: () => file.click() }, 'Choose CSV file')), ui.importMsg ? h('div', { class: 'ok small', style: { marginTop: '8px' } }, ui.importMsg) : null),
    h('div', { class: 'card' }, h('div', { class: 'title' }, '🎮 Steam'), h('div', { class: 'dim small' }, 'Steam blocks direct calls from a web page, so it takes one copy-paste: make a free key at steamcommunity.com/dev/apikey, set your Game details to Public, and Citrus builds the link. The key is never saved.'),
      field('', key), field('', sid), link, field('', paste), h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => { const r = L.parseSteam(paste.value); if (r.error) return toast(r.error, 'err'); let res; up(s => { const x = L.upsertMany(s, r.items); res = x; return L.setMeta(x.state, { steamId: sid.value.trim(), steamAt: Date.now() }); }); ui.importMsg = `Steam: ${res.added} added, ${res.updated} updated`; toast(ui.importMsg, 'ok'); paste.value = ''; ctx.render(); } }, '2 · Import games'))),
    h('div', { class: 'card' }, h('div', { class: 'title' }, 'Anything else'), h('div', { class: 'dim small' }, 'Log by hand with search: books from Open Library, anime from AniList; shows, movies and games by title. Everything syncs through Drive with the rest of Citrus.'), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => addSheet() }, '+ Log something'))),
  ];
}
function importText(text, name) {
  const r = L.parseExport(text); if (r.error) { toast(r.error, 'err'); return; }
  let res; up(s => { const x = L.upsertMany(s, r.items); res = x; return x.state; });
  ui.importMsg = `${r.source}: ${res.added} added, ${res.updated} updated, ${res.skipped} unchanged (${name})`; toast(ui.importMsg, 'ok'); ctx.render();
}

// ───────────────────────────────────────── sheets
function addSheet(preset = {}) {
  const sh = ctx.sheet([]), f = { kind: ui.kind || 'book', status: 'planned', ...preset };
  const q = h('input', { type: 'text', placeholder: 'Search or type a title…', maxlength: 140, autocomplete: 'off' }), res = h('div', { class: 'mlist' }), kindBox = h('div', {});
  const paintKind = () => kindBox.replaceChildren(pick(L.KINDS.map(k => [k.id, `${k.emoji} ${k.name}`, k.color]), f.kind, v => { f.kind = v; res.replaceChildren(); })), go = () => { sh.close(); mediaSheet(null, f); };
  paintKind();
  const search = async () => {
    const t = q.value.trim(); if (!t) return; res.replaceChildren(h('div', { class: 'dim small' }, 'Searching…'));
    try { const list = f.kind === 'book' ? await L.searchBooks(t) : f.kind === 'anime' || f.kind === 'manga' ? await L.searchAnime(t, f.kind) : []; res.replaceChildren(...list.map(it => h('div', { class: 'mrow media', onClick: () => { f.pre = it; sh.close(); mediaSheet(null, { ...it, status: f.status }); } }, it.cover ? h('img', { class: 'cover', src: it.cover, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph' }, L.kindOf(it.kind).emoji), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, it.title), h('div', { class: 'msub' }, h('span', {}, it.creator || ''), h('span', {}, it.year || ''))))), !list.length ? h('div', { class: 'dim small' }, f.kind === 'book' || f.kind === 'anime' ? 'No match — use “Add as typed”.' : 'No search for this kind — use “Add as typed”.') : null); }
    catch (e) { res.replaceChildren(h('div', { class: 'late small' }, e.message)); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  sh.box.append(h('h3', {}, 'Log something'), kindBox, field('', q), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: search }, 'Search'), h('button', { class: 'btn primary', onClick: () => { if (!q.value.trim()) return toast('Type a title'); f.title = q.value.trim(); go(); } }, 'Add as typed')), res);
  setTimeout(() => q.focus(), 60);
}
function mediaSheet(id, preset = {}) {
  const s = S(), cur = s.media?.[id], f = { kind: 'book', title: '', status: 'planned', rating: 0, progress: 0, total: 0, creator: '', year: 0, minutes: 0, review: '', finishedAt: '', ...preset, ...(cur || {}) };
  const sh = ctx.sheet([]), k = () => L.kindOf(f.kind);
  const title = h('input', { type: 'text', value: f.title, maxlength: 140 }), creator = h('input', { type: 'text', value: f.creator, maxlength: 80, placeholder: 'Author / studio / director' });
  const prog = h('input', { type: 'number', min: 0, value: f.progress || '' }), total = h('input', { type: 'number', min: 0, value: f.total || '' }), hrs = h('input', { type: 'number', min: 0, step: 1, value: f.minutes ? Math.round(f.minutes / 60) : '' }), fin = h('input', { type: 'date', value: f.finishedAt }), review = h('textarea', { rows: 3, placeholder: 'A line or two for future you' }, f.review);
  const rate = h('div', { class: 'rate-pick' }), paintRate = () => { for (const b of rate.children) b.classList.toggle('on', +b.dataset.v <= f.rating); }; for (let i = 1; i <= 10; i++) rate.append(h('button', { type: 'button', dataset: { v: i }, onClick: () => { f.rating = f.rating === i ? 0 : i; paintRate(); } }, '★')); paintRate();
  const rateLabel = h('span', { class: 'dim tiny' }, '1–10, tap again to clear');
  const fmtBox = f.kind === 'book' || cur?.kind === 'book' ? field('Format', pick([['', 'Any'], ['paper', 'Paper'], ['ebook', 'E-book / Kindle'], ['audio', 'Audio']], f.format || '', v => { f.format = v; })) : null;
  const quotesBox = cur && cur.kind === 'book' ? h('div', { class: 'quotes' }, h('div', { class: 'title' }, 'Highlights'), (cur.quotes || []).map(q => h('div', { class: 'quote-row' }, h('i', {}, `“${q.t}”`), h('small', {}, q.p ? ` p.${q.p}` : ''), h('button', { class: 'btn sm ghost', 'aria-label': 'Remove', onClick: () => { up(st => L.removeQuote(st, id, q.id)); sh.close(); mediaSheet(id); } }, '✕')))) : null;
  const dyn = h('div', {}), paintDyn = () => dyn.replaceChildren(f.kind === 'game' ? field('Hours played', hrs) : f.kind === 'movie' ? null : h('div', { class: 'grid2' }, field(`${f.kind === 'book' ? 'Page' : f.kind === 'manga' ? 'Chapter' : 'Episode'} now`, prog), field('Total', total)));
  const kindBox = cur ? null : pick(L.KINDS.map(x => [x.id, `${x.emoji} ${x.name}`, x.color]), f.kind, v => { f.kind = v; paintDyn(); paintStat(); });
  const statBox = h('div', {}), paintStat = () => { statBox.replaceChildren(pick(Object.keys(L.STATUS).map(x => [x, L.statusWord(f.kind, x)]), f.status, v => { f.status = v; })); }; paintDyn(); paintStat();
  sh.box.append(h('h3', {}, cur ? 'Details' : 'Log it'), kindBox, field('', title), field('', creator), statBox, dyn, fmtBox, field('Your rating', rate, rateLabel), field('Finished on', fin), field('Notes', review), quotesBox,
    cur?.src && cur.src !== 'manual' ? h('div', { class: 'dim tiny' }, `From ${cur.src}`) : null,
    h('div', { class: 'row end' }, cur ? confirmBtn('Delete', () => { up(st => L.deleteMedia(st, id)); sh.close(); }) : null, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      if (!title.value.trim()) return toast('Add a title');
      const v = { kind: f.kind, title: title.value.trim(), creator: creator.value.trim(), status: f.status, rating: f.rating, progress: +prog.value || 0, total: +total.value || 0, minutes: f.kind === 'game' ? (+hrs.value || 0) * 60 : f.minutes, finishedAt: fin.value, review: review.value.trim(), ...(f.format != null ? { format: f.format } : {}) };
      up(st => cur ? L.updateMedia(st, id, v) : L.addMedia(st, { ...preset, ...v })); sh.close(); toast(v.status === 'done' && v.rating ? 'Logged' : 'Saved');
    } }, 'Save')));
  if (!cur && !preset.title) setTimeout(() => title.focus(), 60);
}
export function logReadingSheet(id) {
  const s = S(), b = s.media?.[id]; if (!b) return;
  const sh = ctx.sheet([]), pages = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'pages read' }), now = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: b.progress ? `now on page…` : 'page now' }), mins = h('input', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'minutes (optional)' });
  const quote = h('textarea', { rows: 2, placeholder: 'A line worth keeping (optional)' }), eta = L.finishEta(s, b), timer = { t: 0, id: 0 }, tl = h('span', { class: 'dim tiny' }, ''), tbtn = h('button', { type: 'button', class: 'btn sm' }, '▶ Timer');
  const paintT = () => { const m = Math.floor(timer.t / 60); tl.textContent = `${m}:${String(timer.t % 60).padStart(2, '0')}`; mins.value = Math.max(1, Math.round(timer.t / 60)); };
  tbtn.addEventListener('click', () => { if (timer.id) { clearInterval(timer.id); timer.id = 0; tbtn.textContent = '▶ Timer'; return; } tbtn.textContent = '⏸ Stop'; timer.id = setInterval(() => { timer.t++; paintT(); }, 1000); });
  const close = sh.close; sh.close = () => { clearInterval(timer.id); close(); };
  const chips = h('div', { class: 'seg mini' }, [5, 10, 20, 30, 50].map(n => h('button', { type: 'button', onClick: () => { pages.value = n; now.value = ''; } }, `+${n}`)));
  sh.box.append(h('h3', {}, b.title), h('div', { class: 'dim tiny' }, [b.creator, b.total ? `page ${b.progress || 0} of ${b.total}` : '', eta ? `finish ~${fmtDate(fromKey(eta.date))} at ${eta.pace}/day` : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'grid2' }, field('Pages read today', pages, chips), field('…or the page you are on', now)), h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Time', mins)), h('div', { class: 'col' }, tbtn, tl)), field('Highlight', quote),
    (b.log || []).length ? h('div', { class: 'dim tiny' }, 'Recent: ', (b.log || []).slice(-5).reverse().map(x => `${fmtDate(fromKey(x.d)).slice(0, 5)} +${x.p}p`).join(' · ')) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: () => { sh.close(); mediaSheet(id); } }, 'Details'), h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      let r; up(st => { r = L.logReading(st, id, { pages: +pages.value, pageNow: now.value === '' ? null : +now.value, minutes: +mins.value }); return quote.value.trim() ? L.addQuote(r.state, id, { text: quote.value, page: +now.value || (b.progress || 0) + (+pages.value || 0) }) : r.state; });
      if (!r.finished && !pages.value && !now.value && !mins.value && !quote.value.trim()) return toast('Add pages or time');
      sh.close(); if (r.finished) { toast(`Finished ${b.title} 🎉`); setTimeout(() => mediaSheet(id), 250); } else toast('Logged');
    } }, 'Log')));
  setTimeout(() => pages.focus(), 60);
}
function goalSheet(kind) {
  const s = S(), sh = ctx.sheet([]), k = L.kindOf(kind), cur = s.mediaMeta?.goals?.[kind] || '', n = h('input', { type: 'number', min: 0, value: cur, placeholder: 'e.g. 24' });
  sh.box.append(h('h3', {}, `${new Date().getFullYear()} ${k.name.toLowerCase()} goal`), field(`How many ${k.name.toLowerCase()} to finish this year?`, n), h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { up(st => L.setGoal(st, kind, n.value)); sh.close(); } }, 'Save')));
}
export function renderLibrary() {
  const body = ui.tab === 'shelf' ? shelf() : ui.tab === 'discover' ? discover() : ui.tab === 'review' ? review() : connect();
  return [kindBar(), subBar(), ...body.flat().filter(Boolean)];
}

// ───────────────────────────────────────── Notes
function memoRow(m) {
  const first = m.body.split('\n').find(x => x.trim()) || '';
  return h('div', { class: `mrow memo ${m.pinned ? 'pinned' : ''}`, onClick: () => memoSheet(m.id) }, h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, m.pinned ? '📌 ' : '', m.title || first.slice(0, 60) || 'Untitled'), m.title && first ? h('div', { class: 'msub clamp' }, first.slice(0, 140)) : null,
    m.tags.length ? h('div', { class: 'tags' }, m.tags.map(t => h('span', { class: 'chip' }, `#${t}`))) : null), h('span', { class: 'dim tiny' }, new Date(m.at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })));
}
export function renderNotes() {
  const s = S(), list = L.memoList(s, { q: ui.q, tag: ui.tag }), tags = L.memoTags(s);
  const q = h('input', { type: 'search', value: ui.q, placeholder: 'Search notes…', 'aria-label': 'Search notes', onInput: () => { ui.q = q.value; clearTimeout(ui.t); ui.t = setTimeout(() => { ctx.render(); const el = document.querySelector('.memo-search input'); el?.focus(); el?.setSelectionRange(99, 99); }, 250); } });
  return [h('div', { class: 'row memo-search' }, h('div', { class: 'cap-row grow' }, q), h('button', { class: 'btn primary', onClick: () => memoSheet(null) }, '+ Note')),
    tags.length ? h('div', { class: 'tags tagbar' }, tags.map(t => h('button', { class: `chip ${ui.tag === t ? 'hot' : ''}`, onClick: () => { ui.tag = ui.tag === t ? '' : t; ctx.render(); } }, `#${t}`))) : null,
    list.length ? h('div', { class: 'card' }, h('div', { class: 'mlist' }, list.map(memoRow))) : h('div', { class: 'card empty' }, h('p', {}, ui.q || ui.tag ? 'No notes match.' : 'Notes for anything — ideas, lists, things to remember. Tag them with #words and search across everything. For daily reflection and journaling, use Reflect.'), h('button', { class: 'btn primary', onClick: () => memoSheet(null) }, 'Write a note'))];
}
export function memoSheet(id, preset = {}) {
  const s = S(), cur = s.memos?.[id], f = { title: '', body: '', tags: [], pinned: false, ...preset, ...(cur || {}) };
  const sh = ctx.sheet([]), title = h('input', { type: 'text', value: f.title, placeholder: 'Title (optional)', maxlength: 100 }), body = h('textarea', { rows: 10, placeholder: 'Write…' }, f.body), tags = h('input', { type: 'text', value: (f.tags || []).map(t => '#' + t).join(' '), placeholder: '#tags', autocapitalize: 'none' });
  let pinned = !!f.pinned;
  sh.box.append(h('h3', {}, cur ? 'Note' : 'New note'), field('', title), field('', body), field('Tags', tags),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pinned, onChange: (e) => { pinned = e.target.checked; } }), 'Pin to the top'),
    h('div', { class: 'row end' }, cur ? [confirmBtn('Delete', () => { up(st => L.deleteMemo(st, id)); sh.close(); }), h('button', { class: 'btn', onClick: () => { sh.close(); ctx.openTask?.({ title: (f.title || f.body.split('\n')[0]).slice(0, 100), notes: f.body.slice(0, 500) }); } }, '→ Task')] : null, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Close'),
      h('button', { class: 'btn primary', onClick: () => { if (!title.value.trim() && !body.value.trim()) { sh.close(); return; } const v = { title: title.value, body: body.value, tags: tags.value, pinned }; up(st => cur ? L.updateMemo(st, id, v) : L.addMemo(st, v)); sh.close(); } }, 'Save')));
  if (!cur) setTimeout(() => body.focus(), 60);
}
export function mediaSearchItems() {
  const s = S(), out = [];
  for (const m of L.mediaList(s)) out.push({ kind: L.kindOf(m.kind).name.replace(/s$/, ''), title: m.title, sub: `${L.statusWord(m.kind, m.status)}${m.rating ? ` · ★${m.rating}` : ''}`, seg: 'library', run: () => mediaSheet(m.id) });
  for (const m of Object.values(s.memos || {})) out.push({ kind: 'Note', title: m.title || m.body.split('\n')[0].slice(0, 60) || 'Untitled', sub: m.tags.map(t => '#' + t).join(' '), seg: 'notes', run: () => memoSheet(m.id) });
  return out;
}
export const quickNote = () => memoSheet(null);
export const quickLog = () => addSheet();
