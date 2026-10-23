// PWA installability + safety guards (static; the real install/offline behaviour was also exercised in headless Chrome).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const manifest = JSON.parse(read('public/manifest.json'))

test('manifest: name, standalone display, start URL inside scope, brand colours', () => {
  assert.equal(manifest.name, 'XPadite'); assert.equal(manifest.short_name, 'XPadite')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/app'); assert.equal(manifest.scope, '/'); assert.ok(manifest.start_url.startsWith(manifest.scope))
  assert.equal(manifest.id, '/app')
  assert.equal(manifest.theme_color, '#7c3aed'); assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
})

test('manifest icons: real square PNGs of the declared size; "any" and "maskable" are separate entries', async () => {
  const sizes = new Set()
  for (const icon of manifest.icons) {
    assert.ok(['any', 'maskable'].includes(icon.purpose), 'one purpose per icon: ' + icon.purpose)
    const m = await sharp(path.join(ROOT, 'public', icon.src)).metadata()
    assert.equal(m.format, 'png'); assert.equal(`${m.width}x${m.height}`, icon.sizes, icon.src)
    sizes.add(`${icon.purpose}:${icon.sizes}`)
  }
  for (const need of ['any:192x192', 'any:512x512', 'maskable:512x512']) assert.ok(sizes.has(need), need)
})

test('apple-touch-icon: 180x180 and fully opaque (iOS paints transparency black)', async () => {
  const m = await sharp(path.join(ROOT, 'public/icons/apple-touch-icon.png')).metadata()
  assert.equal(m.width, 180); assert.equal(m.height, 180); assert.equal(m.hasAlpha, false)
})

test('layout: manifest + icons linked; iOS uses a SOLID status bar (no content under the clock/notch)', () => {
  const l = read('app/layout.tsx')
  assert.ok(/manifest: "\/manifest\.json"/.test(l) && /apple: \[\{ url: "\/icons\/apple-touch-icon\.png"/.test(l))
  assert.ok(/appleWebApp: \{ capable: true, title: "XPadite", statusBarStyle: "black" \}/.test(l))
  assert.ok(!/black-translucent/.test(l.replace(/^\s*\/\/.*$/gm, '')), 'translucent would draw under the status bar (fixed headers have no top safe-area padding)')
  assert.ok(/themeColor: "#7c3aed"/.test(l))
  assert.ok(!/maximum-scale|userScalable/.test(l), 'pinch-zoom stays available (accessibility)')
})

test('service worker: caches ONLY /offline.html; touches navigations only; never API/auth/Stripe/cross-origin', () => {
  const sw = read('public/sw.js')
  assert.equal((sw.match(/cache\.add\(/g) || []).length, 1); assert.ok(/OFFLINE_URL = '\/offline\.html'/.test(sw))
  assert.ok(!/cache\.put|addAll/.test(sw), 'nothing else is ever stored')
  assert.ok(/req\.mode !== 'navigate' \|\| req\.method !== 'GET'\) return/.test(sw))
  assert.ok(/url\.origin !== self\.location\.origin\) return/.test(sw))
  assert.ok(/startsWith\('\/api\/'\)/.test(sw) && /startsWith\('\/auth\/'\)/.test(sw))
  assert.ok(/fetch\(req\)\.catch/.test(sw), 'online-first: the network always wins')
})

test('offline page is static: no scripts that call the network, no account data', () => {
  const html = read('public/offline.html')
  assert.ok(!/<script/i.test(html) && !/fetch\(|XMLHttpRequest|localStorage|cookie/i.test(html))
  assert.ok(/location\.reload\(\)/.test(html))
})

test('registration: production only, root scope, always re-checks for a new worker', () => {
  const r = read('components/PwaRegister.tsx')
  assert.ok(/process\.env\.NODE_ENV !== 'production'/.test(r) && /scope: '\/'/.test(r) && /updateViaCache: 'none'/.test(r))
})

test('proxy: PWA static files skip the session work; auth rules untouched', () => {
  const p = read('proxy.ts')
  const literal = p.split('\n').find(l => l.includes("'/((?!"))
  assert.ok(literal, 'matcher found')
  const source = new Function('return ' + literal.trim().replace(/,$/, ''))()   // the JS string the framework receives
  const re = new RegExp('^' + source)
  for (const staticPath of ['/manifest.json', '/sw.js', '/offline.html', '/icons/icon-192.png']) assert.ok(!re.test(staticPath), staticPath + ' excluded')
  for (const livePath of ['/app', '/login', '/api/billing/status', '/api/stripe/checkout']) assert.ok(re.test(livePath), livePath + ' still runs the session proxy')
  const mw = read('lib/supabase/middleware.ts')
  assert.ok(/request\.nextUrl\.pathname\.startsWith\('\/app'\)/.test(mw), 'only /app is protected, as before')
})
