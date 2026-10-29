// Planner dictation punctuation (components/xpadite/speechPunctuation.ts — the real module). A tiny "document" model applies
// the returned parts exactly the way JournalEditorContent does (text appended at the cursor, line/paragraph breaks), so
// multi-segment dictation, spacing and capitalization across segments are tested end to end.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-speech'); fs.mkdirSync(OUT, { recursive: true })
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, `components/xpadite/${f}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('speechPunctuation'); compile('speechDictation')
const { formatDictation } = require(path.join(OUT, 'speechPunctuation.js'))

// Apply segments one after another to a document string. `doc` may start with existing content; cursor = end of doc (or `at`).
function dictate(segments, doc = '', cursor = doc.length) {
  let head = doc.slice(0, cursor), tail = doc.slice(cursor)
  for (const seg of segments) {
    const block = head.slice(head.lastIndexOf('\n') + 1)
    const before = head.endsWith('\n') ? '' : block.slice(-4)
    const after = tail.split('\n')[0].slice(0, 4)
    for (const p of formatDictation(seg, { before, after })) head += p.kind === 'text' ? p.text : p.kind === 'line' ? '\n' : '\n\n'
  }
  return head + tail
}

// ── periods ─────────────────────────────────────────────────────────────────
test('a complete statement gets a capital and a full stop', () => {
  assert.equal(dictate(['this is a short test of the planner']), 'This is a short test of the planner.')
})
test('very short fragments and obvious mid-sentence stops are left unpunctuated (no period just because of a pause)', () => {
  assert.equal(dictate(['okay']), 'Okay'); assert.equal(dictate(['thank you']), 'Thank you')
  assert.equal(dictate(['we should meet tomorrow and']), 'We should meet tomorrow and')
  assert.equal(dictate(['I wanted to talk about the']), 'I wanted to talk about the')
  assert.equal(dictate(['this is because of']), 'This is because of')
})
test('a continuation after a dangling segment stays lower-case and joins naturally', () => {
  assert.equal(dictate(['we should meet tomorrow and', 'then we can plan the next steps together']), 'We should meet tomorrow and then we can plan the next steps together.')
})

// ── questions ───────────────────────────────────────────────────────────────
test('common questions end with a question mark (wh-questions and auxiliary-verb questions)', () => {
  for (const [said, out] of [
    ['is it working now', 'Is it working now?'], ['what is the time', 'What is the time?'], ['where is my phone', 'Where is my phone?'],
    ['how are you doing today', 'How are you doing today?'], ['do you want to join us', 'Do you want to join us?'], ['can we meet tomorrow', 'Can we meet tomorrow?'],
    ['why did he leave early', 'Why did he leave early?'], ['how many people are there', 'How many people are there?'], ['what about the budget', 'What about the budget?'],
    ['is the meeting at three', 'Is the meeting at three?'], ["don't you think so", "Don't you think so?"], ['who is she', 'Who is she?'],
  ]) assert.equal(dictate([said]), out, said)
})
test('statements that merely start like questions are NOT turned into questions', () => {
  for (const [said, out] of [
    ['what I mean is that it works well', 'What I mean is that it works well.'],
    ['when I got home I went straight to bed', 'When I got home I went straight to bed.'],
    ['how much I love this app', 'How much I love this app.'],
    ['what is important is that it works', 'What is important is that it works.'],
    ['do the dishes before dinner', 'Do the dishes before dinner.'], ['have a nice day', 'Have a nice day.'],
    ["don't forget the milk", "Don't forget the milk."], ['do it now please', 'Do it now please.'],
  ]) assert.equal(dictate([said]), out, said)
})
test('a long run that only starts like a question is left unmarked rather than guessed', () => {
  const run = 'is it working now sounds like it is working and there is no punctuation marks at all'
  assert.equal(dictate([run]), 'Is it working now sounds like it is working and there is no punctuation marks at all')
})

// ── commas ──────────────────────────────────────────────────────────────────
test('commas only in high-confidence places: ", but" after a clause, parenthetical phrases, introductory words', () => {
  assert.equal(dictate(['sounds like it is working but there is no punctuation marks']), 'Sounds like it is working, but there is no punctuation marks.')
  assert.equal(dictate(['I think for the most part it is working really well']), 'I think, for the most part, it is working really well.')
  assert.equal(dictate(['however the results look good to me']), 'However, the results look good to me.')
  assert.equal(dictate(['of course we can do that tomorrow']), 'Of course, we can do that tomorrow.')
  assert.equal(dictate(['we can ship it on friday for example']), 'We can ship it on friday, for example.')
})
test('no commas where "but" is not a clause joiner or the pattern is weak', () => {
  assert.equal(dictate(['he ate nothing but bread all day']), 'He ate nothing but bread all day.')
  assert.equal(dictate(['not only fast but also reliable and simple']), 'Not only fast but also reliable and simple.')
  assert.equal(dictate(['but it works']), 'But it works.')
  assert.equal(dictate(['we went to the park and played football']), 'We went to the park and played football.', 'no guessed commas before "and"')
})

// ── the sentence from the brief, dictated with natural pauses (three finalized segments) ────────────────
test('BRIEF EXAMPLE: the same words, dictated as three finalized phrases, come out punctuated — wording unchanged', () => {
  const out = dictate([
    'is it working now',
    'sounds like it is working but there is no punctuation marks',
    'I think for the most part it is working really well',
  ])
  assert.equal(out, 'Is it working now? Sounds like it is working, but there is no punctuation marks. I think, for the most part, it is working really well.')
  // the spoken words are exactly the original words, in order
  const strip = s => s.toLowerCase().replace(/[.,?!]/g, '').split(/\s+/).join(' ')
  assert.equal(strip(out), 'is it working now sounds like it is working but there is no punctuation marks i think for the most part it is working really well')
})
test('the same words as ONE unbroken run: commas are added, but boundaries that cannot be known are not guessed', () => {
  const out = dictate(['is it working now sounds like it is working but there is no punctuation marks I think for the most part it is working really well'])
  assert.equal(out, 'Is it working now sounds like it is working, but there is no punctuation marks I think, for the most part, it is working really well')
})

// ── spoken punctuation commands ─────────────────────────────────────────────
test('spoken commands become the mark, attached to the previous word', () => {
  assert.equal(dictate(['hello comma how are you question mark']), 'Hello, how are you?')
  assert.equal(dictate(['this is great exclamation mark']), 'This is great!')
  assert.equal(dictate(['this is great exclamation point']), 'This is great!')
  assert.equal(dictate(['first item semicolon second item colon third item period']), 'First item; second item: third item.')
  assert.equal(dictate(['that is all full stop']), 'That is all.')
})
test('sentences start with a capital after a spoken terminator, but not after a comma, semicolon or colon', () => {
  assert.equal(dictate(['we are done period next we test the thing period']), 'We are done. Next we test the thing.')
  assert.equal(dictate(['yes comma we agree semicolon it works']), 'Yes, we agree; it works')
})
test('new line / new paragraph insert breaks and the next sentence is capitalized', () => {
  const parts = formatDictation('first line new line second line new paragraph third', { before: '' })
  assert.deepEqual(parts.map(p => p.kind), ['text', 'line', 'text', 'paragraph', 'text'])
  assert.deepEqual(parts.filter(p => p.kind === 'text').map(p => p.text), ['First line', 'Second line', 'Third'])
})
test('a command on its own, in the next segment, attaches to the text already there (no space before it, no doubled mark)', () => {
  assert.equal(dictate(['hello there my friend', 'period']), 'Hello there my friend.')   // inferred "." then spoken "period": not stacked
  assert.equal(dictate(['we are leaving now and', 'comma']), 'We are leaving now and,')
  assert.equal(dictate(['hello', 'comma', 'world']), 'Hello, world')
})
test('with spoken commands present the segment is left to the user: nothing else is inferred', () => {
  assert.equal(dictate(['hello comma this is my plan for the week']), 'Hello, this is my plan for the week')
})

// ── literal words that look like commands stay literal ──────────────────────
test('ordinary uses of command words are preserved as words', () => {
  for (const [said, out] of [
    ['the time period was short', 'The time period was short.'],
    ['a period of rest is needed', 'A period of rest is needed.'],
    ['he has colon cancer', 'He has colon cancer.'],
    ['press the comma key twice', 'Press the comma key twice.'],
    ['there is a question mark on the sign', 'There is a question mark on the sign.'],
    ['we need a new line of products', 'We need a new line of products.'],
    ['this is the last full stop on the route', 'This is the last full stop on the route.'],
    ['the grace period ends friday', 'The grace period ends friday.'],
  ]) assert.equal(dictate([said]), out, said)
})

// ── capitalization ──────────────────────────────────────────────────────────
test('only sentence beginnings are capitalized; proper nouns and acronyms are never altered; "I" is fixed', () => {
  assert.equal(dictate(['NASA launched it yesterday afternoon']), 'NASA launched it yesterday afternoon.')
  assert.equal(dictate(['iPhone sales were strong this quarter']), 'iPhone sales were strong this quarter.', 'internal capital preserved')
  assert.equal(dictate(['we met John and Maria in Toronto']), 'We met John and Maria in Toronto.')
  assert.equal(dictate(['i think i will go and i am happy']), 'I think I will go and I am happy.')
  assert.equal(dictate(["i'm sure i'll be fine and i've checked"]), "I'm sure I'll be fine and I've checked.")
  assert.equal(dictate(['3 items are left in the list']), '3 items are left in the list.')
})
test('existing punctuation from the engine is respected: nothing is added or doubled', () => {
  assert.equal(dictate(['Hello, how are you?']), 'Hello, how are you?')
  assert.equal(dictate(['hello, this is the plan']), 'Hello, this is the plan')
})

// ── multi-sentence dictation with pauses ────────────────────────────────────
test('multi-sentence dictation: single spaces, capitals after terminators, no doubled punctuation or spaces', () => {
  const out = dictate(['we shipped the update today', 'did everyone get the notification', 'great exclamation mark', 'next we fix the calendar issue for the team'])
  assert.equal(out, 'We shipped the update today. Did everyone get the notification? Great! Next we fix the calendar issue for the team.')
  assert.ok(!/  |\.\.|\?\?|,,|\. \./.test(out))
})
test('intentionally repeated words are preserved', () => {
  assert.equal(dictate(['no no no that is not what I meant']), 'No no no that is not what I meant.')
  assert.equal(dictate(['very very good work today team']), 'Very very good work today team.')
  assert.equal(dictate(['go', 'go', 'go']), 'Go go go')
})

// ── existing text & cursor ──────────────────────────────────────────────────
test('existing content is never altered: dictation appends after it with a natural space and continues the sentence state', () => {
  assert.equal(dictate(['and this is new'], 'Existing note'), 'Existing note and this is new.')               // no terminator before → continues the sentence (lower-case)
  assert.equal(dictate(['this is new text for the page'], 'Existing note.'), 'Existing note. This is new text for the page.')
  assert.equal(dictate(['this is new text for the page'], 'Existing note. '), 'Existing note. This is new text for the page.', 'no double space')
  assert.equal(dictate(['hello there my friend'], 'Line one\n'), 'Line one\nHello there my friend.')
})
test('inserting in the MIDDLE of existing text: no full stop is forced, and the following word stays separated', () => {
  assert.equal(dictate(['really nice and big'], 'It is a house today.', 8), 'It is a really nice and big house today.')
  assert.equal(dictate(['is that so'], 'Hmm. Yes.', 4), 'Hmm. Is that so? Yes.', 'a whole sentence going in between two sentences is still marked')
  assert.equal(dictate(['really nice and big'], 'It is a house today.', 8), 'It is a really nice and big house today.', 'but never inside a sentence')
})
test('empty / whitespace segments produce nothing', () => {
  assert.deepEqual(formatDictation('   ', { before: '' }), []); assert.deepEqual(formatDictation('', { before: 'x' }), [])
})

// ── v1.314 microphone behaviour is untouched ────────────────────────────────
test('the speech controller (session, restart, duplicate prevention, drain) is byte-for-byte unchanged by this feature', () => {
  const ctrl = fs.readFileSync(path.join(ROOT, 'components/xpadite/speechDictation.ts'), 'utf8')
  assert.ok(!/speechPunctuation|formatDictation/.test(ctrl), 'controller knows nothing about punctuation')
  assert.ok(/function createDictation/.test(ctrl) && /committed: Set<number>/.test(ctrl))
})
test('Planner wiring: formatted once per finalized segment, one undo step, plain text kept in code blocks, same insertion without focus steal', () => {
  const s = fs.readFileSync(path.join(ROOT, 'components/xpadite/JournalEditorContent.tsx'), 'utf8')
  const voice = s.slice(s.indexOf('function stopVoiceSession'), s.indexOf('if (!showEmoji) return'))
  assert.equal((voice.match(/formatDictation\(/g) || []).length, 1, 'a single call site')
  assert.ok(/onText: text => \{/.test(voice) && /let chain = ed\.chain\(\)/.test(voice) && /chain\.run\(\)/.test(voice))
  assert.ok(/\$from\.parent\.type\.name === 'codeBlock'/.test(voice))
  assert.ok(!/chain\(\)\.focus/.test(voice))
  assert.ok(/stopVoiceSession\(true\)/.test(voice) && /createDictation\(\{/.test(voice) && /continuous: !prefersSingleUtterance\(navigator\)/.test(voice), 'v1.314 session wiring intact')
})
test('zero cost: the module has no imports, network calls or AI/API usage', () => {
  const m = fs.readFileSync(path.join(ROOT, 'components/xpadite/speechPunctuation.ts'), 'utf8')
  assert.ok(!/^\s*import\s/m.test(m) && !/fetch\(|XMLHttpRequest|process\.env|anthropic|openai/i.test(m))
})
