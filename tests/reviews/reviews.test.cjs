// In-app Rate Us tests: eligibility, validation, submission contract with the shared backend, error mapping,
// Help & Feedback dismissal, and static guards on the migration. Mocks only — no network, no database.
// (The database behaviour itself — RLS, moderation, duplicates, hardening — is covered by the PGlite suite documented in the release notes.)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-reviews-tests')
fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync(path.join(ROOT, 'lib', 'reviews', 'client.ts'), 'utf8')
fs.writeFileSync(path.join(OUT, 'client.js'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const R = require(path.join(OUT, 'client.js'))
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const good = { rating: 5, title: 'Great', profession: 'Student', body: 'I really like how everything fits together.' }

test('validation: rating 1-5 and body 10-2000 characters, optional title/profession limits', () => {
  assert.equal(R.validateReview(good), null)
  for (const r of [0, 6, 2.5, NaN, undefined]) assert.match(R.validateReview({ ...good, rating: r }), /star rating/)
  assert.match(R.validateReview({ ...good, body: 'short' }), /at least 10/)
  assert.match(R.validateReview({ ...good, body: '         short   ' }), /at least 10/)          // trimmed before counting
  assert.match(R.validateReview({ ...good, body: 'x'.repeat(2001) }), /too long/)
  assert.equal(R.validateReview({ ...good, body: 'x'.repeat(2000) }), null)
  assert.match(R.validateReview({ ...good, title: 't'.repeat(101) }), /title is too long/)
  assert.match(R.validateReview({ ...good, profession: 'p'.repeat(61) }), /profession is too long/)
  assert.equal(R.validateReview({ rating: 1, body: 'Honestly not for me, too complicated.' }), null)   // negative reviews are fine
})

test('eligibility: only signed-in users with a confirmed email', () => {
  assert.equal(R.isEligibleUser(null), 'signed_out')
  assert.equal(R.isEligibleUser(undefined), 'signed_out')
  assert.equal(R.isEligibleUser({ email_confirmed_at: null }), 'unverified')
  assert.equal(R.isEligibleUser({}), 'unverified')
  assert.equal(R.isEligibleUser({ email_confirmed_at: '2026-01-01T00:00:00Z' }), 'ok')
})

function fakeSupabase({ data = null, error = null, row = null, rowError = null } = {}) {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => { calls.push({ name, args }); return { data, error } },
    from: table => ({ select: cols => ({ maybeSingle: async () => { calls.push({ table, cols }); return { data: row, error: rowError } } }) }),
  }
}

test('submit: calls ONLY submit_review with the review fields, source=app, and nothing privileged', async () => {
  const sb = fakeSupabase({ data: { id: 'r1', rating: 5, status: 'published' } })
  const res = await R.submitReview(sb, { ...good, title: '  Great ', profession: ' Student ', body: '  I really like how everything fits together.  ' })
  assert.equal(res.ok, true); assert.equal(res.held, false)
  assert.equal(sb.calls.length, 1)
  assert.equal(sb.calls[0].name, 'submit_review')
  assert.deepEqual(sb.calls[0].args, { p_rating: 5, p_title: 'Great', p_body: 'I really like how everything fits together.', p_source: 'app', p_profession: 'Student' })
  for (const forbidden of ['status', 'user_id', 'p_status', 'p_user_id', 'verified', 'source']) assert.ok(!(forbidden in sb.calls[0].args), forbidden + ' must never be sent by the client')
})

test('submit: empty optional fields are sent as null; pending reviews are reported as held', async () => {
  const sb = fakeSupabase({ data: { id: 'r2', rating: 3, status: 'pending' } })
  const res = await R.submitReview(sb, { rating: 3, title: '   ', profession: '', body: 'A perfectly ordinary review body.' })
  assert.equal(sb.calls[0].args.p_title, null); assert.equal(sb.calls[0].args.p_profession, null)
  assert.equal(res.ok, true); assert.equal(res.held, true)
})

test('submit: invalid input never reaches the backend', async () => {
  const sb = fakeSupabase({ data: {} })
  const res = await R.submitReview(sb, { rating: 0, body: 'short' })
  assert.equal(res.ok, false); assert.equal(res.code, 'invalid'); assert.equal(sb.calls.length, 0)
})

test('submit: backend errors map to clear messages (unverified, rate limit, unavailable, unknown)', async () => {
  const cases = [
    ['email_not_verified', 'email_not_verified', /verify your email/i],
    ['not_authenticated', 'not_authenticated', /sign in/i],
    ['rate_limited', 'rate_limited', /wait a few seconds/i],
    ['invalid_body', 'invalid_body', /10/],
    ['Could not find the function public.submit_review in the schema cache', 'unavailable', /not available yet/i],
    ['relation "public.reviews" does not exist', 'unavailable', /not available yet/i],
    ['something unexpected', 'failed', /try again/i],
  ]
  for (const [message, code, re] of cases) {
    const res = await R.submitReview(fakeSupabase({ error: { message } }), good)
    assert.equal(res.ok, false); assert.equal(res.code, code, message); assert.match(res.message, re)
    assert.ok(!/stack|sql|postgres|pgrst/i.test(res.message), 'no technical details shown to users')
  }
})

test('fetchMyReview: returns the caller\'s row, or null when none / unavailable', async () => {
  assert.equal((await R.fetchMyReview(fakeSupabase({ row: { id: 'r1', rating: 4 } }))).rating, 4)
  assert.equal(await R.fetchMyReview(fakeSupabase({ row: null })), null)
  assert.equal(await R.fetchMyReview(fakeSupabase({ rowError: { message: 'relation does not exist' } })), null)
})

test('Help & Feedback: no outside-click dismissal, × still closes, three tabs, support forms untouched', () => {
  const s = read('components/xpadite/HelpFeedbackModal.tsx')
  const overlay = s.slice(s.indexOf('return (\n    <div\n      className="fixed inset-x-0'), s.indexOf('<style>'))
  assert.ok(!/onClose/.test(overlay), 'overlay must not call onClose')
  assert.equal((s.match(/onClick=\{onClose\}/g) || []).length, 1, 'only the × button closes the modal')
  assert.ok(/onClick=\{onClose\}\s*aria-label="Close"/.test(s), 'the × button is the close control')
  assert.ok(!/Escape/.test(s), 'Escape does not close (and therefore never discards a draft)')
  for (const label of ['Report Problem', 'Feedback', 'Rate Us']) assert.ok(s.includes(`label: '${label}'`), label)
  assert.ok(s.includes("fetch('/api/support/submit'") && s.includes("form.set('attachment', attachment)"), 'support submission + screenshot attachment preserved')
  assert.ok(s.includes("submitReview(createClient()") && !/from\('reviews'\)\s*\.(insert|update|upsert|delete)/.test(s), 'reviews are written only through the shared submit function')
})

test('migration 019: hardening present, no destructive statements on data', () => {
  const m = read('supabase/migrations/019_reviews.sql')
  assert.ok(/revoke all on public\.public_reviews\s+from anon, authenticated/.test(m) && /revoke all on public\.public_review_stats from anon, authenticated/.test(m))
  assert.ok(/grant select on public\.public_reviews\s+to anon, authenticated/.test(m))
  assert.ok(/enable row level security/.test(m) && /revoke all on public\.reviews\s+from anon, authenticated/.test(m))
  const code = m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  // The only statements allowed to write review rows are the two guarded functions (submit_review, admin_set_review_status).
  const outside = code
    .replace(/create or replace function public\.submit_review\([\s\S]*?\n\$\$;/, '')
    .replace(/create or replace function public\.admin_set_review_status\([\s\S]*?\n\$\$;/, '')
  assert.ok(!/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b|\bupdate\s+public\.reviews\b|\binsert\s+into\s+public\.reviews\b/i.test(outside), 'no data-changing statements outside the guarded functions')
  assert.ok(/security definer set search_path = public/.test(m))
})
