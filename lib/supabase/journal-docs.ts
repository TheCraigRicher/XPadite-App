// v1.330 — Supabase access for extra Planner documents and Notes (migration 025). Every function is a thin, typed wrapper; all merge / conflict
// policy lives in components/xpadite/journalDocs.ts and the sync hook. RLS (own rows only) is enforced by the database, not by these calls.
import { createClient } from '@/lib/supabase/client'
import type { ExtraDoc, ExtraKind } from '@/components/xpadite/journalDocs'
import type { JournalFolder } from '@/components/xpadite/types'

type Supabase = ReturnType<typeof createClient>

/** True when the error means "migration 025 is not applied" (missing table / function) — the app then degrades instead of failing. */
export function isMissingObject(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  return e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42883' || e.code === '42P01' || e.code === '404' ||
    /could not find the (table|function)|does not exist/i.test(e.message ?? '')
}

export type FetchDocsResult = { status: 'ok'; docs: ExtraDoc[] } | { status: 'unavailable' } | { status: 'error' }

export async function fetchJournalDocs(supabase: Supabase, userId: string): Promise<FetchDocsResult> {
  const { data, error } = await supabase
    .from('journal_documents')
    .select('doc_id, kind, date_key, content, rev, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  // 42501 = the table exists but this role has no privileges on it (migration 025 incompletely applied): same remedy as a missing migration
  if (error) return isMissingObject(error) || (error as { code?: string }).code === '42501' ? { status: 'unavailable' } : { status: 'error' }
  return {
    status: 'ok',
    docs: (data ?? []).map(r => ({
      id: r.doc_id as string,
      kind: (r.kind === 'note' ? 'note' : 'doc') as ExtraKind,
      dateKey: r.date_key as string,
      raw: (r.content as string) ?? '',
      rev: typeof r.rev === 'number' ? r.rev : null,
      createdAt: Date.parse(r.created_at as string) || Date.now(),
    })),
  }
}

export type DocSaveResult = { ok: true; rev: number } | { ok: false; rev: number; content: string | null }

/** Compare-and-swap write. Throws on transport / missing-function errors; a lost race is a normal `{ ok:false }` result, never an exception. */
export async function saveJournalDocCas(supabase: Supabase, doc: ExtraDoc, expectedRev: number | null): Promise<DocSaveResult> {
  const { data, error } = await supabase.rpc('journal_doc_save', {
    p_doc_id: doc.id, p_kind: doc.kind, p_date_key: doc.dateKey, p_content: doc.raw, p_expected_rev: expectedRev,
  })
  if (error) throw Object.assign(new Error(error.message || 'save failed'), { code: error.code })
  const r = data as { ok: boolean; rev: number; content?: string | null }
  return r.ok ? { ok: true, rev: r.rev } : { ok: false, rev: r.rev, content: r.content ?? null }
}

export async function deleteJournalDocs(supabase: Supabase, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('journal_documents').delete().eq('user_id', userId).in('doc_id', ids)
  if (error) throw error
}

/** Ask the server to create the three starter notes — at most once per account (the server owns the marker). Resolves true only when THIS call created them. */
export async function seedStarterNotes(supabase: Supabase, docs: ExtraDoc[], dateKey: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('journal_seed_starter_notes', {
    p_docs: docs.map(d => ({ doc_id: d.id, content: d.raw })), p_date_key: dateKey,
  })
  if (error) throw Object.assign(new Error(error.message || 'seed failed'), { code: error.code })
  return (data as { seeded?: boolean } | null)?.seeded === true
}

/** Folders with an explicit success/failure result (the legacy fetch returns [] on error, which can not tell "no folders" from "could not load"). */
export async function fetchJournalFoldersStrict(supabase: Supabase, userId: string): Promise<JournalFolder[] | null> {
  const { data, error } = await supabase
    .from('journal_folders')
    .select('folder_id, name, color, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error || !data) return null
  return data.map(row => ({
    id: row.folder_id as string,
    name: row.name as string,
    color: (row.color as string | null) ?? undefined,
    createdAt: Date.parse(row.created_at as string) || undefined,
  }))
}
