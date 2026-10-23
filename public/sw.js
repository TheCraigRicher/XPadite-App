// XPadite service worker — ONLINE-FIRST, deliberately minimal.
//
// It caches exactly ONE thing: the static /offline.html page (no account data in it), shown only when a page
// NAVIGATION fails because the device is offline. Everything else is left to the browser untouched:
//   • no API / Supabase / Stripe / auth responses are ever stored or intercepted,
//   • no pages, scripts or user data are cached, so nothing private can survive in the cache or go stale.
const CACHE = 'xpadite-pwa-v2'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // Only top-level page loads (navigations), only GET, only our own origin, never API / auth routes.
  if (req.mode !== 'navigate' || req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())))
})
