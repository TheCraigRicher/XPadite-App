'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskAttachment } from './types'

// ── File helpers ──────────────────────────────────────────────────────────────

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar')
  ) return '🗜️'
  if (mimeType.startsWith('text/')) return '📃'
  return '📎'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function makeThumb(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const MAX = 180
        const scale = Math.min(MAX / img.width, MAX / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => resolve(null)
      img.src = ev.target?.result as string
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export async function buildAttachment(
  file: File,
  source: 'upload' | 'camera',
): Promise<TaskAttachment> {
  const thumbnail = await makeThumb(file)
  const now = Date.now()
  return {
    id: `att_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    url: URL.createObjectURL(file),
    thumbnail,
    addedAt: now,
    source,
  }
}

export const ATTACHMENT_ACCEPT =
  'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z'

export async function buildAttachments(
  files: File[] | FileList,
  source: 'upload' | 'camera',
): Promise<TaskAttachment[]> {
  return Promise.all(Array.from(files).map(f => buildAttachment(f, source)))
}

export function removeAttachmentById(
  attachments: TaskAttachment[],
  id: string,
): TaskAttachment[] {
  const att = attachments.find(a => a.id === id)
  if (att) { try { URL.revokeObjectURL(att.url) } catch {} }
  return attachments.filter(a => a.id !== id)
}

// ── AttachmentItem ────────────────────────────────────────────────────────────

export function AttachmentItem({
  attachment,
  isDark,
  onRemove,
  onPreview,
}: {
  attachment: TaskAttachment
  isDark: boolean
  onRemove: () => void
  onPreview: () => void
}) {
  const isImage = attachment.mimeType.startsWith('image/')
  const ts = new Date(attachment.addedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 9,
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(243,241,255,0.7)',
        border: isDark
          ? '0.5px solid rgba(124,58,237,0.18)'
          : '0.5px solid rgba(124,58,237,0.13)',
      }}
    >
      {isImage && attachment.thumbnail ? (
        <button
          onClick={onPreview}
          title="View full size"
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            overflow: 'hidden',
            flexShrink: 0,
            cursor: 'zoom-in',
            border: 'none',
            padding: 0,
          }}
        >
          <img
            src={attachment.thumbnail}
            alt={attachment.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
        </button>
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            background: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {getFileIcon(attachment.mimeType)}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--xp-txt)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            margin: 0,
          }}
        >
          {attachment.name}
        </p>
        <p style={{ fontSize: 10.5, color: 'var(--xp-txt3)', lineHeight: 1.3, margin: '2px 0 0' }}>
          {formatBytes(attachment.size)} · {ts}
          {attachment.source === 'camera' && (
            <span style={{ marginLeft: 4, opacity: 0.7 }}>📷</span>
          )}
        </p>
      </div>

      <a
        href={attachment.url}
        download={attachment.name}
        title="Download"
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.07)',
          color: isDark ? 'rgba(167,139,250,0.85)' : '#7c3aed',
          fontSize: 14,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        ↓
      </a>

      <button
        onClick={onRemove}
        title="Remove attachment"
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: isDark ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.55)',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ── ImageLightbox ─────────────────────────────────────────────────────────────

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.90)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        padding: 24,
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '0.5px solid rgba(255,255,255,0.2)',
          cursor: 'pointer',
          color: 'white',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 201,
        }}
      >
        ×
      </button>
      <img
        src={src}
        alt={alt}
        style={{
          maxWidth: '88vw',
          maxHeight: '82vh',
          borderRadius: 14,
          objectFit: 'contain',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
          cursor: 'default',
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// ── CameraModal ───────────────────────────────────────────────────────────────

type CameraPhase = 'requesting' | 'preview' | 'captured' | 'denied'

const camPrimary: React.CSSProperties = {
  padding: '9px 22px', borderRadius: 10,
  background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
  color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
}
const camSecondary: React.CSSProperties = {
  padding: '9px 22px', borderRadius: 10,
  background: 'rgba(255,255,255,0.10)',
  border: '0.5px solid rgba(255,255,255,0.22)',
  color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const camCancel: React.CSSProperties = {
  padding: '9px 22px', borderRadius: 10,
  background: 'rgba(255,255,255,0.06)',
  border: '0.5px solid rgba(255,255,255,0.14)',
  color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}

export function CameraModal({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => Promise<void> | void
  onClose: () => void
}) {
  const videoRef       = useRef<HTMLVideoElement>(null)
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const streamRef      = useRef<MediaStream | null>(null)
  const handleCloseRef = useRef<() => void>(() => {})
  const [phase, setPhase]       = useState<CameraPhase>('requesting')
  const [captured, setCaptured] = useState<{ blob: Blob; url: string } | null>(null)

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const startCamera = useCallback(async () => {
    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('preview')
    } catch {
      setPhase('denied')
    }
  }, [])

  // Start camera on mount; stop on unmount
  useEffect(() => {
    startCamera()
    return () => { stopStream() }
  }, [startCamera])

  // Stable Escape key listener — never re-registers on capture
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCloseRef.current() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  function capturePhoto() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      setCaptured({ blob, url: URL.createObjectURL(blob) })
      stopStream()
      setPhase('captured')
    }, 'image/jpeg', 0.92)
  }

  function retake() {
    if (captured) { URL.revokeObjectURL(captured.url); setCaptured(null) }
    startCamera()
  }

  async function usePhoto() {
    if (!captured) return
    const file = new File([captured.blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })
    await onCapture(file)
    URL.revokeObjectURL(captured.url)
    onClose()
  }

  function handleClose() {
    stopStream()
    if (captured) URL.revokeObjectURL(captured.url)
    onClose()
  }
  handleCloseRef.current = handleClose

  return (
    <div
      role="dialog"
      aria-label="Camera"
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.96)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      {/* Close */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute', top: 16, right: 20,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '0.5px solid rgba(255,255,255,0.2)',
          cursor: 'pointer', color: 'white', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ×
      </button>

      {/* Title */}
      <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12.5, fontWeight: 600,
        marginBottom: 14, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        📷 Camera
      </p>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ── Requesting ── */}
      {phase === 'requesting' && (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>📷</div>
          Requesting camera access…
        </div>
      )}

      {/* ── Denied ── */}
      {phase === 'denied' && (
        <div style={{ maxWidth: 360, textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🚫</div>
          <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'white' }}>
            Camera access unavailable
          </p>
          <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginBottom: 24, lineHeight: 1.6 }}>
            Please allow camera permission in your browser settings, or upload a photo instead.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...camPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              📁 Upload Photo
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  await onCapture(file)
                  onClose()
                }}
              />
            </label>
            <button onClick={handleClose} style={camCancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Live preview ── */}
      {phase === 'preview' && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%', maxWidth: 560, borderRadius: 14,
              background: '#111', objectFit: 'cover',
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
            }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={handleClose} style={camCancel}>Cancel</button>
            <button onClick={capturePhoto} style={camPrimary}>📸 Capture Photo</button>
          </div>
        </>
      )}

      {/* ── Captured preview ── */}
      {phase === 'captured' && captured && (
        <>
          <img
            src={captured.url}
            alt="Captured photo"
            style={{
              width: '100%', maxWidth: 560, borderRadius: 14,
              objectFit: 'cover',
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
            }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={handleClose} style={camCancel}>Cancel</button>
            <button onClick={retake} style={camSecondary}>↺ Retake</button>
            <button onClick={usePhoto} style={camPrimary}>✓ Use Photo</button>
          </div>
        </>
      )}
    </div>
  )
}
