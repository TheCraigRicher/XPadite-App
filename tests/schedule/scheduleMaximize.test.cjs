// My Schedule desktop Maximize / Restore: wiring checks (the real-Chrome geometry checks run separately in a browser).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const src = f => fs.readFileSync(path.join(ROOT, `components/xpadite/${f}`), 'utf8').split('\r\n').join('\n')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('desktop breakpoint is 1024px and up (phones < 640 and portrait tablets are not desktop)', () => {
  const s = src('ScheduleSheet.tsx')
  assert.match(s, /DESKTOP_QUERY = '\(min-width: 1024px\)'/)
  assert.ok(/export function useIsDesktop\(\): boolean/.test(s) && /useSyncExternalStore\(subscribeDesktop, \(\) => window\.matchMedia\(DESKTOP_QUERY\)\.matches, \(\) => false\)/.test(s))
})

test('the toggle is a header button left of Close: four-corner outward/inward icons, accessible, desktop only', () => {
  const m = src('MeetingsModal.tsx')
  const hdr = m.slice(m.indexOf('{/* Header */}'), m.indexOf('{/* Tabs + the one Add Event button'))
  assert.ok(hdr.indexOf('data-testid="maximize-btn"') > -1 && hdr.indexOf('data-testid="maximize-btn"') < hdr.indexOf('aria-label="Close"'), 'icon comes before (left of) Close')
  assert.ok(/\{desktop && \(/.test(hdr), 'rendered only at ≥ 1024px')
  assert.ok(/aria-label=\{maximized \? 'Restore' : 'Maximize'\}/.test(hdr) && /title=\{maximized \? 'Restore' : 'Maximize'\}/.test(hdr) && /type="button"/.test(hdr), 'tooltip + accessible name; a real <button> so Enter/Space work')
  const outward = ['M4 9V4h5M4 4l6 6', 'M20 9V4h-5M20 4l-6 6', 'M4 15v5h5M4 20l6-6', 'M20 15v5h-5M20 20l-6-6']
  const inward = ['M10 4v6H4M10 10 4 4', 'M14 4v6h6M14 10l6-6', 'M10 20v-6H4M10 14l-6 6', 'M14 20v-6h6M14 14l6 6']
  for (const d of [...outward, ...inward]) assert.ok(hdr.includes(`d="${d}"`), d)
  assert.ok(hdr.indexOf(outward[0]) > hdr.indexOf(inward[0]), 'restore (inward) icon shown while maximized, maximize (outward) otherwise')
  assert.ok(/width: 30, height: 30, borderRadius: '50%'/.test(hdr.slice(hdr.indexOf('maximize-btn'), hdr.indexOf('aria-label="Close"'))), 'same 30px circle as Close; the header row itself is unchanged')
  assert.ok(/\.xp-hdr-btn:hover/.test(m) && /\.xp-hdr-btn:active \{ transform: scale\(0\.93\)/.test(m) && /\.xp-hdr-btn:focus-visible/.test(m) && /\.xp-hdr-btn \{ transition: none; \}/.test(m), 'hover, active, focus ring, reduced motion')
})

test('maximized = true edge-to-edge: no padding, no radius, no border/shadow, full 100% width and 100dvh height, no Fullscreen API', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(/const maximized = desktop && maxRequested/.test(m), 'only ever active on desktop')
  assert.ok(/\.\.\.\(maximized \? \{ padding: 0 \} : null\)/.test(m), 'the overlay padding (the gap around the modal) is removed')
  assert.ok(/\.\.\.\(maximized \? \{ maxWidth: '100%', height: '100dvh', borderRadius: 0 \} : null\)/.test(m), '100% width (via w-full), 100dvh height, no radius')
  assert.ok(/border: maximized \? 'none'/.test(m) && /boxShadow: maximized \? 'none'/.test(m))
  assert.ok(/fixed inset-0 z-\[70\]/.test(m), 'the overlay already covers the whole viewport (inset-0), so no app shows around the modal')
  assert.ok(!/requestFullscreen|fullscreenElement|exitFullscreen/.test(strip(m)), 'the browser Fullscreen API is not used')
  assert.ok(!/95vw|98vw|calc\(100vw - |calc\(100dvh - [0-9]+px\)'\s*:/.test(strip(m).replace(/sm:h-\[calc\(100dvh-28px\)\]/g, '')), 'not a near-full size')
})

test('normal size is untouched: the same Analytics-style classes remain for every width', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(/sm:h-\[calc\(100dvh-28px\)\] sm:max-w-\[640px\] md:max-w-\[900px\] lg:max-w-\[1296px\] rounded-none sm:rounded-2xl/.test(m))
  assert.ok(/sm:p-3 sm:pt-4/.test(m) && /border: maximized \? 'none' : '0\.5px solid var\(--xp-bdr2\)'/.test(m))
})

test('resize is a pure style change: one persistent dialog element, no remount, no state reset, nothing keyed on `maximized`', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(!/key=\{[^}]*maximized/.test(m) && !/\{maximized \? <MyScheduleView/.test(m) && !/\{maximized && <MyScheduleView/.test(m), 'My Schedule is not conditionally rendered by size')
  assert.equal((m.match(/<MyScheduleView/g) || []).length, 1)
  assert.ok(/const \[maxRequested, setMaxRequested\] = useState\(false\)/.test(m) && /onClick=\{\(\) => setMaxRequested\(m => !m\)\}/.test(m))
  assert.ok(!/setTab\(|setQuery\(|setFilter\(|setHidden\(|setForm\(null\)/.test(m.slice(m.indexOf('onClick={() => setMaxRequested'), m.indexOf('onClick={() => setMaxRequested') + 80)), 'toggling touches no other state')
})

test('smooth, reduced-motion-safe transition on the size/padding/radius only', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(/lg:transition-\[padding\] lg:duration-200 lg:motion-reduce:transition-none/.test(m) && /lg:transition-\[max-width,height,border-radius\] lg:duration-200 lg:motion-reduce:transition-none/.test(m))
})

test('shrinking below 1024px while maximized resets to the normal responsive layout (and does not re-maximize later)', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(/if \(!desktop && maxRequested\) setMaxRequested\(false\)/.test(m))
})

test('the interior is not rescaled: the weekly grid keeps its hour height and fills what the modal gives it; the sidebar stays', () => {
  const v = src('MyScheduleView.tsx')
  assert.ok(/const HOUR_PX = 56/.test(v) && /height: 24 \* HOUR_PX/.test(v), 'hour scale is a constant, independent of the modal size')
  assert.ok(/flex-1 min-w-0 min-h-0 flex flex-col/.test(v) && /relative flex-1 min-h-0/.test(v), 'grid is flexible')
  assert.ok(/hidden lg:flex flex-col gap-3 w-\[296px\]/.test(v), 'sidebar stays at ≥ 1024px')
  assert.ok(!/maximized/.test(strip(v)), 'the view does not even know about maximize')
})

test('frontend-only: no storage, network or backend in the maximize code', () => {
  for (const f of ['MeetingsModal.tsx', 'ScheduleSheet.tsx']) assert.ok(!/supabase|fetch\(|localStorage|sessionStorage|indexedDB/i.test(strip(src(f))), f)
})
