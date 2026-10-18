import type { SupabaseClient } from '@supabase/supabase-js'

// Server-only. Billing launch configuration.

/**
 * BILLING_LAUNCH_AT — explicit ISO-8601 timestamp (with timezone, e.g.
 * 2026-11-01T00:00:00-07:00) of the official billing launch. Never inferred
 * from deployment time. Returns null when absent or invalid, in which case the
 * paywall is NOT enforced (fail-safe: existing users are never locked out by a
 * missing/typo'd value).
 */
export function getBillingLaunchAt(): Date | null {
  const raw = process.env.BILLING_LAUNCH_AT?.trim()
  if (!raw) return null
  // Require an explicit timezone designator so the instant is unambiguous.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    console.error('[Billing] BILLING_LAUNCH_AT must be ISO-8601 with a timezone — paywall NOT enforced')
    return null
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    console.error('[Billing] BILLING_LAUNCH_AT is not a valid date — paywall NOT enforced')
    return null
  }
  return d
}

export function isPaywallDisabled(): boolean {
  return process.env.BILLING_PAYWALL_DISABLED === 'true'
}

let lastSynced = ''
let lastSyncedAt = 0

/**
 * Mirrors the env configuration into billing_config so the database-level
 * paywall (billing_has_access) uses the same launch date as the app. An invalid
 * or absent launch date is written as empty → the database fails open too.
 * Throttled; failures are logged and never block the request.
 */
export async function syncBillingConfig(admin: SupabaseClient): Promise<void> {
  const launch = getBillingLaunchAt()?.toISOString() ?? ''
  const disabled = isPaywallDisabled() ? 'true' : 'false'
  const signature = `${launch}|${disabled}`
  if (signature === lastSynced && Date.now() - lastSyncedAt < 60_000) return
  try {
    const now = new Date().toISOString()
    const { error } = await admin.from('billing_config').upsert([
      { key: 'launch_at', value: launch || null, updated_at: now },
      { key: 'paywall_disabled', value: disabled, updated_at: now },
    ], { onConflict: 'key' })
    if (error) throw new Error(error.message)
    lastSynced = signature
    lastSyncedAt = Date.now()
  } catch (err) {
    console.error('[Billing] could not sync billing_config:', err instanceof Error ? err.message : err)
  }
}
