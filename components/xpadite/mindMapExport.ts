// ── Mind Mapping Canvas → PNG: frame the content, not the canvas ─────────────
//
// Why saved Mind Maps looked tiny in the Gallery: handleSave exported the WHOLE canvas viewport (every pixel of the editing
// surface, at the device pixel ratio), so a map that only filled part of the surface was saved with all the empty surface
// around it — and the Gallery then shrank that whole picture into a thumbnail.
//
// The canvas has no zoom/pan (objects live in the canvas's own CSS-pixel space), so framing is independent of the user's view
// by construction. The content bounds are measured from what is actually PAINTED, not estimated from object geometry: the
// objects are drawn once onto a transparent probe canvas and the non-transparent pixels are scanned. That automatically
// covers every connector route (straight, curved, elbow), arrowheads, stroke widths, rotated shapes, shape text, pasted
// images and freehand strokes, without duplicating the renderer's geometry rules here. The final image is then rendered
// directly (vector → pixels) at a resolution chosen for the framed size, so it is sharp rather than an enlarged bitmap.

export interface Rect { x: number; y: number; w: number; h: number }
export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export const MM_EXPORT = {
  /** Pixels with alpha below this are ignored when measuring content (faint shadow tails are not "content"). */
  ALPHA_MIN: 8,
  /** Padding around the content, as a share of its longer side, clamped to [PAD_MIN, PAD_MAX] CSS px. */
  PAD_RATIO: 0.05, PAD_MIN: 20, PAD_MAX: 64,
  /** Small compositions are rendered at a higher scale so the PNG is still sharp when enlarged in the Gallery. */
  MIN_LONG_PX: 1400,
  MAX_SCALE: 4,
  /** Hard ceilings so a huge canvas can never exhaust memory or bloat the saved asset. */
  MAX_LONG_PX: 2800,
  MAX_PIXELS: 6_000_000,
  /** Probe canvas (bounds measurement only) ceilings. */
  PROBE_MAX_PIXELS: 24_000_000,
  /** Room around object geometry for things drawn outside their box (arrowheads, text overflow, stroke width). */
  PROBE_MARGIN: 200,
} as const

/** Bounds of every pixel whose alpha is >= alphaMin, as a pixel-space Rect (x/y inclusive, w/h = extent), or null if none. */
export function scanOpaqueBounds(rgba: ArrayLike<number>, width: number, height: number, alphaMin: number = MM_EXPORT.ALPHA_MIN): Rect | null {
  let minY = -1, maxY = -1
  const rowHasInk = (y: number) => { const base = y * width * 4 + 3; for (let x = 0; x < width; x++) if (rgba[base + x * 4] >= alphaMin) return true; return false }
  for (let y = 0; y < height; y++) if (rowHasInk(y)) { minY = y; break }
  if (minY < 0) return null
  for (let y = height - 1; y >= minY; y--) if (rowHasInk(y)) { maxY = y; break }
  let minX = width, maxX = -1
  for (let y = minY; y <= maxY; y++) {
    const base = y * width * 4 + 3
    for (let x = 0; x < minX; x++) if (rgba[base + x * 4] >= alphaMin) { minX = x; break }
    for (let x = width - 1; x > maxX; x--) if (rgba[base + x * 4] >= alphaMin) { maxX = x; break }
  }
  if (maxX < minX) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Balanced padding for a content size (CSS px). */
export function framePad(contentW: number, contentH: number): number {
  const p = Math.max(contentW, contentH) * MM_EXPORT.PAD_RATIO
  return Math.min(MM_EXPORT.PAD_MAX, Math.max(MM_EXPORT.PAD_MIN, p))
}

/**
 * Crop rectangle (content + equal padding on all sides, so the composition is centred and keeps its proportions) and the
 * render scale + output size for it. dpr is the device pixel ratio.
 */
export function planFrame(content: Rect, dpr: number): { crop: Rect; scale: number; width: number; height: number } {
  const pad = framePad(content.w, content.h)
  const crop: Rect = { x: content.x - pad, y: content.y - pad, w: content.w + 2 * pad, h: content.h + 2 * pad }
  const long = Math.max(crop.w, crop.h)
  let scale = Math.min(MM_EXPORT.MAX_SCALE, Math.max(dpr || 1, MM_EXPORT.MIN_LONG_PX / long))
  scale = Math.min(scale, MM_EXPORT.MAX_LONG_PX / long, Math.sqrt(MM_EXPORT.MAX_PIXELS / (crop.w * crop.h)))
  return { crop, scale, width: Math.max(1, Math.ceil(crop.w * scale)), height: Math.max(1, Math.ceil(crop.h * scale)) }
}

/** The area the probe must cover: the visible canvas plus every object's box (with margin), so off-canvas content is included. */
export function probeRegion(viewport: { w: number; h: number }, boxes: BBox[]): Rect {
  let minX = 0, minY = 0, maxX = viewport.w, maxY = viewport.h
  const m = MM_EXPORT.PROBE_MARGIN
  for (const b of boxes) {
    minX = Math.min(minX, b.minX - m); minY = Math.min(minY, b.minY - m)
    maxX = Math.max(maxX, b.maxX + m); maxY = Math.max(maxY, b.maxY + m)
  }
  return { x: Math.floor(minX), y: Math.floor(minY), w: Math.ceil(maxX - Math.floor(minX)), h: Math.ceil(maxY - Math.floor(minY)) }
}

/** 1 CSS px = 1 probe px normally; smaller for enormous regions so the probe itself stays within memory limits. */
export function probeScale(region: Rect): number {
  const px = region.w * region.h
  return px <= MM_EXPORT.PROBE_MAX_PIXELS ? 1 : Math.sqrt(MM_EXPORT.PROBE_MAX_PIXELS / px)
}

export interface FramedExport { dataUrl: string; width: number; height: number; framed: boolean; crop: Rect; scale: number }

/**
 * Renders a framed PNG of whatever `draw` paints. `draw` must paint ONLY the content (no background fill): it is called once on a
 * transparent probe canvas to measure the content, then once more on the white output canvas.
 * If nothing is painted (empty canvas) the previous behaviour is kept: the whole canvas at the device pixel ratio.
 */
export function exportFramedPng(o: {
  viewportW: number; viewportH: number; dpr: number; boxes: BBox[]
  draw: (c: CanvasRenderingContext2D) => void
}): FramedExport {
  const region = probeRegion({ w: o.viewportW, h: o.viewportH }, o.boxes)
  const ps = probeScale(region)
  const probe = document.createElement('canvas')
  probe.width = Math.max(1, Math.ceil(region.w * ps)); probe.height = Math.max(1, Math.ceil(region.h * ps))
  let content: Rect | null = null
  try {
    const pc = probe.getContext('2d', { willReadFrequently: true })
    if (pc) {
      pc.scale(ps, ps); pc.translate(-region.x, -region.y)
      o.draw(pc)
      const data = pc.getImageData(0, 0, probe.width, probe.height).data
      const b = scanOpaqueBounds(data, probe.width, probe.height)
      if (b) {
        // back to CSS px, widened by one probe pixel each side so anti-aliased edges are never shaved
        content = { x: region.x + (b.x - 1) / ps, y: region.y + (b.y - 1) / ps, w: (b.w + 2) / ps, h: (b.h + 2) / ps }
      }
    }
  } finally {
    probe.width = 0; probe.height = 0   // release the probe's memory straight away
  }

  const framed = content !== null
  const plan = content
    ? planFrame(content, o.dpr)
    : { crop: { x: 0, y: 0, w: o.viewportW, h: o.viewportH }, scale: o.dpr || 1, width: Math.max(1, Math.round(o.viewportW * (o.dpr || 1))), height: Math.max(1, Math.round(o.viewportH * (o.dpr || 1))) }

  const out = document.createElement('canvas')
  out.width = plan.width; out.height = plan.height
  const c = out.getContext('2d')
  if (!c) throw new Error('2D canvas unavailable')
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, out.width, out.height)
  c.scale(out.width / plan.crop.w, out.height / plan.crop.h)   // exact fit, so rounding the pixel size never distorts the picture
  c.translate(-plan.crop.x, -plan.crop.y)
  o.draw(c)
  const dataUrl = out.toDataURL('image/png')
  const result: FramedExport = { dataUrl, width: out.width, height: out.height, framed, crop: plan.crop, scale: plan.scale }
  out.width = 0; out.height = 0
  return result
}
