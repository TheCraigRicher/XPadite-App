/**
 * v1.356 — browser side of Web Push reminders. Client only.
 *
 * Permission is requested ONLY inside enablePush(), which must be called from a click/tap (the Reminders dialog's button) — never on page load,
 * and never again after the person has said No (the browser then reports 'denied' and we only explain how to change it).
 */

export type PushSupport = 'ok' | 'unsupported' | 'ios-install'

export interface PushState {
  support: PushSupport
  permission: NotificationPermission | 'unsupported'
  /** this browser has a push subscription registered with the server for this account */
  subscribed: boolean
  /** the server has the VAPID keys / migration in place (null = not asked / unknown) */
  configured: boolean | null
}

const isIos = (): boolean => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const isStandalone = (): boolean => typeof window !== 'undefined' && (((navigator as Navigator & { standalone?: boolean }).standalone === true) || window.matchMedia?.('(display-mode: standalone)').matches === true)

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  // iPhone / iPad only allow Web Push for an app added to the Home Screen (iOS / iPadOS 16.4+)
  if (isIos() && !isStandalone()) return 'ios-install'
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'ok' : 'unsupported'
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (existing) return existing
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  } catch { return null }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await registration()
  if (!reg) return null
  if (reg.active) return reg
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), 8000))]) } catch { return null }
}

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getPushState(): Promise<PushState> {
  const support = pushSupport()
  const permission: PushState['permission'] = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  if (support !== 'ok') return { support, permission, subscribed: false, configured: null }
  let subscribed = false, configured: boolean | null = null
  try {
    const reg = await registration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      const r = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { credentials: 'same-origin', cache: 'no-store' })
      if (r.ok) { const j = await r.json() as { configured?: boolean; subscribed?: boolean }; subscribed = !!j.subscribed; configured = j.configured ?? null }
    } else {
      const r = await fetch('/api/push/subscribe', { credentials: 'same-origin', cache: 'no-store' })
      if (r.ok) configured = ((await r.json()) as { configured?: boolean }).configured ?? null
    }
  } catch { /* offline: leave unknown */ }
  return { support, permission, subscribed, configured }
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios-install' | 'denied' | 'dismissed' | 'not_configured' | 'no_service_worker' | 'server' }

/** Turn reminders on for THIS device. Call only from a click / tap. */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport()
  if (support !== 'ok') return { ok: false, reason: support }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) return { ok: false, reason: 'not_configured' }

  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (perm === 'denied') return { ok: false, reason: 'denied' }
  if (perm !== 'granted') return { ok: false, reason: 'dismissed' }

  const reg = await readyRegistration()
  if (!reg) return { ok: false, reason: 'no_service_worker' }
  let sub: PushSubscription
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) })
  } catch {
    // a subscription made with a different key blocks a new one: drop it and retry once
    try { await (await reg.pushManager.getSubscription())?.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }) }
    catch { return { ok: false, reason: 'server' } }
  }
  const r = await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
  if (r.status === 503) return { ok: false, reason: 'not_configured' }
  if (!r.ok) return { ok: false, reason: 'server' }
  return { ok: true }
}

/** Turn reminders off for THIS device: removes it from the server, then drops the browser subscription. */
export async function disablePush(): Promise<boolean> {
  try {
    const reg = await registration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await fetch('/api/push/subscribe', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
      await sub.unsubscribe()
    }
    return true
  } catch { return false }
}

export type TestPushResult = 'sent' | 'no_device' | 'not_configured' | 'too_fast' | 'failed'

/** Ask the server to push ONE test notification to this device (does not touch any event or reminder). */
export async function sendTestPush(): Promise<TestPushResult> {
  try {
    const reg = await registration()
    const sub = await reg?.pushManager.getSubscription()
    const r = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}) })
    if (r.status === 429) return 'too_fast'
    if (r.status === 503) return 'not_configured'
    if (r.status === 404) return 'no_device'
    const j = await r.json() as { ok?: boolean }
    return r.ok && j.ok ? 'sent' : 'failed'
  } catch { return 'failed' }
}
