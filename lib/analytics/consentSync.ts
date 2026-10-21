// Keeps the browser's analytics choice and the server's persisted copy (public.analytics_consent) in step, so the
// server can respect consent in places the browser never reaches (Stripe webhooks). Browser-only; every call is
// best-effort and silent — if it fails, the server simply keeps treating the user as "not consented".
//
//  - Signed in, local choice exists and differs from the server  → push the local choice (covers decline/withdraw).
//  - Signed in, no local choice but the server has one           → adopt the server's (same user, another device).
//  - The server only ever acts on the verified session user, so this cannot change anyone else's consent.

import { getConsentSnapshot, saveConsent } from './consent'

let lastKnown: boolean | null | undefined // what we believe the server holds; undefined = not fetched yet

export function forgetSyncState(): void {
  lastKnown = undefined
}

async function request(init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch('/api/analytics/consent', { cache: 'no-store', credentials: 'same-origin', ...init })
  } catch {
    return null
  }
}

/** Reconcile once a user is signed in (and again after the local choice changes). */
export async function syncConsent(): Promise<void> {
  const local = getConsentSnapshot()
  if (lastKnown === undefined) {
    const res = await request()
    if (!res?.ok) return // not signed in / table not applied / offline: leave everything as is
    const body = (await res.json().catch(() => null)) as { analytics?: boolean | null } | null
    lastKnown = typeof body?.analytics === 'boolean' ? body.analytics : null
  }
  if (!local) {
    if (lastKnown !== null) saveConsent(lastKnown) // adopt: the effect that follows sees no difference and does not push
    return
  }
  if (local.analytics === lastKnown) return
  const res = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: local.analytics }) })
  if (res?.ok) lastKnown = local.analytics
}
