// A failed lookup / misconfigured database must NEVER turn a paying customer into "Free Trial"; the failure must be
// reported with a fixed, secret-free code. Also: review-photo and analytics-consent failure handling.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./_harness.cjs')
const { diagnostics: D, entitlement, makeAdmin, user, NOW, DAY, ROOT } = H
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// Fake (non-secret) JWT-shaped keys: only the payload claims matter to the checker.
const jwt = claims => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'c2lnbmF0dXJl'].join('.')
const URL_PROD = 'https://prodprojectref.supabase.co'

test('config: a key issued for ANOTHER project is detected as project_mismatch', () => {
  assert.equal(D.inspectAdminConfig(URL_PROD, jwt({ role: 'service_role', ref: 'devprojectref' })), 'project_mismatch')
  assert.equal(D.inspectAdminConfig(URL_PROD, jwt({ role: 'service_role', ref: 'prodprojectref' })), null)
})

test('config: missing / malformed / wrong-role keys are told apart', () => {
  assert.equal(D.inspectAdminConfig(undefined, 'k'), 'missing_url')
  assert.equal(D.inspectAdminConfig(URL_PROD, undefined), 'missing_key')
  assert.equal(D.inspectAdminConfig(URL_PROD, '   '), 'missing_key')
  const good = jwt({ role: 'service_role', ref: 'prodprojectref' })
  for (const bad of [`"${good}"`, `${good}\n`, ` ${good}`, `'${good}'`, 'not-a-key', 'a.b.c']) assert.equal(D.inspectAdminConfig(URL_PROD, bad), 'key_malformed', bad.slice(0, 12))
  assert.equal(D.inspectAdminConfig(URL_PROD, jwt({ role: 'anon', ref: 'prodprojectref' })), 'key_wrong_role')
  assert.equal(D.inspectAdminConfig(URL_PROD, 'sb_secret_abcdefghijklmnop'), null, 'new-style secret keys carry no project claim')
})

test('createAdminClient refuses a mismatched / missing key with a secret-free code', () => {
  const keep = { u: process.env.NEXT_PUBLIC_SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY }
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_PROD
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref: 'devprojectref' })
    assert.throws(() => H.admin.createAdminClient(), e => e.code === 'project_mismatch' && !e.message.includes('devprojectref') && !e.message.includes(process.env.SUPABASE_SERVICE_ROLE_KEY))
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    assert.throws(() => H.admin.createAdminClient(), e => e.code === 'missing_key' && /not configured/.test(e.message))
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref: 'prodprojectref' })
    assert.ok(H.admin.createAdminClient(), 'a matching key builds a client')
  } finally {
    keep.u === undefined ? delete process.env.NEXT_PUBLIC_SUPABASE_URL : (process.env.NEXT_PUBLIC_SUPABASE_URL = keep.u)
    keep.k === undefined ? delete process.env.SUPABASE_SERVICE_ROLE_KEY : (process.env.SUPABASE_SERVICE_ROLE_KEY = keep.k)
  }
})

test('database errors map to safe codes (never the raw message)', () => {
  const c = D.classifyDbError
  assert.equal(c({ message: 'Invalid API key' }), 'invalid_credentials')
  assert.equal(c({ message: 'JWT expired' }), 'invalid_credentials')
  assert.equal(c({ message: "Could not find the table 'public.reviews' in the schema cache", code: 'PGRST205' }), 'missing_table')
  assert.equal(c({ message: 'relation "billing_subscriptions" does not exist', code: '42P01' }), 'missing_table')
  assert.equal(c({ message: 'permission denied for table x', code: '42501' }), 'permission')
  assert.equal(c({ message: 'fetch failed' }), 'unavailable')
  assert.equal(c({ message: 'something odd' }), 'other')
})

// ── 1. Active paid subscription is returned ────────────────────────────────
const sub = (o = {}) => ({ user_id: 'user-1', plan_key: 'pro-monthly', status: 'active', current_period_end: new Date((NOW + 30 * DAY) * 1000).toISOString(), cancel_at_period_end: false, ...o })

test('1. an active Pro Monthly subscription is returned as PAID (not trial)', async () => {
  const st = await entitlement.getBillingStatus(makeAdmin({ billing_subscriptions: [sub()], billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] }), user)
  assert.equal(st.state, 'paid'); assert.equal(st.plan, 'pro-monthly'); assert.equal(st.hasStripeCustomer, true)
})

// ── 2. A database failure never becomes Free Trial ─────────────────────────
function failingAdmin(error) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error }), then: (res, rej) => Promise.resolve({ data: null, error }).then(res, rej) }
  return { from: () => q }
}

test('2. ANY failed billing lookup THROWS (no silent Free Trial), whichever table fails', async () => {
  for (const error of [{ message: 'Invalid API key' }, { message: 'relation does not exist', code: '42P01' }, { message: 'fetch failed' }]) {
    await assert.rejects(entitlement.getBillingStatus(failingAdmin(error), user), e => e instanceof D.BillingLookupError && typeof e.code === 'string')
  }
  // one table failing while the others succeed is still a failure
  const partial = makeAdmin({ billing_subscriptions: [sub()] })
  const realFrom = partial.from
  partial.from = name => name === 'billing_purchases' ? failingAdmin({ message: 'permission denied', code: '42501' }).from() : realFrom(name)
  await assert.rejects(entitlement.getBillingStatus(partial, user), D.BillingLookupError)
})

test('2b. a genuine "no subscription" answer is still a trial (unchanged rule)', async () => {
  const st = await entitlement.getBillingStatus(makeAdmin({}), user)
  assert.equal(st.state, 'trial'); assert.equal(st.plan, null)
})

test('2c. the status route reports a coded 500 for a failure (never a trial body); codes are fixed values', () => {
  const s = read('app/api/billing/status/route.ts')
  assert.ok(/const code = failureCode\(err\)/.test(s) && /\{ error: 'Could not load billing status\.', code \}, \{ status: 500 \}/.test(s))
  assert.ok(!/status: 'trial'|state: 'trial'/.test(s))
  assert.equal(D.failureCode(new D.AdminConfigError('project_mismatch', 'x')), 'project_mismatch')
  assert.equal(D.failureCode(new Error('secret=abc')), 'unknown')
})

// ── 3. Profile and Settings agree, and both show "unavailable" with retry ───
test('3. Profile and Settings read the same billing context and both handle "plan unavailable"', () => {
  const ctx = read('components/xpadite/BillingContext.tsx'), prof = read('components/xpadite/ProfileModal.tsx'), set = read('components/xpadite/SettingsModal.tsx')
  assert.ok(/statusError/.test(ctx) && /setStatusError\(body\?\.code \?\? `http_\$\{res\.status\}`\)/.test(ctx), 'failed fetch records a code')
  assert.ok(/setStatus\(next\)\s*setStatusError\(null\)/.test(ctx.replace(/\s+/g, ' ').replace('setStatus(next) setStatusError(null)', 'setStatus(next)\nsetStatusError(null)')), 'success clears it')
  assert.ok(prof.includes("title: 'Plan unavailable'") && prof.includes('billing?.refresh()'))
  assert.ok(ctx.includes('Plan unavailable') && ctx.includes('Retry'), 'Settings banner')
  assert.ok(/const planUnknown = !!billing && !billing\.status/.test(set) && /\|\| planUnknown/.test(set), 'cannot buy while the plan is unknown')
  for (const f of [prof, set]) assert.ok(!/Free Trial/.test(f.replace(/^\s*\/\/.*$/gm, '')) || f === set, 'Profile has no own plan text')
})

// ── 4/5. Review photo ───────────────────────────────────────────────────────
test('4. review photo route: consent OFF clears; consent ON copies; query errors are not "no review"', () => {
  const s = read('app/api/reviews/photo/route.ts')
  assert.ok(/if \(reviewError\) return fail\(503, `db_\$\{classifyDbError\(reviewError\)\}`\)/.test(s), 'an error is not "no review"')
  assert.ok(/if \(!review\) return fail\(404, 'review_not_found'\)/.test(s))
  assert.ok(/if \(!review\.show_profile_photo\) \{[\s\S]*?clearPublicCopy\(\)[\s\S]*?consent_off/.test(s))
  assert.ok(/reason: 'no_avatar'/.test(s))
  for (const code of ['avatar_download', 'avatar_unreadable', 'upload_failed', 'record_failed', 'clear_failed']) assert.ok(s.includes(`'${code}'`), code)
  assert.ok(/config_\$\{failureCode\(err\)\}/.test(s))
})

test('5. photo-sync failure is NOT reported as success', async () => {
  const C = require('node:module') && (() => {
    const ts = require('typescript')
    const out = path.join(ROOT, 'node_modules', '.cache', 'xpadite-failure-tests'); fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'client.js'), ts.transpileModule(read('lib/reviews/client.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
    return require(path.join(out, 'client.js'))
  })()
  const sb = { rpc: async () => ({ data: { id: 'r', status: 'published', show_profile_photo: true }, error: null }) }
  const prev = global.fetch
  try {
    for (const [impl, expectOk, expectReason] of [
      [async () => ({ ok: false, json: async () => ({ code: 'config_project_mismatch' }) }), false, undefined],
      [async () => { throw new Error('offline') }, false, undefined],
      [async () => ({ ok: true, json: async () => ({ ok: true, photo: true }) }), true, undefined],
      [async () => ({ ok: true, json: async () => ({ ok: true, photo: false, reason: 'no_avatar' }) }), true, 'no_avatar'],
    ]) {
      global.fetch = impl
      const r = await C.submitReview(sb, { rating: 5, body: 'A perfectly fine review body.', showPhoto: true })
      assert.equal(r.ok, true, 'the review itself is saved')
      assert.equal(r.photoSynced, expectOk); assert.equal(r.photoReason, expectReason)
    }
  } finally { global.fetch = prev }
  const m = read('components/xpadite/HelpFeedbackModal.tsx')
  const failBranch = m.slice(m.indexOf('if (res.photoSynced === false)'), m.indexOf('const noPhotoNote'))
  assert.ok(/kind: 'error'/.test(failBranch) && /could not be updated/.test(failBranch) && !/✓/.test(failBranch.replace(/setToast\([^)]*\)/, '')), 'error styling, no success tick in the message')
  assert.ok(/no profile photo yet/.test(m), 'consent ON but no avatar is explained, not silently "done"')
})

// ── 6. Analytics consent ────────────────────────────────────────────────────
test('6. analytics consent: unavailable server reports a coded 503; the browser keeps its own choice (no tracking without consent)', () => {
  const r = read('app/api/analytics/consent/route.ts')
  assert.ok(/status: 503/.test(r) && /\{ error: 'Unavailable', code \}/.test(r))
  assert.ok(/classifyDbError\(error\)/.test(r) && /config_\$\{failureCode\(err\)\}/.test(r))
  const sync = read('lib/analytics/consentSync.ts')
  assert.ok(/if \(!res\?\.ok\) return/.test(sync), 'a failed read changes nothing')
  assert.ok(/if \(res\?\.ok\) lastKnown = local\.analytics/.test(sync), 'a failed save is not recorded as saved')
  const srv = read('lib/analytics/server.ts')
  assert.ok(/return !error && \(data as \{ analytics\?: boolean \} \| null\)\?\.analytics === true/.test(srv) && /catch \{\s*return false/.test(srv), 'server-side tracking fails CLOSED')
})
