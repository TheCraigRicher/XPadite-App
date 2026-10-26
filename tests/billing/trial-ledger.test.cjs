// One free trial per person (v1.308): the identity ledger, the entitlement integration, and the fail-safe behaviour.
// The database side (atomic SQL, privileges, billing_has_access) is covered by the isolated-Postgres suite described in the
// release notes; here the SQL is mirrored by an in-memory fake with the same semantics.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./_harness.cjs')
const { entitlement, trialIdentity: T, makeAdmin, diagnostics: D } = H

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const HR = 3_600_000, DAY = 24 * HR
const LAUNCH = Date.parse('2026-11-01T00:00:00-07:00')
const SECRET = 'a'.repeat(40)

async function withEnv(vars, fn) {
  const keep = {}
  for (const [k, v] of Object.entries(vars)) { keep[k] = process.env[k]; v === undefined ? delete process.env[k] : (process.env[k] = v) }
  try { return await fn() } finally { for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}
const ON = { BILLING_LAUNCH_AT: '2026-11-01T00:00:00-07:00', TRIAL_IDENTITY_SECRET: SECRET }

// In-memory mirror of billing_register_trial (021): ledger survives "account deletion"; clock is per account and never moves.
function ledgerDb({ failing = false } = {}) {
  const ledger = new Map(), clock = new Map()
  const admin = makeAdmin({}, async (name, args) => {
    if (name !== 'billing_register_trial') return { data: null, error: null }
    if (failing) return { data: null, error: { message: 'boom' } }
    // mirrors billing_register_trial (021): the EARLIEST applicable start wins — never a later one
    const ms = x => Date.parse(x), least = (a, b) => (ms(a) <= ms(b) ? a : b)
    const existing = clock.get(args.p_user)
    if (!ledger.has(args.p_hash)) ledger.set(args.p_hash, existing ? least(args.p_activation, existing) : args.p_activation)
    const eff = existing ? least(ledger.get(args.p_hash), existing) : ledger.get(args.p_hash)
    clock.set(args.p_user, eff)
    ledger.set(args.p_hash, least(ledger.get(args.p_hash), eff))
    return { data: eff, error: null }
  })
  return { admin, ledger, clock, deleteAccount: id => clock.delete(id) }   // deleting an account removes its clock only
}
const acct = (id, email, verifiedMs) => ({ id, email, email_confirmed_at: new Date(verifiedMs).toISOString(), created_at: new Date(verifiedMs).toISOString() })
async function status(db, user, nowMs, tables) {
  const real = Date.now; Date.now = () => nowMs
  try { return await withEnv(ON, () => entitlement.getBillingStatus(tables ? Object.assign(db.admin, {}) : db.admin, user)) } finally { Date.now = real }
}

// ── normalisation ───────────────────────────────────────────────────────────
test('normalisation: trim + lower-case everywhere; Gmail dots/+tags/googlemail collapse; other providers are NOT altered beyond case', () => {
  const n = T.normalizeEmailIdentity
  assert.equal(n('  Jane.Doe+promo@GMAIL.com '), 'janedoe@gmail.com')
  assert.equal(n('j.a.n.e.d.o.e@googlemail.com'), 'janedoe@gmail.com')
  assert.equal(n('jane.doe+news@gmail.com'), n('janedoe@gmail.com'))
  assert.equal(n('Jane.Doe+news@Example.COM'), 'jane.doe+news@example.com', 'no plus/dot stripping for other providers')
  assert.notEqual(n('a+1@outlook.com'), n('a@outlook.com'), 'plus-addresses elsewhere stay distinct')
  assert.notEqual(n('jane@gmail.com'), n('jane@example.com'), 'unrelated identities are never merged')
  for (const bad of ['', 'nope', '@x.com', 'a@', 'a@b', 'a@@b.com', 'a b@c.com', null, undefined, 42, '+@gmail.com', '...@gmail.com']) assert.equal(n(bad), null, String(bad))
})

test('hash: keyed (HMAC), deterministic, secret-dependent, never contains the email', () => {
  const a = T.identityHash('jane@gmail.com', SECRET), b = T.identityHash('jane@gmail.com', SECRET)
  assert.equal(a, b); assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, T.identityHash('jane@gmail.com', 'b'.repeat(40)))
  assert.notEqual(a, T.identityHash('jane2@gmail.com', SECRET))
  assert.ok(!a.includes('jane'))
})

test('secret: required, 32+ characters, no stray whitespace — else a coded error (never a silent default)', () => {
  assert.throws(() => T.trialSecret({}), e => e.code === 'trial_secret_missing')
  assert.throws(() => T.trialSecret({ TRIAL_IDENTITY_SECRET: 'short' }), e => e.code === 'trial_secret_weak')
  assert.throws(() => T.trialSecret({ TRIAL_IDENTITY_SECRET: SECRET + '\n' }), e => e.code === 'trial_secret_weak')
  assert.equal(T.trialSecret({ TRIAL_IDENTITY_SECRET: SECRET }), SECRET)
})

// ── behaviour ───────────────────────────────────────────────────────────────
test('first signup: exactly 120 hours; repeat sign-ins never move it', async () => {
  const db = ledgerDb(), v = LAUNCH + 5 * DAY, u = acct('u1', 'jane@example.com', v)
  const ends = new Set()
  for (const later of [60_000, 3 * HR, 40 * HR, 100 * HR]) ends.add((await status(db, u, v + later)).trialEndsAt)
  assert.equal(ends.size, 1); assert.equal(Date.parse([...ends][0]) - v, 120 * HR)
})

test('DELETE the account and register again with the same email: the ORIGINAL expiry stays — including when it has passed', async () => {
  const db = ledgerDb(), v = LAUNCH + 5 * DAY
  const first = await status(db, acct('old', 'jane@example.com', v), v + HR)
  db.deleteAccount('old')
  const again = acct('new', 'jane@example.com', v + 3 * DAY)               // signs up again 3 days later
  const s3 = await status(db, again, v + 3 * DAY + HR)
  assert.equal(s3.trialEndsAt, first.trialEndsAt, 'same expiry, not a new 5 days'); assert.equal(s3.state, 'trial')
  const late = acct('newer', 'jane@example.com', v + 9 * DAY)             // …or after the trial is over
  const s9 = await status(db, late, v + 9 * DAY + HR)
  assert.equal(s9.state, 'expired'); assert.equal(s9.hasAccess, false); assert.equal(s9.trialEndsAt, first.trialEndsAt)
})

test('Gmail aliases of one mailbox share one trial; different people get independent trials', async () => {
  const db = ledgerDb(), v = LAUNCH + 2 * DAY
  const a = await status(db, acct('a', 'jane.doe@gmail.com', v), v + HR)
  const alias = await status(db, acct('b', 'janedoe+trial2@gmail.com', v + 2 * DAY), v + 2 * DAY + HR)
  assert.equal(alias.trialEndsAt, a.trialEndsAt)
  const other = await status(db, acct('c', 'someone.else@gmail.com', v + 2 * DAY), v + 2 * DAY + HR)
  assert.equal(Date.parse(other.trialEndsAt) - (v + 2 * DAY), 120 * HR)
  // non-Gmail plus-addresses are different people to us
  const x = await status(db, acct('d', 'sam+a@example.com', v), v + HR), y = await status(db, acct('e', 'sam+b@example.com', v + DAY), v + DAY + HR)
  assert.notEqual(x.trialEndsAt, y.trialEndsAt)
})

test('changing email never restarts or extends the account\'s trial (the account clock is pinned)', async () => {
  const db = ledgerDb(), v = LAUNCH + 4 * DAY
  const before = await status(db, acct('u', 'first@example.com', v), v + HR)
  const after = await status(db, { ...acct('u', 'second@example.com', v), email_confirmed_at: new Date(v + 2 * DAY).toISOString() }, v + 2 * DAY + HR)
  assert.equal(after.trialEndsAt, before.trialEndsAt)
  assert.equal(db.ledger.size, 2, 'the new address is remembered too')
  // the OLD address, re-registered later by a new account, is still known
  const again = await status(db, acct('z', 'first@example.com', v + 6 * DAY), v + 6 * DAY + HR)
  assert.equal(again.state, 'expired')
})

test('pre-launch accounts keep the existing grandfathering: trial starts at the billing launch (also after delete + re-signup)', async () => {
  const db = ledgerDb(), old = Date.parse('2026-09-01T00:00:00Z')
  const s = await status(db, acct('p', 'early@example.com', old), LAUNCH + DAY)
  assert.equal(Date.parse(s.trialEndsAt), LAUNCH + 5 * DAY)
  db.deleteAccount('p')
  const back = await status(db, acct('p2', 'early@example.com', LAUNCH + 2 * DAY), LAUNCH + 2 * DAY + HR)
  assert.equal(Date.parse(back.trialEndsAt), LAUNCH + 5 * DAY, 'no fresh trial for the returning pre-launch identity')
})

test('concurrent first requests cannot create two independent trials', async () => {
  const db = ledgerDb(), v = LAUNCH + DAY
  const results = await Promise.all([0, 1, 2, 3, 4].map(i => status(db, acct('same', 'race@example.com', v), v + HR + i)))
  assert.equal(new Set(results.map(r => r.trialEndsAt)).size, 1); assert.equal(db.ledger.size, 1)
  // …nor two accounts of one identity racing each other
  const db2 = ledgerDb()
  const [r1, r2] = await Promise.all([status(db2, acct('x1', 'dup@gmail.com', v), v + HR), status(db2, acct('x2', 'd.up+z@gmail.com', v + HR), v + 2 * HR)])
  assert.equal(r1.trialEndsAt, r2.trialEndsAt)
})

test('paid subscribers keep paid access even if the ledger is broken; an active plan is not a trial', async () => {
  const db = ledgerDb({ failing: true }), v = LAUNCH + 5 * DAY, u = acct('pay', 'paid@example.com', v)
  const paidAdmin = makeAdmin({ billing_subscriptions: [{ user_id: 'pay', plan_key: 'pro-monthly', status: 'active', current_period_end: new Date(v + 30 * DAY).toISOString(), cancel_at_period_end: false }] }, async () => ({ data: null, error: { message: 'boom' } }))
  const real = Date.now; Date.now = () => v + 20 * DAY
  try {
    const s = await withEnv(ON, () => entitlement.getBillingStatus(paidAdmin, u))
    assert.equal(s.state, 'paid'); assert.equal(s.plan, 'pro-monthly')
  } finally { Date.now = real }
  void db
})

test('FAIL-SAFE: with enforcement on, an unpaid user whose identity cannot be checked gets an error — never a fresh trial', async () => {
  const v = LAUNCH + 5 * DAY, u = acct('u', 'who@example.com', v)
  await assert.rejects(status(ledgerDb({ failing: true }), u, v + HR), e => e.name === 'TrialIdentityError' && e.code === 'trial_register_failed')
  const real = Date.now; Date.now = () => v + HR
  try {
    await assert.rejects(withEnv({ ...ON, TRIAL_IDENTITY_SECRET: undefined }, () => entitlement.getBillingStatus(ledgerDb().admin, u)), e => e.code === 'trial_secret_missing')
    await assert.rejects(withEnv({ ...ON, TRIAL_IDENTITY_SECRET: 'short' }, () => entitlement.getBillingStatus(ledgerDb().admin, u)), e => e.code === 'trial_secret_weak')
  } finally { Date.now = real }
  assert.equal(D.failureCode(new T.TrialIdentityError('trial_secret_missing')), 'trial_secret_missing')
})

test('before enforcement (no BILLING_LAUNCH_AT) a ledger problem never breaks the app; identities are still recorded when it works', async () => {
  const v = Date.parse('2026-10-20T00:00:00Z'), u = acct('u', 'pre@example.com', v)
  const bad = await withEnv({ BILLING_LAUNCH_AT: undefined, TRIAL_IDENTITY_SECRET: undefined }, () => entitlement.getBillingStatus(ledgerDb().admin, u))
  assert.equal(bad.trialEndsAt, null); assert.equal(bad.enforcementActive, false)
  const db = ledgerDb()
  await withEnv({ BILLING_LAUNCH_AT: undefined, TRIAL_IDENTITY_SECRET: SECRET }, () => entitlement.getBillingStatus(db.admin, u))
  assert.equal(db.ledger.size, 1)
})

test('unverified or email-less accounts never create ledger entries (identity comes only from the verified session email)', async () => {
  const db = ledgerDb(), v = LAUNCH + DAY
  await status(db, { id: 'n', email: 'x@example.com', email_confirmed_at: null, created_at: new Date(v).toISOString() }, v + HR)
  await status(db, { id: 'm', email_confirmed_at: new Date(v).toISOString(), created_at: new Date(v).toISOString() }, v + HR)
  assert.equal(db.ledger.size, 0)
})

test('existing welcome/reminder behaviour: a returning identity gets neither a welcome nor a fresh countdown', async () => {
  const ts = require('typescript'), out = path.join(ROOT, 'node_modules', '.cache', 'xpadite-trial-ledger'); fs.mkdirSync(out, { recursive: true })
  for (const f of ['plans', 'trialReminder']) fs.writeFileSync(path.join(out, f + '.js'), ts.transpileModule(read(`lib/billing/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
  const R = require(path.join(out, 'trialReminder.js'))
  const db = ledgerDb(), v = LAUNCH + 5 * DAY
  await status(db, acct('old', 'back@example.com', v), v + HR); db.deleteAccount('old')
  const s = await status(db, acct('new', 'back@example.com', v + 3 * DAY), v + 3 * DAY + HR)
  assert.equal(R.welcomeEligible(s, v + 3 * DAY + HR), false, 'no welcome / confetti for someone already on their original trial')
  assert.equal(R.reminderFor(s, v + 3 * DAY + HR).stage, 4, 'the reminders follow the ORIGINAL clock')
})

test('wiring: status/checkout/guard all go through getBillingStatus; callback registers at verification (never blocks sign-in); deletion keeps the ledger', () => {
  assert.ok(/registerTrialIdentity\(createAdminClient\(\), user\)/.test(read('app/auth/callback/route.ts')))
  assert.ok(/try \{ await registerTrialIdentity[\s\S]*?catch \(err\)/.test(read('app/auth/callback/route.ts')), 'failure only logged')
  for (const f of ['app/api/billing/status/route.ts', 'app/api/stripe/checkout/route.ts', 'lib/billing/guard.ts']) assert.ok(read(f).includes('getBillingStatus(admin, user)'), f)
  const del = read('app/api/account/delete/route.ts')
  assert.ok(!/trial_ledger|billing_trial_clock/.test(del), 'the delete route does not touch the ledger')
  const mig = read('supabase/migrations/021_trial_ledger.sql')
  assert.ok(!/references auth\.users/.test(mig.slice(mig.indexOf('create table if not exists public.trial_ledger'), mig.indexOf('create table if not exists public.billing_trial_clock'))), 'ledger has no FK to users')
  assert.ok(/revoke all on public\.trial_ledger\s+from anon, authenticated/.test(mig) && /enable row level security/.test(mig))
  assert.ok(/revoke all on function public\.billing_register_trial\(uuid, text, timestamptz\) from public, anon, authenticated/.test(mig))
  assert.ok(/security definer\s+set search_path = ''/.test(mig))
  const forbidden = ['delete from public.calendar_days', 'drop table', 'truncate']
  for (const f of forbidden) assert.ok(!mig.toLowerCase().includes(f))
})

// ── v1.308 correction: email changes and missing timestamps ─────────────────
test('email change to an identity with an EARLIER trial: the account keeps the earliest start (shortened) — never extended', async () => {
  const db = ledgerDb(), t0 = LAUNCH + 1 * DAY, t1 = LAUNCH + 6 * DAY
  await status(db, acct('owner', 'old-address@example.com', t0), t0 + HR)                 // identity A used a trial from t0
  db.deleteAccount('owner')
  const before = await status(db, acct('mover', 'brand-new@example.com', t1), t1 + HR)    // a new account, verified later: its own 5 days
  assert.equal(Date.parse(before.trialEndsAt) - t1, 120 * HR)
  const after = await status(db, acct('mover', 'old-address@example.com', t1), t1 + 2 * HR) // moves to the address that already had a trial
  assert.equal(Date.parse(after.trialEndsAt) - t0, 120 * HR, 'back to the ORIGINAL window')
  assert.ok(Date.parse(after.trialEndsAt) < Date.parse(before.trialEndsAt), 'shortened, not restarted')
  assert.equal((await status(db, acct('mover', 'old-address@example.com', t1), t0 + 121 * HR)).state, 'expired')
})

test('email change to an identity with a LATER trial never extends the account; the ledger is lowered to the earliest start', async () => {
  const db = ledgerDb(), early = LAUNCH + 1 * DAY, late = LAUNCH + 8 * DAY
  const a = await status(db, acct('early', 'first@example.com', early), early + HR)
  await status(db, acct('someone', 'target@example.com', late), late + HR)
  const moved = await status(db, acct('early', 'target@example.com', early), late + 2 * HR)
  assert.equal(moved.trialEndsAt, a.trialEndsAt, 'unchanged')
  const newcomer = await status(db, acct('x', 'target@example.com', late + 3 * DAY), late + 3 * DAY + HR)
  assert.equal(newcomer.trialEndsAt, a.trialEndsAt, 'the identity now carries the earliest start')
})

test('a changed-to address inherits the account\'s earliest start (no clean slate through a new address)', async () => {
  const db = ledgerDb(), v = LAUNCH + 2 * DAY
  const a = await status(db, acct('acc', 'one@example.com', v), v + HR)
  await status(db, acct('acc', 'two@example.com', v), v + 2 * HR)
  db.deleteAccount('acc')
  const back = await status(db, acct('again', 'two@example.com', v + 3 * DAY), v + 3 * DAY + HR)
  assert.equal(back.trialEndsAt, a.trialEndsAt)
})

test('pre-launch handling is unchanged by the earliest-start rule', async () => {
  const db = ledgerDb(), old1 = Date.parse('2026-08-01T00:00:00Z'), old2 = Date.parse('2026-09-15T00:00:00Z')
  await status(db, acct('p1', 'pre1@example.com', old1), LAUNCH + HR)
  const moved = await status(db, acct('p1', 'pre2@example.com', old1), LAUNCH + 2 * HR)
  assert.equal(Date.parse(moved.trialEndsAt), LAUNCH + 5 * DAY)
  const other = await status(db, acct('p2', 'pre3@example.com', old2), LAUNCH + HR)
  assert.equal(Date.parse(other.trialEndsAt), LAUNCH + 5 * DAY)
})

test('missing/invalid account timestamps: with enforcement on an unpaid user gets an error (never "no clock = no limit"); paid users are fine', async () => {
  const db = ledgerDb()
  const noStamps = { id: 'ghost', email: 'ghost@example.com', email_confirmed_at: null, created_at: undefined }
  const garbage = { id: 'g', email: 'g@example.com', email_confirmed_at: 'not a date', created_at: 'also not' }
  for (const u of [noStamps, garbage]) {
    await assert.rejects(status(db, u, LAUNCH + DAY), e => e instanceof D.BillingLookupError && e.table === 'account_timestamp')
  }
  assert.equal(db.ledger.size, 0, 'nothing is registered for an account without a valid timestamp')
  // paid → fine
  const paidAdmin = makeAdmin({ billing_subscriptions: [{ user_id: 'g', plan_key: 'pro-monthly', status: 'active', current_period_end: new Date(LAUNCH + 30 * DAY).toISOString(), cancel_at_period_end: false }] })
  const real = Date.now; Date.now = () => LAUNCH + DAY
  try {
    const s = await withEnv(ON, () => entitlement.getBillingStatus(paidAdmin, garbage))
    assert.equal(s.state, 'paid')
    // before enforcement: no trial end, no error
    const pre = await withEnv({ BILLING_LAUNCH_AT: undefined, TRIAL_IDENTITY_SECRET: SECRET }, () => entitlement.getBillingStatus(makeAdmin({}), garbage))
    assert.equal(pre.trialEndsAt, null); assert.equal(pre.enforcementActive, false)
  } finally { Date.now = real }
})

test('migration: unknown users have no access; unregistered NEW accounts lose access after a grace; the marker is set once; legacy accounts are grandfathered', () => {
  const m = read('supabase/migrations/021_trial_ledger.sql')
  assert.ok(/if v_activated is null then return false; end if;/.test(m) && !/if v_activated is null then return true/.test(m))
  assert.ok(/'trial_ledger_since', now\(\)::text\)\s*on conflict \(key\) do nothing/.test(m))
  assert.ok(/v_activated >= v_since and now\(\) > v_activated \+ interval '10 minutes' then\s*return false/.test(m))
  assert.ok(/least\(c\.trial_start, excluded\.trial_start\)/.test(m) && !/on conflict \(user_id\) do nothing/.test(m), 'the clock can only move EARLIER')
})
