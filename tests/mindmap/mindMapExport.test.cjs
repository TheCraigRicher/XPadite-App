// Mind Mapping Canvas → Gallery: the saved PNG is framed around the drawn content (not the whole canvas), and the Gallery shows it whole.
// The framing maths and pixel scan (components/xpadite/mindMapExport.ts) run for real here. The real-browser behaviour (the actual
// canvas export on desktop/tablet/mobile, Gallery thumbnails/preview, Download/Share/Export file dimensions) was verified in Chrome during
// development; the contract tests at the bottom keep that wiring from regressing.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-mindmap'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'mindMapExport.js'), ts.transpileModule(read('components/xpadite/mindMapExport.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const M = require(path.join(OUT, 'mindMapExport.js'))

// RGBA buffer with filled rectangles of a given alpha
function rgba(w, h, rects) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (const [x, y, rw, rh, a] of rects) for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) d[(j * w + i) * 4 + 3] = a
  return d
}

test('scanOpaqueBounds: exact bounds of what is painted, anywhere on the surface', () => {
  assert.deepEqual(M.scanOpaqueBounds(rgba(100, 80, [[10, 20, 30, 15, 255]]), 100, 80), { x: 10, y: 20, w: 30, h: 15 })
  assert.deepEqual(M.scanOpaqueBounds(rgba(100, 80, [[0, 0, 5, 5, 255], [95, 75, 5, 5, 255]]), 100, 80), { x: 0, y: 0, w: 100, h: 80 }, 'two corners → whole surface')
  assert.deepEqual(M.scanOpaqueBounds(rgba(50, 50, [[49, 49, 1, 1, 255]]), 50, 50), { x: 49, y: 49, w: 1, h: 1 }, 'a single pixel on the last row/column')
  assert.deepEqual(M.scanOpaqueBounds(rgba(60, 60, [[5, 40, 10, 3, 255], [40, 5, 3, 10, 255]]), 60, 60), { x: 5, y: 5, w: 38, h: 38 }, 'separate islands are all included')
})
test('scanOpaqueBounds: an empty surface is null; faint shadow tails are not content', () => {
  assert.equal(M.scanOpaqueBounds(rgba(40, 40, []), 40, 40), null)
  assert.equal(M.scanOpaqueBounds(rgba(40, 40, [[3, 3, 20, 20, 5]]), 40, 40), null, 'alpha 5 is below the threshold')
  assert.deepEqual(M.scanOpaqueBounds(rgba(40, 40, [[3, 3, 20, 20, 5], [10, 10, 4, 4, 200]]), 40, 40), { x: 10, y: 10, w: 4, h: 4 })
})

test('framePad: balanced and clamped (small maps get a minimum, huge maps a maximum)', () => {
  assert.equal(M.framePad(100, 40), M.MM_EXPORT.PAD_MIN)
  assert.equal(M.framePad(4000, 100), M.MM_EXPORT.PAD_MAX)
  assert.equal(M.framePad(800, 300), 40)
})
test('planFrame: equal padding on all four sides, centred, proportions preserved', () => {
  for (const c of [{ x: 100, y: 50, w: 170, h: 46 }, { x: -300, y: 20, w: 900, h: 600 }, { x: 0, y: 0, w: 120, h: 2400 }, { x: 40, y: 40, w: 3000, h: 150 }]) {
    const p = M.planFrame(c, 2)
    const pad = M.framePad(c.w, c.h)
    assert.equal(c.x - p.crop.x, pad); assert.equal(c.y - p.crop.y, pad)
    assert.equal(p.crop.x + p.crop.w - (c.x + c.w), pad); assert.equal(p.crop.y + p.crop.h - (c.y + c.h), pad)
    assert.ok(Math.abs(p.width / p.height - p.crop.w / p.crop.h) < 0.02, 'aspect ratio of the crop is the aspect ratio of the image')
  }
})
test('planFrame: small maps are rendered larger so they stay sharp; large maps stay within hard memory/size limits', () => {
  const small = M.planFrame({ x: 80, y: 50, w: 170, h: 46 }, 2)
  assert.equal(small.scale, M.MM_EXPORT.MAX_SCALE); assert.ok(Math.max(small.width, small.height) >= 800, 'tiny map is not left at thumbnail size')
  for (const dpr of [1, 2, 3]) for (const c of [{ x: 0, y: 0, w: 900, h: 600 }, { x: 0, y: 0, w: 6000, h: 4000 }, { x: 0, y: 0, w: 30000, h: 30000 }, { x: 0, y: 0, w: 20, h: 20 }]) {
    const p = M.planFrame(c, dpr)
    assert.ok(Math.max(p.width, p.height) <= M.MM_EXPORT.MAX_LONG_PX + 1, `long side ${p.width}x${p.height}`)
    assert.ok(p.width * p.height <= M.MM_EXPORT.MAX_PIXELS * 1.01, `pixels ${p.width * p.height}`)
    assert.ok(p.width >= 1 && p.height >= 1)
  }
  const mid = M.planFrame({ x: 0, y: 0, w: 900, h: 600 }, 2)
  assert.ok(mid.scale >= 1.3 && Math.max(mid.width, mid.height) >= M.MM_EXPORT.MIN_LONG_PX - 2, 'a normal map reaches the minimum readable size')
})
test('probeRegion: covers the visible canvas AND content beyond it (any side), with room for arrowheads/overflow', () => {
  assert.deepEqual(M.probeRegion({ w: 800, h: 500 }, []), { x: 0, y: 0, w: 800, h: 500 })
  const r = M.probeRegion({ w: 800, h: 500 }, [{ minX: -120, minY: -60, maxX: 100, maxY: 80 }, { minX: 700, minY: 400, maxX: 2500, maxY: 1800 }])
  assert.ok(r.x <= -120 - M.MM_EXPORT.PROBE_MARGIN && r.y <= -60 - M.MM_EXPORT.PROBE_MARGIN)
  assert.ok(r.x + r.w >= 2500 + M.MM_EXPORT.PROBE_MARGIN && r.y + r.h >= 1800 + M.MM_EXPORT.PROBE_MARGIN)
})
test('probeScale: 1:1 normally, reduced only for enormous regions', () => {
  assert.equal(M.probeScale({ x: 0, y: 0, w: 4000, h: 3000 }), 1)
  const s = M.probeScale({ x: 0, y: 0, w: 20000, h: 20000 }); assert.ok(s < 1 && 20000 * 20000 * s * s <= M.MM_EXPORT.PROBE_MAX_PIXELS * 1.01)
})

// ── wiring contracts ────────────────────────────────────────────────────────────────────────────────────────────
const draw = read('components/xpadite/JournalDrawModal.tsx')
const gallery = read('components/xpadite/GalleryModal.tsx')
const planner = read('components/xpadite/JournalEditorContent.tsx')

test('canvas save exports the framed content; the whole-canvas export is gone; editing/coordinates untouched', () => {
  const save = draw.slice(draw.indexOf('function handleSave(): boolean'), draw.indexOf('// ── Unsaved-changes guard'))
  assert.ok(/exportFramedPng\(\{/.test(save) && /boxes: objectsRef\.current\.map\(getObjBB\)/.test(save))
  assert.ok(!/off\.width\s*=\s*canvas\.width/.test(save) && !/off\.toDataURL/.test(save), 'no more full-canvas export')
  assert.ok(/onSave\(exported\.dataUrl, objectsJson\)/.test(save), 'the editable object list is still saved alongside the PNG')
  assert.ok(/for \(const obj of objectsRef\.current\) renderObj\(c, obj, imageCacheRef\.current\)/.test(save), 'same renderer as the editor')
  assert.ok(/import \{ exportFramedPng \} from '\.\/mindMapExport'/.test(draw))
  // zoom/pan/node coordinates: saving must not write to any object or view state
  assert.ok(!/syncObjs|objectsRef\.current\s*=/.test(save))
})
test('empty canvas keeps the previous behaviour (whole canvas, device pixel ratio)', () => {
  const m = read('components/xpadite/mindMapExport.ts')
  assert.ok(/const framed = content !== null/.test(m) && /crop: \{ x: 0, y: 0, w: o\.viewportW, h: o\.viewportH \}/.test(m))
})
test('Gallery shows Mind Maps whole: object-contain on white for drawings only; photos/cards keep object-cover', () => {
  assert.ok(/const whole = item\.type === 'drawing'/.test(gallery))
  assert.ok(/\$\{whole \? 'object-contain' : 'object-cover'\}/.test(gallery) && /style=\{whole \? \{ background: '#ffffff' \} : undefined\}/.test(gallery))
  assert.ok(/<img src=\{item\.displayUrl \|\| item\.dataUri\}/.test(gallery), 'the original image is used for thumbnails AND the detail preview')
})
test('Download / Share / Export read the same original image (no separate thumbnail copy)', () => {
  assert.equal((gallery.match(/const uri = item\.displayUrl \|\| item\.dataUri/g) || []).length, 2, 'itemToDownloadFile and itemToRawFile')
  assert.ok(/blobToJpegFile\(blob, `XPadite-\$\{namePart\}-\$\{dateLabel\}\.jpg`\)/.test(gallery), 'existing file naming/format unchanged')
})
test('re-saving a Mind Map refreshes its Gallery item instead of leaving the first save forever', () => {
  assert.ok(/export function refreshGalleryDrawing\(/.test(gallery) && /i\.type === 'drawing' && i\.source === 'Planner\/Journal'/.test(gallery))
  assert.ok(/Math\.abs\(i\.createdAt - drawingCreatedAt\) <= 5000/.test(gallery))
  assert.ok(/const updated: GalleryItem = \{ \.\.\.items\[idx\], dataUri \}/.test(gallery), 'same id/title/date — nothing duplicated or deleted')
  assert.ok(/refreshGalleryDrawing\(existing\.src, existing\.createdAt, dataUrl\)/.test(planner))
  assert.ok(/export function addGalleryItem\(item: GalleryItem\): void \{\s*saveGallery\(\[item, \.\.\.loadGallery\(\)\]\)\s*syncGalleryItemInBackground\(item\)/.test(gallery), 'adding is unchanged')
})
test('a full browser store can never abort the Planner save: Gallery writes are guarded', () => {
  assert.ok(/try \{\s*addGalleryItem\(\{/.test(planner) && /could not add the Mind Map to the Gallery/.test(planner))
  assert.ok(/try \{ refreshGalleryDrawing\(/.test(planner))
})
test('scope: no change to the Planner display code, no new dependency', () => {
  const pkg = JSON.parse(read('package.json')); const before = ['@tiptap/react', 'react']
  for (const d of before) assert.ok(pkg.dependencies[d])
  assert.ok(!/mindMapExport/.test(planner), 'the Planner editor does not import the exporter; it just receives the PNG')
  assert.ok(!fs.readFileSync(path.join(ROOT, 'components/xpadite/mindMapExport.ts'), 'utf8').match(/^\s*import\s/m), 'no imports at all')
})
