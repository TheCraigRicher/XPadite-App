'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const GALLERY_KEY = 'xp9g'

export interface GalleryItem {
  id: string
  type: 'month-share' | 'photo'
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
}

export function loadGallery(): GalleryItem[] {
  try { const r = localStorage.getItem(GALLERY_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
export function saveGallery(items: GalleryItem[]): void {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(items))
}
export function addGalleryItem(item: GalleryItem): void {
  saveGallery([item, ...loadGallery()])
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
    // Re-mount effect by unmounting — easier to just restart the stream
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
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

interface GalleryModalProps { onClose: () => void }

export function GalleryModal({ onClose }: GalleryModalProps) {
  const [tab, setTab] = useState<'cards' | 'photos'>('cards')
  const [items, setItems] = useState<GalleryItem[]>(() => loadGallery())
  const [uploading, setUploading] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const uri = await resizeImage(file, 400, 300)
        addGalleryItem({ id: 'ph-' + Date.now() + '-' + Math.random().toString(36).slice(2), type: 'photo', createdAt: Date.now(), title: file.name.replace(/\.[^.]+$/, ''), dataUri: uri })
      }
      setItems(loadGallery())
    } finally { setUploading(false) }
  }, [])

  function handleCameraCapture(uri: string) {
    addGalleryItem({ id: 'cam-' + Date.now(), type: 'photo', createdAt: Date.now(), title: `Photo ${new Date().toLocaleDateString()}`, dataUri: uri })
    setItems(loadGallery())
  }

  function deleteItem(id: string) {
    const updated = items.filter(i => i.id !== id)
    saveGallery(updated); setItems(updated)
  }

  const filtered = items.filter(i => tab === 'cards' ? i.type === 'month-share' : i.type === 'photo')

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
        <div className="w-full max-w-[640px] rounded-2xl shadow-2xl overflow-hidden mb-8" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--xp-txt)' }}>🖼️ Gallery</h2>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Your saved cards and photos</p>
            </div>
            <button onClick={onClose} className="text-sm transition-colors hover:text-red-400" style={{ color: 'var(--xp-txt3)' }}>× Close</button>
          </div>

          <div className="flex" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            {(['cards', 'photos'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className="flex-1 py-2.5 text-xs font-medium transition-colors"
                style={{ color: tab === t ? 'var(--xp-acc)' : 'var(--xp-txt3)', borderBottom: tab === t ? '2px solid var(--xp-acc)' : '2px solid transparent' }}>
                {t === 'cards' ? '📤 Share Cards' : '📷 Photos'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'photos' && (
              <div className="flex gap-2 mb-4">
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', color: 'var(--xp-txt2)' }}>
                  📁 {uploading ? 'Uploading…' : 'Import Photo'}
                </button>
                <button onClick={() => setCameraOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-all hover:opacity-85"
                  style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', color: 'var(--xp-txt2)' }}>
                  📸 Take Photo
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { handleFileUpload(e.target.files); e.target.value = '' }}/>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-3xl mb-3">{tab === 'cards' ? '📤' : '📷'}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--xp-txt2)' }}>{tab === 'cards' ? 'No share cards yet' : 'No photos yet'}</p>
                <p className="text-xs mt-1.5" style={{ color: 'var(--xp-txt3)' }}>
                  {tab === 'cards' ? 'Open a month card and tap Share' : 'Upload photos or take one with your camera'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filtered.map(item => (
                  <div key={item.id} className="relative group rounded-xl overflow-hidden" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                    <img src={item.dataUri} alt={item.title} className="w-full aspect-video object-cover"/>
                    <div className="p-2">
                      <p className="text-[10px] font-medium truncate" style={{ color: 'var(--xp-txt2)' }}>{item.title}</p>
                      <p className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>{new Date(item.createdAt).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => deleteItem(item.id)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'rgba(185,28,28,0.85)', color: 'white' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {cameraOpen && <CameraModal onSave={handleCameraCapture} onClose={() => setCameraOpen(false)}/>}
    </>
  )
}
