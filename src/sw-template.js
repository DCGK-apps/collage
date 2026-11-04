/* Collage service worker – generated at build time (see vite.config.ts).
 * Caches the app shell for offline use. A new version waits until the user
 * taps "Odśwież" in the app (no surprise reloads while editing). */
const VERSION = '__VERSION__';
const CACHE = `collage-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  // `cache: 'reload'` bypasses the HTTP cache, so a new version never stores stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('collage-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // App shell: serve the cached version of this release; the page itself is the
  // entry point, so navigations fall back to the cached index.html.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      return fetch(req);
    }),
  );
});
