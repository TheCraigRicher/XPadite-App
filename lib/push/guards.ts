/**
 * v1.356 — request guards for the push routes (server only, pure so they can be unit-tested).
 */
import { timingSafeEqual } from 'node:crypto'

/**
 * The scheduler authenticates with `Authorization: Bearer <CRON_SECRET>` — HEADER ONLY (a secret in a URL ends up in logs).
 * FAIL CLOSED: with no CRON_SECRET configured nothing is authorised (unlike the older task-reminder route, which warns and allows).
 */
export function isCronAuthorized(authHeader: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false
  const m = /^Bearer (.+)$/.exec(authHeader ?? '')
  if (!m) return false
  const a = Buffer.from(m[1]), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Browsers hand out push endpoints on their vendor's push service only. The server POSTs to whatever endpoint is stored, so only those hosts are accepted. */
const PUSH_HOSTS: Array<(h: string) => boolean> = [
  h => h === 'fcm.googleapis.com',                                  // Chrome, Edge, Brave, Opera, Samsung Internet (FCM)
  h => h === 'updates.push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com'),   // Firefox
  h => h.endsWith('.notify.windows.com'),                          // Edge / Windows WNS
  h => h === 'web.push.apple.com' || h.endsWith('.push.apple.com'), // Safari / iOS / iPadOS
]

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 2048) return false
  let u: URL
  try { u = new URL(endpoint) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return PUSH_HOSTS.some(ok => ok(host))
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/

export interface ParsedSubscription { endpoint: string; p256dh: string; auth: string }

/** Validate a browser PushSubscription.toJSON() body. Returns null for anything malformed. */
export function parseSubscription(body: unknown): ParsedSubscription | null {
  const s = (body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } } | null)?.subscription
  if (!s || !isAllowedPushEndpoint(s.endpoint)) return null
  const p256dh = s.keys?.p256dh, auth = s.keys?.auth
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null
  if (p256dh.length < 20 || p256dh.length > 200 || auth.length < 8 || auth.length > 100) return null
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) return null
  return { endpoint: s.endpoint, p256dh, auth }
}

/** At most this many devices per account; the oldest are dropped first. */
export const MAX_DEVICES_PER_USER = 10
