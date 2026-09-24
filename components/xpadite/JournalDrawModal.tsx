'use client'

import { useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawTool = 'select' | 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rect' | 'rect-r' | 'circle' | 'triangle'
type ObjType  = 'rect' | 'rect-r' | 'circle' | 'triangle' | 'line' | 'arrow' | 'text' | 'stroke'
// 'elbow' = sharp 90° two-segment connector; 'elbow-curved' = the same two-segment
// route with a smoothly rounded corner. Both are distinct from the older 'curved'
// (a single free-form quadratic bezier from start to end, unrelated to the elbow tool).
type ConnType = 'straight' | 'curved' | 'elbow' | 'elbow-curved'
type HPos     = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type PopoverId = 'pen-size' | 'eraser-size' | 'shapes' | 'flip' | 'text-size' | 'arrow-type'

interface Pt { x: number; y: number }

interface DrawObj {
  id: string; type: ObjType
  x: number; y: number; w: number; h: number
  x1: number; y1: number; x2: number; y2: number
  mx: number; my: number; connType: ConnType
  pts: Pt[]; eraser: boolean
  color: string; fillColor: string; filled: boolean; sw: number
  text: string; fontSize: number
  flipX: boolean; flipY: boolean; gid: string
}

type DragMode =
  | { kind: 'move';     ids: string[]; start: Pt; snap: Map<string, { x:number;y:number;w:number;h:number;x1:number;y1:number;x2:number;y2:number;mx:number;my:number;pts:Pt[] }> }
  | { kind: 'resize';   id: string; handle: HPos; orig: DrawObj; start: Pt }
  | { kind: 'endpoint'; id: string; which: 'start'|'end'|'mid'; start: Pt }
  | { kind: 'marquee';  start: Pt; cur: Pt }
  | null

interface JournalDrawModalProps {
  isDark: boolean; initialSrc?: string
  onSave: (dataUrl: string) => void; onClose: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PEN_SIZES    = [2, 4, 8, 14] as const
const ERASER_SIZES = [8, 16, 28, 44] as const
const TEXT_SIZES   = [12, 18, 26, 36] as const
const SHAPE_TOOLS: DrawTool[] = ['rect', 'rect-r', 'circle', 'triangle']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }

function mkObj(p: Partial<DrawObj> & { id: string; type: ObjType }): DrawObj {
  return {
    x:0,y:0,w:0,h:0,x1:0,y1:0,x2:0,y2:0,mx:0,my:0,connType:'straight',
    pts:[],eraser:false,color:'#1a1a1a',fillColor:'#7c3aed',filled:false,sw:2,
    text:'',fontSize:18,flipX:false,flipY:false,gid:'', ...p,
  }
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
  if (obj.type === 'text') return px>=minX&&px<=maxX&&py>=minY&&py<=maxY
  if (!obj.filled) return (px>=minX-thresh&&px<=maxX+thresh&&py>=minY-thresh&&py<=maxY+thresh&&!(px>minX+thresh&&px<maxX-thresh&&py>minY+thresh&&py<maxY-thresh))
  return px>=minX&&px<=maxX&&py>=minY&&py<=maxY
}

function renderObj(c: CanvasRenderingContext2D, obj: DrawObj) {
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
    c.beginPath()
    if (obj.connType === 'curved') { c.moveTo(obj.x1,obj.y1); c.quadraticCurveTo(obj.mx,obj.my,obj.x2,obj.y2) }
    else if (obj.connType === 'elbow') { c.moveTo(obj.x1,obj.y1); c.lineTo(obj.mx,obj.my); c.lineTo(obj.x2,obj.y2) }
    else if (obj.connType === 'elbow-curved') {
      // Same two-segment elbow route as 'elbow', but with a rounded corner —
      // arcTo is the same technique roundRect() already uses for round-rect corners.
      const leg1 = Math.hypot(obj.mx-obj.x1, obj.my-obj.y1)
      const leg2 = Math.hypot(obj.x2-obj.mx, obj.y2-obj.my)
      const r = Math.max(0, Math.min(16, leg1/2, leg2/2))
      c.moveTo(obj.x1,obj.y1)
      c.arcTo(obj.mx,obj.my,obj.x2,obj.y2,r)
      c.lineTo(obj.x2,obj.y2)
    }
    else { c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2) }
    c.stroke()
    const tx = obj.connType !== 'straight' ? obj.mx : obj.x1
    const ty = obj.connType !== 'straight' ? obj.my : obj.y1
    drawArrowHead(c, tx, ty, obj.x2, obj.y2, obj.sw)
    c.restore(); return
  }

  const bb = getObjBB(obj)
  if (obj.flipX || obj.flipY) {
    const cx = (bb.minX+bb.maxX)/2, cy = (bb.minY+bb.maxY)/2
    c.translate(cx,cy); c.scale(obj.flipX?-1:1, obj.flipY?-1:1); c.translate(-cx,-cy)
  }
  if (obj.type === 'rect') { c.beginPath(); c.rect(obj.x,obj.y,obj.w,obj.h) }
  else if (obj.type === 'rect-r') { roundRect(c,obj.x,obj.y,obj.w,obj.h,10) }
  else if (obj.type === 'circle') { c.beginPath(); c.ellipse(obj.x+obj.w/2,obj.y+obj.h/2,Math.abs(obj.w)/2,Math.abs(obj.h)/2,0,0,Math.PI*2) }
  else if (obj.type === 'triangle') { c.beginPath(); c.moveTo(obj.x+obj.w/2,obj.y); c.lineTo(obj.x+obj.w,obj.y+obj.h); c.lineTo(obj.x,obj.y+obj.h); c.closePath() }
  if (obj.filled) c.fill()
  c.stroke(); c.restore()
}

function getHandlePositions(obj: DrawObj): Array<{ pos: HPos; x: number; y: number }> {
  const { minX,minY,maxX,maxY } = getObjBB(obj)
  const mx = (minX+maxX)/2, my = (minY+maxY)/2
  return [
    {pos:'nw',x:minX,y:minY},{pos:'n',x:mx,y:minY},{pos:'ne',x:maxX,y:minY},
    {pos:'e',x:maxX,y:my},{pos:'se',x:maxX,y:maxY},
    {pos:'s',x:mx,y:maxY},{pos:'sw',x:minX,y:maxY},{pos:'w',x:minX,y:my},
  ]
}

function drawHandleDot(c: CanvasRenderingContext2D, x: number, y: number, fill = '#ffffff') {
  c.save(); c.setLineDash([]); c.fillStyle = fill; c.strokeStyle = '#7c3aed'; c.lineWidth = 1.5
  c.beginPath(); c.rect(x-4,y-4,8,8); c.fill(); c.stroke(); c.restore()
}

// ─── EraserIcon ───────────────────────────────────────────────────────────────

const EraserIcon = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ display:'block' }}>
    <rect x="2" y="3.5" width="9" height="6.5" rx="1" fill="currentColor" opacity="0.75"/>
    <rect x="2" y="7" width="9" height="1.5" rx="0.5" fill="currentColor" opacity="0.35"/>
    <path d="M11 3.5L14 5V10.5L11 12V3.5Z" fill="currentColor" opacity="0.5" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round"/>
    <line x1="0.5" y1="12.5" x2="15.5" y2="12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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

export function JournalDrawModal({ isDark, initialSrc, onSave, onClose }: JournalDrawModalProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const bgImgRef    = useRef<HTMLImageElement | null>(null)
  const objectsRef  = useRef<DrawObj[]>([])
  const selIdsRef   = useRef<string[]>([])
  const historyRef  = useRef<string[]>([])
  const redoRef     = useRef<string[]>([])
  const dragRef     = useRef<DragMode>(null)
  const activeRef   = useRef<DrawObj | null>(null)
  const isDownRef   = useRef(false)
  const shapeStart  = useRef<Pt | null>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

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
  const [textInput,   setTextInput]   = useState<{ x:number; y:number; value:string } | null>(null)
  const [openPopover, setOpenPopover] = useState<PopoverId | null>(null)
  const [popAnchor,   setPopAnchor]   = useState<{ top:number; left:number } | null>(null)
  const [arrowConnDefault, setArrowConnDefault] = useState<ConnType>('elbow')

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
      if (initialSrc) {
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
    for (const obj of objectsRef.current) renderObj(c, obj)
    if (!forSave) {
      if (activeRef.current) renderObj(c, activeRef.current)
      const dm = dragRef.current
      if (dm?.kind === 'marquee') {
        const mx = Math.min(dm.start.x,dm.cur.x), my = Math.min(dm.start.y,dm.cur.y)
        const mw = Math.abs(dm.cur.x-dm.start.x), mh = Math.abs(dm.cur.y-dm.start.y)
        c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([4,3]); c.fillStyle='rgba(124,58,237,0.05)'
        c.fillRect(mx,my,mw,mh); c.strokeRect(mx,my,mw,mh); c.restore()
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
      return
    }
    const obj = objs[0]
    c.save(); c.strokeStyle='#7c3aed'; c.lineWidth=1; c.setLineDash([4,3])
    if (obj.type === 'line' || obj.type === 'arrow') {
      c.beginPath(); c.moveTo(obj.x1,obj.y1); c.lineTo(obj.x2,obj.y2); c.stroke(); c.restore()
      drawHandleDot(c, obj.x1, obj.y1); drawHandleDot(c, obj.x2, obj.y2)
      drawHandleDot(c, obj.mx, obj.my, '#ede9fe')
      return
    }
    if (obj.type === 'stroke' || obj.type === 'text') {
      const bb = getObjBB(obj)
      c.strokeRect(bb.minX-4, bb.minY-4, bb.maxX-bb.minX+8, bb.maxY-bb.minY+8)
      c.restore(); return
    }
    const { minX,minY,maxX,maxY } = getObjBB(obj)
    c.strokeRect(minX-2, minY-2, maxX-minX+4, maxY-minY+4); c.restore()
    for (const h of getHandlePositions(obj)) drawHandleDot(c, h.x, h.y)
  }

  // ── useEffect re-render ────────────────────────────────────────────────────
  useEffect(() => { renderAll() }, [objects, selIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hit testing ────────────────────────────────────────────────────────────
  type ItTarget = {kind:'none'} | {kind:'object';id:string} | {kind:'handle';id:string;which:HPos|'start'|'end'|'mid'}

  function getTarget(px: number, py: number): ItTarget {
    const HR = 10
    for (const id of selIdsRef.current) {
      const obj = objectsRef.current.find(o => o.id === id); if (!obj) continue
      if (obj.type === 'line' || obj.type === 'arrow') {
        if (Math.hypot(obj.x1-px,obj.y1-py) < HR) return {kind:'handle',id,which:'start'}
        if (Math.hypot(obj.x2-px,obj.y2-py) < HR) return {kind:'handle',id,which:'end'}
        if (Math.hypot(obj.mx-px,obj.my-py) < HR) return {kind:'handle',id,which:'mid'}
      } else if (obj.type !== 'stroke' && obj.type !== 'text') {
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
    activeRef.current = mkObj({id:uid(),type:tool as ObjType,color:drawColor,fillColor,filled,sw:PEN_SIZES[penIdx]})
  }

  function continueStroke(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!isDownRef.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const pos = getPos(e, canvas); if (!pos) return
    const dm = dragRef.current

    if (dm?.kind === 'move') {
      const dx = pos.x-dm.start.x, dy = pos.y-dm.start.y
      objectsRef.current = objectsRef.current.map(o => {
        if (!dm.ids.includes(o.id)) return o
        const s = dm.snap.get(o.id)!
        if (o.type === 'line' || o.type === 'arrow') return {...o,x1:s.x1+dx,y1:s.y1+dy,x2:s.x2+dx,y2:s.y2+dy,mx:s.mx+dx,my:s.my+dy}
        if (o.type === 'stroke') return {...o,pts:s.pts.map(p=>({x:p.x+dx,y:p.y+dy}))}
        return {...o,x:s.x+dx,y:s.y+dy}
      })
      renderAll(); return
    }

    if (dm?.kind === 'resize') {
      const orig = dm.orig
      const {minX:ox1,minY:oy1,maxX:ox2,maxY:oy2} = getObjBB(orig)
      let nx1=ox1,ny1=oy1,nx2=ox2,ny2=oy2
      const h = dm.handle
      if (h.includes('w')) nx1=pos.x; if (h.includes('e')) nx2=pos.x
      if (h.includes('n')) ny1=pos.y; if (h.includes('s')) ny2=pos.y
      objectsRef.current = objectsRef.current.map(o => o.id!==dm.id?o:{...o,x:nx1,y:ny1,w:nx2-nx1,h:ny2-ny1})
      renderAll(); return
    }

    if (dm?.kind === 'endpoint') {
      objectsRef.current = objectsRef.current.map(o => {
        if (o.id !== dm.id) return o
        if (dm.which === 'start') return {...o,x1:pos.x,y1:pos.y}
        if (dm.which === 'end')   return {...o,x2:pos.x,y2:pos.y}
        // Mid/bend-handle drag.
        if (o.connType === 'elbow' || o.connType === 'elbow-curved') {
          // Only two corner positions keep both segments orthogonal for fixed
          // endpoints — snap to whichever the cursor is nearer so the bend
          // always stays a hard 90° while still feeling freely draggable.
          const cornerH = { x:o.x2, y:o.y1 }
          const cornerV = { x:o.x1, y:o.y2 }
          const dH = Math.hypot(pos.x-cornerH.x, pos.y-cornerH.y)
          const dV = Math.hypot(pos.x-cornerV.x, pos.y-cornerV.y)
          const corner = dH <= dV ? cornerH : cornerV
          return {...o,mx:corner.x,my:corner.y}
        }
        if (o.type === 'arrow' && o.connType === 'straight') return {...o,mx:pos.x,my:pos.y,connType:'curved' as ConnType}
        return {...o,mx:pos.x,my:pos.y}
      })
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

    if (dm?.kind === 'move' || dm?.kind === 'resize' || dm?.kind === 'endpoint') {
      dragRef.current = null; syncObjs(objectsRef.current); snapshot(objectsRef.current); renderAll(); return
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
        const isElbow = active.type==='arrow' && (arrowConnDefault==='elbow' || arrowConnDefault==='elbow-curved')
        const obj={
          ...active, x1,y1,x2,y2,
          connType: active.type==='arrow' ? arrowConnDefault : active.connType,
          mx: isElbow ? x2 : (x1+x2)/2,
          my: isElbow ? y1 : (y1+y2)/2,
        }
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
    for (const obj of objectsRef.current) renderObj(c, obj)
    onSave(off.toDataURL('image/png'))
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  function commitText() {
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

  function setConnType(ct: ConnType) {
    const ids=selIdsRef.current
    const n=objectsRef.current.map(o=>{
      if(!ids.includes(o.id)||o.type!=='arrow') return o
      if(ct==='elbow'||ct==='elbow-curved') return {...o,connType:ct,mx:o.x2,my:o.y1}
      return {...o,connType:ct}
    })
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.key==='Escape' && openPopover) { e.preventDefault(); setOpenPopover(null); return }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo() }
      if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); redo() }
      if ((e.key==='Delete'||e.key==='Backspace')&&selIdsRef.current.length>0) { e.preventDefault(); deleteSelected() }
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const selObjs   = objects.filter(o => selIds.includes(o.id))
  const selHasShape = selObjs.some(o => SHAPE_TOOLS.includes(o.type as DrawTool))
  const selHasFlippable = selIds.length>0 && selObjs.some(o => o.type !== 'text')
  const selArrow    = selObjs.length===1 && selObjs[0].type==='arrow' ? selObjs[0] : null
  const selIsGroup  = selObjs.length>=2 && selObjs.every(o=>o.gid&&o.gid===selObjs[0].gid)
  const canGroup    = selIds.length>=2 && !selIsGroup
  const showFill    = SHAPE_TOOLS.includes(tool) || selHasShape
  const curFilled   = selIds.length>0 ? (selObjs[0]?.filled??false) : filled

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

        <span style={{fontSize:12,fontWeight:700,letterSpacing:'-0.01em',color:isDark?'rgba(255,255,255,0.85)':'#1e293b',marginRight:2,flexShrink:0}}>✏️ Draw</span>

        {dvdr}

        {/* Select */}
        <button title="Select (click / drag)" onClick={()=>{if(textInput)commitText();setTool('select')}} style={{...dkBtn(tool==='select'),minWidth:28,textAlign:'center',padding:'4px 8px',fontSize:13}}>↖</button>

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

        {/* Eraser + size popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Eraser" onClick={(e)=>{if(textInput)commitText();setTool('eraser');openPop('eraser-size',e)}}
            style={{...dkBtn(tool==='eraser'),display:'flex',alignItems:'center',gap:3,padding:'4px 8px'}}>
            <EraserIcon/>
            <span style={{fontSize:9,opacity:0.6}}>{['S','M','L','XL'][eraserIdx]}</span>
          </button>
          {openPopover==='eraser-size' && (
            <div data-popover="" style={fixedPopStyle()}>
              {(['Small','Medium','Large','Extra Large'] as const).map((lbl,i)=>pbtn(lbl,()=>{setEraserIdx(i);setOpenPopover(null)},eraserIdx===i))}
            </div>
          )}
        </div>

        {/* Text */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Text" onClick={(e)=>{if(textInput)commitText();setTool('text');openPop('text-size',e)}}
            style={{...dkBtn(tool==='text'),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:13,fontWeight:700}}>
            T<span style={{fontSize:9,opacity:0.6,fontWeight:400}}>{TEXT_SIZES[textSzIdx]}</span>
          </button>
          {openPopover==='text-size' && (
            <div data-popover="" style={fixedPopStyle()}>
              {TEXT_SIZES.map((sz,i)=>pbtn(`${sz}px`,()=>{setTextSzIdx(i);setOpenPopover(null)},textSzIdx===i))}
            </div>
          )}
        </div>

        {dvdr}

        {/* Shapes popover */}
        <div style={{flexShrink:0}} data-pop-trigger="">
          <button title="Shapes" onClick={(e)=>{if(textInput)commitText();openPop('shapes',e)}}
            style={{...dkBtn(SHAPE_TOOLS.includes(tool)),display:'flex',alignItems:'center',gap:3,padding:'4px 8px',fontSize:12}}>
            {tool==='rect'?'□':tool==='rect-r'?'⊡':tool==='circle'?'○':tool==='triangle'?'△':'□'} Shapes▾
          </button>
          {openPopover==='shapes' && (
            <div data-popover="" style={fixedPopStyle()}>
              {pbtn('□  Rectangle', ()=>{setTool('rect');     setOpenPopover(null)}, tool==='rect')}
              {pbtn('⊡  Round Rect',()=>{setTool('rect-r');   setOpenPopover(null)}, tool==='rect-r')}
              {pbtn('○  Circle',    ()=>{setTool('circle');   setOpenPopover(null)}, tool==='circle')}
              {pbtn('△  Triangle',  ()=>{setTool('triangle'); setOpenPopover(null)}, tool==='triangle')}
            </div>
          )}
        </div>

        {/* Line */}
        <button title="Line" onClick={()=>{if(textInput)commitText();setTool('line')}} style={{...dkBtn(tool==='line'),minWidth:28,textAlign:'center',padding:'4px 8px'}}>—</button>

        {/* Arrow */}
        <button title="Arrow / Connector" onClick={()=>{if(textInput)commitText();setTool('arrow');setArrowConnDefault('straight')}} style={{...dkBtn(tool==='arrow'&&arrowConnDefault==='straight'),minWidth:28,textAlign:'center',padding:'4px 8px'}}>→</button>

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

        {/* Fill color (shape tools / selected shapes) */}
        {showFill && (
          <label title="Fill Color" style={{position:'relative',cursor:'pointer',flexShrink:0}}>
            <div style={{width:22,height:22,borderRadius:4,background:fillColor,border:`2px solid ${isDark?'rgba(255,255,255,0.30)':'rgba(0,0,0,0.20)'}`,boxShadow:'0 0 0 1px rgba(124,58,237,0.20)'}}/>
            <input type="color" value={fillColor} onChange={e=>updateSelFillColor(e.target.value)} style={{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'}} tabIndex={-1}/>
          </label>
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
          <button onClick={deleteSelected}    style={{...dkBtn(false,true),padding:'4px 8px'}}>✕</button>
          {dvdr}
        </>)}

        {/* History */}
        <button style={dkBtn(false,false,!canUndo)} onClick={undo}    disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
        <button style={dkBtn(false,false,!canRedo)} onClick={redo}    disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
        <button style={dkBtn()}                     onClick={clearAll} title="Clear canvas">Clear</button>

        {dvdr}

        {/* Fit */}
        <button onClick={()=>setFitToScreen(f=>!f)} title={fitToScreen?'Exit full screen':'Fit to screen'} style={dkBtn(fitToScreen)}>
          {fitToScreen?'⊡':'⛶'} Fit
        </button>
      </div>

      {/* ── Fixed Cancel + Save ────────────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',gap:5,padding:'9px 12px',flexShrink:0,borderLeft:`0.5px solid ${dockBdr}`,background:dockBg}}>
        <button onClick={onClose} style={dkBtn(false,true)}>Cancel</button>
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
      />
      {textInput && (
        <input
          ref={textInputRef} autoFocus value={textInput.value}
          onChange={e=>setTextInput(prev=>prev?{...prev,value:e.target.value}:null)}
          onBlur={commitText}
          onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitText()}if(e.key==='Escape'){e.preventDefault();setTextInput(null)}}}
          style={{position:'absolute',left:textInput.x,top:textInput.y,background:'rgba(255,255,255,0.12)',backdropFilter:'blur(4px)',border:'1px dashed rgba(124,58,237,0.60)',borderRadius:4,color:drawColor,fontSize:TEXT_SIZES[textSzIdx],outline:'none',minWidth:120,padding:'2px 4px',zIndex:10,fontFamily:'sans-serif'}}
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
    `}</style>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  const innerContent = <>{popoverStyleTag}{toolbar}{canvasArea}</>

  if (fitToScreen) {
    return (
      <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',flexDirection:'column',background:isDark?'#10071e':'#ffffff'}}>
        {innerContent}
      </div>
    )
  }

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0,background:isDark?'#10071e':'#ffffff'}}>
      {innerContent}
    </div>
  )
}
