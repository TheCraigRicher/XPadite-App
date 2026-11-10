'use client'
// v1.330 — client store for extra Planner documents and Notes (migration 025): local cache + durable debounced sync + hydration + once-only
// starter notes. Policy (all pure parts are in journalDocs.ts and unit-tested):
//  • Writes go through DaySyncQueue (debounce, retry with back-off, "unsynced" survives a refresh) and the server's compare-and-swap function.
//  • A lost race never overwrites anything: the other device's version is adopted and THIS device's version is kept as a new "(conflict copy)".
//  • A document deleted on another device that this device still edits is simply recreated (work is never silently destroyed).
//  • Starter notes are requested only AFTER a successful server read, and the server's marker makes the request idempotent across devices.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  fetchJournalDocs, saveJournalDocCas, deleteJournalDocs, seedStarterNotes, isMissingObject,
} from '@/lib/supabase/journal-docs'
import { DaySyncQueue } from './daySync'
import {
  type ExtraDoc, type ExtraKind, blankDocRaw, buildStarterNotes, conflictCopy, mergeDocMeta, mergeServerDocs, newDocId,
  sortDocs,
} from './journalDocs'

const CACHE_KEY = 'xp9jx'          // { uid, docs, unsynced }
const DELETE_KEY = 'xp9jxdel'      // { uid, ids } deletes the server has not confirmed yet
const SEEDED_KEY = 'xp9jxseed'     // { uid } this account's server marker is known to exist (skips a needless call)

export type DocsStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'unavailable'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function readJson<T>(key: string): T | null { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null } catch { return null } }
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

export interface JournalDocsApi {
  docs: ExtraDoc[]
  status: DocsStatus
  /** Create a new independent document / Note (saved immediately in the background); returns it so the caller can open it. */
  createDoc: (kind: ExtraKind, dateKey: string, title?: string) => ExtraDoc
  /** Editor autosave / explicit save: content from the editor; the stored organisation fields (labels, folder) are kept, a Note stays one section. */
  saveRaw: (id: string, raw: string) => void
  /** Library edits (rename, label, folder): transform the stored raw string. */
  updateRaw: (id: string, fn: (raw: string) => string) => void
  /** Removes the documents on this device at once; resolves true when the server delete went through (or the rows were already gone), false when it failed (it is kept and retried). */
  deleteDocs: (ids: string[]) => Promise<boolean>
  refresh: () => Promise<void>
  flush: () => Promise<boolean>
}

export function useJournalDocs(userId: string, setToast: (m: string) => void): JournalDocsApi {
  const [docs, setDocs] = useState<ExtraDoc[]>([])
  const [status, setStatus] = useState<DocsStatus>('idle')
  const docsRef = useRef<ExtraDoc[]>([])
  const uidRef = useRef(userId)
  const toastRef = useRef(setToast)
  useEffect(() => { uidRef.current = userId; toastRef.current = setToast })   // declared first, so every later effect already sees the current account
  const unavailableRef = useRef(false)
  const hydratingRef = useRef(false)
  const writeRef = useRef<(key: string, data: ExtraDoc) => Promise<void>>(async () => {})
  // The last few texts THIS device sent for each document. If a save reached the server but its response was lost, the retry finds the server holding
  // one of these: that is this device's own earlier write, not another device's edit — it must never become a "(conflict copy)" or a duplicate.
  const sentRef = useRef<Map<string, string[]>>(new Map())

  const persistCache = useCallback((next: ExtraDoc[], unsynced: string[]) => {
    if (!uidRef.current) return
    writeJson(CACHE_KEY, { uid: uidRef.current, docs: next, unsynced })
  }, [])

  const callWrite = useCallback((key: string, data: ExtraDoc) => writeRef.current(key, data), [])
  const onQueueError = useCallback((key: string, err: unknown) => {
    console.error('[JournalDocs] sync error for', key, err)
    toastRef.current('⚠ Couldn’t save a note to the cloud — it is kept on this device and will retry automatically')
  }, [])
  const onQueueRecovered = useCallback(() => toastRef.current('Changes synced ✓'), [])
  const onQueueUnsynced = useCallback((keys: string[]) => persistCache(docsRef.current, keys), [persistCache])
  // created on first use (always from an event handler / effect, never during render), so no ref is read while rendering
  const queueRef = useRef<DaySyncQueue<ExtraDoc> | null>(null)
  const getQueue = useCallback((): DaySyncQueue<ExtraDoc> => {
    if (queueRef.current === null) {
      queueRef.current = new DaySyncQueue<ExtraDoc>({ write: callWrite, onError: onQueueError, onRecovered: onQueueRecovered, onUnsyncedChange: onQueueUnsynced })
    }
    return queueRef.current
  }, [callWrite, onQueueError, onQueueRecovered, onQueueUnsynced])

  const commit = useCallback((next: ExtraDoc[]) => {
    const sorted = sortDocs(next)
    docsRef.current = sorted
    setDocs(sorted)
    persistCache(sorted, getQueue().unsyncedKeys())
  }, [persistCache, getQueue])

  // ── write one document (compare-and-swap) ───────────────────────────────────
  const write = async (key: string, data: ExtraDoc): Promise<void> => {
    const uid = uidRef.current
    if (!uid) throw new Error('no-user')
    if (unavailableRef.current) return
    const sb = createClient()
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = docsRef.current.find(d => d.id === key)
      if (!cur) return                                                   // deleted while queued
      let res: Awaited<ReturnType<typeof saveJournalDocCas>>
      const sent = sentRef.current.get(key) ?? []
      if (sent[sent.length - 1] !== data.raw) sentRef.current.set(key, [...sent, data.raw].slice(-12))
      try { res = await saveJournalDocCas(sb, data, cur.rev) }
      catch (err) { if (isMissingObject(err)) { unavailableRef.current = true; setStatus('unavailable'); return } throw err }
      if (res.ok) { commit(docsRef.current.map(d => (d.id === key ? { ...d, rev: res.rev } : d))); return }
      if (res.content === null) {                                        // deleted on another device, but this one holds work: recreate it
        commit(docsRef.current.map(d => (d.id === key ? { ...d, rev: null } : d)))
        continue
      }
      if ((sentRef.current.get(key) ?? []).includes(res.content)) {       // our own earlier write already landed (its response was lost): adopt its revision
        commit(docsRef.current.map(d => (d.id === key ? { ...d, rev: res.rev } : d)))
        if (res.content === data.raw) return                              // nothing newer to send
        continue                                                           // newer typing: send it on top of the revision that already exists
      }
      // Lost the race: adopt the server's version, keep this device's as an independent copy. Nothing is overwritten, nothing is lost.
      const latest = getQueue().peek(key) ?? data
      const copy = conflictCopy({ ...latest, rev: null })
      getQueue().discard(key)
      commit([...docsRef.current.map(d => (d.id === key ? { ...d, raw: res.content as string, rev: res.rev } : d)), copy])
      getQueue().schedule(copy.id, copy)
      toastRef.current('This document was changed on another device — your version was saved as a copy')
      return
    }
    throw new Error('journal-doc-contended')
  }
  useEffect(() => { writeRef.current = write })

  // ── hydrate (login, foreground, Library open) ───────────────────────────────
  const hydrate = useCallback(async () => {
    const uid = uidRef.current
    if (!uid || hydratingRef.current || unavailableRef.current) return
    hydratingRef.current = true
    try {
      const sb = createClient()
      // 1. retry deletes the server has not confirmed
      const pend = readJson<{ uid: string; ids: string[] }>(DELETE_KEY)
      let pendingDel = pend && pend.uid === uid ? pend.ids : []
      if (pendingDel.length) {
        try { await deleteJournalDocs(sb, uid, pendingDel); pendingDel = []; writeJson(DELETE_KEY, { uid, ids: [] }) } catch { /* retried next time */ }
      }
      const res = await fetchJournalDocs(sb, uid)
      if (res.status === 'unavailable') { unavailableRef.current = true; setStatus('unavailable'); return }
      if (res.status === 'error') { setStatus(s => (s === 'ready' ? s : 'offline')); return }
      const del = new Set(pendingDel)
      commit(mergeServerDocs(docsRef.current, res.docs.filter(d => !del.has(d.id)), new Set(getQueue().unsyncedKeys())))
      setStatus('ready')
      // 2. starter notes: only after a SUCCESSFUL server read, only if this account is not already known to be seeded. The server decides.
      const seeded = readJson<{ uid: string }>(SEEDED_KEY)
      if (!(seeded && seeded.uid === uid)) {
        try {
          const created = await seedStarterNotes(sb, buildStarterNotes(localToday()), localToday())
          writeJson(SEEDED_KEY, { uid })
          if (created) {
            const again = await fetchJournalDocs(sb, uid)
            if (again.status === 'ok') commit(mergeServerDocs(docsRef.current, again.docs.filter(d => !del.has(d.id)), new Set(getQueue().unsyncedKeys())))
          }
        } catch (err) {
          if (isMissingObject(err)) { unavailableRef.current = true; setStatus('unavailable') }
          // any other failure: nothing was created, nothing is remembered — the next load simply tries again
        }
      }
    } finally { hydratingRef.current = false }
  }, [commit, getQueue])

  // account change / login: load this account's cache, resume its unsynced edits, then hydrate
  useEffect(() => {
    const t = setTimeout(() => {                                     // state is set from a callback (loading from localStorage is an external-system read)
      if (!userId) { docsRef.current = []; setDocs([]); setStatus('idle'); return }
      unavailableRef.current = false
      const cache = readJson<{ uid: string; docs: ExtraDoc[]; unsynced?: string[] }>(CACHE_KEY)
      if (cache && cache.uid === userId && Array.isArray(cache.docs)) {
        docsRef.current = sortDocs(cache.docs); setDocs(docsRef.current)
        for (const id of cache.unsynced ?? []) { const d = cache.docs.find(x => x.id === id); if (d) getQueue().schedule(id, d) }
      } else {
        docsRef.current = []; setDocs([])
        try { localStorage.removeItem(CACHE_KEY) } catch {}            // another account's data never lingers
      }
      setStatus('loading')
      void hydrate()
    }, 0)
    return () => clearTimeout(t)
  }, [userId, hydrate, getQueue])

  // other devices: re-read when the app returns to the foreground; flush this device's edits when it leaves
  useEffect(() => {
    if (!userId) return
    let last = Date.now()
    const onVis = () => {
      if (document.visibilityState === 'hidden') { void getQueue().flushAll(); return }
      if (Date.now() - last < 30_000) return
      last = Date.now(); void hydrate()
    }
    const onHide = () => { void getQueue().flushAll() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide) }
  }, [userId, hydrate, getQueue])

  // ── actions ─────────────────────────────────────────────────────────────────
  const createDoc = useCallback((kind: ExtraKind, dateKey: string, title?: string): ExtraDoc => {
    const now = Date.now()
    const doc: ExtraDoc = { id: newDocId(now), kind, dateKey, raw: blankDocRaw(title, now), rev: null, createdAt: now }
    commit([...docsRef.current, doc])
    getQueue().schedule(doc.id, doc)
    return doc
  }, [commit, getQueue])

  const updateRaw = useCallback((id: string, fn: (raw: string) => string) => {
    const cur = docsRef.current.find(d => d.id === id)
    if (!cur) return
    const next = fn(cur.raw)
    if (next === cur.raw) return
    const updated = { ...cur, raw: next }
    commit(docsRef.current.map(d => (d.id === id ? updated : d)))
    getQueue().schedule(id, updated)
  }, [commit, getQueue])

  const saveRaw = useCallback((id: string, raw: string) => {
    updateRaw(id, stored => mergeDocMeta(raw, stored))
  }, [updateRaw])

  const deleteDocs = useCallback((ids: string[]) => {
    if (ids.length === 0) return Promise.resolve(true)
    const uid = uidRef.current
    for (const id of ids) getQueue().discard(id)
    commit(docsRef.current.filter(d => !ids.includes(d.id)))
    if (!uid) return Promise.resolve(true)
    const pend = readJson<{ uid: string; ids: string[] }>(DELETE_KEY)
    const all = Array.from(new Set([...(pend && pend.uid === uid ? pend.ids : []), ...ids]))
    writeJson(DELETE_KEY, { uid, ids: all })
    return deleteJournalDocs(createClient(), uid, ids)
      .then(() => { const p = readJson<{ uid: string; ids: string[] }>(DELETE_KEY); writeJson(DELETE_KEY, { uid, ids: (p?.ids ?? []).filter(i => !ids.includes(i)) }); return true })
      .catch(err => { if (isMissingObject(err)) return true; console.error('[JournalDocs] delete failed (will retry):', err); return false })
  }, [commit, getQueue])

  const refresh = useCallback(() => hydrate(), [hydrate])
  const flush = useCallback(() => getQueue().flushAll(), [getQueue])

  return { docs, status, createDoc, saveRaw, updateRaw, deleteDocs, refresh, flush }
}
