// v1.330 — Library Notes & Folders. PURE logic (no React, no Supabase): document identity, metadata ownership, the single-section Note rule,
// starter notes, folder membership and the unified Library entry list. Everything here is unit-tested (tests/journal/libraryNotesFolders.test.cjs).
//
// MODEL
//  • A regular Planner document for a date is still `calData[date].notes` (the day's PRIMARY document — unchanged, never migrated).
//  • Anything else — a second/third document on the same day, or a Note — is an ExtraDoc (table journal_documents, migration 025).
//  • Both are the SAME JSON shape (JournalDoc), so the existing Planner editor opens either one. Folder membership and labels live in that JSON
//    (folderId / labelIds): moving a document into a folder rewrites one metadata field and never copies or touches its content blocks.
//  • A Library "key" identifies a document everywhere in the UI: the date key for a primary document (exactly as before), `x:<id>` for an extra one.
import type { JournalBlock, JournalFolder } from './types'

export type ExtraKind = 'doc' | 'note'

export interface ExtraDoc {
  id: string
  kind: ExtraKind
  dateKey: string          // YYYY-MM-DD — the day a 'doc' belongs to / the day a Note was created
  raw: string              // serialized JournalDoc
  rev: number | null       // server revision this copy is based on (null = never saved / no row yet)
  createdAt: number        // epoch ms
}

export const EXTRA_PREFIX = 'x:'
export const extraKey = (id: string) => EXTRA_PREFIX + id
export const isExtraKey = (key: string) => key.startsWith(EXTRA_PREFIX)
export const extraIdOf = (key: string) => (isExtraKey(key) ? key.slice(EXTRA_PREFIX.length) : null)

let seq = 0
/** A fresh, collision-safe document id. */
export function newDocId(now = Date.now()): string {
  seq = (seq + 1) % 1e6
  const rnd = Math.random().toString(36).slice(2, 8)
  return `d${now.toString(36)}${String(seq).padStart(3, '0')}${rnd}`
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

type AnyObj = Record<string, unknown>
function parseObj(raw: string | null | undefined): AnyObj | null {
  if (!raw || !raw.trim()) return null
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : null } catch { return null }
}

/** First non-empty text line of a Tiptap JSON string (used as the fallback title). */
export function extractFirstLine(tiptapJson: string | undefined): string {
  if (!tiptapJson) return ''
  try {
    const doc = JSON.parse(tiptapJson)
    const parts: string[] = []
    const walk = (node: unknown) => {
      const n = node as Record<string, unknown>
      if (!n || typeof n !== 'object') return
      if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
      if (n.type === 'paragraph' && parts.length > 0) parts.push('\n')
      if (Array.isArray(n.content)) (n.content as unknown[]).forEach(walk)
    }
    walk(doc)
    return (parts.join('').split('\n').find(l => l.trim()) ?? '').trim().slice(0, 52)
  } catch { return '' }
}

// ─── Metadata ownership (the autosave fix) ────────────────────────────────────
// The Planner editor owns a document's CONTENT (blocks, title, timer sessions). The Library owns its ORGANISATION (labelIds, folderId).
// The editor's serializer never knew about the organisation fields, so every autosave used to drop them. `mergeDocMeta` re-attaches whatever the
// stored document currently says — so an autosave can never erase a label or a folder — and the editor can stay unaware of them.
const META_KEYS = ['labelIds', 'folderId'] as const

export function mergeDocMeta(incomingRaw: string, storedRaw: string | null | undefined): string {
  const inc = parseObj(incomingRaw)
  if (!inc) return incomingRaw
  const stored = parseObj(storedRaw)
  let changed = false
  for (const k of META_KEYS) {
    const has = stored !== null && Object.prototype.hasOwnProperty.call(stored, k)
    if (has) { if (JSON.stringify(inc[k]) !== JSON.stringify(stored![k])) { inc[k] = stored![k]; changed = true } }
    else if (Object.prototype.hasOwnProperty.call(inc, k)) { delete inc[k]; changed = true }
  }
  return changed ? JSON.stringify(inc) : incomingRaw
}

export function getDocFolderId(raw: string | null | undefined): string | null {
  const o = parseObj(raw)
  const f = o?.folderId
  return typeof f === 'string' && f ? f : null
}

/** Set (or clear, with null) a document's folder. Content blocks are passed through untouched. */
export function withFolder(raw: string, folderId: string | null): string {
  const o = parseObj(raw)
  if (!o) return raw
  if (folderId) o.folderId = folderId; else delete o.folderId
  return JSON.stringify(o)
}

export function withTitle(raw: string, title: string): string {
  const o = parseObj(raw) ?? { v: 1, blocks: [] }
  const t = title.trim()
  if (t) o.title = t; else delete o.title
  return JSON.stringify(o)
}

// ─── Blank documents / starter notes ──────────────────────────────────────────

/** The editor's own default for an empty document: ONE lavender section (see createSectionBlock / the editor's init effect). */
function sectionBlock(now: number): JournalBlock {
  return { id: `b${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, type: 'section', content: '', sectionColor: 'lavender', createdAt: now, updatedAt: now }
}

/** A brand-new empty document — exactly what the Planner editor itself creates for an empty page (one empty section). */
export function blankDocRaw(title?: string, now = Date.now()): string {
  return JSON.stringify({ v: 1, ...(title?.trim() ? { title: title.trim() } : {}), blocks: [sectionBlock(now)] })
}

export const STARTER_NOTE_TITLES = ['Ideas', 'Plans', 'My Daily Journal'] as const

/** The three starter notes, ids ordered so they list in this order even though they share one creation timestamp. */
export function buildStarterNotes(dateKey: string, now = Date.now()): ExtraDoc[] {
  const base = newDocId(now)
  return STARTER_NOTE_TITLES.map((title, i) => ({
    id: `${base}-${i + 1}`, kind: 'note' as const, dateKey, raw: blankDocRaw(title, now), rev: null, createdAt: now,
  }))
}

// ─── Notes are ordinary Planner documents (v1.332) ────────────────────────────
// A Note uses the full Planner editor: any number of sections, in any order. (v1.330 limited Notes to one section; that rule — and the save-time
// normaliser that enforced it — is gone. Stored Notes need no migration: a one-section Note is simply a Note with one section.)

// ─── Hydration merge (cross-device) ───────────────────────────────────────────
/**
 * Combine this device's documents with the server's. The server is the truth for everything this device has no unsynced edit for; a document
 * with an unsynced local edit is kept as-is (never overwritten by a hydrate). Documents the server no longer has (deleted on another device) are
 * dropped unless they hold unsynced local work.
 */
export function mergeServerDocs(local: ExtraDoc[], server: ExtraDoc[], unsyncedIds: Set<string>): ExtraDoc[] {
  const localById = new Map(local.map(d => [d.id, d]))
  const out: ExtraDoc[] = server.map(s => (unsyncedIds.has(s.id) && localById.has(s.id) ? { ...localById.get(s.id)!, rev: s.rev } : s))
  const serverIds = new Set(server.map(s => s.id))
  for (const l of local) if (!serverIds.has(l.id) && unsyncedIds.has(l.id)) out.push(l)
  return sortDocs(out)
}

export function sortDocs(docs: ExtraDoc[]): ExtraDoc[] {
  return [...docs].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** A concurrent edit lost the compare-and-swap: this device's version is kept as a NEW independent document (nothing is overwritten or lost). */
export function conflictCopy(mine: ExtraDoc, now = Date.now()): ExtraDoc {
  const base = entryFromRaw('', 'extra', mine.kind, mine.dateKey, mine.raw, mine.createdAt, new Set()).title
  return { id: newDocId(now), kind: mine.kind, dateKey: mine.dateKey, raw: withTitle(mine.raw, `${base} (conflict copy)`), rev: null, createdAt: now }
}

// ─── Unified Library entries ──────────────────────────────────────────────────

export interface LibEntry {
  key: string                // date key (primary document) or `x:<id>` (extra document / Note)
  dateKey: string            // === key; kept under this name so every existing Library handler keeps working on it
  docDate: string            // the real YYYY-MM-DD the document belongs to
  source: 'day' | 'extra'
  kind: 'doc' | 'note'
  year: number; month: number; day: number
  title: string
  labelIds: string[]
  folderId: string | null    // already validated against the existing folders (a folder that no longer exists reads as unfiled)
  createdAt: number
}

const keyParts = (k: string): [number, number, number] => { const [y, m, d] = k.split('-').map(Number); return [y, m - 1, d] }

export function entryFromRaw(key: string, source: 'day' | 'extra', kind: 'doc' | 'note', docDate: string, raw: string, createdAt: number, folderIds: Set<string>): LibEntry {
  const o = parseObj(raw)
  const [y, m, d] = keyParts(docDate)
  const blocks = (Array.isArray(o?.blocks) ? (o!.blocks as JournalBlock[]) : [])
  const firstText = blocks.find(b => (b.type === 'text' || b.type === 'section') && b.content)?.content
  const title = (typeof o?.title === 'string' && o.title.trim()) || extractFirstLine(firstText ?? raw) || 'Untitled'
  const folder = typeof o?.folderId === 'string' && folderIds.has(o.folderId) ? o.folderId : null
  return {
    key, dateKey: key, docDate, source, kind, year: y, month: m, day: d, title,
    labelIds: Array.isArray(o?.labelIds) ? (o!.labelIds as string[]) : [], folderId: folder, createdAt,
  }
}

/** Every document the Library can show: day documents with content, extra documents and Notes. */
export function buildLibraryEntries(
  calNotes: Record<string, string | undefined>, extras: ExtraDoc[], folders: Pick<JournalFolder, 'id'>[],
): LibEntry[] {
  const folderIds = new Set(folders.map(f => f.id))
  const out: LibEntry[] = []
  for (const [key, notes] of Object.entries(calNotes)) {
    if (!notes?.trim()) continue
    const [y, m, d] = keyParts(key)
    out.push(entryFromRaw(key, 'day', 'doc', key, notes, new Date(y, m, d).getTime(), folderIds))
  }
  for (const e of extras) out.push(entryFromRaw(extraKey(e.id), 'extra', e.kind, e.dateKey, e.raw, e.createdAt, folderIds))
  return out
}

export const entriesInFolder = (entries: LibEntry[], folderId: string) => entries.filter(e => e.folderId === folderId)
export function folderItemCounts(entries: LibEntry[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entries) if (e.folderId) m.set(e.folderId, (m.get(e.folderId) ?? 0) + 1)
  return m
}

/** Result of deleting a folder: which documents must be un-filed. Documents are NEVER deleted by a folder delete. */
export function docsToUnfile(entries: LibEntry[], folderId: string): string[] { return entriesInFolder(entries, folderId).map(e => e.key) }
