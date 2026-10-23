// Server-side diagnostics for the Supabase service-role connection. Reports WHICH kind of problem occurred as a short,
// fixed code — never a key, URL, header, token or user data — so a misconfigured environment is told apart from a
// real "no subscription / no review" answer. Server-only.

export type AdminConfigIssue =
  | 'missing_url'        // NEXT_PUBLIC_SUPABASE_URL is not set
  | 'missing_key'        // SUPABASE_SERVICE_ROLE_KEY is not set
  | 'key_malformed'      // pasted with quotes / spaces / line breaks, or not a Supabase key at all
  | 'key_wrong_role'     // a JWT key whose role is not service_role (e.g. the anon key was pasted)
  | 'project_mismatch'   // a JWT key issued for a DIFFERENT Supabase project than NEXT_PUBLIC_SUPABASE_URL

export class AdminConfigError extends Error {
  constructor(public readonly code: AdminConfigIssue, message: string) {
    super(message)
    this.name = 'AdminConfigError'
  }
}

const MESSAGES: Record<AdminConfigIssue, string> = {
  missing_url: 'Supabase URL is not configured',
  missing_key: 'Supabase service-role is not configured',
  key_malformed: 'Supabase service-role key is malformed (check for quotes, spaces or line breaks)',
  key_wrong_role: 'Supabase service-role key does not have the service_role role',
  project_mismatch: 'Supabase service-role key belongs to a different project than NEXT_PUBLIC_SUPABASE_URL',
}

/** Project ref from "https://<ref>.supabase.co" (the ref is public — it is in every browser bundle). */
function projectRef(url: string): string | null {
  try { return new URL(url).hostname.split('.')[0] || null } catch { return null }
}

function decodeJwtClaims(token: string): { role?: unknown; ref?: unknown } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch { return null }
}

/**
 * Checks the service-role configuration WITHOUT calling Supabase and without exposing any value.
 * New-style secret keys (sb_secret_…) carry no project claim, so only their shape is checked.
 */
export function inspectAdminConfig(url: string | undefined, key: string | undefined): AdminConfigIssue | null {
  if (!url || !url.trim()) return 'missing_url'
  if (!key || !key.trim()) return 'missing_key'
  if (key !== key.trim() || /["'\s]/.test(key)) return 'key_malformed'
  if (key.startsWith('sb_secret_')) return null
  const claims = decodeJwtClaims(key)
  if (!claims) return 'key_malformed'
  if (claims.role !== 'service_role') return 'key_wrong_role'
  const urlRef = projectRef(url)
  if (typeof claims.ref === 'string' && urlRef && claims.ref !== urlRef) return 'project_mismatch'
  return null
}

export function adminConfigError(url: string | undefined, key: string | undefined): AdminConfigError | null {
  const issue = inspectAdminConfig(url, key)
  return issue ? new AdminConfigError(issue, MESSAGES[issue]) : null
}

export type DbFailure =
  | 'invalid_credentials'  // Supabase rejected the key (wrong/expired/other project)
  | 'missing_table'        // the table/column/function does not exist in THIS database (wrong project or migration not applied)
  | 'permission'           // row-level security / grants refused it
  | 'unavailable'          // network / timeout / server error
  | 'other'

/** Maps a Supabase/PostgREST error to a safe code. The raw message is never returned. */
export function classifyDbError(err: { message?: string; code?: string; status?: number } | null | undefined): DbFailure {
  const text = `${err?.message ?? ''} ${err?.code ?? ''}`
  if (/invalid api key|invalid jwt|jwt|apikey|PGRST301|PGRST300/i.test(text) || err?.status === 401) return 'invalid_credentials'
  if (/PGRST20[45]|42P01|42703|42883|does not exist|schema cache/i.test(text)) return 'missing_table'
  if (/42501|permission denied|row-level security/i.test(text) || err?.status === 403) return 'permission'
  if (/fetch failed|timeout|ECONN|ENOTFOUND|5\d\d/i.test(text) || (err?.status ?? 0) >= 500) return 'unavailable'
  return 'other'
}

/** A billing lookup that FAILED — distinct from "the user has no subscription". */
export class BillingLookupError extends Error {
  constructor(public readonly code: DbFailure, public readonly table: string) {
    super(`Billing lookup failed on ${table}: ${code}`)
    this.name = 'BillingLookupError'
  }
}

/** The stable, user-safe code for any error thrown while loading server data. */
export function failureCode(err: unknown): string {
  if (err instanceof AdminConfigError) return err.code
  if (err instanceof BillingLookupError) return err.code
  return 'unknown'
}
