// Planner image blocks: Duplicate, and Move Image / Copy to Date. The REAL duplicateImageBlock() and transferImage() are extracted from
// JournalEditorContent.tsx and run against an in-memory day store (updateDay applies its updater like the app does) with stubbed
// confirmation (flushDays), so success, failed persistence, rapid repeats, same-date and mid-flight navigation are all exercised.
// Real-Chrome runs (desktop/tablet/mobile; real menus, modal, canvas, reload) were done during development.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const planner = read('components/xpadite/JournalEditorContent.tsx')
const modal = read('components/xpadite/TransferSectionModal.tsx')

function extractFunction(src, name, prefix = '  function ') {
  const start = src.indexOf(`${prefix}${name}(`)
  assert.ok(start > 0, name)
  let depth = 0
  for (let j = src.indexOf('{', src.indexOf(')', start) + 1); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) } }
  throw new Error('unbalanced ' + name)
}
const dupSrc = extractFunction(planner, 'duplicateImageBlock')
const xferFn = extractFunction(planner, 'transferImage', '  async function ')

const parseJournalDoc = raw => { try { const p = JSON.parse(raw); if (p && p.v === 1 && Array.isArray(p.blocks)) return p } catch {} return { v: 1, blocks: [{ id: 'empty-text', type: 'text', content: '' }] } }
const serializeJournalDoc = d => JSON.stringify(d)

function makeEnv({ blocks, dateKey = '2026-10-30', flushOk = true, flushDelay = 0, store = {} }) {
  let n = 0
  const env = {
    blocksRef: { current: blocks }, dateKeyRef: { current: dateKey }, imageTransferBusyRef: { current: false },
    store, toasts: [], deleted: [], inserted: [], flushCalls: [], sourcePersists: [], sourcePersistFails: false, order: [],
    flushFnRef: { current: () => { env.order.push('sourcePersist'); env.sourcePersists.push(env.blocksRef.current.map(b => b.id)); if (env.sourcePersistFails) throw new Error('source save failed') } },
    mkId: () => 'new' + (++n), parseJournalDoc, serializeJournalDoc, Date,
    fmtTransferDate: k => 'D' + k.slice(-2),
    setToast: m => env.toasts.push(m),
    insertBlock: (b, at) => { env.inserted.push([b, at]); const next = [...env.blocksRef.current]; next.splice(at + 1, 0, b); env.blocksRef.current = next },
    deleteBlock: id => { env.order.push('delete'); env.deleted.push(id); env.blocksRef.current = env.blocksRef.current.filter(b => b.id !== id) },
    updateDay: (key, updater) => { env.store[key] = updater(env.store[key] ?? { notes: '' }) },
    flushDays: async keys => { env.flushCalls.push(keys); env.order.push('destConfirmed'); if (flushDelay) await new Promise(r => setTimeout(r, flushDelay)); return typeof flushOk === 'function' ? flushOk() : flushOk },
  }
  const compile = (src, name) => {
    const js = ts.transpileModule(src + `\nmodule.exports = ${name}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const m = { exports: {} }
    new Function('module', 'exports', ...Object.keys(env), js)(m, m.exports, ...Object.values(env))
    return m.exports
  }
  env.duplicate = compile(dupSrc, 'duplicateImageBlock')
  env.transfer = compile(xferFn, 'transferImage')
  return env
}
const MM = { id: 'mm1', type: 'drawing', src: 'data:image/png;base64,MM', thumbnail: 'data:image/png;base64,MM', name: 'Mind Map — Oct 30, 2026', canvasData: '[{"id":"o1"}]', width: 60, height: 260, createdAt: 1000, updatedAt: 1000 }
const IMG = { id: 'img1', type: 'image', src: 'data:image/png;base64,IMG', thumbnail: 'data:image/png;base64,IMG', name: 'Photo', width: 45, createdAt: 2000, updatedAt: 2000 }
const SEC = { id: 'sec1', type: 'section', content: '{}', createdAt: 1, updatedAt: 1 }
const destBlocks = env => JSON.parse(env.store['2026-10-31'].notes).blocks

// ── Duplicate ─────────────────────────────────────────────────────────────────────────────────────────────────
test('Duplicate: an independent copy directly after the original, same picture/size/editable data, new identity', () => {
  const env = makeEnv({ blocks: [SEC, MM, IMG] }); env.duplicate('mm1')
  const [copy, at] = env.inserted[0]
  assert.equal(at, 1, 'inserted right after the original (index 1)')
  assert.equal(env.blocksRef.current.map(b => b.id).join(), 'sec1,mm1,new1,img1')
  assert.notEqual(copy.id, MM.id)
  for (const k of ['type', 'src', 'thumbnail', 'name', 'canvasData', 'width', 'height']) assert.equal(copy[k], MM[k], k)
  assert.ok(copy.createdAt > MM.createdAt && copy.updatedAt >= copy.createdAt)
  assert.equal(copy.galleryExempt, true, 'flagged: no Gallery item yet; its first Mind Map save creates its OWN entry')
  assert.equal(copy.galleryItemId, undefined, 'never inherits the original’s Gallery link')
  assert.equal(env.blocksRef.current[1], MM, 'the original object is untouched')
})
test('Duplicate works for uploaded images and repeated duplicates each get their own identity', () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); env.duplicate('img1'); env.duplicate('img1'); env.duplicate('img1')
  const ids = env.blocksRef.current.map(b => b.id)
  assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, 5)
  assert.ok(env.blocksRef.current.filter(b => b.type === 'image').every(b => b.src === IMG.src))
})
test('Duplicate ignores blocks that are not images/Mind Maps and unknown ids', () => {
  const env = makeEnv({ blocks: [SEC, MM] }); env.duplicate('sec1'); env.duplicate('nope')
  assert.equal(env.inserted.length, 0)
})

// ── Copy to Date ──────────────────────────────────────────────────────────────────────────────────────────────
test('Copy to Date: independent copy (new id) on the destination; the original stays; confirmed before reporting success', async () => {
  const env = makeEnv({ blocks: [SEC, MM, IMG] }); await env.transfer('copy', 'img1', '2026-10-31')
  const d = destBlocks(env)
  const copy = d.find(b => b.type === 'image')
  assert.ok(copy && copy.id !== 'img1' && copy.src === IMG.src && copy.name === IMG.name && copy.width === IMG.width && copy.galleryExempt === true)
  assert.ok(env.blocksRef.current.some(b => b.id === 'img1'), 'original still on this date'); assert.equal(env.deleted.length, 0)
  assert.deepEqual(env.flushCalls, [['2026-10-31']], 'the destination was confirmed with the server')
  assert.deepEqual(env.toasts, ['Image copied to D31 ✓'])
})
test('Copy of a Mind Map keeps every editable node (canvasData) and is independent of the original', async () => {
  const env = makeEnv({ blocks: [SEC, MM] }); await env.transfer('copy', 'mm1', '2026-10-31')
  const copy = destBlocks(env).find(b => b.type === 'drawing')
  assert.equal(copy.canvasData, MM.canvasData); assert.notEqual(copy.id, MM.id); assert.equal(copy.createdAt > MM.createdAt, true)
})

// ── Move to Date ──────────────────────────────────────────────────────────────────────────────────────────────
test('Move to Date: the SAME block (same id and metadata) lands on the destination, and only then is the original removed', async () => {
  const env = makeEnv({ blocks: [SEC, MM, IMG], flushDelay: 15 })
  const p = env.transfer('move', 'mm1', '2026-10-31')
  await new Promise(r => setTimeout(r, 5))
  assert.equal(env.deleted.length, 0, 'while the destination save is still in flight the original is NOT removed')
  assert.ok(env.blocksRef.current.some(b => b.id === 'mm1'))
  await p
  const moved = destBlocks(env).find(b => b.id === 'mm1')
  assert.ok(moved && moved.type === 'drawing' && moved.src === MM.src && moved.canvasData === MM.canvasData && moved.name === MM.name && moved.width === 60 && moved.height === 260 && moved.createdAt === MM.createdAt)
  assert.deepEqual(env.deleted, ['mm1']); assert.ok(!env.blocksRef.current.some(b => b.id === 'mm1'))
  assert.ok(!moved.galleryExempt, 'a moved block keeps its Gallery link (identity unchanged)')
  assert.deepEqual(env.toasts, ['Image moved to D31 ✓'])
})

// ── Failure / safety ──────────────────────────────────────────────────────────────────────────────────────────
test('FAILED save to the destination: the move is rolled back, the original is untouched, the user is told', async () => {
  const env = makeEnv({ blocks: [SEC, IMG], flushOk: false }); await env.transfer('move', 'img1', '2026-10-31')
  assert.equal(env.deleted.length, 0); assert.ok(env.blocksRef.current.some(b => b.id === 'img1'), 'nothing lost from the source')
  assert.ok(!destBlocks(env).some(b => b.id === 'img1'), 'the destination change was undone')
  assert.match(env.toasts[0], /nothing was moved/)
})
test('FAILED save on a copy: rolled back too — no stray copy is left behind', async () => {
  const env = makeEnv({ blocks: [SEC, IMG], flushOk: false }); await env.transfer('copy', 'img1', '2026-10-31')
  assert.equal(destBlocks(env).filter(b => b.type === 'image').length, 0); assert.match(env.toasts[0], /nothing was copied/)
})
test('failure does not strand the busy lock: a later attempt can succeed', async () => {
  let ok = false; const env = makeEnv({ blocks: [SEC, IMG], flushOk: () => ok })
  await env.transfer('move', 'img1', '2026-10-31'); ok = true; await env.transfer('move', 'img1', '2026-10-31')
  assert.deepEqual(env.deleted, ['img1']); assert.equal(destBlocks(env).filter(b => b.id === 'img1').length, 1)
})
test('same date is refused safely: no write, no duplicate, no deletion', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); await env.transfer('move', 'img1', '2026-10-30'); await env.transfer('copy', 'img1', '2026-10-30')
  assert.deepEqual(env.store, {}); assert.equal(env.deleted.length, 0); assert.equal(env.flushCalls.length, 0)
})
test('rapid repeated confirms: only one transfer runs while one is in flight', async () => {
  const env = makeEnv({ blocks: [SEC, IMG], flushDelay: 10 })
  await Promise.all([env.transfer('move', 'img1', '2026-10-31'), env.transfer('move', 'img1', '2026-10-31'), env.transfer('move', 'img1', '2026-10-31')])
  assert.equal(destBlocks(env).filter(b => b.id === 'img1').length, 1); assert.deepEqual(env.deleted, ['img1']); assert.equal(env.flushCalls.length, 1)
})
test('two copies to the same date compose (the destination is read inside the updater, not from a stale snapshot)', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); await env.transfer('copy', 'img1', '2026-10-31'); await env.transfer('copy', 'img1', '2026-10-31')
  const d = destBlocks(env); assert.equal(d.filter(b => b.type === 'image').length, 2); assert.equal(new Set(d.map(b => b.id)).size, d.length)
})
test('a block id already on the destination is never added twice (retried move)', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); env.store['2026-10-31'] = { notes: JSON.stringify({ v: 1, blocks: [{ ...IMG }] }) }
  await env.transfer('move', 'img1', '2026-10-31')
  assert.equal(destBlocks(env).filter(b => b.id === 'img1').length, 1)
})
test('existing destination content is preserved (the image is appended after it)', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); const existing = { id: 'dest-sec', type: 'section', content: '{"x":1}' }
  env.store['2026-10-31'] = { notes: JSON.stringify({ v: 1, blocks: [existing] }), productive: true }
  await env.transfer('copy', 'img1', '2026-10-31')
  const d = destBlocks(env); assert.equal(d[0].id, 'dest-sec'); assert.equal(d[1].type, 'image'); assert.equal(env.store['2026-10-31'].productive, true, 'other day data untouched')
})
test('navigating to another date while the save is in flight never deletes anything on the new date', async () => {
  const env = makeEnv({ blocks: [SEC, IMG], flushDelay: 10 })
  const p = env.transfer('move', 'img1', '2026-10-31'); env.dateKeyRef.current = '2026-11-02'; await p
  assert.equal(env.deleted.length, 0); assert.match(env.toasts[0], /saved to D31/)
})
test('non-image blocks and unknown ids are ignored', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); await env.transfer('move', 'sec1', '2026-10-31'); await env.transfer('copy', 'nope', '2026-10-31')
  assert.deepEqual(env.store, {})
})

// ── Menu, modal, Gallery protection (contracts) ─────────────────────────────────────────────────────────────────
test('image menu: existing actions kept; Duplicate + Move Image added after Edit Mind Map, before Send to (Section-menu order)', () => {
  const start = planner.indexOf('function InlineMediaBlock(')
  const menu = planner.slice(start, planner.indexOf('Send to →', start))
  const order = ['✥ Move', '⤡ Resize', '🧠 Edit Mind Map', '📑 Duplicate', '📅 Move Image']
  let last = -1; for (const t of order) { const i = menu.indexOf(t); assert.ok(i > last, t); last = i }
  assert.ok(/onDuplicate=\{\(\) => duplicateImageBlock\(block\.id\)\}/.test(planner) && /onTransfer=\{\(\) => setTransferImageId\(block\.id\)\}/.test(planner))
  assert.ok(planner.includes('🗑 Delete'), 'Delete kept')
})
test('Move Image reuses the Move Section modal: same component, image wording only, section wording unchanged', () => {
  assert.ok(/<TransferSectionModal\s+kind="image"/.test(planner))
  assert.ok(/title: 'Move Section', subtitle: 'Move or copy this section to another date\.'/.test(modal))
  assert.ok(/title: 'Move Image', subtitle: 'Move or copy this image to another date\.'/.test(modal))
  assert.ok(modal.includes("Creates an independent copy on the selected date. The original remains on its current date."))
  assert.ok(/The original section stays here\./.test(modal) && /pick another date to transfer it/.test(modal), 'section strings intact')
  assert.ok(/const canConfirm = !!selectedDate && !isSameAsOrigin/.test(modal), 'same-date rule unchanged')
  assert.ok(/<TransferSectionModal\s+dateKey=\{dateKey\}\s+sectionLabel=\{block\.name \?\? ''\}\s+onClose=\{\(\) => setTransferBlockId/.test(planner), 'the Section usage is unchanged (no kind prop)')
})
test('copies/duplicates can never refresh the original’s Gallery item; v1.319 refresh for normal Mind Maps is intact', () => {
  // v1.321: a duplicate/copy is "no entry yet" (never matched to anyone else's); its first save creates its OWN entry and records the link
  assert.ok(/\} else if \(existing\.galleryExempt\) \{\s*const item = newGalleryItem\(\)/.test(planner))
  assert.ok(/galleryItemId = refreshGalleryDrawing\(existing\.src, existing\.createdAt, dataUrl\)/.test(planner), 'legacy originals keep the v1.319 match')
  assert.ok(/galleryExempt\?: boolean/.test(read('components/xpadite/types.ts')) && /galleryItemId\?: string/.test(read('components/xpadite/types.ts')))
  assert.ok(/const existing = drawSessionBlockRef\.current \?\? drawState\.editingBlock/.test(planner), 'Ctrl+S fix intact')
  assert.ok(/exportFramedPng/.test(read('components/xpadite/JournalDrawModal.tsx')), 'framing intact')
})
test('Section Duplicate / Move Section code is untouched', () => {
  assert.ok(/function transferSection\(mode: 'move' \| 'copy', id: string, destKey: string\) \{/.test(planner) && /appendBlockToDay\(destKey, copy\)/.test(planner))
  assert.ok(/onDuplicate=\{block\.type === 'section' \? \(\) => duplicateBlock\(block\.id\) : undefined\}/.test(planner))
})

// ── Source-date save failures can never lose the image ───────────────────────────────────────────────────────────
test('Move order: destination confirmed FIRST, then the original removed, then that removal is persisted immediately', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); await env.transfer('move', 'img1', '2026-10-31')
  assert.deepEqual(env.order, ['destConfirmed', 'delete', 'sourcePersist'])
  assert.deepEqual(env.sourcePersists[0], ['sec1'], 'the source write already excludes the moved image')
})
test('a failed destination save never reaches the source: no delete, no source persist', async () => {
  const env = makeEnv({ blocks: [SEC, IMG], flushOk: false }); await env.transfer('move', 'img1', '2026-10-31')
  assert.deepEqual(env.order, ['destConfirmed']); assert.equal(env.sourcePersists.length, 0)
})
test('Copy never touches the source date: no delete and no source persist', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); await env.transfer('copy', 'img1', '2026-10-31')
  assert.equal(env.sourcePersists.length, 0); assert.equal(env.deleted.length, 0)
})
test('if the SOURCE date save fails or throws, the image is still safe on the confirmed destination and the move is reported', async () => {
  const env = makeEnv({ blocks: [SEC, IMG] }); env.sourcePersistFails = true
  const err = console.error; console.error = () => {}
  try { await env.transfer('move', 'img1', '2026-10-31') } finally { console.error = err }
  assert.ok(destBlocks(env).some(b => b.id === 'img1'), 'confirmed on the destination')
  assert.deepEqual(env.toasts, ['Image moved to D31 ✓'])
  assert.equal(env.imageTransferBusyRef.current, false, 'lock released')
  // worst case from here is "on both dates" (the source write is retried by the durable day sync) — never "on neither"
  const onDest = destBlocks(env).some(b => b.id === 'img1'), onSourceLocal = env.blocksRef.current.some(b => b.id === 'img1')
  assert.ok(onDest || onSourceLocal)
})
test('there is no code path that removes the original before the destination is confirmed', () => {
  const body = xferFn
  const iConfirm = body.indexOf('await flushDays([destKey])'), iDelete = body.indexOf('deleteBlock(id)'), iRollback = body.indexOf('if (!saved)')
  assert.ok(iConfirm > 0 && iRollback > iConfirm && iDelete > iRollback, 'confirm → failure/rollback return → only then delete')
  assert.equal((body.match(/deleteBlock\(/g) || []).length, 1, 'a single delete call, after confirmation')
  assert.ok(body.slice(iRollback, iDelete).includes('return'), 'the failure branch returns before the move branch')
})
