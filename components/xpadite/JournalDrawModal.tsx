'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'rect-r' | 'circle' | 'triangle'

interface JournalDrawModalProps {
  isDark: boolean
  initialSrc?: string   // populate canvas with existing drawing for editing
  onSave:  (dataUrl: string) => void
  onClose: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PEN_SIZES  = [2, 4, 8, 14] as const
const TEXT_SIZES = [12, 18, 26, 36] as const

const TOOL_DEFS: { key: DrawTool; label: string; tip: string }[] = [
  { key: 'pen',      label: '✏',  tip: 'Pen'              },
  { key: 'eraser',   label: '⊘',  tip: 'Eraser'           },
  { key: 'text',     label: 'T',  tip: 'Text'             },
  { key: 'line',     label: '—',  tip: 'Line'             },
  { key: 'arrow',    label: '→',  tip: 'Arrow'            },
  { key: 'rect',     label: '□',  tip: 'Rectangle'        },
  { key: 'rect-r',   label: '⊡',  tip: 'Rounded Rect'    },
  { key: 'circle',   label: '○',  tip: 'Circle / Ellipse' },
  { key: 'triangle', label: '△',  tip: 'Triangle'         },
]

const FREE_DRAW_TOOLS: DrawTool[] = ['pen', 'eraser']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPos(
  e: React.MouseEvent | React.TouchEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect()
  if ('touches' in e) {
    if (e.touches.length === 0) return null
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
  }
  return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  size: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const h     = Math.max(12, size * 3)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - h * Math.cos(angle - Math.PI / 6), y2 - h * Math.sin(angle - Math.PI / 6))
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - h * Math.cos(angle + Math.PI / 6), y2 - h * Math.sin(angle + Math.PI / 6))
  ctx.stroke()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arcTo(x + w, y, x + w, y + radius, radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius)
  ctx.lineTo(x + radius, y + h)
  ctx.arcTo(x, y + h, x, y + h - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  tool: DrawTool,
  x1: number, y1: number, x2: number, y2: number,
  color: string, strokeW: number, filled: boolean,
) {
  ctx.strokeStyle = color
  ctx.fillStyle   = color
  ctx.lineWidth   = strokeW
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'

  const dx = x2 - x1
  const dy = y2 - y1

  if (tool === 'line') {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    return
  }

  if (tool === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    drawArrowHead(ctx, x1, y1, x2, y2, strokeW)
    return
  }

  if (tool === 'rect') {
    ctx.beginPath()
    ctx.rect(x1, y1, dx, dy)
    if (filled) ctx.fill()
    ctx.stroke()
    return
  }

  if (tool === 'rect-r') {
    roundRect(ctx, x1, y1, dx, dy, 10)
    if (filled) ctx.fill()
    ctx.stroke()
    return
  }

  if (tool === 'circle') {
    ctx.beginPath()
    ctx.ellipse(x1 + dx / 2, y1 + dy / 2, Math.abs(dx) / 2, Math.abs(dy) / 2, 0, 0, Math.PI * 2)
    if (filled) ctx.fill()
    ctx.stroke()
    return
  }

  if (tool === 'triangle') {
    ctx.beginPath()
    ctx.moveTo(x1 + dx / 2, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x1, y2)
    ctx.closePath()
    if (filled) ctx.fill()
    ctx.stroke()
    return
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JournalDrawModal({ isDark, initialSrc, onSave, onClose }: JournalDrawModalProps) {
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const wrapRef        = useRef<HTMLDivElement>(null)
  const isDrawing      = useRef(false)
  const lastPos        = useRef<{ x: number; y: number } | null>(null)
  const shapeStart     = useRef<{ x: number; y: number } | null>(null)
  const previewSnap    = useRef<string | null>(null)
  const historyRef     = useRef<string[]>([])
  const redoRef        = useRef<string[]>([])

  const [tool,       setTool]       = useState<DrawTool>('pen')
  const [sizeIdx,    setSizeIdx]    = useState(1)
  const [drawColor,  setDrawColor]  = useState('#1a1a1a')
  const [filled,     setFilled]     = useState(false)
  const [fitToScreen,setFitToScreen]= useState(false)
  const [canUndo,    setCanUndo]    = useState(false)
  const [canRedo,    setCanRedo]    = useState(false)
  const [textInput,  setTextInput]  = useState<{ x: number; y: number; value: string } | null>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  // ── Canvas init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const w   = wrap.offsetWidth  || 720
      const h   = wrap.offsetHeight || 480

      canvas.width  = w * dpr
      canvas.height = h * dpr
      canvas.style.width  = w + 'px'
      canvas.style.height = h + 'px'

      const c = canvas.getContext('2d')!
      c.scale(dpr, dpr)

      if (initialSrc) {
        const img = new Image()
        img.onload = () => {
          c.drawImage(img, 0, 0, w, h)
          historyRef.current = [canvas.toDataURL()]
          setCanUndo(false)
          setCanRedo(false)
        }
        img.src = initialSrc
      } else {
        c.fillStyle = '#ffffff'
        c.fillRect(0, 0, w, h)
        historyRef.current = [canvas.toDataURL()]
        setCanUndo(false)
        setCanRedo(false)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Context helpers ─────────────────────────────────────────────────────────
  const getCtx = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext('2d') ?? null
  }, [])

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
    const c = getCtx()!
    const img = new Image()
    img.onload = () => {
      c.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      c.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight)
    }
    img.src = dataUrl
  }

  // ── Text tool ───────────────────────────────────────────────────────────────
  function commitText() {
    const val = textInput?.value?.trim()
    if (val) {
      const c = getCtx()
      if (c && textInput) {
        const fontSize = TEXT_SIZES[sizeIdx]
        c.fillStyle = drawColor
        c.font      = `${fontSize}px sans-serif`
        c.fillText(val, textInput.x, textInput.y + fontSize * 0.8)
        snapshot()
      }
    }
    setTextInput(null)
  }

  // ── Pointer events ──────────────────────────────────────────────────────────
  function beginStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const pos = getPos(e, canvas)
    if (!pos) return

    // text tool: place input
    if (tool === 'text') {
      if (textInput) commitText()
      setTextInput({ x: pos.x, y: pos.y, value: '' })
      return
    }

    isDrawing.current = true
    lastPos.current   = pos

    if (FREE_DRAW_TOOLS.includes(tool)) {
      const c = getCtx()
      if (!c) return
      c.globalCompositeOperation = 'source-over'
      c.strokeStyle = tool === 'eraser' ? '#ffffff' : drawColor
      c.lineWidth   = PEN_SIZES[sizeIdx]
      c.lineCap     = 'round'
      c.lineJoin    = 'round'
      c.beginPath()
      c.moveTo(pos.x, pos.y)
    } else {
      // shape tool — save preview snap
      shapeStart.current  = pos
      previewSnap.current = canvasRef.current?.toDataURL() ?? null
    }
  }

  function continueStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const pos = getPos(e, canvas)
    if (!pos) return

    const c = getCtx()
    if (!c) return

    if (FREE_DRAW_TOOLS.includes(tool)) {
      const last = lastPos.current
      if (!last) return
      c.lineTo(pos.x, pos.y)
      c.stroke()
      c.beginPath()
      c.moveTo(pos.x, pos.y)
      lastPos.current = pos
    } else {
      // Shape preview: restore snap, then draw preview
      if (!previewSnap.current || !shapeStart.current) return
      const snap = previewSnap.current
      const img  = new Image()
      img.onload = () => {
        c.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
        c.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight)
        drawShape(c, tool, shapeStart.current!.x, shapeStart.current!.y, pos.x, pos.y,
          drawColor, PEN_SIZES[sizeIdx], filled)
      }
      img.src = snap
    }
  }

  function endStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDrawing.current) return
    isDrawing.current = false

    if (FREE_DRAW_TOOLS.includes(tool)) {
      lastPos.current = null
      snapshot()
    } else {
      const canvas = canvasRef.current
      if (!canvas) return
      const pos = getPos(e, canvas)
      if (pos && shapeStart.current && previewSnap.current) {
        const c = getCtx()!
        const snap = previewSnap.current
        const img = new Image()
        img.onload = () => {
          c.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
          c.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight)
          drawShape(c, tool, shapeStart.current!.x, shapeStart.current!.y, pos.x, pos.y,
            drawColor, PEN_SIZES[sizeIdx], filled)
          snapshot()
        }
        img.src = snap
      }
      shapeStart.current  = null
      previewSnap.current = null
    }
  }

  // ── History ─────────────────────────────────────────────────────────────────
  function undo() {
    if (historyRef.current.length <= 1) return
    const h = [...historyRef.current]
    redoRef.current    = [...redoRef.current, h.pop()!]
    historyRef.current = h
    restoreSnap(h[h.length - 1])
    setCanUndo(h.length > 1)
    setCanRedo(true)
  }

  function redo() {
    if (redoRef.current.length === 0) return
    const r = [...redoRef.current]
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
    const c = getCtx()!
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    snapshot()
  }

  function handleSave() {
    if (textInput) commitText()
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Styles ───────────────────────────────────────────────────────────────────
  const dockBg  = isDark ? 'rgba(9,4,22,0.97)' : '#f1f5f9'
  const dockBdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  const isShapeTool = !FREE_DRAW_TOOLS.includes(tool) && tool !== 'text'

  function dkBtn(active = false, danger = false, disabled = false): React.CSSProperties {
    return {
      padding: '4px 10px', borderRadius: 7, cursor: disabled ? 'default' : 'pointer',
      border: `0.5px solid ${
        active   ? 'rgba(124,58,237,0.55)'
        : danger ? 'rgba(239,68,68,0.28)'
        : isDark ? 'rgba(255,255,255,0.14)'
        : 'rgba(0,0,0,0.15)'}`,
      background: active  ? 'rgba(124,58,237,0.20)'
        : danger          ? 'rgba(239,68,68,0.08)'
        : isDark          ? 'rgba(255,255,255,0.06)'
        : 'rgba(0,0,0,0.04)',
      color: active  ? '#a78bfa'
        : danger     ? (isDark ? 'rgba(252,165,165,0.85)' : '#dc2626')
        : disabled   ? (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)')
        : isDark     ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.68)',
      fontSize: 12, fontWeight: active ? 600 : 500,
      transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
      lineHeight: '1.4',
    }
  }

  const divider = (
    <span style={{ width: 1, height: 18, background: dockBdr, flexShrink: 0, alignSelf: 'center' }} />
  )

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  const toolbar = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '9px 16px',
      background: dockBg,
      borderBottom: `0.5px solid ${dockBdr}`,
      boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.40)' : '0 1px 6px rgba(0,0,0,0.08)',
      flexShrink: 0, overflowX: 'auto', flexWrap: 'nowrap',
    }}>
      <span style={{
        fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em',
        color: isDark ? 'rgba(255,255,255,0.85)' : '#1e293b',
        marginRight: 4, flexShrink: 0,
      }}>
        ✏️ Draw
      </span>

      {divider}

      {/* Tool buttons */}
      {TOOL_DEFS.map(t => (
        <button
          key={t.key}
          title={t.tip}
          onClick={() => { if (textInput) commitText(); setTool(t.key) }}
          style={{ ...dkBtn(tool === t.key), minWidth: 28, textAlign: 'center', padding: '4px 8px', fontSize: t.key === 'text' ? 13 : 12, fontWeight: t.key === 'text' ? 700 : 500 }}
        >
          {t.label}
        </button>
      ))}

      {divider}

      {/* Stroke / font size */}
      {PEN_SIZES.map((sz, i) => (
        <button
          key={i}
          title={`Size ${sz}px`}
          onClick={() => setSizeIdx(i)}
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
            width: Math.min(sz + 2, 14), height: Math.min(sz + 2, 14), borderRadius: '50%',
            background: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.62)',
          }} />
        </button>
      ))}

      {divider}

      {/* Color picker */}
      <label title="Color" style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: drawColor,
          border: `2px solid ${isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.20)'}`,
          boxShadow: '0 0 0 1px rgba(124,58,237,0.30)',
        }} />
        <input
          type="color"
          value={drawColor}
          onChange={e => setDrawColor(e.target.value)}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          tabIndex={-1}
        />
      </label>

      {/* Fill toggle (only relevant for shape tools) */}
      {isShapeTool && (
        <button
          title="Toggle fill"
          onClick={() => setFilled(f => !f)}
          style={dkBtn(filled)}
        >
          {filled ? '◉' : '○'} Fill
        </button>
      )}

      <span style={{ flex: 1 }} />

      {/* History */}
      <button style={dkBtn(false, false, !canUndo)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
      <button style={dkBtn(false, false, !canRedo)} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
      <button style={dkBtn()} onClick={clearAll} title="Clear canvas">Clear</button>

      {divider}

      {/* Fit to screen toggle */}
      <button
        onClick={() => setFitToScreen(f => !f)}
        title={fitToScreen ? 'Exit full screen' : 'Fit to screen'}
        style={dkBtn(fitToScreen)}
      >
        {fitToScreen ? '⊡' : '⛶'} Fit
      </button>

      {divider}

      <button onClick={onClose} style={dkBtn(false, true)}>Cancel</button>
      <button
        onClick={handleSave}
        style={{
          padding: '5px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
          color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0,
          boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
        }}
      >
        Save
      </button>
    </div>
  )

  // ── Canvas area ─────────────────────────────────────────────────────────────
  const canvasArea = (
    <div
      ref={wrapRef}
      style={{
        flex: 1, overflow: 'hidden', position: 'relative',
        cursor: tool === 'eraser' ? 'cell'
          : (tool === 'text'  ? 'text'
          : (FREE_DRAW_TOOLS.includes(tool) ? 'crosshair' : 'crosshair')),
        background: '#ffffff',
        minHeight: 0,
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

      {/* Floating text input */}
      {textInput && (
        <input
          ref={textInputRef}
          autoFocus
          value={textInput.value}
          onChange={e => setTextInput(prev => prev ? { ...prev, value: e.target.value } : null)}
          onBlur={commitText}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitText() }
            if (e.key === 'Escape') { e.preventDefault(); setTextInput(null) }
          }}
          style={{
            position: 'absolute',
            left:  textInput.x,
            top:   textInput.y,
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(4px)',
            border: '1px dashed rgba(124,58,237,0.60)',
            borderRadius: 4,
            color: drawColor,
            fontSize: TEXT_SIZES[sizeIdx],
            outline: 'none',
            minWidth: 120,
            padding: '2px 4px',
            zIndex: 10,
            fontFamily: 'sans-serif',
          }}
          placeholder="Type here…"
        />
      )}

      {/* Empty state */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', opacity: canUndo ? 0 : 0.35, transition: 'opacity 300ms',
      }}>
        <span style={{ fontSize: 13, color: '#94a3b8', userSelect: 'none' }}>
          Start drawing…
        </span>
      </div>
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  const innerContent = (
    <>
      {toolbar}
      {canvasArea}
    </>
  )

  if (fitToScreen) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', flexDirection: 'column',
        background: isDark ? '#10071e' : '#ffffff',
      }}>
        {innerContent}
      </div>
    )
  }

  // Default: renders as a flex child inside JournalEditorContent's content area
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
      background: isDark ? '#10071e' : '#ffffff',
    }}>
      {innerContent}
    </div>
  )
}
