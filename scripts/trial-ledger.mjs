// Operator tool for the trial ledger (migration 021). Run it yourself with the PRODUCTION credentials in your shell
// environment — never committed, never run by CI:
//
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRIAL_IDENTITY_SECRET   (the same values Production uses)
//
//   node scripts/trial-ledger.mjs backfill            # DRY RUN: counts only, writes nothing
//   node scripts/trial-ledger.mjs backfill --apply    # records every existing VERIFIED account (idempotent, additive)
//   node scripts/trial-ledger.mjs forget someone@example.com   # privacy/erasure request: removes that identity's ledger row
//
// backfill never deletes or changes any user, profile, task, journal or billing data. It only calls
// billing_register_trial() — the same atomic function the app uses — for accounts oldest-first, so two accounts that are
// really one identity (e.g. Gmail aliases) end up sharing the EARLIEST start. Re-running it changes nothing.
// It prints counts only: never emails, hashes, keys or the secret.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Reuse the app's own normalisation + hashing so the script can never drift from it.
const src = readFileSync(path.join(root, 'lib/billing/trialIdentity.ts'), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('require', 'module', 'exports', js)(require, mod, mod.exports)
const { normalizeEmailIdentity, identityHash, trialSecret } = mod.exports

const [, , command, arg] = process.argv
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
let secret
try { secret = trialSecret() } catch (e) { console.error('TRIAL_IDENTITY_SECRET is missing or too short (needs 32+ characters).'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function allUsers() {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('listUsers failed: ' + error.message)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  return users
}

if (command === 'backfill') {
  const apply = process.argv.includes('--apply')
  const users = (await allUsers()).filter(u => u.email && u.email_confirmed_at)
    .sort((a, b) => Date.parse(a.email_confirmed_at) - Date.parse(b.email_confirmed_at))
  const identities = new Set()
  let registered = 0, failed = 0
  for (const u of users) {
    const norm = normalizeEmailIdentity(u.email)
    if (!norm) continue
    const hash = identityHash(norm, secret)
    identities.add(hash)
    if (!apply) continue
    const { error } = await admin.rpc('billing_register_trial', { p_user: u.id, p_hash: hash, p_activation: new Date(u.email_confirmed_at).toISOString() })
    if (error) failed++; else registered++
  }
  console.log(`verified accounts: ${users.length} | distinct identities: ${identities.size} | merged duplicates: ${users.length - identities.size}`)
  console.log(apply ? `registered: ${registered} | failed: ${failed}${failed ? '  (re-run; it is idempotent)' : ''}` : 'DRY RUN — nothing written. Add --apply to record them.')
  process.exit(failed ? 1 : 0)
} else if (command === 'forget' && arg) {
  const norm = normalizeEmailIdentity(arg)
  if (!norm) { console.error('Not a valid email address.'); process.exit(1) }
  const { error, count } = await admin.from('trial_ledger').delete({ count: 'exact' }).eq('identity_hash', identityHash(norm, secret))
  if (error) { console.error('Failed: ' + error.message); process.exit(1) }
  console.log(`removed ${count ?? 0} ledger row(s). (A live account keeps its own pinned trial clock; this only forgets the identity.)`)
} else {
  console.error('Usage: node scripts/trial-ledger.mjs backfill [--apply] | forget <email>')
  process.exit(1)
}
