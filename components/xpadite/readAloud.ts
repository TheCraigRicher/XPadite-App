/**
 * v1.359 — Planner Read Aloud: PURE text + queue logic (no React, no browser APIs, nothing is ever written to a document).
 *
 * Turns Planner sections into short, speakable chunks:
 *  • the text comes from the same reader the email feature uses (emailShare.ts → tiptapToPlainText / sectionToEmail), so headings, paragraphs, bullet /
 *    numbered / lettered / checklist items, tables and BOTH halves of a split section are covered, in order, and editor internals (ids, marks, colours)
 *    are never read;
 *  • list / checklist glyphs and divider rules are dropped (a checklist item is read as plain text — no "done" announcement), table rows are read as
 *    comma-separated cells;
 *  • every line becomes its own utterance (a natural pause), and long lines are split at sentence → clause → word boundaries into chunks of at most
 *    MAX_CHUNK characters. Short chunks are what makes long sections reliable: browsers cut off or stall long utterances (Chrome ~15 s, some Android
 *    voices ~4 000 characters) and short chunks make pause / resume / speed changes cheap.
 */
import type { JournalBlock } from './types'
import { sectionToEmail } from './emailShare'

export const RATES = [0.75, 1, 1.25, 1.5, 2] as const
export const DEFAULT_RATE = 1
export const MAX_CHUNK = 180

export interface SpeakSection { id: string; title: string; chunks: string[] }

export function isValidRate(r: unknown): r is number { return typeof r === 'number' && (RATES as readonly number[]).includes(r) }

const HAS_WORD = /[\p{L}\p{N}]/u

/** One line of plain text → what should be spoken ('' = nothing). */
export function cleanLine(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  s = s.replace(/^(?:>\s*)+/, '')                    // quote marks
  s = s.replace(/^[•☐☑]\s*/, '')                     // bullet / checkbox glyphs (checked or not: the text only)
  s = s.replace(/\s\|\s/g, ', ')                     // table cells
  s = s.trim()
  return HAS_WORD.test(s) ? s : ''                   // divider rules and other symbol-only lines are skipped
}

/** Plain text (as produced by tiptapToPlainText) → non-empty speakable lines. */
export function speechLines(plain: string): string[] {
  return plain.split('\n').map(cleanLine).filter(Boolean)
}

function splitWords(s: string, max: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of s.split(' ')) {
    if (w.length > max) {                              // one unbroken token: hard split
      if (cur) { out.push(cur); cur = '' }
      for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max))
      continue
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w
    else { out.push(cur); cur = w }
  }
  if (cur) out.push(cur)
  return out
}

/** One line → chunks of at most `max` characters, split at sentence ends first, then clause marks, then words. Concatenated they equal the line (modulo spaces). */
export function splitLong(line: string, max = MAX_CHUNK): string[] {
  const s = line.trim()
  if (!s) return []
  if (s.length <= max) return [s]
  const pieces = (text: string, re: RegExp): string[] => text.match(re)?.map(x => x.trim()).filter(Boolean) ?? [text]
  const pack = (parts: string[], finer: (p: string) => string[]): string[] => {
    const out: string[] = []
    let cur = ''
    for (const p of parts) {
      if (p.length > max) { if (cur) { out.push(cur); cur = '' } out.push(...finer(p)); continue }
      if (!cur) cur = p
      else if (cur.length + 1 + p.length <= max) cur += ' ' + p
      else { out.push(cur); cur = p }
    }
    if (cur) out.push(cur)
    return out
  }
  const byClause = (p: string) => pack(pieces(p, /[^,;:—–]+[,;:—–]*\s*/g), w => splitWords(w, max))
  // a sentence ends at . ! ? … followed by whitespace / the end — so "3.5" and "e.g." inside a sentence are not split points
  return pack(pieces(s, /[\s\S]+?(?:[.!?…]+["')\]]*(?=\s|$)|$)\s*/g), byClause)
}

const endsSentence = (t: string) => /[.!?…:;]["')\]]*$/.test(t)

/** A section's title + body → chunk list (title first, as its own short chunk). */
function chunksFor(title: string, lines: string[]): string[] {
  const out: string[] = []
  const t = title.replace(/\s+/g, ' ').trim()
  if (t && HAS_WORD.test(t)) out.push(...splitLong(endsSentence(t) ? t : t + '.'))
  for (const l of lines) out.push(...splitLong(l))
  return out
}

/**
 * The reading queue for a set of Planner blocks, IN THE ORDER GIVEN (pass the Planner's own block order, for one date only). Sections and unsectioned
 * text are read; images, drawings and mind maps are skipped; sections with no speakable text are skipped. `live` returns a block's current editor
 * content (the same live-text lookup Send via Email uses).
 */
export function buildQueue(blocks: JournalBlock[], live: (b: JournalBlock) => string | undefined): SpeakSection[] {
  const out: SpeakSection[] = []
  for (const b of blocks) {
    if (b.type !== 'section' && b.type !== 'text') continue
    const lines = speechLines(sectionToEmail(b, live(b)).body)
    if (lines.length === 0) continue                                   // empty section: skipped
    out.push({ id: b.id, title: b.type === 'section' ? (b.name ?? '') : '', chunks: chunksFor(b.type === 'section' ? (b.name ?? '') : '', lines) })
  }
  return out
}

/** Prefer an English voice (the device's own English first), else leave it to the browser's default. */
export function pickVoice<V extends { lang: string; default?: boolean; localService?: boolean }>(voices: readonly V[], navLang = 'en-US'): V | undefined {
  const en = voices.filter(v => /^en([-_]|$)/i.test(v.lang))
  if (en.length === 0) return undefined
  const mine = en.filter(v => v.lang.replace('_', '-').toLowerCase() === navLang.toLowerCase())
  const pool = mine.length ? mine : en
  return pool.find(v => v.default) ?? pool.find(v => v.localService) ?? pool[0]
}

/** Where a paused / re-timed chunk should restart: at the last WORD boundary the browser reported (where it reliably reports them), else the chunk start. */
export function resumeIndex(chunk: string, spokenFrom: number, boundaryIndex: number | null): number {
  if (boundaryIndex === null || !Number.isFinite(boundaryIndex)) return spokenFrom
  const i = Math.min(Math.max(boundaryIndex, spokenFrom), chunk.length)
  return i >= chunk.length ? spokenFrom : i
}
