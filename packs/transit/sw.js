const CACHE_NAME = 'nyc-transit-v3';
const PACK_SCOPE = '/packs/transit/';
const STATIC_ASSETS = [
  '/packs/transit/index.html',
  '/packs/transit/pwa-manifest.json',
  '/packs/transit/icon-192.svg',
  '/packs/transit/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only handle requests within the transit pack scope or /api/
  if (!url.pathname.startsWith(PACK_SCOPE) && !url.pathname.startsWith('/api/')) {
    return;
  }

  // API calls: network-first with no cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' },
    })));
    return;
  }

  // Static assets under /packs/transit/: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetched;
    }),
  );
});
