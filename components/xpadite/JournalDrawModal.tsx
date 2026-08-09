'use client'

import { useEffect, useRef, useState } from 'react'

interface JournalDrawModalProps {
  isDark: boolean
  onSave: (dataUrl: string) => void
  onClose: () => void
}

// Pen thickness options in CSS pixels
const PEN_SIZES = [2, 4, 8, 14]

export function JournalDrawModal({ isDark, onSave, onClose }: JournalDrawModalProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const isDrawing  = useRef(false)
  const lastPos    = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<string[]>([])
  const redoRef    = useRef<string[]>([])

  const [tool,    setTool]    = useState<'pen' | 'eraser'>('pen')
  const [sizeIdx, setSizeIdx] = useState(1)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // ── Canvas init (after first paint so offsetWidth is measured) ──────────────
  useEffect(() => {
    const canvas    = canvasRef.current
    const wrap      = wrapRef.current
    if (!canvas || !wrap) return

    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const w   = wrap.offsetWidth  || 800
      const h   = wrap.offsetHeight || 500

      canvas.width  = w * dpr
      canvas.height = h * dpr
      canvas.style.width  = w + 'px'
      canvas.style.height = h + 'px'

      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)

      // Seed history with the blank canvas
      historyRef.current = [canvas.toDataURL()]
      setCanUndo(false)
      setCanRedo(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function ctx() {
    return canvasRef.current?.getContext('2d') ?? null
  }

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      if (e.touches.length === 0) return null
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function snapshot() {
    const canvas = canvasRef.current
    if (!canvas) return
    historyRef.current = [...historyRef.current, canvas.toDataURL()]
    redoRef.current    = []
    setCanUndo(historyRef.current.length > 1)
    setCanRedo(false)
  }

  function restoreSnap(dataUrl: string) {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = ctx()!
    const img = new Image()
    img.onload = () => {
      c.globalCompositeOperation = 'source-over'
      c.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      c.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight)
    }
    img.src = dataUrl
  }

  // ── Stroke events ────────────────────────────────────────────────────────────

  function beginStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const pos = getPos(e)
    if (!pos) return
    isDrawing.current = true
    lastPos.current   = pos

    const c = ctx()
    if (!c) return
    c.globalCompositeOperation = 'source-over'
    c.strokeStyle = tool === 'eraser' ? '#ffffff' : '#1a1a1a'
    c.lineWidth   = PEN_SIZES[sizeIdx]
    c.lineCap     = 'round'
    c.lineJoin    = 'round'
    c.beginPath()
    c.moveTo(pos.x, pos.y)
  }

  function continueStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDrawing.current) return
    const pos  = getPos(e)
    const last = lastPos.current
    if (!pos || !last) return
    const c = ctx()
    if (!c) return
    c.lineTo(pos.x, pos.y)
    c.stroke()
    c.beginPath()
    c.moveTo(pos.x, pos.y)
    lastPos.current = pos
  }

  function endStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDrawing.current) return
    isDrawing.current = false
    lastPos.current   = null
    snapshot()
  }

  // ── History ──────────────────────────────────────────────────────────────────

  function undo() {
    if (historyRef.current.length <= 1) return
    const h      = [...historyRef.current]
    const popped = h.pop()!
    redoRef.current    = [...redoRef.current, popped]
    historyRef.current = h
    restoreSnap(h[h.length - 1])
    setCanUndo(h.length > 1)
    setCanRedo(true)
  }

  function redo() {
    if (redoRef.current.length === 0) return
    const r    = [...redoRef.current]
    const next = r.pop()!
    historyRef.current = [...historyRef.current, next]
    redoRef.current    = r
    restoreSnap(next)
    setCanUndo(true)
    setCanRedo(r.length > 0)
  }

  function clearAll() {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = ctx()!
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    snapshot()
  }

  function handleSave() {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const dockBg  = isDark ? 'rgba(9,4,22,0.97)' : '#f1f5f9'
  const dockBdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'

  function dkBtn(active = false, disabled = false): React.CSSProperties {
    return {
      padding: '5px 11px', borderRadius: 7, cursor: disabled ? 'default' : 'pointer',
      border: `0.5px solid ${active ? 'rgba(124,58,237,0.55)' : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
      background: active
        ? 'rgba(124,58,237,0.20)'
        : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      color: active
        ? '#a78bfa'
        : disabled
          ? (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)')
          : (isDark ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.68)'),
      fontSize: 12, fontWeight: active ? 600 : 500,
      transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
    }
  }

  return (
    /* Position: fixed so it overlays the entire Journal workspace */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', flexDirection: 'column',
      background: isDark ? '#10071e' : '#ffffff',
    }}>

      {/* Draw toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
        background: dockBg,
        borderBottom: `0.5px solid ${dockBdr}`,
        boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.40)' : '0 1px 6px rgba(0,0,0,0.08)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Draw label */}
        <span style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em',
          color: isDark ? 'rgba(255,255,255,0.85)' : '#1e293b',
          marginRight: 6, flexShrink: 0,
        }}>
          ✏️ Draw
        </span>

        <span style={{ width: 1, height: 18, background: dockBdr, flexShrink: 0 }} />

        {/* Tool selection */}
        <button style={dkBtn(tool === 'pen')}    onClick={() => setTool('pen')}>Pen</button>
        <button style={dkBtn(tool === 'eraser')} onClick={() => setTool('eraser')}>Eraser</button>

        <span style={{ width: 1, height: 18, background: dockBdr, flexShrink: 0 }} />

        {/* Stroke sizes */}
        {PEN_SIZES.map((sz, i) => (
          <button
            key={i}
            onClick={() => setSizeIdx(i)}
            title={`${sz}px`}
            style={{
              width: 28, height: 28, borderRadius: 7, padding: 0,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `0.5px solid ${sizeIdx === i ? 'rgba(124,58,237,0.55)' : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
              background: sizeIdx === i ? 'rgba(124,58,237,0.20)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              transition: 'all 120ms', flexShrink: 0,
            }}
          >
            <span style={{
              display: 'block',
              width:  Math.min(sz + 2, 14),
              height: Math.min(sz + 2, 14),
              borderRadius: '50%',
              background: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.62)',
            }} />
          </button>
        ))}

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* History */}
        <button style={dkBtn(false, !canUndo)} onClick={undo} disabled={!canUndo}>↩ Undo</button>
        <button style={dkBtn(false, !canRedo)} onClick={redo} disabled={!canRedo}>↪ Redo</button>
        <button style={dkBtn()} onClick={clearAll}>Clear</button>

        <span style={{ width: 1, height: 18, background: dockBdr, flexShrink: 0 }} />

        {/* Cancel */}
        <button
          onClick={onClose}
          style={{
            ...dkBtn(),
            border: '0.5px solid rgba(239,68,68,0.28)',
            background: 'rgba(239,68,68,0.08)',
            color: isDark ? 'rgba(252,165,165,0.85)' : '#dc2626',
          }}
        >
          Cancel
        </button>

        {/* Save Drawing */}
        <button
          onClick={handleSave}
          style={{
            padding: '5px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0,
            boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
          }}
        >
          Save Drawing
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={wrapRef}
        style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
          background: '#ffffff',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', touchAction: 'none' }}
          onMouseDown={beginStroke}
          onMouseMove={continueStroke}
          onMouseUp={endStroke}
          onMouseLeave={endStroke}
          onTouchStart={beginStroke}
          onTouchMove={continueStroke}
          onTouchEnd={endStroke}
        />
        {/* Empty state hint */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', opacity: canUndo ? 0 : 0.35, transition: 'opacity 300ms',
          }}
        >
          <span style={{ fontSize: 13, color: '#94a3b8', userSelect: 'none' }}>
            Start drawing…
          </span>
        </div>
      </div>
    </div>
  )
}
