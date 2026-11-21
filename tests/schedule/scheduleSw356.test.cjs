// v1.356 — the REAL public/sw.js executed in a sandbox with a fake service-worker global: push → notification, visible-window rule, iOS/test always shown,
// click → focus / open, and the existing offline-cache behaviour untouched. No browser, no network.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public', 'sw.js'), 'utf8')

function boot(ua, windows = []) {
  const listeners = {}
  const shown = [], messages = [], opened = []
  const win = (w) => ({ visibilityState: w.visible ? 'visible' : 'hidden', focused: false, focus: async function () { this.focused = true }, postMessage(m) { messages.push(m) } })
  const clientObjs = windows.map(win)
  const self = {
    navigator: { userAgent: ua },
    location: { origin: 'https://x.test' },
    addEventListener: (t, fn) => { listeners[t] = fn },
    registration: { showNotification: async (title, opts) => { shown.push({ title, opts }) } },
    clients: { matchAll: async () => clientObjs, openWindow: async (u) => { opened.push(u) }, claim: async () => {} },
    skipWaiting: async () => {},
  }
  const ctx = { self, caches: { open: async () => ({ add: async () => {} }), keys: async () => [], delete: async () => {}, match: async () => null }, Request: function () {}, URL, Response: { error: () => ({}) }, fetch: async () => ({}), console }
  vm.runInNewContext(SRC, ctx)
  const fire = async (type, ev) => { let p; await listeners[type]({ ...ev, waitUntil: x => { p = x } }); await p }
  const push = (data) => fire('push', { data: { json: () => data, text: () => JSON.stringify(data) } })
  const click = (data) => { let closed = false; return fire('notificationclick', { notification: { data, close: () => { closed = true } } }).then(() => closed) }
  return { listeners, shown, messages, opened, push, click, clientObjs, fire }
}
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
const REMINDER = { kind: 'reminder', title: '🔔 Study group', body: 'Starts in 5 minutes · Fri, Nov 20 · 3:00 PM', tag: 'xp-ev-abc', url: '/app?remind=e1&at=1', eventId: 'e1', occurrenceAt: 1 }

test('push while XPadite is CLOSED: a branded system notification with title, time, tag, icon, standard sound (silent:false) and the tap target', async () => {
  const sw = boot(CHROME, [])
  await sw.push(REMINDER)
  assert.equal(sw.shown.length, 1)
  const n = sw.shown[0]
  assert.equal(n.title, '🔔 Study group'); assert.match(n.opts.body, /Starts in 5 minutes/); assert.equal(n.opts.tag, 'xp-ev-abc')
  assert.equal(n.opts.icon, '/icons/icon-192.png'); assert.equal(n.opts.silent, false); assert.equal(n.opts.requireInteraction, true)
  assert.deepEqual({ ...n.opts.data }, { url: '/app?remind=e1&at=1', eventId: 'e1', occurrenceAt: 1 })
})
test('push while XPadite is open and VISIBLE (Chrome / Edge / Firefox): no second system notification — the in-app alert is told instead; a hidden window still gets a notification', async () => {
  for (const ua of [CHROME, ANDROID, FIREFOX]) {
    const vis = boot(ua, [{ visible: true }])
    await vis.push(REMINDER)
    assert.equal(vis.shown.length, 0, ua.slice(0, 30)); assert.equal(vis.messages[0].type, 'xp-reminder'); assert.equal(vis.messages[0].payload.eventId, 'e1')
    const hid = boot(ua, [{ visible: false }])
    await hid.push(REMINDER)
    assert.equal(hid.shown.length, 1); assert.equal(hid.messages.length, 1)
  }
})
test('Safari / iPhone always show the notification (Apple does not allow a silent push), and a TEST push is always shown', async () => {
  const iphone = boot(IPHONE, [{ visible: true }])
  await iphone.push(REMINDER); assert.equal(iphone.shown.length, 1)
  const t = boot(CHROME, [{ visible: true }])
  await t.push({ kind: 'test', title: 'XPadite test notification', body: 'ok', tag: 'xp-test', url: '/app' })
  assert.equal(t.shown.length, 1)
})
test('a malformed or empty push still shows a harmless notification (never throws) and never trusts an off-site tap URL', async () => {
  const sw = boot(CHROME, [])
  await sw.fire('push', { data: { json: () => { throw new Error('bad') }, text: () => 'plain text' } })
  assert.equal(sw.shown[0].title, 'XPadite'); assert.equal(sw.shown[0].opts.body, 'plain text')
  const sw2 = boot(CHROME, []); await sw2.push({ title: 'x', url: 'https://evil.example/phish' })
  assert.equal(sw2.shown[0].opts.data.url, '/app')
  const sw3 = boot(CHROME, []); await sw3.fire('push', {}); assert.equal(sw3.shown.length, 1)
})
test('tapping a notification focuses the open XPadite window and tells it which event to open; with no window it opens the event URL', async () => {
  const withWin = boot(CHROME, [{ visible: false }])
  const closed = await withWin.click({ url: '/app?remind=e1&at=1', eventId: 'e1', occurrenceAt: 1 })
  assert.equal(closed, true); assert.equal(withWin.clientObjs[0].focused, true)
  assert.equal(JSON.stringify(withWin.messages[0]), JSON.stringify({ type: 'xp-open-reminder', eventId: 'e1', occurrenceAt: 1 })); assert.equal(withWin.opened.length, 0)
  const none = boot(CHROME, [])
  await none.click({ url: '/app?remind=e1&at=1', eventId: 'e1' })
  assert.equal(JSON.stringify(none.opened), JSON.stringify(['/app?remind=e1&at=1']))
  const evil = boot(CHROME, []); await evil.click({ url: 'https://evil.example/' })
  assert.equal(JSON.stringify(evil.opened), JSON.stringify(['/app']))
})
test('the original service-worker behaviour is intact: install caches only /offline.html, navigations fall back to it, APIs are never intercepted', () => {
  const sw = boot(CHROME)
  assert.ok(sw.listeners.install && sw.listeners.activate && sw.listeners.fetch)
  let responded = null
  const mk = (url, mode = 'navigate', method = 'GET') => ({ request: { url, mode, method }, respondWith: p => { responded = p } })
  responded = null; sw.listeners.fetch(mk('https://x.test/api/push/subscribe')); assert.equal(responded, null)
  responded = null; sw.listeners.fetch(mk('https://x.test/app', 'cors')); assert.equal(responded, null)
  responded = null; sw.listeners.fetch(mk('https://x.test/app')); assert.ok(responded)
})
