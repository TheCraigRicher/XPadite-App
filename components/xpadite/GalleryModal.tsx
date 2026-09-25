'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  uploadGalleryImage,
  upsertGalleryItemMetadata,
  deleteGalleryItem as supabaseDeleteGalleryItem,
  fetchGalleryItems,
  getSignedUrl,
} from '@/lib/supabase/gallery'
import { useLockBodyScroll } from './useLockBodyScroll'
import { useApp } from './AppContext'
import { MONTHS } from './utils'
import {
  PLATFORMS, PLATFORM_DESTINATIONS, PlatformBadge,
  triggerDownloadFromFile,
} from './YearProgressShare'

const GALLERY_KEY = 'xp9g'

// Shared fixed width for the Select ▾ / Cancel toolbar control (all 3
// devices) — sized to fit "Select" + chevron (the wider of the two
// possible contents), applied identically to both states so swapping
// between them never reflows the surrounding toolbar.
const SELECT_CANCEL_WIDTH = 80

// ── Data model ───────────────────────────────────────────────────────────────
// Same store as before (localStorage 'xp9g' + Supabase 'gallery_items'), just
// with two more item types and two optional display-only fields. Nothing here
// changes how existing month-share/year-share/photo items are read or written.

export type GalleryItemType = 'month-share' | 'year-share' | 'photo' | 'drawing' | 'document'

export interface GalleryItem {
  id: string
  type: GalleryItemType
  createdAt: number
  title: string
  month?: number
  year?: number
  dataUri: string
  stats?: {
    productiveDays: number
    totalDays: number
    hyperDays: number
    milestoneDays: number
    goalDays: number
    completionRate: number
  }
  /** Display-only provenance, e.g. "Analytics", "Planner/Journal", "Camera", "Upload". Optional — older items simply omit it. */
  source?: string
  /** Display-only human label for the date/period this asset relates to, e.g. "September 2026". */
  relatedDateLabel?: string
}

export function loadGallery(): GalleryItem[] {
  try { const r = localStorage.getItem(GALLERY_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
export function saveGallery(items: GalleryItem[]): void {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(items))
}
// Saves to localStorage synchronously, then fires a background Supabase upload.
// Callers do not need to await — write-through pattern.
export function addGalleryItem(item: GalleryItem): void {
  saveGallery([item, ...loadGallery()])
  // Background Supabase sync — fire and forget
  ;(async () => {
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (!data.user) return
      const uid = data.user.id
      const storagePath = await uploadGalleryImage(supabase, uid, item.id, item.dataUri)
      if (!storagePath) {
        console.error('[Gallery] Upload failed for item', item.id, '— metadata not written')
        return
      }
      await upsertGalleryItemMetadata(supabase, uid, item, storagePath)
    } catch (err) {
      console.error('[Gallery] Supabase sync error:', err)
    }
  })()
}

function resizeImage(file: File, maxW: number, maxH: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = Math.round(img.width * ratio)
        const h = Math.round(img.height * ratio)
        const cv = document.createElement('canvas')
        cv.width = w; cv.height = h
        cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(cv.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = reject
      img.src = e.target!.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Category taxonomy ──────────────────────────────────────────────────────

type CategoryKey = 'all' | 'cards' | 'drawings' | 'photos' | 'files'

function categoryOf(type: GalleryItemType): Exclude<CategoryKey, 'all'> {
  if (type === 'month-share' || type === 'year-share') return 'cards'
  if (type === 'drawing') return 'drawings'
  if (type === 'photo') return 'photos'
  return 'files'
}

function typeLabel(type: GalleryItemType): string {
  if (type === 'month-share' || type === 'year-share') return 'Progress Card'
  if (type === 'drawing') return 'Drawing'
  if (type === 'photo') return 'Photo'
  return 'Document'
}

const EMPTY_STATES: Record<CategoryKey, { icon: string; heading: string; body: string }> = {
  all:      { icon: '🗂️', heading: 'No gallery items yet',          body: 'Cards, drawings, photos and files you create in XPadite will appear here.' },
  cards:    { icon: '📊', heading: 'No progress cards yet',         body: 'Progress cards generated through XPadite sharing will appear here.' },
  drawings: { icon: '🎨', heading: 'No drawings or mind maps yet',  body: 'Your saved Planner/Journal creations will appear here.' },
  photos:   { icon: '🖼️', heading: 'No photos yet',                 body: 'Photos saved through XPadite will appear here.' },
  files:    { icon: '📄', heading: 'No files yet',                  body: 'Supported files and documents saved through XPadite will appear here.' },
}

// ── Small helpers ────────────────────────────────────────────────────────────

function mimeFromDataUri(uri: string): string {
  return uri.match(/^data:([^;]+);/)?.[1] ?? ''
}

function fileTypeLabel(item: GalleryItem): string {
  const mime = mimeFromDataUri(item.dataUri)
  if (mime.startsWith('image/')) return `Image (${mime.split('/')[1]?.toUpperCase() ?? ''})`
  if (mime === 'application/pdf') return 'PDF Document'
  return typeLabel(item.type)
}

function estimateSizeLabel(uri: string): string {
  const b64 = uri.split(',')[1] ?? ''
  if (!b64) return ''
  const bytes = Math.round(b64.length * 0.75)
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function monthGroupKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
}
function monthGroupLabel(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function fmtFullDateTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtShortDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconChevron()  { return <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg> }
function IconExpander({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}><polyline points="6 9 12 15 18 9"/></svg>
}
function IconShare()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg> }
function IconDownload() { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="20" x2="20" y2="20"/></svg> }
function IconDrive()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8l6 10-4 8H6l-4-8z"/><line x1="2" y1="13" x2="22" y2="13"/></svg> }
function IconTrash()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> }
function IconCheck()    { return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }

// ─── Camera Modal ─────────────────────────────────────────────────────────────

function CameraModal({ onSave, onClose }: { onSave: (uri: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<'starting' | 'live' | 'captured' | 'error'>('starting')
  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setPhase('live')
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Camera unavailable'
          setErrorMsg(msg.includes('Permission') || msg.includes('denied')
            ? 'Camera permission denied. Please allow camera access in your browser settings.'
            : 'Camera not available on this device. Use Import Photo instead.')
          setPhase('error')
        }
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const W = video.videoWidth, H = video.videoHeight
    canvas.width = W; canvas.height = H
    canvas.getContext('2d')!.drawImage(video, 0, 0, W, H)
    const uri = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedUri(uri)
    setPhase('captured')
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function retake() {
    setCapturedUri(null)
    setPhase('starting')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
        setPhase('live')
      })
      .catch(() => setPhase('error'))
  }

  function save() {
    if (capturedUri) { onSave(capturedUri); onClose() }
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#0f172a', border: '0.5px solid rgba(255,255,255,0.12)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm font-semibold text-white">📸 Take Photo</p>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white transition-colors">× Close</button>
        </div>

        <div className="relative bg-black" style={{ minHeight: 280 }}>
          {phase === 'error' ? (
            <div className="flex flex-col items-center justify-center p-8 text-center" style={{ minHeight: 280 }}>
              <p className="text-3xl mb-3">📷</p>
              <p className="text-sm text-gray-300 mb-2">Camera unavailable</p>
              <p className="text-xs text-gray-500 mb-4">{errorMsg}</p>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{ background: '#7c3aed' }}>
                Use Import Photo
              </button>
            </div>
          ) : phase === 'starting' ? (
            <div className="flex items-center justify-center" style={{ minHeight: 280 }}>
              <p className="text-gray-400 text-xs">Starting camera…</p>
            </div>
          ) : phase === 'captured' && capturedUri ? (
            <img src={capturedUri} alt="Captured" className="w-full object-cover" style={{ maxHeight: 320 }}/>
          ) : (
            <video ref={videoRef} className="w-full object-cover" style={{ maxHeight: 320 }} playsInline muted/>
          )}
          <canvas ref={canvasRef} className="hidden"/>
        </div>

        <div className="flex gap-2 p-3">
          {phase === 'live' && (
            <button onClick={capture} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-85" style={{ background: '#7c3aed' }}>
              📸 Capture
            </button>
          )}
          {phase === 'captured' && (
            <>
              <button onClick={retake} className="flex-1 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                🔄 Retake
              </button>
              <button onClick={save} className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-85" style={{ background: '#16a34a' }}>
                ✓ Save to Gallery
              </button>
            </>
          )}
          {(phase === 'starting' || phase === 'error') && (
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85" style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Gallery Modal ────────────────────────────────────────────────────────────

type DisplayItem = GalleryItem & { displayUrl: string }

interface GalleryModalProps { onClose: () => void }

// Lightweight dropdown reused for Type Filter and Sort — no native <select> chrome.
// `triggerWidth` is optional and additive: existing (desktop/tablet) callers
// that don't pass it keep the exact previous auto-sized-to-label behavior.
// Mobile's toolbar passes it so the trigger's OUTER width never changes when
// a longer/shorter option gets selected — only the label inside truncates.
function SimpleDropdown<T extends string>({ value, options, onChange, minWidth = 130, triggerWidth }: {
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
  minWidth?: number
  triggerWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = options.find(o => o.key === value) ?? options[0]

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0, width: triggerWidth }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11.5px] font-medium"
        style={{
          padding: '6px 9px', borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)',
          width: triggerWidth, boxSizing: 'border-box',
        }}
      >
        <span style={triggerWidth ? { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' } : { whiteSpace: 'nowrap' }}>
          {current.label}
        </span>
        <span style={{ flexShrink: 0, color: 'var(--xp-txt3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', display: 'flex' }}><IconChevron /></span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth,
          background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 4, overflow: 'hidden',
        }}>
          {options.map(o => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false) }}
              className="w-full text-left text-[12px] whitespace-nowrap"
              style={{
                padding: '7px 10px', borderRadius: 7,
                color: o.key === value ? '#7c3aed' : 'var(--xp-txt)',
                fontWeight: o.key === value ? 600 : 500,
                background: o.key === value ? 'rgba(124,58,237,0.10)' : 'transparent',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Action-menu dropdown (Gallery mobile toolbar only) — same visual chrome as
// SimpleDropdown above (border/radius/shadow/chevron-rotate/outside-click-to-
// close), but for triggers with a FIXED label (e.g. "View", "Select") whose
// menu items are actions to run rather than a persisted value to reflect back
// onto the trigger. Kept as its own component instead of extending
// SimpleDropdown so nothing here can affect SimpleDropdown's existing
// desktop/tablet dropdowns (All Types / Newest First / By Month·By Type).
function ActionDropdown({ label, items, triggerWidth }: {
  label: string
  items: { key: string; label: string; icon?: string; active?: boolean; onSelect: () => void }[]
  triggerWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0, width: triggerWidth }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap"
        style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', width: triggerWidth, boxSizing: 'border-box' }}
      >
        {label}
        <span style={{ color: 'var(--xp-txt3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', display: 'flex' }}><IconChevron /></span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: 140,
          background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 4, overflow: 'hidden',
        }}>
          {items.map(it => (
            <button
              key={it.key}
              onClick={() => { it.onSelect(); setOpen(false) }}
              className="w-full flex items-center justify-between gap-3 text-left text-[12px] whitespace-nowrap"
              style={{
                padding: '7px 10px', borderRadius: 7,
                color: it.active ? '#7c3aed' : 'var(--xp-txt)',
                fontWeight: it.active ? 600 : 500,
                background: it.active ? 'rgba(124,58,237,0.10)' : 'transparent',
              }}
            >
              <span>{it.icon ? `${it.icon} ` : ''}{it.label}</span>
              {it.active && <span style={{ fontSize: 11 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Asset preview thumbnail — image for photo/card/drawing types, icon tile for documents.
function AssetThumb({ item, aspect = 'video' }: { item: DisplayItem; aspect?: 'video' | 'square' }) {
  const mime = mimeFromDataUri(item.dataUri)
  const isImage = item.type !== 'document' || mime.startsWith('image/')
  if (isImage) {
    return <img src={item.displayUrl || item.dataUri} alt={item.title} className={`w-full object-cover ${aspect === 'video' ? 'aspect-video' : 'aspect-square'}`} />
  }
  return (
    <div className={`w-full flex items-center justify-center ${aspect === 'video' ? 'aspect-video' : 'aspect-square'}`} style={{ background: 'var(--xp-bg)' }}>
      <span style={{ fontSize: 30 }}>📄</span>
    </div>
  )
}

function AssetCard({ item, selectMode, selected, onOpen, onToggleSelect }: {
  item: DisplayItem
  selectMode: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
}) {
  return (
    <div
      onClick={selectMode ? onToggleSelect : onOpen}
      className="relative rounded-xl overflow-hidden cursor-pointer transition-all"
      style={{
        background: 'var(--xp-bg3)',
        border: `1.5px solid ${selected ? '#7c3aed' : 'var(--xp-bdr)'}`,
        boxShadow: selected ? '0 0 0 3px rgba(124,58,237,0.16)' : 'none',
      }}
    >
      <AssetThumb item={item} />
      {selectMode && (
        <div
          className="absolute top-2 left-2 flex items-center justify-center flex-shrink-0"
          style={{
            width: 20, height: 20, borderRadius: '50%',
            background: selected ? '#7c3aed' : 'rgba(0,0,0,0.35)',
            border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.85)',
          }}
        >
          {selected && <IconCheck />}
        </div>
      )}
      <div className="p-2.5">
        <p className="text-[11.5px] font-medium truncate" style={{ color: 'var(--xp-txt)' }}>{item.title}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{typeLabel(item.type)} · {fmtShortDate(item.createdAt)}</p>
      </div>
    </div>
  )
}

function AssetListRow({ item, selectMode, selected, onOpen, onToggleSelect }: {
  item: DisplayItem
  selectMode: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
}) {
  return (
    <div
      onClick={selectMode ? onToggleSelect : onOpen}
      className="flex items-center gap-3 rounded-xl cursor-pointer transition-colors"
      style={{ padding: 8, background: selected ? 'rgba(124,58,237,0.08)' : 'var(--xp-bg3)', border: `1px solid ${selected ? '#7c3aed' : 'var(--xp-bdr)'}` }}
    >
      {selectMode && (
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 18, height: 18, borderRadius: '50%', background: selected ? '#7c3aed' : 'transparent', border: selected ? 'none' : '1.5px solid var(--xp-bdr2)' }}>
          {selected && <IconCheck />}
        </div>
      )}
      <div className="rounded-lg overflow-hidden flex-shrink-0" style={{ width: 48, height: 48 }}>
        <AssetThumb item={item} aspect="square" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--xp-txt)' }}>{item.title}</p>
        <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{typeLabel(item.type)} · {fmtShortDate(item.createdAt)}</p>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
      <span className="text-[11.5px]" style={{ color: 'var(--xp-txt3)' }}>{label}</span>
      <span className="text-[11.5px] font-medium text-right" style={{ color: 'var(--xp-txt)' }}>{value}</span>
    </div>
  )
}

// Shared detail content — used inline in the desktop side panel and inside the mobile/tablet sheet.
function AssetDetail({ item, onShare, onDownload, onExport, onDelete }: {
  item: DisplayItem
  onShare: () => void
  onDownload: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const sizeLabel = estimateSizeLabel(item.dataUri)
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
        <div className="rounded-2xl overflow-hidden mb-4">
          <AssetThumb item={item} />
        </div>
        <h3 className="text-[15px] font-semibold mb-2" style={{ color: 'var(--xp-txt)' }}>{item.title}</h3>
        <span
          className="inline-block text-[10.5px] font-semibold uppercase tracking-wide mb-3"
          style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.10)', borderRadius: 999, padding: '3px 9px', letterSpacing: '0.04em' }}
        >
          {typeLabel(item.type)}
        </span>
        <div>
          <DetailRow label="Created" value={fmtFullDateTime(item.createdAt)} />
          {item.source && <DetailRow label="Source" value={item.source} />}
          <DetailRow label="Type" value={fileTypeLabel(item)} />
          {item.relatedDateLabel && <DetailRow label="Related Date" value={item.relatedDateLabel} />}
          {sizeLabel && <DetailRow label="Size" value={sizeLabel} />}
        </div>
      </div>

      <div className="flex-shrink-0 pt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={onShare} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            <IconShare /> Share
          </button>
          <button onClick={onDownload} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12.5px] font-semibold transition-opacity hover:opacity-80" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}>
            <IconDownload /> Download
          </button>
        </div>
        <button onClick={onExport} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-medium transition-opacity hover:opacity-80" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}>
          <IconDrive /> Export
        </button>
        <button onClick={onDelete} className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-opacity hover:opacity-80" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
          <IconTrash /> Delete
        </button>
      </div>
    </div>
  )
}

export function GalleryModal({ onClose }: GalleryModalProps) {
  const { setToast } = useApp()
  const [items, setItems] = useState<DisplayItem[]>(() =>
    loadGallery().map(i => ({ ...i, displayUrl: i.dataUri }))
  )
  const [uploading, setUploading] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [typeFilter, setTypeFilter] = useState<'all' | GalleryItemType>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [monthOverrides, setMonthOverrides] = useState<Map<string, boolean>>(new Map())
  const [detailItem, setDetailItem] = useState<DisplayItem | null>(null)
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null)
  const [exportItems, setExportItems] = useState<DisplayItem[] | null>(null)
  const [shareItems, setShareItems] = useState<DisplayItem[] | null>(null)
  const [shareAnim, setShareAnim] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  // Mirrors YearShareModal's own mount-in slide-up animation, so the Gallery
  // share panel feels like the same established bottom-sheet, not a new one.
  useEffect(() => {
    // Only the OPEN transition runs here. Closing is driven by closeSharePanel
    // below (a click handler, not an effect) setting shareAnim(false)
    // synchronously before shareItems clears 380ms later — by the time this
    // effect would see shareItems go null, shareAnim is already false, so
    // there's nothing left to reset here.
    if (!shareItems) return
    const raf = requestAnimationFrame(() => setShareAnim(true))
    return () => cancelAnimationFrame(raf)
  }, [shareItems])
  function closeSharePanel() {
    setShareAnim(false)
    setTimeout(() => setShareItems(null), 380)
  }

  useLockBodyScroll()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (detailItem) { setDetailItem(null); return }
      if (cameraOpen) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, detailItem, cameraOpen])

  // Merge Supabase gallery_items into the display list on open.
  useEffect(() => {
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        if (!data.user) return
        const uid = data.user.id
        const rows = await fetchGalleryItems(supabase, uid)
        if (rows.length === 0) return
        const local = loadGallery()
        const localById = new Map(local.map(i => [i.id, i]))
        const resolved = await Promise.all(
          rows.map(async row => {
            const existing = localById.get(row.itemId)
            const displayUrl = existing?.dataUri
              ?? (row.storagePath ? (await getSignedUrl(supabase, row.storagePath)) ?? '' : '')
            if (!displayUrl) return null
            const item: DisplayItem = {
              id: row.itemId,
              type: row.type as GalleryItemType,
              title: row.title,
              createdAt: row.createdAt,
              dataUri: existing?.dataUri ?? displayUrl,
              displayUrl,
              month: row.month ?? undefined,
              year: row.year ?? undefined,
              stats: row.stats ?? undefined,
              source: existing?.source,
              relatedDateLabel: existing?.relatedDateLabel,
            }
            return item
          })
        )
        const valid = resolved.filter((i): i is DisplayItem => i !== null)
        if (valid.length > 0) setItems(valid)
      } catch (err) {
        console.error('[Gallery] Supabase load error:', err)
      }
    })()
  }, [])

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith('image/')
        const uri = isImage ? await resizeImage(file, 400, 300) : await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(file)
        })
        addGalleryItem({
          id: (isImage ? 'ph-' : 'doc-') + Date.now() + '-' + Math.random().toString(36).slice(2),
          type: isImage ? 'photo' : 'document',
          createdAt: Date.now(),
          title: file.name.replace(/\.[^.]+$/, isImage ? '' : ''),
          dataUri: uri,
          source: 'Upload',
        })
      }
      setItems(loadGallery().map(i => ({ ...i, displayUrl: i.dataUri })))
    } finally { setUploading(false) }
  }, [])

  function handleCameraCapture(uri: string) {
    addGalleryItem({ id: 'cam-' + Date.now(), type: 'photo', createdAt: Date.now(), title: `Photo ${new Date().toLocaleDateString()}`, dataUri: uri, source: 'Camera' })
    setItems(loadGallery().map(i => ({ ...i, displayUrl: i.dataUri })))
  }

  function deleteItem(id: string) {
    const updated = items.filter(i => i.id !== id)
    saveGallery(updated.map(i => ({
      id: i.id, type: i.type, title: i.title, createdAt: i.createdAt, dataUri: i.dataUri,
      month: i.month, year: i.year, stats: i.stats, source: i.source, relatedDateLabel: i.relatedDateLabel,
    })))
    setItems(updated)
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        if (data.user) await supabaseDeleteGalleryItem(supabase, data.user.id, id)
      } catch (err) {
        console.error('[Gallery] Supabase delete error:', err)
      }
    })()
  }

  // ── Derived views — all read from the same `items` array; nothing is duplicated ──
  // The old `category` (tab) + `typeFilter` (dropdown) + `search` pipeline had
  // three filtering stages that overlapped almost entirely — category and
  // typeFilter both selected the same asset-type dimension, just through two
  // separate controls. Now that the redundant tabs and the search box are
  // gone, `typeFilter` alone drives filtering, straight off `items`.

  const typeFilteredItems = useMemo(
    () => typeFilter === 'all' ? items : items.filter(i => i.type === typeFilter),
    [items, typeFilter],
  )
  const sorted = useMemo(
    () => [...typeFilteredItems].sort((a, b) => sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt),
    [typeFilteredItems, sort],
  )

  const monthGroups = useMemo(() => {
    const map = new Map<string, DisplayItem[]>()
    sorted.forEach(i => {
      const k = monthGroupKey(i.createdAt)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(i)
    })
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, groupItems]) => ({ key, label: monthGroupLabel(groupItems[0].createdAt), items: groupItems }))
  }, [sorted])

  function isMonthExpanded(key: string, idx: number): boolean {
    if (monthOverrides.has(key)) return monthOverrides.get(key)!
    return idx === 0
  }
  function toggleMonth(key: string, idx: number) {
    setMonthOverrides(prev => { const next = new Map(prev); next.set(key, !isMonthExpanded(key, idx)); return next })
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()) }
  // "Select All" (mobile Select ▾ menu) — selects every item in the CURRENT
  // filtered/sorted Gallery view (`sorted` already reflects typeFilter), never
  // the full unfiltered item list.
  function handleSelectAll() {
    setSelectMode(true)
    setSelectedIds(new Set(sorted.map(i => i.id)))
  }

  // ── Download: fetch-as-blob + proper filename/extension ──────────────────────
  // The old implementation set `a.href` directly to the item's URL. That works
  // for a same-origin data: URI, but Gallery items backed by Supabase Storage
  // use a cross-origin signed URL — browsers ignore the `download` attribute
  // for cross-origin resources, so instead of downloading it NAVIGATED (opened
  // the image/a new tab), exactly the bug reported. Fetching the bytes as a
  // Blob and downloading from an object URL (via the existing
  // triggerDownloadFromFile, already used by Year/Month share) works
  // regardless of origin and never opens a tab.
  function sanitizeFilenamePart(s: string): string {
    return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'File'
  }
  function fmtFileDate(ts: number): string {
    const d = new Date(ts)
    return `${d.toLocaleDateString('en-US', { month: 'short' })}-${d.getDate()}-${d.getFullYear()}`
  }
  function loadImageEl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  }
  // Converts an arbitrary image blob (e.g. a canvas-generated PNG Progress
  // Card, or a drawing) to a flattened JPEG File, per the requirement that
  // image-based Gallery assets download as .jpg. Non-image documents skip
  // this entirely and keep their original format — see downloadOne below.
  async function blobToJpegFile(blob: Blob, filename: string): Promise<File> {
    const url = URL.createObjectURL(blob)
    try {
      const img = await loadImageEl(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || 1
      canvas.height = img.naturalHeight || 1
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff' // JPEG has no alpha channel — flatten onto white
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      const jpegBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
      })
      return new File([jpegBlob], filename, { type: 'image/jpeg' })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  async function itemToDownloadFile(item: DisplayItem): Promise<File> {
    const uri = item.displayUrl || item.dataUri
    const res = await fetch(uri)
    const blob = await res.blob()
    const namePart = sanitizeFilenamePart(item.title || typeLabel(item.type))
    const dateLabel = fmtFileDate(item.createdAt)
    const isDocument = item.type === 'document' && !blob.type.startsWith('image/')
    if (isDocument) {
      const ext = blob.type === 'application/pdf' ? 'pdf' : (item.title.match(/\.(\w+)$/)?.[1] ?? 'file')
      return new File([blob], `XPadite-${namePart}-${dateLabel}.${ext}`, { type: blob.type })
    }
    return blobToJpegFile(blob, `XPadite-${namePart}-${dateLabel}.jpg`)
  }
  // Used only for Share/Email's *first* attempt (navigator.share with files):
  // skips the JPEG canvas conversion itemToDownloadFile does, so there's as
  // little async work as possible between the click and the navigator.share()
  // call. Some browsers tie Web Share's file-sharing permission to the
  // original click's "user activation," which can expire during an
  // image-decode-and-recompress round trip — fetching the original bytes
  // as-is keeps that window as short as it can be. If share isn't available
  // and this falls back to a download instead, that fallback intentionally
  // uses itemToDownloadFile (below) so the actual saved file still gets the
  // guaranteed .jpg treatment the dedicated Download button always has.
  async function itemToRawFile(item: DisplayItem): Promise<File> {
    const uri = item.displayUrl || item.dataUri
    const res = await fetch(uri)
    const blob = await res.blob()
    const namePart = sanitizeFilenamePart(item.title || typeLabel(item.type))
    const dateLabel = fmtFileDate(item.createdAt)
    const ext = blob.type === 'application/pdf' ? 'pdf' : blob.type.split('/')[1]?.split('+')[0] || 'jpg'
    return new File([blob], `XPadite-${namePart}-${dateLabel}.${ext}`, { type: blob.type || 'image/jpeg' })
  }
  async function downloadOne(item: DisplayItem) {
    try {
      triggerDownloadFromFile(await itemToDownloadFile(item))
    } catch {
      setToast('Download failed — please try again')
    }
  }
  function handleDownload(item: DisplayItem) { void downloadOne(item) }
  // Multiple selected items: download each in turn (never multiple tabs) with
  // a short stagger — most browsers block/prompt when several downloads fire
  // in the same tick, so spacing them out keeps this "clean" per spec.
  async function handleDownloadMany(list: DisplayItem[]) {
    for (const item of list) {
      await downloadOne(item)
      await new Promise(r => setTimeout(r, 250))
    }
  }

  // ── Delete: confirmation required, never immediate ────────────────────────────
  function requestDelete(ids: string[]) {
    if (ids.length === 0) return
    setDeleteConfirmIds(ids)
  }
  function confirmDelete() {
    const ids = deleteConfirmIds ?? []
    ids.forEach(id => deleteItem(id))
    if (detailItem && ids.includes(detailItem.id)) setDetailItem(null)
    if (selectMode) exitSelectMode()
    setDeleteConfirmIds(null)
  }
  function handleDeleteOne(id: string) { requestDelete([id]) }
  function handleDeleteSelected() { requestDelete([...selectedIds]) }

  // ── Share: the actual JPG → File → native OS share bridge ─────────────────────
  // Reuses XPadite's established platform list/badges (PLATFORMS/PlatformBadge,
  // also used by Year/Month Progress sharing) for the picker UI, but Gallery
  // runs its OWN share execution rather than delegating to executeXpaditeShare.
  // That shared function gates its file-share attempt behind isMobileOrPWA(),
  // a user-agent heuristic — on a browser where that heuristic says "no" but
  // navigator.share/canShare genuinely say "yes" (or vice versa), delegating
  // to it meant Gallery would skip the real file handoff and fall straight to
  // "download + open the platform's bare website," which only ever *opens*
  // the destination without ever handing it the image — exactly the "opens
  // WhatsApp/Instagram but no JPG arrives" bug. Feature-detecting directly
  // (navigator.share + navigator.canShare({files})) is the correct check per
  // the Web Share API itself; it doesn't need a device-type guess on top of it.
  function handleShare(items: DisplayItem[]) {
    if (items.length === 0) return
    setShareItems(items)
  }
  async function executeGalleryShare(items: DisplayItem[], platformId: string) {
    if (actionBusy) return
    setActionBusy(true)
    try {
      // Raw (unconverted) fetch first — see itemToRawFile's comment for why
      // minimizing delay before navigator.share() matters.
      const rawFiles = await Promise.all(items.map(i => itemToRawFile(i)))
      const canShareFiles = typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare?.({ files: rawFiles })
      if (canShareFiles) {
        try {
          await navigator.share({ files: rawFiles, title: 'XPadite', text: 'Shared from XPadite' })
          closeSharePanel()
          return
        } catch (err) {
          // A user-dismissed share sheet is not an error — leave the panel
          // open and say nothing alarming; only a genuine failure surfaces a
          // message.
          if ((err as Error)?.name === 'AbortError') return
          setToast('Unable to share the file to that app — try Download instead')
          return
        }
      }
      // File sharing isn't supported here at all. Per the "no fake success"
      // requirement, do NOT open the destination's bare website — that would
      // only launch WhatsApp/Instagram/etc. with no image attached, which
      // looks like it worked but didn't. Leave the panel open (Download is
      // already one of its own tiles) and say so plainly instead.
      const dest = PLATFORM_DESTINATIONS[platformId]
      setToast(`Direct file sharing isn't available in this browser${dest ? ` for ${dest.name}` : ''} — use Download below instead`)
    } catch {
      setToast('Unable to share — please try again')
    } finally {
      setActionBusy(false)
    }
  }
  async function handleShareDownload(items: DisplayItem[]) {
    await handleDownloadMany(items)
    closeSharePanel()
  }

  // ── Export: opens a destination-picker modal (Email / Google Drive) rather
  // than acting immediately — Drive keeps its existing "not connected yet"
  // messaging (unchanged behavior, just reached through the modal now); Email
  // never claims to have sent anything — it hands the file(s) to the OS share
  // sheet (so the user's own Mail app receives them as real attachments,
  // recipient/subject/send all stay in the user's control) and falls back to
  // downloading + opening a blank mailto draft where Web Share isn't available.
  function handleExportRequest(items: DisplayItem[]) {
    if (items.length === 0) return
    setExportItems(items)
  }
  async function handleExportEmail(items: DisplayItem[]) {
    if (actionBusy) return
    setActionBusy(true)
    try {
      // Raw (unconverted) fetch first, same reasoning as itemToRawFile above —
      // the fewer milliseconds of async work between this click and
      // navigator.share(), the less likely a stricter browser is to have
      // already expired the user-activation window Web Share needs.
      const rawFiles = await Promise.all(items.map(i => itemToRawFile(i)))
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: rawFiles })) {
        try {
          await navigator.share({ files: rawFiles, title: 'XPadite Gallery' })
          setExportItems(null)
          return
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return
        }
      }
      // Fallback: no web API can attach a file to a mailto: draft — that has
      // never been possible in any browser. Download with the guaranteed
      // .jpg naming/format and open a blank draft as the closest honest
      // substitute, rather than pretending the attachment happened.
      const files = await Promise.all(items.map(i => itemToDownloadFile(i)))
      files.forEach(triggerDownloadFromFile)
      const subject = encodeURIComponent('XPadite Gallery export')
      const body = encodeURIComponent(
        `${files.length > 1 ? 'These files have' : 'This file has'} been downloaded — attach ${files.length > 1 ? 'them' : 'it'} from your Downloads before sending.`,
      )
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
      setToast('Downloaded — attach the file(s) in your email draft')
      setExportItems(null)
    } catch {
      setToast('Unable to prepare email export')
    } finally {
      setActionBusy(false)
    }
  }
  function handleExportDrive() {
    setToast('Connect Google Drive from Sync to enable exporting')
    setExportItems(null)
  }

  // Empty-state copy is keyed by the same asset-type dimension as before,
  // just read from the surviving `typeFilter` control instead of the removed
  // category tabs — reuses the existing EMPTY_STATES/categoryOf, no new data.
  const empty = typeFilter === 'all' ? EMPTY_STATES.all : EMPTY_STATES[categoryOf(typeFilter)]
  const showEmpty = sorted.length === 0

  const gridClass = viewMode === 'grid'
    ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3'
    : 'flex flex-col gap-2'

  function renderItems(list: DisplayItem[]) {
    return (
      <div className={gridClass}>
        {list.map(item => viewMode === 'grid' ? (
          <AssetCard key={item.id} item={item} selectMode={selectMode} selected={selectedIds.has(item.id)}
            onOpen={() => setDetailItem(item)} onToggleSelect={() => toggleSelect(item.id)} />
        ) : (
          <AssetListRow key={item.id} item={item} selectMode={selectMode} selected={selectedIds.has(item.id)}
            onOpen={() => setDetailItem(item)} onToggleSelect={() => toggleSelect(item.id)} />
        ))}
      </div>
    )
  }

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <div
          className="w-full sm:max-w-[1120px] h-full sm:h-[88vh] sm:max-h-[88vh] rounded-none sm:rounded-2xl max-sm:border-0! overflow-hidden flex flex-col"
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 px-5 py-4 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 55%, #6d28d9 100%)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.18)', border: '0.5px solid rgba(255,255,255,0.28)' }}>
                <span style={{ fontSize: 18 }}>🖼️</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold" style={{ color: '#ffffff' }}>Gallery</h2>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.72)' }}>Your cards, drawings, photos and files — all in one place.</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
              style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}
            >
              ✕
            </button>
          </div>

          {/* Control bar (desktop/tablet) — hidden below the sm breakpoint
              where the mobile-only layout (below) takes over. Standardized
              to the same controls/terminology as mobile: All Types, Newest/
              Oldest (no "First"), a View ▾ dropdown (replacing the old Grid/
              List segmented toggle), and a Select ▾ dropdown (replacing the
              old plain Select button) offering Select/Select All. The old
              By Month/By Type grouping toggle is removed entirely — Gallery
              content is always grouped by month (with collapse/expand, which
              is untouched); that segmented control was a second, redundant
              way to slice the same data "All Types" already filters. */}
          <div className="hidden sm:flex flex-wrap items-center gap-2 px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            <SimpleDropdown
              value={typeFilter}
              onChange={setTypeFilter}
              minWidth={140}
              options={[
                { key: 'all', label: 'All Types' },
                { key: 'month-share', label: 'Progress Card' },
                { key: 'drawing', label: 'Drawing' },
                { key: 'photo', label: 'Photo' },
                { key: 'document', label: 'Document' },
              ]}
            />
            <SimpleDropdown
              value={sort}
              onChange={setSort}
              minWidth={100}
              options={[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }]}
            />
            <ActionDropdown
              label="View"
              items={[
                { key: 'grid', label: 'Grid', icon: '▦', active: viewMode === 'grid', onSelect: () => setViewMode('grid') },
                { key: 'list', label: 'List', icon: '☰', active: viewMode === 'list', onSelect: () => setViewMode('list') },
              ]}
            />

            <div className="ml-auto">
              {selectMode ? (
                <button
                  onClick={exitSelectMode}
                  className="flex items-center justify-center text-[11.5px] font-semibold whitespace-nowrap"
                  style={{ padding: '6px 9px', borderRadius: 9, background: '#7c3aed', color: '#fff', border: 'none', width: SELECT_CANCEL_WIDTH, boxSizing: 'border-box' }}
                >
                  Cancel
                </button>
              ) : (
                <ActionDropdown
                  label="Select"
                  triggerWidth={SELECT_CANCEL_WIDTH}
                  items={[
                    { key: 'select', label: 'Select', onSelect: () => setSelectMode(true) },
                    { key: 'select-all', label: 'Select All', onSelect: handleSelectAll },
                  ]}
                />
              )}
            </div>

            {typeFilter === 'photo' && (
              <>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="text-[11.5px] font-medium whitespace-nowrap disabled:opacity-50"
                  style={{ padding: '7px 12px', borderRadius: 9, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
                  📁 {uploading ? 'Uploading…' : 'Import'}
                </button>
                <button onClick={() => setCameraOpen(true)}
                  className="text-[11.5px] font-medium whitespace-nowrap"
                  style={{ padding: '7px 12px', borderRadius: 9, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
                  📸 Camera
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { handleFileUpload(e.target.files); e.target.value = '' }} />
              </>
            )}
          </div>

          {/* Control bar (MOBILE ONLY) — final structure, ONE row:
              [All Types ▾] [Newest ▾] [View ▾] [Select ▾], Select pinned to
              the far right via marginLeft:auto. The By Month/By Type
              grouping toggle is removed entirely (all 3 devices now — see
              the desktop block above), so this row's only job is these four
              controls. The photo-only Import/Camera buttons fold into the
              same row after Select (flex-wrap only kicks in for that rarer,
              filtered case — the default 4-control row always fits on one
              line). typeFilter/sort use `triggerWidth` (mobile-only — the
              separate desktop instances above don't pass it) so the OUTER
              button size is fixed regardless of which option is selected;
              only a GENUINELY too-long label (e.g. "Progress Card") would
              truncate — "Newest"/"Oldest" get a wide-enough allocation to
              always render in full, never abbreviated. */}
          <div className="flex sm:hidden flex-wrap items-center gap-1 px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            <SimpleDropdown
              value={typeFilter}
              onChange={setTypeFilter}
              minWidth={140}
              triggerWidth={118}
              options={[
                { key: 'all', label: 'All Types' },
                { key: 'month-share', label: 'Progress Card' },
                { key: 'drawing', label: 'Drawing' },
                { key: 'photo', label: 'Photo' },
                { key: 'document', label: 'Document' },
              ]}
            />
            <SimpleDropdown
              value={sort}
              onChange={setSort}
              minWidth={100}
              triggerWidth={78}
              options={[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }]}
            />
            <ActionDropdown
              label="View"
              items={[
                { key: 'grid', label: 'Grid', icon: '▦', active: viewMode === 'grid', onSelect: () => setViewMode('grid') },
                { key: 'list', label: 'List', icon: '☰', active: viewMode === 'list', onSelect: () => setViewMode('list') },
              ]}
            />

            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {selectMode ? (
                <button
                  onClick={exitSelectMode}
                  className="flex items-center justify-center text-[11.5px] font-semibold whitespace-nowrap"
                  style={{ padding: '6px 9px', borderRadius: 9, background: '#7c3aed', color: '#fff', border: 'none', width: SELECT_CANCEL_WIDTH, boxSizing: 'border-box' }}
                >
                  Cancel
                </button>
              ) : (
                <ActionDropdown
                  label="Select"
                  triggerWidth={SELECT_CANCEL_WIDTH}
                  items={[
                    { key: 'select', label: 'Select', onSelect: () => setSelectMode(true) },
                    { key: 'select-all', label: 'Select All', onSelect: handleSelectAll },
                  ]}
                />
              )}
            </div>

            {typeFilter === 'photo' && (
              <>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="text-[11.5px] font-medium whitespace-nowrap disabled:opacity-50"
                  style={{ padding: '7px 12px', borderRadius: 9, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
                  📁 {uploading ? 'Uploading…' : 'Import'}
                </button>
                <button onClick={() => setCameraOpen(true)}
                  className="text-[11.5px] font-medium whitespace-nowrap"
                  style={{ padding: '7px 12px', borderRadius: 9, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
                  📸 Camera
                </button>
              </>
            )}
          </div>

          {/* Contextual selection action bar (desktop/tablet) — unchanged. */}
          {selectMode && selectedIds.size > 0 && (
            <div className="hidden sm:flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ background: 'rgba(124,58,237,0.06)', borderBottom: '0.5px solid var(--xp-bdr)' }}>
              <span className="text-[11.5px] font-semibold" style={{ color: '#7c3aed' }}>{selectedIds.size} selected</span>
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <button onClick={() => handleShare(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconShare /> Share</button>
                <button onClick={() => handleDownloadMany(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDownload /> Download</button>
                <button onClick={() => handleExportRequest(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDrive /> Export</button>
                <button onClick={handleDeleteSelected} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'rgba(220,38,38,0.10)', color: '#dc2626' }}><IconTrash /> Delete</button>
              </div>
            </div>
          )}

          {/* Contextual selection action bar (MOBILE ONLY) — forced to a
              single non-wrapping row regardless of selection count: the count
              label is intrinsically-sized (no fixed width, so "999 selected"
              costs only the space its digits need), the button group never
              wraps (flex-nowrap), and padding/gaps are tightened just enough
              for Share+Download+Export+Delete to fit alongside it without
              scrolling on a normal phone width. Vertical padding is reduced
              too, since a one-row bar no longer needs the extra height that
              was only there to accommodate a wrapped second row. */}
          {selectMode && selectedIds.size > 0 && (
            <div className="flex sm:hidden items-center gap-1.5 px-3 py-1.5 flex-shrink-0" style={{ background: 'rgba(124,58,237,0.06)', borderBottom: '0.5px solid var(--xp-bdr)' }}>
              <span className="text-[11px] font-semibold flex-shrink-0" style={{ color: '#7c3aed' }}>{selectedIds.size} selected</span>
              <div className="flex items-center gap-1 flex-nowrap ml-auto" style={{ minWidth: 0 }}>
                <button onClick={() => handleShare(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0" style={{ padding: '4px 7px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconShare /> Share</button>
                <button onClick={() => handleDownloadMany(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0" style={{ padding: '4px 7px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDownload /> Download</button>
                <button onClick={() => handleExportRequest(items.filter(i => selectedIds.has(i.id)))} className="flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0" style={{ padding: '4px 7px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDrive /> Export</button>
                <button onClick={handleDeleteSelected} className="flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0" style={{ padding: '4px 7px', borderRadius: 7, background: 'rgba(220,38,38,0.10)', color: '#dc2626' }}><IconTrash /> Delete</button>
              </div>
            </div>
          )}

          {/* Body: grid + (desktop) side panel */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ overscrollBehavior: 'contain' }}>
              {showEmpty ? (
                <div className="flex flex-col items-center justify-center text-center py-16">
                  <div className="flex items-center justify-center mb-3" style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)', fontSize: 22 }}>
                    {empty.icon}
                  </div>
                  <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--xp-txt)' }}>{empty.heading}</p>
                  <p className="text-[12px] max-w-[280px] leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>{empty.body}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {monthGroups.map((group, idx) => {
                    const expanded = isMonthExpanded(group.key, idx)
                    return (
                      <div key={group.key} className="mb-3">
                        <button onClick={() => toggleMonth(group.key, idx)} className="w-full flex items-center gap-2 mb-2.5 text-left">
                          <span style={{ color: 'var(--xp-txt2)' }}><IconExpander open={expanded} /></span>
                          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{group.label}</h3>
                          <span className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>{group.items.length} items</span>
                        </button>
                        {expanded && renderItems(group.items)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Desktop side panel */}
            {detailItem && (
              <div className="hidden lg:flex flex-col flex-shrink-0" style={{ width: 340, borderLeft: '0.5px solid var(--xp-bdr)', padding: 16 }}>
                <div className="flex items-center justify-end mb-1">
                  <button onClick={() => setDetailItem(null)} aria-label="Close preview" className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}>✕</button>
                </div>
                <AssetDetail
                  item={detailItem}
                  onShare={() => handleShare([detailItem])}
                  onDownload={() => handleDownload(detailItem)}
                  onExport={() => handleExportRequest([detailItem])}
                  onDelete={() => handleDeleteOne(detailItem.id)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tablet/mobile detail sheet */}
      {detailItem && (
        <div className="lg:hidden fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setDetailItem(null)}>
          <div className="w-full sm:max-w-[420px] h-[86%] sm:h-auto sm:max-h-[86vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
              <span className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Details</span>
              <button onClick={() => setDetailItem(null)} aria-label="Close" className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}>✕</button>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <AssetDetail
                item={detailItem}
                onShare={() => handleShare([detailItem])}
                onDownload={() => handleDownload(detailItem)}
                onExport={() => handleExportRequest([detailItem])}
                onDelete={() => handleDeleteOne(detailItem.id)}
              />
            </div>
          </div>
        </div>
      )}

      {cameraOpen && <CameraModal onSave={handleCameraCapture} onClose={() => setCameraOpen(false)} />}

      {/* Delete confirmation — never deletes immediately on click anymore. */}
      {deleteConfirmIds && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setDeleteConfirmIds(null)}>
          <div className="w-full max-w-[360px] rounded-2xl p-5" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }} onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
              <IconTrash />
            </div>
            <p className="text-sm font-semibold text-center mb-1.5" style={{ color: 'var(--xp-txt)' }}>
              {deleteConfirmIds.length === 1 ? 'Delete selected item?' : `Delete ${deleteConfirmIds.length} selected items?`}
            </p>
            <p className="text-xs text-center mb-5" style={{ color: 'var(--xp-txt3)' }}>
              {deleteConfirmIds.length === 1 ? 'This item' : 'These items'} will be permanently deleted and cannot be recovered.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmIds(null)} className="flex-1 py-2.5 rounded-xl text-xs font-medium transition-opacity hover:opacity-80" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}>
                Cancel
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export destination picker — Email hands the file(s) to the OS share
          sheet (or falls back to download + a blank mailto draft) so nothing
          is ever silently "sent"; Google Drive keeps its pre-existing
          not-yet-connected messaging, just reached through this modal now
          instead of firing straight off a bare Export button. */}
      {exportItems && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setExportItems(null)}>
          <div className="w-full max-w-[380px] rounded-2xl overflow-hidden" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>Export {exportItems.length > 1 ? `${exportItems.length} items` : 'item'}</h2>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.72)' }}>Choose a destination</p>
              </div>
              <button onClick={() => setExportItems(null)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-75" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}>✕</button>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <button disabled={actionBusy} onClick={() => handleExportEmail(exportItems)} className="flex items-center gap-3 p-3 rounded-xl text-left transition-opacity hover:opacity-85 disabled:opacity-50" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.12)', fontSize: 16 }}>✉️</span>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Email</p>
                  <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>Share via your Mail app</p>
                </div>
              </button>
              <button disabled={actionBusy} onClick={handleExportDrive} className="flex items-center gap-3 p-3 rounded-xl text-left transition-opacity hover:opacity-85 disabled:opacity-50" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}><IconDrive /></span>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Google Drive</p>
                  <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>Export to your connected Drive</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share panel — reuses XPadite's established platform picker UI (the
          same PLATFORMS list and PlatformBadge rendering already used by
          Year/Month Progress sharing) and the same always-bottom-sheet
          positioning/slide-up entrance as YearShareModal, but runs its own
          share execution (executeGalleryShare) rather than delegating to
          executeXpaditeShare — see that function's comment for why. */}
      {shareItems && (
        <div
          className="fixed inset-0 z-[95]"
          style={{ background: shareAnim ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)', transition: 'background 0.25s ease' }}
          onClick={closeSharePanel}
        >
          <div
            className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
            style={{
              background: '#111114', border: '0.5px solid rgba(255,255,255,0.10)',
              transform: shareAnim ? 'translateY(0)' : 'translateY(100%)',
              opacity: shareAnim ? 1 : 0,
              transition: 'transform 0.38s cubic-bezier(0.34,1.4,0.64,1), opacity 0.22s ease',
              maxWidth: 480, margin: '0 auto', paddingBottom: 'env(safe-area-inset-bottom, 8px)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            </div>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div>
                <p className="text-sm font-semibold text-white">
                  Share {shareItems.length > 1 ? `${shareItems.length} items` : (shareItems[0].title || 'item')}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Choose where to share</p>
              </div>
              <button onClick={closeSharePanel} className="text-xs transition-colors" style={{ color: 'rgba(255,255,255,0.4)' }}>✕</button>
            </div>
            <div className="grid grid-cols-4 gap-3 px-4 py-4">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => executeGalleryShare(shareItems, p.id)}
                  disabled={actionBusy}
                  className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}
                >
                  <PlatformBadge p={p} />
                  <div className="text-center" style={{ lineHeight: 1.2 }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</p>
                    {p.sublabel ? <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{p.sublabel}</p> : null}
                  </div>
                </button>
              ))}
              <button
                onClick={() => handleShareDownload(shareItems)}
                disabled={actionBusy}
                className="flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <IconDownload />
                </div>
                <div className="text-center" style={{ lineHeight: 1.2 }}>
                  <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Download</p>
                </div>
              </button>
            </div>
            {actionBusy && (
              <p className="text-center text-[10px] pb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Preparing…</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
