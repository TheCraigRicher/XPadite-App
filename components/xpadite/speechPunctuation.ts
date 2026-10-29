// ── Planner dictation: punctuation & capitalization for FINALIZED speech ─────
//
// A pure, deterministic, local function (no AI, no network, no dependencies). It receives one finalized segment from the
// speech controller (speechDictation.ts — untouched) plus a little context about the text around the cursor, and returns
// the parts to insert. It never changes which words were spoken, their order, or repeated words: the only edits are
//   • recognised spoken punctuation commands ("comma", "question mark", "new line" …) → the mark / break,
//   • punctuation marks added at high-confidence places (documented below),
//   • sentence-start capitalization and the pronoun "I".
// Anything ambiguous is left exactly as spoken.

export type DictationPart = { kind: 'text'; text: string } | { kind: 'line' } | { kind: 'paragraph' }

export interface FormatContext {
  /** Up to a few characters immediately before the insertion point, within the same block ('' = start of the block). */
  before: string
  /** Up to a few characters immediately after the insertion point, within the same block ('' = end of the block). */
  after?: string
}

type Mark = '.' | ',' | '?' | '!' | ';' | ':'
type Item = { w: string } | { m: Mark } | { br: 'line' | 'paragraph' }

// ── spoken commands ─────────────────────────────────────────────────────────
const COMMANDS_2: Record<string, Mark | 'line' | 'paragraph'> = {
  'full stop': '.', 'question mark': '?', 'exclamation mark': '!', 'exclamation point': '!',
  'semi colon': ';', 'new line': 'line', 'new paragraph': 'paragraph',
}
const COMMANDS_1: Record<string, Mark | 'line' | 'paragraph'> = {
  period: '.', comma: ',', semicolon: ';', colon: ':', newline: 'line',
}
// A command word right after one of these is a noun/ordinary use ("the time period", "a question mark", "of course a comma").
const NOT_AFTER = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'any', 'another',
  'each', 'every', 'one', 'same', 'no', 'some', 'whole', 'entire', 'of', 'for', 'with', 'in', 'on', 'to', 'at', 'by', 'from',
  'time', 'grace', 'trial', 'school', 'ice', 'long', 'short', 'first', 'second', 'third', 'last', 'next', 'previous',
  'current', 'final', 'dark', 'golden', 'good', 'bad', 'new', 'old', 'whole', 'single', 'double', 'rest',
])
// …or when followed by one of these ("period of time", "colon cancer", "the comma key", "period is over").
const NOT_BEFORE = new Set([
  'of', 'is', 'was', 'are', 'were', 'key', 'button', 'symbol', 'character', 'sign', 'cancer', 'splice', 'table', 'drama',
  'costs', 'pain', 'ends', 'starts', 'between', 'during',
])

// ── comma inference (high-confidence patterns only) ─────────────────────────
const INTRO_1 = new Set(['however', 'therefore', 'meanwhile', 'unfortunately', 'fortunately', 'actually', 'basically', 'honestly', 'obviously',
  'additionally', 'furthermore', 'moreover', 'anyway', 'finally', 'personally', 'ideally', 'generally', 'frankly'])
const PARENTHETICAL = [
  'for the most part', 'as a matter of fact', 'in my opinion', 'to be honest', 'by the way', 'of course', 'in fact', 'for example', 'for instance',
  'on the other hand', 'as a result', 'in addition', 'at the same time', 'first of all', 'all in all', 'in general',
].map(p => p.split(' '))
const NO_COMMA_BEFORE_BUT = new Set(['anything', 'nothing', 'everything', 'nobody', 'everyone', 'all', 'last', 'not', 'only', 'just', 'except', 'cannot', 'cant', 'no'])

// ── question detection ──────────────────────────────────────────────────────
const WH = new Set(['what', 'where', 'when', 'why', 'how', 'who', 'whom', 'whose', 'which'])
const AUX = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'have', 'has', 'had', 'am'])
const AUX_NEG = new Set(["isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "can't", "couldn't", "won't", "wouldn't", "shouldn't", "haven't", "hasn't", "hadn't"])
const SUBJ = new Set(['it', 'you', 'we', 'they', 'he', 'she', 'i', 'there', 'this', 'that', 'these', 'those', 'anyone', 'anybody', 'everyone', 'everybody', 'someone', 'somebody', 'anything', 'something', 'everything'])
const DET = new Set(['the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'a', 'an', 'any'])
const WH_DIRECT = new Set(['about', 'if', 'come'])
const WH_QUANT = new Set(['many', 'much', 'long', 'far', 'often', 'old', 'else', 'time', 'kind', 'type', 'big', 'tall', 'soon'])
const MAX_QUESTION_WORDS = 14

// A segment ending on one of these is obviously mid-sentence: no full stop is added.
const DANGLING = new Set(['and', 'but', 'or', 'because', 'that', 'which', 'who', 'whom', 'whose', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'into', 'onto', 'about', 'as', 'than', 'then', 'if', 'when', 'while', 'whether', 'although', 'though', 'unless', 'until', 'since', 'the', 'a', 'an', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'this', 'these', 'those', 'any', 'some', 'each', 'every', 'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being', 'has',
  'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'very', 'really', 'also', 'just', 'only',
  'even', 'still', 'like', 'such', 'both', 'either', 'neither', 'between', 'under', 'during', 'without', 'within'])

const low = (w: string) => w.toLowerCase()
const hasMark = (w: string) => /[.,;:?!]/.test(w)

function isQuestion(W: string[]): boolean {
  const n = W.length
  const w0 = low(W[0] ?? ''), w1 = low(W[1] ?? ''), w2 = low(W[2] ?? '')
  if (n < 3) return false
  if (WH.has(w0)) {
    if (AUX.has(w1)) return n <= 5 || SUBJ.has(w2) || DET.has(w2)       // "what is this" / "what is the time", not "what is important is …"
    if (WH_DIRECT.has(w1)) return true                                   // "what about", "what if", "how come"
    if (WH_QUANT.has(w1)) return W.slice(2, 6).some(w => AUX.has(low(w)))   // "how many people are there", not "how much I love you"
    return false
  }
  if (AUX.has(w0) || AUX_NEG.has(w0)) {
    if ((w0 === 'do' || w0 === 'have') && (DET.has(w1) || w1 === 'it' || w1 === 'that' || w1 === 'this' || w1 === 'these' || w1 === 'those')) return false   // "do it", "have a nice day"
    if (AUX_NEG.has(w0) && !SUBJ.has(w1)) return false                   // "don't forget"
    return SUBJ.has(w1) || (DET.has(w1) && w0 !== 'do' && w0 !== 'have' && w0 !== 'had')
  }
  return false
}

function cap(word: string): string {
  return /^[a-z]/.test(word) && !/[A-Z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word
}
function fixI(word: string): string {
  return /^i(?:'(?:m|ll|ve|d))?$/.test(word) ? 'I' + word.slice(1) : word
}

function startsSentence(before: string): boolean {
  return before === '' || /[.?!]["'”’)\]]*\s*$/.test(before) || /\n\s*$/.test(before)
}

/** Parses spoken punctuation commands out of the words; ambiguous uses stay literal words. */
function parse(words: string[]): { items: Item[]; commands: number } {
  const items: Item[] = []
  let commands = 0
  for (let i = 0; i < words.length; i++) {
    const prev = i > 0 ? low(words[i - 1]) : ''
    const two = i + 1 < words.length ? `${low(words[i])} ${low(words[i + 1])}` : ''
    const one = low(words[i])
    let cmd: Mark | 'line' | 'paragraph' | undefined, len = 1
    if (two && COMMANDS_2[two]) { cmd = COMMANDS_2[two]; len = 2 } else if (COMMANDS_1[one]) { cmd = COMMANDS_1[one] }
    if (cmd) {
      const next = i + len < words.length ? low(words[i + len]) : ''
      const literal = (prev && NOT_AFTER.has(prev)) || (next && NOT_BEFORE.has(next)) || hasMark(words[i]) || (len === 2 && hasMark(words[i + 1]))
      if (!literal) {
        items.push(cmd === 'line' || cmd === 'paragraph' ? { br: cmd } : { m: cmd })
        commands++
        i += len - 1
        continue
      }
    }
    items.push({ w: words[i] })
  }
  return { items, commands }
}

/** High-confidence commas, inserted into the word list as marks. Only when the segment carries no punctuation of its own. */
function inferCommas(items: Item[]): Item[] {
  const W = items.map(it => ('w' in it ? it.w : ''))
  const L = W.map(low)
  const out: Item[] = items.slice()
  const comma = new Set<number>()                       // comma goes AFTER word index
  const phraseAt = (i: number) => PARENTHETICAL.find(p => p.every((x, k) => L[i + k] === x))

  // introductory word/phrase at the start of the segment ("however …", "of course …")
  const intro = PARENTHETICAL.find(p => p.every((x, k) => L[k] === x))
  if (intro && W.length - intro.length >= 3) comma.add(intro.length - 1)
  else if (INTRO_1.has(L[0]) && W.length >= 4) comma.add(0)

  for (let i = 1; i < W.length; i++) {
    // parenthetical phrase mid-sentence: commas on both sides ("I think, for the most part, it is …")
    const ph = phraseAt(i)
    if (ph && i >= 2 && W.length - (i + ph.length) >= 2) { comma.add(i - 1); comma.add(i + ph.length - 1); i += ph.length - 1; continue }
    // parenthetical phrase closing the sentence ("… on friday, for example")
    if (ph && i >= 3 && i + ph.length === W.length) { comma.add(i - 1); break }
    // ", but" with a real clause before it and a clause after it
    if ((L[i] === 'but' || L[i] === 'although') && i >= 3 && W.length - i >= 3 && !NO_COMMA_BEFORE_BUT.has(L[i - 1]) && !L.includes('only')) comma.add(i - 1)
  }
  if (comma.size === 0) return items
  const res: Item[] = []
  out.forEach((it, i) => { res.push(it); if (comma.has(i)) res.push({ m: ',' }) })
  return res
}

export function formatDictation(segment: string, ctx: FormatContext): DictationPart[] {
  const words = segment.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const before = ctx.before ?? ''
  const after = ctx.after ?? ''

  const parsed = parse(words)
  let items = parsed.items
  const commands = parsed.commands
  const alreadyPunctuated = words.some(hasMark)
  // A terminal mark is only added where it cannot cut into an existing sentence: at the end of the block, or when the
  // cursor sits at a sentence boundary (a whole new sentence going in before the next one).
  const canTerminate = after.trim() === '' || (startsSentence(before) && (/^\s/.test(after) || /^[A-Z]/.test(after)))

  if (commands === 0 && !alreadyPunctuated) {
    items = inferCommas(items)
    // Terminal mark for the whole segment — only where the segment is clearly a complete thought, never just because of a pause.
    const W = words
    if (canTerminate && W.length >= 3) {
      const last = low(W[W.length - 1])
      if (!DANGLING.has(last)) {
        // A long run that merely STARTS like a question is ambiguous (where does the question end?): leave it unmarked.
        if (isQuestion(W)) { if (W.length <= MAX_QUESTION_WORDS) items.push({ m: '?' }) }
        else items.push({ m: '.' })
      }
    }
  }

  // Build parts: words are separated by single spaces, marks attach to the word before them, breaks start a new sentence.
  const parts: DictationPart[] = []
  let cur = ''
  let capNext = startsSentence(before)
  const flush = () => { if (cur) { parts.push({ kind: 'text', text: cur }); cur = '' } }
  for (const it of items) {
    if ('w' in it) {
      let w = fixI(it.w)
      if (capNext) { w = cap(w); capNext = false }
      cur += (cur && !/\s$/.test(cur) ? ' ' : '') + w
    } else if ('m' in it) {
      cur += it.m
      if (it.m === '.' || it.m === '?' || it.m === '!') capNext = true
    } else {
      flush(); parts.push({ kind: it.br === 'line' ? 'line' : 'paragraph' }); capNext = true
    }
  }
  flush()

  // Join with what is already in the editor: no doubled marks, no stray spaces, a space where words meet.
  const first = parts[0]
  if (first && first.kind === 'text') {
    let t = first.text
    if (before && /[.,;:?!]$/.test(before)) t = t.replace(/^[.,;:?!]+/, '')       // never duplicate/stack punctuation across segments
    if (t === '') parts.shift()
    else {
      const startsWithMark = /^[.,;:?!]/.test(t)
      const needsSpace = before !== '' && !/[\s(\[{“‘"']$/.test(before) && !startsWithMark
      first.text = (needsSpace ? ' ' : '') + t
    }
  }
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.kind === 'text' && /^[A-Za-z0-9]/.test(after)) lastPart.text += ' '   // inserting mid-text: keep the next word apart
  return parts
}
