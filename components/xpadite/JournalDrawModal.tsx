'use client'

import { useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { ColorPickerModal } from './ColorPickerModal'
import { COLOR_PALETTE, normalizeHexColor } from './utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'select' | 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'rect-r' | 'circle' | 'triangle' | 'diamond' | 'starburst'
type ObjType  = 'rect' | 'rect-r' | 'circle' | 'triangle' | 'diamond' | 'starburst' | 'line' | 'arrow' | 'text' | 'stroke' | 'image'
// 'elbow' = sharp 90° two-segment connector; 'elbow-curved' = the same two-segment
// route with a smoothly rounded corner. Both are distinct from the older 'curved'
// (a single free-form quadratic bezier from start to end, unrelated to the elbow tool).
// V1: elbow corners are always DERIVED from the endpoints (x1,y2) — a vertical trunk
// down from the start, then horizontal to the end — never stored/edited as a draggable
// vertex. This guarantees a clean, deliberate default and keeps move/resize/flip trivial.
type ConnType = 'straight' | 'curved' | 'elbow' | 'elbow-curved'
type HPos     = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type PopoverId = 'pen-size' | 'eraser-size' | 'shapes' | 'flip' | 'text-size' | 'arrow-type' | 'fill' | 'rotate' | 'line-thickness' | 'arrow-thickness' | 'list-type'
type NoteListType = 'none' | 'bullet' | 'numbered' | 'lettered'
type EditField = 'title' | 'note'

interface Pt { x: number; y: number }

// Shape types (rect/rect-r/circle/triangle/diamond/starburst) double as mind-map
// nodes: `text`/`fontSize` hold the Title (centered alone, or top-aligned once a
// Note exists); `note`/`noteFontSize`/`noteListType` hold the optional body below
// it. Both wrap/auto-grow the shape — see wrapTextLines/computeRequiredHeight.
const TEXT_CAPABLE_TYPES: ObjType[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst']
const SHAPE_TEXT_PAD = 10

interface DrawObj {
  id: string; type: ObjType
  x: number; y: number; w: number; h: number
  x1: number; y1: number; x2: number; y2: number
  mx: number; my: number; connType: ConnType
  pts: Pt[]; eraser: boolean
  color: string; fillColor: string; filled: boolean; sw: number
  text: string; fontSize: number           // shape Title (or the free Text tool's only field)
  note: string; noteFontSize: number; noteListType: NoteListType  // shape Note — optional, below the Title
  flipX: boolean; flipY: boolean; gid: string
  src: string // data URL — pasted 'image' objects only
  // Radians, applied as a render-time transform around the shape's own bbox
  // center — only meaningful for the 6 SHAPE_TOOLS types (lines/arrows rotate
  // by re-deriving their endpoints directly, so they never need this field).
  rotation: number
  // Smart connectors (line/arrow only): the shape id + perimeter angle (radians,
  // 0 = due right, increasing clockwise) this endpoint is anchored to. Multiple
  // connectors may freely share the same shape+angle — no uniqueness is enforced.
  // Re-resolved against the target's CURRENT geometry after every move/resize/
  // rotate/auto-grow — see resolveAttachments.
  attachStartId: string | null; attachStartAngle: number
  attachEndId: string | null; attachEndAngle: number
}

type RotateBaseline = { x:number;y:number;w:number;h:number;x1:number;y1:number;x2:number;y2:number;mx:number;my:number;rotation:number }

type DragMode =
  | { kind: 'move';     ids: string[]; start: Pt; snap: Map<string, { x:number;y:number;w:number;h:number;x1:number;y1:number;x2:number;y2:number;mx:number;my:number;pts:Pt[] }> }
  | { kind: 'resize';   id: string; handle: HPos; orig: DrawObj; start: Pt }
  | { kind: 'endpoint'; id: string; which: 'start'|'end'|'mid'; start: Pt }
  | { kind: 'marquee';  start: Pt; cur: Pt }
  | { kind: 'rotate';   ids: string[]; pivot: Pt; startAngle: number; baseline: Map<string, RotateBaseline> }
  | null

interface JournalDrawModalProps {
  isDark: boolean; initialSrc?: string
  // The live, editable object list from a previous save (see JournalBlock.canvasData).
  // When present and valid, re-editing starts from these real objects instead
  // of the flattened initialSrc PNG — undefined/invalid falls back to the PNG
  // (drawings saved before this field existed, or any parse failure).
  initialObjects?: string
  onSave: (dataUrl: string, objectsJson: string) => void; onClose: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PEN_SIZES    = [2, 4, 8, 14] as const
const ERASER_SIZES = [8, 16, 28, 44] as const
const TEXT_SIZES   = [12, 18, 26, 36] as const
const THICKNESS_LEVELS = [1, 2, 3, 5, 8] as const
const SHAPE_TOOLS: DrawTool[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst']
const ROTATABLE_TYPES: ObjType[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }
function now() { return Date.now() }

function mkObj(p: Partial<DrawObj> & { id: string; type: ObjType }): DrawObj {
  return {
    x:0,y:0,w:0,h:0,x1:0,y1:0,x2:0,y2:0,mx:0,my:0,connType:'straight',
    pts:[],eraser:false,color:'#1a1a1a',fillColor:'#7c3aed',filled:false,sw:2,
    text:'',fontSize:18,note:'',noteFontSize:13,noteListType:'none',
    flipX:false,flipY:false,gid:'',src:'',rotation:0,
    attachStartId:null,attachStartAngle:0,attachEndId:null,attachEndAngle:0, ...p,
  }
}

// ─── Text wrapping (shape Title/Note) ──────────────────────────────────────────
// Canvas has no native text layout, so wrapping is done by hand: measure each
// candidate line and break at the last word that still fits, hard-breaking a
// single word that's wider than maxWidth on its own.
function wrapTextLines(c: CanvasRenderingContext2D, text: string, maxWidth: number, fontPx: number, weight = '400'): string[] {
  c.font = `${weight} ${fontPx}px sans-serif`
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') { lines.push(''); continue }
    let cur = ''
    for (const word of para.split(' ')) {
      const candidate = cur ? `${cur} ${word}` : word
      if (c.measureText(candidate).width <= maxWidth) { cur = candidate; continue }
      if (cur) { lines.push(cur); cur = '' }
      if (c.measureText(word).width <= maxWidth) { cur = word; continue }
      let chunk = ''
      for (const ch of word) {
        const t = chunk + ch
        if (c.measureText(t).width > maxWidth && chunk) { lines.push(chunk); chunk = ch }
        else chunk = t
      }
      cur = chunk
    }
    if (cur) lines.push(cur)
  }
  return lines
}

function getListMarker(type: NoteListType, index: number): string {
  if (type === 'bullet') return '•'
  if (type === 'numbered') return `${index + 1}.`
  if (type === 'lettered') return `${String.fromCharCode(97 + (index % 26))}.`
  return ''
}

// Each line of `note` is one list item (when noteListType !== 'none') — Enter
// naturally continues the active list type, and switching types just changes
// how the SAME lines render, so nothing ever needs rewriting/"stacking."
type NoteLine = { text: string; indent: number; marker?: string }
function wrapNoteContent(c: CanvasRenderingContext2D, note: string, maxWidth: number, fontPx: number, listType: NoteListType): NoteLine[] {
  if (listType === 'none') return wrapTextLines(c, note, maxWidth, fontPx).map(t => ({ text: t, indent: 0 }))
  c.font = `400 ${fontPx}px sans-serif`
  const indent = c.measureText('99.').width + 5
  const out: NoteLine[] = []
  note.split('\n').forEach((item, i) => {
    if (item.trim() === '') { out.push({ text: '', indent: 0 }); return }
    const marker = getListMarker(listType, i)
    wrapTextLines(c, item, Math.max(10, maxWidth - indent), fontPx).forEach((ln, li) => {
      out.push({ text: ln, indent, marker: li === 0 ? marker : undefined })
    })
  })
  return out
}

// The minimum height needed so the current Title/Note content never overflows
// the shape at its CURRENT width — callers grow (never shrink below this) `h`.
function computeRequiredHeight(c: CanvasRenderingContext2D, obj: DrawObj): number {
  const innerW = Math.max(10, Math.abs(obj.w) - SHAPE_TEXT_PAD * 2)
  const hasTitle = !!obj.text.trim(), hasNote = !!obj.note.trim()
  if (!hasTitle && !hasNote) return 40
  if (hasTitle && !hasNote) {
    const lines = wrapTextLines(c, obj.text, innerW, obj.fontSize, '600')
    return Math.max(40, lines.length * (obj.fontSize * 1.25) + SHAPE_TEXT_PAD * 2)
  }
  let h = SHAPE_TEXT_PAD
  if (hasTitle) h += wrapTextLines(c, obj.text, innerW, obj.fontSize, '700').length * (obj.fontSize * 1.25) + 4
  if (hasNote) h += wrapNoteContent(c, obj.note, innerW, obj.noteFontSize, obj.noteListType).length * (obj.noteFontSize * 1.3)
  return h + SHAPE_TEXT_PAD
}

function rotatePt(p: Pt, center: Pt, rad: number): Pt {
  if (!rad) return p
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = p.x - center.x, dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

// ─── Smart connector anchors ────────────────────────────────────────────────────
// A connector endpoint attaches to a SHAPE + a perimeter ANGLE (not a fixed
// point), so it can be re-resolved against the shape's current geometry after
// any move/resize/rotate/auto-grow. Angle 0 = due right of center, increasing
// clockwise in screen space (atan2 convention) — matches Math.atan2(dy,dx).
const CONNECTABLE_TYPES: ObjType[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst', 'image']

// Ray-box intersection in the box's own LOCAL frame (center at origin) — used
// directly for rect/rect-r, and as a reasonable approximation of the true
// polygon boundary for triangle/diamond/starburst (exact per-vertex boundary
// math for each custom shape is a much larger lift for little practical gain —
// an edge-anchored connector on those still visually reads as "attached").
function rayBoxIntersection(halfW: number, halfH: number, angle: number): Pt {
  const dx = Math.cos(angle), dy = Math.sin(angle)
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  return { x: t * dx, y: t * dy }
}

// The actual boundary point for a given perimeter angle, in SCREEN space —
// resolves rotation so an attached connector follows a rotated shape correctly.
function getPerimeterPoint(shape: DrawObj, angle: number): Pt {
  const bb = getObjBB(shape)
  const cx = (bb.minX+bb.maxX)/2, cy = (bb.minY+bb.maxY)/2
  const halfW = (bb.maxX-bb.minX)/2, halfH = (bb.maxY-bb.minY)/2
  const local = shape.type === 'circle'
    ? { x: halfW*Math.cos(angle), y: halfH*Math.sin(angle) }
    : rayBoxIntersection(halfW, halfH, angle)
  const screen = { x: cx+local.x, y: cy+local.y }
  return shape.rotation ? rotatePt(screen, { x:cx, y:cy }, shape.rotation) : screen
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a-b) % (Math.PI*2)
  if (d > Math.PI) d = Math.PI*2 - d
  return d
}

// Evenly distributed snap angles around the perimeter — cardinals get a wider,
// easier-to-hit tolerance; the rest a tighter one; anywhere else, the connector
// just uses the exact free angle under the pointer (never restricted to only these).
const CARDINAL_ANGLES = [0, Math.PI/2, Math.PI, -Math.PI/2]
const DISTRIBUTED_ANGLES = [30,45,60,120,135,150,210,225,240,300,315,330].map(d => d*Math.PI/180)
function snapAnchorAngle(raw: number): number {
  for (const a of CARDINAL_ANGLES) if (angleDiff(raw,a) < 10*Math.PI/180) return a
  for (const a of DISTRIBUTED_ANGLES) if (angleDiff(raw,a) < 6*Math.PI/180) return a
  return raw
}

// Finds a shape under/near the pointer to attach to, and the (snapped) angle
// from its center the endpoint should sit at — null target means "leave it
// floating in empty canvas space," which callers must still allow (item 11).
function findAttachTarget(objs: DrawObj[], excludeId: string, pos: Pt): { target: DrawObj; angle: number } | null {
  const PAD = 24
  for (const o of objs) {
    if (o.id === excludeId || !CONNECTABLE_TYPES.includes(o.type)) continue
    const bb = getObjBB(o)
    if (pos.x < bb.minX-PAD || pos.x > bb.maxX+PAD || pos.y < bb.minY-PAD || pos.y > bb.maxY+PAD) continue
    const cx = (bb.minX+bb.maxX)/2, cy = (bb.minY+bb.maxY)/2
    const local = o.rotation ? rotatePt(pos, {x:cx,y:cy}, -o.rotation) : pos
    const angle = snapAnchorAngle(Math.atan2(local.y-cy, local.x-cx))
    return { target: o, angle }
  }
  return null
}

// Re-resolves every attached connector endpoint against its target's CURRENT
// geometry — called after every move/resize/rotate/auto-grow so "if the shape
// moves/resizes/rotates, the connector follows" holds unconditionally.
function resolveAttachments(objs: DrawObj[]): DrawObj[] {
  const byId = new Map(objs.map(o => [o.id, o]))
  return objs.map(o => {
    if (o.type !== 'line' && o.type !== 'arrow') return o
    if (!o.attachStartId && !o.attachEndId) return o
    let x1=o.x1, y1=o.y1, x2=o.x2, y2=o.y2
    if (o.attachStartId) { const t = byId.get(o.attachStartId); if (t) { const p = getPerimeterPoint(t, o.attachStartAngle); x1=p.x; y1=p.y } }
    if (o.attachEndId)   { const t = byId.get(o.attachEndId);   if (t) { const p = getPerimeterPoint(t, o.attachEndAngle);   x2=p.x; y2=p.y } }
    return { ...o, x1, y1, x2, y2, mx:(x1+x2)/2, my:(y1+y2)/2 }
  })
}

// The pivot a rotation acts around: a single object's own bbox center, or the
// combined bbox center of a multi-selection — shared by both the drag-handle
// rotation and the quick ↺90°/↻90° actions so they rotate identically.
function getGroupPivot(objs: DrawObj[]): Pt {
  const bbs = objs.map(getObjBB)
  return {
    x: (Math.min(...bbs.map(b=>b.minX)) + Math.max(...bbs.map(b=>b.maxX))) / 2,
    y: (Math.min(...bbs.map(b=>b.minY)) + Math.max(...bbs.map(b=>b.maxY))) / 2,
  }
}

// Loads (and caches) an image for a pasted 'image' object. Returns the element
// once decoded; while loading, returns null and re-renders via onLoad when ready.
function getCachedImage(cache: Map<string, HTMLImageElement>, src: string, onLoad: () => void): HTMLImageElement | null {
  const existing = cache.get(src)
  if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null
  const img = new Image()
  img.onload = onLoad
  cache.set(src, img)
  img.src = src
  return null
}

function drawStarburstPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2, cy = y + h / 2
  const rx = Math.abs(w) / 2, ry = Math.abs(h) / 2
  const points = 12
  c.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const frac = i % 2 === 0 ? 1 : 0.72
    const angle = (Math.PI * i) / points - Math.PI / 2
    const px = cx + Math.cos(angle) * rx * frac
    const py = cy + Math.sin(angle) * ry * frac
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py)
  }
  c.closePath()
}

// Centered mind-map-node label — drawn after any flip transform is restored so
// the text itself is never mirrored (a shape's bbox center is unaffected by a
// flip around its own center, so this still lands in the visually-correct spot).
// Title-only: centered both axes, word-wrapped. Title+Note: left-aligned block
// near the top (Title bold, Note below it, Note's own list markers if any) —
// both forms keep content strictly inside [bb] at the shape's CURRENT size;
// auto-grow (computeRequiredHeight) is what keeps that true as content changes.
function drawShapeText(c: CanvasRenderingContext2D, obj: DrawObj, bb: { minX:number;minY:number;maxX:number;maxY:number }) {
  const hasTitle = !!obj.text.trim(), hasNote = !!obj.note.trim()
  if (!hasTitle && !hasNote) return
  const innerW = Math.max(10, (bb.maxX - bb.minX) - SHAPE_TEXT_PAD * 2)
  c.save()
  c.fillStyle = obj.color

  if (hasTitle && !hasNote) {
    const lines = wrapTextLines(c, obj.text, innerW, obj.fontSize, '600')
    const lineH = obj.fontSize * 1.25
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2
    c.font = `600 ${obj.fontSize}px sans-serif`
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'
    let y = cy - (lines.length * lineH) / 2 + lineH * 0.78
    for (const ln of lines) { c.fillText(ln, cx, y); y += lineH }
    c.restore(); return
  }

  c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  const left = bb.minX + SHAPE_TEXT_PAD
  let y = bb.minY + SHAPE_TEXT_PAD
  if (hasTitle) {
    const lineH = obj.fontSize * 1.25
    c.font = `700 ${obj.fontSize}px sans-serif`
    for (const ln of wrapTextLines(c, obj.text, innerW, obj.fontSize, '700')) { y += lineH; c.fillText(ln, left, y - lineH * 0.22) }
    y += 4
  }
  if (hasNote) {
    const lineH = obj.noteFontSize * 1.3
    c.font = `400 ${obj.noteFontSize}px sans-serif`
    for (const ln of wrapNoteContent(c, obj.note, innerW, obj.noteFontSize, obj.noteListType)) {
      y += lineH
      if (ln.marker) c.fillText(ln.marker, left, y - lineH * 0.3)
      if (ln.text) c.fillText(ln.text, left + ln.indent, y - lineH * 0.3)
    }
  }
  c.restore()
}

function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement): Pt | null {
  const rect = canvas.getBoundingClientRect()
  if ('touches' in e) {
    if (e.touches.length === 0) return null
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
  }
  return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
}

function drawArrowHead(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, sw: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const h = Math.max(12, sw * 3)
  c.beginPath()
  c.moveTo(x2, y2)
  c.lineTo(x2 - h * Math.cos(angle - Math.PI / 6), y2 - h * Math.sin(angle - Math.PI / 6))
  c.moveTo(x2, y2)
  c.lineTo(x2 - h * Math.cos(angle + Math.PI / 6), y2 - h * Math.sin(angle + Math.PI / 6))
  c.stroke()
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  c.beginPath()
  c.moveTo(x + radius, y); c.lineTo(x + w - radius, y)
  c.arcTo(x+w,y,x+w,y+radius,radius); c.lineTo(x+w,y+h-radius)
  c.arcTo(x+w,y+h,x+w-radius,y+h,radius); c.lineTo(x+radius,y+h)
  c.arcTo(x,y+h,x,y+h-radius,radius); c.lineTo(x,y+radius)
  c.arcTo(x,y,x+radius,y,radius); c.closePath()
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2-x1, dy = y2-y1
  if (dx === 0 && dy === 0) return Math.hypot(px-x1, py-y1)
  const t = Math.max(0, Math.min(1, ((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)))
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy))
}

function getObjBB(obj: DrawObj): { minX:number;minY:number;maxX:number;maxY:number } {
  if (obj.type === 'line' || obj.type === 'arrow') return { minX:Math.min(obj.x1,obj.x2),minY:Math.min(obj.y1,obj.y2),maxX:Math.max(obj.x1,obj.x2),maxY:Math.max(obj.y1,obj.y2) }
  if (obj.type === 'stroke') {
    if (obj.pts.length === 0) return { minX:0,minY:0,maxX:0,maxY:0 }
    const xs = obj.pts.map(p=>p.x), ys = obj.pts.map(p=>p.y)
    return { minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys) }
  }
  if (obj.type === 'text') { const est = obj.fontSize*obj.text.length*0.6; return { minX:obj.x,minY:obj.y,maxX:obj.x+est,maxY:obj.y+obj.fontSize } }
  return { minX:Math.min(obj.x,obj.x+obj.w),minY:Math.min(obj.y,obj.y+obj.h),maxX:Math.max(obj.x,obj.x+obj.w),maxY:Math.max(obj.y,obj.y+obj.h) }
}

function hitObj(obj: DrawObj, px: number, py: number, thresh = 8): boolean {
  if (obj.type === 'line' || obj.type === 'arrow') return distToSeg(px,py,obj.x1,obj.y1,obj.x2,obj.y2) < thresh
  if (obj.type === 'stroke') return obj.pts.some(pt => Math.hypot(pt.x-px,pt.y-py) < thresh+obj.sw/2)
  const { minX,minY,maxX,maxY } = getObjBB(obj)
  // Rotated shapes are tested in their own local (unrotated) space — inverse-
  // rotate the pointer around the shape's center before the plain bbox test.
  if (obj.rotation && ROTATABLE_TYPES.includes(obj.type)) {
    const center = { x: (minX+maxX)/2, y: (minY+maxY)/2 }
    const local = rotatePt({ x: px, y: py }, center, -obj.rotation)
    px = local.x; py = local.y
  }
  if (obj.type === 'text' || obj.type === 'image') return px>=minX&&px<=maxX&&py>=minY&&py<=maxY
  // Any reasonable visible portion of a shape selects it — including an
  // unfilled shape's hollow interior, not just its border band.
  return px>=minX-thresh&&px<=maxX+thresh&&py>=minY-thresh&&py<=maxY+thresh
}

function renderObj(c: CanvasRenderingContext2D, obj: DrawObj, imgCache?: Map<string, HTMLImageElement>, onImgLoad?: () => void) {
  c.save()
  c.strokeStyle = obj.color; c.fillStyle = obj.filled ? obj.fillColor : obj.color
  c.lineWidth = obj.sw; c.lineCap = 'round'; c.lineJoin = 'round'

  if (obj.type === 'stroke') {
    if (obj.pts.length < 2) { c.restore(); return }
    c.strokeStyle = obj.eraser ? '#ffffff' : obj.color
    c.beginPath(); c.moveTo(obj.pts[0].x, obj.pts[0].y)
    for (const pt of obj.pts.slice(1)) c.lineTo(pt.x, pt.y)
    c.stroke(); c.restore(); return
  }

  if (obj.type === 'text') {
    c.fillStyle = obj.color; c.font = `${obj.fontSize}px sans-serif`
    c.fillText(obj.text, obj.x, obj.y + obj.fontSize * 0.8)
    c.restore(); return
  }

  if (obj.type === 'line') {
    c.beginPath(); c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2); c.stroke()
    c.restore(); return
  }

  if (obj.type === 'arrow') {
    const isElbow = obj.connType === 'elbow' || obj.connType === 'elbow-curved'
    // V1: the elbow corner is always derived from the endpoints — a vertical
    // trunk down from the start, then horizontal to the end — never a stored,
    // draggable vertex. Guarantees the clean default geometry every time.
    const cornerX = obj.x1, cornerY = obj.y2
    c.beginPath()
    if (obj.connType === 'curved') { c.moveTo(obj.x1,obj.y1); c.quadraticCurveTo(obj.mx,obj.my,obj.x2,obj.y2) }
    else if (obj.connType === 'elbow') { c.moveTo(obj.x1,obj.y1); c.lineTo(cornerX,cornerY); c.lineTo(obj.x2,obj.y2) }
    else if (obj.connType === 'elbow-curved') {
      // Same two-segment elbow route as 'elbow', but with a rounded corner —
      // arcTo is the same technique roundRect() already uses for round-rect corners.
      const leg1 = Math.hypot(cornerX-obj.x1, cornerY-obj.y1)
      const leg2 = Math.hypot(obj.x2-cornerX, obj.y2-cornerY)
      const r = Math.max(0, Math.min(16, leg1/2, leg2/2))
      c.moveTo(obj.x1,obj.y1)
      c.arcTo(cornerX,cornerY,obj.x2,obj.y2,r)
      c.lineTo(obj.x2,obj.y2)
    }
    else { c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2) }
    c.stroke()
    const tx = isElbow ? cornerX : (obj.connType !== 'straight' ? obj.mx : obj.x1)
    const ty = isElbow ? cornerY : (obj.connType !== 'straight' ? obj.my : obj.y1)
    drawArrowHead(c, tx, ty, obj.x2, obj.y2, obj.sw)
    c.restore(); return
  }

  const bb = getObjBB(obj)
  const shapeCx = (bb.minX+bb.maxX)/2, shapeCy = (bb.minY+bb.maxY)/2
  c.save() // outer: rotation (also wraps the label, so text rotates with the shape)
  if (obj.rotation && ROTATABLE_TYPES.includes(obj.type)) {
    c.translate(shapeCx,shapeCy); c.rotate(obj.rotation); c.translate(-shapeCx,-shapeCy)
  }
  c.save() // inner: flip (label is drawn after this restores, so it's never mirrored)
  if (obj.flipX || obj.flipY) {
    c.translate(shapeCx,shapeCy); c.scale(obj.flipX?-1:1, obj.flipY?-1:1); c.translate(-shapeCx,-shapeCy)
  }
  if (obj.type === 'image') {
    const img = imgCache ? getCachedImage(imgCache, obj.src, onImgLoad ?? (() => {})) : null
    if (img) c.drawImage(img, obj.x, obj.y, obj.w, obj.h)
  }
  else if (obj.type === 'rect') { c.beginPath(); c.rect(obj.x,obj.y,obj.w,obj.h); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'rect-r') { roundRect(c,obj.x,obj.y,obj.w,obj.h,10); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'circle') { c.beginPath(); c.ellipse(obj.x+obj.w/2,obj.y+obj.h/2,Math.abs(obj.w)/2,Math.abs(obj.h)/2,0,0,Math.PI*2); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'triangle') { c.beginPath(); c.moveTo(obj.x+obj.w/2,obj.y); c.lineTo(obj.x+obj.w,obj.y+obj.h); c.lineTo(obj.x,obj.y+obj.h); c.closePath(); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'diamond') { c.beginPath(); c.moveTo(obj.x+obj.w/2,obj.y); c.lineTo(obj.x+obj.w,obj.y+obj.h/2); c.lineTo(obj.x+obj.w/2,obj.y+obj.h); c.lineTo(obj.x,obj.y+obj.h/2); c.closePath(); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'starburst') { drawStarburstPath(c,obj.x,obj.y,obj.w,obj.h); if (obj.filled) c.fill(); c.stroke() }
  c.restore() // undo flip only — label below rotates with the shape but is never mirrored

  if (TEXT_CAPABLE_TYPES.includes(obj.type)) drawShapeText(c, obj, bb)
  c.restore() // undo rotation
  c.restore() // pairs with the outer save at the top of this function
}

// Returns SCREEN-space handle positions — rotated around the shape's own
// center when the object has a rotation, so they sit on the visually-rotated
// shape (and hit-testing against them, which iterates these same positions,
// stays correct automatically). A no-op for rotation 0, i.e. every object
// that isn't a rotated shape — unchanged from the original behavior.
function getHandlePositions(obj: DrawObj): Array<{ pos: HPos; x: number; y: number }> {
  const { minX,minY,maxX,maxY } = getObjBB(obj)
  const mx = (minX+maxX)/2, my = (minY+maxY)/2
  const local: Array<{ pos: HPos; x: number; y: number }> = [
    {pos:'nw',x:minX,y:minY},{pos:'n',x:mx,y:minY},{pos:'ne',x:maxX,y:minY},
    {pos:'e',x:maxX,y:my},{pos:'se',x:maxX,y:maxY},
    {pos:'s',x:mx,y:maxY},{pos:'sw',x:minX,y:maxY},{pos:'w',x:minX,y:my},
  ]
  if (!obj.rotation || !ROTATABLE_TYPES.includes(obj.type)) return local
  const center = { x: mx, y: my }
  return local.map(h => ({ pos: h.pos, ...rotatePt({ x: h.x, y: h.y }, center, obj.rotation) }))
}

// The rotation handle's SCREEN position for a single rotatable object — a
// fixed distance above its own (rotated) top-center.
function getRotateHandlePos(obj: DrawObj): Pt {
  const { minX,minY,maxX,maxY } = getObjBB(obj)
  const center = { x: (minX+maxX)/2, y: (minY+maxY)/2 }
  const local = { x: center.x, y: minY - 26 }
  return obj.rotation ? rotatePt(local, center, obj.rotation) : local
}

function drawHandleDot(c: CanvasRenderingContext2D, x: number, y: number, fill = '#ffffff') {
  c.save(); c.setLineDash([]); c.fillStyle = fill; c.strokeStyle = '#7c3aed'; c.lineWidth = 1.5
  c.beginPath(); c.rect(x-4,y-4,8,8); c.fill(); c.stroke(); c.restore()
}

// Round, distinct from the square resize handles — a different shape reads
// as a different action at a glance.
function drawRotateHandle(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save(); c.setLineDash([]); c.fillStyle = '#ffffff'; c.strokeStyle = '#7c3aed'; c.lineWidth = 1.5
  c.beginPath(); c.arc(x, y, 5, 0, Math.PI*2); c.fill(); c.stroke(); c.restore()
}

// ─── EraserIcon ───────────────────────────────────────────────────────────────
// A clean, tilted wedge-eraser silhouette — no size letter baked in, so the
// toolbar shows only the icon (the size lives in the popover, same as Pen).

const EraserIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ display:'block', transform:'rotate(-25deg)' }}>
    <rect x="4" y="6.5" width="12" height="8" rx="1.5" fill="currentColor" opacity="0.85"/>
    <path d="M4 10.5H16V14.5A1.5 1.5 0 0 1 14.5 16H5.5A1.5 1.5 0 0 1 4 14.5Z" fill="currentColor" opacity="0.4"/>
    <rect x="4" y="6.5" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1"/>
  </svg>
)

// ─── TrashIcon ────────────────────────────────────────────────────────────────

const TrashIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display:'block' }}>
    <path d="M3 4.5H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M5.5 4.5V3.2C5.5 2.7 5.9 2.3 6.4 2.3H9.6C10.1 2.3 10.5 2.7 10.5 3.2V4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4.2 4.5L4.8 13C4.85 13.55 5.3 14 5.85 14H10.15C10.7 14 11.15 13.55 11.2 13L11.8 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6.5 7V11.5M9.5 7V11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

// ─── Fit / Restore icons ──────────────────────────────────────────────────────
// Two clearly distinct states: outward corner brackets (expand) vs inward
// corner brackets (collapse) — communicates the action that will happen next.

const FitIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display:'block' }}>
    <path d="M6 2H3a1 1 0 0 0-1 1v3M10 2h3a1 1 0 0 1 1 1v3M6 14H3a1 1 0 0 1-1-1v-3M10 14h3a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const RestoreIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display:'block' }}>
    <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// ─── ElbowArrowIcon ───────────────────────────────────────────────────────────
// Two visual variants of the same connector: identical L-shaped route and arrowhead,
// differing only in whether the corner is a hard 90° or a smoothly rounded turn.

const ElbowArrowIcon = ({ curved = false, size = 15 }: { curved?: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display:'block' }}>
    {curved
      ? <path d="M7 4 L7 11 Q7 16 12 16 L17 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      : <path d="M7 4 L7 16 L17 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>}
    <path d="M13.5 12 L18.5 16 L13.5 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
)

// ─── Component ────────────────────────────────────────────────────────────────

export function JournalDrawModal({ isDark: isDarkApp, initialSrc, initialObjects, onSave, onClose }: JournalDrawModalProps) {
  // The toolbar always uses a subtle light-gray chrome regardless of app theme
  // (per XPadite spec — the toolbar must never go dark/heavy), so every
  // existing `isDark`-branched style below the toolbar now resolves to its
  // light branch automatically. The two outer-wrapper backgrounds that should
  // still follow the real app theme use `isDarkApp` explicitly instead.
  const isDark = false
  const { customColors, addCustomColor, setToast } = useApp()
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const bgImgRef    = useRef<HTMLImageElement | null>(null)
  const objectsRef  = useRef<DrawObj[]>([])
  const selIdsRef   = useRef<string[]>([])
  const historyRef  = useRef<string[]>([])
  const redoRef     = useRef<string[]>([])
  const dragRef     = useRef<DragMode>(null)
  const alignGuidesRef = useRef<Array<{ axis:'v'|'h'; pos:number }>>([]) // active snap guides while moving
  const snapTargetRef  = useRef<string | null>(null) // shape id a connector endpoint is currently hovering/snapping to
  const activeRef   = useRef<DrawObj | null>(null)
  const isDownRef   = useRef(false)
  const shapeStart  = useRef<Pt | null>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const lastTapRef  = useRef<{ id: string; ts: number } | null>(null)

  const [tool,        setTool]        = useState<DrawTool>('pen')
  const [penIdx,      setPenIdx]      = useState(1)
  const [eraserIdx,   setEraserIdx]   = useState(1)
  const [textSzIdx,   setTextSzIdx]   = useState(1)
  const [drawColor,   setDrawColor]   = useState('#1a1a1a')
  const [fillColor,   setFillColor]   = useState('#7c3aed')
  const [filled,      setFilled]      = useState(false)
  const [fitToScreen, setFitToScreen] = useState(false)
  const [canUndo,     setCanUndo]     = useState(false)
  const [canRedo,     setCanRedo]     = useState(false)
  const [objects,     setObjects]     = useState<DrawObj[]>([])
  const [selIds,      setSelIds]      = useState<string[]>([])
  const [textInput,   setTextInput]   = useState<{ x:number; y:number; w?:number; value:string; targetId?:string; noteValue?:string; activeField?:EditField; titleFontSize?:number; noteFontSizeLive?:number } | null>(null)
  const [openPopover, setOpenPopover] = useState<PopoverId | null>(null)
  const [popAnchor,   setPopAnchor]   = useState<{ top:number; left:number } | null>(null)
  const [arrowConnDefault, setArrowConnDefault] = useState<ConnType>('elbow')
  const [showCustomFill, setShowCustomFill] = useState(false)
  const [lineThickIdx,  setLineThickIdx]  = useState(1) // index into THICKNESS_LEVELS — default new-line thickness
  const [arrowThickIdx, setArrowThickIdx] = useState(1) // same, for new arrows

  // ── sync helpers ───────────────────────────────────────────────────────────
  function syncObjs(objs: DrawObj[]) { objectsRef.current = objs; setObjects(objs) }
  function syncSel(ids: string[])    { selIdsRef.current  = ids;  setSelIds(ids)   }

  // ── Canvas init ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const w   = wrap.offsetWidth  || 720
      const h   = wrap.offsetHeight || 480
      canvas.width  = w * dpr; canvas.height = h * dpr
      canvas.style.width = w+'px'; canvas.style.height = h+'px'
      const c = canvas.getContext('2d')!; c.scale(dpr, dpr)
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h)

      // Re-editing: real objects (from JournalBlock.canvasData) take priority
      // over the flattened PNG — they stay individually selectable/movable/
      // resizable/rotatable exactly as if the canvas had never closed.
      let restored: DrawObj[] | null = null
      if (initialObjects) {
        try {
          const parsed = JSON.parse(initialObjects)
          if (Array.isArray(parsed)) restored = parsed.map(o => mkObj(o))
        } catch { /* malformed/old data — fall back to the flat image below */ }
      }
      if (restored) {
        // setObjects below re-renders via the existing
        // useEffect(() => renderAll(), [objects, selIds]) — no explicit call needed.
        const resolved = resolveAttachments(restored)
        syncObjs(resolved)
        historyRef.current = [JSON.stringify(resolved)]; setCanUndo(false); setCanRedo(false)
      } else if (initialSrc) {
        // No object data (a drawing saved before canvasData existed) — load
        // the old flattened PNG as a background, exactly as before.
        const img = new Image()
        img.onload = () => { bgImgRef.current = img; c.drawImage(img,0,0,w,h); historyRef.current = ['[]']; setCanUndo(false); setCanRedo(false) }
        img.src = initialSrc
      } else {
        historyRef.current = ['[]']; setCanUndo(false); setCanRedo(false)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── renderAll ─────────────────────────────────────────────────────────────
  function renderAll(forSave = false) {
    const canvas = canvasRef.current; if (!canvas) return
    const c = canvas.getContext('2d')!
    const w = canvas.offsetWidth, h = canvas.offsetHeight
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h)
    if (bgImgRef.current) c.drawImage(bgImgRef.current, 0, 0, w, h)
    for (const obj of objectsRef.current) renderObj(c, obj, imageCacheRef.current, () => renderAll())
    if (!forSave) {
      if (activeRef.current) renderObj(c, activeRef.current, imageCacheRef.current, () => renderAll())
      const dm = dragRef.current
      if (dm?.kind === 'marquee') {
        const mx = Math.min(dm.start.x,dm.cur.x), my = Math.min(dm.start.y,dm.cur.y)
        const mw = Math.abs(dm.cur.x-dm.start.x), mh = Math.abs(dm.cur.y-dm.start.y)
        c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([4,3]); c.fillStyle='rgba(124,58,237,0.05)'
        c.fillRect(mx,my,mw,mh); c.strokeRect(mx,my,mw,mh); c.restore()
      }
      // Smart-alignment guides — only visible while actively snapped during a move
      if (dm?.kind === 'move' && alignGuidesRef.current.length > 0) {
        c.save(); c.strokeStyle = '#ec4899'; c.lineWidth = 1; c.setLineDash([5,4])
        for (const g of alignGuidesRef.current) {
          c.beginPath()
          if (g.axis === 'v') { c.moveTo(g.pos, 0); c.lineTo(g.pos, h) } else { c.moveTo(0, g.pos); c.lineTo(w, g.pos) }
          c.stroke()
        }
        c.restore()
      }
      // Connector snap feedback — a restrained highlight around whichever shape
      // the dragged endpoint is currently about to attach to.
      if (dm?.kind === 'endpoint' && snapTargetRef.current) {
        const target = objectsRef.current.find(o => o.id === snapTargetRef.current)
        if (target) {
          const bb = getObjBB(target)
          c.save(); c.strokeStyle = '#7c3aed'; c.lineWidth = 2; c.setLineDash([])
          c.strokeRect(bb.minX-4, bb.minY-4, bb.maxX-bb.minX+8, bb.maxY-bb.minY+8)
          c.restore()
        }
      }
      if (selIdsRef.current.length > 0) renderSelHandles(c)
    }
  }

  function renderSelHandles(c: CanvasRenderingContext2D) {
    const ids = selIdsRef.current
    const objs = objectsRef.current.filter(o => ids.includes(o.id))
    if (objs.length === 0) return
    if (objs.length > 1) {
      const bbs = objs.map(getObjBB)
      const minX = Math.min(...bbs.map(b=>b.minX)), minY = Math.min(...bbs.map(b=>b.minY))
      const maxX = Math.max(...bbs.map(b=>b.maxX)), maxY = Math.max(...bbs.map(b=>b.maxY))
      c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([4,3])
      c.strokeRect(minX-6, minY-6, maxX-minX+12, maxY-minY+12); c.restore()
      drawHandleDot(c, (minX+maxX)/2, minY-6, '#ede9fe')
      // Group rotation handle — rotates the whole selection around the group's center
      const gcx = (minX+maxX)/2, gTop = minY-6, gHandleY = gTop-20
      c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([2,2])
      c.beginPath(); c.moveTo(gcx,gTop); c.lineTo(gcx,gHandleY); c.stroke(); c.restore()
      drawRotateHandle(c, gcx, gHandleY)
      return
    }
    const obj = objs[0]
    c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([4,3])
    if (obj.type === 'line' || obj.type === 'arrow') {
      c.beginPath(); c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2); c.stroke(); c.restore()
      drawHandleDot(c, obj.x1, obj.y1); drawHandleDot(c, obj.x2, obj.y2)
      // V1: elbow corners are derived, not editable — no bend handle for them.
      if (!(obj.type === 'arrow' && (obj.connType === 'elbow' || obj.connType === 'elbow-curved'))) {
        drawHandleDot(c, obj.mx, obj.my, '#ede9fe')
      }
      return
    }
    if (obj.type === 'text') {
      const bb = getObjBB(obj)
      c.strokeRect(bb.minX-4, bb.minY-4, bb.maxX-bb.minX+8, bb.maxY-bb.minY+8)
      c.restore(); return
    }
    const { minX,minY,maxX,maxY } = getObjBB(obj)
    c.strokeRect(minX-2, minY-2, maxX-minX+4, maxY-minY+4); c.restore()
    for (const h of getHandlePositions(obj)) drawHandleDot(c, h.x, h.y)
    // Strokes rotate via direct point-rotation (no stored angle/render transform,
    // so no inverse-rotate needed below) rather than through ROTATABLE_TYPES —
    // still get the same solo rotation handle as shapes.
    if (ROTATABLE_TYPES.includes(obj.type) || obj.type === 'stroke') {
      const center = { x:(minX+maxX)/2, y:(minY+maxY)/2 }
      const topScreen = obj.rotation ? rotatePt({x:center.x,y:minY}, center, obj.rotation) : { x:center.x, y:minY }
      const rp = getRotateHandlePos(obj)
      c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([2,2])
      c.beginPath(); c.moveTo(topScreen.x,topScreen.y); c.lineTo(rp.x,rp.y); c.stroke(); c.restore()
      drawRotateHandle(c, rp.x, rp.y)
    }
  }

  // ── useEffect re-render ────────────────────────────────────────────────────
  useEffect(() => { renderAll() }, [objects, selIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hit testing ────────────────────────────────────────────────────────────
  type ItTarget = {kind:'none'} | {kind:'object';id:string} | {kind:'handle';id:string;which:HPos|'start'|'end'|'mid'} | {kind:'rotate';ids:string[]}

  function getTarget(px: number, py: number): ItTarget {
    const HR = 10

    // Rotation handle(s) — checked first since they sit outside every other
    // hit region and never overlap resize/endpoint handles.
    const selObjsNow = objectsRef.current.filter(o => selIdsRef.current.includes(o.id))
    if (selObjsNow.length === 1 && (ROTATABLE_TYPES.includes(selObjsNow[0].type) || selObjsNow[0].type === 'stroke')) {
      const rp = getRotateHandlePos(selObjsNow[0])
      if (Math.hypot(rp.x-px, rp.y-py) < HR) return {kind:'rotate', ids:[selObjsNow[0].id]}
    } else if (selObjsNow.length > 1) {
      const bbs = selObjsNow.map(getObjBB)
      const minX = Math.min(...bbs.map(b=>b.minX)), maxX = Math.max(...bbs.map(b=>b.maxX))
      const minY = Math.min(...bbs.map(b=>b.minY))
      const gx = (minX+maxX)/2, gy = minY-6-20
      if (Math.hypot(gx-px, gy-py) < HR) return {kind:'rotate', ids:selIdsRef.current}
    }

    for (const id of selIdsRef.current) {
      const obj = objectsRef.current.find(o => o.id === id); if (!obj) continue
      if (obj.type === 'line' || obj.type === 'arrow') {
        if (Math.hypot(obj.x1-px,obj.y1-py) < HR) return {kind:'handle',id,which:'start'}
        if (Math.hypot(obj.x2-px,obj.y2-py) < HR) return {kind:'handle',id,which:'end'}
        const hasBendHandle = !(obj.type === 'arrow' && (obj.connType === 'elbow' || obj.connType === 'elbow-curved'))
        if (hasBendHandle && Math.hypot(obj.mx-px,obj.my-py) < HR) return {kind:'handle',id,which:'mid'}
      } else if (obj.type !== 'text') {
        for (const h of getHandlePositions(obj)) {
          if (Math.hypot(h.x-px,h.y-py) < HR) return {kind:'handle',id,which:h.pos}
        }
      }
    }
    for (const obj of [...objectsRef.current].reverse()) {
      if (hitObj(obj, px, py)) return {kind:'object',id:obj.id}
    }
    return {kind:'none'}
  }

  function expandGroup(ids: string[]): string[] {
    const gids = new Set(ids.map(id => objectsRef.current.find(o=>o.id===id)?.gid??'').filter(Boolean))
    if (gids.size === 0) return ids
    return [...new Set([...ids, ...objectsRef.current.filter(o=>o.gid&&gids.has(o.gid)).map(o=>o.id)])]
  }

  // ── Pointer events ─────────────────────────────────────────────────────────
  function beginStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getPos(e, canvas); if (!pos) return
    setOpenPopover(null); isDownRef.current = true

    if (tool === 'text') {
      if (textInput) commitText()
      setTextInput({ x:pos.x, y:pos.y, value:'' }); return
    }

    if (tool === 'select') {
      const target = getTarget(pos.x, pos.y)
      if (target.kind === 'rotate') {
        const objs = objectsRef.current.filter(o => target.ids.includes(o.id))
        const pivot = getGroupPivot(objs)
        const baseline = new Map<string, RotateBaseline>()
        for (const o of objs) baseline.set(o.id, {x:o.x,y:o.y,w:o.w,h:o.h,x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,mx:o.mx,my:o.my,rotation:o.rotation})
        dragRef.current = { kind:'rotate', ids:target.ids, pivot, startAngle: Math.atan2(pos.y-pivot.y, pos.x-pivot.x), baseline }
        return
      }
      if (target.kind === 'handle') {
        const obj = objectsRef.current.find(o=>o.id===target.id)!
        if (target.which === 'start' || target.which === 'end' || target.which === 'mid') {
          dragRef.current = {kind:'endpoint',id:target.id,which:target.which,start:pos}
        } else {
          dragRef.current = {kind:'resize',id:target.id,handle:target.which as HPos,orig:{...obj,pts:[...obj.pts]},start:pos}
        }
        return
      }
      if (target.kind === 'object') {
        // Mobile/tablet: a second tap on the same object within 400ms enters
        // text-edit mode, mirroring desktop's double-click (there's no reliable
        // native dblclick on touch, so this is detected manually).
        if ('touches' in e) {
          const ts = now()
          const last = lastTapRef.current
          if (last && last.id === target.id && ts - last.ts < 400) {
            lastTapRef.current = null
            const obj = objectsRef.current.find(o => o.id === target.id)
            if (obj && TEXT_CAPABLE_TYPES.includes(obj.type)) { startShapeTextEdit(obj); return }
          } else {
            lastTapRef.current = { id: target.id, ts }
          }
        }
        const expanded = expandGroup([target.id])
        const isAlreadySel = selIdsRef.current.includes(target.id)
        const isShift = 'shiftKey' in e && (e as React.MouseEvent).shiftKey
        let newSel: string[]
        if (isShift) {
          newSel = isAlreadySel ? selIdsRef.current.filter(id=>!expanded.includes(id)) : [...new Set([...selIdsRef.current,...expanded])]
        } else {
          newSel = isAlreadySel ? selIdsRef.current : expanded
        }
        syncSel(newSel)
        const snap = new Map<string,{x:number;y:number;w:number;h:number;x1:number;y1:number;x2:number;y2:number;mx:number;my:number;pts:Pt[]}>()
        for (const id of newSel) { const o = objectsRef.current.find(ob=>ob.id===id)!; snap.set(id,{x:o.x,y:o.y,w:o.w,h:o.h,x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,mx:o.mx,my:o.my,pts:[...o.pts]}) }
        dragRef.current = {kind:'move',ids:newSel,start:pos,snap}
        renderAll(); return
      }
      syncSel([]); dragRef.current = {kind:'marquee',start:pos,cur:pos}; renderAll(); return
    }

    const sw = tool === 'eraser' ? ERASER_SIZES[eraserIdx] : PEN_SIZES[penIdx]
    if (tool === 'pen' || tool === 'eraser') {
      activeRef.current = mkObj({id:uid(),type:'stroke',color:drawColor,sw,eraser:tool==='eraser',pts:[pos]})
      renderAll(); return
    }
    shapeStart.current = pos
    const shapeSw = tool==='line' ? THICKNESS_LEVELS[lineThickIdx] : tool==='arrow' ? THICKNESS_LEVELS[arrowThickIdx] : PEN_SIZES[penIdx]
    activeRef.current = mkObj({id:uid(),type:tool as ObjType,color:drawColor,fillColor,filled,sw:shapeSw,connType: tool==='arrow' ? arrowConnDefault : 'straight'})
  }

  function continueStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDownRef.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getPos(e, canvas); if (!pos) return
    const dm = dragRef.current

    if (dm?.kind === 'move') {
      let dx = pos.x-dm.start.x, dy = pos.y-dm.start.y
      const guides: Array<{ axis:'v'|'h'; pos:number }> = []
      const SNAP_THRESH = 6

      // Smart alignment: snap the dragged set's own edges/center to the
      // nearest edge/center of any object NOT being dragged, within a small
      // threshold. The group's relative spacing never changes — the whole
      // delta (dx,dy) just gets nudged by the snap amount before it's applied.
      {
        let gMinX=Infinity,gMinY=Infinity,gMaxX=-Infinity,gMaxY=-Infinity
        for (const id of dm.ids) {
          const orig = objectsRef.current.find(o=>o.id===id); const s = dm.snap.get(id)
          if (!orig || !s) continue
          const fake: DrawObj = {...orig, x:s.x+dx,y:s.y+dy, w:s.w,h:s.h, x1:s.x1+dx,y1:s.y1+dy, x2:s.x2+dx,y2:s.y2+dy, pts:s.pts.map(p=>({x:p.x+dx,y:p.y+dy}))}
          const bb = getObjBB(fake)
          gMinX=Math.min(gMinX,bb.minX); gMinY=Math.min(gMinY,bb.minY); gMaxX=Math.max(gMaxX,bb.maxX); gMaxY=Math.max(gMaxY,bb.maxY)
        }
        if (gMinX !== Infinity) {
          const groupXs = [gMinX, (gMinX+gMaxX)/2, gMaxX]
          const groupYs = [gMinY, (gMinY+gMaxY)/2, gMaxY]
          let bestXDiff = SNAP_THRESH, bestXTarget: number | null = null
          let bestYDiff = SNAP_THRESH, bestYTarget: number | null = null
          for (const other of objectsRef.current) {
            if (dm.ids.includes(other.id)) continue
            const obb = getObjBB(other)
            for (const ox of [obb.minX, (obb.minX+obb.maxX)/2, obb.maxX]) {
              for (const gx of groupXs) {
                const diff = Math.abs(gx-ox)
                if (diff < bestXDiff) { bestXDiff = diff; bestXTarget = ox }
              }
            }
            for (const oy of [obb.minY, (obb.minY+obb.maxY)/2, obb.maxY]) {
              for (const gy of groupYs) {
                const diff = Math.abs(gy-oy)
                if (diff < bestYDiff) { bestYDiff = diff; bestYTarget = oy }
              }
            }
          }
          // Snap by the exact amount needed to land the closest group edge on
          // its match — compare against the ORIGINAL (pre-snap) group edges,
          // since bestXTarget/bestYTarget were found against those.
          if (bestXTarget !== null) {
            const closestGx = groupXs.reduce((a,b)=>Math.abs(b-bestXTarget!)<Math.abs(a-bestXTarget!)?b:a)
            dx += bestXTarget - closestGx
            guides.push({ axis:'v', pos: bestXTarget })
          }
          if (bestYTarget !== null) {
            const closestGy = groupYs.reduce((a,b)=>Math.abs(b-bestYTarget!)<Math.abs(a-bestYTarget!)?b:a)
            dy += bestYTarget - closestGy
            guides.push({ axis:'h', pos: bestYTarget })
          }
        }
      }
      alignGuidesRef.current = guides

      objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
        if (!dm.ids.includes(o.id)) return o
        const s = dm.snap.get(o.id)!
        if (o.type === 'line' || o.type === 'arrow') return {...o,x1:s.x1+dx,y1:s.y1+dy,x2:s.x2+dx,y2:s.y2+dy,mx:s.mx+dx,my:s.my+dy}
        if (o.type === 'stroke') return {...o,pts:s.pts.map(p=>({x:p.x+dx,y:p.y+dy}))}
        return {...o,x:s.x+dx,y:s.y+dy}
      }))
      renderAll(); return
    }

    if (dm?.kind === 'resize') {
      const orig = dm.orig
      const {minX:ox1,minY:oy1,maxX:ox2,maxY:oy2} = getObjBB(orig)
      let nx1=ox1,ny1=oy1,nx2=ox2,ny2=oy2
      const h = dm.handle
      // Resize math always runs in the shape's own LOCAL (unrotated) space —
      // the handles themselves are drawn/hit-tested at their rotated screen
      // position (see getHandlePositions), but dragging one still just moves
      // that corner along the shape's own axes, so inverse-rotate the pointer
      // around the shape's (fixed, pre-resize) center before using it.
      const resizePos = (orig.rotation && ROTATABLE_TYPES.includes(orig.type))
        ? rotatePt(pos, { x:(ox1+ox2)/2, y:(oy1+oy2)/2 }, -orig.rotation)
        : pos
      if (h.includes('w')) nx1=resizePos.x; if (h.includes('e')) nx2=resizePos.x
      if (h.includes('n')) ny1=resizePos.y; if (h.includes('s')) ny2=resizePos.y
      // Text reflows live from the shape's own render (drawShapeText always
      // wraps against the CURRENT w) — the only thing resize itself must do is
      // refuse to go shorter than the Title/Note actually needs at this width.
      if (TEXT_CAPABLE_TYPES.includes(orig.type)) {
        const ctx = canvasRef.current?.getContext('2d')
        if (ctx) {
          const requiredH = computeRequiredHeight(ctx, { ...orig, w: nx2-nx1, h: ny2-ny1 })
          if (Math.abs(ny2-ny1) < requiredH) {
            if (h.includes('n')) ny1 = ny2 - requiredH; else ny2 = ny1 + requiredH
          }
        }
      }
      // Images resize proportionally from a corner handle, like most creative
      // tools — the axis that moved more wins and the other is derived from it.
      if (orig.type === 'image' && (h==='nw'||h==='ne'||h==='se'||h==='sw')) {
        const origW = ox2-ox1, origH = oy2-oy1
        const ratio = origW / (origH || 1)
        const newW = nx2-nx1, newH = ny2-ny1
        if (Math.abs(newW-origW) > Math.abs(newH-origH)) {
          const adjH = newW / ratio
          if (h==='nw'||h==='ne') ny1 = ny2-adjH; else ny2 = ny1+adjH
        } else {
          const adjW = newH * ratio
          if (h==='nw'||h==='sw') nx1 = nx2-adjW; else nx2 = nx1+adjW
        }
      }
      // Freehand strokes have no x/y/w/h-driven render path — scale the actual
      // point geometry from the ORIGINAL (drag-start) points into the new bbox
      // so the drawing visually scales with the handles, same as any shape.
      if (orig.type === 'stroke') {
        const origW = ox2-ox1 || 1, origH = oy2-oy1 || 1
        const sx = (nx2-nx1) / origW, sy = (ny2-ny1) / origH
        const scaledPts = orig.pts.map(p => ({ x: nx1 + (p.x-ox1)*sx, y: ny1 + (p.y-oy1)*sy }))
        objectsRef.current = objectsRef.current.map(o => o.id!==dm.id?o:{...o,x:nx1,y:ny1,w:nx2-nx1,h:ny2-ny1,pts:scaledPts})
        renderAll(); return
      }
      objectsRef.current = resolveAttachments(objectsRef.current.map(o => o.id!==dm.id?o:{...o,x:nx1,y:ny1,w:nx2-nx1,h:ny2-ny1}))
      renderAll(); return
    }

    if (dm?.kind === 'endpoint') {
      if (dm.which === 'start' || dm.which === 'end') {
        const attach = findAttachTarget(objectsRef.current, dm.id, pos)
        snapTargetRef.current = attach?.target.id ?? null
        objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
          if (o.id !== dm.id) return o
          if (attach) {
            const p = getPerimeterPoint(attach.target, attach.angle)
            return dm.which === 'start'
              ? { ...o, x1:p.x, y1:p.y, attachStartId:attach.target.id, attachStartAngle:attach.angle }
              : { ...o, x2:p.x, y2:p.y, attachEndId:attach.target.id, attachEndAngle:attach.angle }
          }
          return dm.which === 'start'
            ? { ...o, x1:pos.x, y1:pos.y, attachStartId:null }
            : { ...o, x2:pos.x, y2:pos.y, attachEndId:null }
        }))
        renderAll(); return
      }
      // Mid/bend-handle drag — elbow corners are always derived (no handle is
      // ever hit-tested for them, see getTarget), so this only ever runs for
      // the free-form 'curved' control point; it never attaches to a shape.
      objectsRef.current = objectsRef.current.map(o => {
        if (o.id !== dm.id) return o
        if (o.type === 'arrow' && o.connType === 'straight') return {...o,mx:pos.x,my:pos.y,connType:'curved' as ConnType}
        return {...o,mx:pos.x,my:pos.y}
      })
      renderAll(); return
    }

    if (dm?.kind === 'rotate') {
      const angleNow = Math.atan2(pos.y-dm.pivot.y, pos.x-dm.pivot.x)
      const delta = angleNow - dm.startAngle
      objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
        const base = dm.baseline.get(o.id); if (!base) return o
        if (o.type === 'line' || o.type === 'arrow') {
          const p1 = rotatePt({x:base.x1,y:base.y1}, dm.pivot, delta)
          const p2 = rotatePt({x:base.x2,y:base.y2}, dm.pivot, delta)
          const pm = rotatePt({x:base.mx,y:base.my}, dm.pivot, delta)
          return {...o, x1:p1.x,y1:p1.y, x2:p2.x,y2:p2.y, mx:pm.x,my:pm.y}
        }
        if (o.type === 'stroke') {
          return {...o, pts: o.pts.map(p => rotatePt(p, dm.pivot, delta))}
        }
        // Shapes/text/image: rotate the bbox center around the pivot (repositions
        // it for a multi-select group; a no-op position-wise for a single
        // selection, since its own center IS the pivot) and add the delta to
        // its own stored rotation so the shape itself visually spins in place.
        const bw = base.w, bh = base.h
        const baseCenter = { x: base.x+bw/2, y: base.y+bh/2 }
        const newCenter = rotatePt(baseCenter, dm.pivot, delta)
        return {...o, x:newCenter.x-bw/2, y:newCenter.y-bh/2, rotation: (base.rotation||0)+delta}
      }))
      renderAll(); return
    }

    if (dm?.kind === 'marquee') { dragRef.current = {...dm,cur:pos}; renderAll(); return }

    if (activeRef.current?.type === 'stroke') {
      activeRef.current = {...activeRef.current,pts:[...activeRef.current.pts,pos]}
      renderAll(); return
    }

    const start = shapeStart.current
    if (!start || !activeRef.current) return
    const type = activeRef.current.type
    if (type === 'line' || type === 'arrow') {
      activeRef.current = {...activeRef.current,x1:start.x,y1:start.y,x2:pos.x,y2:pos.y,mx:(start.x+pos.x)/2,my:(start.y+pos.y)/2}
    } else {
      activeRef.current = {...activeRef.current,x:start.x,y:start.y,w:pos.x-start.x,h:pos.y-start.y}
    }
    renderAll()
  }

  function endStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDownRef.current) return
    isDownRef.current = false
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getPos(e, canvas)
    const dm  = dragRef.current

    if (dm?.kind === 'move' || dm?.kind === 'resize' || dm?.kind === 'endpoint' || dm?.kind === 'rotate') {
      dragRef.current = null; alignGuidesRef.current = []; snapTargetRef.current = null
      syncObjs(objectsRef.current); snapshot(objectsRef.current); renderAll(); return
    }

    if (dm?.kind === 'marquee') {
      const {start,cur} = dm; dragRef.current = null
      const mx=Math.min(start.x,cur.x),my=Math.min(start.y,cur.y),mw=Math.abs(cur.x-start.x),mh=Math.abs(cur.y-start.y)
      if (mw>4&&mh>4) {
        const inside = objectsRef.current.filter(o=>{const bb=getObjBB(o);return bb.minX>=mx&&bb.maxX<=mx+mw&&bb.minY>=my&&bb.maxY<=my+mh}).map(o=>o.id)
        syncSel(expandGroup(inside))
      }
      renderAll(); return
    }

    const active = activeRef.current; activeRef.current = null
    if (!active) { renderAll(); return }

    if (active.type === 'stroke') {
      if (active.pts.length >= 2) { const n=[...objectsRef.current,active]; syncObjs(n); snapshot(n) }
      renderAll(); return
    }

    if (active.type === 'line' || active.type === 'arrow') {
      if (!pos||!shapeStart.current){renderAll();return}
      if (Math.hypot(pos.x-shapeStart.current.x,pos.y-shapeStart.current.y)>4) {
        const x1=shapeStart.current.x, y1=shapeStart.current.y, x2=pos.x, y2=pos.y
        // Elbow corners are always derived from (x1,y2) at render time — see
        // renderObj — so no special-cased default coordinates are needed here.
        const obj={...active,x1,y1,x2,y2,connType: active.type==='arrow' ? arrowConnDefault : active.connType,mx:(x1+x2)/2,my:(y1+y2)/2}
        const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); syncSel([obj.id])
      }
    } else {
      if (!pos||!shapeStart.current){renderAll();return}
      if (Math.abs(pos.x-shapeStart.current.x)>4&&Math.abs(pos.y-shapeStart.current.y)>4) {
        const obj={...active,x:shapeStart.current.x,y:shapeStart.current.y,w:pos.x-shapeStart.current.x,h:pos.y-shapeStart.current.y}
        const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); syncSel([obj.id])
      }
    }
    shapeStart.current=null; renderAll()
  }

  // ── History ────────────────────────────────────────────────────────────────
  function snapshot(objs: DrawObj[]) {
    historyRef.current=[...historyRef.current,JSON.stringify(objs)]; redoRef.current=[]
    setCanUndo(historyRef.current.length>1); setCanRedo(false)
  }

  function undo() {
    if (historyRef.current.length<=1) return
    const h=[...historyRef.current]; redoRef.current=[...redoRef.current,h.pop()!]; historyRef.current=h
    const restored=JSON.parse(h[h.length-1]) as DrawObj[]
    syncObjs(restored); syncSel([]); setCanUndo(h.length>1); setCanRedo(true); renderAll()
  }

  function redo() {
    if (redoRef.current.length===0) return
    const r=[...redoRef.current]; const next=r.pop()!; historyRef.current=[...historyRef.current,next]; redoRef.current=r
    const restored=JSON.parse(next) as DrawObj[]
    syncObjs(restored); syncSel([]); setCanUndo(true); setCanRedo(r.length>0); renderAll()
  }

  function clearAll() {
    bgImgRef.current=null; syncObjs([]); syncSel([]); snapshot([]); renderAll()
  }

  function handleSave() {
    if (textInput) commitText()
    const canvas = canvasRef.current; if (!canvas) return
    const off = document.createElement('canvas')
    off.width=canvas.width; off.height=canvas.height
    const c=off.getContext('2d')!; const dpr=window.devicePixelRatio||1; c.scale(dpr,dpr)
    const w=canvas.offsetWidth, h=canvas.offsetHeight
    c.fillStyle='#ffffff'; c.fillRect(0,0,w,h)
    if (bgImgRef.current) c.drawImage(bgImgRef.current,0,0,w,h)
    for (const obj of objectsRef.current) renderObj(c, obj, imageCacheRef.current)
    // PNG stays the thumbnail/preview shown everywhere else; the object list
    // is what makes reopening the canvas resume as a REAL editable Mind Map
    // instead of a flattened picture — see JournalBlock.canvasData.
    onSave(off.toDataURL('image/png'), JSON.stringify(objectsRef.current))
    setToast('Mind Map saved ✓')
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  // Opens a floating Title+Note panel over the shape's own bounding box, tagged
  // with targetId so commitText() writes into that shape instead of creating a
  // new free-floating text object. Both fields are plain text — Note's markers
  // (bullet/numbered/lettered) are rendered dynamically from noteListType, never
  // baked into the text, so switching list types can't "stack" formatting.
  function startShapeTextEdit(obj: DrawObj) {
    const bb = getObjBB(obj)
    const cx = (bb.minX+bb.maxX)/2
    const w = Math.max(100, (bb.maxX-bb.minX)-16)
    syncSel([obj.id])
    setTextInput({ x: cx-w/2, y: bb.minY+8, w, value: obj.text ?? '', noteValue: obj.note ?? '', targetId: obj.id, activeField: 'title', titleFontSize: obj.fontSize, noteFontSizeLive: obj.noteFontSize })
  }

  // Applies a toolbar text-size choice to whichever shape field is currently
  // focused (Title or Note) — the shape's dimensions are never touched here.
  function applyShapeTextSize(sz: number) {
    if (!textInput?.targetId) return
    const id = textInput.targetId, field = textInput.activeField ?? 'title'
    const n = objectsRef.current.map(o => o.id!==id ? o : (field==='note' ? {...o,noteFontSize:sz} : {...o,fontSize:sz}))
    syncObjs(n); snapshot(n)
    setTextInput(prev => prev ? (field==='note' ? {...prev, noteFontSizeLive:sz} : {...prev, titleFontSize:sz}) : null)
    setOpenPopover(null)
  }

  function commitText() {
    if (textInput?.targetId) {
      const id = textInput.targetId
      const title = textInput.value.trim()
      const note = (textInput.noteValue ?? '').trim()
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      const n = resolveAttachments(objectsRef.current.map(o => {
        if (o.id !== id) return o
        const updated = { ...o, text: title, note }
        if (ctx) {
          const needed = computeRequiredHeight(ctx, updated)
          if (needed > Math.abs(updated.h)) updated.h = updated.h < 0 ? -needed : needed
        }
        return updated
      }))
      syncObjs(n); snapshot(n); renderAll()
      setTextInput(null); return
    }
    const val = textInput?.value?.trim()
    if (val && textInput) {
      const fontSize = TEXT_SIZES[textSzIdx]
      const obj = mkObj({id:uid(),type:'text',x:textInput.x,y:textInput.y,color:drawColor,fontSize,text:val})
      const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); renderAll()
    }
    setTextInput(null)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function duplicateSelected() {
    if (selIdsRef.current.length===0) return
    const OFF=18
    const copies=objectsRef.current.filter(o=>selIdsRef.current.includes(o.id)).map(o=>({...o,id:uid(),gid:'',x:o.x+OFF,y:o.y+OFF,x1:o.x1+OFF,y1:o.y1+OFF,x2:o.x2+OFF,y2:o.y2+OFF,mx:o.mx+OFF,my:o.my+OFF,pts:o.pts.map(p=>({x:p.x+OFF,y:p.y+OFF}))}))
    const n=[...objectsRef.current,...copies]; syncObjs(n); syncSel(copies.map(c=>c.id)); snapshot(n); renderAll()
  }

  function deleteSelected() {
    if (selIdsRef.current.length===0) return
    const ids=selIdsRef.current; const n=objectsRef.current.filter(o=>!ids.includes(o.id))
    syncObjs(n); syncSel([]); snapshot(n); renderAll()
  }

  function groupSelected() {
    if (selIdsRef.current.length<2) return
    const gid=uid(); const ids=selIdsRef.current
    const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,gid}:o)
    syncObjs(n); snapshot(n); renderAll()
  }

  function ungroupSelected() {
    const ids=selIdsRef.current
    const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,gid:''}:o)
    syncObjs(n); snapshot(n); renderAll()
  }

  function flipSelected(axis: 'x'|'y') {
    if (selIdsRef.current.length===0) return
    const ids=selIdsRef.current
    const n=objectsRef.current.map(o=>{
      if(!ids.includes(o.id)) return o
      if (o.type==='text') return o
      // Lines/arrows/strokes mirror their own exact coordinates around their own
      // center — this keeps hit-testing/handles in sync with the render, and for
      // elbow arrows it automatically re-derives a valid orthogonal corner (the
      // mirrored corner of a mirrored orthogonal route is itself orthogonal).
      if (o.type==='line' || o.type==='arrow') {
        if (axis==='x') {
          const cx=(o.x1+o.x2)/2
          return {...o,x1:2*cx-o.x1,x2:2*cx-o.x2,mx:2*cx-o.mx}
        }
        const cy=(o.y1+o.y2)/2
        return {...o,y1:2*cy-o.y1,y2:2*cy-o.y2,my:2*cy-o.my}
      }
      if (o.type==='stroke') {
        const bb=getObjBB(o)
        if (axis==='x') { const cx=(bb.minX+bb.maxX)/2; return {...o,pts:o.pts.map(p=>({x:2*cx-p.x,y:p.y}))} }
        const cy=(bb.minY+bb.maxY)/2; return {...o,pts:o.pts.map(p=>({x:p.x,y:2*cy-p.y}))}
      }
      // Shapes already flip correctly via the render-time flipX/flipY transform — untouched.
      return axis==='x'?{...o,flipX:!o.flipX}:{...o,flipY:!o.flipY}
    })
    syncObjs(n); snapshot(n); setOpenPopover(null); renderAll()
  }

  // Quick ±90° rotation — same pivot/geometry rules as the drag-handle rotation.
  function rotateSelectedBy(deltaRad: number) {
    const ids = selIdsRef.current
    if (ids.length===0) return
    const objs = objectsRef.current.filter(o=>ids.includes(o.id))
    const pivot = getGroupPivot(objs)
    const n = objectsRef.current.map(o => {
      if (!ids.includes(o.id)) return o
      if (o.type==='line' || o.type==='arrow') {
        const p1=rotatePt({x:o.x1,y:o.y1},pivot,deltaRad), p2=rotatePt({x:o.x2,y:o.y2},pivot,deltaRad), pm=rotatePt({x:o.mx,y:o.my},pivot,deltaRad)
        return {...o,x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,mx:pm.x,my:pm.y}
      }
      if (o.type==='stroke') return {...o,pts:o.pts.map(p=>rotatePt(p,pivot,deltaRad))}
      const center={x:o.x+o.w/2,y:o.y+o.h/2}, nc=rotatePt(center,pivot,deltaRad)
      return {...o,x:nc.x-o.w/2,y:nc.y-o.h/2,rotation:(o.rotation||0)+deltaRad}
    })
    syncObjs(n); snapshot(n); setOpenPopover(null); renderAll()
  }

  // No selected line/arrow of that kind → just sets the default for the NEXT
  // one drawn. A selected line/arrow → updates it immediately and persists.
  function applyLineThickness(px: number) {
    setLineThickIdx(THICKNESS_LEVELS.indexOf(px as typeof THICKNESS_LEVELS[number]))
    if (selLines.length > 0) {
      const ids = selLines.map(o=>o.id)
      const n = objectsRef.current.map(o => ids.includes(o.id) ? {...o, sw:px} : o)
      syncObjs(n); snapshot(n); renderAll()
    }
    setOpenPopover(null)
  }
  // Changes how the SAME Note lines render (bullet/numbered/lettered) — never
  // rewrites the text itself, so switching types replaces formatting instead
  // of stacking it, and Enter naturally continues the active type for free.
  function applyNoteListType(type: NoteListType) {
    if (!textInput?.targetId) return
    const id = textInput.targetId
    const n = objectsRef.current.map(o => o.id!==id ? o : {...o, noteListType: type})
    syncObjs(n); snapshot(n); setOpenPopover(null)
  }

  function applyArrowThickness(px: number) {
    setArrowThickIdx(THICKNESS_LEVELS.indexOf(px as typeof THICKNESS_LEVELS[number]))
    if (selArrows.length > 0) {
      const ids = selArrows.map(o=>o.id)
      const n = objectsRef.current.map(o => ids.includes(o.id) ? {...o, sw:px} : o)
      syncObjs(n); snapshot(n); renderAll()
    }
    setOpenPopover(null)
  }

  function setConnType(ct: ConnType) {
    // Elbow corners are always derived from (x1,y2) at render time — see
    // renderObj — so switching connector type never needs to touch mx/my.
    const ids=selIdsRef.current
    const n=objectsRef.current.map(o=>(!ids.includes(o.id)||o.type!=='arrow')?o:{...o,connType:ct})
    syncObjs(n); snapshot(n); renderAll()
  }

  function updateSelColor(color: string) {
    setDrawColor(color)
    if(selIdsRef.current.length===0) return
    const ids=selIdsRef.current; const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,color}:o)
    syncObjs(n); renderAll()
  }

  function updateSelFillColor(color: string) {
    setFillColor(color)
    if(selIdsRef.current.length===0) return
    const ids=selIdsRef.current; const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,fillColor:color}:o)
    syncObjs(n); renderAll()
  }

  function toggleFilled() {
    const ids=selIdsRef.current
    if (ids.length>0) {
      const firstFilled=objectsRef.current.find(o=>ids.includes(o.id))?.filled??false
      const nf=!firstFilled; setFilled(nf)
      const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,filled:nf}:o)
      syncObjs(n); renderAll()
    } else { setFilled(f=>!f) }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // Respects active text-editing contexts first (shape-label input, etc.) so
  // normal typing/backspace/paste inside them is never hijacked as a canvas
  // command — only once no text field is focused do these become canvas shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      // The shape-text-edit/free-text <input> has its own onKeyDown (Enter
      // commits, Escape discards and keeps the shape selected) — leave it alone.
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return
      if (e.key==='Escape' && openPopover) { e.preventDefault(); setOpenPopover(null); return }
      if (e.key==='Escape' && selIdsRef.current.length>0) { e.preventDefault(); syncSel([]); renderAll(); return }
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') { e.preventDefault(); handleSave(); return }
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y') { e.preventDefault(); redo(); return }
      if ((e.key==='Delete'||e.key==='Backspace')&&selIdsRef.current.length>0) { e.preventDefault(); deleteSelected(); return }
      if ((e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='ArrowLeft'||e.key==='ArrowRight')&&selIdsRef.current.length>0) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key==='ArrowLeft' ? -step : e.key==='ArrowRight' ? step : 0
        const dy = e.key==='ArrowUp'   ? -step : e.key==='ArrowDown'  ? step : 0
        const ids = selIdsRef.current
        const n = objectsRef.current.map(o => {
          if (!ids.includes(o.id)) return o
          if (o.type==='line' || o.type==='arrow') return {...o,x1:o.x1+dx,y1:o.y1+dy,x2:o.x2+dx,y2:o.y2+dy,mx:o.mx+dx,my:o.my+dy}
          if (o.type==='stroke') return {...o,pts:o.pts.map(p=>({x:p.x+dx,y:p.y+dy}))}
          return {...o,x:o.x+dx,y:o.y+dy}
        })
        syncObjs(n); snapshot(n); renderAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPopover]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close popover on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!openPopover) return
    const close = (ev: MouseEvent | TouchEvent) => {
      if (!(ev.target as HTMLElement).closest('[data-popover],[data-pop-trigger]')) setOpenPopover(null)
    }
    document.addEventListener('mousedown', close); document.addEventListener('touchstart', close as EventListener)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close as EventListener) }
  }, [openPopover])

  function pasteImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        const viewW = canvas?.offsetWidth ?? 720, viewH = canvas?.offsetHeight ?? 480
        let w = img.naturalWidth || 200, h = img.naturalHeight || 150
        const maxW = viewW*0.8, maxH = viewH*0.8
        if (w > maxW || h > maxH) { const scale = Math.min(maxW/w, maxH/h); w *= scale; h *= scale }
        const x = (viewW-w)/2, y = (viewH-h)/2
        imageCacheRef.current.set(src, img) // already decoded — avoids a load flicker
        const obj = mkObj({id:uid(),type:'image',x,y,w,h,src})
        const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); syncSel([obj.id]); setTool('select'); renderAll()
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }

  // ── External image paste (Ctrl/Cmd+V) ─────────────────────────────────────
  // Text-editing contexts (the shape-label / free-text input) are left alone so
  // normal text paste keeps working there; only otherwise does an image on the
  // clipboard get inserted onto the canvas.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const active = document.activeElement as HTMLElement | null
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active?.isContentEditable) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) { e.preventDefault(); pasteImageFile(file) }
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ────────────────────────────────────────────────────────────────
  const selObjs   = objects.filter(o => selIds.includes(o.id))
  const selHasShape = selObjs.some(o => SHAPE_TOOLS.includes(o.type as DrawTool))
  const selHasFlippable = selIds.length>0 && selObjs.some(o => o.type !== 'text')
  const selHasRotatable = selIds.length>0 && selObjs.some(o => ROTATABLE_TYPES.includes(o.type) || o.type==='line' || o.type==='arrow' || o.type==='stroke')
  const selLines    = selObjs.filter(o => o.type==='line')
  const selArrows   = selObjs.filter(o => o.type==='arrow')
  const selArrow    = selObjs.length===1 && selObjs[0].type==='arrow' ? selObjs[0] : null
  const activeNoteListType: NoteListType = textInput?.targetId
    ? (objects.find(o=>o.id===textInput.targetId)?.noteListType ?? 'none')
    : 'none'
  const selIsGroup  = selObjs.length>=2 && selObjs.every(o=>o.gid&&o.gid===selObjs[0].gid)
  const canGroup    = selIds.length>=2 && !selIsGroup
  const showFill    = SHAPE_TOOLS.includes(tool) || selHasShape
  const curFilled   = selIds.length>0 ? (selObjs[0]?.filled??false) : filled
  const normalizedFill   = normalizeHexColor(fillColor)
  const isPresetFill      = (COLOR_PALETTE as readonly string[]).some(c=>normalizeHexColor(c)===normalizedFill)
  const isSavedCustomFill = customColors.some(c=>normalizeHexColor(c)===normalizedFill)
  const isCustomFill      = !isPresetFill && !isSavedCustomFill

  // ── Styles ─────────────────────────────────────────────────────────────────
  const dockBg  = isDark ? 'rgba(9,4,22,0.97)' : '#f1f5f9'
  const dockBdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'

  function dkBtn(active=false, danger=false, disabled=false): React.CSSProperties {
    return {
      padding:'4px 10px', borderRadius:7, cursor:disabled?'default':'pointer',
      border:`0.5px solid ${active?'rgba(124,58,237,0.55)':danger?'rgba(239,68,68,0.28)':isDark?'rgba(255,255,255,0.14)':'rgba(0,0,0,0.15)'}`,
      background:active?'rgba(124,58,237,0.20)':danger?'rgba(239,68,68,0.08)':isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.04)',
      color:active?'#a78bfa':danger?(isDark?'rgba(252,165,165,0.85)':'#dc2626'):disabled?(isDark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.22)'):isDark?'rgba(255,255,255,0.78)':'rgba(0,0,0,0.68)',
      fontSize:12, fontWeight:active?600:500, transition:'all 120ms', flexShrink:0, whiteSpace:'nowrap' as const, lineHeight:'1.4',
    }
  }

  // Popovers render as position:fixed, anchored via getBoundingClientRect() at open-time —
  // this escapes the toolbar's own overflowX:'auto' scroll/clip ancestor entirely (unlike
  // position:absolute, which resolves its containing block inside that scrolling ancestor
  // and gets clipped/scrolled along with it).
  function openPop(id: PopoverId, e: React.MouseEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setPopAnchor({ top: r.bottom + 4, left: r.left })
    setOpenPopover(op => op === id ? null : id)
  }

  function fixedPopStyle(extra?: React.CSSProperties): React.CSSProperties {
    const width = 150
    let left = popAnchor?.left ?? 0
    let top  = popAnchor?.top ?? 0
    if (typeof window !== 'undefined') {
      left = Math.min(Math.max(8, left), window.innerWidth - width - 8)
      top  = Math.min(top, window.innerHeight - 60)
    }
    return {
      position:'fixed', top, left, zIndex:300,
      background:isDark?'#1e1033':'#ffffff', border:`0.5px solid ${dockBdr}`,
      borderRadius:10, padding:'6px', display:'flex', flexDirection:'column', gap:2,
      boxShadow:isDark?'0 8px 24px rgba(0,0,0,0.55)':'0 4px 16px rgba(0,0,0,0.14)', minWidth:130,
      ...extra,
    }
  }

  function pbtn(lbl: string, fn: ()=>void, active=false) {
    return <button key={lbl} onClick={fn} style={{...dkBtn(active),textAlign:'left',width:'100%',padding:'5px 10px'}}>{lbl}</button>
  }

  const dvdr = <span style={{width:1,height:18,background:dockBdr,flexShrink:0,alignSelf:'center'}} />

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  const toolbar = (
    <div style={{display:'flex',alignItems:'stretch',background:dockBg,borderBottom:`0.5px solid ${dockBdr}`,boxShadow:isDark?'0 2px 12px rgba(0,0,0,0.40)':'0 1px 6px rgba(0,0,0,0.08)',flexShrink:0}}>

      {/* ── Scrollable tools ─────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',gap:4,padding:'9px 10px 9px 14px',flex:1,minWidth:0,overflowX:'auto',flexWrap:'nowrap'}}>

        <span style={{fontSize:12,fontWeight:700,letterSpacing:'-0.01em',color:isDark?'rgba(255,255,255,0.85)':'#1e293b',marginRight:2,flexShrink:0}}>🧠 Mind Mapping Canvas</span>

        {dvdr}

        {/* Select */}
        <button title="Select (click / drag)" onClick={()=>{if(textInput)commitText();setTool('select')}} style={{...dkBtn(tool==='select'),minWidth:28,textAlign:'center',padding:'4px 8px',fontSize:13}}>↖</button>

        {/* Rotate — quick ±90°, works on the current selection */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Rotate" disabled={!selHasRotatable} onClick={(e)=>{if(!selHasRotatable)return;openPop('rotate',e)}}
            style={{...dkBtn(false,false,!selHasRotatable),display:'flex',alignItems:'center',padding:'4px 8px',fontSize:13}}>↻</button>
          {openPopover==='rotate' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',gap:4,minWidth:'auto',padding:'6px 8px'})}>
              <button title="Rotate 90° left" onClick={()=>rotateSelectedBy(-Math.PI/2)}
                style={{width:30,height:28,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                  border:'0.5px solid rgba(0,0,0,0.15)',background:'rgba(0,0,0,0.04)',fontSize:14}}>↺</button>
              <button title="Rotate 90° right" onClick={()=>rotateSelectedBy(Math.PI/2)}
                style={{width:30,height:28,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                  border:'0.5px solid rgba(0,0,0,0.15)',background:'rgba(0,0,0,0.04)',fontSize:14}}>↻</button>
            </div>
          )}
        </div>

        {dvdr}

        {/* Pen + size popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Pen" onClick={(e)=>{if(textInput)commitText();setTool('pen');openPop('pen-size',e)}}
            style={{...dkBtn(tool==='pen'),display:'flex',alignItems:'center',gap:4,padding:'4px 8px'}}>
            <span style={{fontSize:13}}>✏</span>
            <span style={{width:Math.min(PEN_SIZES[penIdx]+2,10),height:Math.min(PEN_SIZES[penIdx]+2,10),borderRadius:'50%',background:'currentColor',display:'inline-block',flexShrink:0}}/>
          </button>
          {openPopover==='pen-size' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',gap:4,minWidth:'auto',padding:'6px 8px'})}>
              {PEN_SIZES.map((sz,i)=>(
                <button key={i} title={`${sz}px`} onClick={()=>{setPenIdx(i);setOpenPopover(null)}}
                  style={{width:28,height:28,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                    border:`0.5px solid ${penIdx===i?'rgba(124,58,237,0.55)':isDark?'rgba(255,255,255,0.14)':'rgba(0,0,0,0.15)'}`,
                    background:penIdx===i?'rgba(124,58,237,0.20)':isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.04)'}}>
                  <span style={{display:'block',width:Math.min(sz+2,14),height:Math.min(sz+2,14),borderRadius:'50%',background:isDark?'rgba(255,255,255,0.75)':'rgba(0,0,0,0.62)'}}/>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Eraser + size popover — icon only, no permanent size letter beside it */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Eraser" onClick={(e)=>{if(textInput)commitText();setTool('eraser');openPop('eraser-size',e)}}
            style={{...dkBtn(tool==='eraser'),display:'flex',alignItems:'center',justifyContent:'center',padding:'4px 9px'}}>
            <EraserIcon/>
          </button>
          {openPopover==='eraser-size' && (
            <div data-popover="" style={fixedPopStyle()}>
              {(['Small','Medium','Large','Extra Large'] as const).map((lbl,i)=>pbtn(lbl,()=>{setEraserIdx(i);setOpenPopover(null)},eraserIdx===i))}
            </div>
          )}
        </div>

        {/* Text size — while a shape's Title/Note is being edited, this targets
            whichever of the two currently has focus and leaves the panel open;
            otherwise it behaves as before (sets the default for the Text tool). */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Text Size" onClick={(e)=>{
              if (!textInput?.targetId) { if(textInput)commitText(); setTool('text') }
              openPop('text-size',e)
            }}
            style={{...dkBtn(tool==='text'||!!textInput?.targetId),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:13,fontWeight:700}}>
            T<span style={{fontSize:9,opacity:0.6,fontWeight:400}}>
              {textInput?.targetId ? (textInput.activeField==='note' ? textInput.noteFontSizeLive : textInput.titleFontSize) : TEXT_SIZES[textSzIdx]}
            </span>
          </button>
          {openPopover==='text-size' && (
            <div data-popover="" style={fixedPopStyle()}>
              {textInput?.targetId
                ? TEXT_SIZES.map(sz => {
                    const active = (textInput.activeField==='note' ? textInput.noteFontSizeLive : textInput.titleFontSize)===sz
                    // Inlined (not routed through the pbtn() helper) — applyShapeTextSize
                    // reads objectsRef, and only a DIRECT onClick JSX attribute (not a value
                    // passed into another function) is recognized as deferred-to-click here.
                    return (
                      <button key={sz} onClick={()=>applyShapeTextSize(sz)} style={{...dkBtn(active),textAlign:'left',width:'100%',padding:'5px 10px'}}>{sz}px</button>
                    )
                  })
                : TEXT_SIZES.map((sz,i)=>pbtn(`${sz}px`,()=>{setTextSzIdx(i);setOpenPopover(null)},textSzIdx===i))}
            </div>
          )}
        </div>

        {/* List — applies to the Note field of the shape currently being edited */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="List" disabled={!(textInput?.targetId && textInput.activeField==='note')}
            onClick={(e)=>{ if (textInput?.targetId && textInput.activeField==='note') openPop('list-type',e) }}
            style={{...dkBtn(false,false,!(textInput?.targetId && textInput.activeField==='note')),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            ☷ List▾
          </button>
          {openPopover==='list-type' && textInput?.targetId && (
            <div data-popover="" style={fixedPopStyle()}>
              <button onClick={()=>applyNoteListType('bullet')} style={{...dkBtn(activeNoteListType==='bullet'),textAlign:'left',width:'100%',padding:'5px 10px'}}>• Bullet List</button>
              <button onClick={()=>applyNoteListType('numbered')} style={{...dkBtn(activeNoteListType==='numbered'),textAlign:'left',width:'100%',padding:'5px 10px'}}>1. Numbered List</button>
              <button onClick={()=>applyNoteListType('lettered')} style={{...dkBtn(activeNoteListType==='lettered'),textAlign:'left',width:'100%',padding:'5px 10px'}}>a. Lettered List</button>
            </div>
          )}
        </div>

        {dvdr}

        {/* Shapes popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Shapes" onClick={(e)=>{if(textInput)commitText();openPop('shapes',e)}}
            style={{...dkBtn(SHAPE_TOOLS.includes(tool)),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            {tool==='rect'?'□':tool==='rect-r'?'⊡':tool==='circle'?'○':tool==='triangle'?'△':tool==='diamond'?'◇':tool==='starburst'?'✦':'□'} Shapes▾
          </button>
          {openPopover==='shapes' && (
            <div data-popover="" style={fixedPopStyle()}>
              {pbtn('□  Rectangle', ()=>{setTool('rect');      setOpenPopover(null)}, tool==='rect')}
              {pbtn('⊡  Round Rect',()=>{setTool('rect-r');    setOpenPopover(null)}, tool==='rect-r')}
              {pbtn('○  Circle',    ()=>{setTool('circle');    setOpenPopover(null)}, tool==='circle')}
              {pbtn('△  Triangle',  ()=>{setTool('triangle');  setOpenPopover(null)}, tool==='triangle')}
              {pbtn('◇  Diamond',   ()=>{setTool('diamond');   setOpenPopover(null)}, tool==='diamond')}
              {pbtn('✦  Starburst', ()=>{setTool('starburst'); setOpenPopover(null)}, tool==='starburst')}
            </div>
          )}
        </div>

        {/* Line — click selects the tool (unless a line is already selected, in
            which case the popover retargets that line instead) and opens its
            thickness popover, same pattern as Pen's size trigger. */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Line" onClick={(e)=>{if(textInput)commitText();if(selLines.length===0)setTool('line');openPop('line-thickness',e)}}
            style={{...dkBtn(tool==='line'),minWidth:28,textAlign:'center',padding:'4px 8px'}}>—</button>
          {openPopover==='line-thickness' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',gap:4,minWidth:'auto',padding:'6px 8px'})}>
              {THICKNESS_LEVELS.map(px => {
                const active = (selLines[0]?.sw ?? THICKNESS_LEVELS[lineThickIdx]) === px
                return (
                  <button key={px} title={`${px}px`} onClick={()=>applyLineThickness(px)}
                    style={{width:30,height:28,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                      border:`0.5px solid ${active?'rgba(124,58,237,0.55)':'rgba(0,0,0,0.15)'}`,background:active?'rgba(124,58,237,0.20)':'rgba(0,0,0,0.04)'}}>
                    <span style={{display:'block',width:20,height:px,borderRadius:px/2,background:'rgba(0,0,0,0.70)'}}/>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Arrow / Connector" onClick={(e)=>{if(textInput)commitText();if(selArrows.length===0){setTool('arrow');setArrowConnDefault('straight')}openPop('arrow-thickness',e)}}
            style={{...dkBtn(tool==='arrow'&&arrowConnDefault==='straight'),minWidth:28,textAlign:'center',padding:'4px 8px'}}>→</button>
          {openPopover==='arrow-thickness' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',gap:4,minWidth:'auto',padding:'6px 8px'})}>
              {THICKNESS_LEVELS.map(px => {
                const active = (selArrows[0]?.sw ?? THICKNESS_LEVELS[arrowThickIdx]) === px
                return (
                  <button key={px} title={`${px}px`} onClick={()=>applyArrowThickness(px)}
                    style={{width:30,height:28,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                      border:`0.5px solid ${active?'rgba(124,58,237,0.55)':'rgba(0,0,0,0.15)'}`,background:active?'rgba(124,58,237,0.20)':'rgba(0,0,0,0.04)'}}>
                    <span style={{display:'block',width:20,height:px,borderRadius:px/2,background:'rgba(0,0,0,0.70)'}}/>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Elbow Arrow — two visual icon choices (sharp / curved corner), primary UI is the icon, tooltip is secondary */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Elbow Arrow" onClick={(e)=>{if(textInput)commitText();setTool('arrow');openPop('arrow-type',e)}}
            style={{...dkBtn(tool==='arrow'&&(arrowConnDefault==='elbow'||arrowConnDefault==='elbow-curved')),display:'flex',alignItems:'center',padding:'4px 8px'}}>
            <ElbowArrowIcon curved={arrowConnDefault==='elbow-curved'} size={15}/>
          </button>
          {openPopover==='arrow-type' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',gap:4,minWidth:'auto',padding:'6px 8px'})}>
              {([['elbow',false,'Sharp 90° Arrow'],['elbow-curved',true,'Curved Arrow']] as const).map(([ct,curved,ttl])=>(
                <button key={ct} title={ttl} onClick={()=>{setArrowConnDefault(ct);setTool('arrow');setOpenPopover(null)}}
                  style={{width:34,height:30,borderRadius:7,padding:0,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                    border:`0.5px solid ${arrowConnDefault===ct?'rgba(124,58,237,0.55)':isDark?'rgba(255,255,255,0.14)':'rgba(0,0,0,0.15)'}`,
                    background:arrowConnDefault===ct?'rgba(124,58,237,0.20)':isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.04)',
                    color:isDark?'rgba(255,255,255,0.78)':'rgba(0,0,0,0.68)'}}>
                  <ElbowArrowIcon curved={curved} size={17}/>
                </button>
              ))}
            </div>
          )}
        </div>

        {dvdr}

        {/* Stroke color */}
        <label title="Stroke Color" style={{position:'relative',cursor:'pointer',flexShrink:0}}>
          <div style={{width:22,height:22,borderRadius:'50%',background:drawColor,border:`2px solid ${isDark?'rgba(255,255,255,0.30)':'rgba(0,0,0,0.20)'}`,boxShadow:'0 0 0 1px rgba(124,58,237,0.30)'}}/>
          <input type="color" value={drawColor} onChange={e=>updateSelColor(e.target.value)} style={{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'}} tabIndex={-1}/>
        </label>

        {/* Fill color — XPadite palette popover (reuses the same preset swatches +
            rainbow custom-color trigger + ColorPickerModal used by Activity Manager),
            not the native browser picker */}
        {showFill && (
          <div style={{flexShrink:0}} data-pop-trigger="">
            <button title="Fill Color" onClick={(e)=>{if(textInput)commitText();openPop('fill',e)}}
              style={{...dkBtn(),display:'flex',alignItems:'center',gap:5,padding:'4px 8px'}}>
              <span style={{width:16,height:16,borderRadius:4,background:fillColor,border:`1.5px solid ${isDark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.25)'}`,display:'inline-block',flexShrink:0}}/>
              Fill
            </button>
            {openPopover==='fill' && (
              <div data-popover="" style={fixedPopStyle({flexDirection:'row',flexWrap:'wrap',gap:6,width:172,minWidth:'auto',padding:'8px'})}>
                {COLOR_PALETTE.map(c => {
                  const sel = normalizeHexColor(c)===normalizedFill
                  return (
                    <button key={c} title={c} onClick={()=>{updateSelFillColor(c);setOpenPopover(null)}}
                      style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',background:c,border:'none',padding:0,
                        transform:sel?'scale(1.15)':'scale(1)',
                        boxShadow:sel?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px #7c3aed`:'none'}}/>
                  )
                })}
                {customColors.map(c => {
                  const sel = normalizeHexColor(c)===normalizedFill
                  return (
                    <button key={c} title={c} onClick={()=>{updateSelFillColor(c);setOpenPopover(null)}}
                      style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',background:c,border:'none',padding:0,
                        transform:sel?'scale(1.15)':'scale(1)',
                        boxShadow:sel?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px #7c3aed`:'none'}}/>
                  )
                })}
                <button title="Custom color" onClick={()=>{setOpenPopover(null);setShowCustomFill(true)}}
                  style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',border:'none',padding:0,
                    background:isCustomFill?fillColor:'conic-gradient(from 0deg, #ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
                    transform:isCustomFill?'scale(1.15)':'scale(1)',
                    boxShadow:isCustomFill?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px ${fillColor}`:'none'}}/>
              </div>
            )}
          </div>
        )}

        {/* Fill toggle */}
        {showFill && (
          <button title="Toggle fill" onClick={toggleFilled} style={dkBtn(curFilled)}>
            {curFilled ? '◉' : '○'} Fill
          </button>
        )}

        {dvdr}

        {/* Flip popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Flip" disabled={!selHasFlippable} onClick={(e)=>{if(!selHasFlippable)return;openPop('flip',e)}}
            style={{...dkBtn(false,false,!selHasFlippable),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>⇆ Flip▾</button>
          {openPopover==='flip' && (
            <div data-popover="" style={fixedPopStyle()}>
              <button onClick={()=>flipSelected('x')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>↔  Flip Horizontal</button>
              <button onClick={()=>flipSelected('y')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>↕  Flip Vertical</button>
            </div>
          )}
        </div>

        {/* Connector type — only when single arrow selected */}
        {selArrow && (<>
          {dvdr}
          <button onClick={()=>setConnType('straight')} style={dkBtn(selArrow.connType==='straight')} title="Straight arrow">⟶</button>
          <button onClick={()=>setConnType('curved')}   style={dkBtn(selArrow.connType==='curved')}   title="Curved arrow">⌒</button>
          <button onClick={()=>setConnType('elbow')}    style={{...dkBtn(selArrow.connType==='elbow'),display:'flex',alignItems:'center',padding:'4px 8px'}} title="Sharp 90° Arrow">
            <ElbowArrowIcon curved={false} size={13}/>
          </button>
          <button onClick={()=>setConnType('elbow-curved')} style={{...dkBtn(selArrow.connType==='elbow-curved'),display:'flex',alignItems:'center',padding:'4px 8px'}} title="Curved Arrow">
            <ElbowArrowIcon curved={true} size={13}/>
          </button>
        </>)}

        <span style={{flex:1,minWidth:8}}/>

        {/* Contextual: Group / Ungroup / Dup / Delete */}
        {selIds.length>0 && (<>
          {dvdr}
          {canGroup   && <button onClick={groupSelected}   style={dkBtn()}>Group</button>}
          {selIsGroup && <button onClick={ungroupSelected} style={dkBtn()}>Ungroup</button>}
          <button onClick={duplicateSelected} style={dkBtn()}>Dup</button>
          <button title="Delete" onClick={deleteSelected} style={{...dkBtn(false,true),display:'flex',alignItems:'center',padding:'4px 8px'}}>
            <TrashIcon/>
          </button>
          {dvdr}
        </>)}

        {/* History */}
        <button style={dkBtn(false,false,!canUndo)} onClick={undo}    disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
        <button style={dkBtn(false,false,!canRedo)} onClick={redo}    disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
        <button style={dkBtn()}                     onClick={clearAll} title="Clear canvas">Clear</button>

        {dvdr}

        {/* Fit / Restore — two clearly distinct icon states communicating the
            action that will happen next */}
        <button onClick={()=>setFitToScreen(f=>!f)} title={fitToScreen?'Restore View':'Fit to Screen'} aria-label={fitToScreen?'Restore View':'Fit to Screen'}
          style={{...dkBtn(fitToScreen),display:'flex',alignItems:'center',gap:5,padding:'4px 8px'}}>
          {fitToScreen ? <RestoreIcon/> : <FitIcon/>}
          {fitToScreen?'Restore':'Fit'}
        </button>
      </div>

      {/* ── Fixed Cancel + Save ────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',gap:5,padding:'9px 12px',flexShrink:0,borderLeft:`0.5px solid ${dockBdr}`,background:dockBg}}>
        <button onClick={onClose} className="xp-dm-cancel-btn" style={dkBtn(false,true)}>Cancel</button>
        <button onClick={handleSave} style={{padding:'5px 16px',borderRadius:7,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#6d28d9)',color:'#fff',fontSize:12,fontWeight:600,flexShrink:0,boxShadow:'0 2px 8px rgba(124,58,237,0.35)'}}>Save</button>
      </div>

    </div>
  )

  // ── Canvas area ─────────────────────────────────────────────────────────────
  const cursorMap: Partial<Record<DrawTool,string>> = {select:'default',text:'text',eraser:'cell'}
  const canvasCursor = cursorMap[tool] ?? 'crosshair'

  const canvasArea = (
    <div ref={wrapRef} style={{flex:1,overflow:'hidden',position:'relative',cursor:canvasCursor,background:'#ffffff',minHeight:0}}>
      <canvas
        ref={canvasRef}
        style={{display:'block',touchAction:'none'}}
        onMouseDown={beginStroke} onMouseMove={continueStroke} onMouseUp={endStroke} onMouseLeave={endStroke}
        onTouchStart={beginStroke} onTouchMove={continueStroke} onTouchEnd={endStroke}
        onDoubleClick={e=>{
          if (tool!=='select') return
          const canvas = canvasRef.current; if (!canvas) return
          const pos = getPos(e, canvas); if (!pos) return
          const target = getTarget(pos.x,pos.y)
          if (target.kind!=='object') return
          const obj = objectsRef.current.find(o=>o.id===target.id)
          if (obj && TEXT_CAPABLE_TYPES.includes(obj.type)) startShapeTextEdit(obj)
        }}
      />
      {textInput && textInput.targetId && (
        <div
          // Commit only when focus leaves the WHOLE panel — not when tabbing
          // between Title and Note — using the standard relatedTarget check.
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitText() }}
          style={{
            position:'absolute', left:textInput.x, top:textInput.y, width:textInput.w,
            display:'flex', flexDirection:'column', gap:4,
            background:'rgba(255,255,255,0.95)', backdropFilter:'blur(4px)',
            border:'1px dashed rgba(124,58,237,0.60)', borderRadius:6, padding:'6px 7px', zIndex:10,
          }}
        >
          <input
            ref={textInputRef} autoFocus value={textInput.value}
            onChange={e=>setTextInput(prev=>prev?{...prev,value:e.target.value}:null)}
            onFocus={()=>setTextInput(prev=>prev?{...prev,activeField:'title'}:null)}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitText()}if(e.key==='Escape'){e.preventDefault();setTextInput(null)}}}
            placeholder="Title"
            style={{border:'none',outline:'none',background:'transparent',color:drawColor,fontSize:textInput.titleFontSize??14,fontWeight:700,fontFamily:'sans-serif',padding:'2px 3px'}}
          />
          <textarea
            value={textInput.noteValue ?? ''}
            onChange={e=>setTextInput(prev=>prev?{...prev,noteValue:e.target.value}:null)}
            onFocus={()=>setTextInput(prev=>prev?{...prev,activeField:'note'}:null)}
            onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setTextInput(null)}}}
            placeholder="Write a note…"
            rows={2}
            style={{border:'none',outline:'none',background:'transparent',color:drawColor,fontSize:textInput.noteFontSizeLive??12.5,fontFamily:'sans-serif',padding:'2px 3px',resize:'vertical',minHeight:36}}
          />
        </div>
      )}
      {textInput && !textInput.targetId && (
        <input
          ref={textInputRef} autoFocus value={textInput.value}
          onChange={e=>setTextInput(prev=>prev?{...prev,value:e.target.value}:null)}
          onBlur={commitText}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitText()}if(e.key==='Escape'){e.preventDefault();setTextInput(null)}}}
          style={{
            position:'absolute',left:textInput.x,top:textInput.y,
            width: textInput.w, textAlign: 'left',
            background:'rgba(255,255,255,0.12)',backdropFilter:'blur(4px)',border:'1px dashed rgba(124,58,237,0.60)',borderRadius:4,color:drawColor,fontSize:TEXT_SIZES[textSzIdx],outline:'none',minWidth:textInput.w?undefined:120,padding:'2px 4px',zIndex:10,fontFamily:'sans-serif',
          }}
          placeholder="Type here…"
        />
      )}
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',opacity:objects.length>0?0:0.35,transition:'opacity 300ms'}}>
        <span style={{fontSize:13,color:'#94a3b8',userSelect:'none'}}>Start drawing…</span>
      </div>
    </div>
  )

  // ── Popover micro-interactions ────────────────────────────────────────────
  const popoverStyleTag = (
    <style>{`
      @media (prefers-reduced-motion: no-preference) {
        [data-popover] { animation: xpJournalDrawPopIn 160ms ease-out; }
      }
      @keyframes xpJournalDrawPopIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      [data-popover] button:not(:disabled):hover, [data-pop-trigger] > button:not(:disabled):hover { background: rgba(124,58,237,0.14) !important; }
      @media (hover: none) {
        [data-popover] button:not(:disabled):active, [data-pop-trigger] > button:not(:disabled):active { background: rgba(124,58,237,0.22) !important; }
      }
      /* Mobile only: Cancel is replaced by the Mind Mapping Canvas header's own
         Back button (same safe close behavior) — freeing width for the tools.
         Save stays exactly where it is on every breakpoint. */
      @media (max-width: 640px) {
        .xp-dm-cancel-btn { display: none !important; }
      }
    `}</style>
  )

  // ── Custom fill color — same shared XPadite picker used by Activity Manager ──
  const customFillPicker = showCustomFill && (
    <ColorPickerModal
      initialColor={fillColor}
      onCancel={()=>setShowCustomFill(false)}
      onApply={hex => {
        updateSelFillColor(hex)
        setShowCustomFill(false)
        if (!addCustomColor(hex)) setToast('Custom color limit reached. Remove a saved color to add another.')
      }}
    />
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  const innerContent = <>{popoverStyleTag}{toolbar}{canvasArea}{customFillPicker}</>

  if (fitToScreen) {
    return (
      <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',flexDirection:'column',background:isDarkApp?'#10071e':'#ffffff'}}>
        {innerContent}
      </div>
    )
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0,background:isDarkApp?'#10071e':'#ffffff'}}>
      {innerContent}
    </div>
  )
}
