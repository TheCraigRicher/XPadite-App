// Trial identity (server-only). One person = one free trial, even if they delete their account and sign up again.
//
// The identity is a KEYED HMAC of the normalised, SERVER-VERIFIED email address. The raw email is never stored in the
// ledger, the HMAC secret (TRIAL_IDENTITY_SECRET) never leaves the server, and the ledger is only reachable through the
// service role. Registration is atomic in the database (billing_register_trial, migration 021), so simultaneous requests
// cannot create two independent trials.

import { createHmac } from 'node:crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export type TrialIdentityIssue = 'trial_secret_missing' | 'trial_secret_weak' | 'trial_register_failed' | 'trial_register_invalid'

export class TrialIdentityError extends Error {
  constructor(public readonly code: TrialIdentityIssue) {
    super(`Trial identity: ${code}`)
    this.name = 'TrialIdentityError'
  }
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Canonical form of an email for trial purposes.
 *  • always: trim, Unicode-normalise, lower-case.
 *  • Gmail / Googlemail ONLY (documented Google behaviour): dots and "+tag" in the local part do not change the mailbox,
 *    and the two domains are the same mailbox. NO such rule is applied to any other provider, so unrelated addresses are
 *    never merged. Returns null for anything that is not a single well-formed address.
 */
export function normalizeEmailIdentity(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const e = email.trim().normalize('NFKC').toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1 || at !== e.indexOf('@') || at === e.length - 1) return null
  let local = e.slice(0, at)
  let domain = e.slice(at + 1)
  if (/\s/.test(e) || !domain.includes('.')) return null
  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com'
    const plus = local.indexOf('+')
    if (plus >= 0) local = local.slice(0, plus)
    local = local.replace(/\./g, '')
    if (!local) return null
  }
  return `${local}@${domain}`
}

/** The HMAC key: TRIAL_IDENTITY_SECRET, at least 32 characters (e.g. `openssl rand -hex 32`). Never logged or returned. */
export function trialSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.TRIAL_IDENTITY_SECRET
  if (!s || !s.trim()) throw new TrialIdentityError('trial_secret_missing')
  if (s !== s.trim() || s.length < 32) throw new TrialIdentityError('trial_secret_weak')
  return s
}

export function identityHash(normalizedEmail: string, secret: string): string {
  return createHmac('sha256', secret).update(`xpadite-trial-v1:${normalizedEmail}`).digest('hex')
}

/** What the trial identity may be derived from: ONLY the verified identity the server read from the session. */
export type TrialUser = Pick<User, 'id' | 'email_confirmed_at' | 'created_at'> & { email?: string | null }

/**
 * Records this account's trial identity (once) and returns the account's EFFECTIVE trial start: the original start if this
 * identity was seen before (deleted-and-re-registered, Gmail alias), otherwise the account's own activation time.
 * Returns null when there is no verified email to derive an identity from (the caller keeps the per-account clock).
 * Throws TrialIdentityError when the secret/ledger is unavailable — callers must NOT treat that as "grant a new trial".
 */
export async function registerTrialIdentity(admin: SupabaseClient, user: TrialUser): Promise<Date | null> {
  const normalized = user.email_confirmed_at ? normalizeEmailIdentity(user.email) : null
  if (!normalized) return null
  const hash = identityHash(normalized, trialSecret())
  const activation = user.email_confirmed_at ?? user.created_at
  const { data, error } = await admin.rpc('billing_register_trial', { p_user: user.id, p_hash: hash, p_activation: new Date(activation).toISOString() })
  if (error) throw new TrialIdentityError('trial_register_failed')
  const start = typeof data === 'string' ? new Date(data) : null
  if (!start || Number.isNaN(start.getTime())) throw new TrialIdentityError('trial_register_invalid')
  return start
}
