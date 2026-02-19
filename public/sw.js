const CACHE = 'thinkdone-v1';
const SHELL = [
  '/', '/manifest.json', '/icon-192.png',
  '/fonts/caveat-latin.woff2',
  '/fonts/patrick-hand-latin.woff2',
  '/fonts/inter-latin.woff2',
  '/fonts/ibm-plex-mono-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Auth redirects — let browser handle natively (preserves hash fragments)
  if (url.pathname.startsWith('/api/auth/')) return;
  // API calls always go to network
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Everything else: network-first with cache fallback
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
