// One personal 5-day trial per account + the first-time welcome. The clock is the existing server-side one
// (max(email verification, billing launch) + 120h) — these tests prove it behaves as a per-account, immutable trial.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const H = require('./_harness.cjs')
const { entitlement, makeAdmin } = H

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-trial-welcome'); fs.mkdirSync(OUT, { recursive: true })
for (const f of ['plans', 'trialReminder']) fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`lib/billing/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const R = require(path.join(OUT, 'trialReminder.js'))

const HR = 3_600_000, D = 24 * HR
const LAUNCH = Date.parse('2026-11-01T00:00:00-07:00')
const withLaunch = async fn => { const keep = process.env.BILLING_LAUNCH_AT; process.env.BILLING_LAUNCH_AT = '2026-11-01T00:00:00-07:00'; try { return await fn() } finally { keep === undefined ? delete process.env.BILLING_LAUNCH_AT : (process.env.BILLING_LAUNCH_AT = keep) } }
async function statusAt(nowMs, user, tables = {}) {
  const real = Date.now; Date.now = () => nowMs
  try { return await withLaunch(() => entitlement.getBillingStatus(makeAdmin(tables), user)) } finally { Date.now = real }
}
const account = iso => ({ id: 'u', email_confirmed_at: iso, created_at: iso })

test('first onboarding AFTER launch: a personal trial of exactly 120 hours from the moment the account was verified', async () => {
  const verified = LAUNCH + 9 * D + 5 * HR + 17 * 60_000
  const st = await statusAt(verified + 60_000, account(new Date(verified).toISOString()))
  assert.equal(st.state, 'trial'); assert.equal(Date.parse(st.trialEndsAt) - verified, 120 * HR)
})

test('the trial is IMMUTABLE: repeat sign-ins, reinstalls and other devices (any later time) never move the end', async () => {
  const verified = LAUNCH + 3 * D, u = account(new Date(verified).toISOString())
  const ends = new Set()
  for (const later of [1, 30, 3 * HR, 25 * HR, 70 * HR, 119 * HR]) ends.add((await statusAt(verified + later * (later < 100 ? 1 : 1), u)).trialEndsAt)
  assert.equal(ends.size, 1, 'one fixed end time')
  assert.equal(Date.parse([...ends][0]), verified + 120 * HR)
  // sign-in metadata is not an input to the clock
  assert.ok(!/last_sign_in/.test(read('lib/billing/entitlement.ts')))
})

test('each user gets their OWN trial: the global launch date does not become a shared start for later signups', async () => {
  const a = LAUNCH + 2 * D, b = LAUNCH + 20 * D
  const sa = await statusAt(a, account(new Date(a).toISOString())), sb = await statusAt(b, account(new Date(b).toISOString()))
  assert.equal(Date.parse(sb.trialEndsAt) - Date.parse(sa.trialEndsAt), b - a)
})

test('exact expiry timing: trial at 119h59m, expired at 120h; access ends exactly then', async () => {
  const verified = LAUNCH + 4 * D, u = account(new Date(verified).toISOString())
  assert.equal((await statusAt(verified + 120 * HR - 60_000, u)).state, 'trial')
  const ex = await statusAt(verified + 120 * HR, u)
  assert.equal(ex.state, 'expired'); assert.equal(ex.hasAccess, false)
})

test('pre-launch (existing) accounts are grandfathered: their 5 days start at the billing launch, not at their old sign-up', async () => {
  const old = account('2026-09-01T00:00:00Z')
  const st = await statusAt(LAUNCH + 1 * D, old)
  assert.equal(Date.parse(st.trialEndsAt), LAUNCH + 5 * D); assert.equal(st.state, 'trial')
  assert.equal((await statusAt(LAUNCH + 5 * D + 1, old)).state, 'expired')
})

test('paid users are never in a trial state; expired users keep the existing paywall state', async () => {
  const verified = LAUNCH + 4 * D, u = account(new Date(verified).toISOString())
  const paid = await statusAt(verified + 130 * HR, u, { billing_subscriptions: [{ user_id: 'u', plan_key: 'pro-monthly', status: 'active', current_period_end: new Date(verified + 60 * D).toISOString(), cancel_at_period_end: false }] })
  assert.equal(paid.state, 'paid')
  assert.equal(R.welcomeEligible(paid, verified + 130 * HR), false); assert.equal(R.reminderFor(paid, verified + 130 * HR), null)
  const expired = await statusAt(verified + 130 * HR, u)
  assert.equal(expired.state, 'expired'); assert.equal(R.welcomeEligible(expired, verified + 130 * HR), false)
})

const trial = (verifiedMs, o = {}) => ({ state: 'trial', enforcementActive: true, trialEndsAt: new Date(verifiedMs + 120 * HR).toISOString(), ...o })

test('welcome eligibility: only a trial that JUST began (within 24h of its server start)', () => {
  const v = LAUNCH + 5 * D
  assert.equal(R.welcomeEligible(trial(v), v + 30_000), true, 'first minute')
  assert.equal(R.welcomeEligible(trial(v), v + 23 * HR), true)
  assert.equal(R.welcomeEligible(trial(v), v + 24 * HR), false, 'a day in: existing, not new')
  assert.equal(R.welcomeEligible(trial(v), v + 3 * D), false, 'Day 3+ gets reminders, never a welcome')
  assert.equal(R.welcomeEligible(trial(v), v - 120_000), false, 'not before the start')
  assert.equal(R.welcomeEligible(trial(v, { enforcementActive: false }), v + 1000), false)
  assert.equal(R.welcomeEligible(trial(v, { trialEndsAt: null }), v + 1000), false)
  assert.equal(R.welcomeEligible(null, v), false)
})

test('welcome and Day 3/4/5 reminders can never both be due (disjoint windows) and the UI also hides the reminder while the welcome shows', () => {
  const v = LAUNCH
  for (let h = 0; h < 120; h += 0.5) assert.ok(!(R.welcomeEligible(trial(v), v + h * HR) && R.reminderFor(trial(v), v + h * HR)), h + 'h')
  const app = read('components/xpadite/XpaditeApp.tsx')
  assert.ok(/<TrialReminderBanner suppressed=\{anotherScreenOpen \|\| welcomeVisible\}/.test(app) && /<TrialWelcome suppressed=\{anotherScreenOpen\} onVisibleChange=\{setWelcomeVisible\}/.test(app))
})

function store(init = {}) { const m = { ...init }; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v }, m } }
test('welcome is shown ONCE per account: refresh/sign-in/reinstall (local marker) and another device (account marker) never replay it', () => {
  const s = store()
  assert.equal(R.claimWelcome('u1', {}, s, 't'), true)
  assert.equal(R.claimWelcome('u1', {}, s, 't'), false, 'refresh')
  assert.equal(R.claimWelcome('u1', { [R.welcomeMetaKey]: 'x' }, store(), 't'), false, 'new device / reinstall: account marker')
  assert.equal(R.claimWelcome('u2', {}, s, 't'), true, 'a different account')
  assert.equal(R.claimWelcome('u1', {}, { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }, 't'), true, 'blocked storage does not throw')
})

test('expiry date/time is the server end, shown in the user\'s timezone, exact to the minute', () => {
  const end = '2027-01-12T16:00:00Z'   // winter date: unaffected by daylight-saving rules
  assert.equal(R.formatTrialEnd(end, 'America/Toronto'), 'Tuesday, January 12 at 11:00 AM EST')
  assert.equal(R.formatTrialEnd(end, 'UTC'), 'Tuesday, January 12 at 4:00 PM UTC')
  assert.equal(R.formatTrialEnd('2027-01-12T16:07:00Z', 'America/Toronto'), 'Tuesday, January 12 at 11:07 AM EST')
  assert.ok(R.formatTrialEnd(end, 'Not/AZone').length > 10, 'bad timezone falls back, never throws')
  assert.equal(R.formatTrialEnd('garbage', 'UTC'), '')
})

test('welcome content, one-time persistence, reduced motion, no new dependency, reused confetti keyframes', () => {
  const w = read('components/xpadite/TrialWelcome.tsx')
  for (const t of ['🎉 Welcome to XPadite! Your 5-Day Free Trial Has Begun!', 'Your journey toward greater productivity starts today!',
    'Enjoy five days of full access to XPadite&apos;s powerful productivity ecosystem. Explore, plan, track your progress, and make every day count.',
    'Your free trial ends on {ends}.', 'Your progress and saved work will remain securely associated with your account after the trial ends. Upgrade anytime to continue your journey.',
    "Let&apos;s Get Started! 🚀"]) assert.ok(w.includes(t), t)
  assert.ok(/prefers-reduced-motion: reduce/.test(w) && /if \(!calm\) setConfetti\(true\)/.test(w))
  assert.ok(/pointerEvents: 'none'/.test(w) && /setTimeout\(onDone, 2800\)/.test(w), 'confetti never blocks interaction and ends in ~2.8s')
  assert.ok(/animation: `xp-confetti /.test(w) && /@keyframes xp-confetti/.test(read('app/globals.css')), 'existing confetti keyframes')
  assert.ok(/updateUser\(\{ data: \{ \[welcomeMetaKey\]: stamp \} \}\)/.test(w) && /claimWelcome\(/.test(w))
  assert.ok(/formatTrialEnd\(status\.trialEndsAt, effectiveTimezone\)/.test(w), 'server end time, not a device-computed one')
  assert.ok(!/hasAccess|startCheckout|billing\.refresh/.test(w), 'cannot change access or start billing')
  const pkg = JSON.parse(read('package.json')); assert.ok(!Object.keys(pkg.dependencies).some(d => /confetti/i.test(d)))
})

test('saved data is preserved after expiry: the paywall blocks only NEW writes (insert/update); nothing is deleted or reset', () => {
  const m = read('supabase/migrations/016_billing_corrections.sql')
  assert.ok(/billing_paywall_insert/.test(m) && /billing_paywall_update/.test(m) && !/billing_paywall_(delete|select)/.test(m), 'reads and deletes are not paywalled')
  assert.ok(/Reads, DELETE, profiles/.test(m))
  for (const f of ['lib/billing/entitlement.ts', 'lib/billing/guard.ts', 'lib/billing/config.ts']) assert.ok(!/\.delete\(|truncate|drop table/i.test(read(f)), f + ' never deletes user data')
  assert.ok(/All of your tasks, journals and data are safe/.test(read('components/xpadite/BillingContext.tsx')), 'expired gate promises (and the code keeps) the data')
})
