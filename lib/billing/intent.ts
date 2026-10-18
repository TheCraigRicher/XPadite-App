/**
 * Purchase intent — the plan a visitor chose on the Website (/signup?plan=<key>) and must not lose while they
 * sign up, verify their email, sign in or get redirected.
 *
 * This only ever carries a plan KEY. It is validated against the server allowlist in ./plans (the same one the
 * checkout endpoint uses); amounts, Price IDs and entitlements never travel through it. It selects WHICH Checkout
 * to start — it grants nothing. Pure and dependency-free so it is safe in middleware, server and client code.
 */

import { isBillingPlanKey, type BillingPlanKey } from './plans'

/** An intent stored in the user's auth metadata stops being honoured after this long. */
export const INTENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function parsePlan(v: unknown): BillingPlanKey | null {
  return typeof v === 'string' && isBillingPlanKey(v) ? v : null
}

/** `?plan=<key>` for a valid key, otherwise an empty string (never echoes unvalidated input). */
export function planQuery(plan: BillingPlanKey | null): string {
  return plan ? `?plan=${plan}` : ''
}

/**
 * Same-origin post-login destination only. Anything that is not a plain path under /app (absolute URLs,
 * protocol-relative `//host`, backslashes, control characters, other sections) falls back to /app.
 */
export function safeNext(v: unknown, fallback = '/app'): string {
  if (typeof v !== 'string' || v.length > 300) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback
  if (!v.startsWith('/') || v.startsWith('//')) return fallback
  try {
    const u = new URL(v, 'http://localhost')
    if (u.origin !== 'http://localhost') return fallback
    if (u.pathname !== '/app' && !u.pathname.startsWith('/app/')) return fallback
    return u.pathname + u.search
  } catch {
    return fallback
  }
}

/**
 * Plan stored on the account at sign-up (user_metadata.pending_plan + pending_plan_at). This is what lets the
 * plan survive email verification done on another device or browser. Expired or malformed values are ignored.
 */
export function pendingPlanFromMetadata(meta: Record<string, unknown> | null | undefined, now = Date.now()): BillingPlanKey | null {
  const plan = parsePlan(meta?.pending_plan)
  if (!plan) return null
  const at = typeof meta?.pending_plan_at === 'number' ? meta.pending_plan_at : NaN
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > INTENT_MAX_AGE_MS) return null
  return plan
}
