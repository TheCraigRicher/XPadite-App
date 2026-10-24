// Google sign-in / sign-up wiring + the OAuth return route. Mocks only — no Google, no Supabase, no network.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── load the REAL callback route with stubbed framework/Supabase modules ──
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-auth-tests'); fs.mkdirSync(OUT, { recursive: true })
for (const f of ['plans', 'intent']) fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`lib/billing/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const state = { exchange: { data: { user: { id: 'u1', user_metadata: { full_name: 'Grace Hopper' } } }, error: null }, updates: [] }
const stubs = {
  'next/server': { NextResponse: { redirect: url => ({ redirectedTo: String(url) }) } },
  'next/headers': { cookies: async () => ({ getAll: () => [], set() {} }) },
  '@supabase/ssr': { createServerClient: () => ({
    auth: { exchangeCodeForSession: async () => state.exchange },
    from: () => { const q = { update: v => { state.updates.push(v); return q }, eq: () => q, is: async () => ({ error: null }) }; return q },
  }) },
  '@/lib/billing/intent': require(path.join(OUT, 'intent.js')),
}
fs.writeFileSync(path.join(OUT, 'plans.js'), fs.readFileSync(path.join(OUT, 'plans.js')))
const routeFile = path.join(OUT, 'route.js')
fs.writeFileSync(routeFile, ts.transpileModule(read('app/auth/callback/route.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
const orig = Module._load
Module._load = function (req, parent, isMain) { return req in stubs ? stubs[req] : (req === './plans' && parent && parent.filename.startsWith(OUT) ? orig.call(this, path.join(OUT, 'plans.js'), parent, isMain) : orig.call(this, req, parent, isMain)) }
const route = require(routeFile)
Module._load = orig
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

const O = 'https://x-padite-app.vercel.app'
const go = async qs => (await route.GET({ url: `${O}/auth/callback${qs}` })).redirectedTo
const reset = () => { state.exchange = { data: { user: { id: 'u1', user_metadata: { full_name: 'Grace Hopper' } } }, error: null }; state.updates = [] }

test('callback: a valid code signs in and lands in /app on the SAME origin; the plan chosen on the Website is kept', async () => {
  reset()
  assert.equal(await go('?code=abc'), `${O}/app`)
  assert.equal(await go('?code=abc&next=%2Fapp%3Fplan%3Dpro-monthly'), `${O}/app?plan=pro-monthly`)
})

test('callback: open-redirect attempts fall back to /app', async () => {
  reset()
  for (const next of ['//evil.com', 'https://evil.com', '/\evil.com', '/login', '%2F%2Fevil.com']) assert.equal(await go(`?code=abc&next=${encodeURIComponent(next)}`), `${O}/app`, next)
})

test('callback: Google name is saved only when the profile has none (never overwrites)', async () => {
  reset(); await go('?code=abc')
  assert.deepEqual(state.updates, [{ full_name: 'Grace Hopper' }])
  reset(); state.exchange.data.user.user_metadata = {}; await go('?code=abc')
  assert.deepEqual(state.updates, [])
  const src = read('app/auth/callback/route.ts')
  assert.ok(/\.is\('full_name', null\)/.test(src), 'update is guarded by full_name IS NULL')
  assert.ok(!/avatar_url/.test(src), 'the Google picture is not copied over the user\'s own avatar')
})

test('callback: cancelling at Google returns to /login with a friendly message (not an error page), plan kept', async () => {
  reset()
  const u = new URL(await go('?error=access_denied&error_description=User+cancelled&next=%2Fapp%3Fplan%3Dpro-6month'))
  assert.equal(u.pathname, '/login'); assert.match(u.searchParams.get('error'), /cancelled/i); assert.equal(u.searchParams.get('plan'), 'pro-6month')
})

test('callback: provider failure, bad/expired code and missing code all return to /login with a clear message', async () => {
  reset()
  const a = new URL(await go('?error=server_error')); assert.equal(a.pathname, '/login'); assert.match(a.searchParams.get('error'), /could not be completed/i)
  state.exchange = { data: { user: null }, error: { message: 'bad code' } }
  const b = new URL(await go('?code=bad')); assert.equal(b.pathname, '/login'); assert.match(b.searchParams.get('error'), /invalid or has expired/i)
  const c = new URL(await go('')); assert.equal(c.pathname, '/login')
  assert.ok(!/bad code|supabase/i.test(b.searchParams.get('error')), 'no internal error text shown to the user')
})

test('Google button: the ONLY social option, PKCE OAuth to the callback on the current origin', () => {
  const s = strip(read('components/auth/SocialLoginButtons.tsx'))
  assert.ok(/provider: 'google'/.test(s) && /signInWithOAuth/.test(s))
  assert.ok(/redirectTo: `\$\{window\.location\.origin\}\/auth\/callback\?next=\$\{encodeURIComponent\(next\)\}`/.test(s), 'returns to whichever domain the user is on (production, preview, installed PWA)')
  assert.ok(/const next = `\/app\$\{planQuery\(plan\)\}`/.test(s), 'plan chosen on the Website survives the round trip')
  assert.ok(!/apple|microsoft/i.test(s), 'Apple and Microsoft are gone')
  assert.ok(/Continue with Google/.test(s) && /disabled=\{busy\}/.test(s), 'single click guard')
  assert.ok(/pageshow/.test(s), 'button recovers when the user returns with Back')
})

test('Login and Signup both use it; Apple/Microsoft appear nowhere on either screen; email + password still wired', () => {
  const login = read('app/(auth)/login/page.tsx'), signup = read('app/(auth)/signup/page.tsx')
  assert.ok(/<SocialLoginButtons plan=\{plan\} mode="login" \/>/.test(login) && /<SocialLoginButtons plan=\{plan\} mode="signup" \/>/.test(signup))
  for (const f of [login, signup, read('components/auth/SocialLoginButtons.tsx')]) assert.ok(!/apple|microsoft/i.test(strip(f)), 'no Apple/Microsoft')
  assert.ok(/signInWithPassword\(\{ email, password \}\)/.test(login) && /auth\.signUp\(/.test(signup))
  assert.ok(/params\.get\('error'\)/.test(login), 'login shows the callback error message')
})
