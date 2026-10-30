// Mind Mapping Canvas — Ctrl+S must behave exactly like the toolbar Save: a Mind Map that already exists is UPDATED (same Planner block,
// same Gallery item), never duplicated, however fast or often Save is triggered. The Planner's real handleDrawSave() is executed here
// (extracted from the source, with its collaborators stubbed) against back-to-back saves that land before React re-renders — the exact
// condition that used to create a new block + Gallery item on every Ctrl+S. Real-browser runs (desktop/tablet/mobile, real keyboard) were
// done during development; the contract tests keep the canvas-side wiring from regressing.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const planner = read('components/xpadite/JournalEditorContent.tsx')
const canvas = read('components/xpadite/JournalDrawModal.tsx')

// ── run the REAL handleDrawSave ─────────────────────────────────────────────────────────────────────────────────
function extractFunction(src, name) {
  const start = src.indexOf(`  function ${name}(`)
  assert.ok(start > 0, name)
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start))
  for (let j = i; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) } }
  throw new Error('unbalanced')
}
const fnSrc = extractFunction(planner, 'handleDrawSave')

function harness({ editingBlock = null, insertAt = 0, blocks = [{ id: 'sec1', type: 'section' }] } = {}) {
  const calls = { add: [], refresh: [], update: [], manualSave: 0 }
  let n = 0
  const env = {
    drawState: { insertAt, editingBlock, editingCell: undefined },     // what the closure sees: a render's snapshot (NOT updated between quick saves)
    drawSessionBlockRef: { current: null },
    blocksRef: { current: blocks },
    setBlocks: () => {}, setDrawState: () => {}, setMmcFit: () => {},
    onContentChange: () => {}, buildDocStr: () => '', handleManualSave: () => { calls.manualSave++ },
    getSectionImageCell: () => null, updateBlock: () => {},
    createDrawingBlock: (src, name, canvasData) => ({ id: 'blk' + (++n), type: 'drawing', src, thumbnail: src, name, canvasData, createdAt: 1000 + n, updatedAt: 1000 + n }),
    addGalleryItem: item => calls.add.push(item),
    refreshGalleryDrawing: (prevUri, createdAt, uri) => { calls.refresh.push({ prevUri, createdAt, uri }); return 'g-legacy' },   // legacy matcher: returns the matched item's id
    updateGalleryDrawingById: (id, patch) => { calls.update.push({ id, ...patch }); return true },
    fmtShortDate: () => 'Oct 30, 2026', dateKey: '2026-10-30', Date,
  }
  const js = ts.transpileModule(fnSrc.replace(/\(prev\) =>/g, '(prev) =>') + '\nmodule.exports = handleDrawSave', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', ...Object.keys(env), js)(m, m.exports, ...Object.values(env))
  return { env, calls, save: m.exports, drawingBlocks: () => env.blocksRef.current.filter(b => b.type === 'drawing') }
}

test('first save of a genuinely new Mind Map: one Planner block, one Gallery item, no refresh', () => {
  const h = harness()
  h.save('data:image/png;base64,A', '[{"id":"o1"}]')
  assert.equal(h.drawingBlocks().length, 1)
  assert.equal(h.calls.add.length, 1); assert.equal(h.calls.refresh.length, 0)
  assert.equal(h.calls.add[0].type, 'drawing'); assert.equal(h.calls.add[0].source, 'Planner/Journal'); assert.equal(h.calls.add[0].dataUri, 'data:image/png;base64,A')
  assert.equal(h.calls.manualSave, 1)
  assert.equal(h.env.blocksRef.current[1].id, h.drawingBlocks()[0].id, 'inserted right after its insertion point')
})
test('repeated saves BEFORE React re-renders (stale drawState: editingBlock still null) update the same block and Gallery item', () => {
  const h = harness()
  h.save('data:image/png;base64,A', '[1]')
  const first = h.drawingBlocks()[0]
  h.save('data:image/png;base64,B', '[1,2]'); h.save('data:image/png;base64,C', '[1,2,3]'); h.save('data:image/png;base64,D', '[1,2,3,4]'); h.save('data:image/png;base64,E', '[1,2,3,4,5]')
  assert.equal(h.drawingBlocks().length, 1, 'still ONE Planner block')
  assert.equal(h.drawingBlocks()[0].id, first.id, 'block identity preserved')
  assert.equal(h.calls.add.length, 1, 'ONE Gallery item ever created')
  assert.equal(h.calls.refresh.length, 0, 'no timestamp/picture matching: the block owns its Gallery item by id')
  assert.equal(h.calls.update.length, 4, 'every later save updates that same item')
  assert.equal(h.drawingBlocks()[0].src, 'data:image/png;base64,E'); assert.equal(h.drawingBlocks()[0].canvasData, '[1,2,3,4,5]', 'latest content wins')
  assert.equal(h.drawingBlocks()[0].createdAt, first.createdAt, 'creation identity (used to match its Gallery item) is kept')
  // every later save targets the id recorded on the block by the FIRST save (even though the render's snapshot is stale)
  assert.ok(h.calls.update.every(u => u.id === h.calls.add[0].id))
  assert.equal(h.drawingBlocks()[0].galleryItemId, h.calls.add[0].id)
})
test('keyboard Save and toolbar Save are the same code path: interleaved saves give the same single block and item', () => {
  const h = harness()
  for (const [i, who] of ['key', 'button', 'key', 'button', 'key'].entries()) h.save('data:image/png;base64,' + who + i, '[' + i + ']')
  assert.equal(h.drawingBlocks().length, 1); assert.equal(h.calls.add.length, 1); assert.equal(h.calls.update.length, 4)
})
test('re-opening an existing Mind Map from the Planner: saves update that block, never create one', () => {
  const existing = { id: 'blkX', type: 'drawing', src: 'data:image/png;base64,OLD', thumbnail: 'x', name: 'Mind Map — Oct 1, 2026', canvasData: '[]', createdAt: 5000, updatedAt: 5000 }
  const h = harness({ editingBlock: existing, blocks: [{ id: 'sec1', type: 'section' }, existing] })
  h.save('data:image/png;base64,NEW1', '[1]'); h.save('data:image/png;base64,NEW2', '[2]')
  assert.equal(h.drawingBlocks().length, 1); assert.equal(h.drawingBlocks()[0].id, 'blkX'); assert.equal(h.drawingBlocks()[0].createdAt, 5000)
  assert.equal(h.calls.add.length, 0, 'no new Gallery item')
  // a block saved before links existed is matched ONCE (legacy matcher: its old picture + creation time), then remembers the exact id
  assert.deepEqual(h.calls.refresh.map(r => [r.prevUri.slice(-3), r.createdAt]), [['OLD', 5000]])
  assert.equal(h.drawingBlocks()[0].galleryItemId, 'g-legacy')
  assert.deepEqual(h.calls.update.map(u => u.id), ['g-legacy'], 'the second save updates by id')
})
test('a failing Gallery write never aborts the Planner save', () => {
  const h = harness(); h.env.addGalleryItem = () => { throw new Error('QuotaExceededError') }
  // rebuild with the throwing stub
  const h2 = harness(); const src = fnSrc
  const js = ts.transpileModule(src + '\nmodule.exports = handleDrawSave', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const env = { ...h2.env, addGalleryItem: () => { throw new Error('QuotaExceededError') } }
  const m = { exports: {} }; const origErr = console.error; console.error = () => {}
  try { new Function('module', 'exports', ...Object.keys(env), js)(m, m.exports, ...Object.values(env)); m.exports('data:image/png;base64,Z', '[]') } finally { console.error = origErr }
  assert.equal(env.blocksRef.current.filter(b => b.type === 'drawing').length, 1, 'the Mind Map block was still saved')
  assert.equal(h2.calls.manualSave, 1)
})

// ── contracts ───────────────────────────────────────────────────────────────────────────────────────────────────
test('canvas: the Ctrl+S listener calls the CURRENT handleSave through a ref that is refreshed on every render', () => {
  assert.ok(/const handleSaveRef = useRef<\(\) => boolean>\(\(\) => false\)\n\s*handleSaveRef\.current = handleSave/.test(canvas))
  assert.ok(/e\.preventDefault\(\)\n\s*\/\/ Holding the keys down auto-repeats keydown: one press = one save\.\n\s*if \(!e\.repeat\) handleSaveRef\.current\(\)/.test(canvas))
  assert.ok(!/e\.key\.toLowerCase\(\)==='s'\) \{ e\.preventDefault\(\); handleSave\(\)/.test(canvas), 'the stale direct call is gone')
})
test('canvas: toolbar Save still calls handleSave directly (same function the ref points at)', () => {
  assert.ok(/<button onClick=\{handleSave\} style=\{\{padding:'5px 16px'/.test(canvas))
})
test('canvas: other keyboard shortcuts are untouched', () => {
  for (const frag of ["e.key.toLowerCase()==='z'", "e.key.toLowerCase()==='y'", "e.key==='Delete'||e.key==='Backspace'", "e.key==='ArrowUp'", "if (e.key==='Escape' && openPopover)"]) assert.ok(canvas.includes(frag), frag)
  assert.ok(/\}, \[openPopover\]\) \/\/ eslint-disable-line react-hooks\/exhaustive-deps/.test(canvas), 'the listener registration itself is unchanged')
})
test('planner: the session block is remembered synchronously and cleared when the canvas closes', () => {
  assert.ok(/const drawSessionBlockRef = useRef<JournalBlock \| null>\(null\)/.test(planner))
  assert.ok(/if \(!drawState\) drawSessionBlockRef\.current = null/.test(planner))
  assert.ok(/blocksRef\.current = next\n\s*drawSessionBlockRef\.current = savedBlock/.test(planner))
  assert.ok(/const existing = drawSessionBlockRef\.current \?\? drawState\.editingBlock/.test(planner))
})
test('framing, Gallery refresh and display fixes are all still in place', () => {
  assert.ok(/exportFramedPng\(\{/.test(canvas) && /onSave\(exported\.dataUrl, objectsJson\)/.test(canvas))
  assert.ok(/refreshGalleryDrawing\(existing\.src, existing\.createdAt, dataUrl\)/.test(planner))
  assert.ok(/export function refreshGalleryDrawing\(/.test(read('components/xpadite/GalleryModal.tsx')) && /object-contain/.test(read('components/xpadite/GalleryModal.tsx')))
})
