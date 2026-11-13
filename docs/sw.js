// Citrus Maxima service worker: precached app shell, network-first with a short timeout, Google Fonts cached for offline.
const CACHE = 'citrus-maxima-v20';
const FONTS = 'citrus-fonts-v1';   // kept across releases: font files are immutable, no need to fetch them again
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Pixelify+Sans:wght@500;700&family=Source+Sans+3:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap';
// Without these the app cannot start offline: install fails (and the old worker stays) if one is missing.
const CORE = ['./', './index.html', './css/app.css', './js/app.js', './js/util.js', './manifest.webmanifest'];
// Everything else in docs/js (test/D17.mjs checks this list against the folder). Fetched one by one so a
// file that was renamed or merged away does not block the install; it just is not cached.
const JS = ['apps-ui', 'backup-check', 'board', 'career-ui', 'career', 'changes-ui', 'changes', 'chores-cal', 'chores-ui', 'chores', 'daily-ui', 'daily',
  'extras-ui', 'extras', 'google', 'inbound', 'labor-ui', 'labor', 'media-ui', 'media', 'mind-ui', 'mind-viz', 'mind', 'model', 'nurse-board', 'nurses',
  'people-logic', 'people-ui', 'plan-view', 'planner', 'plans-ui', 'plans', 'rota-codes', 'rota-parser', 'social-ui', 'social', 'store-alerts', 'store', 'today-model', 'xlsx-lite'];
const ASSETS = [...JS.map(f => `./js/${f}.js`), './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const NET_TIMEOUT = 2500;   // on weak signal ("lie-fi") serve the cached shell after 2.5 s instead of hanging on the fetch

const isFont = (u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

// Fonts: fetch the stylesheet (Google returns the right formats for this browser), cache it, and precache the latin
// font files it names; other subsets (cyrillic, greek…) are cached the first time a page needs them. Best effort: never fails the install.
async function cacheFonts() {
  try {
    const c = await caches.open(FONTS), res = await fetch(FONT_CSS, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return; await c.put(FONT_CSS, res.clone());
    const css = await res.text(), urls = [];
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{[^}]*?url\(([^)]+)\)/g)) if (m[1] === 'latin') urls.push(m[2].replace(/['"]/g, ''));
    if (!urls.length) for (const m of css.matchAll(/url\(([^)]+)\)/g)) urls.push(m[1].replace(/['"]/g, ''));   // no subset comments: take all
    await Promise.all([...new Set(urls)].map(async u => { if (!(await c.match(u))) { const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await c.put(u, r); } }));
  } catch { /* offline at install time: fonts get cached on first online use instead */ }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    await cacheFonts();
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// Fonts: cache first (they never change at a given URL); the stylesheet is refreshed in the background so a new font version arrives next time.
async function fontResponse(req) {
  const c = await caches.open(FONTS), hit = await c.match(req, { ignoreVary: true });
  const get = () => fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; });
  if (hit) { if (new URL(req.url).hostname === 'fonts.googleapis.com') get().catch(() => {}); return hit; }
  return get().catch(() => Response.error());
}

// Network first so a new release shows up at once; the cache is the offline (or slow-network) fallback.
// Only successful same-origin GETs are cached; only page navigations fall back to the app shell.
async function shellResponse(e) {
  const req = e.request, cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  let saved; const net = fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); saved = caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  });
  // keep the worker alive until a late network answer has refreshed the cache, even after the cached copy was served
  e.waitUntil(net.then(() => saved, () => {}).catch(() => {}));
  // race the network against a timer; on timeout use the cache if it has the file, otherwise keep waiting for the network
  const slow = new Promise(res => setTimeout(res, NET_TIMEOUT)).then(cached);
  try {
    return await Promise.race([net, slow.then(r => r || net)]);
  } catch {
    return (await cached()) || Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isFont(url)) return e.respondWith(fontResponse(req));
  if (url.origin !== location.origin) return;   // Google APIs, sign-in: straight to the network
  e.respondWith(shellResponse(e));
});
