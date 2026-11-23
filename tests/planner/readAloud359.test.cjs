// v1.359 — Planner Read Aloud. The REAL modules (text extraction, queue, chunking, playback engine) are compiled and run against a FAKE speechSynthesis with fake
// timers. Nothing here makes a sound: real voices, the browsers' own speech limits, autoplay policy and background / locked-phone behaviour are physical-device checks.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-readaloud-v1359'); fs.mkdirSync(OUT, { recursive: true })
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
for (const n of ['readAloud', 'readAloudEngine', 'emailShare']) fs.writeFileSync(path.join(OUT, n + '.js'), ts.transpileModule(src(`components/xpadite/${n}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const R = require(path.join(OUT, 'readAloud.js'))
const E = require(path.join(OUT, 'readAloudEngine.js'))

// ── Tiptap JSON helpers ──
const txt = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const p = t => ({ type: 'paragraph', content: t ? [txt(t)] : [] })
const h = t => ({ type: 'heading', attrs: { level: 2 }, content: [txt(t)] })
const li = (t, kids) => ({ type: 'listItem', content: [p(t), ...(kids ? [kids] : [])] })
const ul = (...i) => ({ type: 'bulletList', content: i })
const ol = (type, ...i) => ({ type: 'orderedList', attrs: type ? { start: 1, type } : { start: 1 }, content: i })
const task = (t, checked) => ({ type: 'taskItem', attrs: { checked: !!checked }, content: [p(t)] })
const doc = (...c) => JSON.stringify({ type: 'doc', content: c })
let seq = 0
const sec = (name, content, extra = {}) => ({ id: 's' + ++seq, type: 'section', name, content, createdAt: 1, updatedAt: 1, ...extra })
const live = b => b.content

// ═══ text extraction + queue ═══
test('speech text: headings, paragraphs, bullet / numbered / lettered lists and checklist text are read in order; glyphs, ids and rules are not', () => {
  const b = sec('Plan', doc(h('Heading one'), p('A paragraph.'), ul(li('First bullet', ul(li('Nested bullet'))), li('Second bullet')), ol(null, li('Step one'), li('Step two')), ol('a', li('Letter item')),
    { type: 'taskList', content: [task('Task alpha', false), task('Task beta', true)] }, { type: 'horizontalRule' }, p('After the rule')))
  const q = R.buildQueue([b], live)
  assert.equal(q.length, 1)
  const all = q[0].chunks.join('\n')
  assert.deepEqual(q[0].chunks, ['Plan.', 'Heading one', 'A paragraph.', 'First bullet', 'Nested bullet', 'Second bullet', '1. Step one', '2. Step two', 'a. Letter item', 'Task alpha', 'Task beta', 'After the rule'])
  assert.doesNotMatch(all, /[•☐☑─]/, 'no list / checkbox glyphs or rule characters'); assert.doesNotMatch(all, /\b(done|completed|checked|unchecked)\b/i, 'no completion status is announced')
})
test('tables read as comma-separated cells; quotes lose their ">"; symbol-only lines are skipped', () => {
  const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Name')] }, { type: 'tableCell', content: [p('Role')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Craig')] }, { type: 'tableCell', content: [p('Founder')] }] }] }
  const b = sec('T', doc(table, { type: 'blockquote', content: [p('Quoted text')] }, p('***'), p('---')))
  assert.deepEqual(R.buildQueue([b], live)[0].chunks, ['T.', 'Name, Role', 'Craig, Founder', 'Quoted text'])
})
test('reading order = the order given; empty / image-only sections are skipped; collapsed sections are read; unsectioned text is read; images and drawings are not', () => {
  const a = sec('Alpha', doc(p('alpha text')))
  const empty = sec('Empty', doc(p('')))
  const emptyStr = sec('No content', '')
  const collapsed = sec('Collapsed one', doc(p('hidden but read')), { collapsed: true })
  const img = { id: 'img', type: 'image', src: 'data:x' }
  const drawing = { id: 'dr', type: 'drawing', src: 'data:y' }
  const imgSec = sec('Image section', undefined, { sectionImage: { src: 'data:z' } })
  const text = { id: 'tx', type: 'text', content: doc(p('plain unsectioned text')), createdAt: 1, updatedAt: 1 }
  const q = R.buildQueue([a, empty, img, collapsed, drawing, emptyStr, imgSec, text], live)
  assert.deepEqual(q.map(x => x.id), [a.id, collapsed.id, 'tx'])
  assert.equal(q[2].title, '', 'unsectioned text has no title chunk'); assert.deepEqual(q[2].chunks, ['plain unsectioned text'])
  assert.equal(R.buildQueue([empty, emptyStr], live).length, 0, 'nothing to read')
})
test('the section title is spoken first; a title without final punctuation gets a period; a punctuated title is kept; live (unsaved) text is what is read', () => {
  const b = sec('Pitch for Helpbnk', doc(p('saved text')))
  assert.deepEqual(R.buildQueue([b], () => doc(p('live edit')))[0].chunks, ['Pitch for Helpbnk.', 'live edit'])
  assert.equal(R.buildQueue([sec('Why?', doc(p('x')))], live)[0].chunks[0], 'Why?')
  assert.equal(R.buildQueue([sec('', doc(p('x')))], live)[0].chunks.length, 1)
})
test('a split section reads BOTH halves; the section object is never modified', () => {
  const b = sec('Split', undefined, { partitions: [{ kind: 'content', content: doc(p('left half')) }, { kind: 'image', src: 'data:i' }, { kind: 'content', content: doc(p('right half')) }] })
  const before = JSON.stringify(b)
  assert.deepEqual(R.buildQueue([b], live)[0].chunks, ['Split.', 'left half', 'right half'])
  assert.equal(JSON.stringify(b), before)
})
test('a Planner for one date only: the queue contains exactly the blocks it is given (callers pass the current date\'s blocks)', () => {
  const day1 = [sec('Day one', doc(p('one')))], day2 = [sec('Day two', doc(p('two')))]
  assert.deepEqual(R.buildQueue(day1, live).map(x => x.title), ['Day one']); assert.deepEqual(R.buildQueue(day2, live).map(x => x.title), ['Day two'])
})

// ═══ chunking ═══
test('chunking: every chunk ≤ 180 chars; sentences are kept whole where possible; unpunctuated text splits at clauses / words; no text is lost; "3.5" / "e.g." are not sentence ends', () => {
  const sentence = 'This is a reasonably long sentence that keeps going for a while so the chunker has something to do.'
  const long = Array.from({ length: 12 }, () => sentence).join(' ')
  const c1 = R.splitLong(long)
  assert.ok(c1.length >= 6 && c1.every(c => c.length <= 180), JSON.stringify(c1.map(c => c.length))); assert.ok(c1.every(c => c.endsWith('.')), 'split at sentence ends')
  assert.equal(c1.join(' '), long)
  const word = 'word '.repeat(300).trim()
  const c2 = R.splitLong(word); assert.ok(c2.every(c => c.length <= 180)); assert.equal(c2.join(' '), word)
  const clauses = Array.from({ length: 40 }, (_, i) => 'clause number ' + i).join(', ')
  const c3 = R.splitLong(clauses); assert.ok(c3.every(c => c.length <= 180)); assert.equal(c3.join(' ').replace(/\s+/g, ' '), clauses.replace(/\s+/g, ' '))
  const blob = 'x'.repeat(500); const c4 = R.splitLong(blob); assert.ok(c4.every(c => c.length <= 180)); assert.equal(c4.join(''), blob)
  const decimals = 'Version 3.5 was released, e.g. last week. ' + 'filler text here. '.repeat(14)
  assert.ok(!R.splitLong(decimals).some(c => /^5 was/.test(c) || /^g\./.test(c)), 'no split inside 3.5 / e.g.')
  assert.deepEqual(R.splitLong('short'), ['short']); assert.deepEqual(R.splitLong('   '), [])
})
test('a 5 000-word section becomes many short chunks (long sections stay reliable)', () => {
  const big = sec('Big', doc(...Array.from({ length: 50 }, (_, i) => p(Array.from({ length: 100 }, (_, j) => 'word' + (i * 100 + j)).join(' ') + '.'))))
  const q = R.buildQueue([big], live)[0].chunks
  assert.ok(q.length > 150 && q.every(c => c.length <= 180))
})
test('voice choice: English preferred (the device\'s own language, default / local voices first); no English voice → undefined (browser default); speeds and resume index', () => {
  const v = (lang, o = {}) => ({ lang, ...o })
  assert.equal(R.pickVoice([v('fr-FR'), v('de-DE')]), undefined); assert.equal(R.pickVoice([]), undefined)
  assert.equal(R.pickVoice([v('fr-FR'), v('en-GB'), v('en-US', { default: true })], 'en-US').lang, 'en-US')
  assert.equal(R.pickVoice([v('en-GB', { localService: false }), v('en-AU', { localService: true })], 'en-ZA').lang, 'en-AU')
  assert.equal(R.pickVoice([v('en_US')], 'en-US').lang, 'en_US')
  assert.deepEqual([...R.RATES], [0.75, 1, 1.25, 1.5, 2]); assert.equal(R.isValidRate(1.25), true); assert.equal(R.isValidRate(3), false); assert.equal(R.isValidRate('1'), false)
  assert.equal(R.resumeIndex('hello brave new world', 0, 6), 6); assert.equal(R.resumeIndex('hello', 0, null), 0); assert.equal(R.resumeIndex('hello', 2, null), 2)
  assert.equal(R.resumeIndex('hello', 0, 99), 0, 'a boundary past the end restarts the chunk'); assert.equal(R.resumeIndex('hello world', 4, 1), 4)
})

// ═══ playback engine (fake speechSynthesis) ═══
function fake({ speakingFlag = true } = {}) {
  const s = { spoken: [], cancels: 0, speaking: false, pending: false, voices: [], notes: [], states: [], active: null,
    speak(u) { s.spoken.push(u); s.active = u; if (speakingFlag) s.speaking = true },
    cancel() { s.cancels++; s.speaking = false; s.pending = false; s.active = null },
    getVoices() { return s.voices },
    end(u = s.active) { s.speaking = false; if (s.active === u) s.active = null; u.onend && u.onend() },
    boundary(u, i, name = 'word') { u.onboundary && u.onboundary({ charIndex: i, name }) },
    error(u, code) { s.speaking = false; u.onerror && u.onerror({ error: code }) } }
  return s
}
const mkEngine = (s, extra = {}) => E.createReadAloud({ synth: s, makeUtterance: text => ({ text, rate: 1, voice: null, lang: '', onstart: null, onend: null, onerror: null, onboundary: null }), notify: m => s.notes.push(m), onState: st => s.states.push(st), navLang: 'en-US', ...extra })
const Q = (...sections) => sections.map((chunks, i) => ({ id: 's' + i, title: 'T' + i, chunks }))
const timers = t => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
// node's mock timers do not run timers that are re-armed during one big tick, so long waits are advanced in small steps (as real time would)
const step = (t, total, by = 500) => { for (let i = 0; i < total; i += by) t.mock.timers.tick(by) }

test('plays a section chunk by chunk in order, applies the speed, ends in idle — and never calls cancel() when speech simply finishes', t => {
  timers(t); const s = fake(); const e = mkEngine(s)
  assert.equal(e.start(Q(['Title.', 'one', 'two']), 'section'), 'started')
  assert.deepEqual(s.spoken.map(u => u.text), ['Title.']); assert.equal(s.spoken[0].rate, 1); assert.equal(e.getState().status, 'playing')
  s.end(); s.end(); assert.deepEqual(s.spoken.map(u => u.text), ['Title.', 'one', 'two'])
  s.end(); assert.equal(e.getState().status, 'idle'); assert.equal(s.cancels, 0, 'no unnecessary cancel at natural completion')
  assert.equal(s.spoken.length, 3, 'nothing extra spoken after the end')
})
test('Read All: continues automatically from section to section, reports "n of N" and the current title, then finishes', t => {
  timers(t); const s = fake(); const e = mkEngine(s)
  e.start(Q(['a1', 'a2'], ['b1'], ['c1']), 'all')
  const seen = []; s.end(); seen.push(e.getState().sectionIndex); s.end(); seen.push(e.getState().sectionIndex, e.getState().title); s.end(); seen.push(e.getState().sectionIndex)
  assert.deepEqual(seen, [0, 1, 'T1', 2]); assert.equal(e.getState().sectionCount, 3); assert.equal(e.getState().mode, 'all')
  s.end(); assert.equal(e.getState().status, 'idle'); assert.equal(s.cancels, 0)
  assert.deepEqual(s.spoken.map(u => u.text), ['a1', 'a2', 'b1', 'c1'])
})
test('ONE session at a time: starting again replaces the running one with a single cancel; the old utterance\'s late events can neither skip nor restart anything', t => {
  timers(t); const s = fake(); const e = mkEngine(s)
  e.start(Q(['old one', 'old two']), 'section'); const old = s.spoken[0]
  e.start(Q(['new one', 'new two']), 'all'); assert.equal(s.cancels, 1)
  t.mock.timers.tick(100)                                                // the new session speaks after the short post-cancel pause
  assert.deepEqual(s.spoken.map(u => u.text), ['old one', 'new one'])
  old.onend(); old.onerror({ error: 'interrupted' }); old.onboundary({ charIndex: 2 })     // stale callbacks
  assert.deepEqual(s.spoken.map(u => u.text), ['old one', 'new one'], 'the stale end did not advance anything'); assert.equal(e.getState().status, 'playing'); assert.equal(e.getState().mode, 'all')
  s.end(); assert.deepEqual(s.spoken.map(u => u.text), ['old one', 'new one', 'new two'])
  const active = s.spoken.filter(u => u === s.active).length; assert.equal(active, 1)
})
test('starting while idle does not cancel anything', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['x']), 'section'); assert.equal(s.cancels, 0); assert.equal(s.spoken.length, 1)
})
test('pause with word boundaries: stops, then Resume continues from the last word boundary (no big repeat); without boundaries only the current short chunk is replayed', t => {
  timers(t)
  const s = fake(); const e = mkEngine(s); e.start(Q(['alpha beta gamma delta', 'next chunk']), 'section')
  const u1 = s.spoken[0]; u1.onstart(); s.boundary(u1, 0); s.boundary(u1, 6); s.boundary(u1, 11)
  e.pause(); assert.equal(e.getState().status, 'paused'); assert.equal(e.getState().pausedBy, 'user'); assert.equal(s.cancels, 1)
  u1.onend(); u1.onerror({ error: 'canceled' })                                // the browser reports the cancel: ignored
  assert.equal(s.spoken.length, 1, 'nothing spoken while paused')
  e.resume(); assert.equal(s.spoken.at(-1).text, 'gamma delta', 'continues at the last word boundary'); assert.equal(e.getState().status, 'playing')
  s.end(); assert.equal(s.spoken.at(-1).text, 'next chunk', 'then carries on with the next chunk')
  // no boundary support (e.g. Android Chrome): the current chunk is replayed from its start
  const s2 = fake(); const e2 = mkEngine(s2); e2.start(Q(['alpha beta gamma delta', 'next']), 'section'); e2.pause(); e2.resume()
  assert.equal(s2.spoken.at(-1).text, 'alpha beta gamma delta')
  // pausing twice / resuming when not paused does nothing
  e2.resume(); const n = s2.spoken.length; e2.resume(); assert.equal(s2.spoken.length, n); e2.pause(); e2.pause(); assert.equal(s2.cancels, 2, 'one cancel per real pause; a second pause while paused does nothing')
})
test('speed change while playing: continues from the word boundary at the new speed (not from the start of the document); while paused it applies on Resume; invalid speeds are ignored', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['one two three four', 'tail']), 'section')
  const u = s.spoken[0]; s.boundary(u, 0); s.boundary(u, 4); s.boundary(u, 8)
  e.setRate(1.5); assert.equal(s.cancels, 1); t.mock.timers.tick(100)
  assert.equal(s.spoken.at(-1).text, 'three four'); assert.equal(s.spoken.at(-1).rate, 1.5); assert.equal(e.getState().rate, 1.5)
  e.setRate(3); e.setRate('x'); e.setRate(1.5); assert.equal(s.cancels, 1, 'invalid or unchanged speed: no cancel, no restart')
  e.pause(); const n = s.spoken.length; e.setRate(2); assert.equal(s.spoken.length, n, 'a speed change while paused does not speak'); e.resume(); assert.equal(s.spoken.at(-1).rate, 2)
  s.end(); assert.equal(s.spoken.at(-1).text, 'tail'); assert.equal(s.spoken.at(-1).rate, 2, 'later chunks keep the chosen speed')
  // no boundary info → only the current short chunk is replayed
  const s2 = fake(); const e2 = mkEngine(s2); e2.start(Q(['one two three four', 'tail']), 'section'); e2.setRate(0.75); t.mock.timers.tick(100)
  assert.equal(s2.spoken.at(-1).text, 'one two three four'); assert.equal(s2.spoken.at(-1).rate, 0.75)
})
test('Stop ends everything: cancels only if speaking, clears the queue, ignores late events; Stop when nothing is playing makes no cancel() call', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.stop(); assert.equal(s.cancels, 0)
  e.start(Q(['a', 'b']), 'section'); const u = s.spoken[0]; e.stop(); assert.equal(s.cancels, 1); assert.equal(e.getState().status, 'idle'); assert.equal(e.getState().sectionCount, 0)
  u.onend(); assert.equal(s.spoken.length, 1, 'stale end after Stop starts nothing'); e.stop(); assert.equal(s.cancels, 1)
  // stop while paused: nothing speaking, so no cancel
  const s2 = fake(); const e2 = mkEngine(s2); e2.start(Q(['a']), 'section'); e2.pause(); assert.equal(s2.cancels, 1); e2.stop(); assert.equal(s2.cancels, 1); assert.equal(e2.getState().status, 'idle')
})
test('hidden tab: pause("hidden") pauses and labels it; nothing resumes by itself (no timers, no events) until Resume is pressed', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['one two', 'next']), 'all')
  e.pause('hidden'); assert.equal(e.getState().status, 'paused'); assert.equal(e.getState().pausedBy, 'hidden')
  t.mock.timers.tick(10 * 60_000); assert.equal(e.getState().status, 'paused'); assert.equal(s.spoken.length, 1)
  e.resume(); assert.equal(e.getState().status, 'playing'); assert.equal(s.spoken.length, 2)
  const hook = src('components/xpadite/useReadAloud.ts'); const onVis = hook.slice(hook.indexOf('const onVis'), hook.indexOf('const onHide')).replace(/\/\/.*$/gm, '')
  assert.match(onVis, /document\.visibilityState === 'hidden'\) eng\.pause\('hidden'\)/); assert.doesNotMatch(onVis, /resume/, 'returning to the tab never resumes')
})
test('missing end event: it NEVER skips while the browser is still speaking or words are still progressing; it moves on only when idle, quiet for the estimated duration, confirmed twice — and a late end event afterwards is ignored', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['a long chunk of text to speak', 'second']), 'section')
  const u = s.spoken[0]
  for (let i = 1; i <= 6; i++) { t.mock.timers.tick(10_000); s.boundary(u, i) }        // a minute of normal progress (words keep arriving)
  assert.equal(s.spoken.length, 1, 'still speaking and progressing: no skip after a minute'); assert.equal(s.cancels, 0)
  s.speaking = false                                                           // the browser says it is idle but no end event ever came
  s.boundary(u, 3); step(t, 1500); assert.equal(s.spoken.length, 1, 'a word boundary just arrived: not quiet yet')
  step(t, 20_000); assert.equal(s.spoken.at(-1).text, 'second', 'moved on after the confirmed quiet period')
  const countAfter = s.spoken.length; u.onend(); assert.equal(s.spoken.length, countAfter, 'the late end of the skipped utterance does nothing')
})
test('missing end event, short quiet: nothing is skipped before the estimated duration has passed', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['x'.repeat(170), 'second']), 'section'); s.speaking = false
  step(t, 14_000); assert.equal(s.spoken.length, 1, '170 characters at 1× take ~15 s: 14 s is too early to give up')
  step(t, 40_000); assert.equal(s.spoken.at(-1).text, 'second')
})
test('a browser stuck in "speaking" with no events at all: one retry of the current chunk, then a clear message and a clean stop', t => {
  timers(t); const s = fake(); const e = mkEngine(s); e.start(Q(['stuck chunk here', 'next']), 'section')
  step(t, 40_000, 1000); assert.equal(s.cancels, 1, 'retried once after ~30 s without any event'); t.mock.timers.tick(200)
  assert.equal(s.spoken.at(-1).text, 'stuck chunk here'); assert.equal(s.notes.length, 0)
  step(t, 80_000, 1000); assert.match(s.notes.join(' '), /stopped responding/); assert.equal(e.getState().status, 'idle')
})
test('errors: canceled is ignored; interrupted (another tab spoke) pauses in place; not-allowed pauses with a tap prompt; anything else stops with a message', t => {
  timers(t)
  let s = fake(), e = mkEngine(s); e.start(Q(['a b c', 'z']), 'section'); s.error(s.spoken[0], 'canceled'); assert.equal(e.getState().status, 'playing')
  s = fake(); e = mkEngine(s); e.start(Q(['a b c', 'z']), 'section'); s.boundary(s.spoken[0], 2); s.error(s.spoken[0], 'interrupted')
  assert.equal(e.getState().status, 'paused'); assert.equal(e.getState().pausedBy, 'interrupted'); e.resume(); assert.equal(s.spoken.at(-1).text, 'b c', 'resumes at the word that was about to be spoken')
  s = fake(); e = mkEngine(s); e.start(Q(['a']), 'section'); s.error(s.spoken[0], 'not-allowed'); assert.equal(e.getState().pausedBy, 'blocked'); assert.match(s.notes[0], /Resume/)
  s = fake(); e = mkEngine(s); e.start(Q(['a']), 'section'); s.error(s.spoken[0], 'synthesis-failed'); assert.equal(e.getState().status, 'idle'); assert.match(s.notes[0], /could not speak/)
})
test('unsupported browsers: a friendly message, no throw; empty queue starts nothing', t => {
  timers(t); const s = fake(); const none = mkEngine(s, { synth: null })
  assert.equal(none.start(Q(['x']), 'section'), 'unsupported'); assert.match(s.notes[0], /not available in this browser/); none.stop(); none.pause(); none.resume(); none.setRate(2); none.dispose()
  const e = mkEngine(s); assert.equal(e.start([], 'all'), 'empty'); assert.equal(s.spoken.length, 0)
})
test('dispose (unmount / Planner closed) stops and cancels only if speaking; the chosen speed survives a new session', t => {
  timers(t); let s = fake(); let e = mkEngine(s); e.dispose(); assert.equal(s.cancels, 0)
  e.start(Q(['a']), 'section'); e.dispose(); assert.equal(s.cancels, 1); assert.equal(e.getState().status, 'idle')
  s = fake(); e = mkEngine(s); e.setRate(1.25); e.start(Q(['a']), 'section'); assert.equal(s.spoken[0].rate, 1.25)
})
test('voice: an English voice is applied to every utterance when available', t => {
  timers(t); const s = fake(); s.voices = [{ lang: 'fr-FR' }, { lang: 'en-GB', default: true }]; const e = mkEngine(s); e.start(Q(['a', 'b']), 'section'); s.end()
  assert.ok(s.spoken.every(u => u.voice && u.voice.lang === 'en-GB' && u.lang === 'en-GB'))
})

// ═══ structure: read-only, wired in the right places ═══
test('the Read Aloud modules are read-only: no editor commands, transactions, saves, history or document writes', () => {
  for (const f of ['readAloud.ts', 'readAloudEngine.ts', 'useReadAloud.ts', 'ReadAloudController.tsx']) {
    const code = src('components/xpadite/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /\.chain\(|\.commands\.|dispatch\(|setContent|updateDay|onUpdateBlock|onContentChange|onPersist|setBlocks|pushHistory|localStorage\.setItem\([^)]*(?<!RATE_KEY), /, f)
    assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|supabase/i, f + ': no network, no backend')
  }
  assert.match(src('components/xpadite/useReadAloud.ts'), /localStorage\.setItem\(READ_RATE_KEY, String\(r\)\)/)       // the speed is the ONLY thing stored
})
test('wiring in the Planner: menu entry right after Mark as Important (sections only), Read All Sections in the Planner menu, controller above the toolbar, narration ends on date change / unmount', () => {
  const j = src('components/xpadite/JournalEditorContent.tsx')
  assert.match(j, /data-testid="important-toggle"[\s\S]{0,400}\{!!onReadAloud && \(\s*<button data-testid="read-aloud"[\s\S]{0,200}🔊 Read Aloud/)
  assert.match(j, /onReadAloud=\{block\.type === 'section' \? readSection : undefined\}/)
  assert.match(j, /data-testid="planner-menu-readall"[\s\S]{0,800}Read All Sections/)
  assert.match(j, /<ReadAloudController state=\{readAloud\.state\}[\s\S]{0,200}\/>\s*\n\s*\{\/\* Listening indicator/)
  assert.match(j, /useEffect\(\(\) => \(\) => \{ readStop\(\) \}, \[dateKey, readStop\]\)/)
  assert.match(j, /buildQueue\(blocksRef\.current, x => contentMapRef\.current\.get\(x\.id\) \?\? x\.content\)/, 'Read All = this date\'s blocks in the Planner\'s own order, live text')
  assert.match(j, /There is nothing to read on this date\./); assert.match(j, /This section has no text to read\./)
  // the existing menu entries are all still there
  for (const l of ['✥ Move', '⤡ Resize', '✏ Edit Section', '▦ Add Table', '🎨 Change Color', '📑 Duplicate', '📅 Move Section', '📤 Send to…', '✉ Send via Email', '🗑 Delete']) assert.ok(j.includes(l), l)
  for (const id of ['planner-menu-email', 'planner-menu-label', 'planner-menu-merge']) assert.ok(j.includes(`data-testid="${id}"`), id)
})
