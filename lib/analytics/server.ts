// PostHog events sent from the App's server for CONFIRMED backend facts (checkout session created, verified Stripe
// events, trial start). Server-only — never import this from client code.
//
// CONSENT: every event about a user is sent only if that user has affirmatively opted in to analytics. The choice is
// persisted per user in public.analytics_consent (migration 018) and read here with the service-role client, so it is
// available to Stripe webhooks (no cookies, no session). No row, a false value, a missing table, or any lookup error
// means NO event — it fails closed. Analytics is strictly optional: it runs after the response (next/server `after`),
// swallows every failure, and never affects checkout, payment, entitlement, trial or webhook handling.
//
// Uses the same public project token as the browser (no private PostHog key). Events carry only the internal user id
// and business facts (plan key, mode, amount, currency): no email, name, or any user content.
// Omit NEXT_PUBLIC_POSTHOG_KEY (or set POSTHOG_SERVER_EVENTS=off) to switch these events off entirely.

import { createHash } from 'node:crypto'
import { PostHog } from 'posthog-node'
import { createAdminClient } from '@/lib/billing/admin'
import { TRIAL_DAYS } from '@/lib/billing/plans'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

export const serverEventsEnabled = (): boolean => Boolean(KEY) && process.env.POSTHOG_SERVER_EVENTS !== 'off'

/** Stable UUID derived from a business key, so a Stripe retry/duplicate delivery maps to the same PostHog event. */
export function stableEventId(key: string): string {
  const h = createHash('sha1').update(`xpadite:${key}`).digest()
  h[6] = (h[6] & 0x0f) | 0x50 // version 5 layout
  h[8] = (h[8] & 0x3f) | 0x80 // RFC 4122 variant
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** True only if this user has an analytics_consent row with analytics = true. Fails closed on any problem. */
export async function userHasAnalyticsConsent(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from('analytics_consent').select('analytics').eq('user_id', userId).maybeSingle()
    return !error && (data as { analytics?: boolean } | null)?.analytics === true
  } catch {
    return false
  }
}

/** The trial began recently enough (within the trial length) that reporting it now is not a back-fill of old history. */
export function withinTrialWindow(
  user: { email_confirmed_at?: string | null },
  now: number = Date.now(),
): boolean {
  const activatedAt = user.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN
  return Number.isFinite(activatedAt) && activatedAt <= now + 60_000 && now - activatedAt < TRIAL_DAYS * 86_400_000
}

let client: PostHog | null = null

type Props = Record<string, string | number | boolean | undefined>

/** Raw capture. Callers must already know the user has consented — prefer captureForUser. */
export async function captureServer(distinctId: string, event: string, properties: Props, eventKey?: string, timestamp?: Date): Promise<void> {
  if (!serverEventsEnabled() || !distinctId) return
  try {
    client ??= new PostHog(KEY!, { host: HOST, flushAt: 1, flushInterval: 0, disableGeoip: true })
    await Promise.race([
      client.captureImmediate({
        distinctId,
        event,
        ...(eventKey ? { uuid: stableEventId(eventKey) } : {}),
        ...(timestamp ? { timestamp } : {}),
        properties: { app_surface: 'app', ...properties },
      }),
      new Promise<void>(resolve => setTimeout(resolve, 2500)),
    ])
  } catch {
    /* analytics must never affect a request */
  }
}

/** Consent-checked capture for an authenticated or Stripe-verified user id. The only entry point for user events. */
export async function captureForUser(userId: string, event: string, properties: Props, eventKey?: string): Promise<void> {
  if (!serverEventsEnabled() || !userId) return
  if (!(await userHasAnalyticsConsent(userId))) return
  await captureServer(userId, event, properties, eventKey)
}
