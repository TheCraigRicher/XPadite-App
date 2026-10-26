// iOS modal stability: the shared body lock freezes the page on iOS phones only; Android and desktop behave exactly as before.
// Runs the REAL useLockBodyScroll.ts against a fake window/document/navigator.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-ios-tests'); fs.mkdirSync(OUT, { recursive: true })
const file = path.join(OUT, 'useLockBodyScroll.js')
fs.writeFileSync(file, ts.transpileModule(read('components/xpadite/useLockBodyScroll.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
let effect
const orig = Module._load
Module._load = function (req, parent, isMain) { return req === 'react' ? { useEffect: fn => { effect = fn } } : orig.call(this, req, parent, isMain) }
const lock = require(file)
Module._load = orig

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

function env({ ua, width = 390, platform = 'iPhone', touch = 5, scrollY = 120, bodyStyle = {} }) {
  const calls = []
  Object.defineProperty(global, 'navigator', { value: { userAgent: ua, platform, maxTouchPoints: touch }, configurable: true, writable: true })
  global.window = { innerWidth: width, scrollY, scrollTo: (x, y) => calls.push(['scrollTo', x, y]) }
  global.document = { body: { style: { overflow: '', position: '', top: '', left: '', width: '', ...bodyStyle } } }
  return { calls, style: global.document.body.style }
}
function runHook() { const c = effect() ; return typeof c === 'function' ? c : () => {} }

test('iPhone portrait (<640): page is FROZEN (position:fixed) while a modal is open, and fully restored on close', () => {
  const e = env({ ua: UA.iphone })
  lock.useLockBodyScroll(); const release = runHook()
  assert.equal(e.style.position, 'fixed'); assert.equal(e.style.overflow, 'hidden'); assert.equal(e.style.top, '-120px'); assert.equal(e.style.left, '0'); assert.equal(e.style.width, '100%')
  release()
  assert.deepEqual([e.style.position, e.style.overflow, e.style.top, e.style.left, e.style.width], ['', '', '', '', ''])
  assert.deepEqual(e.calls, [['scrollTo', 0, 120]], 'scroll position restored')
})

test('Android phone: unchanged — overflow:hidden only, never position:fixed', () => {
  const e = env({ ua: UA.android, platform: 'Linux armv81' })
  lock.useLockBodyScroll(); const release = runHook()
  assert.equal(e.style.overflow, 'hidden'); assert.equal(e.style.position, ''); assert.equal(e.style.top, ''); assert.equal(e.style.left, '')
  release(); assert.equal(e.style.overflow, ''); assert.deepEqual(e.calls, [], 'no scroll jump')
})

test('desktop / tablet-width (>=640): unchanged full freeze (no left set), exactly as before', () => {
  const e = env({ ua: UA.desktop, width: 1280, platform: 'Win32', touch: 0 })
  lock.useLockBodyScroll(); const release = runHook()
  assert.deepEqual([e.style.overflow, e.style.position, e.style.top, e.style.left, e.style.width], ['hidden', 'fixed', '-120px', '', '100%'])
  release(); assert.deepEqual([e.style.overflow, e.style.position, e.style.top, e.style.width], ['', '', '', ''])
})

test('iPadOS reporting itself as a Mac is recognised as iOS; a plain Mac is not', () => {
  env({ ua: UA.desktop, platform: 'MacIntel', touch: 5 }); assert.equal(lock.isIOS(), true)
  env({ ua: UA.desktop, platform: 'MacIntel', touch: 0 }); assert.equal(lock.isIOS(), false)
  env({ ua: UA.android, platform: 'Linux armv81' }); assert.equal(lock.isIOS(), false)
})

test('a modal opened over an already-frozen page (nested / Analytics) does not shift the page or restore wrongly', () => {
  const e = env({ ua: UA.iphone, scrollY: 0, bodyStyle: { position: 'fixed', top: '-300px', overflow: 'hidden', width: '100%' } })
  lock.useLockBodyScroll(); const release = runHook()
  assert.equal(e.style.top, '-300px', 'the first lock\'s offset is untouched')
  release()
  assert.equal(e.style.position, 'fixed', 'the outer lock stays in force'); assert.equal(e.style.top, '-300px'); assert.deepEqual(e.calls, [])
})

test('non-iOS helper is a no-op (MonthFullPage uses it on top of its own overflow lock)', () => {
  const e = env({ ua: UA.android, platform: 'Linux armv81' })
  assert.equal(lock.freezeBodyOnIOS(), null); assert.equal(e.style.position, '')
  env({ ua: UA.iphone }); assert.equal(typeof lock.freezeBodyOnIOS(), 'function')
})

test('scope guard: the shared hook feeds Task Manager (DayModal) and the other phone modals; MonthFullPage adds only the iOS freeze', () => {
  for (const f of ['DayModal', 'ProfileModal', 'SettingsModal', 'HelpFeedbackModal', 'GalleryModal', 'ActivityManagerModal', 'NotificationsModal', 'MeetingsModal', 'SyncModal', 'WhatsNewModal', 'GoalManagerModal', 'SendToOptionsModal'])
    assert.ok(/useLockBodyScroll\(\)/.test(read(`components/xpadite/${f}.tsx`)), f + ' uses the shared lock')
  const m = read('components/xpadite/MonthFullPage.tsx')
  assert.ok(/const releaseIOS = freezeBodyOnIOS\(\)/.test(m) && /document\.body\.style\.overflow = 'hidden'/.test(m), 'its existing lock is intact')
  const css = read('app/globals.css'); assert.ok(!/touch-action:\s*none/.test(css), 'no touch-action:none introduced')
  assert.ok(!/preventDefault/.test(read('components/xpadite/useLockBodyScroll.ts')), 'no blanket preventDefault')
})
