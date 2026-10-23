// Test harness for lib/billing — NO network, NO Stripe, NO Supabase.
//  - Transpiles the real TypeScript billing modules into node_modules/.cache (git-ignored) and loads them.
//  - Provides an in-memory fake of the Supabase admin client (select/insert/upsert/update/delete/rpc + eq/neq/in/is filters).
//  - Lets tests stub individual Stripe SDK calls on the shared Stripe instance.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-billing-tests', 'lib', 'billing')

// Fake, clearly non-real credentials: lets the Stripe SDK construct without ever contacting Stripe.
process.env.STRIPE_SECRET_KEY = 'sk_live_unit_test_key_not_real'
process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_monthly_live'
process.env.STRIPE_PRICE_PRO_6MONTH = 'price_6m_live'
process.env.STRIPE_PRICE_PRO_YEARLY = 'price_yearly_new'
process.env.STRIPE_PRICE_PRO_YEARLY_LEGACY = 'price_yearly_old_a, price_yearly_old_b'
process.env.STRIPE_PRICE_3YEAR = 'price_3y_old'
process.env.STRIPE_PRICE_LIFETIME = 'price_ltd'
delete process.env.BILLING_LAUNCH_AT
delete process.env.BILLING_PAYWALL_DISABLED

function build() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const f of ['plans', 'config', 'stripe', 'sync', 'entitlement', 'intent']) {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'billing', f + '.ts'), 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    fs.writeFileSync(path.join(OUT, f + '.js'), out)
  }
}
build()

const load = f => require(path.join(OUT, f + '.js'))
const mods = { plans: load('plans'), stripe: load('stripe'), sync: load('sync'), entitlement: load('entitlement'), intent: load('intent') }

/** Replace one Stripe SDK method (e.g. 'prices.retrieve') on the shared instance. Returns a restore function. */
function stubStripe(pathStr, fn) {
  const stripe = mods.stripe.getStripe()
  const parts = pathStr.split('.')
  const method = parts.pop()
  const holder = parts.reduce((o, k) => o[k], stripe)
  const original = holder[method]
  holder[method] = fn
  return () => { holder[method] = original }
}

/** Minimal in-memory Supabase-like client. Tables are arrays of row objects. */
function makeAdmin(initial = {}, rpcImpl = async () => ({ data: null, error: null })) {
  const db = {}
  for (const k of Object.keys(initial)) db[k] = initial[k].map(r => ({ ...r }))
  const rpcCalls = []
  function from(name) {
    db[name] ??= []
    const st = { op: 'select', filters: [], payload: null, opts: null }
    const hit = r => st.filters.every(f => f(r))
    const exec = single => {
      const rows = db[name]
      if (st.op === 'select') { const m = rows.filter(hit).map(r => ({ ...r })); return { data: single ? (m[0] ?? null) : m, error: null } }
      if (st.op === 'insert') { const p = [].concat(st.payload).map(x => ({ ...x })); rows.push(...p); return { data: p, error: null } }
      if (st.op === 'upsert') {
        const key = st.opts && st.opts.onConflict
        const list = [].concat(st.payload)
        for (const p of list) {
          const ex = key ? rows.find(r => r[key] === p[key]) : null
          if (ex) Object.assign(ex, p); else rows.push({ ...p })
        }
        return { data: list, error: null }
      }
      if (st.op === 'update') { const m = rows.filter(hit); m.forEach(r => Object.assign(r, st.payload)); return { data: m.map(r => ({ ...r })), error: null } }
      if (st.op === 'delete') { const keep = rows.filter(r => !hit(r)); db[name] = keep; return { data: null, error: null } }
      throw new Error('unsupported op ' + st.op)
    }
    const api = {
      select() { return api },
      insert(p) { st.op = 'insert'; st.payload = p; return api },
      upsert(p, o) { st.op = 'upsert'; st.payload = p; st.opts = o; return api },
      update(p) { st.op = 'update'; st.payload = p; return api },
      delete() { st.op = 'delete'; return api },
      eq(c, v) { st.filters.push(r => r[c] === v); return api },
      neq(c, v) { st.filters.push(r => r[c] !== v); return api },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return api },
      is(c, v) { st.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return api },
      limit() { return api },
      maybeSingle: () => Promise.resolve(exec(true)),
      single: () => Promise.resolve(exec(true)),
      then: (res, rej) => Promise.resolve(exec(false)).then(res, rej),
    }
    return api
  }
  return { from, rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcImpl(name, args) }, rpcCalls, table: n => db[n] ?? [] }
}

// Fixtures ------------------------------------------------------------------
const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400
const subscription = ({ id = 'sub_1', customer = 'cus_1', priceId, unit = 3999, status = 'active', periodEnd = NOW + 180 * DAY, cancelAtPeriodEnd = false, canceledAt = null, start = NOW - DAY, user = 'user-1' }) => ({
  id, customer, status, cancel_at_period_end: cancelAtPeriodEnd, canceled_at: canceledAt, start_date: start,
  metadata: user ? { user_id: user } : {}, items: { data: [{ price: { id: priceId, unit_amount: unit }, current_period_end: periodEnd }] },
})
const price = ({ id, amount, type = 'recurring', interval = 'month', count = 1, livemode = true, active = true, currency = 'cad' }) => ({
  id, active, livemode, currency, unit_amount: amount, type, recurring: type === 'recurring' ? { interval, interval_count: count } : null,
})
const user = { id: 'user-1', email_confirmed_at: new Date(Date.now() - 30 * DAY * 1000).toISOString(), created_at: new Date(Date.now() - 30 * DAY * 1000).toISOString() }

module.exports = { ...mods, makeAdmin, stubStripe, subscription, price, user, NOW, DAY, ROOT }
