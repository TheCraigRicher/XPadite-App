// Mind Map ↔ Gallery OWNERSHIP (v1.321). The REAL Gallery store functions (GalleryModal.tsx) and the REAL handleDrawSave / duplicateImageBlock /
// transferImage (JournalEditorContent.tsx) are compiled together against one simulated browser store, so the exact reported workflow runs end to
// end: Oct 30 Mind Map → Duplicate → Move to Oct 31 → open in the canvas → save (first save creates ITS OWN Gallery entry) → save again (updates
// that entry in place) → refresh → original untouched. Real-Chrome runs of the same workflow (desktop/tablet/mobile) were done during development.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const planner = read('components/xpadite/JournalEditorContent.tsx')
const galleryFile = read('components/xpadite/GalleryModal.tsx')

function extractFunction(src, name, prefix = '  function ') {
  const start = src.indexOf(`${prefix}${name}(`); assert.ok(start > 0, name)
  let depth = 0
  for (let j = src.indexOf('{', src.indexOf(')', start) + 1); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) } }
  throw new Error('unbalanced ' + name)
}
const galleryStore = galleryFile.slice(galleryFile.indexOf('export function loadGallery'), galleryFile.indexOf('function resizeImage'))
const drawSrc = extractFunction(planner, 'handleDrawSave')
const dupSrc = extractFunction(planner, 'duplicateImageBlock')
const xferSrc = extractFunction(planner, 'transferImage', '  async function ')

const parseJournalDoc = raw => { try { const p = JSON.parse(raw); if (p && p.v === 1 && Array.isArray(p.blocks)) return p } catch {} return { v: 1, blocks: [{ id: 'empty-text', type: 'text', content: '' }] } }
const serializeJournalDoc = d => JSON.stringify(d)
const fmtShortDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

// ── the shared "browser": localStorage + the per-date day store ──
function makeWorld() {
  const data = {}
  const ls = { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { if (ls.failGallery && k === 'xp9g') throw new Error('QuotaExceededError'); data[k] = String(v) }, failGallery: false }
  return { ls, store: {}, gallery: () => JSON.parse(ls.getItem('xp9g') || '[]'), setGallery: items => ls.setItem('xp9g', JSON.stringify(items)), tick: 1_000_000 }
}

// One mounted Planner editor for one date (a fresh closure set, like a fresh page load of that date).
function mountPlanner(world, date, { editingBlock = null } = {}) {
  let n = 0, mk = 0
  const env = {
    GALLERY_KEY: 'xp9g', localStorage: world.ls, Date,
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }), uploadGalleryImage: async () => null, upsertGalleryItemMetadata: async () => {},
    dateKey: date, dateKeyRef: { current: date }, imageTransferBusyRef: { current: false },
    blocksRef: { current: parseJournalDoc(world.store[date]?.notes).blocks.filter(b => b.id !== 'empty-text' || false) },
    // `drawState` is a LIVE view of what the current render holds (the compiled functions copy bindings, so a plain property would go stale)
    _ds: { insertAt: 0, editingBlock, editingCell: undefined },
    drawState: new Proxy({}, { get: (_, k) => env._ds[k] }), setDraw: ds => { env._ds = ds },
    drawSessionBlockRef: { current: null },
    toasts: [], setToast: m => env.toasts.push(m),
    setBlocks: () => {}, setDrawState: () => {}, setMmcFit: () => {}, onContentChange: () => {},
    buildDocStr: () => serializeJournalDoc({ v: 1, blocks: env.blocksRef.current }),
    getSectionImageCell: () => null, updateBlock: () => {},
    mkId: () => `${date}-new${++mk}`, parseJournalDoc, serializeJournalDoc, fmtShortDate, fmtTransferDate: k => 'D' + k.slice(-2),
    createDrawingBlock: (src, name, canvasData) => ({ id: `${date}-mm${++n}`, type: 'drawing', src, thumbnail: src, name, canvasData, createdAt: ++world.tick, updatedAt: world.tick }),
    insertBlock: (b, at) => { const next = [...env.blocksRef.current]; next.splice(at + 1, 0, b); env.blocksRef.current = next },
    deleteBlock: id => { env.blocksRef.current = env.blocksRef.current.filter(b => b.id !== id) },
    persist: () => { world.store[date] = { ...(world.store[date] ?? {}), notes: serializeJournalDoc({ v: 1, blocks: env.blocksRef.current }) } },
    handleManualSave: () => env.persist(),
    flushFnRef: { current: () => env.persist() },
    updateDay: (key, updater) => { world.store[key] = updater(world.store[key] ?? { notes: '' }) },
    flushDays: async () => true,
  }
  const code = ts.transpileModule(`${galleryStore}\n${dupSrc}\n${xferSrc}\n${drawSrc}\nObject.assign(exports, { loadGallery, addGalleryItem, refreshGalleryDrawing, findGalleryDrawingId, updateGalleryDrawingById, duplicateImageBlock, transferImage, handleDrawSave })`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', ...Object.keys(env), code)(m, m.exports, ...Object.values(env))
  return Object.assign(env, m.exports, { drawings: () => env.blocksRef.current.filter(b => b.type === 'drawing') })
}
const PNG = k => `data:image/png;base64,${k}`

// The Oct 30 day: a section + a LEGACY Mind Map (saved before blocks recorded a Gallery link) with its matching Gallery item.
function seedOct30() {
  const world = makeWorld()
  const mm = { id: 'mm-orig', type: 'drawing', src: PNG('ORIG'), thumbnail: PNG('ORIG'), name: 'Mind Map — Oct 30, 2026', canvasData: '[{"id":"funnel"}]', createdAt: 500_000, updatedAt: 500_000 }
  world.store['2026-10-30'] = { notes: serializeJournalDoc({ v: 1, blocks: [{ id: 'sec1', type: 'section', content: '{}' }, mm] }) }
  world.setGallery([{ id: 'draw-orig', type: 'drawing', createdAt: 500_005, title: 'Mind Map — Oct 30, 2026', dataUri: PNG('ORIG'), source: 'Planner/Journal', relatedDateLabel: 'Oct 30, 2026' }])
  return { world, mm }
}
const itemById = (world, id) => world.gallery().find(i => i.id === id)

// ── THE REPORTED WORKFLOW ───────────────────────────────────────────────────────────────────────────────────
test('Duplicate → Move to Oct 31 → edit & save: the duplicate gets its OWN Gallery entry for Oct 31; the Oct 30 original is untouched', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30')
  p30.duplicateImageBlock('mm-orig'); p30.persist()
  const dup = p30.drawings().find(b => b.id !== 'mm-orig')
  assert.equal(world.gallery().length, 1, 'Duplicate creates no Gallery entry')
  assert.ok(dup.galleryExempt === true && dup.galleryItemId === undefined, 'a duplicate is "no entry yet" and never inherits a link')

  await p30.transferImage('move', dup.id, '2026-10-31')
  assert.equal(world.gallery().length, 1, 'moving an unsaved duplicate creates no Gallery entry')
  assert.equal(p30.drawings().length, 1)

  const p31 = mountPlanner(world, '2026-10-31')
  const onOct31 = p31.drawings()[0]; assert.equal(onOct31.id, dup.id, 'same identity and editable data on Oct 31'); assert.equal(onOct31.canvasData, '[{"id":"funnel"}]')
  p31.setDraw({ insertAt: 0, editingBlock: onOct31, editingCell: undefined })
  p31.handleDrawSave(PNG('EDITED1'), '[{"id":"funnel"},{"id":"new"}]')

  const g = world.gallery(); assert.equal(g.length, 2, 'a NEW Gallery entry exists')
  const mine = g.find(i => i.id !== 'draw-orig')
  assert.equal(mine.dataUri, PNG('EDITED1'), 'containing its current image')
  assert.equal(mine.relatedDateLabel, 'Oct 31, 2026'); assert.equal(mine.title, 'Mind Map — Oct 31, 2026'); assert.equal(mine.source, 'Planner/Journal'); assert.equal(mine.type, 'drawing')
  assert.ok(typeof mine.createdAt === 'number' && mine.createdAt > 1_600_000_000_000, 'a real creation timestamp (not the block’s)')
  assert.deepEqual(itemById(world, 'draw-orig'), { id: 'draw-orig', type: 'drawing', createdAt: 500_005, title: 'Mind Map — Oct 30, 2026', dataUri: PNG('ORIG'), source: 'Planner/Journal', relatedDateLabel: 'Oct 30, 2026' }, 'the original’s entry is byte-for-byte unchanged')
  const saved = p31.drawings()[0]
  assert.equal(saved.galleryItemId, mine.id, 'the duplicate now owns that entry'); assert.ok(!saved.galleryExempt)
  assert.equal(saved.src, PNG('EDITED1'))
})

test('saving the duplicate again (toolbar, then rapid Ctrl+S with a stale render) updates ITS entry in place — never a second one', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  const dup = p30.drawings().find(b => b.id !== 'mm-orig'); await p30.transferImage('move', dup.id, '2026-10-31')
  const p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined })   // the render's snapshot never updates between quick saves
  p31.handleDrawSave(PNG('E1'), '[1]'); const id = world.gallery().find(i => i.id !== 'draw-orig').id
  for (const k of ['E2', 'E3', 'E4', 'E5', 'E6']) p31.handleDrawSave(PNG(k), `["${k}"]`)
  const g = world.gallery()
  assert.equal(g.length, 2); assert.equal(g.filter(i => i.id === id).length, 1); assert.equal(itemById(world, id).dataUri, PNG('E6'), 'latest image')
  assert.equal(p31.drawings().length, 1, 'one Planner block'); assert.equal(p31.drawings()[0].galleryItemId, id)
  assert.equal(itemById(world, 'draw-orig').dataUri, PNG('ORIG'))
})

test('after a refresh (a fresh mount that reads the persisted block) ownership still holds: update in place, no new entry', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  const dup = p30.drawings().find(b => b.id !== 'mm-orig'); await p30.transferImage('move', dup.id, '2026-10-31')
  let p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined })
  p31.handleDrawSave(PNG('A1'), '[1]'); const id = p31.drawings()[0].galleryItemId
  // ── refresh ──
  p31 = mountPlanner(world, '2026-10-31'); const reopened = p31.drawings()[0]
  assert.equal(reopened.galleryItemId, id, 'the link was persisted inside the block')
  p31.setDraw({ insertAt: 0, editingBlock: reopened, editingCell: undefined }); p31.handleDrawSave(PNG('A2'), '[1,2]'); p31.handleDrawSave(PNG('A3'), '[1,2,3]')
  assert.equal(world.gallery().length, 2); assert.equal(itemById(world, id).dataUri, PNG('A3')); assert.equal(itemById(world, 'draw-orig').dataUri, PNG('ORIG'))
})

// ── the original keeps updating only its own entry ───────────────────────────────────────────────────────────
test('the ORIGINAL (legacy, no link yet) updates only its own entry — and adopts the exact link', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  const dup = p30.drawings().find(b => b.id !== 'mm-orig'); await p30.transferImage('move', dup.id, '2026-10-31')
  const p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined }); p31.handleDrawSave(PNG('COPY1'), '[c]')
  const copyEntry = world.gallery().find(i => i.id !== 'draw-orig')
  // edit the original
  const q30 = mountPlanner(world, '2026-10-30'); q30.setDraw({ insertAt: 0, editingBlock: q30.drawings()[0], editingCell: undefined })
  q30.handleDrawSave(PNG('ORIG2'), '[o2]')
  assert.equal(world.gallery().length, 2); assert.equal(itemById(world, 'draw-orig').dataUri, PNG('ORIG2')); assert.equal(itemById(world, copyEntry.id).dataUri, PNG('COPY1'), 'the copy’s entry untouched')
  assert.equal(q30.drawings()[0].galleryItemId, 'draw-orig', 'the original now carries the exact link')
})
test('identical pixels cannot confuse ownership: a copy saved UNCHANGED has the same image as the original, yet each save still updates only its own entry', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  const dup = p30.drawings().find(b => b.id !== 'mm-orig'); await p30.transferImage('move', dup.id, '2026-10-31')
  const p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined })
  p31.handleDrawSave(PNG('ORIG'), '[same-picture]')                      // saved without changing the picture: byte-identical to the original's
  const copyEntry = world.gallery().find(i => i.id !== 'draw-orig'); assert.equal(copyEntry.dataUri, PNG('ORIG'))
  const q30 = mountPlanner(world, '2026-10-30'); q30.setDraw({ insertAt: 0, editingBlock: q30.drawings()[0], editingCell: undefined })
  q30.handleDrawSave(PNG('ORIG-NEW'), '[o]')
  assert.equal(itemById(world, 'draw-orig').dataUri, PNG('ORIG-NEW'), 'the ORIGINAL’s entry moved on'); assert.equal(itemById(world, copyEntry.id).dataUri, PNG('ORIG'), 'the copy’s entry did not')
})

// ── Copy to Date / Move of a linked map ──────────────────────────────────────────────────────────────────────
test('Copy to Date of a Gallery-linked original: the copy does NOT inherit the link; its first save creates its own entry; the original’s entry is untouched', async () => {
  const { world } = seedOct30()
  let p30 = mountPlanner(world, '2026-10-30'); p30.setDraw({ insertAt: 0, editingBlock: p30.drawings()[0], editingCell: undefined })
  p30.handleDrawSave(PNG('ORIG2'), '[o2]'); p30.persist()                // the original is now explicitly linked to draw-orig
  assert.equal(p30.drawings()[0].galleryItemId, 'draw-orig')
  await p30.transferImage('copy', 'mm-orig', '2026-10-31')
  const copy = JSON.parse(world.store['2026-10-31'].notes).blocks.find(b => b.type === 'drawing')
  assert.ok(copy.id !== 'mm-orig' && copy.galleryItemId === undefined && copy.galleryExempt === true, 'no inherited link')
  assert.equal(world.gallery().length, 1, 'copying creates no entry by itself')
  const p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined }); p31.handleDrawSave(PNG('COPYX'), '[x]')
  assert.equal(world.gallery().length, 2); assert.equal(itemById(world, 'draw-orig').dataUri, PNG('ORIG2')); assert.notEqual(p31.drawings()[0].galleryItemId, 'draw-orig')
})
test('Move of a Gallery-linked Mind Map keeps ownership and updates the entry’s date label — no new entry, nothing deleted', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.setDraw({ insertAt: 0, editingBlock: p30.drawings()[0], editingCell: undefined }); p30.handleDrawSave(PNG('O2'), '[o2]'); p30.persist()
  await p30.transferImage('move', 'mm-orig', '2026-10-31')
  const g = world.gallery(); assert.equal(g.length, 1); assert.equal(g[0].id, 'draw-orig'); assert.equal(g[0].relatedDateLabel, 'Oct 31, 2026'); assert.equal(g[0].dataUri, PNG('O2')); assert.equal(g[0].title, 'Mind Map — Oct 30, 2026', 'title/creation untouched')
  assert.equal(g[0].createdAt, 500_005)
  const p31 = mountPlanner(world, '2026-10-31'); const moved = p31.drawings()[0]; assert.equal(moved.id, 'mm-orig'); assert.equal(moved.galleryItemId, 'draw-orig')
  p31.setDraw({ insertAt: 0, editingBlock: moved, editingCell: undefined }); p31.handleDrawSave(PNG('O3'), '[o3]')
  assert.equal(world.gallery().length, 1); assert.equal(itemById(world, 'draw-orig').dataUri, PNG('O3'))
})
test('Move of a LEGACY original (no link yet) adopts the exact link on the way, so it stays attached', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30')
  await p30.transferImage('move', 'mm-orig', '2026-10-31')
  const moved = JSON.parse(world.store['2026-10-31'].notes).blocks.find(b => b.id === 'mm-orig')
  assert.equal(moved.galleryItemId, 'draw-orig'); assert.equal(world.gallery().length, 1); assert.equal(world.gallery()[0].relatedDateLabel, 'Oct 31, 2026')
})
test('Move of a duplicate that has no entry yet changes nothing in the Gallery', async () => {
  const { world } = seedOct30(); const before = JSON.stringify(world.gallery())
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  await p30.transferImage('move', p30.drawings().find(b => b.id !== 'mm-orig').id, '2026-10-31')
  assert.equal(JSON.stringify(world.gallery()), before)
})

// ── independence, failures, brand-new maps ───────────────────────────────────────────────────────────────────
test('two copies on the same date are independent: each Gallery entry always matches its own block', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.setDraw({ insertAt: 0, editingBlock: p30.drawings()[0], editingCell: undefined }); p30.handleDrawSave(PNG('O2'), '[o2]'); p30.persist()
  await p30.transferImage('copy', 'mm-orig', '2026-10-31'); await p30.transferImage('copy', 'mm-orig', '2026-10-31')
  const p31 = mountPlanner(world, '2026-10-31'); const [a, b] = p31.drawings(); assert.notEqual(a.id, b.id)
  p31.setDraw({ insertAt: 0, editingBlock: a, editingCell: undefined }); p31.handleDrawSave(PNG('A-img'), '[a]')
  const p31b = mountPlanner(world, '2026-10-31'); const b2 = p31b.drawings().find(x => x.id === b.id)
  p31b.setDraw({ insertAt: 0, editingBlock: b2, editingCell: undefined }); p31b.handleDrawSave(PNG('B-img'), '[b]')
  const g = world.gallery(); assert.equal(g.length, 3)
  const fin = mountPlanner(world, '2026-10-31').drawings()
  for (const blk of fin) assert.equal(itemById(world, blk.galleryItemId).dataUri, blk.src)
  assert.notEqual(fin[0].galleryItemId, fin[1].galleryItemId)
})
test('a Gallery write FAILURE on a copy’s first save never loses Planner content; once the store recovers, repeated saves create exactly ONE entry', async () => {
  const { world } = seedOct30()
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  await p30.transferImage('move', p30.drawings().find(b => b.id !== 'mm-orig').id, '2026-10-31')
  const p31 = mountPlanner(world, '2026-10-31'); p31.setDraw({ insertAt: 0, editingBlock: p31.drawings()[0], editingCell: undefined })
  world.ls.failGallery = true; const err = console.error; console.error = () => {}
  try { p31.handleDrawSave(PNG('F1'), '[f1]') } finally { console.error = err }
  assert.equal(p31.drawings()[0].src, PNG('F1'), 'the Planner save itself succeeded'); assert.equal(world.gallery().length, 1)
  assert.equal(p31.drawings()[0].galleryItemId, undefined); assert.equal(p31.drawings()[0].galleryExempt, true, 'still marked as needing its entry')
  world.ls.failGallery = false
  for (const k of ['F2', 'F3', 'F4']) p31.handleDrawSave(PNG(k), `["${k}"]`)
  assert.equal(world.gallery().length, 2, 'exactly one new entry'); assert.equal(itemById(world, p31.drawings()[0].galleryItemId).dataUri, PNG('F4'))
})
test('a brand-new Mind Map records its own Gallery link on its first save; if that write fails it is retried exactly once later', () => {
  const world = makeWorld(); world.store['2026-10-30'] = { notes: serializeJournalDoc({ v: 1, blocks: [{ id: 'sec1', type: 'section', content: '{}' }] }) }
  const p = mountPlanner(world, '2026-10-30'); p.setDraw({ insertAt: 0, editingBlock: null, editingCell: undefined })
  p.handleDrawSave(PNG('N1'), '[n1]')
  assert.equal(world.gallery().length, 1); assert.equal(p.drawings()[0].galleryItemId, world.gallery()[0].id); assert.equal(world.gallery()[0].relatedDateLabel, 'Oct 30, 2026')
  p.handleDrawSave(PNG('N2'), '[n2]'); assert.equal(world.gallery().length, 1); assert.equal(world.gallery()[0].dataUri, PNG('N2'))
  // failure variant
  const w2 = makeWorld(); w2.store['2026-10-30'] = world.store['2026-10-30']; w2.ls.failGallery = true
  const p2 = mountPlanner(w2, '2026-10-30'); p2.setDraw({ insertAt: 0, editingBlock: null, editingCell: undefined })
  const err = console.error; console.error = () => {}; try { p2.handleDrawSave(PNG('M1'), '[m1]') } finally { console.error = err }
  assert.equal(w2.gallery().length, 0); assert.equal(p2.drawings()[0].galleryExempt, true)
  w2.ls.failGallery = false; p2.handleDrawSave(PNG('M2'), '[m2]'); p2.handleDrawSave(PNG('M3'), '[m3]')
  assert.equal(w2.gallery().length, 1); assert.equal(w2.gallery()[0].dataUri, PNG('M3'))
})
test('an owned entry that no longer exists on this device is never re-created (no duplicates, no errors) — the Planner save still works', () => {
  const world = makeWorld(); const blk = { id: 'b1', type: 'drawing', src: PNG('X'), thumbnail: PNG('X'), name: 'Mind Map', canvasData: '[]', createdAt: 1, updatedAt: 1, galleryItemId: 'draw-gone' }
  world.store['2026-10-30'] = { notes: serializeJournalDoc({ v: 1, blocks: [blk] }) }
  const p = mountPlanner(world, '2026-10-30'); p.setDraw({ insertAt: 0, editingBlock: blk, editingCell: undefined })
  p.handleDrawSave(PNG('Y'), '[y]')
  assert.equal(world.gallery().length, 0); assert.equal(p.drawings()[0].src, PNG('Y')); assert.equal(p.drawings()[0].galleryItemId, 'draw-gone')
})
test('nothing in the Gallery is ever deleted or merged by any of these operations', async () => {
  const { world } = seedOct30(); const ids = () => world.gallery().map(i => i.id)
  const p30 = mountPlanner(world, '2026-10-30'); p30.duplicateImageBlock('mm-orig'); p30.persist()
  await p30.transferImage('move', p30.drawings().find(b => b.id !== 'mm-orig').id, '2026-10-31'); await p30.transferImage('copy', 'mm-orig', '2026-10-31'); await p30.transferImage('move', 'mm-orig', '2026-10-31')
  assert.ok(ids().includes('draw-orig'))
})

// ── contracts ────────────────────────────────────────────────────────────────────────────────────────────────
test('contracts: ownership field, exact-id updates, tiered legacy matcher, copies never inherit a link; v1.319/v1.320 behaviour intact', () => {
  const types = read('components/xpadite/types.ts')
  assert.ok(/galleryItemId\?: string/.test(types) && /galleryExempt\?: boolean/.test(types))
  assert.ok(/export function updateGalleryDrawingById\(id: string, patch: \{ dataUri\?: string; relatedDateLabel\?: string \}\)/.test(galleryFile))
  assert.ok(/const byTime = typeof drawingCreatedAt === 'number' \? items\.find\(i => Math\.abs\(i\.createdAt - drawingCreatedAt\) <= 5000\)/.test(galleryFile) && /const byImage = previousDataUri \? items\.find/.test(galleryFile), 'time first, exact image only as a fallback')
  assert.ok(/galleryExempt: true, galleryItemId: undefined \}, idx\)/.test(planner), 'Duplicate clears the link')
  assert.ok(/galleryExempt: true, galleryItemId: undefined \}/.test(planner.slice(planner.indexOf('async function transferImage'))), 'Copy to Date clears the link')
  assert.ok(/\} else if \(existing\.galleryExempt\) \{\s*const item = newGalleryItem\(\)/.test(planner), 'a duplicate/copy’s first save creates its OWN entry')
  assert.ok(/if \(galleryItemId\) \{\s*try \{ updateGalleryDrawingById\(galleryItemId, \{ dataUri: dataUrl \}\)/.test(planner), 'owned → exact-id update')
  assert.ok(/const existing = drawSessionBlockRef\.current \?\? drawState\.editingBlock/.test(planner) && /drawSessionBlockRef\.current = savedBlock/.test(planner), 'Ctrl+S / rapid-save fix intact')
  assert.ok(/exportFramedPng/.test(read('components/xpadite/JournalDrawModal.tsx')), 'v1.319 framing intact')
  assert.ok(/<TransferSectionModal\s+kind="image"/.test(planner), 'v1.320 Move Image intact')
})
