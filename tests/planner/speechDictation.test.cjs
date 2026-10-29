// Planner microphone: speech-to-text session control (components/xpadite/speechDictation.ts — the real module) driven
// by a fake SpeechRecognition engine that can replay the event streams real browsers produce.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-speech'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'speechDictation.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, 'components/xpadite/speechDictation.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const { createDictation, prefersSingleUtterance } = require(path.join(OUT, 'speechDictation.js'))
const wait = ms => new Promise(r => setTimeout(r, ms))

class Rec {
  constructor(env) { this.env = env; this.started = false; this.stopped = false; this.aborted = false; this.onresult = this.onerror = this.onend = null; env.recs.push(this) }
  start() { if (this.env.failStart) throw new Error('InvalidStateError'); this.started = true }
  stop() { this.stopped = true }
  abort() { this.aborted = true }
  get live() { return this.started && !this.aborted && !this.ended }
  // helpers that play the part of the browser
  emit(results, resultIndex = 0) { this.onresult?.({ results: results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })), resultIndex }) }
  end() { this.ended = true; this.onend?.() }
}
function setup(over = {}) {
  const env = { recs: [], failStart: false }, text = [], fatal = [], activity = { n: 0 }, settled = { n: 0 }
  const d = createDictation({
    createRecognition: () => new Rec(env), lang: 'en-US', continuous: true, restartDelayMs: 5, drainMs: 40,
    onText: t => text.push(t), onActivity: () => activity.n++, onFatal: c => fatal.push(c), onSettled: () => settled.n++, ...over,
  })
  return { env, text, fatal, activity, settled, d, last: () => env.recs[env.recs.length - 1] }
}
const join = text => text.join(' ')

// ── the original defect ─────────────────────────────────────────────────────
test('ORIGINAL BUG reproduced: inserting every FINAL result of a cumulative stream (what the old handler did on Android/iOS) repeats the words', () => {
  // Android/iOS continuous mode: each update of one utterance arrives as a new, already-final result.
  const stream = [['just', true], ['just want', true], ['just want to', true], ['just want to make sure it works nicely', true]]
  let inserted = ''
  for (let step = 1; step <= stream.length; step++) {       // old handler: resultIndex = newest result, insert its transcript
    inserted += stream[step - 1][0].trim() + ' '
  }
  assert.equal(inserted.trim(), 'just just want just want to just want to make sure it works nicely')   // the reported symptom
})

test('FIX: those engines are run in single-utterance mode, so the same speech arrives as ONE final result and is inserted once', async () => {
  assert.equal(prefersSingleUtterance({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36' }), true)
  assert.equal(prefersSingleUtterance({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', platform: 'iPhone' }), true)
  assert.equal(prefersSingleUtterance({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true, 'iPadOS')
  assert.equal(prefersSingleUtterance({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', platform: 'Win32', maxTouchPoints: 0 }), false)
  assert.equal(prefersSingleUtterance({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false)
  const t = setup({ continuous: false })
  t.d.start(); const r = t.last()
  assert.equal(r.continuous, false, 'engine told to return one utterance per cycle')
  r.emit([['just', false]]); r.emit([['just want', false]]); r.emit([['just want to make sure it works nicely', true]])
  assert.equal(join(t.text), 'just want to make sure it works nicely')
})

// ── desktop continuous mode ─────────────────────────────────────────────────
test('interim results are provisional: nothing is inserted until a result is final', () => {
  const t = setup(); t.d.start(); const r = t.last()
  r.emit([['hello', false]]); r.emit([['hello wor', false]])
  assert.deepEqual(t.text, []); assert.ok(t.activity.n >= 2, 'still counts as activity (silence timer)')
  r.emit([['hello world', true]]); assert.deepEqual(t.text, ['hello world'])
})
test('long continuous dictation: each finalized segment is inserted exactly once, in order, however results are re-delivered', () => {
  const t = setup(); t.d.start(); const r = t.last()
  r.emit([['first sentence here', true]], 0)
  r.emit([['first sentence here', true], ['second part', false]], 1)
  r.emit([['first sentence here', true], ['second part of it', true]], 1)
  r.emit([['first sentence here', true], ['second part of it', true]], 0)      // an engine re-delivering everything with resultIndex 0
  r.emit([['first sentence here', true], ['second part of it', true], ['and a third', true]], 2)
  assert.deepEqual(t.text, ['first sentence here', 'second part of it', 'and a third'])
})
test('intentionally repeated words are preserved verbatim, in one result and across results', () => {
  const t = setup(); t.d.start(); const r = t.last()
  r.emit([['no no no no', true]]); r.emit([['no no no no', true], ['go', true]]); r.emit([['no no no no', true], ['go', true], ['go', true]])
  assert.deepEqual(t.text, ['no no no no', 'go', 'go'])
})
test('spacing/words are not rewritten: transcripts are only trimmed', () => {
  const t = setup(); t.d.start(); t.last().emit([['  It works, nicely.  ', true]])
  assert.deepEqual(t.text, ['It works, nicely.'])
})
test('empty / whitespace-only final results insert nothing', () => {
  const t = setup(); t.d.start(); t.last().emit([['   ', true], ['', true]]); assert.deepEqual(t.text, [])
})

// ── pauses and restarts ─────────────────────────────────────────────────────
test('pause: no-speech and the engine ending add no text; the session restarts itself and resumes; old text is never re-sent', async () => {
  const t = setup(); t.d.start(); const r1 = t.last()
  r1.emit([['before the pause', true]])
  r1.onerror?.({ error: 'no-speech' }); assert.deepEqual(t.fatal, [], 'no-speech is an ordinary pause')
  r1.end(); await wait(25)
  assert.equal(t.env.recs.length, 2, 'one fresh recognizer for the next cycle'); const r2 = t.last(); assert.ok(r2.live)
  assert.deepEqual(t.text, ['before the pause'], 'silence inserted nothing')
  r2.emit([['after the pause', true]])
  assert.deepEqual(t.text, ['before the pause', 'after the pause'], 'the new cycle numbers results from 0 again, yet nothing is repeated')
  r1.onresult?.({ results: [Object.assign([{ transcript: 'before the pause' }], { isFinal: true })], resultIndex: 0 })
  assert.equal(t.text.length, 2, 'a closed cycle can no longer reach the editor')
})
test('single-utterance mode: repeated end → restart cycles stay one-at-a-time and each utterance is inserted once', async () => {
  const t = setup({ continuous: false }); t.d.start()
  for (const said of ['one', 'two', 'three']) { const r = t.last(); r.emit([[said, true]]); r.end(); await wait(20) }
  assert.deepEqual(t.text, ['one', 'two', 'three']); assert.equal(t.env.recs.filter(r => r.live).length, 1)
})
test("'aborted' is ignored; fatal errors are reported", () => {
  const t = setup(); t.d.start(); const r = t.last()
  r.onerror?.({ error: 'aborted' }); assert.deepEqual(t.fatal, [])
  r.onerror?.({ error: 'not-allowed' }); assert.deepEqual(t.fatal, ['not-allowed'])
})
test('a refused restart is reported instead of looping', async () => {
  const t = setup(); t.d.start(); const r1 = t.last(); t.env.failStart = true
  r1.end(); await wait(25); assert.deepEqual(t.fatal, ['restart-failed']); assert.equal(t.d.active, false)
})

// ── no duplicate sessions / listeners ───────────────────────────────────────
test('ORIGINAL BUG: stop then start within the restart delay no longer leaves the old recognizer running next to the new one', async () => {
  const t = setup(); t.d.start(); const r1 = t.last()
  r1.end()                                  // browser ends the cycle → restart timer armed (5ms)
  t.d.stop(); t.d.start()                   // user toggles Mic off and on again straight away
  await wait(30)
  const live = t.env.recs.filter(r => r.live)
  assert.equal(live.length, 1, 'exactly one live recognizer'); assert.notEqual(live[0], r1)
  live[0].emit([['hello', true]]); assert.deepEqual(t.text, ['hello'], 'one insertion, not two')
})
test('calling start() repeatedly never creates a second recognizer', () => {
  const t = setup(); t.d.start(); t.d.start(); t.d.start(); assert.equal(t.env.recs.length, 1)
})
test('a failed start leaves the session inactive and clean', () => {
  const t = setup(); t.env.failStart = true
  assert.equal(t.d.start(), false); assert.equal(t.d.active, false)
  t.env.failStart = false; assert.equal(t.d.start(), true)
})

// ── stopping ────────────────────────────────────────────────────────────────
test('stop without drain: nothing the engine emits afterwards reaches the editor (pending callbacks are inert)', () => {
  const t = setup(); t.d.start(); const r = t.last(); r.emit([['kept', true]])
  const handler = r.onresult; t.d.stop()
  assert.ok(r.aborted); handler({ results: [Object.assign([{ transcript: 'late' }], { isFinal: true })], resultIndex: 1 })
  assert.deepEqual(t.text, ['kept'], 'finalized speech stays, nothing is added after stop')
})
test('manual stop (drain): the sentence still being finalized lands once, then the session closes for good', async () => {
  const t = setup(); t.d.start(); const r = t.last()
  r.emit([['already final', true]]); r.emit([['and the last words', false]])
  t.d.stop({ drain: true }); assert.ok(r.stopped && !r.aborted, 'engine asked to finish, not aborted')
  r.emit([['already final', true], ['and the last words', true]])           // engine finalizes after stop()
  assert.deepEqual(t.text, ['already final', 'and the last words'])
  r.end(); assert.equal(t.settled.n, 1); await wait(60)
  r.emit([['already final', true], ['and the last words', true], ['too late', true]], 2); assert.equal(t.text.length, 2)
  assert.equal(t.env.recs.length, 1, 'no restart after a stop')
})
test('drain is bounded: an engine that never finishes is closed after the drain window', async () => {
  const t = setup(); t.d.start(); const r = t.last(); t.d.stop({ drain: true })
  await wait(80); assert.ok(r.aborted); assert.equal(t.settled.n, 1)
  r.emit([['way too late', true]]); assert.deepEqual(t.text, [])
})
test('starting again during a drain closes the old cycle first: its late result cannot leak into the new session', () => {
  const t = setup(); t.d.start(); const r1 = t.last(); t.d.stop({ drain: true })
  const h = r1.onresult; t.d.start(); const r2 = t.last()
  assert.ok(r1.aborted && r2 !== r1)
  h?.({ results: [Object.assign([{ transcript: 'old session' }], { isFinal: true })], resultIndex: 0 })
  r2.emit([['new session', true]]); assert.deepEqual(t.text, ['new session'])
})
test('stop with no running session is harmless', () => { const t = setup(); t.d.stop(); t.d.stop({ drain: true }); assert.equal(t.d.active, false) })

// ── Planner integration contract ────────────────────────────────────────────
test('JournalEditorContent: uses the controller, inserts at the editor selection with no focus steal, guards destroyed editors', () => {
  const s = fs.readFileSync(path.join(ROOT, 'components/xpadite/JournalEditorContent.tsx'), 'utf8')
  assert.ok(/createDictation\(\{/.test(s) && /continuous: !prefersSingleUtterance\(navigator\)/.test(s))
  const voice = s.slice(s.indexOf('function stopVoiceSession'), s.indexOf('if (!showEmoji) return'))
  assert.ok(/ed\.chain\(\)\.insertContent\(text \+ ' '\)\.run\(\)/.test(voice) && !/chain\(\)\.focus/.test(voice), 'same insertion path as before; no .focus()')
  assert.ok(/!ed\.isDestroyed/.test(s))
  assert.ok(/stopVoiceSession\(true\)/.test(s), 'manual Stop drains')
  assert.ok(/silenceTimerRef\.current = setTimeout\(\(\) => stopVoiceSession\(\), 10000\)/.test(s), '10s silence stop unchanged')
  assert.ok(!/new SR\(\)[\s\S]{0,40}rec\.onresult/.test(s) && !/rec\.onend/.test(s), 'old per-toggle recognizer wiring is gone')
  assert.ok(/Microphone access denied\. Allow microphone access/.test(s) && /Click inside a section first, then press Mic/.test(s), 'permission/guard messages unchanged')
})
