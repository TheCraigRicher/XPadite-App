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

const GALLERY_KEY = 'xp9g'

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

const CATEGORY_LABELS: Record<Exclude<CategoryKey, 'all'>, string> = {
  cards: 'Progress Cards',
  drawings: 'Drawings & Mind Maps',
  photos: 'Photos',
  files: 'Files',
}

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

function IconAll()      { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> }
function IconCards()    { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20V8"/></svg> }
function IconPalette()  { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22a9 9 0 1 1 0-18c4 0 8 2 8 6.5 0 2-1.5 3.5-3.5 3.5H15a1.5 1.5 0 0 0-1 2.6l.2.2a1.5 1.5 0 0 1-1 2.6"/><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6.8" r="1.2" fill="currentColor" stroke="none"/></svg> }
function IconPhoto()    { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5.5-5.5a2 2 0 0 0-2.8 0L4 19"/></svg> }
function IconFile()     { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg> }
function IconSearch()   { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg> }
function IconChevron()  { return <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg> }
function IconGridView() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> }
function IconListView() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg> }
function IconExpander({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}><polyline points="6 9 12 15 18 9"/></svg>
}
function IconShare()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg> }
function IconDownload() { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="20" x2="20" y2="20"/></svg> }
function IconDrive()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8l6 10-4 8H6l-4-8z"/><line x1="2" y1="13" x2="22" y2="13"/></svg> }
function IconTrash()    { return <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> }
function IconCheck()    { return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }

const CATEGORY_ICONS: Record<CategoryKey, () => React.JSX.Element> = {
  all: IconAll, cards: IconCards, drawings: IconPalette, photos: IconPhoto, files: IconFile,
}

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
function SimpleDropdown<T extends string>({ value, options, onChange, minWidth = 130 }: {
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
  minWidth?: number
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
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap"
        style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}
      >
        {current.label}
        <span style={{ color: 'var(--xp-txt3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', display: 'flex' }}><IconChevron /></span>
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
function AssetDetail({ item, onShare, onDownload, onExportDrive, onDelete }: {
  item: DisplayItem
  onShare: () => void
  onDownload: () => void
  onExportDrive: () => void
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
        <button onClick={onExportDrive} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-medium transition-opacity hover:opacity-80" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}>
          <IconDrive /> Export to Google Drive
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

  const [category, setCategory] = useState<CategoryKey>('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | GalleryItemType>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [orgMode, setOrgMode] = useState<'month' | 'type'>('month')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [monthOverrides, setMonthOverrides] = useState<Map<string, boolean>>(new Map())
  const [detailItem, setDetailItem] = useState<DisplayItem | null>(null)

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

  const counts = useMemo(() => {
    const c: Record<CategoryKey, number> = { all: items.length, cards: 0, drawings: 0, photos: 0, files: 0 }
    items.forEach(i => { c[categoryOf(i.type)]++ })
    return c
  }, [items])

  const categoryFiltered = useMemo(
    () => category === 'all' ? items : items.filter(i => categoryOf(i.type) === category),
    [items, category],
  )
  const typeFilteredItems = useMemo(
    () => typeFilter === 'all' ? categoryFiltered : categoryFiltered.filter(i => i.type === typeFilter),
    [categoryFiltered, typeFilter],
  )
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return typeFilteredItems
    return typeFilteredItems.filter(i => i.title.toLowerCase().includes(q))
  }, [typeFilteredItems, search])
  const sorted = useMemo(
    () => [...searched].sort((a, b) => sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt),
    [searched, sort],
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

  const typeGroups = useMemo(() => {
    const order: Exclude<CategoryKey, 'all'>[] = ['cards', 'drawings', 'photos', 'files']
    return order
      .map(cat => ({ key: cat, label: CATEGORY_LABELS[cat], items: sorted.filter(i => categoryOf(i.type) === cat) }))
      .filter(g => g.items.length > 0)
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

  function handleShare(item: DisplayItem) {
    const uri = item.displayUrl || item.dataUri
    if (typeof navigator !== 'undefined' && navigator.share) {
      fetch(uri).then(r => r.blob()).then(blob => {
        const file = new File([blob], item.title || 'xpadite-item', { type: blob.type || 'image/jpeg' })
        navigator.share({ files: [file], title: item.title }).catch(() => {})
      }).catch(() => setToast('Unable to share this item'))
    } else {
      setToast("Sharing isn't supported on this device")
    }
  }
  function handleDownload(item: DisplayItem) {
    const a = document.createElement('a')
    a.href = item.displayUrl || item.dataUri
    a.download = item.title || 'xpadite-item'
    a.click()
  }
  function handleExportDrive() {
    setToast('Connect Google Drive from Sync to enable exporting')
  }
  function handleDeleteOne(id: string) {
    deleteItem(id)
    if (detailItem?.id === id) setDetailItem(null)
  }
  function handleDeleteSelected() {
    const ids = [...selectedIds]
    ids.forEach(id => deleteItem(id))
    if (detailItem && ids.includes(detailItem.id)) setDetailItem(null)
    exitSelectMode()
  }

  const empty = EMPTY_STATES[category]
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

          {/* Category tabs */}
          <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
            {(['all', 'cards', 'drawings', 'photos', 'files'] as CategoryKey[]).map(cat => {
              const Icon = CATEGORY_ICONS[cat]
              const active = category === cat
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className="flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 transition-colors"
                  style={{
                    padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: active ? 700 : 500,
                    background: active ? '#7c3aed' : 'var(--xp-bg3)',
                    color: active ? '#ffffff' : 'var(--xp-txt2)',
                  }}
                >
                  <Icon />
                  {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                  <span
                    className="text-[10px] font-bold"
                    style={{
                      padding: '1px 6px', borderRadius: 999,
                      background: active ? 'rgba(255,255,255,0.22)' : 'rgba(124,58,237,0.14)',
                      color: active ? '#ffffff' : '#7c3aed',
                    }}
                  >
                    {counts[cat]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Control bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            <div className="flex items-center gap-1.5 flex-1 min-w-[140px]" style={{ padding: '6px 10px', borderRadius: 9, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
              <span style={{ color: 'var(--xp-txt3)' }}><IconSearch /></span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search your gallery…"
                className="flex-1 min-w-0 text-[12px] bg-transparent outline-none"
                style={{ color: 'var(--xp-txt)' }}
              />
            </div>

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
              minWidth={120}
              options={[{ key: 'newest', label: 'Newest First' }, { key: 'oldest', label: 'Oldest First' }]}
            />

            {/* Organization mode */}
            <div className="flex items-center gap-0.5" style={{ padding: 3, borderRadius: 9, background: 'var(--xp-bg3)' }}>
              {(['month', 'type'] as const).map(m => (
                <button key={m} onClick={() => setOrgMode(m)}
                  className="text-[11px] font-medium whitespace-nowrap"
                  style={{ padding: '5px 10px', borderRadius: 7, background: orgMode === m ? '#7c3aed' : 'transparent', color: orgMode === m ? '#fff' : 'var(--xp-txt2)' }}>
                  By {m === 'month' ? 'Month' : 'Type'}
                </button>
              ))}
            </div>

            {/* View mode */}
            <div className="flex items-center gap-0.5" style={{ padding: 3, borderRadius: 9, background: 'var(--xp-bg3)' }}>
              <button onClick={() => setViewMode('grid')} aria-label="Grid view" style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewMode === 'grid' ? '#7c3aed' : 'transparent', color: viewMode === 'grid' ? '#fff' : 'var(--xp-txt2)' }}><IconGridView /></button>
              <button onClick={() => setViewMode('list')} aria-label="List view" style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewMode === 'list' ? '#7c3aed' : 'transparent', color: viewMode === 'list' ? '#fff' : 'var(--xp-txt2)' }}><IconListView /></button>
            </div>

            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className="text-[11.5px] font-semibold whitespace-nowrap ml-auto"
              style={{ padding: '7px 12px', borderRadius: 9, background: selectMode ? '#7c3aed' : 'var(--xp-bg3)', color: selectMode ? '#fff' : 'var(--xp-txt)', border: selectMode ? 'none' : '0.5px solid var(--xp-bdr2)' }}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>

            {category === 'photos' && (
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

          {/* Contextual selection action bar */}
          {selectMode && selectedIds.size > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ background: 'rgba(124,58,237,0.06)', borderBottom: '0.5px solid var(--xp-bdr)' }}>
              <span className="text-[11.5px] font-semibold" style={{ color: '#7c3aed' }}>{selectedIds.size} selected</span>
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <button onClick={() => { const first = items.find(i => selectedIds.has(i.id)); if (first) handleShare(first) }} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconShare /> Share</button>
                <button onClick={() => items.filter(i => selectedIds.has(i.id)).forEach(handleDownload)} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDownload /> Download</button>
                <button onClick={handleExportDrive} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}><IconDrive /> Export</button>
                <button onClick={handleDeleteSelected} className="flex items-center gap-1 text-[11px] font-medium" style={{ padding: '5px 10px', borderRadius: 7, background: 'rgba(220,38,38,0.10)', color: '#dc2626' }}><IconTrash /> Delete</button>
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
              ) : orgMode === 'type' ? (
                <div className="flex flex-col gap-5">
                  {typeGroups.map(group => (
                    <div key={group.key}>
                      <div className="flex items-center gap-2 mb-2.5">
                        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{group.label}</h3>
                        <span className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>{group.items.length} items</span>
                      </div>
                      {renderItems(group.items)}
                    </div>
                  ))}
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
                  onShare={() => handleShare(detailItem)}
                  onDownload={() => handleDownload(detailItem)}
                  onExportDrive={handleExportDrive}
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
                onShare={() => handleShare(detailItem)}
                onDownload={() => handleDownload(detailItem)}
                onExportDrive={handleExportDrive}
                onDelete={() => handleDeleteOne(detailItem.id)}
              />
            </div>
          </div>
        </div>
      )}

      {cameraOpen && <CameraModal onSave={handleCameraCapture} onClose={() => setCameraOpen(false)} />}
    </>
  )
}
