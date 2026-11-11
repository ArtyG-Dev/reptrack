/* RepTrack service worker — offline-first app shell.
 * Strategy: precache the whole shell on install, serve cache-first, revalidate
 * in the background. The app never talks to a network at runtime, so a cache
 * miss only ever happens for a file we forgot to list in PRECACHE.
 */
const CACHE = 'reptrack-shell-v9';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/backdrop.js',
  './js/backdrop-gl.js',
  './js/gl.js',
  './js/theme-engine.js',
  './js/graphic-view.js',
  './js/reminders.js',
  './js/wake.js',
  './js/consistency.js',
  './js/db.js',
  './js/store.js',
  './js/ui.js',
  './js/state.js',
  './js/parser.js',
  './js/voice.js',
  './js/progression.js',
  './js/summary.js',
  './js/chart.js',
  './js/exercises-seed.js',
  './js/views/today.js',
  './js/views/diary.js',
  './js/views/progress.js',
  './js/views/exercises.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations always resolve to the cached shell so a cold offline launch works.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try { return await fetch(req); } catch { return Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) {
      // Refresh quietly; failure is expected and fine when offline.
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
