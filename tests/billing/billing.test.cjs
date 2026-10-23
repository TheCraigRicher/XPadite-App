// Focused tests for the v1.300 revised pricing (Pro 6-Month, Pro Yearly CA$65, 3-Year retired).
// Run: npm run test:billing   — uses mocks/fixtures only; never contacts Stripe or Supabase; never charges anything.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./_harness.cjs')
const { plans, stripe, sync, entitlement, intent, makeAdmin, stubStripe, subscription, price, user, NOW, DAY, ROOT } = H
const { BILLING_PLANS, BILLING_PLAN_KEYS, isBillingPlanKey, isPurchasablePlanKey } = plans

// ───────────────────────── 1. Six-month price mapping and validation ─────────────────────────
test('plan list: Pro 6-Month is a CA$39.99 subscription billed every 6 months; Premium V2 stays out', () => {
  const p = BILLING_PLANS['pro-6month']
  assert.equal(p.mode, 'subscription')
  assert.equal(p.expectedAmountCents, 3999)
  assert.equal(p.interval, 'month')
  assert.equal(p.intervalCount, 6)
  assert.equal(p.priceEnv, 'STRIPE_PRICE_PRO_6MONTH')
  assert.ok(!BILLING_PLAN_KEYS.some(k => k.startsWith('premium')))
  assert.equal(isBillingPlanKey('pro-6month'), true)
})

async function verify(planKey, envId, priceObj) {
  const restore = stubStripe('prices.retrieve', async id => { assert.equal(id, envId); return priceObj })
  const prev = process.env[BILLING_PLANS[planKey].priceEnv]
  process.env[BILLING_PLANS[planKey].priceEnv] = envId
  try { return await stripe.verifyPlanPrice(planKey) } finally { restore(); process.env[BILLING_PLANS[planKey].priceEnv] = prev }
}

test('verifyPlanPrice accepts the real 6-month price (CAD 39.99, month x 6, live)', async () => {
  assert.equal(await verify('pro-6month', 'price_6m_live', price({ id: 'price_6m_live', amount: 3999, interval: 'month', count: 6 })), 'price_6m_live')
})

test('verifyPlanPrice rejects a wrong price for pro-6month: old CA$199 one-time, monthly CA$10, wrong period, test-mode, inactive', async () => {
  await assert.rejects(verify('pro-6month', 'price_3y_old', price({ id: 'price_3y_old', amount: 19900, type: 'one_time' })), /unexpected amount/)       // 8: old 3-Year price can never become the 6-month plan
  await assert.rejects(verify('pro-6month', 'price_monthly_live', price({ id: 'price_monthly_live', amount: 1000, count: 1 })), /unexpected amount/)
  await assert.rejects(verify('pro-6month', 'price_x', price({ id: 'price_x', amount: 3999, count: 1 })), /billing period/)                            // right amount, wrong period
  await assert.rejects(verify('pro-6month', 'price_x', price({ id: 'price_x', amount: 3999, type: 'one_time' })), /billing type/)                      // right amount, one-time
  await assert.rejects(verify('pro-6month', 'price_x', price({ id: 'price_x', amount: 3999, count: 6, livemode: false })), /different Stripe mode/)    // test price with live key
  await assert.rejects(verify('pro-6month', 'price_x', price({ id: 'price_x', amount: 3999, count: 6, active: false })), /not active/)
})

// ───────────────────────── 4. New CA$65 yearly price ─────────────────────────
test('verifyPlanPrice: new CA$65 yearly accepted; the old CA$89.99 yearly is refused for NEW purchases', async () => {
  assert.equal(await verify('pro-yearly', 'price_yearly_new', price({ id: 'price_yearly_new', amount: 6500, interval: 'year' })), 'price_yearly_new')
  await assert.rejects(verify('pro-yearly', 'price_yearly_old_a', price({ id: 'price_yearly_old_a', amount: 8999, interval: 'year' })), /unexpected amount/)
  await assert.rejects(verify('pro-yearly', 'price_x', price({ id: 'price_x', amount: 6500, interval: 'month' })), /wrong interval/)
})

// ───────────────────────── 9/10. Regression: Pro Monthly and Lifetime unchanged ─────────────────────────
test('regression: Pro Monthly (CA$10) and Lifetime (CA$249) still validate; a 6-month price is not accepted as monthly', async () => {
  assert.equal(await verify('pro-monthly', 'price_monthly_live', price({ id: 'price_monthly_live', amount: 1000 })), 'price_monthly_live')
  assert.equal(await verify('ltd', 'price_ltd', price({ id: 'price_ltd', amount: 24900, type: 'one_time' })), 'price_ltd')
  await assert.rejects(verify('pro-monthly', 'price_x', price({ id: 'price_x', amount: 1000, count: 6 })), /billing period/)   // CA$10 but every 6 months
  await assert.rejects(verify('pro-monthly', 'price_6m_live', price({ id: 'price_6m_live', amount: 3999, count: 6 })), /unexpected amount/)
  assert.equal(BILLING_PLANS['pro-monthly'].expectedAmountCents, 1000)
  assert.equal(BILLING_PLANS.ltd.expectedAmountCents, 24900)
  assert.equal(BILLING_PLANS.ltd.cap, 100)
  assert.equal(BILLING_PLANS.ltd.retired, undefined)
})

// ───────────────────────── 5. Historical CA$89.99 yearly subscriptions ─────────────────────────
test('price → plan mapping: new + legacy yearly prices both map to pro-yearly; 6-month maps; unknown does not', () => {
  assert.equal(stripe.planKeyForPriceId('price_yearly_new'), 'pro-yearly')
  assert.equal(stripe.planKeyForPriceId('price_yearly_old_a'), 'pro-yearly')
  assert.equal(stripe.planKeyForPriceId('price_yearly_old_b'), 'pro-yearly')
  assert.equal(stripe.planKeyForPriceId('price_6m_live'), 'pro-6month')
  assert.equal(stripe.planKeyForPriceId('price_monthly_live'), 'pro-monthly')
  assert.equal(stripe.planKeyForPriceId('price_stranger'), null)
  // Legacy IDs never become the Checkout price.
  assert.equal(stripe.getPriceId('pro-yearly'), 'price_yearly_new')
})

// ───────────────────────── 2/3/5. Subscription sync: 6-month, renewal, cancellation, legacy yearly ─────────────────────────
async function syncWith(admin, subObj) {
  const restore = stubStripe('subscriptions.retrieve', async () => subObj)
  try { await sync.syncSubscription(admin, subObj.id) } finally { restore() }
}
const rows = admin => admin.table('billing_subscriptions')

test('6-month subscription: first sync creates one active pro-6month row with period end and price lock', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  await syncWith(admin, subscription({ priceId: 'price_6m_live', unit: 3999, periodEnd: NOW + 183 * DAY }))
  assert.equal(rows(admin).length, 1)
  const r = rows(admin)[0]
  assert.equal(r.plan_key, 'pro-6month')
  assert.equal(r.status, 'active')
  assert.equal(r.user_id, 'user-1')
  assert.equal(new Date(r.current_period_end).getTime() / 1000, NOW + 183 * DAY)
  assert.equal(r.early_adopter, true)
  assert.equal(r.locked_price_id, 'price_6m_live')
  assert.equal(r.locked_amount_cents, 3999)
})

test('6-month renewal: a later sync moves the period end forward, keeps ONE row, and does not rewrite the price lock', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  await syncWith(admin, subscription({ priceId: 'price_6m_live', periodEnd: NOW + 183 * DAY }))
  const lockedUntil = rows(admin)[0].price_locked_until
  await syncWith(admin, subscription({ priceId: 'price_6m_live', periodEnd: NOW + 366 * DAY, start: NOW + 100 * DAY }))
  assert.equal(rows(admin).length, 1)
  assert.equal(new Date(rows(admin)[0].current_period_end).getTime() / 1000, NOW + 366 * DAY)
  assert.equal(rows(admin)[0].price_locked_until, lockedUntil)
})

test('6-month cancellation: scheduled keeps access to period end; ended removes it; payment failure keeps access (past_due)', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  const end = NOW + 120 * DAY
  await syncWith(admin, subscription({ priceId: 'price_6m_live', periodEnd: end, cancelAtPeriodEnd: true }))
  let st = await entitlement.getBillingStatus(admin, user)
  assert.equal(st.state, 'paid'); assert.equal(st.plan, 'pro-6month'); assert.equal(st.cancelAtPeriodEnd, true)
  assert.equal(new Date(st.accessEndsAt).getTime() / 1000, end)            // renewal/expiry date shown in the App
  await syncWith(admin, subscription({ priceId: 'price_6m_live', periodEnd: end, status: 'past_due' }))
  st = await entitlement.getBillingStatus(admin, user)
  assert.equal(st.state, 'paid'); assert.equal(st.pastDue, true)
  await syncWith(admin, subscription({ priceId: 'price_6m_live', periodEnd: end, status: 'canceled', canceledAt: NOW }))
  st = await entitlement.getBillingStatus(admin, user)
  assert.notEqual(st.state, 'paid'); assert.equal(st.plan, null)
})

test('duplicate webhook delivery of the same subscription state is idempotent (no duplicate rows or entitlements)', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  const s = subscription({ priceId: 'price_6m_live' })
  await syncWith(admin, s); await syncWith(admin, s); await syncWith(admin, s)
  assert.equal(rows(admin).length, 1)
})

test('historical CA$89.99 yearly subscription keeps syncing as pro-yearly and keeps its own schedule', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  await syncWith(admin, subscription({ id: 'sub_old', priceId: 'price_yearly_old_a', unit: 8999, periodEnd: NOW + 300 * DAY }))
  const r = rows(admin)[0]
  assert.equal(r.plan_key, 'pro-yearly'); assert.equal(r.stripe_price_id, 'price_yearly_old_a'); assert.equal(r.locked_amount_cents, 8999)
  const st = await entitlement.getBillingStatus(admin, user)
  assert.equal(st.state, 'paid'); assert.equal(st.plan, 'pro-yearly')
})

test('a subscription on an unknown price is not turned into any plan', async () => {
  const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
  await syncWith(admin, subscription({ priceId: 'price_stranger' }))
  assert.equal(rows(admin).length, 0)
})

// ───────────────────────── 6. Historical 3-Year Pro purchases ─────────────────────────
const purchase = (o = {}) => ({ id: 'p1', user_id: 'user-1', plan_key: '3year-pro', status: 'paid', stripe_payment_intent_id: 'pi_3y', access_expires_at: new Date((NOW + 700 * DAY) * 1000).toISOString(), ...o })

test('3-Year Pro is retired for NEW purchases but its key, price env and caps remain for history', () => {
  assert.equal(BILLING_PLANS['3year-pro'].retired, true)
  assert.equal(isBillingPlanKey('3year-pro'), true)               // still a valid historical key
  assert.equal(isPurchasablePlanKey('3year-pro'), false)          // 7: cannot start a new Checkout
  for (const k of ['pro-monthly', 'pro-6month', 'pro-yearly', 'ltd']) assert.equal(isPurchasablePlanKey(k), true, k)
  assert.equal(stripe.getPriceId('3year-pro'), 'price_3y_old')
})

test('historical 3-Year entitlement is unchanged: active until its stored expiry, gone after it, best entitlement wins', async () => {
  const live = makeAdmin({ billing_purchases: [purchase()] })
  let st = await entitlement.getBillingStatus(live, user)
  assert.equal(st.state, 'paid'); assert.equal(st.plan, '3year-pro'); assert.equal(st.lifetime, false)
  assert.equal(new Date(st.accessEndsAt).getTime() / 1000, NOW + 700 * DAY)
  const expired = makeAdmin({ billing_purchases: [purchase({ access_expires_at: new Date((NOW - DAY) * 1000).toISOString() })] })
  st = await entitlement.getBillingStatus(expired, user)
  assert.notEqual(st.state, 'paid')
  const both = makeAdmin({
    billing_purchases: [purchase()],
    billing_subscriptions: [{ user_id: 'user-1', plan_key: 'pro-6month', status: 'active', current_period_end: new Date((NOW + 900 * DAY) * 1000).toISOString(), cancel_at_period_end: false }],
  })
  st = await entitlement.getBillingStatus(both, user)
  assert.equal(st.plan, 'pro-6month')                              // longer-running entitlement wins; nothing is shortened
  const ltd = makeAdmin({ billing_purchases: [purchase({ plan_key: 'ltd', access_expires_at: null })] })
  st = await entitlement.getBillingStatus(ltd, user)
  assert.equal(st.lifetime, true)
})

test('historical 3-Year refund / dispute handling is unchanged (full refund revokes; partial flags; lost dispute revokes)', async () => {
  let admin = makeAdmin({ billing_purchases: [purchase()] })
  let r1 = stubStripe('checkout.sessions.list', async () => ({ data: [] }))
  await sync.handleChargeRefunded(admin, { refunded: true, payment_intent: 'pi_3y' })
  assert.equal(admin.table('billing_purchases')[0].status, 'refunded')
  assert.equal((await entitlement.getBillingStatus(admin, user)).plan, null)
  r1()

  admin = makeAdmin({ billing_purchases: [purchase()] })
  await sync.handleChargeRefunded(admin, { refunded: false, payment_intent: 'pi_3y' })      // partial
  assert.equal(admin.table('billing_purchases')[0].status, 'paid')
  assert.equal(admin.table('billing_purchases')[0].needs_review, true)

  admin = makeAdmin({ billing_purchases: [purchase()] })
  const r2 = stubStripe('disputes.retrieve', async () => ({ id: 'dp_1', status: 'lost', payment_intent: 'pi_3y' }))
  await sync.handleDispute(admin, 'dp_1')
  assert.equal(admin.table('billing_purchases')[0].status, 'disputed')
  r2()
})

test('an in-flight 3-Year Checkout paid after retirement is still granted; Lifetime grant + cap unchanged', async () => {
  const session = (plan, priceId, amount) => ({
    id: 'cs_' + plan, mode: 'payment', payment_status: 'paid', currency: 'cad', amount_total: amount,
    metadata: { plan_key: plan, user_id: 'user-1' }, client_reference_id: 'user-1', payment_intent: 'pi_' + plan,
    line_items: { data: [{ price: { id: priceId } }] },
  })
  for (const [plan, priceId, amount, expectExpiry] of [['3year-pro', 'price_3y_old', 19900, true], ['ltd', 'price_ltd', 24900, false]]) {
    const admin = makeAdmin({}, async () => ({ data: 'paid', error: null }))
    const r1 = stubStripe('checkout.sessions.retrieve', async () => session(plan, priceId, amount))
    const r2 = stubStripe('paymentIntents.retrieve', async () => ({ latest_charge: { id: 'ch', refunded: false, disputed: false, amount_refunded: 0 } }))
    try {
      assert.equal(await sync.grantFromCheckoutSession(admin, 'cs_' + plan), 'granted')
      const call = admin.rpcCalls.find(c => c.name === 'billing_confirm_purchase')
      assert.equal(call.args.p_plan_key, plan); assert.equal(call.args.p_cap, 100)
      assert.equal(call.args.p_access_expires !== null, expectExpiry)
    } finally { r1(); r2() }
  }
})

// grant path for subscription Checkout sessions (monthly / 6-month / yearly)
test('subscription Checkout sessions grant through the verified subscription (6-month, monthly, new yearly)', async () => {
  for (const [priceId, plan] of [['price_6m_live', 'pro-6month'], ['price_monthly_live', 'pro-monthly'], ['price_yearly_new', 'pro-yearly']]) {
    const admin = makeAdmin({ billing_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] })
    const r1 = stubStripe('checkout.sessions.retrieve', async () => ({ id: 'cs_s', mode: 'subscription', subscription: 'sub_1' }))
    const r2 = stubStripe('subscriptions.retrieve', async () => subscription({ priceId }))
    try {
      assert.equal(await sync.grantFromCheckoutSession(admin, 'cs_s'), 'granted')
      assert.equal(admin.table('billing_subscriptions')[0].plan_key, plan)
    } finally { r1(); r2() }
  }
})

// ───────────────────────── 7/8. Server route + UI wiring (source-level guards) ─────────────────────────
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('checkout route refuses retired plans (410) BEFORE any Stripe/database work, and still validates every price', () => {
  const src = read('app/api/stripe/checkout/route.ts')
  const retired = src.indexOf('plan.retired')
  assert.ok(retired > 0, 'route must check plan.retired')
  assert.ok(src.indexOf("code: 'plan_retired'") > retired && src.includes('status: 410'))
  assert.ok(retired < src.indexOf('createAdminClient()'), 'retired check must precede admin/Stripe work')
  assert.ok(src.includes('verifyPlanPrice(plan.key)'))
  assert.ok(src.includes('mode: plan.mode'))
})

test('Settings cards: six cards in the mandated order, correct prices/savings, no stale CA$89.99 / 3-Year in new-purchase UI', () => {
  const src = read('components/xpadite/SettingsModal.tsx')
  const noComments = s => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const grid = noComments(src.slice(src.indexOf('<BillingSummary'), src.indexOf('LANGUAGE & REGION')))
  const order = [...grid.matchAll(/setActivePlanPopup\('([^']+)'\)/g)].map(m => m[1])
  assert.deepEqual(order, ['pro-monthly', 'pro-yearly', 'pro-6month', 'ltd', 'premium-monthly', 'premium-yearly'])
  const cfg = noComments(src.slice(src.indexOf('export const PLAN_CONFIGS'), src.indexOf('function SectionIcon')))
  assert.deepEqual([...cfg.matchAll(/^  '([^']+)': \{/gm)].map(m => m[1]), ['pro-monthly', 'pro-yearly', 'pro-6month', 'ltd', 'premium-monthly', 'premium-yearly'])
  for (const text of ['Pro Monthly Plan CA$10', 'Pro Yearly Plan CA$65', 'Save CA$55/year', 'Pro 6-Month CA$39.99', 'Billed Every 6 Months', 'Save CA$20.01/6 months', 'Lifetime Pro CA$249', 'Only for the First 100 Customers', 'Premium Monthly Plan CA$15', 'Premium Yearly Plan CA$119'])
    assert.ok(grid.includes(text), 'missing card text: ' + text)
  assert.ok(!grid.includes('89.99') && !cfg.includes('89.99') && !grid.includes('3-Year') && !cfg.includes('3year-pro') && !cfg.includes('CA$199'))
  assert.equal([...grid.matchAll(/First 100/g)].length, 1)                     // only the Lifetime card
  // Every buyable card maps to a server plan that is a SUBSCRIPTION (6-month/yearly/monthly) or the Lifetime one-time; never the 3-Year one-time.
  for (const key of order.filter(k => !k.startsWith('premium'))) assert.equal(isPurchasablePlanKey(key), true, key)
  assert.equal(BILLING_PLANS['pro-6month'].mode, 'subscription')
  assert.equal(BILLING_PLANS['pro-6month'].expectedAmountCents, 3999)
})

test('savings arithmetic matches the displayed numbers (reference: CA$10 per month)', () => {
  assert.equal(12 * 10 - 65, 55)
  assert.equal(Math.round(((12 * 10 - 65) / 120) * 100), 46)
  assert.equal(Number((6 * 10 - 39.99).toFixed(2)), 20.01)
  assert.equal(Math.round(((6 * 10 - 39.99) / 60) * 100), 33)
})

test('Website ?plan= links: 6-month is a valid intent, 3-Year parses but is not purchasable, junk is ignored', () => {
  assert.equal(intent.parsePlan('pro-6month'), 'pro-6month')
  assert.equal(intent.planQuery('pro-6month'), '?plan=pro-6month')
  assert.equal(intent.parsePlan('premium-monthly'), null)
  assert.equal(isPurchasablePlanKey(intent.parsePlan('3year-pro')), false)
})
