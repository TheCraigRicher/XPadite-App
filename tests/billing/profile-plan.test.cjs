// Profile → Current Plan must show the SAME plan as Settings, and must never show a paid user as "Free" while the plan loads.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-profile-plan-tests')
fs.mkdirSync(OUT, { recursive: true })
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// Load the REAL BillingContext.tsx (planLabel / describeStatus), stubbing only its imports.
const plans = (() => {
  const f = path.join(OUT, 'plans.js')
  fs.writeFileSync(f, ts.transpileModule(read('lib/billing/plans.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
  return require(f)
})()
const stubs = {
  './AppContext': { useApp: () => ({ setToast() {} }) },
  '@/lib/billing/plans': plans,
  '@/lib/billing/intent': { parsePlan: () => null },
  '@/lib/analytics/client': { track() {} },
}
const file = path.join(OUT, 'BillingContext.js')
fs.writeFileSync(file, ts.transpileModule(read('components/xpadite/BillingContext.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText)
const origLoad = Module._load
Module._load = function (request, parent, isMain) { return request in stubs ? stubs[request] : origLoad.call(this, request, parent, isMain) }
const B = require(file)
Module._load = origLoad

const future = new Date(Date.now() + 40 * 86_400_000).toISOString()
const paid = (plan, extra = {}) => ({ state: 'paid', plan, lifetime: false, accessEndsAt: future, cancelAtPeriodEnd: false, pastDue: false, ...extra })

test('every paid plan maps to its own label (Profile uses this same function as Settings)', () => {
  for (const [plan, label] of [['pro-monthly', 'Pro Monthly'], ['pro-6month', 'Pro 6-Month'], ['pro-yearly', 'Pro Yearly'], ['3year-pro', '3-Year Pro'], ['ltd', 'Lifetime Pro']]) {
    const info = B.describeStatus(paid(plan, plan === 'ltd' ? { lifetime: true, accessEndsAt: null } : {}))
    assert.equal(info.title, label)
    assert.ok(!/free/i.test(info.title + info.detail))
  }
})

test('paid details: renewal, scheduled cancel, lifetime, 3-year access, payment failure', () => {
  assert.match(B.describeStatus(paid('pro-monthly')).detail, /^Renews /)
  assert.match(B.describeStatus(paid('pro-monthly', { cancelAtPeriodEnd: true })).detail, /^Ends /)
  assert.equal(B.describeStatus(paid('ltd', { lifetime: true })).detail, 'Lifetime access')
  assert.match(B.describeStatus(paid('3year-pro')).detail, /^Access until /)
  assert.match(B.describeStatus(paid('pro-yearly', { pastDue: true })).detail, /Payment failed/)
})

test('trial and expired keep their existing wording', () => {
  assert.equal(B.describeStatus({ state: 'trial', trialEndsAt: future }).title, 'Free Trial')
  assert.equal(B.describeStatus({ state: 'trial', trialEndsAt: null }).detail, '5 days, starting at launch')
  assert.equal(B.describeStatus({ state: 'expired' }).title, 'Trial ended')
})

test('unknown status (still loading / check failed) is "Loading plan…", never a plan and never Free', () => {
  const info = B.describeStatus(null)
  assert.equal(info.detail, 'Loading plan…'); assert.ok(!/free/i.test(info.title + info.detail))
})

test('ProfileModal: same context + describeStatus as Settings, no independent plan logic, no Free fallback while loading', () => {
  const s = read('components/xpadite/ProfileModal.tsx')
  assert.ok(s.includes("import { useBilling, describeStatus } from './BillingContext'"))
  assert.ok(/\.\.\.describeStatus\(billing\.status\)/.test(s), 'the plan text comes from describeStatus(billing.status) whenever the plan is known')
  assert.ok(!/billing\?\.status\s*\?/.test(s.slice(s.indexOf('const billingInfo') - 10, s.indexOf('const billingInfo') + 400)), 'a null status is no longer treated as "no plan"')
  assert.equal((s.replace(/^\s*\/\/.*$/gm, '').match(/XPadite Free/g) || []).length, 1, 'only the no-provider fallback mentions Free')
  assert.ok(!/pro-monthly|Pro Monthly|Pro Yearly|Lifetime Pro/.test(s.slice(s.indexOf('const billingInfo'), s.indexOf('const billingInfo') + 600)), 'no hardcoded plan labels')
  assert.ok(/const refreshBilling = billing\?\.refresh/.test(s) && /void refreshBilling\?\.\(\)/.test(s), 'plan is re-checked whenever Profile opens')
  const set = read('components/xpadite/SettingsModal.tsx')
  assert.ok(set.includes('useBilling') && set.includes('BillingSummary'), 'Settings reads the same billing context')
})

test('BillingProvider retries a failed first status check instead of leaving the plan unknown', () => {
  const s = read('components/xpadite/BillingContext.tsx')
  assert.ok(/for \(let i = 0; i < 4 && !cancelled; i\+\+\)/.test(s) && /if \(await refresh\(\)\) return/.test(s))
  assert.ok(s.includes("document.addEventListener('visibilitychange', onVisible)"), 'focus refresh kept')
  assert.ok(/cancelled = true; clearTimeout\(t\)/.test(s), 'cleans up')
})
