const CACHE = 'citrus-maxima-career1';
const ASSETS = ['./', './index.html', './css/app.css', './js/app.js', './js/store.js', './js/google.js', './js/model.js', './js/planner.js', './js/inbound.js', './js/mind.js', './js/mind-viz.js', './js/mind-ui.js', './js/apps-ui.js', './js/media.js', './js/media-ui.js', './js/board.js', './js/social.js', './js/social-ui.js', './js/chores.js', './js/chores-ui.js', './js/labor.js', './js/labor-ui.js', './js/career.js', './js/career-ui.js', './js/nurses.js', './js/people-ui.js', './js/util.js', './js/rota-parser.js', './js/xlsx-lite.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network first so a new release shows up at once; the cache is the offline fallback.
// Only successful same-origin GETs are cached; only page navigations fall back to the app shell.
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // Google APIs, uploads: straight to the network
  e.respondWith(fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
