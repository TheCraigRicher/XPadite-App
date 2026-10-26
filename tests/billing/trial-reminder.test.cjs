// Day 3/4/5 trial reminders: stage maths, honest copy, once-per-stage-per-account, never for paid/expired, CTA wiring.
// The trial clock is the server's `trialEndsAt` — there is no second clock.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const H = require('./_harness.cjs')
const { entitlement, makeAdmin, subscription } = H

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-trial-reminder'); fs.mkdirSync(OUT, { recursive: true })
for (const f of ['plans', 'trialReminder']) fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`lib/billing/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const R = require(path.join(OUT, 'trialReminder.js'))

const H1 = 3_600_000, D = 24 * H1
const START = Date.parse('2026-11-01T08:00:00Z')            // trial start (verification or billing launch)
const END = new Date(START + 5 * D).toISOString()
const at = hoursIn => R.trialReminderStage(END, START + hoursIn * H1)

test('Day 1–2: no reminder (including the first second and the last minute of day 2)', () => {
  for (const h of [0, 1, 12, 23.99, 24, 36, 47.99]) assert.equal(at(h), null, h + 'h')
})
test('Day 3 (48h–72h in): stage 3', () => { for (const h of [48, 60, 71.99]) assert.equal(at(h).stage, 3, h + 'h') })
test('Day 4 (72h–96h in): stage 4', () => { for (const h of [72, 84, 95.99]) assert.equal(at(h).stage, 4, h + 'h') })
test('Day 5 (96h–120h in): stage 5', () => { for (const h of [96, 110, 119.99]) assert.equal(at(h).stage, 5, h + 'h') })
test('ended trial (and the exact end instant): no reminder — the existing expired-trial paywall takes over', () => {
  for (const h of [120, 120.01, 200]) assert.equal(at(h), null, h + 'h')
})
test('before the trial starts, or with a missing/invalid end time: no reminder', () => {
  assert.equal(at(-1), null)
  for (const bad of [null, undefined, '', 'not a date']) assert.equal(R.trialReminderStage(bad, START + 60 * H1), null)
})

test('existing accounts: the trial starts at the billing launch, so Day 3 is launch + 2 days', () => {
  const launch = Date.parse('2026-11-10T07:00:00Z'), end = new Date(launch + 5 * D).toISOString()
  assert.equal(R.trialReminderStage(end, launch + 1 * D), null)
  assert.equal(R.trialReminderStage(end, launch + 2.5 * D).stage, 3)
})

test('remaining time is stated honestly (days only when that many full days remain; hours otherwise)', () => {
  assert.equal(R.formatRemaining(72 * H1 - 1), 'about 2 days'); assert.equal(R.formatRemaining(48 * H1), 'about 2 days')
  assert.equal(R.formatRemaining(47 * H1), 'about 1 day'); assert.equal(R.formatRemaining(24 * H1), 'about 1 day')
  assert.equal(R.formatRemaining(23 * H1), 'about 23 hours'); assert.equal(R.formatRemaining(9 * H1 - 1), 'about 9 hours')
  assert.equal(R.formatRemaining(1.5 * H1), 'about 2 hours'); assert.equal(R.formatRemaining(30 * 60_000), 'less than an hour')
  // never promises more days than remain
  for (let h = 0.1; h < 72; h += 0.7) { const t = R.formatRemaining(h * H1); const days = /about (\d) day/.exec(t); if (days) assert.ok(Number(days[1]) * 24 <= h + 0.001, `${t} at ${h}h`) }
})

test('copy per stage names the stage and the remaining time; Day 5 says it is the last day', () => {
  const c3 = R.reminderCopy(at(60)), c4 = R.reminderCopy(at(84)), c5 = R.reminderCopy(at(111))
  assert.match(c3.body, /about 2 days/); assert.match(c4.body, /about 1 day|hours/); assert.match(c5.title, /Last day/i); assert.match(c5.body, /about 9 hours/)
  assert.ok(!/free forever|unlimited/i.test(c3.body + c4.body + c5.body))
})

test('a wrong DEVICE clock does not move the stage: the server clock offset is applied', () => {
  const deviceAhead = 2 * D                                  // device thinks it is 2 days later than it is
  const serverNow = START + 60 * H1, deviceNow = serverNow + deviceAhead
  assert.equal(R.trialReminderStage(END, deviceNow).stage, 5, 'raw device time would wrongly say Day 5')
  assert.equal(R.trialReminderStage(END, deviceNow + (serverNow - deviceNow)).stage, 3, 'with the offset it is Day 3')
})

const trialStatus = (o = {}) => ({ state: 'trial', trialEndsAt: END, enforcementActive: true, ...o })
test('paid users never get a reminder (real entitlement result for an active subscription)', async () => {
  const admin = makeAdmin({ billing_subscriptions: [{ user_id: 'user-1', plan_key: 'pro-monthly', status: 'active', current_period_end: new Date(Date.now() + 30 * D).toISOString(), cancel_at_period_end: false }] })
  const st = await entitlement.getBillingStatus(admin, H.user)
  assert.equal(st.state, 'paid'); assert.equal(R.reminderFor(st, START + 60 * H1), null)
  assert.equal(R.reminderFor({ ...trialStatus(), state: 'paid' }, START + 60 * H1), null)
})
test('expired state / enforcement off / launch not set: no reminder', () => {
  assert.equal(R.reminderFor(trialStatus({ state: 'expired' }), START + 60 * H1), null)
  assert.equal(R.reminderFor(trialStatus({ enforcementActive: false }), START + 60 * H1), null)
  assert.equal(R.reminderFor(trialStatus({ trialEndsAt: null }), START + 60 * H1), null)
  assert.equal(R.reminderFor(null, START), null)
  assert.equal(R.reminderFor(trialStatus(), START + 60 * H1).stage, 3)
})

function fakeStorage(initial = {}) { const m = { ...initial }; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v }, m } }
test('shown at most once per ACCOUNT and per STAGE (this device)', () => {
  const s = fakeStorage()
  assert.equal(R.claimReminder('u1', {}, s, 3, 't'), true)
  assert.equal(R.claimReminder('u1', {}, s, 3, 't'), false, 'refresh / second tab: not again')
  assert.equal(R.claimReminder('u1', {}, s, 4, 't'), true, 'next stage is its own reminder')
  assert.equal(R.claimReminder('u2', {}, s, 3, 't'), true, 'another account on the same device still gets it')
  assert.equal(Object.keys(s.m).length, 3)
})
test('shown at most once across DEVICES: the account marker (user_metadata) wins even with empty local storage', () => {
  assert.equal(R.claimReminder('u1', { [R.reminderMetaKey(3)]: '2026-11-03T00:00:00Z' }, fakeStorage(), 3, 't'), false)
  assert.equal(R.claimReminder('u1', { [R.reminderMetaKey(3)]: '2026-11-03T00:00:00Z' }, fakeStorage(), 4, 't'), true)
})
test('blocked/private storage never throws and never blocks the reminder', () => {
  const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
  assert.equal(R.claimReminder('u1', {}, broken, 3, 't'), true)
  assert.equal(R.claimReminder('u1', {}, null, 3, 't'), true)
})

test('component wiring: uses the server trial end + offset; Upgrade opens the existing plans screen; dismissal never touches access', () => {
  const b = read('components/xpadite/TrialReminderBanner.tsx')
  assert.ok(/reminderFor\(status, nowMs \+ offset\)/.test(b) && /clockOffsetMs/.test(b), 'server time corrected')
  assert.ok(!/localStorage[\s\S]{0,40}(trial|start)/i.test(b.replace(/reminderLocalKey/g, '')), 'no device-stored trial start')
  assert.ok(/onClick=\{\(\) => \{ setShown\(null\); onUpgrade\(\) \}\}/.test(b) && /aria-label="Dismiss reminder"/.test(b))
  assert.ok(!/hasAccess|billing\.refresh|fetch\(/.test(b), 'purely presentational: cannot change access or call billing')
  const app = read('components/xpadite/XpaditeApp.tsx')
  assert.ok(/<TrialReminderBanner suppressed=\{anotherScreenOpen \|\| welcomeVisible\} onUpgrade=\{\(\) => \{ setProfileOpen\(false\); setSettingsOpen\(true\) \}\}/.test(app), 'same plans screen as the expired-trial gate')
  assert.ok(/onViewPlans=\{\(\) => \{ setProfileOpen\(false\); setSettingsOpen\(true\) \}\}/.test(app))
  const sup = app.slice(app.indexOf('const anotherScreenOpen'), app.indexOf('function handleAICoachClose'))
  for (const flag of ['modalDay', 'dashboardDay', 'analyticsOpen', 'profileOpen', 'settingsOpen', 'helpOpen', 'galleryOpen', 'activityManagerOpen', 'notificationsOpen', 'syncOpen', 'meetingsOpen', 'whatsNewOpen', 'goalManagerOpen', 'aiCoachOpen', 'journalNotesOpen', 'navGuardOpen', "mobileTab !== 'calendar'"])
    assert.ok(sup.includes(flag), 'hidden while ' + flag)
  assert.ok(/z-\[45\]/.test(b), 'sits below every modal and the expired-trial gate (z-55)')
})

test('billing/trial/paywall rules and checkout are untouched: only an additive serverNow field on the status response', () => {
  const route = read('app/api/billing/status/route.ts')
  assert.ok(/\{ \.\.\.status, serverNow: new Date\(\)\.toISOString\(\) \}/.test(route))
  const ent = read('lib/billing/entitlement.ts')
  assert.ok(/const enforcementActive = trialEnd !== null && !isPaywallDisabled\(\)/.test(ent) && /TRIAL_DAYS \* 86_400_000/.test(ent))
  assert.equal(require(path.join(OUT, 'plans.js')).TRIAL_DAYS, 5)
})
