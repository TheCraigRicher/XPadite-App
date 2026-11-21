// XPadite service worker — ONLINE-FIRST, deliberately minimal. (Web Push reminder handlers are at the bottom.)
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

// ── v1.356: Web Push reminders ────────────────────────────────────────────────────────────────────────────────────
// A push carries ONLY what the person would see anyway (event title and time) — no tokens, no account data. Nothing here touches the cache above.
// While XPadite is open and visible the in-app alert (with sound) handles the reminder, so Chrome / Edge / Firefox are not shown a second,
// system notification for the same thing. Safari / iOS always show one (Apple does not allow a push without a visible notification), and a
// "test" push always shows one so the system notification itself can be verified.
const CAN_SKIP_WHEN_VISIBLE = /(Chrome|Edg|Firefox)\//.test(self.navigator.userAgent) && !/(CriOS|FxiOS|EdgiOS)/.test(self.navigator.userAgent)

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { title: 'XPadite', body: event.data ? event.data.text() : '' } }
  const title = (typeof data.title === 'string' && data.title) ? data.title.slice(0, 150) : 'XPadite reminder'
  const url = (typeof data.url === 'string' && data.url.charAt(0) === '/') ? data.url : '/app'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of windows) c.postMessage({ type: 'xp-reminder', payload: { title: data.title, body: data.body, eventId: data.eventId, occurrenceAt: data.occurrenceAt, kind: data.kind } })
    const visible = windows.some((c) => c.visibilityState === 'visible')
    if (visible && CAN_SKIP_WHEN_VISIBLE && data.kind !== 'test') return
    await self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 64) : undefined,   // the same reminder replaces itself instead of stacking
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction: true,        // desktop: stays until dismissed; phones use their normal notification behaviour
      vibrate: [200, 100, 200],
      silent: false,                   // the device's standard notification sound, where the OS allows it
      data: { url: url, eventId: data.eventId, occurrenceAt: data.occurrenceAt },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const d = event.notification.data || {}
  const url = (typeof d.url === 'string' && d.url.charAt(0) === '/') ? d.url : '/app'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of windows) {
      if ('focus' in c) {
        await c.focus()
        c.postMessage({ type: 'xp-open-reminder', eventId: d.eventId, occurrenceAt: d.occurrenceAt })
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
