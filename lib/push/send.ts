/**
 * v1.356 — Web Push sending (server only). Wraps the `web-push` library so the rest of the code deals in plain results and the keys never leave
 * this file. VAPID_PRIVATE_KEY is read from the server environment only; it is never logged, returned or sent to the browser.
 */
import webpush from 'web-push'
import { topicOf, type PushPayload } from './payload'

export interface StoredSubscription { id: string; endpoint: string; p256dh: string; auth: string }

export type SendResult =
  | { ok: true }
  | { ok: false; /** the push service says this subscription no longer exists (404 / 410) — remove it */ gone: boolean; status: number | null; code: 'gone' | 'rate_limited' | 'rejected' | 'server' | 'network' }

export type PushSender = (sub: StoredSubscription, payload: PushPayload) => Promise<SendResult>

/** How long the push service may hold an undelivered reminder (seconds) — the same as the server catch-up window, so a late one is never "fresh". */
export const PUSH_TTL_SECONDS = 30 * 60

export function vapidEnv(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null
  return { publicKey, privateKey, subject }
}

/** A sender bound to the configured VAPID identity, or null when push is not configured (the caller then reports "not configured", never crashes). */
export function makeSender(): PushSender | null {
  const env = vapidEnv()
  if (!env) return null
  webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey)
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: PUSH_TTL_SECONDS, urgency: 'high', topic: topicOf(payload) },
      )
      return { ok: true }
    } catch (err) {
      const status = typeof (err as { statusCode?: unknown })?.statusCode === 'number' ? (err as { statusCode: number }).statusCode : null
      if (status === 404 || status === 410) return { ok: false, gone: true, status, code: 'gone' }
      if (status === 429) return { ok: false, gone: false, status, code: 'rate_limited' }
      if (status !== null && status >= 500) return { ok: false, gone: false, status, code: 'server' }
      if (status !== null) return { ok: false, gone: false, status, code: 'rejected' }
      return { ok: false, gone: false, status: null, code: 'network' }
    }
  }
}
