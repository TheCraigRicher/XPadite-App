// Minimal service worker — satisfies PWA installability, no aggressive caching.
const CACHE = 'xpadite-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first passthrough — no offline caching.
  event.respondWith(fetch(event.request));
});
