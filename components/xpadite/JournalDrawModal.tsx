'use client'

import { useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { ColorPickerModal } from './ColorPickerModal'
import { COLOR_PALETTE, normalizeHexColor } from './utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'select' | 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'rect-r' | 'circle' | 'triangle' | 'diamond' | 'starburst' | 'capsule' | 'hexagon'
type ObjType  = 'rect' | 'rect-r' | 'circle' | 'triangle' | 'diamond' | 'starburst' | 'capsule' | 'hexagon' | 'line' | 'arrow' | 'text' | 'stroke' | 'image'
// 'elbow' = sharp 90° two-segment connector; 'elbow-curved' = the same two-segment
// route with a smoothly rounded corner. Both are distinct from the older 'curved'
// (a single free-form quadratic bezier from start to end, unrelated to the elbow tool).
// V1: elbow corners are always DERIVED from the endpoints (x1,y2) — a vertical trunk
// down from the start, then horizontal to the end — never stored/edited as a draggable
// vertex. This guarantees a clean, deliberate default and keeps move/resize/flip trivial.
type ConnType = 'straight' | 'curved' | 'elbow' | 'elbow-curved'
type HPos     = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type PopoverId = 'pen-size' | 'eraser-size' | 'shapes' | 'flip' | 'text-size' | 'arrow-type' | 'fill' | 'stroke' | 'rotate' | 'line-thickness' | 'arrow-thickness' | 'list-type' | 'group' | 'order'
type NoteListType = 'none' | 'bullet' | 'numbered' | 'lettered' | 'checkbox'
type EditField = 'title' | 'note'

interface Pt { x: number; y: number }

// Shape types double as mind-map nodes: `text`/`fontSize` hold the Title,
// `note`/`noteFontSize`/`noteListType` hold an optional body below it. Not every
// shape gets both — compact/non-rectangular shapes (circle/triangle/diamond/
// starburst) are Title-only so the label stays readable inside their silhouette;
// rect/rect-r/capsule have the full Title+Note area. Both wrap/auto-grow the
// shape — see wrapTextLines/computeRequiredHeight.
const TITLE_NOTE_TYPES: ObjType[] = ['rect', 'rect-r', 'capsule']
const TITLE_ONLY_TYPES: ObjType[] = ['circle', 'triangle', 'diamond', 'starburst', 'hexagon']
const TEXT_CAPABLE_TYPES: ObjType[] = [...TITLE_NOTE_TYPES, ...TITLE_ONLY_TYPES]
const SHAPE_TEXT_PAD = 10
// Approximate inscribed-rectangle ratios (fraction of the shape's own bbox
// width/height) used to keep a Title-only shape's text inside its visible
// silhouette instead of its full rectangular bbox — bbox-approximation, not
// exact polygon math, same philosophy as the connector anchor system below.
const TITLE_SAFE_RATIO: Partial<Record<ObjType, { w: number; h: number }>> = {
  circle:    { w: 1 / Math.SQRT2, h: 1 / Math.SQRT2 },
  diamond:   { w: 0.5,  h: 0.5  },
  triangle:  { w: 0.55, h: 0.32 }, // weighted toward the triangle's wider base
  starburst: { w: 0.46, h: 0.46 },
  hexagon:   { w: 0.72, h: 0.72 }, // flat top/bottom edges leave more usable room than the pointed shapes above
}

interface DrawObj {
  id: string; type: ObjType
  x: number; y: number; w: number; h: number
  x1: number; y1: number; x2: number; y2: number
  mx: number; my: number; connType: ConnType
  pts: Pt[]; eraser: boolean
  color: string; fillColor: string; filled: boolean; sw: number
  // "No Outline" — hides the stroke entirely while leaving color/sw/fill/the
  // object itself untouched, so turning the outline back on restores exactly
  // what it looked like before. Optional/defaults false so every object saved
  // before this field existed keeps drawing its outline exactly as today.
  noOutline?: boolean
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
  // Connector-to-connector junction (line/arrow only): the SAME idea as above,
  // but the endpoint is anchored to a normalized position (0=start..1=end)
  // ALONG another connector's own path instead of a perimeter angle on a shape
  // — see getPointAtT/resolveAttachments. A connector endpoint is attached to
  // at most one of {shape, connector} at a time; mutually exclusive with the
  // attach*Id/attach*Angle pair above for the same end.
  attachStartConnId: string | null; attachStartT: number
  attachEndConnId: string | null; attachEndT: number
  // Arrow only: draws an arrowhead at BOTH ends instead of just the end point.
  doubleEnded: boolean
  // Arrow only: which single endpoint owns the arrowhead when NOT doubleEnded
  // ('end' matches all prior behavior/saved data). "Switch Arrow" flips this
  // without touching x1/y1/x2/y2/mx/my or any attachment — purely cosmetic.
  headAt: 'start' | 'end'
  // elbow/elbow-curved only: which of the TWO geometrically valid orthogonal
  // corners is in use — 'v' = (x1,y2) (vertical leg from the start, then
  // horizontal to the end — the original/default look), 'h' = (x2,y1)
  // (horizontal leg first, then vertical). A single bend between two FIXED
  // endpoints has exactly these two orthogonal solutions; any other point
  // makes one leg diagonal, which was the bug. The corner is always DERIVED
  // from this flag + the current x1/y1/x2/y2 (see getElbowCorner) rather than
  // stored as a free coordinate, so move/rotate/flip/resize never need to
  // touch it — it's automatically still orthogonal after any of them.
  elbowBend: 'v' | 'h'
}

// Shared full-geometry snapshot — captured once at drag-start and read back
// against the TOTAL delta/scale-so-far on every subsequent move tick, never
// re-derived from the (already-mutated) live object. Re-deriving from the live
// object instead of this baseline is exactly the bug that made freehand-stroke
// rotation drift (each tick re-rotated an already-rotated point set by the
// cumulative angle) — 'move' already did this correctly; 'rotate' and the new
// 'group-resize' now follow the same rule.
type GeomSnapshot = { x:number;y:number;w:number;h:number;x1:number;y1:number;x2:number;y2:number;mx:number;my:number;pts:Pt[] }
type RotateBaseline = GeomSnapshot & { rotation: number }

type DragMode =
  | { kind: 'move';     ids: string[]; start: Pt; snap: Map<string, GeomSnapshot> }
  | { kind: 'resize';   id: string; handle: HPos; orig: DrawObj; start: Pt }
  | { kind: 'endpoint'; id: string; which: 'start'|'end'|'mid'|'turn'; turnIndex?: number; start: Pt }
  | { kind: 'marquee';  start: Pt; cur: Pt }
  | { kind: 'rotate';   ids: string[]; pivot: Pt; startAngle: number; baseline: Map<string, RotateBaseline> }
  | { kind: 'group-resize'; ids: string[]; handle: HPos; origBB: { minX:number;minY:number;maxX:number;maxY:number }; baseline: Map<string, GeomSnapshot> }
  | null

interface JournalDrawModalProps {
  isDark: boolean; initialSrc?: string
  // The live, editable object list from a previous save (see JournalBlock.canvasData).
  // When present and valid, re-editing starts from these real objects instead
  // of the flattened initialSrc PNG — undefined/invalid falls back to the PNG
  // (drawings saved before this field existed, or any parse failure).
  initialObjects?: string
  onSave: (dataUrl: string, objectsJson: string) => void; onClose: () => void
  // Full-screen immersive mode is a VIEW-ONLY concern owned by the PARENT
  // (JournalEditorContent), not this component: the parent portals {its own
  // header + this component} to document.body when fitScreen is true, which
  // is the only way to visually escape the Journal modal's own z-index
  // stacking context (and therefore render above the main mobile bottom nav —
  // a z-index set from inside that stacking context can never do that, no
  // matter how high). This component only reflects fitScreen in its Fit/
  // Restore button and asks the parent to toggle it; it never sizes/positions
  // itself differently based on it — the parent's portal wrapper does that.
  fitScreen: boolean; onToggleFitScreen: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PEN_SIZES    = [2, 4, 8, 14] as const
const ERASER_SIZES = [8, 16, 28, 44] as const
const TEXT_SIZES   = [12, 18, 26, 36] as const
const THICKNESS_LEVELS = [1, 2, 3, 5, 8] as const
const SHAPE_TOOLS: DrawTool[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst', 'capsule', 'hexagon']
// 'stroke' (freehand) rotates via the SAME render-time-transform architecture
// as the shapes below it — pts stay in local/unrotated space (see renderObj,
// hitObj, getHandlePositions), not rotated-in-place, so selection bounds,
// resize handles and hit-testing all stay correctly aligned post-rotation.
const ROTATABLE_TYPES: ObjType[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst', 'capsule', 'hexagon', 'stroke']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }
function now() { return Date.now() }

function mkObj(p: Partial<DrawObj> & { id: string; type: ObjType }): DrawObj {
  return {
    x:0,y:0,w:0,h:0,x1:0,y1:0,x2:0,y2:0,mx:0,my:0,connType:'straight',
    pts:[],eraser:false,color:'#1a1a1a',fillColor:'#7c3aed',filled:false,sw:2,
    text:'',fontSize:18,note:'',noteFontSize:13,noteListType:'none',
    flipX:false,flipY:false,gid:'',src:'',rotation:0,
    attachStartId:null,attachStartAngle:0,attachEndId:null,attachEndAngle:0,
    attachStartConnId:null,attachStartT:0,attachEndConnId:null,attachEndT:0,
    doubleEnded:false, headAt:'end', elbowBend:'v', ...p,
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
  if (type === 'checkbox') return '☐'
  return ''
}

// Each line of `note` is one list item (when noteListType !== 'none') — Enter
// naturally continues the active list type, and switching types just changes
// how the SAME lines render, so nothing ever needs rewriting/"stacking." An
// EMPTY line still gets its marker (not just lines with typed text) so a
// freshly chosen list type shows its marker immediately, ready to type after.
type NoteLine = { text: string; indent: number; marker?: string }
function wrapNoteContent(c: CanvasRenderingContext2D, note: string, maxWidth: number, fontPx: number, listType: NoteListType): NoteLine[] {
  if (listType === 'none') return wrapTextLines(c, note, maxWidth, fontPx).map(t => ({ text: t, indent: 0 }))
  c.font = `400 ${fontPx}px sans-serif`
  const indent = c.measureText('99.').width + 5
  const out: NoteLine[] = []
  note.split('\n').forEach((item, i) => {
    const marker = getListMarker(listType, i)
    if (item.trim() === '') { out.push({ text: '', indent, marker }); return }
    wrapTextLines(c, item, Math.max(10, maxWidth - indent), fontPx).forEach((ln, li) => {
      out.push({ text: ln, indent, marker: li === 0 ? marker : undefined })
    })
  })
  return out
}

// The Title's usable wrap width for a Title-only shape at the given bbox
// width — a fixed fraction of the bbox (TITLE_SAFE_RATIO) for the compact
// non-rectangular shapes, or the plain padded bbox width for everything else.
function getTitleSafeWidth(type: ObjType, bboxW: number): number {
  const r = TITLE_SAFE_RATIO[type]
  return r ? Math.max(10, Math.abs(bboxW) * r.w) : Math.max(10, Math.abs(bboxW) - SHAPE_TEXT_PAD * 2)
}

// The centered box the Title is drawn/edited in for a Title-only shape, in
// SCREEN space — width from getTitleSafeWidth, height/position approximated
// per shape (triangle's usable band sits low, near its wider base).
function getTitleSafeRect(type: ObjType, bb: { minX:number;minY:number;maxX:number;maxY:number }): { cx:number; cy:number; w:number } {
  const fullH = bb.maxY - bb.minY
  const cx = (bb.minX + bb.maxX) / 2
  const w = getTitleSafeWidth(type, bb.maxX - bb.minX)
  if (type === 'triangle') return { cx, cy: bb.minY + fullH * 0.64, w }
  return { cx, cy: (bb.minY + bb.maxY) / 2, w }
}

// The minimum height needed so the current Title/Note content never overflows
// the shape at its CURRENT width — callers grow (never shrink below this) `h`.
function computeRequiredHeight(c: CanvasRenderingContext2D, obj: DrawObj): number {
  const hasTitle = !!obj.text.trim(), hasNote = !!obj.note.trim()
  if (!hasTitle && !hasNote) return 40
  const isTitleOnly = TITLE_ONLY_TYPES.includes(obj.type)
  if (hasTitle && !hasNote) {
    const innerW = isTitleOnly ? getTitleSafeWidth(obj.type, obj.w) : Math.max(10, Math.abs(obj.w) - SHAPE_TEXT_PAD * 2)
    const lines = wrapTextLines(c, obj.text, innerW, obj.fontSize, '600')
    const textH = lines.length * (obj.fontSize * 1.25) + SHAPE_TEXT_PAD * 2
    if (!isTitleOnly) return Math.max(40, textH)
    // Non-rect Title-only shapes: the usable interior is only a fraction of the
    // bbox height (TITLE_SAFE_RATIO), so the bbox itself must grow by the
    // inverse of that fraction for the text to actually fit inside the shape.
    const heightRatio = TITLE_SAFE_RATIO[obj.type]?.h ?? 1
    return Math.max(40, textH / heightRatio)
  }
  const innerW = Math.max(10, Math.abs(obj.w) - SHAPE_TEXT_PAD * 2)
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
// 'stroke' (freehand) participates too — connectors attach to its bbox via the
// same rayBoxIntersection approximation already used for the custom shapes.
const CONNECTABLE_TYPES: ObjType[] = ['rect', 'rect-r', 'circle', 'triangle', 'diamond', 'starburst', 'capsule', 'hexagon', 'image', 'stroke']

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

// The ONLY two points that keep both legs of a single-bend elbow connector
// orthogonal between its two FIXED endpoints — 'v' puts the vertical leg
// first (down/up from the start, then across — the original default look),
// 'h' puts the horizontal leg first. Any OTHER point makes one leg diagonal,
// which was the bug: the corner used to be stored as a free (mx,my) coordinate
// that dragging could move anywhere. Deriving it fresh from elbowBend + the
// CURRENT endpoints means it's automatically still orthogonal after every
// move/rotate/flip/resize, with nothing to remap.
function getElbowCorner(obj: DrawObj): Pt {
  return obj.elbowBend === 'h' ? { x: obj.x2, y: obj.y1 } : { x: obj.x1, y: obj.y2 }
}

// The actual point at normalized position `t` (0=start..1=end) along a
// connector's OWN rendered path — mirrors renderObj's path construction per
// connType. Elbow/elbow-curved are parametrized as a two-segment polyline
// (t<0.5 on the first leg, t>=0.5 on the second) — a bbox-style approximation
// of elbow-curved's rounded corner, same "good enough" philosophy already
// used for the custom-shape connector anchors above.
function getPointAtT(conn: DrawObj, t: number): Pt {
  const ct = Math.max(0, Math.min(1, t))
  if (conn.connType === 'curved') {
    const mt = 1 - ct
    return {
      x: mt*mt*conn.x1 + 2*mt*ct*conn.mx + ct*ct*conn.x2,
      y: mt*mt*conn.y1 + 2*mt*ct*conn.my + ct*ct*conn.y2,
    }
  }
  if (conn.connType === 'elbow' || conn.connType === 'elbow-curved') {
    // A multi-turn path (see the live orthogonal-drawing tool): parametrize by
    // distance along the full polyline rather than a fixed 2-segment split, so
    // this generalizes to any number of turns.
    if (conn.pts.length >= 2) {
      const pts = conn.pts
      const segLens: number[] = []
      let total = 0
      for (let i = 0; i < pts.length-1; i++) { const d = Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y); segLens.push(d); total += d }
      if (total < 0.001) return pts[0]
      let target = ct*total
      for (let i = 0; i < segLens.length; i++) {
        if (target <= segLens[i] || i === segLens.length-1) {
          const u = segLens[i] < 0.001 ? 0 : Math.max(0, Math.min(1, target/segLens[i]))
          return { x: pts[i].x+(pts[i+1].x-pts[i].x)*u, y: pts[i].y+(pts[i+1].y-pts[i].y)*u }
        }
        target -= segLens[i]
      }
      return pts[pts.length-1]
    }
    const { x:cornerX, y:cornerY } = getElbowCorner(conn)
    if (ct < 0.5) { const u = ct*2; return { x: conn.x1+(cornerX-conn.x1)*u, y: conn.y1+(cornerY-conn.y1)*u } }
    const u = (ct-0.5)*2
    return { x: cornerX+(conn.x2-cornerX)*u, y: cornerY+(conn.y2-cornerY)*u }
  }
  return { x: conn.x1+(conn.x2-conn.x1)*ct, y: conn.y1+(conn.y2-conn.y1)*ct }
}

// Keeps the segment between a dragged joint (its NEW position `moved`) and an
// adjacent joint orthogonal: whichever coordinate the two shared BEFORE the
// drag (compared against the pre-drag positions in `oldPts`) is kept shared
// afterward too — the standard "dragging a corner extends its rails" technique
// orthogonal-connector editors use, generalized to any joint in the path.
function adjustNeighborForOrthogonality(oldPts: Pt[], movedIdx: number, neighborIdx: number, moved: Pt): Pt {
  const neighbor = oldPts[neighborIdx], old = oldPts[movedIdx]
  const sameY = Math.abs(neighbor.y - old.y) <= Math.abs(neighbor.x - old.x)
  return sameY ? { x: neighbor.x, y: moved.y } : { x: moved.x, y: neighbor.y }
}

// Samples a connector's path to find the closest point to `pos` — "nearest
// valid point along that path," not just its endpoints/midpoint. The path is
// short on-screen, so a dense sample is cheap and precise enough without
// needing a closed-form/calculus-based nearest-point solve.
const CONNECTOR_SNAP_SAMPLES = 48
function findNearestPointOnConnector(conn: DrawObj, pos: Pt): { t: number; point: Pt; dist: number } {
  let best = { t: 0, point: getPointAtT(conn, 0), dist: Infinity }
  for (let i = 0; i <= CONNECTOR_SNAP_SAMPLES; i++) {
    const t = i / CONNECTOR_SNAP_SAMPLES
    const p = getPointAtT(conn, t)
    const d = Math.hypot(p.x-pos.x, p.y-pos.y)
    if (d < best.dist) best = { t, point: p, dist: d }
  }
  return best
}

type AttachCandidate =
  | { kind: 'shape'; target: DrawObj; angle: number }
  | { kind: 'connector'; target: DrawObj; t: number; point: Pt }

// Combines the existing shape-attach search with a new connector-to-connector
// junction search — a shape target always wins when both are in range (shapes
// are the far more common target and this keeps the existing behavior's
// priority unchanged); only when no shape is near does a nearby connector
// become a valid junction target.
const CONNECTOR_SNAP_DIST = 14
// A more generous "magnetic" radius just for snapping onto another
// connector's own endpoint (t=0 or t=1) — this is what fuses two lines into
// one true shared joint, so it gets first priority and more forgiveness than
// landing at an arbitrary point along the middle of a path.
const JOINT_SNAP_DIST = 22
function findAttachTargetAny(objs: DrawObj[], excludeId: string, pos: Pt): AttachCandidate | null {
  const shapeHit = findAttachTarget(objs, excludeId, pos)
  if (shapeHit) return { kind: 'shape', target: shapeHit.target, angle: shapeHit.angle }

  let bestJoint: AttachCandidate | null = null
  let bestJointDist = JOINT_SNAP_DIST
  for (const o of objs) {
    if (o.id === excludeId || (o.type !== 'line' && o.type !== 'arrow')) continue
    for (const t of [0, 1] as const) {
      const p = getPointAtT(o, t)
      const d = Math.hypot(p.x-pos.x, p.y-pos.y)
      if (d < bestJointDist) { bestJointDist = d; bestJoint = { kind: 'connector', target: o, t, point: p } }
    }
  }
  if (bestJoint) return bestJoint

  let best: AttachCandidate | null = null
  let bestDist = CONNECTOR_SNAP_DIST
  for (const o of objs) {
    if (o.id === excludeId || (o.type !== 'line' && o.type !== 'arrow')) continue
    const near = findNearestPointOnConnector(o, pos)
    if (near.dist < bestDist) { bestDist = near.dist; best = { kind: 'connector', target: o, t: near.t, point: near.point } }
  }
  return best
}

// A connector endpoint attached to ANOTHER connector's own endpoint (t≈0 or
// t≈1, not some arbitrary midpoint) is a true shared joint, not just two
// endpoints that happen to overlap — grabbing EITHER side of it should drag
// the same underlying point. Since the attached endpoint's position is only
// ever DERIVED from its host (see resolveAttachments), dragging it directly
// would just detach it; redirecting the drag to the host's own matching
// endpoint instead makes every connector sharing that joint move together,
// using the existing move/resolveAttachments machinery unchanged. Follows a
// chain of joints (A's endpoint attached to B's, attached to C's, …) to the
// root host; a cycle/depth guard keeps a malformed chain from looping.
const JOINT_T_EPS = 0.02
function resolveJointRedirect(objs: DrawObj[], id: string, which: 'start'|'end', depth = 0): { id: string; which: 'start'|'end' } {
  if (depth > 12) return { id, which }
  const obj = objs.find(o => o.id === id)
  if (!obj) return { id, which }
  const connId = which === 'start' ? obj.attachStartConnId : obj.attachEndConnId
  const t       = which === 'start' ? obj.attachStartT     : obj.attachEndT
  if (!connId) return { id, which }
  if (t <= JOINT_T_EPS) return resolveJointRedirect(objs, connId, 'start', depth+1)
  if (t >= 1 - JOINT_T_EPS) return resolveJointRedirect(objs, connId, 'end', depth+1)
  return { id, which } // attached to a genuine midpoint of the host — leave as-is, not a joint
}

// Re-maps a chord-relative control point from an OLD chord to a NEW one so a
// manually bent curve keeps its RELATIVE shape (how far along the chord, how
// far off to the side) instead of snapping back to the straight midpoint
// whenever an attached object moves — that unconditional reset was the bug
// behind curves regressing to straight lines after any attached-object update.
function remapControlPoint(ox1:number,oy1:number,ox2:number,oy2:number, mx:number,my:number, nx1:number,ny1:number,nx2:number,ny2:number): Pt {
  const oldLen = Math.hypot(ox2-ox1, oy2-oy1)
  const newMid = { x:(nx1+nx2)/2, y:(ny1+ny2)/2 }
  if (oldLen < 0.01) return newMid
  const dirX = (ox2-ox1)/oldLen, dirY = (oy2-oy1)/oldLen
  const perpX = -dirY, perpY = dirX
  const offX = mx-(ox1+ox2)/2, offY = my-(oy1+oy2)/2
  const alongFrac = (offX*dirX + offY*dirY) / oldLen
  const perpFrac  = (offX*perpX + offY*perpY) / oldLen
  const newLen = Math.hypot(nx2-nx1, ny2-ny1)
  if (newLen < 0.01) return newMid
  const ndirX = (nx2-nx1)/newLen, ndirY = (ny2-ny1)/newLen
  const nperpX = -ndirY, nperpY = ndirX
  return {
    x: newMid.x + alongFrac*newLen*ndirX + perpFrac*newLen*nperpX,
    y: newMid.y + alongFrac*newLen*ndirY + perpFrac*newLen*nperpY,
  }
}

// Re-resolves every attached connector endpoint against its target's CURRENT
// geometry — called after every move/resize/rotate/auto-grow so "if the shape
// moves/resizes/rotates, the connector follows" holds unconditionally. Also
// resolves connector-to-connector junctions (attachStartConnId/attachEndConnId),
// which may themselves be attached to something else — resolved recursively
// (memoized so a connector with many children is only computed once, and a
// `resolving` guard + depth cap bail out of any cycle instead of looping).
function resolveAttachments(objs: DrawObj[]): DrawObj[] {
  const byId = new Map(objs.map(o => [o.id, o]))
  const resolved = new Map<string, DrawObj>()
  const resolving = new Set<string>()

  function resolve(id: string, depth = 0): DrawObj | undefined {
    const cached = resolved.get(id); if (cached) return cached
    const o = byId.get(id); if (!o) return undefined
    if (o.type !== 'line' && o.type !== 'arrow') { resolved.set(id, o); return o }
    if (!o.attachStartId && !o.attachEndId && !o.attachStartConnId && !o.attachEndConnId) { resolved.set(id, o); return o }
    if (resolving.has(id) || depth > 24) return o // cycle/depth guard — keep current geometry rather than recurse forever
    resolving.add(id)

    const oldX1=o.x1, oldY1=o.y1, oldX2=o.x2, oldY2=o.y2
    let x1=oldX1, y1=oldY1, x2=oldX2, y2=oldY2

    if (o.attachStartId) {
      const t = byId.get(o.attachStartId)
      if (t) { const p = getPerimeterPoint(t, o.attachStartAngle); x1=p.x; y1=p.y }
    } else if (o.attachStartConnId) {
      const t = resolve(o.attachStartConnId, depth+1)
      if (t) { const p = getPointAtT(t, o.attachStartT); x1=p.x; y1=p.y }
    }
    if (o.attachEndId) {
      const t = byId.get(o.attachEndId)
      if (t) { const p = getPerimeterPoint(t, o.attachEndAngle); x2=p.x; y2=p.y }
    } else if (o.attachEndConnId) {
      const t = resolve(o.attachEndConnId, depth+1)
      if (t) { const p = getPointAtT(t, o.attachEndT); x2=p.x; y2=p.y }
    }

    const mp = remapControlPoint(oldX1,oldY1,oldX2,oldY2, o.mx,o.my, x1,y1,x2,y2)
    const out = { ...o, x1, y1, x2, y2, mx:mp.x, my:mp.y }
    resolving.delete(id)
    resolved.set(id, out)
    return out
  }

  return objs.map(o => resolve(o.id) ?? o)
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

// Elongated horizontal hexagon — flat top/bottom edges, pointed left/right
// ends. The corner inset scales off the SHORTER side so the point stays a
// clean diagonal cut rather than stretching into a near-triangle on a very
// wide/short box.
function drawHexagonPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cut = Math.min(Math.abs(w), Math.abs(h)) * 0.25
  c.beginPath()
  c.moveTo(x+cut, y)
  c.lineTo(x+w-cut, y)
  c.lineTo(x+w, y+h/2)
  c.lineTo(x+w-cut, y+h)
  c.lineTo(x+cut, y+h)
  c.lineTo(x, y+h/2)
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
    const isTitleOnly = TITLE_ONLY_TYPES.includes(obj.type)
    const safe = isTitleOnly ? getTitleSafeRect(obj.type, bb) : { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2, w: innerW }
    const lines = wrapTextLines(c, obj.text, safe.w, obj.fontSize, '600')
    const lineH = obj.fontSize * 1.25
    const cx = safe.cx, cy = safe.cy
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
    // On touchend/touchcancel the lifted finger is no longer "currently
    // touching," so `touches` is already empty by the time the handler runs —
    // the touch that just ended lives in `changedTouches` instead. Without
    // this fallback, every drag-to-create gesture (shapes/lines/arrows) reads
    // a null release position on mobile and silently fails to commit, while
    // freehand strokes look unaffected since they never need the release
    // position (they finalize from the points already accumulated on move).
    const t = e.touches.length > 0 ? e.touches[0] : e.changedTouches.length > 0 ? e.changedTouches[0] : null
    if (!t) return null
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
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
  if (obj.type === 'line' || obj.type === 'arrow') {
    // A multi-turn path (see the live orthogonal drawing tool) can bow out
    // past its own start/end — its bbox must span every joint, not just the
    // two ends, so marquee-select/group-bbox/rotation-pivot all stay correct.
    if (obj.pts.length >= 2) {
      const xs = obj.pts.map(p=>p.x), ys = obj.pts.map(p=>p.y)
      return { minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys) }
    }
    return { minX:Math.min(obj.x1,obj.x2),minY:Math.min(obj.y1,obj.y2),maxX:Math.max(obj.x1,obj.x2),maxY:Math.max(obj.y1,obj.y2) }
  }
  if (obj.type === 'stroke') {
    if (obj.pts.length === 0) return { minX:0,minY:0,maxX:0,maxY:0 }
    const xs = obj.pts.map(p=>p.x), ys = obj.pts.map(p=>p.y)
    return { minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys) }
  }
  if (obj.type === 'text') { const est = obj.fontSize*obj.text.length*0.6; return { minX:obj.x,minY:obj.y,maxX:obj.x+est,maxY:obj.y+obj.fontSize } }
  return { minX:Math.min(obj.x,obj.x+obj.w),minY:Math.min(obj.y,obj.y+obj.h),maxX:Math.max(obj.x,obj.x+obj.w),maxY:Math.max(obj.y,obj.y+obj.h) }
}

function hitObj(obj: DrawObj, px: number, py: number, thresh = 12): boolean {
  // Path-aware distance (not just distance-to-the-straight-chord) so an
  // elbow/elbow-curved/curved connector's actual bent/curved route is what
  // gets hit-tested — a straight-line check made those types hard to select
  // anywhere except near their literal endpoints. The visible stroke width
  // is unchanged; only this invisible hit margin is more generous.
  if (obj.type === 'line' || obj.type === 'arrow') return findNearestPointOnConnector(obj, { x:px, y:py }).dist < thresh
  const { minX,minY,maxX,maxY } = getObjBB(obj)
  // Rotated shapes (and freehand strokes, which store pts in LOCAL/unrotated
  // space and rotate purely as a render-time transform — see renderObj) are
  // tested in their own local space — inverse-rotate the pointer around the
  // object's center before the plain bbox/point test.
  if (obj.rotation && ROTATABLE_TYPES.includes(obj.type)) {
    const center = { x: (minX+maxX)/2, y: (minY+maxY)/2 }
    const local = rotatePt({ x: px, y: py }, center, -obj.rotation)
    px = local.x; py = local.y
  }
  if (obj.type === 'stroke') return obj.pts.some(pt => Math.hypot(pt.x-px,pt.y-py) < thresh+obj.sw/2)
  if (obj.type === 'text' || obj.type === 'image') return px>=minX&&px<=maxX&&py>=minY&&py<=maxY
  // Any reasonable visible portion of a shape selects it — including an
  // unfilled shape's hollow interior, not just its border band.
  return px>=minX-thresh&&px<=maxX+thresh&&py>=minY-thresh&&py<=maxY+thresh
}

// A freehand stroke counts as "closed" (fillable) when its start/end points
// land close together relative to its own size — a sensible tolerance, not an
// exact test, so a deliberate loop (heart, circle sketch) fills while an
// obviously open scribble never produces a huge malformed fill.
function isStrokeClosed(pts: Pt[]): boolean {
  if (pts.length < 3) return false
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y)
  const diag = Math.hypot(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys))
  if (diag < 6) return false
  const gap = Math.hypot(pts[pts.length-1].x-pts[0].x, pts[pts.length-1].y-pts[0].y)
  return gap <= Math.max(16, diag*0.12)
}

function renderObj(c: CanvasRenderingContext2D, obj: DrawObj, imgCache?: Map<string, HTMLImageElement>, onImgLoad?: () => void) {
  c.save()
  c.strokeStyle = obj.color; c.fillStyle = obj.filled ? obj.fillColor : obj.color
  // "No Outline": a 0-width canvas stroke paints nothing (per spec), so every
  // c.stroke() call below naturally becomes invisible without touching each
  // shape branch individually — sw/color themselves are untouched, so turning
  // the outline back on restores exactly what it looked like before.
  c.lineWidth = obj.noOutline ? 0 : obj.sw
  c.lineCap = 'round'; c.lineJoin = 'round'

  if (obj.type === 'stroke') {
    if (obj.pts.length < 2) { c.restore(); return }
    // pts are always stored in LOCAL (unrotated) space — rotation is purely a
    // render-time transform around the stroke's own bbox center, exactly like
    // the shape types below, so selection bounds/handles/hit-testing (which
    // all derive from this same local bbox) stay correctly aligned post-rotation.
    if (obj.rotation) {
      const sbb = getObjBB(obj)
      const scx = (sbb.minX+sbb.maxX)/2, scy = (sbb.minY+sbb.maxY)/2
      c.translate(scx,scy); c.rotate(obj.rotation); c.translate(-scx,-scy)
    }
    c.beginPath(); c.moveTo(obj.pts[0].x, obj.pts[0].y)
    for (const pt of obj.pts.slice(1)) c.lineTo(pt.x, pt.y)
    // canvas fill() implicitly closes the path for filling purposes only — the
    // stroke drawn right after still outlines just the actual drawn points, so
    // the original freehand outline is preserved even where it never quite met.
    if (!obj.eraser && obj.filled && isStrokeClosed(obj.pts)) { c.fillStyle = obj.fillColor; c.fill() }
    c.strokeStyle = obj.eraser ? '#ffffff' : obj.color
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
    // A path traced with the live multi-turn orthogonal tool (see
    // continueStroke) — any number of 90° turns, not just the single derived
    // corner the 2-point legacy elbow uses below.
    const multiPath = isElbow && obj.pts.length >= 2 ? obj.pts : null
    // The elbow corner is DERIVED from elbowBend + the current endpoints (see
    // getElbowCorner) — the only two points that keep both legs orthogonal —
    // never a free coordinate, so it can't be dragged into a diagonal leg.
    const { x:cornerX, y:cornerY } = (isElbow && !multiPath) ? getElbowCorner(obj) : { x:0, y:0 }
    c.beginPath()
    if (multiPath) {
      c.moveTo(multiPath[0].x, multiPath[0].y)
      for (let i = 1; i < multiPath.length-1; i++) {
        if (obj.connType === 'elbow-curved') {
          const leg1 = Math.hypot(multiPath[i].x-multiPath[i-1].x, multiPath[i].y-multiPath[i-1].y)
          const leg2 = Math.hypot(multiPath[i+1].x-multiPath[i].x, multiPath[i+1].y-multiPath[i].y)
          const r = Math.max(0, Math.min(16, leg1/2, leg2/2))
          c.arcTo(multiPath[i].x, multiPath[i].y, multiPath[i+1].x, multiPath[i+1].y, r)
        } else {
          c.lineTo(multiPath[i].x, multiPath[i].y)
        }
      }
      c.lineTo(multiPath[multiPath.length-1].x, multiPath[multiPath.length-1].y)
    }
    else if (obj.connType === 'curved') { c.moveTo(obj.x1,obj.y1); c.quadraticCurveTo(obj.mx,obj.my,obj.x2,obj.y2) }
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
    // Arrowhead reference points — the point just before each end, so the
    // head points along that end's own final segment direction.
    let tx: number, ty: number, tx2: number, ty2: number
    if (multiPath) {
      tx = multiPath[multiPath.length-2].x; ty = multiPath[multiPath.length-2].y
      tx2 = multiPath[1].x; ty2 = multiPath[1].y
    } else {
      tx = isElbow ? cornerX : (obj.connType !== 'straight' ? obj.mx : obj.x1)
      ty = isElbow ? cornerY : (obj.connType !== 'straight' ? obj.my : obj.y1)
      // Same "approach point" logic mirrored for the START end — the near-start
      // leg of a curve/elbow points back toward the same reference point its
      // near-end leg points away from (mx,my for curved; the corner for elbow).
      tx2 = isElbow ? cornerX : (obj.connType !== 'straight' ? obj.mx : obj.x2)
      ty2 = isElbow ? cornerY : (obj.connType !== 'straight' ? obj.my : obj.y2)
    }
    // Switch Arrow (headAt) swaps which single endpoint owns the arrowhead
    // without touching geometry/attachments/bends — moot once doubleEnded
    // already draws both, so that always wins regardless of headAt.
    if (obj.doubleEnded) {
      drawArrowHead(c, tx, ty, obj.x2, obj.y2, obj.sw)
      drawArrowHead(c, tx2, ty2, obj.x1, obj.y1, obj.sw)
    } else if (obj.headAt === 'start') {
      drawArrowHead(c, tx2, ty2, obj.x1, obj.y1, obj.sw)
    } else {
      drawArrowHead(c, tx, ty, obj.x2, obj.y2, obj.sw)
    }
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
  // Capsule/pill: roundRect's own radius clamp (min(r, |w|/2, |h|/2)) already
  // caps out at exactly half the shorter side when asked for a huge radius —
  // that IS the true capsule shape, fully rounded regardless of orientation.
  else if (obj.type === 'capsule') { roundRect(c,obj.x,obj.y,obj.w,obj.h,9999); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'circle') { c.beginPath(); c.ellipse(obj.x+obj.w/2,obj.y+obj.h/2,Math.abs(obj.w)/2,Math.abs(obj.h)/2,0,0,Math.PI*2); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'triangle') { c.beginPath(); c.moveTo(obj.x+obj.w/2,obj.y); c.lineTo(obj.x+obj.w,obj.y+obj.h); c.lineTo(obj.x,obj.y+obj.h); c.closePath(); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'diamond') { c.beginPath(); c.moveTo(obj.x+obj.w/2,obj.y); c.lineTo(obj.x+obj.w,obj.y+obj.h/2); c.lineTo(obj.x+obj.w/2,obj.y+obj.h); c.lineTo(obj.x,obj.y+obj.h/2); c.closePath(); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'starburst') { drawStarburstPath(c,obj.x,obj.y,obj.w,obj.h); if (obj.filled) c.fill(); c.stroke() }
  else if (obj.type === 'hexagon') { drawHexagonPath(c,obj.x,obj.y,obj.w,obj.h); if (obj.filled) c.fill(); c.stroke() }
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
// A simple tilted block eraser — a single rounded-rect body with a lighter
// "worn corner" patch at one end (the classic two-tone eraser cue), no size
// letter baked in (the size lives in the popover, same as Pen), and no
// crossing line through the middle (the previous version's diagonal cut read
// as a "+" at toolbar size rather than as an eraser).

const EraserIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ display:'block', transform:'rotate(-40deg)' }}>
    <rect x="3" y="7" width="14" height="7" rx="1.8" fill="currentColor" opacity="0.85"/>
    <rect x="3" y="7" width="5.5" height="7" rx="1.8" fill="currentColor" opacity="0.35"/>
    <rect x="3" y="7" width="14" height="7" rx="1.8" stroke="currentColor" strokeWidth="1.1"/>
  </svg>
)

// Canvas cursor for the Eraser tool — the SAME tilted two-tone block as
// EraserIcon above, baked as a standalone SVG data URI (cursor images can't
// resolve `currentColor`/CSS, and the rotation is an SVG `transform`
// attribute rather than a CSS one for reliable cross-browser cursor
// rendering). Replaces the native 'cell' cursor, which rendered as a plain
// "+" and gave no visual hint that Eraser was active. Visual only — no
// change to hit-testing/erase behavior, which never reads the CSS cursor.
const ERASER_CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 20 20">'
  + '<g transform="rotate(-40 10 10)">'
  + '<rect x="3" y="7" width="14" height="7" rx="1.8" fill="#475569" stroke="#1e293b" stroke-width="1.1"/>'
  + '<rect x="3" y="7" width="5.5" height="7" rx="1.8" fill="#cbd5e1"/>'
  + '</g></svg>'
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ERASER_CURSOR_SVG)}") 10 10, cell`

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

// A small hub-and-branches glyph — a root node with a trunk splitting into
// three evenly-spaced, aligned branches — mirrors what Align actually does
// to a mind map, rather than a generic alignment-guide icon.
// Shared circular "none" swatch — white/transparent interior + a red
// diagonal slash, the standard "no fill"/"no outline" convention — used by
// both the Fill and Outline color popovers so neither invents its own icon.
function NoFillSwatch({ active, isDark, title, onClick }: { active: boolean; isDark: boolean; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick}
      style={{
        width:22, height:22, borderRadius:'50%', flexShrink:0, cursor:'pointer', padding:0, overflow:'hidden',
        border:`1px solid ${isDark?'rgba(255,255,255,0.30)':'rgba(0,0,0,0.20)'}`,
        background:isDark?'#2a2340':'#ffffff',
        transform:active?'scale(1.15)':'scale(1)',
        boxShadow:active?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px #7c3aed`:'none',
      }}>
      <span style={{ display:'block', width:'100%', height:'100%', background:'linear-gradient(135deg, transparent 47%, #ef4444 47%, #ef4444 53%, transparent 53%)' }}/>
    </button>
  )
}

const AlignIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ display:'block' }}>
    <circle cx="2.2" cy="8" r="1.6" fill="currentColor"/>
    <path d="M3.8 8H6.5M6.5 2.5V13.5M6.5 2.5H12.5M6.5 8H12.5M6.5 13.5H12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="12.5" y="1.3" width="2.3" height="2.4" rx="0.6" fill="currentColor"/>
    <rect x="12.5" y="6.8" width="2.3" height="2.4" rx="0.6" fill="currentColor"/>
    <rect x="12.5" y="12.3" width="2.3" height="2.4" rx="0.6" fill="currentColor"/>
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

export function JournalDrawModal({ isDark: isDarkApp, initialSrc, initialObjects, onSave, onClose, fitScreen, onToggleFitScreen }: JournalDrawModalProps) {
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
  const connSnapPointRef = useRef<Pt | null>(null) // exact point a connector endpoint is currently hovering/snapping to on ANOTHER connector
  const activeRef   = useRef<DrawObj | null>(null)
  const isDownRef   = useRef(false)
  const erasedDuringGestureRef = useRef(false) // true once an eraser drag has actually removed something — one Undo step per gesture, not per tick
  const shapeStart  = useRef<Pt | null>(null)
  // Live multi-turn orthogonal drawing state (Sharp/Curved arrow tools) — see
  // continueStroke. elbowLockedPtsRef holds every permanently-committed
  // waypoint so far (starts as just the drag's start point); elbowDirRef is
  // the orientation ('h'|'v') of whichever segment is currently in progress,
  // decided by the first real movement and re-decided each time the user
  // commits a turn. Neither applies to any other tool/connType.
  const elbowLockedPtsRef = useRef<Pt[]>([])
  const elbowDirRef = useRef<'h' | 'v' | null>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const lastTapRef  = useRef<{ id: string; ts: number } | null>(null)
  // Snapshot of objectsRef at the last successful save (or at initial load, so
  // a freshly-opened canvas with no edits yet isn't flagged dirty) — compared
  // on demand when Cancel/Close is requested, rather than threading a "dirty"
  // flag through every one of the many mutation call sites below.
  const lastSavedJsonRef = useRef<string>('[]')

  const [tool,        setTool]        = useState<DrawTool>('pen')
  const [penIdx,      setPenIdx]      = useState(1)
  const [eraserIdx,   setEraserIdx]   = useState(1)
  const [textSzIdx,   setTextSzIdx]   = useState(1)
  const [drawColor,   setDrawColor]   = useState('#1a1a1a')
  const [fillColor,   setFillColor]   = useState('#7c3aed')
  const [filled,      setFilled]      = useState(false)
  const [canUndo,     setCanUndo]     = useState(false)
  const [canRedo,     setCanRedo]     = useState(false)
  const [objects,     setObjects]     = useState<DrawObj[]>([])
  const [selIds,      setSelIds]      = useState<string[]>([])
  const [textInput,   setTextInput]   = useState<{ x:number; y:number; w?:number; value:string; targetId?:string; noteValue?:string; activeField?:EditField; titleFontSize?:number; noteFontSizeLive?:number; titleOnly?:boolean } | null>(null)
  const [openPopover, setOpenPopover] = useState<PopoverId | null>(null)
  const [popAnchor,   setPopAnchor]   = useState<{ left:number; top?:number; bottom?:number } | null>(null)
  const [arrowConnDefault, setArrowConnDefault] = useState<ConnType>('elbow')
  const [doubleEndedDefault, setDoubleEndedDefault] = useState(false) // default for NEW arrows; editing a selected arrow uses toggleDoubleEnded instead
  const [showCustomFill, setShowCustomFill] = useState(false)
  const [showCustomStroke, setShowCustomStroke] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
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
        lastSavedJsonRef.current = JSON.stringify(resolved)
      } else if (initialSrc) {
        // No object data (a drawing saved before canvasData existed) — load
        // the old flattened PNG as a background, exactly as before.
        const img = new Image()
        img.onload = () => { bgImgRef.current = img; c.drawImage(img,0,0,w,h); historyRef.current = ['[]']; setCanUndo(false); setCanRedo(false); lastSavedJsonRef.current = '[]' }
        img.src = initialSrc
      } else {
        historyRef.current = ['[]']; setCanUndo(false); setCanRedo(false)
        lastSavedJsonRef.current = '[]'
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
      // Connector-to-connector junction feedback — a small purple dot at the
      // exact point the dragged endpoint will attach to on ANOTHER connector,
      // visible only during the drag; the real junction stays visually clean.
      if (dm?.kind === 'endpoint' && connSnapPointRef.current) {
        const p = connSnapPointRef.current
        c.save(); c.fillStyle = '#7c3aed'; c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI*2); c.fill(); c.restore()
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
      // Group resize handles — the whole selection scales as one rigid unit
      // (see the 'group-resize' DragMode), same 8-handle layout as a single shape.
      const gminX=minX-6, gminY=minY-6, gmaxX=maxX+6, gmaxY=maxY+6
      const ggx=(gminX+gmaxX)/2, ggy=(gminY+gmaxY)/2
      for (const h of [{x:gminX,y:gminY},{x:ggx,y:gminY},{x:gmaxX,y:gminY},{x:gmaxX,y:ggy},{x:gmaxX,y:gmaxY},{x:ggx,y:gmaxY},{x:gminX,y:gmaxY},{x:gminX,y:ggy}]) {
        drawHandleDot(c, h.x, h.y)
      }
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
      const isElbowSel = obj.type === 'arrow' && (obj.connType === 'elbow' || obj.connType === 'elbow-curved')
      const multiPath = isElbowSel && obj.pts.length >= 2 ? obj.pts : null
      c.beginPath()
      if (multiPath) { c.moveTo(multiPath[0].x,multiPath[0].y); for (const p of multiPath.slice(1)) c.lineTo(p.x,p.y) }
      else { c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2) }
      c.stroke(); c.restore()
      if (multiPath) {
        // One draggable joint dot per point on the path — start/end plus every
        // turn in between, each individually selectable/movable (see getTarget
        // and the 'turn' DragMode below).
        drawHandleDot(c, multiPath[0].x, multiPath[0].y)
        drawHandleDot(c, multiPath[multiPath.length-1].x, multiPath[multiPath.length-1].y)
        for (let i = 1; i < multiPath.length - 1; i++) drawHandleDot(c, multiPath[i].x, multiPath[i].y, '#ede9fe')
      } else {
        drawHandleDot(c, obj.x1, obj.y1); drawHandleDot(c, obj.x2, obj.y2)
        // Every connType gets the same draggable mid/bend handle — for elbow/
        // elbow-curved this dot sits at the current (always-orthogonal) corner.
        const midDot = isElbowSel ? getElbowCorner(obj) : { x:obj.mx, y:obj.my }
        drawHandleDot(c, midDot.x, midDot.y, '#ede9fe')
      }
      return
    }
    if (obj.type === 'text') {
      const bb = getObjBB(obj)
      c.strokeRect(bb.minX-4, bb.minY-4, bb.maxX-bb.minX+8, bb.maxY-bb.minY+8)
      c.restore(); return
    }
    const { minX,minY,maxX,maxY } = getObjBB(obj)
    // The dashed box itself rotates with the object (not just the handle dots,
    // which getHandlePositions already rotates) so it visually matches the
    // actual rotated shape/stroke instead of showing a stale axis-aligned box.
    if (obj.rotation && ROTATABLE_TYPES.includes(obj.type)) {
      const bcx=(minX+maxX)/2, bcy=(minY+maxY)/2
      c.save(); c.translate(bcx,bcy); c.rotate(obj.rotation); c.translate(-bcx,-bcy)
      c.strokeRect(minX-2, minY-2, maxX-minX+4, maxY-minY+4)
      c.restore()
    } else {
      c.strokeRect(minX-2, minY-2, maxX-minX+4, maxY-minY+4)
    }
    c.restore()
    for (const h of getHandlePositions(obj)) drawHandleDot(c, h.x, h.y)
    if (ROTATABLE_TYPES.includes(obj.type)) {
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
  type ItTarget = {kind:'none'} | {kind:'object';id:string} | {kind:'handle';id:string;which:HPos|'start'|'end'|'mid'|'turn';turnIndex?:number} | {kind:'rotate';ids:string[]} | {kind:'group-handle';handle:HPos}

  function getTarget(px: number, py: number): ItTarget {
    const HR = 10

    // Rotation handle(s) — checked first since they sit outside every other
    // hit region and never overlap resize/endpoint handles.
    const selObjsNow = objectsRef.current.filter(o => selIdsRef.current.includes(o.id))
    if (selObjsNow.length === 1 && ROTATABLE_TYPES.includes(selObjsNow[0].type)) {
      const rp = getRotateHandlePos(selObjsNow[0])
      if (Math.hypot(rp.x-px, rp.y-py) < HR) return {kind:'rotate', ids:[selObjsNow[0].id]}
    } else if (selObjsNow.length > 1) {
      const bbs = selObjsNow.map(getObjBB)
      const minX = Math.min(...bbs.map(b=>b.minX)), maxX = Math.max(...bbs.map(b=>b.maxX))
      const minY = Math.min(...bbs.map(b=>b.minY)), maxY = Math.max(...bbs.map(b=>b.maxY))
      const gx = (minX+maxX)/2, gy = minY-6-20
      if (Math.hypot(gx-px, gy-py) < HR) return {kind:'rotate', ids:selIdsRef.current}
      // Group resize handles — a multi-selection (incl. an expanded group) is
      // resized as ONE rigid unit via 8 handles around its combined dashed
      // bbox, same layout as a single shape's own handles (see renderSelHandles).
      const gminX=minX-6, gminY=minY-6, gmaxX=maxX+6, gmaxY=maxY+6
      const ggx=(gminX+gmaxX)/2, ggy=(gminY+gmaxY)/2
      const groupHandles: Array<{pos:HPos;x:number;y:number}> = [
        {pos:'nw',x:gminX,y:gminY},{pos:'n',x:ggx,y:gminY},{pos:'ne',x:gmaxX,y:gminY},
        {pos:'e',x:gmaxX,y:ggy},{pos:'se',x:gmaxX,y:gmaxY},
        {pos:'s',x:ggx,y:gmaxY},{pos:'sw',x:gminX,y:gmaxY},{pos:'w',x:gminX,y:ggy},
      ]
      for (const gh of groupHandles) if (Math.hypot(gh.x-px,gh.y-py) < HR) return {kind:'group-handle', handle:gh.pos}
    }

    // Per-object resize/endpoint handles only apply to a single selection —
    // once 2+ objects are selected the group handles above own resizing instead.
    if (selIdsRef.current.length === 1) {
      for (const id of selIdsRef.current) {
        const obj = objectsRef.current.find(o => o.id === id); if (!obj) continue
        if (obj.type === 'line' || obj.type === 'arrow') {
          const isMultiElbow = obj.type === 'arrow' && (obj.connType === 'elbow' || obj.connType === 'elbow-curved') && obj.pts.length >= 2
          if (isMultiElbow) {
            // Every point on a multi-turn path is its own handle: the two ends
            // behave exactly like a normal connector's start/end (re-attach on
            // drag, via resolveJointRedirect below); each interior point is a
            // 'turn' joint (see continueStroke's endpoint-drag handling).
            for (let i = 0; i < obj.pts.length; i++) {
              const p = obj.pts[i]
              if (Math.hypot(p.x-px,p.y-py) >= HR) continue
              if (i === 0) return {kind:'handle',id,which:'start'}
              if (i === obj.pts.length-1) return {kind:'handle',id,which:'end'}
              return {kind:'handle',id,which:'turn',turnIndex:i}
            }
            continue
          }
          if (Math.hypot(obj.x1-px,obj.y1-py) < HR) return {kind:'handle',id,which:'start'}
          if (Math.hypot(obj.x2-px,obj.y2-py) < HR) return {kind:'handle',id,which:'end'}
          // Every connType exposes the same draggable mid/bend handle — for
          // elbow/elbow-curved it sits at the current (always-orthogonal) corner.
          const isElbowObj = obj.type === 'arrow' && (obj.connType === 'elbow' || obj.connType === 'elbow-curved')
          const mid = isElbowObj ? getElbowCorner(obj) : { x:obj.mx, y:obj.my }
          if (Math.hypot(mid.x-px,mid.y-py) < HR) return {kind:'handle',id,which:'mid'}
        } else if (obj.type !== 'text') {
          for (const h of getHandlePositions(obj)) {
            if (Math.hypot(h.x-px,h.y-py) < HR) return {kind:'handle',id,which:h.pos}
          }
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
        for (const o of objs) baseline.set(o.id, {x:o.x,y:o.y,w:o.w,h:o.h,x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,mx:o.mx,my:o.my,rotation:o.rotation,pts:[...o.pts]})
        dragRef.current = { kind:'rotate', ids:target.ids, pivot, startAngle: Math.atan2(pos.y-pivot.y, pos.x-pivot.x), baseline }
        return
      }
      if (target.kind === 'group-handle') {
        const objs = objectsRef.current.filter(o => selIdsRef.current.includes(o.id))
        const bbs = objs.map(getObjBB)
        const origBB = {
          minX: Math.min(...bbs.map(b=>b.minX)), minY: Math.min(...bbs.map(b=>b.minY)),
          maxX: Math.max(...bbs.map(b=>b.maxX)), maxY: Math.max(...bbs.map(b=>b.maxY)),
        }
        const baseline = new Map<string, GeomSnapshot>()
        for (const o of objs) baseline.set(o.id, {x:o.x,y:o.y,w:o.w,h:o.h,x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,mx:o.mx,my:o.my,pts:[...o.pts]})
        dragRef.current = { kind:'group-resize', ids:selIdsRef.current, handle:target.handle, origBB, baseline }
        return
      }
      if (target.kind === 'handle') {
        const obj = objectsRef.current.find(o=>o.id===target.id)!
        if (target.which === 'start' || target.which === 'end') {
          const joint = resolveJointRedirect(objectsRef.current, target.id, target.which)
          dragRef.current = {kind:'endpoint',id:joint.id,which:joint.which,start:pos}
        } else if (target.which === 'mid') {
          dragRef.current = {kind:'endpoint',id:target.id,which:target.which,start:pos}
        } else if (target.which === 'turn') {
          dragRef.current = {kind:'endpoint',id:target.id,which:'turn',turnIndex:target.turnIndex,start:pos}
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

    if (tool === 'eraser') {
      erasedDuringGestureRef.current = false
      eraseAt(pos, ERASER_SIZES[eraserIdx]/2)
      renderAll(); return
    }
    if (tool === 'pen') {
      activeRef.current = mkObj({id:uid(),type:'stroke',color:drawColor,sw:PEN_SIZES[penIdx],pts:[pos]})
      renderAll(); return
    }
    shapeStart.current = pos
    const shapeSw = tool==='line' ? THICKNESS_LEVELS[lineThickIdx] : tool==='arrow' ? THICKNESS_LEVELS[arrowThickIdx] : PEN_SIZES[penIdx]
    const connType = tool==='arrow' ? arrowConnDefault : 'straight'
    const isOrtho = tool==='arrow' && (connType==='elbow' || connType==='elbow-curved')
    elbowLockedPtsRef.current = isOrtho ? [pos] : []
    elbowDirRef.current = null
    activeRef.current = mkObj({id:uid(),type:tool as ObjType,color:drawColor,fillColor,filled,sw:shapeSw,connType, doubleEnded: tool==='arrow' && doubleEndedDefault, pts: isOrtho ? [pos] : []})
  }

  function continueStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDownRef.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getPos(e, canvas); if (!pos) return
    const dm = dragRef.current

    if (tool === 'eraser') {
      if (eraseAt(pos, ERASER_SIZES[eraserIdx]/2)) renderAll()
      return
    }

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
        const attach = findAttachTargetAny(objectsRef.current, dm.id, pos)
        snapTargetRef.current = attach?.kind === 'shape' ? attach.target.id : null
        connSnapPointRef.current = attach?.kind === 'connector' ? attach.point : null
        objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
          if (o.id !== dm.id) return o
          const newPt = attach?.kind === 'shape' ? getPerimeterPoint(attach.target, attach.angle)
            : attach?.kind === 'connector' ? attach.point
            : pos
          const attachPatch: Partial<DrawObj> = attach?.kind === 'shape'
            ? (dm.which === 'start'
                ? { attachStartId:attach.target.id, attachStartAngle:attach.angle, attachStartConnId:null }
                : { attachEndId:attach.target.id, attachEndAngle:attach.angle, attachEndConnId:null })
            : attach?.kind === 'connector'
            ? (dm.which === 'start'
                ? { attachStartId:null, attachStartConnId:attach.target.id, attachStartT:attach.t }
                : { attachEndId:null, attachEndConnId:attach.target.id, attachEndT:attach.t })
            : (dm.which === 'start' ? { attachStartId:null, attachStartConnId:null } : { attachEndId:null, attachEndConnId:null })
          // A multi-turn path (see the live orthogonal drawing tool) also keeps
          // the segment next to this endpoint orthogonal when there's an actual
          // interior turn to preserve — a plain 2-point path has no corner to
          // keep, so dragging either end there behaves like any normal endpoint.
          if (o.pts.length > 2) {
            const idx = dm.which === 'start' ? 0 : o.pts.length-1
            const neighborIdx = dm.which === 'start' ? 1 : o.pts.length-2
            const pts = [...o.pts]
            pts[idx] = newPt
            pts[neighborIdx] = adjustNeighborForOrthogonality(o.pts, idx, neighborIdx, newPt)
            return dm.which === 'start'
              ? { ...o, ...attachPatch, x1:newPt.x, y1:newPt.y, pts }
              : { ...o, ...attachPatch, x2:newPt.x, y2:newPt.y, pts }
          }
          const pts2 = o.pts.length === 2 ? (dm.which === 'start' ? [newPt, o.pts[1]] : [o.pts[0], newPt]) : o.pts
          return dm.which === 'start'
            ? { ...o, ...attachPatch, x1:newPt.x, y1:newPt.y, pts:pts2 }
            : { ...o, ...attachPatch, x2:newPt.x, y2:newPt.y, pts:pts2 }
        }))
        renderAll(); return
      }
      if (dm.which === 'turn' && dm.turnIndex !== undefined) {
        const turnIndex = dm.turnIndex
        objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
          if (o.id !== dm.id) return o
          if (turnIndex <= 0 || turnIndex >= o.pts.length-1) return o // must be a genuine interior joint
          const pts = [...o.pts]
          pts[turnIndex] = pos
          pts[turnIndex-1] = adjustNeighborForOrthogonality(o.pts, turnIndex, turnIndex-1, pos)
          pts[turnIndex+1] = adjustNeighborForOrthogonality(o.pts, turnIndex, turnIndex+1, pos)
          return { ...o, pts, x1:pts[0].x, y1:pts[0].y, x2:pts[pts.length-1].x, y2:pts[pts.length-1].y }
        }))
        renderAll(); return
      }
      // Mid/bend-handle drag never attaches to a shape. For 'curved' it
      // repositions the free control point (mx/my), and a straight connector
      // auto-promotes to 'curved' on its first such drag. For elbow/elbow-
      // curved there is NO free point to move — dragging instead picks
      // whichever of the two orthogonal corners (see getElbowCorner) the
      // pointer is currently closer to, so the bend always stays a clean 90°
      // and neither leg can ever go diagonal.
      objectsRef.current = objectsRef.current.map(o => {
        if (o.id !== dm.id) return o
        if (o.type === 'arrow' && (o.connType === 'elbow' || o.connType === 'elbow-curved')) {
          const cornerV = { x:o.x1, y:o.y2 }, cornerH = { x:o.x2, y:o.y1 }
          const closerToH = Math.hypot(pos.x-cornerH.x,pos.y-cornerH.y) < Math.hypot(pos.x-cornerV.x,pos.y-cornerV.y)
          return { ...o, elbowBend: closerToH ? 'h' : 'v' }
        }
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
          // A multi-turn path (see the live orthogonal drawing tool) rotates as
          // one rigid set of points — relative 90° corners stay exactly 90°,
          // the whole path just tilts, same as rotating any other object.
          const pts = base.pts.length >= 2 ? base.pts.map(p => rotatePt(p, dm.pivot, delta)) : base.pts
          return {...o, x1:p1.x,y1:p1.y, x2:p2.x,y2:p2.y, mx:pm.x,my:pm.y, pts}
        }
        if (o.type === 'stroke') {
          // pts stay in LOCAL/unrotated space (see renderObj) — only their
          // shared bbox center orbits the pivot (computed from the DRAG-START
          // baseline, not the live/already-shifted pts, for the same reason
          // the shape branch below uses `base` and not live x/y), while the
          // actual visual spin comes from `rotation` applied at render time.
          const bb = getObjBB({ ...o, pts: base.pts })
          const baseCenter = { x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2 }
          const newCenter = rotatePt(baseCenter, dm.pivot, delta)
          const dx = newCenter.x-baseCenter.x, dy = newCenter.y-baseCenter.y
          return {...o, pts: base.pts.map(p => ({x:p.x+dx, y:p.y+dy})), rotation: (base.rotation||0)+delta}
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

    if (dm?.kind === 'group-resize') {
      const { minX, minY, maxX, maxY } = dm.origBB
      let nx1=minX, ny1=minY, nx2=maxX, ny2=maxY
      const h = dm.handle
      if (h.includes('w')) nx1 = pos.x; if (h.includes('e')) nx2 = pos.x
      if (h.includes('n')) ny1 = pos.y; if (h.includes('s')) ny2 = pos.y
      const origW = maxX-minX || 1, origH = maxY-minY || 1
      let sx = (nx2-nx1)/origW, sy = (ny2-ny1)/origH
      if (h==='n'||h==='s') sx = 1 // edge-only handles never distort the other axis
      if (h==='e'||h==='w') sy = 1
      if (!isFinite(sx) || Math.abs(sx) < 0.05) sx = sx<0 ? -0.05 : 0.05
      if (!isFinite(sy) || Math.abs(sy) < 0.05) sy = sy<0 ? -0.05 : 0.05
      // Anchor = the corner OPPOSITE the dragged handle — it stays fixed in
      // place while every member scales relative to it, same as a single
      // shape's own resize but applied uniformly across the whole selection.
      const anchorX = h.includes('w') ? maxX : minX
      const anchorY = h.includes('n') ? maxY : minY
      const sX = (v:number) => anchorX + (v-anchorX)*sx
      const sY = (v:number) => anchorY + (v-anchorY)*sy
      objectsRef.current = resolveAttachments(objectsRef.current.map(o => {
        const base = dm.baseline.get(o.id); if (!base) return o
        if (o.type === 'stroke') return {...o, pts: base.pts.map(p => ({x:sX(p.x), y:sY(p.y)}))}
        if (o.type === 'line' || o.type === 'arrow') {
          // Independent sx/sy scaling keeps every horizontal segment horizontal
          // and every vertical one vertical (only a rotation would break that),
          // so a multi-turn path's corners stay exactly 90° under a group resize.
          const pts = base.pts.length >= 2 ? base.pts.map(p => ({x:sX(p.x), y:sY(p.y)})) : base.pts
          return {...o, x1:sX(base.x1),y1:sY(base.y1), x2:sX(base.x2),y2:sY(base.y2), mx:sX(base.mx),my:sY(base.my), pts}
        }
        // Shapes/text/image: scale the object's own bbox corners (computed from
        // the BASELINE x/y/w/h, never the live/already-scaled ones) and re-derive
        // x/y/w/h from the scaled corners — rotation is left untouched (V1 scope).
        const bb = getObjBB({ ...o, x:base.x, y:base.y, w:base.w, h:base.h })
        const ax = sX(bb.minX), bx = sX(bb.maxX), ay = sY(bb.minY), by = sY(bb.maxY)
        return { ...o, x: Math.min(ax,bx), y: Math.min(ay,by), w: Math.abs(bx-ax), h: Math.abs(by-ay) }
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
    const isOrtho = type==='arrow' && (activeRef.current.connType==='elbow' || activeRef.current.connType==='elbow-curved')
    if (isOrtho) {
      // Live multi-turn orthogonal drawing: each segment follows the pointer
      // along whichever axis (h/v) currently dominates; a clear, sustained
      // change in dominant direction commits a 90° turn at the point where
      // that happened and starts the next segment — repeatable for as many
      // turns as the user draws, never limited to one corner.
      const TURN_MIN = 14
      const locked = elbowLockedPtsRef.current
      const last = locked[locked.length-1]
      const dx = pos.x-last.x, dy = pos.y-last.y
      if (Math.hypot(dx,dy) > TURN_MIN) {
        const proposedDir: 'h'|'v' = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'
        if (elbowDirRef.current === null) {
          elbowDirRef.current = proposedDir
        } else if (proposedDir !== elbowDirRef.current) {
          const turnPt = elbowDirRef.current==='h' ? { x:pos.x, y:last.y } : { x:last.x, y:pos.y }
          if (Math.hypot(turnPt.x-last.x, turnPt.y-last.y) > TURN_MIN) {
            elbowLockedPtsRef.current = [...locked, turnPt]
            elbowDirRef.current = proposedDir
          }
        }
      }
      const lockedNow = elbowLockedPtsRef.current
      const lastNow = lockedNow[lockedNow.length-1]
      const dir = elbowDirRef.current ?? 'h'
      const liveEnd = dir==='h' ? { x:pos.x, y:lastNow.y } : { x:lastNow.x, y:pos.y }
      const fullPath = [...lockedNow, liveEnd]
      activeRef.current = { ...activeRef.current, pts: fullPath, x1:fullPath[0].x, y1:fullPath[0].y, x2:liveEnd.x, y2:liveEnd.y }
    } else if (type === 'line' || type === 'arrow') {
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

    if (tool === 'eraser') {
      // One Undo step per erase GESTURE (not per tick) — only snapshot if
      // something actually got removed, matching every other tool's behavior
      // of not polluting history with a no-op gesture.
      if (erasedDuringGestureRef.current) snapshot(objectsRef.current)
      erasedDuringGestureRef.current = false
      renderAll(); return
    }

    if (dm?.kind === 'move' || dm?.kind === 'resize' || dm?.kind === 'endpoint' || dm?.kind === 'rotate' || dm?.kind === 'group-resize') {
      dragRef.current = null; alignGuidesRef.current = []; snapTargetRef.current = null; connSnapPointRef.current = null
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
      const isOrtho = active.type==='arrow' && (active.connType==='elbow' || active.connType==='elbow-curved')
      if (isOrtho) {
        // Finalize the live multi-turn path traced during the drag — one
        // continuous connector, whatever number of 90° turns it ended up with
        // (zero turns is just a straight single segment, which is valid too).
        const finalPts = active.pts
        if (finalPts.length >= 2) {
          const first = finalPts[0], last = finalPts[finalPts.length-1]
          if (finalPts.length > 2 || Math.hypot(last.x-first.x,last.y-first.y) > 4) {
            const obj = {
              ...active, pts:finalPts, x1:first.x, y1:first.y, x2:last.x, y2:last.y,
              doubleEnded: doubleEndedDefault,
            }
            const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); syncSel([obj.id])
          }
        }
        elbowLockedPtsRef.current = []; elbowDirRef.current = null
      } else if (Math.hypot(pos.x-shapeStart.current.x,pos.y-shapeStart.current.y)>4) {
        const x1=shapeStart.current.x, y1=shapeStart.current.y, x2=pos.x, y2=pos.y
        const finalConnType = active.type==='arrow' ? arrowConnDefault : active.connType
        // elbowBend already defaults to 'v' (see mkObj) — the classic "vertical
        // trunk then horizontal" look — so no elbow-specific default is needed
        // here; mx/my only matters for 'curved' and defaults to the chord midpoint.
        const obj={...active,x1,y1,x2,y2,connType:finalConnType,doubleEnded: active.type==='arrow' && doubleEndedDefault,mx:(x1+x2)/2,my:(y1+y2)/2}
        const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n); syncSel([obj.id])
      }
    } else {
      if (!pos||!shapeStart.current){renderAll();return}
      if (Math.abs(pos.x-shapeStart.current.x)>4&&Math.abs(pos.y-shapeStart.current.y)>4) {
        const obj={...active,x:shapeStart.current.x,y:shapeStart.current.y,w:pos.x-shapeStart.current.x,h:pos.y-shapeStart.current.y}
        const n=[...objectsRef.current,obj]; syncObjs(n); snapshot(n)
        // A newly placed shape's Title/Note fields are available immediately —
        // no double-click/second-tap needed to discover them (startShapeTextEdit
        // also handles the Title-only vs Title+Note split per shape type).
        if (TEXT_CAPABLE_TYPES.includes(obj.type)) startShapeTextEdit(obj); else syncSel([obj.id])
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
    const objectsJson = JSON.stringify(objectsRef.current)
    onSave(off.toDataURL('image/png'), objectsJson)
    lastSavedJsonRef.current = objectsJson
    setToast('Mind Map saved ✓')
  }

  // ── Unsaved-changes guard (Cancel/Close) ────────────────────────────────────
  function hasUnsavedChanges(): boolean {
    return JSON.stringify(objectsRef.current) !== lastSavedJsonRef.current
  }
  function requestClose() {
    if (hasUnsavedChanges()) setShowUnsavedDialog(true)
    else onClose()
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  // Opens a floating Title+Note panel over the shape's own bounding box, tagged
  // with targetId so commitText() writes into that shape instead of creating a
  // new free-floating text object. Both fields are plain text — Note's markers
  // (bullet/numbered/lettered) are rendered dynamically from noteListType, never
  // baked into the text, so switching list types can't "stack" formatting.
  function startShapeTextEdit(obj: DrawObj) {
    const bb = getObjBB(obj)
    syncSel([obj.id])
    if (TITLE_ONLY_TYPES.includes(obj.type)) {
      // Compact shapes get a Title-only panel, centered in the shape's own
      // usable interior (not its full rectangular bbox) so the editor sits
      // exactly where the rendered, contained Title will be drawn.
      const safe = getTitleSafeRect(obj.type, bb)
      setTextInput({ x: safe.cx-safe.w/2, y: safe.cy-15, w: safe.w, value: obj.text ?? '', targetId: obj.id, activeField: 'title', titleFontSize: obj.fontSize, titleOnly: true })
      return
    }
    const cx = (bb.minX+bb.maxX)/2
    const w = Math.max(100, (bb.maxX-bb.minX)-16)
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
      const note = textInput.titleOnly ? '' : (textInput.noteValue ?? '').trim()
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

  // Genuinely removes the portion(s) of any freehand stroke under the eraser's
  // circle — NOT a white overlay stroke (the old approach: it rendered '#fff'
  // over the drawing, leaving a real, selectable, deletable "white stroke"
  // object behind forever). A stroke is tested — and, if it has rotation,
  // tested in its own LOCAL space, same as hitObj — point-by-point AND
  // segment-by-segment (via distToSeg, reused from line/arrow hit-testing) so
  // a fast eraser pass can't "hop over" a point without erasing the segment
  // it belongs to. Surviving runs of points become their own stroke objects
  // (a single pass through the middle of a stroke splits it into two); a
  // fully-erased stroke is simply dropped. Returns whether anything changed.
  function eraseAt(pos: Pt, radius: number): boolean {
    const out: DrawObj[] = []
    let changed = false
    for (const obj of objectsRef.current) {
      if (obj.type !== 'stroke') { out.push(obj); continue }
      const bb = getObjBB(obj)
      const center = { x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2 }
      const local = obj.rotation ? rotatePt(pos, center, -obj.rotation) : pos
      const n = obj.pts.length
      const erase = new Array(n).fill(false)
      for (let i=0;i<n;i++) {
        if (Math.hypot(obj.pts[i].x-local.x, obj.pts[i].y-local.y) <= radius) erase[i] = true
      }
      for (let i=0;i<n-1;i++) {
        if (erase[i] && erase[i+1]) continue
        if (distToSeg(local.x,local.y,obj.pts[i].x,obj.pts[i].y,obj.pts[i+1].x,obj.pts[i+1].y) <= radius) { erase[i]=true; erase[i+1]=true }
      }
      if (!erase.some(Boolean)) { out.push(obj); continue }
      changed = true
      let run: Pt[] = []
      for (let i=0;i<n;i++) {
        if (!erase[i]) { run.push(obj.pts[i]); continue }
        if (run.length >= 2) out.push({...obj, id:uid(), pts:run})
        run = []
      }
      if (run.length >= 2) out.push({...obj, id:uid(), pts:run})
    }
    if (changed) {
      objectsRef.current = out
      syncObjs(out)
      syncSel(selIdsRef.current.filter(id => out.some(o => o.id === id)))
      erasedDuringGestureRef.current = true
    }
    return changed
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

  // ── Stacking order — step-based, never "bring to front"/"send to back" ─────
  // Array order IS paint/z order (see renderAll's plain for-of loop), so
  // moving one stacking level is a single adjacent swap. For a multi-
  // selection, each selected item swaps with the nearest NON-selected
  // neighbor in the move direction — processing from the far end inward so
  // selected items never swap with each other, which moves the whole group by
  // exactly one level while preserving their relative order among themselves.
  function moveSelectionZ(direction: 'above' | 'below') {
    const ids = new Set(selIdsRef.current)
    if (ids.size === 0) return
    const arr = [...objectsRef.current]
    if (direction === 'above') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (ids.has(arr[i].id) && !ids.has(arr[i+1].id)) { const t = arr[i]; arr[i] = arr[i+1]; arr[i+1] = t }
      }
    } else {
      for (let i = 1; i < arr.length; i++) {
        if (ids.has(arr[i].id) && !ids.has(arr[i-1].id)) { const t = arr[i]; arr[i] = arr[i-1]; arr[i-1] = t }
      }
    }
    syncObjs(arr); snapshot(arr); renderAll()
  }

  // ── Align — intelligent cleanup, not a grid/auto-layout redesign ───────────
  // Pure SPATIAL clustering — never depends on connectors existing: two or
  // more selected shapes whose centers are already roughly aligned on one
  // axis (within ALIGN_CLUSTER_TOL) are treated as an intended group along
  // that axis, snapped to share it exactly, and evenly re-spaced using their
  // OWN median gap (never a hardcoded grid) centered on their original span —
  // so overall position/composition is preserved, not redesigned. A shape
  // that isn't close enough to any other selected shape to form its own group
  // (e.g. a root node clearly off to one side) is then related to whichever
  // cleaned-up group it's nearest to: it keeps its own position on the axis
  // that group already shares, and only its OTHER coordinate snaps to that
  // group's center (see the lone-shape pass below) — e.g. a single object
  // facing a vertical stack lines up with the stack's center, without being
  // pulled into the stack itself. Afterward, resolveAttachments (the same
  // mechanism every move/resize/rotate already relies on) re-derives every
  // connector's actual path from the shapes' new positions — straight/elbow
  // geometry and 90° corners fall out of that for free, exactly as they do
  // after any ordinary move.
  const ALIGN_CLUSTER_TOL = 70 // px — "roughly aligned already" tolerance for clustering by center proximity

  function alignSelected() {
    if (textInput) commitText()
    const selSet = new Set(selIdsRef.current)
    const rawAll = objectsRef.current
    const shapes = rawAll.filter(o => selSet.has(o.id) && o.type !== 'line' && o.type !== 'arrow')
    if (shapes.length < 2) { setToast('Select at least 2 shapes to align'); return }

    // Retroactively attach any connector endpoint that's only ever been
    // visually touching one of these shapes (drawn close by hand but never
    // actually snapped) — otherwise moving the shapes below would strand it
    // mid-air instead of "remaining attached to its intended shape." Reuses
    // the exact same shape-proximity search a freshly-drawn endpoint already
    // uses; only endpoints with no existing attachment are checked, so a
    // connector someone deliberately detached is never re-grabbed.
    const all = rawAll.map(o => {
      if (o.type !== 'line' && o.type !== 'arrow') return o
      const patch: Partial<DrawObj> = {}
      if (!o.attachStartId && !o.attachStartConnId) {
        const hit = findAttachTarget(shapes, o.id, { x:o.x1, y:o.y1 })
        if (hit) { patch.attachStartId = hit.target.id; patch.attachStartAngle = hit.angle }
      }
      if (!o.attachEndId && !o.attachEndConnId) {
        const hit = findAttachTarget(shapes, o.id, { x:o.x2, y:o.y2 })
        if (hit) { patch.attachEndId = hit.target.id; patch.attachEndAngle = hit.angle }
      }
      return Object.keys(patch).length ? { ...o, ...patch } : o
    })

    const centerOf = (o: DrawObj) => { const bb = getObjBB(o); return { x: (bb.minX+bb.maxX)/2, y: (bb.minY+bb.maxY)/2 } }
    const items = shapes.map(o => ({ id: o.id, pos: centerOf(o) }))
    const median = (nums: number[]) => [...nums].sort((a,b)=>a-b)[Math.floor(nums.length/2)]

    // Chain-cluster by proximity along one axis: sort by that axis, group
    // consecutive items whose gap is within tolerance — a natural way to
    // recognize "the user already roughly lined these up" without any fixed
    // grid, and without requiring every pair in the group to be equally close.
    function clusterByAxis(pool: typeof items, axis: 'x'|'y'): Array<typeof items> {
      const sorted = [...pool].sort((a,b)=>a.pos[axis]-b.pos[axis])
      const out: Array<typeof items> = []
      let cur: typeof items = []
      for (const it of sorted) {
        if (cur.length === 0 || Math.abs(it.pos[axis] - cur[cur.length-1].pos[axis]) <= ALIGN_CLUSTER_TOL) cur.push(it)
        else { if (cur.length >= 2) out.push(cur); cur = [it] }
      }
      if (cur.length >= 2) out.push(cur)
      return out
    }

    const deltas = new Map<string, { dx: number; dy: number }>()
    const used = new Set<string>()
    // One entry per cleaned-up group, used afterward to relate any leftover
    // lone shape to whichever group it's actually closest to (see below) —
    // 'vertical' = members share an X, spread along Y; 'horizontal' = the mirror.
    const groups: Array<{ orientation: 'vertical' | 'horizontal'; center: Pt }> = []

    function applyVerticalCluster(cluster: typeof items) {
      const sharedX = median(cluster.map(c=>c.pos.x))
      const sorted = [...cluster].sort((a,b)=>a.pos.y-b.pos.y)
      const gaps = sorted.slice(1).map((c,i)=>c.pos.y - sorted[i].pos.y)
      const gap = gaps.length ? median(gaps) : 0
      const span = gap * (sorted.length - 1)
      const centerY = (sorted[0].pos.y + sorted[sorted.length-1].pos.y) / 2
      let y = centerY - span / 2
      for (const c of sorted) { deltas.set(c.id, { dx: sharedX - c.pos.x, dy: y - c.pos.y }); used.add(c.id); y += gap }
      groups.push({ orientation: 'vertical', center: { x: sharedX, y: centerY } })
    }
    function applyHorizontalCluster(cluster: typeof items) {
      const sharedY = median(cluster.map(c=>c.pos.y))
      const sorted = [...cluster].sort((a,b)=>a.pos.x-b.pos.x)
      const gaps = sorted.slice(1).map((c,i)=>c.pos.x - sorted[i].pos.x)
      const gap = gaps.length ? median(gaps) : 0
      const span = gap * (sorted.length - 1)
      const centerX = (sorted[0].pos.x + sorted[sorted.length-1].pos.x) / 2
      let x = centerX - span / 2
      for (const c of sorted) { deltas.set(c.id, { dx: x - c.pos.x, dy: sharedY - c.pos.y }); used.add(c.id); x += gap }
      groups.push({ orientation: 'horizontal', center: { x: centerX, y: sharedY } })
    }

    // Vertical groups (shared X) take priority — a shape already claimed by
    // one cluster is skipped when building the other axis's clusters, so no
    // shape is moved twice.
    for (const cluster of clusterByAxis(items, 'x')) applyVerticalCluster(cluster)
    const remaining = items.filter(it => !used.has(it.id))
    for (const cluster of clusterByAxis(remaining, 'y')) applyHorizontalCluster(cluster)

    // Relate each leftover lone shape (not close enough to anything to form
    // its own group) to whichever cleaned-up group it's nearest to — e.g. a
    // single object facing a 3-object vertical stack naturally lines up with
    // that stack's center. Only the axis the group DOESN'T already share gets
    // touched, so the lone shape keeps its own general left/right (or
    // up/down) position — composition is preserved, not redesigned.
    if (groups.length > 0) {
      for (const item of items) {
        if (used.has(item.id)) continue
        let best = groups[0], bestDist = Math.hypot(item.pos.x-groups[0].center.x, item.pos.y-groups[0].center.y)
        for (const g of groups.slice(1)) {
          const d = Math.hypot(item.pos.x-g.center.x, item.pos.y-g.center.y)
          if (d < bestDist) { bestDist = d; best = g }
        }
        deltas.set(item.id, best.orientation === 'vertical'
          ? { dx: 0, dy: best.center.y - item.pos.y }
          : { dx: best.center.x - item.pos.x, dy: 0 })
      }
    }

    if (deltas.size === 0) { setToast('Nothing roughly aligned enough to clean up'); return }

    let next = all.map(o => {
      const d = deltas.get(o.id)
      if (!d || (d.dx === 0 && d.dy === 0)) return o
      return {
        ...o,
        x: o.x+d.dx, y: o.y+d.dy,
        x1: o.x1+d.dx, y1: o.y1+d.dy, x2: o.x2+d.dx, y2: o.y2+d.dy,
        pts: o.pts.map(p => ({ x: p.x+d.dx, y: p.y+d.dy })),
      }
    })

    // Straighten: any connector with an attached end among the shapes that
    // just moved gets that end's angle recomputed from the shapes' NEW
    // centers (the same angle math/cardinal snap findAttachTarget already
    // uses when an endpoint is freshly attached) — otherwise a connector
    // whose shape is now perfectly aligned would still emit from its old,
    // now-wrong angle and look slanted/offset instead of truly straight.
    const newById = new Map(next.map(o => [o.id, o]))
    next = next.map(o => {
      if (o.type !== 'line' && o.type !== 'arrow') return o
      const startMoved = o.attachStartId && deltas.has(o.attachStartId)
      const endMoved    = o.attachEndId && deltas.has(o.attachEndId)
      if (!startMoved && !endMoved) return o
      const a = o.attachStartId ? newById.get(o.attachStartId) : undefined
      const b = o.attachEndId   ? newById.get(o.attachEndId)   : undefined
      const ca = a ? centerOf(a) : { x:o.x1, y:o.y1 }
      const cb = b ? centerOf(b) : { x:o.x2, y:o.y2 }
      return {
        ...o,
        attachStartAngle: startMoved ? snapAnchorAngle(Math.atan2(cb.y-ca.y, cb.x-ca.x)) : o.attachStartAngle,
        attachEndAngle:   endMoved   ? snapAnchorAngle(Math.atan2(ca.y-cb.y, ca.x-cb.x)) : o.attachEndAngle,
      }
    })

    const resolved = resolveAttachments(next)
    syncObjs(resolved); snapshot(resolved); renderAll()
    setToast('Aligned ✓')
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
        // A multi-turn path (see the live orthogonal drawing tool) mirrors
        // every joint around the path's own bbox center, not just its two
        // ends — mirroring an orthogonal route keeps every corner exactly 90°.
        if (o.pts.length >= 2) {
          const bb = getObjBB(o)
          const pts = axis==='x'
            ? o.pts.map(p=>({x:2*((bb.minX+bb.maxX)/2)-p.x, y:p.y}))
            : o.pts.map(p=>({x:p.x, y:2*((bb.minY+bb.maxY)/2)-p.y}))
          return {...o, pts, x1:pts[0].x, y1:pts[0].y, x2:pts[pts.length-1].x, y2:pts[pts.length-1].y}
        }
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
        const pts = o.pts.length >= 2 ? o.pts.map(p => rotatePt(p, pivot, deltaRad)) : o.pts
        return {...o,x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,mx:pm.x,my:pm.y,pts}
      }
      if (o.type==='stroke') {
        // pts stay in local space — only their shared bbox center orbits the
        // pivot (a no-op for a single selection, since the pivot IS its own
        // center); the actual visual spin comes from `rotation` at render time.
        const bb = getObjBB(o)
        const center = { x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2 }
        const nc = rotatePt(center, pivot, deltaRad)
        const dx = nc.x-center.x, dy = nc.y-center.y
        return {...o, pts:o.pts.map(p=>({x:p.x+dx,y:p.y+dy})), rotation:(o.rotation||0)+deltaRad}
      }
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
    // Switching TO elbow/elbow-curved resets elbowBend to the classic 'v'
    // corner (a leftover 'h' from an earlier bend would otherwise persist
    // and look arbitrary); switching away leaves it as-is, ready to resume
    // from the same corner if the connector is switched back to elbow later.
    const ids=selIdsRef.current
    const isElbow = ct==='elbow' || ct==='elbow-curved'
    const n=objectsRef.current.map(o=>{
      if (!ids.includes(o.id)||o.type!=='arrow') return o
      return isElbow ? {...o,connType:ct,elbowBend:'v' as const} : {...o,connType:ct}
    })
    syncObjs(n); snapshot(n); renderAll()
  }

  // Double-ended is independent of connType (straight/curved/elbow all accept
  // it) — same connector architecture, just a second arrowhead at the start.
  // Dual-purpose like updateSelColor: with an arrow selected it edits that
  // arrow; with nothing selected it flips the default new arrows are created with.
  function toggleDoubleEnded() {
    const ids=selIdsRef.current
    const selArrowsNow = objectsRef.current.filter(o=>ids.includes(o.id)&&o.type==='arrow')
    if (selArrowsNow.length===0) { setDoubleEndedDefault(v=>!v); return }
    const next = !selArrowsNow[0].doubleEnded
    const n=objectsRef.current.map(o=>(!ids.includes(o.id)||o.type!=='arrow')?o:{...o,doubleEnded:next})
    syncObjs(n); snapshot(n); renderAll()
  }

  // Switch Arrow — flips which single endpoint owns the arrowhead. Pure
  // cosmetic flag (headAt); geometry/attachments/bends/curves/junctions are
  // never touched. No effect on a doubleEnded arrow, so the button disables
  // itself for those (see the toolbar) rather than silently doing nothing.
  function switchArrowHead() {
    const ids=selIdsRef.current
    const sel = objectsRef.current.find(o=>ids.includes(o.id)&&o.type==='arrow')
    if (!sel || sel.doubleEnded) return
    const next: 'start'|'end' = sel.headAt==='start' ? 'end' : 'start'
    const n=objectsRef.current.map(o=>(!ids.includes(o.id)||o.type!=='arrow'||o.doubleEnded)?o:{...o,headAt:next})
    syncObjs(n); snapshot(n); renderAll()
  }

  function updateSelColor(color: string) {
    setDrawColor(color)
    if(selIdsRef.current.length===0) return
    const ids=selIdsRef.current; const n=objectsRef.current.map(o=>ids.includes(o.id)?{...o,color,noOutline:false}:o)
    syncObjs(n); renderAll()
  }

  // "No Outline" — mirrors clearSelFill: a dedicated flag rather than
  // touching color/sw, so re-picking a color (updateSelColor above clears it)
  // restores the prior outline exactly as it was.
  function clearSelOutline() {
    const ids = selIdsRef.current
    if (ids.length === 0) return
    const n = objectsRef.current.map(o => ids.includes(o.id) ? {...o, noOutline:true} : o)
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

  // "No Fill" — same `filled` flag toggleFilled already flips, just forced to
  // false rather than toggled, so fillColor/every other property (including
  // the shape itself) is untouched; only the interior stops being painted.
  function clearSelFill() {
    setFilled(false)
    const ids = selIdsRef.current
    if (ids.length === 0) return
    const n = objectsRef.current.map(o => ids.includes(o.id) ? {...o, filled:false} : o)
    syncObjs(n); renderAll()
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // Respects active text-editing contexts first (shape-label input, etc.) so
  // normal typing/backspace/paste inside them is never hijacked as a canvas
  // command — only once no text field is focused do these become canvas shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl/Cmd+S must always save the Mind Map and never fall through to the
      // browser's native "Save Page" dialog — checked before the text-input
      // guard below so it still fires while a shape's title/note field (or any
      // other input) has focus.
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s') { e.preventDefault(); handleSave(); return }
      const t = e.target as HTMLElement
      // The shape-text-edit/free-text <input> has its own onKeyDown (Enter
      // commits, Escape discards and keeps the shape selected) — leave it alone.
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return
      if (e.key==='Escape' && openPopover) { e.preventDefault(); setOpenPopover(null); return }
      if (e.key==='Escape' && selIdsRef.current.length>0) { e.preventDefault(); syncSel([]); renderAll(); return }
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
  const selHasShape = selObjs.some(o => SHAPE_TOOLS.includes(o.type as DrawTool) || o.type === 'stroke')
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
  const curNoOutline = selObjs.length>0 ? (selObjs[0]?.noOutline??false) : false
  const normalizedStroke   = normalizeHexColor(drawColor)
  const isPresetStroke      = (COLOR_PALETTE as readonly string[]).some(c=>normalizeHexColor(c)===normalizedStroke)
  const isSavedCustomStroke = customColors.some(c=>normalizeHexColor(c)===normalizedStroke)
  const isCustomStroke      = !isPresetStroke && !isSavedCustomStroke && !curNoOutline

  // ── Styles ─────────────────────────────────────────────────────────────────
  const dockBg  = isDark ? 'rgba(9,4,22,0.97)' : '#f1f5f9'
  const dockBdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  // Bottom toolbar only — the SAME dark navy token the Planner Editor's own
  // bottom dock uses (see dockBg/dockBdr in JournalEditorContent.tsx), not a
  // separately-invented navy. The top toolbar stays on the light dockBg above.
  const navyBg  = 'rgba(8,20,58,0.98)'
  const navyBdr = 'rgba(124,58,237,0.20)'

  // Mirrors dkBtn's active/danger/disabled states but in the light-on-navy
  // palette the Planner Editor's own dockBtn() already uses for its navy dock,
  // so bottom-toolbar controls stay clearly readable against navyBg.
  // `disabled` only gates the CLICK behavior at each call site (a genuinely
  // inapplicable action simply does nothing) — it never changes how the
  // button looks. Every tool stays visually active/normal regardless of
  // current selection/canvas state; only `active` (the currently-chosen
  // tool/value) gets a distinct look.
  function navyBtn(active=false, danger=false, disabled=false): React.CSSProperties {
    return {
      padding:'4px 10px', borderRadius:7, cursor:disabled?'default':'pointer',
      border:`0.5px solid ${active?'rgba(124,58,237,0.65)':danger?'rgba(239,68,68,0.35)':'rgba(255,255,255,0.20)'}`,
      background:active?'rgba(124,58,237,0.28)':danger?'rgba(239,68,68,0.10)':'rgba(255,255,255,0.09)',
      color:active?'#c4b5fd':danger?'#fca5a5':'rgba(255,255,255,0.88)',
      fontSize:12, fontWeight:active?600:500, transition:'all 120ms', flexShrink:0, whiteSpace:'nowrap' as const, lineHeight:'1.4',
    }
  }

  function dkBtn(active=false, danger=false, disabled=false): React.CSSProperties {
    return {
      padding:'4px 10px', borderRadius:7, cursor:disabled?'default':'pointer',
      border:`0.5px solid ${active?'rgba(124,58,237,0.55)':danger?'rgba(239,68,68,0.28)':isDark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.24)'}`,
      background:active?'rgba(124,58,237,0.20)':danger?'rgba(239,68,68,0.08)':isDark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.055)',
      color:active?'#a78bfa':danger?(isDark?'rgba(252,165,165,0.85)':'#dc2626'):isDark?'rgba(255,255,255,0.92)':'rgba(0,0,0,0.85)',
      fontSize:12, fontWeight:active?600:500, transition:'all 120ms', flexShrink:0, whiteSpace:'nowrap' as const, lineHeight:'1.4',
    }
  }

  // Popovers render as position:fixed, anchored via getBoundingClientRect() at open-time —
  // this escapes the toolbar's own overflowX:'auto' scroll/clip ancestor entirely (unlike
  // position:absolute, which resolves its containing block inside that scrolling ancestor
  // and gets clipped/scrolled along with it).
  // `direction` controls which edge of the trigger the popover grows from —
  // 'down' (the default, used by every top-toolbar trigger) anchors via `top`
  // just below the button; 'up' (bottom-toolbar triggers — Rotate/Fill/Flip)
  // anchors via `bottom` just above it instead, so a popover launched from the
  // bottom dock always opens into the canvas rather than off the bottom of
  // the viewport/modal.
  function openPop(id: PopoverId, e: React.MouseEvent<HTMLElement>, direction: 'down' | 'up' = 'down') {
    const r = e.currentTarget.getBoundingClientRect()
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0
    setPopAnchor(direction === 'up'
      ? { left: r.left, bottom: vh - r.top + 4 }
      : { left: r.left, top: r.bottom + 4 })
    setOpenPopover(op => op === id ? null : id)
  }

  function fixedPopStyle(extra?: React.CSSProperties): React.CSSProperties {
    const width = 150
    let left = popAnchor?.left ?? 0
    if (typeof window !== 'undefined') left = Math.min(Math.max(8, left), window.innerWidth - width - 8)
    const vertical: React.CSSProperties = popAnchor?.bottom !== undefined
      ? { bottom: popAnchor.bottom }
      : { top: typeof window !== 'undefined' ? Math.min(popAnchor?.top ?? 0, window.innerHeight - 60) : (popAnchor?.top ?? 0) }
    return {
      position:'fixed', left, zIndex:300, ...vertical,
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
  // ── TOP toolbar: creation/structure tools ───────────────────────────────────
  // Select/Rotate/Color/Fill/Flip/Delete/Undo/Redo now live in the bottom
  // toolbar instead (see bottomToolbar below) — not duplicated here.
  const topToolbar = (
    <div style={{display:'flex',alignItems:'stretch',background:dockBg,borderBottom:`0.5px solid ${dockBdr}`,boxShadow:isDark?'0 2px 12px rgba(0,0,0,0.40)':'0 1px 6px rgba(0,0,0,0.08)',flexShrink:0}}>

      {/* ── Scrollable tools ─────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',gap:4,padding:'9px 10px 9px 14px',flex:1,minWidth:0,overflowX:'auto',flexWrap:'nowrap'}}>

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

        {/* List — applies to the Note field of the shape currently being edited.
            onMouseDown must preventDefault: without it, clicking this button
            shifts focus away from the Note textarea, firing its onBlur ->
            commitText() -> textInput=null BEFORE this button's own onClick
            runs — the dropdown would then silently fail to open (or the
            button would already read as disabled) on that same click, which
            is exactly the "doesn't show the options reliably" symptom. */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="List" disabled={!(textInput?.targetId && textInput.activeField==='note')}
            onMouseDown={e=>e.preventDefault()}
            onClick={(e)=>{ if (textInput?.targetId && textInput.activeField==='note') openPop('list-type',e) }}
            style={{...dkBtn(false,false,!(textInput?.targetId && textInput.activeField==='note')),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            ☷ List▾
          </button>
          {openPopover==='list-type' && textInput?.targetId && (
            // Same onMouseDown-preventDefault reasoning as the trigger button:
            // without it, clicking an option blurs the Note textarea first,
            // which can unmount this very dropdown (textInput?.targetId above
            // goes false) before the click ever reaches these buttons.
            <div data-popover="" onMouseDown={e=>e.preventDefault()} style={fixedPopStyle()}>
              <button onClick={()=>applyNoteListType('bullet')} style={{...dkBtn(activeNoteListType==='bullet'),textAlign:'left',width:'100%',padding:'5px 10px'}}>• Bullet Points</button>
              <button onClick={()=>applyNoteListType('numbered')} style={{...dkBtn(activeNoteListType==='numbered'),textAlign:'left',width:'100%',padding:'5px 10px'}}>1. Numbers</button>
              <button onClick={()=>applyNoteListType('lettered')} style={{...dkBtn(activeNoteListType==='lettered'),textAlign:'left',width:'100%',padding:'5px 10px'}}>a. Letters</button>
              <button onClick={()=>applyNoteListType('checkbox')} style={{...dkBtn(activeNoteListType==='checkbox'),textAlign:'left',width:'100%',padding:'5px 10px'}}>☐ Checkbox</button>
            </div>
          )}
        </div>

        {dvdr}

        {/* Shapes popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Shapes" onClick={(e)=>{if(textInput)commitText();openPop('shapes',e)}}
            style={{...dkBtn(SHAPE_TOOLS.includes(tool)),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            {tool==='rect'?'□':tool==='rect-r'?'⊡':tool==='circle'?'○':tool==='triangle'?'△':tool==='diamond'?'◇':tool==='starburst'?'✦':tool==='capsule'?'⬭':tool==='hexagon'?'⬡':'□'} Shapes▾
          </button>
          {openPopover==='shapes' && (
            <div data-popover="" style={fixedPopStyle()}>
              {pbtn('□  Rectangle', ()=>{setTool('rect');      setOpenPopover(null)}, tool==='rect')}
              {pbtn('⊡  Round Rect',()=>{setTool('rect-r');    setOpenPopover(null)}, tool==='rect-r')}
              {pbtn('⬭  Capsule',   ()=>{setTool('capsule');   setOpenPopover(null)}, tool==='capsule')}
              {pbtn('⬡  Hexagon',   ()=>{setTool('hexagon');   setOpenPopover(null)}, tool==='hexagon')}
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

        {/* Double-ended arrow — a THIRD connector option alongside straight/
            elbow, orthogonal to connType (works with any of them): with an
            arrow selected this edits it, otherwise it sets the default for
            the next arrow drawn (same dual-purpose pattern as stroke color). */}
        <button title="Double-Ended Arrow" onClick={()=>{if(textInput)commitText();toggleDoubleEnded()}}
          style={{...dkBtn(selArrow?selArrow.doubleEnded:doubleEndedDefault),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:13}}>
          ⟷
        </button>

        {/* Switch Arrow — reverses ONLY which endpoint owns the arrowhead
            (headAt); geometry/attachments/bends/curves/junctions are untouched.
            Disabled for a doubleEnded arrow since reversing it is a no-op. */}
        <button title="Switch Arrow — reverse which end has the arrowhead" disabled={!selArrow || selArrow.doubleEnded}
          onClick={()=>{if(textInput)commitText();switchArrowHead()}}
          style={dkBtn(false,false,!selArrow || !!selArrow?.doubleEnded)}>
          ⇄ Switch
        </button>

        {/* Connector type — always visible; disabled unless a single arrow is selected */}
        {dvdr}
        <button disabled={!selArrow} onClick={()=>setConnType('straight')} style={dkBtn(selArrow?.connType==='straight',false,!selArrow)} title="Straight arrow">⟶</button>
        <button disabled={!selArrow} onClick={()=>setConnType('curved')}   style={dkBtn(selArrow?.connType==='curved',false,!selArrow)}   title="Curved arrow">⌒</button>
        <button disabled={!selArrow} onClick={()=>setConnType('elbow')}    style={{...dkBtn(selArrow?.connType==='elbow',false,!selArrow),display:'flex',alignItems:'center',padding:'4px 8px'}} title="Sharp 90° Arrow">
          <ElbowArrowIcon curved={false} size={13}/>
        </button>
        <button disabled={!selArrow} onClick={()=>setConnType('elbow-curved')} style={{...dkBtn(selArrow?.connType==='elbow-curved',false,!selArrow),display:'flex',alignItems:'center',padding:'4px 8px'}} title="Curved Arrow">
          <ElbowArrowIcon curved={true} size={13}/>
        </button>

        <span style={{flex:1,minWidth:8}}/>

        {/* Group ▾ (Group/Ungroup) / Dup — always visible; each disables
            itself when the current selection doesn't support it. Delete
            moved to the bottom toolbar (see bottomToolbar below). */}
        {dvdr}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Group" disabled={selIds.length===0} onClick={(e)=>{if(selIds.length===0)return;if(textInput)commitText();openPop('group',e)}}
            style={{...dkBtn(selIsGroup,false,selIds.length===0),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            ⛓ Group▾
          </button>
          {openPopover==='group' && selIds.length>0 && (
            <div data-popover="" style={fixedPopStyle()}>
              <button onClick={()=>{ if(canGroup){groupSelected(); setOpenPopover(null)} }} disabled={!canGroup}
                style={{...dkBtn(false,false,!canGroup),textAlign:'left',width:'100%',padding:'5px 10px'}}>Group</button>
              <button onClick={()=>{ if(selIsGroup){ungroupSelected(); setOpenPopover(null)} }} disabled={!selIsGroup}
                style={{...dkBtn(false,false,!selIsGroup),textAlign:'left',width:'100%',padding:'5px 10px'}}>Ungroup</button>
            </div>
          )}
        </div>
        <button disabled={selIds.length===0} onClick={duplicateSelected} style={dkBtn(false,false,selIds.length===0)}>Dup</button>

        {dvdr}

        {/* Align — intelligent spatial cleanup of the selection (see
            alignSelected): needs at least 2 shapes to do anything; disabled
            only gates the click (see dkBtn) — looks the same either way. */}
        <button title="Align selected shapes" disabled={selIds.length<2}
          onClick={alignSelected} style={{...dkBtn(false,false,selIds.length<2),display:'flex',alignItems:'center',gap:3,padding:'4px 8px'}}>
          <AlignIcon/> Align
        </button>

        {dvdr}

        {/* Order ▾ — step-based stacking order (see moveSelectionZ): each
            click moves the selection exactly one layer, never "front"/"back". */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Order" disabled={selIds.length===0} onClick={(e)=>{if(selIds.length===0)return;openPop('order',e)}}
            style={{...dkBtn(false,false,selIds.length===0),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            ☰ Order▾
          </button>
          {openPopover==='order' && selIds.length>0 && (
            <div data-popover="" style={fixedPopStyle()}>
              <button onClick={()=>moveSelectionZ('above')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>▲ Above</button>
              <button onClick={()=>moveSelectionZ('below')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>▼ Below</button>
            </div>
          )}
        </div>

        {dvdr}

        {/* Clear — Undo/Redo moved to the bottom toolbar (see bottomToolbar below) */}
        <button style={dkBtn()} onClick={clearAll} title="Clear canvas">Clear</button>

        {dvdr}

        {/* Fit / Restore — two clearly distinct icon states communicating the
            action that will happen next. Immersive full-screen sizing itself
            is owned entirely by the parent (see JournalDrawModalProps.fitScreen). */}
        <button onClick={onToggleFitScreen} title={fitScreen?'Restore View':'Fit to Screen'} aria-label={fitScreen?'Restore View':'Fit to Screen'}
          style={{...dkBtn(fitScreen),display:'flex',alignItems:'center',gap:5,padding:'4px 8px'}}>
          {fitScreen ? <RestoreIcon/> : <FitIcon/>}
          {fitScreen?'Restore':'Fit'}
        </button>
      </div>
    </div>
  )

  // ── BOTTOM toolbar: frequently used manipulation tools ──────────────────────
  // Selection/Pointer → Rotation → Color → Fill → Flip → Delete → Undo → Redo,
  // kept immediately accessible on every device without horizontal-scrolling
  // the top toolbar. Cancel/Save stay pinned alongside it, same pattern as the
  // top toolbar previously used.
  const bottomToolbar = (
    <div style={{display:'flex',alignItems:'stretch',background:navyBg,borderTop:`0.5px solid ${navyBdr}`,boxShadow:'0 -2px 12px rgba(0,0,0,0.40)',flexShrink:0}}>

      <div style={{display:'flex',alignItems:'center',gap:4,padding:'9px 10px 9px 14px',flex:1,minWidth:0,overflowX:'auto',flexWrap:'nowrap'}}>

        {/* Select */}
        <button title="Select (click / drag)" onClick={()=>{if(textInput)commitText();setTool('select')}} style={{...navyBtn(tool==='select'),minWidth:28,textAlign:'center',padding:'4px 8px',fontSize:13}}>↖</button>

        {/* Rotate — quick ±90°, works on the current selection */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Rotate" disabled={!selHasRotatable} onClick={(e)=>{if(!selHasRotatable)return;openPop('rotate',e,'up')}}
            style={{...navyBtn(false,false,!selHasRotatable),display:'flex',alignItems:'center',padding:'4px 8px',fontSize:13}}>↻</button>
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

        {/* Stroke/outline color — same custom palette popover as Fill (not the
            native browser picker, whose own popup position we can't control —
            that was exactly the bottom-toolbar clipping bug), anchored upward
            like every other bottom-toolbar popover. */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Stroke Color" onClick={(e)=>{if(textInput)commitText();openPop('stroke',e,'up')}}
            style={{...navyBtn(false),display:'flex',alignItems:'center',padding:'4px'}}>
            <span style={{width:22,height:22,borderRadius:'50%',background:curNoOutline?'transparent':drawColor,border:'2px solid rgba(255,255,255,0.30)',boxShadow:'0 0 0 1px rgba(124,58,237,0.30)',display:'inline-block'}}/>
          </button>
          {openPopover==='stroke' && (
            <div data-popover="" style={fixedPopStyle({flexDirection:'row',flexWrap:'wrap',gap:6,width:172,minWidth:'auto',padding:'8px'})}>
              {COLOR_PALETTE.map(c => {
                const sel = normalizeHexColor(c)===normalizedStroke && !curNoOutline
                return (
                  <button key={c} title={c} onClick={()=>{updateSelColor(c);setOpenPopover(null)}}
                    style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',background:c,border:'none',padding:0,
                      transform:sel?'scale(1.15)':'scale(1)',
                      boxShadow:sel?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px #7c3aed`:'none'}}/>
                )
              })}
              {customColors.map(c => {
                const sel = normalizeHexColor(c)===normalizedStroke && !curNoOutline
                return (
                  <button key={c} title={c} onClick={()=>{updateSelColor(c);setOpenPopover(null)}}
                    style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',background:c,border:'none',padding:0,
                      transform:sel?'scale(1.15)':'scale(1)',
                      boxShadow:sel?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px #7c3aed`:'none'}}/>
                )
              })}
              <button title="Custom color" onClick={()=>{setOpenPopover(null);setShowCustomStroke(true)}}
                style={{width:22,height:22,borderRadius:'50%',flexShrink:0,cursor:'pointer',border:'none',padding:0,
                  background:isCustomStroke?drawColor:'conic-gradient(from 0deg, #ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
                  transform:isCustomStroke?'scale(1.15)':'scale(1)',
                  boxShadow:isCustomStroke?`0 0 0 2px ${isDark?'#1e1033':'#fff'}, 0 0 0 3.5px ${drawColor}`:'none'}}/>
              <NoFillSwatch active={curNoOutline} isDark={isDark} title="No Outline" onClick={()=>{clearSelOutline();setOpenPopover(null)}}/>
            </div>
          )}
        </div>

        {/* Fill color — XPadite palette popover (reuses the same preset swatches +
            rainbow custom-color trigger + ColorPickerModal used by Activity Manager),
            not the native browser picker. Stays in its normal toolbar position even
            with nothing selected — disabled rather than removed. */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Fill Color" disabled={!showFill} onClick={(e)=>{if(!showFill)return;if(textInput)commitText();openPop('fill',e,'up')}}
            style={{...navyBtn(false,false,!showFill),display:'flex',alignItems:'center',gap:5,padding:'4px 8px'}}>
            <span style={{width:16,height:16,borderRadius:4,background:fillColor,border:'1.5px solid rgba(255,255,255,0.35)',display:'inline-block',flexShrink:0,opacity:showFill?1:0.4}}/>
            Fill
          </button>
          {openPopover==='fill' && showFill && (
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
              <NoFillSwatch active={!curFilled} isDark={isDark} title="No Fill" onClick={()=>{clearSelFill();setOpenPopover(null)}}/>
            </div>
          )}
        </div>

        {/* Fill toggle */}
        <button title="Toggle fill" disabled={!showFill} onClick={()=>{if(showFill)toggleFilled()}} style={navyBtn(curFilled,false,!showFill)}>
          {curFilled ? '◉' : '○'} Fill
        </button>

        {dvdr}

        {/* Flip popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Flip" disabled={!selHasFlippable} onClick={(e)=>{if(!selHasFlippable)return;openPop('flip',e,'up')}}
            style={{...navyBtn(false,false,!selHasFlippable),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>⇆ Flip▾</button>
          {openPopover==='flip' && (
            <div data-popover="" style={fixedPopStyle()}>
              <button onClick={()=>flipSelected('x')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>↔  Flip Horizontal</button>
              <button onClick={()=>flipSelected('y')} style={{...dkBtn(),textAlign:'left',width:'100%',padding:'5px 10px'}}>↕  Flip Vertical</button>
            </div>
          )}
        </div>

        {dvdr}

        {/* Delete */}
        <button title="Delete" disabled={selIds.length===0} onClick={deleteSelected} style={{...navyBtn(false,true,selIds.length===0),display:'flex',alignItems:'center',padding:'4px 8px'}}>
          <TrashIcon/>
        </button>

        {dvdr}

        {/* Undo / Redo */}
        <button style={navyBtn(false,false,!canUndo)} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
        <button style={navyBtn(false,false,!canRedo)} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
      </div>

      {/* ── Fixed Cancel + Save ────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',gap:5,padding:'9px 12px',flexShrink:0,borderLeft:`0.5px solid ${navyBdr}`,background:navyBg}}>
        <button onClick={requestClose} className="xp-dm-cancel-btn" style={navyBtn(false,true)}>Cancel</button>
        <button onClick={handleSave} style={{padding:'5px 16px',borderRadius:7,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#7c3aed,#6d28d9)',color:'#fff',fontSize:12,fontWeight:600,flexShrink:0,boxShadow:'0 2px 8px rgba(124,58,237,0.35)'}}>Save</button>
      </div>

    </div>
  )

  // ── Canvas area ─────────────────────────────────────────────────────────────
  const cursorMap: Partial<Record<DrawTool,string>> = {select:'default',text:'text',eraser:ERASER_CURSOR}
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
            style={{border:'none',outline:'none',background:'transparent',color:drawColor,fontSize:textInput.titleFontSize??14,fontWeight:700,fontFamily:'sans-serif',padding:'2px 3px',textAlign:textInput.titleOnly?'center':'left'}}
          />
          {!textInput.titleOnly && (
            <div style={{position:'relative'}}>
              {/* Shows the chosen list type's first marker the instant it's picked —
                  purely a visual cue over an EMPTY note (never baked into noteValue,
                  which stays plain text; the real marker rendering is dynamic, see
                  wrapNoteContent) so the user doesn't have to type before seeing it. */}
              {activeNoteListType!=='none' && !(textInput.noteValue ?? '').trim() && (
                <span aria-hidden="true" style={{
                  position:'absolute', left:3, top:2, pointerEvents:'none', userSelect:'none',
                  fontSize:textInput.noteFontSizeLive??12.5, fontFamily:'sans-serif', color:drawColor, opacity:0.55,
                }}>{getListMarker(activeNoteListType,0)}&nbsp;</span>
              )}
              <textarea
                value={textInput.noteValue ?? ''}
                onChange={e=>setTextInput(prev=>prev?{...prev,noteValue:e.target.value}:null)}
                onFocus={()=>setTextInput(prev=>prev?{...prev,activeField:'note'}:null)}
                onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setTextInput(null)}}}
                placeholder="Write a note…"
                rows={2}
                style={{border:'none',outline:'none',background:'transparent',color:drawColor,fontSize:textInput.noteFontSizeLive??12.5,fontFamily:'sans-serif',padding:'2px 3px',resize:'vertical',minHeight:36,width:'100%',display:'block'}}
              />
            </div>
          )}
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
  const customStrokePicker = showCustomStroke && (
    <ColorPickerModal
      initialColor={drawColor}
      onCancel={()=>setShowCustomStroke(false)}
      onApply={hex => {
        updateSelColor(hex)
        setShowCustomStroke(false)
        if (!addCustomColor(hex)) setToast('Custom color limit reached. Remove a saved color to add another.')
      }}
    />
  )

  // ── Unsaved-changes guard dialog (Cancel/Close with pending edits) ─────────
  const unsavedDialog = showUnsavedDialog && (
    <div style={{
      position:'fixed', inset:0, zIndex:99999,
      background:'rgba(0,0,0,0.72)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center',
    }}>
      <div style={{
        background:'#0f0a1e', border:'0.5px solid rgba(124,58,237,0.30)', borderRadius:16,
        boxShadow:'0 24px 80px rgba(0,0,0,0.80), 0 0 0 1px rgba(124,58,237,0.08)',
        padding:'28px 32px', maxWidth:380, width:'100%',
        display:'flex', flexDirection:'column', gap:20,
      }}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:'#f1f5f9',marginBottom:8,letterSpacing:'-0.01em'}}>Unsaved changes</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.58)',lineHeight:1.65}}>
            You have changes in this Mind Map that haven&apos;t been saved yet.
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <button
            onClick={() => { handleSave(); setShowUnsavedDialog(false); onClose() }}
            style={{
              padding:'10px 16px',borderRadius:9,border:'none',
              background:'linear-gradient(135deg,#5b21b6,#7c3aed)',
              color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',
            }}
          >Save</button>
          <button
            onClick={() => { setShowUnsavedDialog(false); onClose() }}
            style={{
              padding:'10px 16px',borderRadius:9,
              border:'0.5px solid rgba(239,68,68,0.32)',
              background:'rgba(239,68,68,0.10)',color:'#fca5a5',
              fontSize:13,fontWeight:500,cursor:'pointer',
            }}
          >Discard</button>
          <button
            onClick={() => setShowUnsavedDialog(false)}
            style={{
              padding:'10px 16px',borderRadius:9,
              border:'0.5px solid rgba(255,255,255,0.10)',
              background:'transparent',color:'rgba(255,255,255,0.55)',
              fontSize:13,fontWeight:500,cursor:'pointer',
            }}
          >Keep Working</button>
        </div>
      </div>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  // Full-screen immersive ("Fit") mode is sized/positioned entirely by the
  // PARENT (via a document.body portal — see JournalDrawModalProps.fitScreen);
  // this component always renders the same embedded layout either way.
  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0,background:isDarkApp?'#10071e':'#ffffff'}}>
      {popoverStyleTag}{topToolbar}{canvasArea}{bottomToolbar}{customFillPicker}{customStrokePicker}{unsavedDialog}
    </div>
  )
}
