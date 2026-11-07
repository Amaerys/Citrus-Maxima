// Library (anime · shows · movies · books · games) and Notes screens. Mind's segment bar mounts them; mind-ui hands over the shared context.
import { h, toast, fromKey, fmtDate, keyOf } from './util.js';
import * as L from './media.js';
import { ring, bars } from './mind-viz.js';

let ctx = null;
export function initMedia(c) { ctx = c; }
const S = () => ctx.S();
const up = (fn) => ctx.update(fn);
const ui = { kind: '', tab: 'shelf', q: '', tag: '', busy: '', sugg: {}, suggErr: '', importMsg: '' };

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
  return h('div', { class: 'seg lib-tabs' }, [['shelf', 'Shelf'], ['discover', 'Discover'], ['connect', 'Connect']].map(([id, l]) => h('button', { class: ui.tab === id ? 'active' : '', onClick: () => { ui.tab = id; ctx.render(); } }, l)));
}
function mediaRow(m) {
  const k = L.kindOf(m.kind), pct = m.total ? Math.min(1, m.progress / m.total) : null;
  return h('div', { class: 'mrow media', onClick: () => mediaSheet(m.id) },
    m.cover ? h('img', { class: 'cover', src: m.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph', style: { '--c': k.color } }, k.emoji),
    h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, m.title),
      h('div', { class: 'msub' }, h('span', { style: { color: k.color } }, L.statusWord(m.kind, m.status)), m.creator ? h('span', {}, m.creator) : null, m.year ? h('span', {}, String(m.year)) : null,
        m.kind === 'game' && m.minutes ? h('span', {}, `${Math.round(m.minutes / 60)}h`) : null, m.finishedAt && m.status === 'done' ? h('span', {}, fmtDate(fromKey(m.finishedAt))) : null),
      pct != null && m.status === 'doing' ? h('div', { class: 'bar thin' }, h('i', { style: { width: `${Math.round(pct * 100)}%`, background: k.color } })) : null),
    m.status === 'doing' && m.total && m.kind !== 'game' ? h('button', { class: 'btn sm', 'aria-label': `One more ${k.unit}`, onClick: (e) => { e.stopPropagation(); bump(m); } }, `+1 ${k.unit}`) : null,
    m.rating ? h('span', { class: 'rate' }, stars(m.rating)) : null);
}
function bump(m) { const n = Math.min(m.total || 9e9, (m.progress || 0) + 1); up(s => L.updateMedia(s, m.id, { progress: n, ...(m.total && n >= m.total ? { status: 'done' } : {}) })); if (m.total && n >= m.total) toast(`Finished ${m.title} 🎉`); }

function shelf() {
  const s = S(), list = L.mediaList(s, ui.kind), st = L.libraryStats(s, new Date()), y = new Date().getFullYear();
  const groups = ['doing', 'planned', 'paused', 'done', 'dropped'].map(g => [g, list.filter(m => m.status === g).sort((a, b) => g === 'done' ? (b.finishedAt || '').localeCompare(a.finishedAt || '') : b.at - a.at)]).filter(([, l]) => l.length);
  const goal = (k) => st.goal[k] || 0;
  const goalKinds = (ui.kind ? [ui.kind] : ['book']).filter(k => goal(k) || k === 'book');
  return [
    h('div', { class: 'card space slim' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, `${y} so far`), h('div', { class: 'big' }, st.doneYear, h('small', {}, ' finished')), h('div', { class: 'dim tiny' }, st.avg != null ? `Average rating ${st.avg.toFixed(1)}/10 · ${st.total} in library${st.hours ? ` · ${st.hours}h played` : ''}` : `${st.total} in library`)),
      goalKinds.map(k => { const g = goal(k), n = st.byKind[k].year; return h('button', { class: 'goal-ring', onClick: () => goalSheet(k), 'aria-label': `${L.kindOf(k).name} goal` }, ring(g ? n / g : null, { size: 64, stroke: 6, color: L.kindOf(k).color, label: g ? `${n}/${g}` : String(n), sub: L.kindOf(k).name.toLowerCase(), cls: 'breathing' })); })),
      st.doneYear ? bars(st.months.map((v, i) => ({ v: Math.min(1, v / Math.max(1, ...st.months)), label: 'JFMAMJJASOND'[i], now: i === new Date().getMonth(), title: `${v}` })), { h: 40, color: 'var(--cyan)' }) : null),
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
    ui.sugg[kind] = kind === 'book' ? await L.bookSuggestions(s, dis) : await L.animeSuggestions(s, dis); L.cacheSet(kind, ui.sugg[kind]);
  } catch (e) { ui.suggErr = e.message || 'Could not reach the service'; }
  ui.busy = ''; ctx.render();
}
function discover() {
  const s = S(), kinds = (ui.kind ? [ui.kind] : ['book', 'anime']).filter(k => k === 'book' || k === 'anime');
  if (!kinds.length) return [h('div', { class: 'card empty' }, 'Suggestions are available for books (Open Library) and anime (AniList). Movies, shows and games: log them and rate them; they help the picks for the others.')];
  const out = [];
  for (const k of kinds) {
    if (ui.sugg[k] == null) ui.sugg[k] = L.cacheGet(k);
    const rated = L.mediaList(s, k).filter(m => m.status === 'done' && m.rating >= 8).length, list = (ui.sugg[k] || []).filter(x => !(s.mediaMeta?.dismissed || []).includes(x.key));
    const ki = L.kindOf(k);
    out.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${ki.emoji} ${ki.name} for you`), h('button', { class: 'btn sm', disabled: ui.busy === k, onClick: () => loadSuggestions(k) }, ui.busy === k ? 'Finding…' : ui.sugg[k] ? 'Refresh' : 'Find some')),
      !rated ? h('div', { class: 'dim small' }, `Rate a few ${ki.name.toLowerCase()} 8/10 or higher and Citrus will suggest more like them${k === 'anime' ? ' (anime from AniList only, because it needs their IDs)' : ''}.`) : null,
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
    h('div', { class: 'card' }, h('div', { class: 'title' }, '🍥 AniList'), h('div', { class: 'dim small' }, 'Live: your anime list, scores and progress. Public profiles only. Safe to run again — it never overwrites your own ratings.'),
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
    try { const list = f.kind === 'book' ? await L.searchBooks(t) : f.kind === 'anime' ? await L.searchAnime(t) : []; res.replaceChildren(...list.map(it => h('div', { class: 'mrow media', onClick: () => { f.pre = it; sh.close(); mediaSheet(null, { ...it, status: f.status }); } }, it.cover ? h('img', { class: 'cover', src: it.cover, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'cover ph' }, L.kindOf(it.kind).emoji), h('div', { class: 'grow' }, h('div', { class: 'mtitle' }, it.title), h('div', { class: 'msub' }, h('span', {}, it.creator || ''), h('span', {}, it.year || ''))))), !list.length ? h('div', { class: 'dim small' }, f.kind === 'book' || f.kind === 'anime' ? 'No match — use “Add as typed”.' : 'No search for this kind — use “Add as typed”.') : null); }
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
  const dyn = h('div', {}), paintDyn = () => dyn.replaceChildren(f.kind === 'game' ? field('Hours played', hrs) : f.kind === 'movie' ? null : h('div', { class: 'grid2' }, field(`${f.kind === 'book' ? 'Page' : 'Episode'} now`, prog), field('Total', total)));
  const kindBox = cur ? null : pick(L.KINDS.map(x => [x.id, `${x.emoji} ${x.name}`, x.color]), f.kind, v => { f.kind = v; paintDyn(); paintStat(); });
  const statBox = h('div', {}), paintStat = () => { statBox.replaceChildren(pick(Object.keys(L.STATUS).map(x => [x, L.statusWord(f.kind, x)]), f.status, v => { f.status = v; })); }; paintDyn(); paintStat();
  sh.box.append(h('h3', {}, cur ? 'Details' : 'Log it'), kindBox, field('', title), field('', creator), statBox, dyn, field('Your rating', rate, rateLabel), field('Finished on', fin), field('Notes', review),
    cur?.src && cur.src !== 'manual' ? h('div', { class: 'dim tiny' }, `From ${cur.src}`) : null,
    h('div', { class: 'row end' }, cur ? confirmBtn('Delete', () => { up(st => L.deleteMedia(st, id)); sh.close(); }) : null, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      if (!title.value.trim()) return toast('Add a title');
      const v = { kind: f.kind, title: title.value.trim(), creator: creator.value.trim(), status: f.status, rating: f.rating, progress: +prog.value || 0, total: +total.value || 0, minutes: f.kind === 'game' ? (+hrs.value || 0) * 60 : f.minutes, finishedAt: fin.value, review: review.value.trim() };
      up(st => cur ? L.updateMedia(st, id, v) : L.addMedia(st, { ...preset, ...v })); sh.close(); toast(v.status === 'done' && v.rating ? 'Logged' : 'Saved');
    } }, 'Save')));
  if (!cur && !preset.title) setTimeout(() => title.focus(), 60);
}
function goalSheet(kind) {
  const s = S(), sh = ctx.sheet([]), k = L.kindOf(kind), cur = s.mediaMeta?.goals?.[kind] || '', n = h('input', { type: 'number', min: 0, value: cur, placeholder: 'e.g. 24' });
  sh.box.append(h('h3', {}, `${new Date().getFullYear()} ${k.name.toLowerCase()} goal`), field(`How many ${k.name.toLowerCase()} to finish this year?`, n), h('div', { class: 'row end' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => sh.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { up(st => L.setGoal(st, kind, n.value)); sh.close(); } }, 'Save')));
}
export function renderLibrary() {
  const body = ui.tab === 'shelf' ? shelf() : ui.tab === 'discover' ? discover() : connect();
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
