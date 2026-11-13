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

test('loader: 100% Loaded only once complete; a failed load shows Retry', () => {
  assert.match(ld, /isComplete && f >= 0\.995 \? 100 : Math\.min\(99, Math\.round\(f \* 100\)\)/)
  assert.match(ld, /status === 'failed' && phase === 'run'/)
  assert.match(ld, /onClick=\{onRetry\}/)
})

test('loader: a hidden tab never holds the app behind the overlay', () => {
  assert.match(ld, /if \(hidden\(\)\) \{ finish\(\); return \}/)
  assert.match(ld, /visibilitychange/)
})

// ── v1.343: horizontal progress bar ───────────────────────────────────────────────────────────────────────────────────────
test('v1.343/344: the segments light left to right from the real (eased, never ahead) progress', () => {
  assert.match(ld, /const o = Math\.max\(0, Math\.min\(1, f \* SEG - i\)\)/, 'segment i lights only as the real progress passes it')
  assert.match(ld, /stepDisplayed\(shown\.current, isComplete \? 1 : progressRef\.current, isComplete \? dt \* 5 : dt\)/, 'target is the real progress (1 only once complete)')
  assert.match(ld, /f > 0\.002 && f < 0\.9995 \? now : -1/)
})

test('v1.344: separate slanted segments with dark gaps (no candy stripes), XPadite gradient, #160B30 track, breathing leading segment', () => {
  assert.match(ld, /\.xl-bar\{[^}]*border:2px solid #c026d3[^}]*border-radius:999px[^}]*background:#160B30[^}]*overflow:hidden/)
  assert.match(ld, /\.xl-segs\{[^}]*display:flex;gap:4px/, 'gaps show the navy track')
  assert.match(ld, /\.xl-seg\{[^}]*transform:skewX\(-24deg\)/)
  assert.match(ld, /const SEG = 16/)
  assert.match(ld, /C0 = \[0x93, 0x33, 0xea\], C1 = \[0xd9, 0x46, 0xef\]/, '#9333EA -> #D946EF')
  assert.ok(!/xl-fill|xl-stripes|repeating-linear-gradient/.test(ld), 'no scrolling stripe texture')
  assert.match(ld, /@keyframes xl-lead\{0%,100%\{filter:brightness\(1\)\}50%\{filter:brightness\(1\.35\)/)
  assert.match(ld, /\.xl-paused \.xl-lead\{animation-play-state:paused\}/)
})

test('v1.343: phones 220–260px, larger on tablet/desktop, bar centred with the text hanging below it', () => {
  assert.match(ld, /\.xl-stage\{position:relative;width:min\(62vw,240px\)/)
  assert.match(ld, /@media \(min-width:601px\) and \(min-height:501px\)\{\.xl-stage\{width:360px\}\}/)
  assert.match(ld, /\.xl-txt\{position:absolute;left:0;right:0;top:100%/)
})

test('v1.343: "NN% Loading." / ".." / "..." in #C026D3, "100% Loaded" at the end', () => {
  assert.match(ld, /Loading<span className="xl-d1">\.<\/span><span className="xl-d2">\.<\/span><span className="xl-d3">\.<\/span>/)
  assert.match(ld, /\.xl-d2,\.xl-d3\{animation:xl-dot 1\.2s step-end infinite\}/)
  assert.match(ld, /@keyframes xl-dot\{0%\{opacity:0\}33\.33%\{opacity:1\}/)
  assert.match(ld, /@keyframes xl-dot3\{0%\{opacity:0\}66\.66%\{opacity:1\}/)
  assert.match(ld, /const label = failed \? 'Couldn’t load' : 'Loaded'/)
  assert.match(ld, /\.xl-txt\{[^}]*color:#C026D3/)
})

test('v1.343: no ring, spikes, logo, wordmark, zoom, disc, vignette or blur; the app shows through', () => {
  assert.ok(!/<svg|<circle|<polygon|SPIKES|xl-sp\b|xl-mark|xl-zoom|xl-ph-logo|xl-bg|xl-vig|xl-rim|xpadite-wordmark|blur\(|backdrop-filter/.test(ld))
  assert.match(ld, /type Phase = 'run' \| 'loaded' \| 'fade'/)
  assert.match(ld, /\.xl-solid-off\{opacity:0\}/)
  assert.match(ld, /\.xl-root\{position:fixed;inset:0;/)
  assert.match(ctx, /inert=\{!overlayDone \|\| !dataReady\}/)
})

test('v1.344: 100% Loaded for 120 ms, 110 ms fade (~230 ms), app released only when data is ready; reduced motion respected', () => {
  assert.match(ld, /phase === 'loaded' \? setTimeout\(\(\) => setPhase\('fade'\), 120\)/)
  assert.match(ld, /: setTimeout\(finish, 110\)/)
  assert.match(ld, /\.xl-ph-fade \.xl-stage\{opacity:0\}/)
  assert.match(ld, /\.xl-solid\{[^}]*transition:opacity \.2s ease/, 'backdrop clears quickly once the app is on screen')
  assert.match(ctx, /onDone=\{\(\) => \{ if \(!dataReadyRef\.current\) return/)
  assert.match(ld, /prefers-reduced-motion:reduce\)\{\s*\.xl-lead\{animation:none\}/)
})
