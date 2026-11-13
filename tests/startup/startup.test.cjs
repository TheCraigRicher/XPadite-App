// v1.339 — startup readiness: "not loaded" is never "empty". Real module (startupReadiness.ts) + source pins for the wiring and the loader.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-startup'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'startupReadiness.js'), ts.transpileModule(read('components/xpadite/startupReadiness.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const R = require(path.join(OUT, 'startupReadiness.js'))
const stages = (done = [], failed = []) => { const s = R.freshStages(); for (const d of done) s[d] = 'done'; for (const f of failed) s[f] = 'failed'; return s }
const REQ = R.REQUIRED_STAGES

test('the weights add up to a whole and every stage has one', () => {
  const sum = R.STAGE_IDS.reduce((n, s) => n + R.STAGE_WEIGHTS[s], 0)
  assert.equal(sum, 100)
  assert.equal(R.stageProgress(stages(R.STAGE_IDS)), 1)
  assert.equal(R.stageProgress(R.freshStages()), 0)
})

test('progress counts only stages that really completed — a failed stage is not progress', () => {
  const a = R.stageProgress(stages(['local', 'auth']))
  const b = R.stageProgress(stages(['local', 'auth'], ['calendar']))
  assert.equal(a, b, 'a failed read adds nothing')
  assert.ok(R.stageProgress(stages(['local', 'auth', 'calendar'])) > a, 'a completed read adds its weight')
  assert.ok(R.STAGE_WEIGHTS.calendar > R.STAGE_WEIGHTS.sessions && R.STAGE_WEIGHTS.sessions > R.STAGE_WEIGHTS.reminders, 'heavier reads move the ring further')
})

test('the data guarding stages are the ones that can overwrite user records; optional reads never gate editing', () => {
  for (const s of ['auth', 'calendar', 'sessions', 'activities', 'preferences', 'reminders', 'labels']) assert.ok(REQ.includes(s), s)
  for (const s of ['local', 'folders', 'notes', 'schedule']) assert.ok(!REQ.includes(s), s)
})

test('status: ready only when EVERY required stage read successfully', () => {
  assert.equal(R.decideStatus({ stages: stages(REQ), verifiedForUser: false, networkDown: false }), 'ready')
  for (const missing of REQ) {
    const s = stages(REQ.filter(x => x !== missing))
    assert.equal(R.decideStatus({ stages: s, verifiedForUser: true, networkDown: true }), 'loading', 'still pending: ' + missing)
  }
})

test('status: a failed read is offline ONLY with a verified copy AND no network; otherwise blocked — never "empty"', () => {
  const f = stages(REQ.filter(x => x !== 'calendar'), ['calendar'])
  assert.equal(R.decideStatus({ stages: f, verifiedForUser: true, networkDown: true }), 'offline')
  assert.equal(R.decideStatus({ stages: f, verifiedForUser: false, networkDown: true }), 'failed', 'no verified copy: could be anything, stay blocked')
  assert.equal(R.decideStatus({ stages: f, verifiedForUser: true, networkDown: false }), 'failed', 'the server answered with an error: not offline')
  assert.equal(R.decideStatus({ stages: f, verifiedForUser: false, networkDown: false }), 'failed')
})

test('only ready / offline allow edits and saving', () => {
  assert.equal(R.isDataReady('ready'), true); assert.equal(R.isDataReady('offline'), true)
  assert.equal(R.isDataReady('loading'), false); assert.equal(R.isDataReady('failed'), false)
})

test('the verified-copy marker is trusted only when well formed', () => {
  assert.deepEqual(R.parseVerified(JSON.stringify({ uid: 'u1', at: 5 })), { uid: 'u1', at: 5 })
  for (const bad of [null, '', 'x', '{}', JSON.stringify({ uid: '', at: 1 }), JSON.stringify({ uid: 'u', at: 'now' }), JSON.stringify([1])]) assert.equal(R.parseVerified(bad), null, String(bad))
})

test('network-error detection', () => {
  assert.equal(R.looksLikeNetworkError(new TypeError('Failed to fetch')), true)
  assert.equal(R.looksLikeNetworkError({ message: 'NetworkError when attempting to fetch resource.' }), true)
  assert.equal(R.looksLikeNetworkError({ message: 'permission denied for table calendar_days', code: '42501' }), false)
  assert.equal(R.looksLikeNetworkError(null), false)
})

test('displayed percentage eases toward the real one: never decreases, never passes it, always arrives', () => {
  let cur = 0; const target = 0.62
  for (let i = 0; i < 400; i++) { const nx = R.stepDisplayed(cur, target, 16); assert.ok(nx >= cur, 'monotonic'); assert.ok(nx <= target + 1e-12, 'never beyond the real value'); cur = nx }
  assert.ok(Math.abs(cur - target) < 1e-6, 'arrives')
  assert.equal(R.stepDisplayed(0.5, 0.2, 16), 0.5, 'a lower target never pulls it back')
  assert.equal(R.stepDisplayed(0.3, 0.9, -16), 0.3, 'a negative frame time (rAF timestamp before performance.now) cannot move it')
  assert.equal(R.stepDisplayed(0.3, 0.9, 0), 0.3)
})

// ── wiring pins ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ctx = read('components/xpadite/AppContext.tsx')
const core = read('lib/supabase/core-data.ts')

test('startup reads are STRICT: a failed read throws instead of looking like "nothing there"', () => {
  for (const call of ["fetchCalendarDaysWithRev(supabase, userId, true)", "fetchWorkSessions(supabase, userId, true)", "fetchUserActivities(supabase, userId, true)", "fetchUserPreferences(supabase, userId, true)", "supabaseFetchReminders(true)", "fetchJournalLabels(supabase, userId, true)"]) assert.ok(ctx.includes(call), call)
  assert.match(core, /if \(plain\.error && strict\) throw plain\.error/)
  assert.match(core, /strict \? await q\.maybeSingle\(\) : await q\.single\(\)/, 'preferences: "no row" is a valid empty, an error is not')
  assert.equal((core.match(/if \(error && strict\) throw error/g) || []).length, 3, 'sessions, activities, labels')
  assert.match(read('lib/reminders.ts'), /if \(error && strict\) throw error/)
})

test('a failed startup read applies NOTHING: no partial merge, no "hydrated" flag, the device copy is untouched', () => {
  const i = ctx.search(/Promise\.all\(\[\r?\n\s+track\('calendar'/)
  assert.ok(i > 0)
  const body = ctx.slice(i, ctx.indexOf('}, [userId, startup.attempt', i))
  assert.match(body, /\.catch\(err => \{[\s\S]*settleStartup\(err\)/)
  assert.ok(body.indexOf('setCalHydrated(true)') > 0 && body.indexOf('setCalHydrated(true)') < body.indexOf('.catch('), 'calHydrated only on the success path')
  assert.ok(!/\.catch\(err => \{[\s\S]*setCalData/.test(body), 'the failure path never touches calendar data')
})

test('edits made before the data is ready are held and replayed on top of the loaded data — never applied to an unloaded screen, never lost', () => {
  assert.match(ctx, /if \(!dataReadyRef\.current\) \{ if \(heldEditsRef\.current\.length < 500\) heldEditsRef\.current\.push\(\{ key, updater, opts \}\); return \}/)
  assert.match(ctx, /for \(const h of held\) applyDayEditRef\.current\(h\.key, h\.updater, h\.opts\)/)
})

test('no day is written to the server before the data is ready; flush reports "not confirmed" until then', () => {
  assert.match(ctx, /await waitReady\(signal\)[\s\S]{0,200}const uid = userIdRef\.current/)
  assert.match(ctx, /if \(!dataReadyRef\.current\) return false\s+\/\/ not loaded yet/)
})

test('every other server writer is silent until ready (sessions, activities, preferences, labels, folders, reminders)', () => {
  const tail = ctx.slice(ctx.indexOf('// sums `sessions`'))
  assert.ok(!/= userIdRef\.current\s*$/m.test(tail.split('\n').filter(l => /(const|let) uid =/.test(l)).join('\n')), 'every writer reads uid through the ready gate')
  assert.ok((tail.match(/uid = dataReadyRef\.current \? userIdRef\.current : ''/g) || []).length >= 15)
})

test('the app is inert and covered until the loader is done; layout is unchanged (display: contents)', () => {
  assert.match(ctx, /<div style=\{\{ display: 'contents' \}\} inert=\{!overlayDone \|\| !dataReady\}>\{children\}<\/div>/)
  assert.match(ctx, /\{hydrated && <AppContext\.Provider value=/, 'the app only renders once hydrated; the loader (one stable position in the tree) is painted from the very first frame')
  assert.match(ctx, /appVisible=\{hydrated\}/)
})

test('backgrounding can never release the overlay (or unblock the app) before the data is ready', () => {
  assert.match(ctx, /onDone=\{\(\) => \{ if \(!dataReadyRef\.current\) return/)
  assert.match(ctx, /inert=\{!overlayDone \|\| !dataReady\}/)
  assert.match(ld, /if \(phase === 'run'\) return\s+const hidden/, 'the visibility release only exists after the completion phases')
})

test('the account is identified offline too (stored session), and Retry / coming back online re-run the read', () => {
  assert.match(ctx, /auth\.getSession\(\)/)
  assert.match(ctx, /window\.addEventListener\('online', on\)/)
  assert.match(ctx, /attemptRef\.current \+= 1/)
})

test('the verified marker is written only after a COMPLETE successful read, for that account', () => {
  assert.match(ctx, /if \(status === 'ready'\) \{ try \{ localStorage\.setItem\(VERIFIED_KEY, JSON\.stringify\(\{ uid: userIdRef\.current/)
})

// ── loader pins ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ld = read('components/xpadite/StartupLoader.tsx')

test('loader: 36 evenly spaced spikes lit by a CLOCKWISE wave (sequential illumination, not a rotating graphic)', () => {
  assert.match(ld, /const N = 36/)
  assert.match(ld, /const th = \(360 \/ N\) \* i/)
  assert.match(ld, /const hit = \(i \/ N\) \* LAP_S/, 'spike i+1 is hit AFTER spike i: angles rise = clockwise')
  assert.match(ld, /animationDelay: s\.delay/)
  assert.ok(!/\.xl-spikes\s*\{[^}]*(rotate|animation)/.test(ld), 'the spike group itself never rotates')
  assert.match(ld, /@keyframes xl-trail\{0%\{opacity:1\}[\s\S]*?66%\{opacity:\.14\}/, 'bright head, long fade trail')
})

test('loader: one clockwise lap is 0.8–1.6 s, so a 2.5–4 s load shows about 2–3 laps; the spike CSS animation is independent of loading state', () => {
  const lap = +/const LAP_S = ([0-9.]+)/.exec(ld)[1]
  assert.ok(lap >= 0.8 && lap <= 1.6, String(lap))
  assert.match(ld, /\.xl-sp\{opacity:\.14;animation:xl-trail \$\{LAP_S\}s linear infinite/)
})

test('loader: the ring starts at 12 o\'clock and fills clockwise from the real progress', () => {
  assert.match(ld, /rotate\(-90 \$\{CX\} \$\{CY\}\)/)
  assert.match(ld, /strokeDashoffset = off|CIRC \* \(1 - f\)/)
  assert.match(ld, /polar\(R_RING, f \* 360\)/, 'the bright head sits at the clockwise angle of the progress')
})

test('loader: 100% / Loaded only once complete; no logo or wordmark while loading; a failed load shows Retry', () => {
  assert.match(ld, /isComplete && f >= 0\.995 \? 100 : Math\.min\(99, Math\.round\(f \* 100\)\)/)
  assert.match(ld, /\.xl-mark\{[^}]*opacity:0/, 'logo + wordmark are invisible until the reveal')
  assert.match(ld, /\.xl-past \.xl-mark\{animation:xl-in/)
  assert.match(ld, /status === 'failed' && phase === 'run'/)
  assert.match(ld, /onClick=\{onRetry\}/)
})

test('loader: the original X — three traced polygons with a rim and a bevelled face, no red square, no invented geometry', () => {
  const m = /const X_SHAPES[^=]*= \[([\s\S]*?)\n\]/.exec(ld)[1]
  assert.equal((m.match(/\[\[/g) || []).length, 3, 'three shapes')
  assert.ok(m.includes('[656, 169]') && m.includes('[141, 672]') && m.includes('[751, 657]'), 'vertices traced from the supplied PNG')
  assert.ok(!/<rect/.test(ld.split('<g className="xl-mark">')[1].split('</g>')[0]), 'no rounded-square background')
  assert.ok(!/#(?:ff0000|dc2626|ef4444|b91c1c|991b1b)/i.test(ld), 'the red is gone')
})

test('loader: reduced motion simplifies the animation; a hidden tab never holds the app behind the overlay', () => {
  assert.match(ld, /prefers-reduced-motion:reduce\)\{\s*\.xl-sp\{animation:none/)
  assert.match(ld, /if \(hidden\(\)\) \{ finish\(\); return \}/)
  assert.match(ld, /visibilitychange/)
})

// ── v1.340 refinements ────────────────────────────────────────────────────────────────────────────────────────────────────
test('v1.340: the overlay is see-through (app visible, no blur) but still covers and blocks the whole screen', () => {
  const bg = /\.xl-bg\{[^}]*\}/.exec(ld)[0]
  const alphas = [...bg.matchAll(/rgba\(\d+,\d+,\d+,([0-9.]+)\)/g)].map(m => +m[1])
  assert.ok(alphas.length >= 2 && Math.max(...alphas) <= 0.4, 'translucent: ' + bg)
  assert.ok(!/blur\(|backdrop-filter/.test(ld), 'no blur')
  assert.match(ld, /\.xl-root\{position:fixed;inset:0;/, 'still a full-screen layer that takes every touch')
  assert.match(ld, /\.xl-solid-off\{opacity:0\}/, 'the solid backdrop is only for the instant before the app is rendered')
  assert.match(ctx, /inert=\{!overlayDone \|\| !dataReady\}/, 'inert protection unchanged')
})

test('v1.340: spikes are ~35% thinner and wear the ring gradient', () => {
  assert.match(ld, /th - 0\.58\), polar\(R_OUT, th - 1\.5\)/)
  const ring = /id="xl-ring"[^>]*>(.*?)<\/linearGradient>/.exec(ld)[1], spk = /id="xl-spike"[^>]*>(.*?)<\/linearGradient>/.exec(ld)[1]
  assert.equal(ring, spk, 'identical colour stops')
  assert.match(ld, /fill="url\(#xl-spike\)"/)
})

test('v1.340: phones get a loader 15% smaller; tablets/desktop unchanged', () => {
  assert.match(ld, /\.xl-stage\{position:relative;width:min\(78vmin,420px\)/)
  assert.match(ld, /@media \(max-width:600px\),\(max-height:500px\)\{\.xl-stage\{width:min\(56\.36vmin,303\.5px\)\}\}/)
  assert.ok(Math.abs(56.36 / 78 - 0.7225) < 0.002 && Math.abs(303.5 / 420 - 0.7225) < 0.002, 'v1.340 -15%, v1.341 a further -15% = 72.25% of the original')
  assert.ok(ld.indexOf('@media (max-width:600px),(max-height:500px)') > ld.indexOf('.xl-stage{position:relative'), 'the phone rule comes after the base rule so it wins')
})

test('v1.340: Loading. / Loading.. / Loading... cycles every 400 ms per stage, in a stable-width label', () => {
  assert.match(ld, /Loading<tspan className="xl-d1">\.<\/tspan><tspan className="xl-d2">\.<\/tspan><tspan className="xl-d3">\.<\/tspan>/)
  assert.match(ld, /\.xl-d2,\.xl-d3\{animation:xl-dot 1\.2s step-end infinite\}/, '3 stages x 400 ms')
  assert.match(ld, /@keyframes xl-dot\{0%\{opacity:0\}33\.33%\{opacity:1\}/)
  assert.match(ld, /@keyframes xl-dot3\{0%\{opacity:0\}66\.66%\{opacity:1\}/)
  assert.ok(!/\.xl-d[123]\{[^}]*display:none/.test(ld), 'dots are faded, never removed, so the width never changes')
})

test('v1.340: the wordmark is the supplied PNG used as a mask (no font, no redrawn letters)', () => {
  const png = fs.readFileSync(path.join(ROOT, 'public/startup/xpadite-wordmark.png'))
  assert.equal(png.readUInt32BE(16), 1600); assert.equal(png.readUInt32BE(20), 220); assert.equal(png[25], 6, 'RGBA: transparent background')
  assert.match(ld, /<mask id="xl-wm-mask"[^>]*><image href="\/startup\/xpadite-wordmark\.png"/)
  assert.match(ld, /mask="url\(#xl-wm-mask\)"/)
  assert.ok(!/<text[^>]*xl-word/.test(ld) && !/font:italic 800/.test(ld), 'no system-font approximation left')
  assert.match(ld, /\.xl-mark\{filter:drop-shadow\(0 0 7px rgba\(147,51,234,\.5\)\)/, 'a soft purple glow, no outline')
})

// ── v1.341 polish ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('v1.341: X and wordmark are one solid #9333EA — no gradient, no bevel face, no silver rim, no outline', () => {
  assert.match(ld, /const BRAND = '#9333EA'/)
  assert.match(ld, /<polygon key=\{i\} points=\{p\} fill=\{BRAND\} \/>/)
  assert.match(ld, /fill=\{BRAND\} mask="url\(#xl-wm-mask\)"/)
  const mark = ld.split('<g className="xl-mark">')[1].split('</svg>')[0]
  assert.ok(!/stroke=|url\(#xl-(rim|face|word)\)|linearGradient/.test(mark), 'nothing but the solid fill')
  assert.ok(!/xl-rim|xl-face|xl-word"\s*x1|function inset/.test(ld), 'bevel + gradients removed')
  // the geometry is the SAME three traced silhouettes as v1.339/v1.340
  const m = /const X_SHAPES[^=]*= \[([\s\S]*?)\r?\n\]/.exec(ld)[1]
  assert.ok(m.includes('[[141, 672], [656, 169], [311, 673]]') && m.includes('[[144, 377], [354, 438], [294, 497]]') && m.includes('[[401, 568], [457, 488], [751, 657], [520, 658]]'))
})

test('v1.341: the backdrop is a soft radial vignette (darkest centre, transparent rim), not a disc', () => {
  const vig = /<radialGradient id="xl-vig"[^>]*>(.*?)<\/radialGradient>/.exec(ld)[1]
  const ops = [...vig.matchAll(/stopOpacity="([0-9.]+)"/g)].map(m => +m[1])
  assert.deepEqual(ops, [0.62, 0.5, 0.2, 0], 'centre darkest, fading to nothing')
  assert.ok(ops[0] <= 0.65, 'the calendar still shows through the middle')
  assert.match(ld, /<circle cx=\{CX\} cy=\{CY\} r="236" fill="url\(#xl-vig\)" \/>/)
  assert.ok(!/#080320/.test(ld), 'the old solid disc is gone')
})

test('v1.341: forward-moving energy lives inside the FILLED part of the ring only (masked by the progress arc), clockwise, CSS-driven', () => {
  assert.match(ld, /<mask id="xl-prog"[^>]*><circle ref=\{arc3Ref\}/, 'the mask is the progress arc')
  assert.match(ld, /if \(arc3\) arc3\.style\.strokeDashoffset = off/, 'same dash offset as the visible arc')
  assert.match(ld, /<g mask="url\(#xl-prog\)" className="xl-en">/)
  assert.match(ld, /@keyframes xl-en\{from\{stroke-dashoffset:0\}to\{stroke-dashoffset:-\$\{EN_P\}\}\}/, 'dash offset falls = pulses travel forward (clockwise)')
  assert.match(ld, /const EN_P = CIRC \/ 8/, 'the pattern tiles the circumference exactly: seamless loop')
  assert.match(ld, /\.xl-paused \.xl-en1\{animation-play-state:paused\}/)
  assert.match(ld, /prefers-reduced-motion:reduce\)\{[\s\S]*\.xl-en\{display:none\}/)
})

test('v1.341: the spikes dim while the load completes, before the logo appears', () => {
  assert.match(ld, /complete && phase === 'run' \? 'xl-finishing' : ''/)
  assert.match(ld, /\.xl-finishing \.xl-spikes\{opacity:\.5\}/)
  assert.match(ld, /\.xl-ph-loaded \.xl-spikes\{opacity:\.2\}/)
  assert.match(ld, /\.xl-past \.xl-spikes,\.xl-past \.xl-txt\{opacity:0\}/)
})

test('v1.341: gentler zoom — scale 4.3 (was 6, -28%) and fully faded by 82% of the animation', () => {
  const s = ld.slice(ld.indexOf('@keyframes xl-zoom'))
  assert.match(s, /^@keyframes xl-zoom\{0%\{opacity:1;transform:scale\(1\)\}30%\{opacity:\.82\}82%\{opacity:0\}100%\{opacity:0;transform:scale\(4\.3\)\}\}/)
  assert.ok(Math.abs(4.3 / 6 - 0.72) < 0.01, '28% less zoom')
  assert.match(ld, /\.xl-ph-zoom \.xl-mark\{animation:xl-zoom \.95s/, 'same duration: startup is not prolonged')
})
