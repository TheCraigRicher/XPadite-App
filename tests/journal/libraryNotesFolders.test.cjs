// v1.330 — Library Notes & Folders, extra same-day documents, Planner header menu.
// Part A runs the real pure module (journalDocs.ts). Part B runs the real migrations on PGlite (skipped — never "passed" — when PGlite is not installed:
// npm i --no-save @electric-sql/pglite, or set PGLITE_DIR). Part C checks the wiring in the real source files.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-lnf-v1330'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
fs.writeFileSync(path.join(OUT, 'journalDocs.js'), ts.transpileModule(read('components/xpadite/journalDocs.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const D = require(path.join(OUT, 'journalDocs.js'))

const para = t => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const tip = (...ts_) => JSON.stringify({ type: 'doc', content: ts_.map(para) })
const sec = (id, text, o = {}) => ({ id, type: 'section', sectionColor: 'lavender', content: text ? tip(text) : '', createdAt: 1, updatedAt: 1, ...o })
const docRaw = (blocks, o = {}) => JSON.stringify({ v: 1, blocks, ...o })
const parse = raw => JSON.parse(raw)
const sectionLike = raw => parse(raw).blocks.filter(b => b.type === 'section' || b.type === 'text')

// ═════ A1. starter notes ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('starter notes: exactly Ideas, Plans, My Daily Journal — real documents (not display items), unique ids, listed in that order, one section each', () => {
  const n = D.buildStarterNotes('2026-11-09', 1_700_000_000_000)
  assert.deepEqual(n.map(x => parse(x.raw).title), ['Ideas', 'Plans', 'My Daily Journal'])
  assert.deepEqual(D.STARTER_NOTE_TITLES, ['Ideas', 'Plans', 'My Daily Journal'])
  assert.equal(new Set(n.map(x => x.id)).size, 3, 'unique ids')
  assert.deepEqual(D.sortDocs([...n].reverse()).map(x => x.id), n.map(x => x.id), 'same creation instant still sorts in the intended order')
  for (const x of n) { assert.equal(x.kind, 'note'); assert.equal(x.dateKey, '2026-11-09'); assert.equal(sectionLike(x.raw).length, 1); assert.equal(sectionLike(x.raw)[0].type, 'section') }
  assert.notDeepEqual(D.buildStarterNotes('2026-11-09').map(x => x.id), n.map(x => x.id), 'a second call never reuses ids')
})

// ═════ A2. the one-section rule ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('Notes: the rule — no section / text block may be inserted, images and Mind Maps may; regular documents are unrestricted', () => {
  assert.equal(D.canAddSection('note'), false); assert.equal(D.canAddSection('doc'), true); assert.equal(D.canAddSection('day'), true)
  for (const t of ['section', 'text']) { assert.equal(D.canInsertBlock('note', { type: t }), false, t); assert.equal(D.canInsertBlock('doc', { type: t }), true); assert.equal(D.canInsertBlock('day', { type: t }), true) }
  for (const t of ['image', 'drawing']) assert.equal(D.canInsertBlock('note', { type: t }), true, t)
})

test('Notes: normalizeNoteRaw keeps EXACTLY one section, never loses text or images, and leaves a valid note byte-for-byte unchanged', () => {
  const valid = docRaw([sec('a', 'hello')], { title: 'T' })
  assert.equal(D.normalizeNoteRaw(valid), valid, 'valid note untouched')
  const withMedia = docRaw([sec('a', 'hello'), { id: 'i', type: 'image', src: 'data:x', createdAt: 1, updatedAt: 1 }])
  assert.equal(D.normalizeNoteRaw(withMedia), withMedia, 'a note with an image is still valid')
  const bad = docRaw([sec('a', 'one'), sec('b', 'two'), { id: 'x', type: 'text', content: tip('three'), createdAt: 1, updatedAt: 1 }, sec('c', '')], { title: 'T', folderId: 'f1', labelIds: ['L'] })
  const fixed = D.normalizeNoteRaw(bad)
  assert.equal(sectionLike(fixed).length, 1, 'collapsed to one')
  const txt = JSON.stringify(parse(fixed).blocks[0].content)
  for (const w of ['one', 'two', 'three']) assert.ok(txt.includes(w), `text "${w}" survived`)
  assert.ok(txt.indexOf('one') < txt.indexOf('two') && txt.indexOf('two') < txt.indexOf('three'), 'order kept')
  assert.equal(parse(fixed).title, 'T'); assert.equal(parse(fixed).folderId, 'f1'); assert.deepEqual(parse(fixed).labelIds, ['L'])
  assert.equal(D.normalizeNoteRaw(fixed), fixed, 'idempotent')
  // an extra section holding an image cell: the image becomes an ordinary image block (not lost)
  const cell = docRaw([sec('a', 'x'), sec('b', '', { sectionImage: { kind: 'image', src: 'data:img', name: 'p' } })])
  const f2 = parse(D.normalizeNoteRaw(cell)); assert.equal(f2.blocks.filter(b => b.type === 'section').length, 1); assert.ok(f2.blocks.some(b => b.type === 'image' && b.src === 'data:img'))
  // a document with no section at all gets one
  assert.equal(sectionLike(D.normalizeNoteRaw(docRaw([{ id: 'i', type: 'image', src: 's', createdAt: 1, updatedAt: 1 }]))).length, 1)
})

// ═════ A3. regular documents (several per day), folders, labels ════════════════════════════════════════════════════════════════════════════
const dayRaw = docRaw([sec('d', 'My day')], { title: 'Day doc' })
const legacyTiptap = tip('Legacy planner text')
test('several documents on ONE date are separate Library entries with unique keys; the day\'s own document is untouched; notes are kind "note"', () => {
  const extras = [
    { id: 'e1', kind: 'doc', dateKey: '2026-11-09', raw: docRaw([sec('a', 'Second doc')], { title: 'Second' }), rev: 1, createdAt: 2000 },
    { id: 'e2', kind: 'doc', dateKey: '2026-11-09', raw: docRaw([sec('a', 'Third doc')]), rev: 1, createdAt: 3000 },
    { id: 'n1', kind: 'note', dateKey: '2026-11-09', raw: docRaw([sec('a', '')], { title: 'Ideas' }), rev: 1, createdAt: 1000 },
  ]
  const entries = D.buildLibraryEntries({ '2026-11-09': dayRaw, '2026-11-08': '', '2026-11-07': legacyTiptap, '2026-11-06': undefined }, extras, [])
  assert.equal(entries.length, 5, 'empty / missing days are not documents')
  assert.equal(new Set(entries.map(e => e.key)).size, 5, 'unique keys')
  assert.deepEqual(entries.filter(e => e.docDate === '2026-11-09' && e.kind === 'doc').map(e => e.key).sort(), ['2026-11-09', 'x:e1', 'x:e2'])
  assert.equal(entries.find(e => e.key === '2026-11-09').source, 'day'); assert.equal(entries.find(e => e.key === 'x:e1').source, 'extra')
  assert.equal(entries.find(e => e.key === 'x:n1').kind, 'note')
  assert.equal(entries.find(e => e.key === '2026-11-07').title, 'Legacy planner text', 'a legacy Tiptap-only day still lists, titled from its first line')
  assert.equal(entries.find(e => e.key === 'x:e2').title, 'Third doc', 'untitled → first line')
  assert.equal(entries.find(e => e.key === 'x:n1').dateKey, 'x:n1', 'dateKey === key so every existing Library handler works on it')
  assert.deepEqual([D.isExtraKey('x:e1'), D.isExtraKey('2026-11-09'), D.extraIdOf('x:e1'), D.extraIdOf('2026-11-09')], [true, false, 'e1', null])
})

test('folders: moving sets ONE field — content blocks are byte-identical, nothing is duplicated, moving twice is a no-op, clearing un-files', () => {
  const raw = docRaw([sec('a', 'keep me'), { id: 'i', type: 'image', src: 'data:img', createdAt: 1, updatedAt: 1 }], { title: 'Doc', labelIds: ['L1'] })
  const moved = D.withFolder(raw, 'f1')
  assert.deepEqual(parse(moved).blocks, parse(raw).blocks, 'blocks untouched')
  assert.equal(parse(moved).folderId, 'f1'); assert.deepEqual(parse(moved).labelIds, ['L1'], 'labels are a separate mechanism and survive')
  assert.equal(D.withFolder(moved, 'f1'), moved, 'idempotent')
  assert.equal(D.getDocFolderId(moved), 'f1'); assert.equal(D.getDocFolderId(D.withFolder(moved, null)), null)
  assert.ok(!('folderId' in parse(D.withFolder(moved, null))))
  assert.equal(D.getDocFolderId('not json'), null)
})

test('folders: counts, contents, and SAFE deletion — deleting a folder un-files its documents, it never deletes one', () => {
  const folders = [{ id: 'f1', name: 'Marketing' }, { id: 'f2', name: 'Planning' }]
  const extras = [
    { id: 'n1', kind: 'note', dateKey: '2026-11-09', raw: D.withFolder(docRaw([sec('a', 'N')], { title: 'Ideas' }), 'f1'), rev: 1, createdAt: 1 },
    { id: 'e1', kind: 'doc', dateKey: '2026-11-09', raw: D.withFolder(docRaw([sec('a', 'E')]), 'f1'), rev: 1, createdAt: 2 },
  ]
  const cal = { '2026-11-09': D.withFolder(dayRaw, 'f1'), '2026-11-08': docRaw([sec('a', 'loose')]) }
  const entries = D.buildLibraryEntries(cal, extras, folders)
  assert.equal(D.folderItemCounts(entries).get('f1'), 3, 'a folder holds Notes AND regular documents'); assert.equal(D.folderItemCounts(entries).get('f2') ?? 0, 0)
  assert.deepEqual(D.entriesInFolder(entries, 'f1').map(e => e.key).sort(), ['2026-11-09', 'x:e1', 'x:n1'])
  const toUnfile = D.docsToUnfile(entries, 'f1'); assert.equal(toUnfile.length, 3)
  // after "deleting" f1: the folder is gone from the list → the same documents still exist, now read as unfiled
  const after = D.buildLibraryEntries(cal, extras, folders.filter(f => f.id !== 'f1'))
  assert.equal(after.length, entries.length, 'no document disappeared')
  assert.ok(after.every(e => e.folderId === null), 'orphaned folder ids read as unfiled even if the un-filing write never arrived')
})

test('labels are independent of folders; the autosave fix: the editor\'s serializer never carries labelIds/folderId, mergeDocMeta re-attaches them', () => {
  const stored = docRaw([sec('a', 'old')], { title: 'T', labelIds: ['L1', 'L2'], folderId: 'f1' })
  const editorSave = docRaw([sec('a', 'NEW TEXT')], { title: 'T' })                       // exactly what buildDocStr writes: no organisation fields
  const merged = parse(D.mergeDocMeta(editorSave, stored))
  assert.deepEqual(merged.labelIds, ['L1', 'L2']); assert.equal(merged.folderId, 'f1'); assert.equal(JSON.stringify(merged.blocks[0].content).includes('NEW TEXT'), true, 'the editor\'s content wins')
  // the Library un-filed / un-labelled it meanwhile (stored has no such keys): a stale editor copy must not resurrect them
  const stale = docRaw([sec('a', 'x')], { labelIds: ['L1'], folderId: 'f1' })
  const m2 = parse(D.mergeDocMeta(stale, docRaw([sec('a', 'x')])))
  assert.ok(!('folderId' in m2) && !('labelIds' in m2))
  assert.equal(D.mergeDocMeta(editorSave, editorSave), editorSave, 'nothing to merge → same string')
  assert.equal(D.mergeDocMeta('plain', stored), 'plain'); assert.equal(D.mergeDocMeta(editorSave, null), editorSave); assert.equal(D.mergeDocMeta(editorSave, legacyTiptap), editorSave)
})

// ═════ A4. cross-device ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const X = (id, raw, rev, createdAt = 1) => ({ id, kind: 'note', dateKey: '2026-11-09', raw, rev, createdAt })
test('cross-device hydrate: the server is the truth, an UNSYNCED local edit is never overwritten, deleted-elsewhere docs vanish unless they hold unsynced work', () => {
  const local = [X('a', 'LOCAL-A', 1), X('b', 'LOCAL-B', 1), X('c', 'LOCAL-C', 1)]
  const server = [X('a', 'SERVER-A', 2), X('b', 'SERVER-B', 3), X('d', 'SERVER-D', 1, 5)]
  const out = D.mergeServerDocs(local, server, new Set(['a', 'c']))
  const by = Object.fromEntries(out.map(d => [d.id, d]))
  assert.equal(by.a.raw, 'LOCAL-A', 'unsynced local edit kept'); assert.equal(by.a.rev, 2, '…but based on the server\'s current revision')
  assert.equal(by.b.raw, 'SERVER-B', 'synced doc adopts the server\'s newer text'); assert.equal(by.d.raw, 'SERVER-D', 'new from another device appears')
  assert.equal(by.c.raw, 'LOCAL-C', 'deleted elsewhere but holds unsynced work → kept, never silently destroyed')
  assert.equal(D.mergeServerDocs([X('z', 'Z', 1)], [], new Set()).length, 0, 'deleted elsewhere + nothing unsynced → gone')
  assert.deepEqual(out.map(d => d.id), D.sortDocs(out).map(d => d.id), 'stable order')
})

test('concurrent edits: a lost race becomes an independent "(conflict copy)" — new id, same kind/date/folder, content kept, never merged or overwritten', () => {
  const mine = { id: 'a', kind: 'doc', dateKey: '2026-11-09', raw: D.withFolder(docRaw([sec('s', 'my words')], { title: 'Plan' }), 'f1'), rev: 4, createdAt: 10 }
  const c = D.conflictCopy(mine, 99)
  assert.notEqual(c.id, 'a'); assert.equal(c.rev, null); assert.equal(c.kind, 'doc'); assert.equal(c.dateKey, '2026-11-09'); assert.equal(c.createdAt, 99)
  assert.equal(parse(c.raw).title, 'Plan (conflict copy)'); assert.equal(parse(c.raw).folderId, 'f1'); assert.deepEqual(parse(c.raw).blocks, parse(mine.raw).blocks)
  assert.equal(parse(D.conflictCopy({ ...mine, raw: docRaw([sec('s', 'Only text')]) }).raw).title, 'Only text (conflict copy)')
})

// ═════ B. real PostgreSQL — migration 025 ═════════════════════════════════════════════════════════════════════════════════════════════════
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) { if (!p) continue; try { PGlite = require(p).PGlite; break } catch {} }
const SKIP = PGlite ? false : 'PGlite not installed — SQL tests skipped, NOT passed'
const mig = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let db
async function boot(upTo025 = true) {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${A}'), ('${B}');
    grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`)
  await d.exec(/create or replace function public\.handle_updated_at\(\)[\s\S]*?\$\$;/.exec(mig('002_reminders.sql'))[0])
  for (const f of ['004_core_data_tables.sql', '010_journal_library_organization.sql', '011_journal_folder_color.sql']) await d.exec(mig(f))
  if (upTo025) await d.exec(mig('025_journal_documents.sql'))
  return d
}
const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`); try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`) } }
const q = (sql, params) => db.query(sql, params)
const save = (id, kind, date, content, exp) => q('select public.journal_doc_save($1,$2,$3,$4,$5) r', [id, kind, date, content, exp]).then(r => r.rows[0].r)
const seed = (docs, date = '2026-11-09') => q('select public.journal_seed_starter_notes($1::jsonb,$2) r', [JSON.stringify(docs), date]).then(r => r.rows[0].r)
const starter = () => D.buildStarterNotes('2026-11-09').map(d => ({ doc_id: d.id, content: d.raw }))
const docs = async uid => (await q('select doc_id, kind, content, rev from journal_documents where user_id = $1 order by created_at, doc_id', [uid])).rows

test('SQL: starter notes are created EXACTLY ONCE per account — a second device / reload / login adds nothing; accounts are independent', { skip: SKIP }, async () => {
  db = await boot()
  const first = await as(A, () => seed(starter())); assert.deepEqual(first, { seeded: true })
  assert.equal((await docs(A)).length, 3)
  assert.deepEqual((await docs(A)).map(d => JSON.parse(d.content).title).sort(), ['Ideas', 'My Daily Journal', 'Plans'])
  for (let i = 0; i < 3; i++) assert.deepEqual(await as(A, () => seed(starter())), { seeded: false }, `repeat #${i + 1}`)
  assert.equal((await docs(A)).length, 3, 'still exactly 3 — no duplicates')
  assert.equal((await q('select count(*)::int n from journal_library_state where user_id = $1', [A])).rows[0].n, 1)
  assert.deepEqual(await as(B, () => seed(starter())), { seeded: true }); assert.equal((await docs(B)).length, 3); assert.equal((await docs(A)).length, 3)
})

test('SQL: a RENAMED or DELETED starter note is never recreated; the marker can not be cleared or edited from a client', { skip: SKIP }, async () => {
  const mine = await docs(A)
  const ideas = mine.find(d => JSON.parse(d.content).title === 'Ideas'), plans = mine.find(d => JSON.parse(d.content).title === 'Plans')
  const renamed = JSON.stringify({ ...JSON.parse(ideas.content), title: 'My own name' })
  assert.equal((await as(A, () => save(ideas.doc_id, 'note', '2026-11-09', renamed, ideas.rev))).ok, true)
  await as(A, () => q('delete from journal_documents where doc_id = $1', [plans.doc_id]))
  assert.deepEqual(await as(A, () => seed(starter())), { seeded: false })
  const now = await docs(A); assert.equal(now.length, 2, 'the deleted one stays deleted')
  assert.ok(now.some(d => JSON.parse(d.content).title === 'My own name') && !now.some(d => JSON.parse(d.content).title === 'Plans'))
  // delete everything: still nothing comes back
  await as(A, () => q('delete from journal_documents'))
  assert.deepEqual(await as(A, () => seed(starter())), { seeded: false }); assert.equal((await docs(A)).length, 0)
  // the marker is untouchable from a client (no update / delete policy)
  await assert.rejects(as(A, () => q('delete from journal_library_state')), /permission denied/i)
  await assert.rejects(as(A, () => q(`update journal_library_state set starter_notes_seeded_at = now() - interval '1 year'`)), /permission denied/i)
  assert.deepEqual(await as(A, () => seed(starter())), { seeded: false })
})

test('SQL: SEVERAL documents on the same date coexist (no per-day uniqueness), and the day\'s own calendar document is not touched', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate journal_documents')
  await q(`insert into calendar_days (user_id, date_key, day_data) values ('${A}', '2026-11-09', '{"notes":"DAY DOC","tasks":[]}')`)
  const before = (await q(`select day_data from calendar_days where user_id = '${A}'`)).rows[0]
  await as(A, () => save('d1', 'doc', '2026-11-09', '{"v":1,"blocks":[]}', null)); await as(A, () => save('d2', 'doc', '2026-11-09', '{"v":1,"blocks":[]}', null)); await as(A, () => save('d3', 'note', '2026-11-09', '{"v":1,"blocks":[]}', null))
  assert.equal((await docs(A)).length, 3)
  const after = (await q(`select day_data from calendar_days where user_id = '${A}'`)).rows[0]
  assert.deepEqual(after, before, 'calendar_days row unchanged'); assert.equal((await q(`select count(*)::int n from calendar_days where user_id = '${A}'`)).rows[0].n, 1)
})

test('SQL: compare-and-swap — a stale device is refused and told the current text; nothing is overwritten; the revision is the SERVER\'s', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate journal_documents')
  const w1 = await as(A, () => save('c1', 'doc', '2026-11-09', 'v1', null)); assert.deepEqual(w1, { ok: true, rev: 1 })
  const w2 = await as(A, () => save('c1', 'doc', '2026-11-09', 'v2', 1)); assert.deepEqual(w2, { ok: true, rev: 2 })
  const stale = await as(A, () => save('c1', 'doc', '2026-11-09', 'STALE', 1)); assert.deepEqual(stale, { ok: false, rev: 2, content: 'v2' })
  assert.equal((await docs(A))[0].content, 'v2', 'the stale write changed nothing')
  assert.deepEqual(await as(A, () => save('c1', 'doc', '2026-11-09', 'x', null)), { ok: false, rev: 2, content: 'v2' }, '"I believe it is new" on an existing row is refused too')
  assert.deepEqual(await as(A, () => save('gone', 'doc', '2026-11-09', 'x', 3)), { ok: false, rev: 0, content: null }, 'deleted elsewhere → the caller is told, nothing is created behind its back')
  assert.equal((await docs(A)).length, 1)
  await as(A, () => q(`update journal_documents set rev = 99, doc_id = 'hijack' where doc_id = 'c1'`))
  const r = (await docs(A))[0]; assert.equal(r.doc_id, 'c1', 'identity can not be rewritten'); assert.equal(r.rev, 2, 'a client-supplied revision is ignored')
  await as(A, () => q(`update journal_documents set content = 'v2' where doc_id = 'c1'`)); assert.equal((await docs(A))[0].rev, 2, 'a no-change update keeps the revision')
  await as(A, () => q(`update journal_documents set content = 'v3' where doc_id = 'c1'`)); assert.equal((await docs(A))[0].rev, 3)
})

test('SQL: RLS and user isolation — B can not read, change, delete, take over or write rows for A; the same doc_id is per-user', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate journal_documents; truncate journal_library_state')
  await as(A, () => save('shared-id', 'doc', '2026-11-09', 'A SECRET', null)); await as(A, () => seed(starter()))
  assert.equal(await as(B, async () => Number((await q('select count(*)::int n from journal_documents')).rows[0].n)), 0, 'B sees nothing')
  assert.equal((await as(B, () => q(`update journal_documents set content = 'HACK'`))).affectedRows, 0)
  assert.equal((await as(B, () => q(`delete from journal_documents`))).affectedRows, 0)
  await assert.rejects(as(B, () => q(`insert into journal_documents (user_id, doc_id, kind, date_key, content) values ('${A}', 'planted', 'doc', '2026-11-09', 'x')`)), /row-level security/i, 'B can not insert as A')
  await assert.rejects(as(B, () => q(`insert into journal_library_state (user_id) values ('${A}')`)), /row-level security|duplicate/i, 'B can not touch A\'s marker')
  assert.equal(await as(B, async () => Number((await q('select count(*)::int n from journal_library_state')).rows[0].n)), 0)
  const bw = await as(B, () => save('shared-id', 'doc', '2026-11-09', 'B OWN', null)); assert.deepEqual(bw, { ok: true, rev: 1 }, 'same doc_id → B gets its OWN row')
  assert.equal((await docs(A)).find(d => d.doc_id === 'shared-id').content, 'A SECRET'); assert.equal((await docs(B)).find(d => d.doc_id === 'shared-id').content, 'B OWN')
})

test('SQL: not signed in / anon / bad input are refused; the functions are SECURITY INVOKER and not callable by anon or PUBLIC', { skip: SKIP }, async () => {
  await db.exec('reset role')
  await db.exec('set role authenticated')
  await assert.rejects(() => db.query(`select public.journal_doc_save('a','doc','2026-11-09','x',null)`), /not_authenticated/)
  await db.exec('reset role; set role anon')
  await assert.rejects(() => db.query(`select public.journal_doc_save('a','doc','2026-11-09','x',null)`), /permission denied/i)
  await assert.rejects(() => db.query(`select * from journal_documents`), /permission denied/i)
  await db.exec('reset role')
  const sd = await q(`select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('journal_doc_save','journal_seed_starter_notes')`)
  assert.equal(sd.rows.length, 2); assert.ok(sd.rows.every(r => r.prosecdef === false), 'SECURITY INVOKER')
  for (const bad of [[`'x'`, `'bogus'`, `'2026-11-09'`], [`'x'`, `'doc'`, `'11/09/2026'`], [`''`, `'doc'`, `'2026-11-09'`]]) await assert.rejects(as(A, () => db.query(`select public.journal_doc_save(${bad[0]}, ${bad[1]}, ${bad[2]}, 'x', null)`)), /bad_(id|kind|key)/)
  await assert.rejects(as(A, () => db.query(`select public.journal_seed_starter_notes('[1,2,3,4]'::jsonb, '2026-11-09')`)), /bad_docs/)
})

test('SQL: existing data compatibility — applying 025 (twice) leaves every existing table and row exactly as it was', { skip: SKIP }, async () => {
  db = await boot(false)
  await q(`insert into calendar_days (user_id, date_key, day_data) values ('${A}', '2026-09-01', '{"notes":"{\\"v\\":1,\\"blocks\\":[]}","tasks":[]}'), ('${A}', '2026-09-02', '{"notes":"legacy plain text","tasks":[]}')`)
  await q(`insert into journal_folders (user_id, folder_id, name, color) values ('${A}', 'f1', 'Marketing', '#7c3aed')`)
  await q(`insert into journal_labels (user_id, label_id, name, color) values ('${A}', 'l1', 'Goals', 'purple')`)
  const snap = async () => JSON.stringify({
    days: (await q('select date_key, day_data from calendar_days order by 1')).rows, folders: (await q('select folder_id, name, color, created_at from journal_folders order by 1')).rows,
    labels: (await q('select label_id, name, color from journal_labels order by 1')).rows,
    cols: (await q(`select table_name, column_name from information_schema.columns where table_schema='public' and table_name in ('calendar_days','journal_folders','journal_labels') order by 1,2`)).rows,
    pol: (await q(`select tablename, policyname from pg_policies where tablename in ('calendar_days','journal_folders','journal_labels') order by 1,2`)).rows,
  })
  const before = await snap()
  await db.exec(mig('025_journal_documents.sql')); await db.exec(mig('025_journal_documents.sql'))
  assert.equal(await snap(), before, 'idempotent and purely additive')
  assert.equal((await q(`select count(*)::int n from pg_policies where tablename = 'journal_documents'`)).rows[0].n, 4, 'select/insert/update/delete — own rows only')
})

test('SQL: paywall — with billing present, an expired/unpaid user can READ and DELETE but not create/edit/seed; a failed seed leaves NO marker behind (retried later, not lost)', { skip: SKIP }, async () => {
  db = await boot(); await db.exec('reset role')
  await db.exec(`create table if not exists paid_users (id uuid primary key);
    create or replace function public.billing_has_access(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from paid_users where id = p_user) $$;
    grant all on paid_users to authenticated; grant execute on function public.billing_has_access(uuid) to authenticated`)
  await db.exec(mig('025_journal_documents.sql'))                                    // re-run: it now sees billing_has_access and adds the policies
  assert.equal((await q("select count(*)::int c from pg_policies where tablename = 'journal_documents' and policyname like 'billing_paywall%'")).rows[0].c, 2)
  await db.exec(`insert into paid_users values ('${A}')`)
  assert.equal((await as(A, () => save('p1', 'doc', '2026-11-09', 'paid', null))).ok, true, 'paid user saves')
  await as(B, async () => { await assert.rejects(save('p2', 'doc', '2026-11-09', 'x', null), /row-level security|policy/) })
  await as(B, async () => { await assert.rejects(seed(starter()), /row-level security|policy/) })
  assert.equal((await q(`select count(*)::int n from journal_library_state where user_id = '${B}'`)).rows[0].n, 0, 'the failed seed rolled the marker back too')
  await db.exec('delete from paid_users')                                            // A's plan ends
  await as(A, async () => {
    assert.deepEqual(await save('p1', 'doc', '2026-11-09', 'edit after expiry', 1), { ok: false, rev: 0, content: null }, 'the expired user does not see the row for update — nothing is written and nothing is reported as saved')
    await assert.rejects(save('p1', 'doc', '2026-11-09', 'edit after expiry', null), /row-level security|policy/, 'the client follow-up re-create is refused LOUDLY (so the edit is kept on the device and retried)')
    assert.equal((await q('select content from journal_documents')).rows[0].content, 'paid', 'stored text unchanged')
    assert.equal((await q('select count(*)::int c from journal_documents')).rows[0].c, 1, 'can still read own data')
    assert.equal((await q('delete from journal_documents returning 1')).rows.length, 1, '…and delete it')
  })
  await db.exec(`insert into paid_users values ('${B}')`)
  assert.deepEqual(await as(B, () => seed(starter())), { seeded: true }, 'once paid, the SAME account gets its starter notes (nothing was lost by the earlier refusal)')
})

test('SQL: rollback and retry — the documented rollback runs cleanly, removes only 025 objects, and 025 can then be re-applied', { skip: SKIP }, async () => {
  db = await boot(); await db.exec('reset role')
  await q(`insert into calendar_days (user_id, date_key, day_data) values ('${A}', '2026-09-01', '{"notes":"keep"}')`)
  const m = mig('025_journal_documents.sql'); const rb = m.slice(m.indexOf('-- ─── ROLLBACK')).split(String.fromCharCode(10)).filter(l => /^--   (drop|alter)/.test(l)).map(l => l.replace(/^--   /, '').replace(/--.*$/, '')).join(String.fromCharCode(10))
  assert.ok(/drop function.*journal_seed_starter_notes/.test(rb) && /drop table.*journal_documents/.test(rb), 'rollback statements are present')
  await db.exec(rb)
  assert.equal((await q(`select count(*)::int n from information_schema.tables where table_name in ('journal_documents','journal_library_state')`)).rows[0].n, 0)
  assert.equal((await q(`select count(*)::int n from pg_proc where proname in ('journal_doc_save','journal_seed_starter_notes','journal_documents_bump_rev')`)).rows[0].n, 1, 'only the trigger function remains (it is harmless and unreferenced)')
  assert.equal((await q(`select day_data->>'notes' n from calendar_days where user_id = '${A}'`)).rows[0].n, 'keep', 'existing data untouched by rollback')
  assert.equal((await q(`select count(*)::int n from journal_folders`)).rows[0].n, 0); await db.exec(m)  // re-apply after rollback
  assert.deepEqual(await as(A, () => seed(starter())), { seeded: true })
  assert.equal((await docs(A)).length, 3)
})

test('SQL: retry safety — repeating the same save / seed / delete (a retry after a lost response) never duplicates or errors', { skip: SKIP }, async () => {
  db = await boot(); await db.exec('reset role')
  const a = await as(A, () => save('r1', 'note', '2026-11-09', 'same', null)); assert.deepEqual(a, { ok: true, rev: 1 })
  const again = await as(A, () => save('r1', 'note', '2026-11-09', 'same', null))                 // the retry of a create whose response was lost
  assert.deepEqual(again, { ok: false, rev: 1, content: 'same' }, 'the server answers with what it holds, so the client can recognise its own write')
  assert.equal((await docs(A)).length, 1)
  assert.deepEqual(await as(A, () => seed(starter())), { seeded: true }); assert.deepEqual(await as(A, () => seed(starter())), { seeded: false })
  await as(A, () => q(`delete from journal_documents where doc_id = 'r1'`)); await as(A, () => q(`delete from journal_documents where doc_id = 'r1'`))
  assert.equal((await docs(A)).length, 3)
})

test('SQL: HOSTED-LIKE database with NO default privileges (newer Supabase) — 025 grants exactly what is needed, so a signed-in user can use every feature and anon can do nothing', { skip: SKIP }, async () => {
  const d = new PGlite()                                                             // same roles, but NO "alter default privileges … grant all" (the hosted behaviour that broke the first hosted run)
  await d.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${A}'), ('${B}'); grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;`)
  await d.exec(mig('025_journal_documents.sql'))
  const as2 = async (uid, fn) => { await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`); try { return await fn() } finally { await d.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`) } }
  const q2 = (sql, p) => d.query(sql, p)
  assert.deepEqual(await as2(A, async () => (await q2('select public.journal_seed_starter_notes($1::jsonb,$2) r', [JSON.stringify(starter()), '2026-11-09'])).rows[0].r), { seeded: true })
  assert.deepEqual(await as2(A, async () => (await q2('select public.journal_seed_starter_notes($1::jsonb,$2) r', [JSON.stringify(starter()), '2026-11-09'])).rows[0].r), { seeded: false })
  assert.equal(await as2(A, async () => Number((await q2('select count(*)::int n from journal_documents')).rows[0].n)), 3)
  assert.equal((await as2(A, async () => (await q2(`select public.journal_doc_save('h1','doc','2026-11-09','x',null) r`)).rows[0].r)).ok, true)
  assert.equal((await as2(A, async () => await q2(`delete from journal_documents where doc_id = 'h1' returning 1`))).rows.length, 1)
  const priv = async (who, tbl, p) => (await q2('select has_table_privilege($1, $2, $3) v', [who, tbl, p])).rows[0].v
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(await priv('authenticated', 'journal_documents', p), true, p)
  for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) { assert.equal(await priv('authenticated', 'journal_documents', p), false, p); assert.equal(await priv('authenticated', 'journal_library_state', p), false, p) }
  for (const p of ['SELECT', 'INSERT']) assert.equal(await priv('authenticated', 'journal_library_state', p), true)
  for (const p of ['UPDATE', 'DELETE']) assert.equal(await priv('authenticated', 'journal_library_state', p), false, 'marker can not be changed or cleared')
  for (const t of ['journal_documents', 'journal_library_state']) for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(await priv('anon', t, p), false, `anon ${p} ${t}`)
  await d.exec(mig('025_journal_documents.sql'))                                     // re-applying (the corrective path for projects that already ran the older 025) is harmless
  assert.equal(await as2(A, async () => Number((await q2('select count(*)::int n from journal_documents')).rows[0].n)), 3)
})

// ═════ C. wiring in the real source ═══════════════════════════════════════════════════════════════════════════════════════════════════════
const ed = strip(read('components/xpadite/JournalEditorContent.tsx'))
const modal = strip(read('components/xpadite/JournalWorkspaceModal.tsx'))
const fnBody = (s, name) => { const i = s.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return s.slice(i, i + 700) }

test('editor: the one-section rule lives in the block LOGIC (insert / delete / duplicate / move / split), not only in the buttons', () => {
  assert.match(fnBody(ed, 'insertBlock'), /isNote && !canInsertBlock\('note', block\)\) return/)
  assert.match(fnBody(ed, 'deleteBlock'), /if \(isNote\) \{[^}]*t\.type === 'section'[^}]*\) return \}/)
  assert.match(fnBody(ed, 'duplicateBlock'), /if \(isNote\) return/)
  assert.match(fnBody(ed, 'transferSection'), /if \(isNote\) return/)
  assert.match(fnBody(ed, 'handleSplitSection'), /if \(isNote\) return/)
})

test('editor: in a Note the section controls stay VISIBLE but dimmed and inert (+ Section at both slots, Split, Duplicate, Move Section); Delete of the only section is withheld', () => {
  assert.equal((ed.match(/<SectionPicker isDark=\{isDark\} disabled=\{!canAddSection\(isNote \? 'note' : 'day'\)\}/g) ?? []).length, 2, 'mobile + desktop slot')
  assert.match(ed, /function SectionPicker\([^)]*disabled = false/); assert.match(ed, /function handleToggle\(\) \{\s*if \(disabled\) return/)
  for (const id of ['menu-split-section', 'menu-duplicate-section', 'menu-move-section']) assert.ok(new RegExp(`disabled=\\{noteLocked\\}[^>]*\\n?[^>]*data-testid="${id}"`).test(ed) || ed.includes(`data-testid="${id}"`), id)
  assert.match(ed, /noteLocked=\{isNote && block\.type === 'section'\}/)
  assert.match(ed, /onDelete=\{blocks\.length > 1 && !\(isNote && \(block\.type === 'section' \|\| block\.type === 'text'\)\)/)
  assert.match(ed, /opacity: 0\.38, cursor: 'not-allowed'/)
})

test('editor: writing, formatting, dictation, image insertion and autosave are NOT gated by isNote', () => {
  const uses = [...ed.matchAll(/isNote/g)].length
  assert.ok(uses > 0 && uses < 25, `isNote is referenced narrowly (${uses})`)
  for (const keep of ['handleUploadAtEnd', 'setCameraInsertAt', 'createDictation', 'scheduleSave', 'insertImageIntoSection']) assert.ok(ed.includes(keep), keep)
  assert.ok(!/isNote[^\n]*(scheduleSave|createDictation|handleUploadAtEnd)/.test(ed), 'no feature is switched off for notes')
})

test('Planner header: a top-left burger on every size with Mind Mapping, + Create New, + Create Note — and Mind Mapping LEFT the bottom toolbar', () => {
  const hm = strip(read('components/xpadite/PlannerHeaderMenu.tsx'))
  assert.match(hm, /data-testid="editor-burger"/); for (const id of ['mindmap', 'create-new', 'create-note']) assert.ok(hm.includes(`id: '${id}'`), id)
  assert.ok(ed.indexOf('<PlannerHeaderMenu') > 0 && ed.indexOf('<PlannerHeaderMenu') < ed.indexOf('← Calendar'), 'the burger is the first (left) header control')
  assert.ok(!/>🧠 Mind Map<\/button>/.test(ed), 'no Mind Map button remains in the dock')
  assert.match(ed, /onMindMap=\{\(\) => setDrawState\(\{ insertAt: blocks\.length - 1, editingBlock: null \}\)\}/, 'the SAME canvas state the old dock button set')
  assert.equal((ed.match(/<JournalDrawModal/g) ?? []).length, 2, 'the canvas is rendered exactly as in the previous release (same two mount points) - no new implementation')
  assert.ok(ed.includes('mindMapRequest') && ed.includes('clearMindMapRequest'), 'the main-menu Mind Mapping entry still works')
  assert.match(ed, /onCreateNew=\{\(\) => guardedNavigate\(\(\) => onCreateNew\?\.\(\)\)\}/); assert.match(ed, /onCreateNote=\{\(\) => guardedNavigate\(\(\) => onCreateNote\?\.\(\)\)\}/)
})

test('Create New / Create Note: independent documents (never an extra section), the current document is saved first, opened immediately', () => {
  const m = modal.slice(modal.indexOf('function createExtra('), modal.indexOf('function moveDocs('))
  assert.match(m, /journalDocs\.createDoc\(kind, kind === 'note' \? todayKey : editorDate\)/)
  assert.ok(!/insertBlock|updateBlock|appendBlock|notes:/.test(m), 'does not touch the current document or any day document')
  assert.match(m, /setActiveDocId\(d\.id\)[\s\S]*setView\('editor'\)/)
  assert.match(modal, /key=\{activeExtra \? activeExtra\.id : 'day'\}/, 'switching documents remounts the editor (no state bleed)')
  assert.match(modal, /const extraPersist = useMemo\(\(\) => \(activeExtraId \? persistExtra\(activeExtraId\) : null\), \[activeExtraId, persistExtra\]\)/, 'autosave is bound to ONE document id (a pending save of A can never land in B) and stays referentially stable')
  assert.match(ed, /function guardedNavigate/); assert.ok(ed.includes('showExitDialog'), 'the existing save/discard guard runs before switching')
})

test('Library: one top-right ⋮ menu = Notes, Folders, Delete Selected (the old Delete button moved in), Export kept; Notes/Folders open views, create nothing', () => {
  const i = modal.indexOf("data-testid=\"library-menu\""); const m = modal.slice(i, i + 1600)
  const order = ['notes', 'folders', 'delete', 'export'].map(k => m.indexOf(`id: '${k}'`)); assert.ok(order.every(n => n >= 0) && order.every((n, j) => j === 0 || n > order[j - 1]), 'order')
  assert.ok(m.includes("label: 'Delete Selected'") && m.includes('run: () => enterSelectMode()'))
  assert.match(m, /id: 'notes'[^\n]*setLibTab\('notes'\)/); assert.match(m, /id: 'folders'[^\n]*setLibTab\('folders'\)/)
  assert.ok(!/id: 'notes'[^\n]*createExtra|id: 'folders'[^\n]*createFolder/.test(m), 'opening a view never creates anything')
  assert.ok(!/🗑️ Delete<\/button>/.test(modal), 'the standalone Delete button is gone')
  assert.ok(modal.includes("libTab === 'notes' ?") && modal.includes('<NotesPane') && modal.includes('<FoldersPane'))
})

test('Library: Notes view has + Create Note, cards with rename/delete/move; Folders view has + Create Folder, safe delete, drag-drop AND Move-to-Folder', () => {
  const ui = strip(read('components/xpadite/LibraryNotesFolders.tsx'))
  for (const t of ['+ Create Note', '+ Create Folder', 'Rename', 'Delete', 'Move to Folder', 'Remove from folder', 'draggable', 'onDrop']) assert.ok(ui.includes(t), t)
  assert.match(ui, /not deleted/); assert.match(ui, /grid-template|gridTemplateColumns: 'repeat\(auto-fill, minmax\(/)
  assert.match(modal, /function deleteFolderSafely[\s\S]*?docsToUnfile\(allEntries, id\)[\s\S]*?removeJournalFolder\(id\)/, 'un-file first, then remove the folder')
  assert.ok(!/function deleteFolderSafely[\s\S]{0,400}deleteDocs|function deleteFolderSafely[\s\S]{0,400}notes: ''/.test(modal), 'a folder delete never deletes a document')
  assert.ok((modal.match(/onMoveToFolder=\{/g) ?? []).length === 4, 'Move to Folder on every Library view mode')
  assert.ok((modal.match(/\.\.\.\(isSelectMode \? \{\} : dragProps\(entry\.dateKey\)\)/g) ?? []).length === 4, 'drag on every Library view mode')
})

test('autosave integrity: both persist paths re-attach labels/folder; extra documents go through the CAS queue; notes are normalised on every save', () => {
  assert.match(modal, /notes: mergeDocMeta\(content, prev\.notes\)/)
  const hook = strip(read('components/xpadite/useJournalDocs.ts'))
  assert.match(hook, /updateRaw\(id, stored => mergeDocMeta\(raw, stored\)\)/); assert.match(hook, /if \(cur\.kind === 'note'\) next = normalizeNoteRaw\(next\)/)
  assert.match(hook, /saveJournalDocCas\(sb, data, cur\.rev\)/); assert.match(hook, /conflictCopy/); assert.match(hook, /new DaySyncQueue<ExtraDoc>/)
  assert.match(hook, /sentRef/); assert.match(hook, /includes\(res\.content\)[\s\S]*?if \(res\.content === data\.raw\) return[\s\S]*?continue/, 'a retry after a LOST response recognises its own earlier write — never a duplicate or a self "conflict copy"')
  assert.match(hook, /fetchJournalDocs[\s\S]*?status === 'error'[\s\S]*?return[\s\S]*?seedStarterNotes/, 'starter notes are requested only AFTER a successful server read')
  assert.ok(hook.includes("localStorage.removeItem(CACHE_KEY)"), 'another account\'s cache never lingers')
})

test('main menu: a Notes entry opens Planner Editor → Library → Notes (the same workspace — no separate Notes modal or editor); Planner/Journal and Mind Mapping untouched', () => {
  const sb = strip(read('components/xpadite/AppSidebar.tsx')); const app = strip(read('components/xpadite/XpaditeApp.tsx'))
  assert.match(sb, /label: 'Notes',\s+action: 'notes'/); assert.match(sb, /case 'notes':\s+onNotes\?\.\(\)/)
  assert.ok(sb.includes("label: 'Planner/Journal'") && sb.includes("action: 'journal-notes'") && sb.includes("action: 'mind-mapping'"))
  assert.match(app, /onNotes=\{\(\) => \{\s*setPlannerLibraryJump\('notes'\)/)
  assert.equal((app.match(/jumpToLibrary=\{plannerLibraryJump\}/g) ?? []).length, 2, 'mobile planner tab AND desktop/tablet overlay')
  assert.match(modal, /if \(\(jumpToLibrary \?\? null\) !== seenLibJump\) \{\s+setSeenLibJump\(jumpToLibrary \?\? null\)\s+if \(jumpToLibrary\) \{ setLibTab\('notes'\); setOpenFolderId\(null\); setView\('library'\) \}/)
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'components/xpadite')).filter(f => /notes/i.test(f)).sort(), ['JournalNotesModal.tsx', 'LibraryNotesFolders.tsx'], 'no new Notes modal/editor component')
  const ui = strip(read('components/xpadite/LibraryNotesFolders.tsx')); assert.ok(!/tiptap|useEditor|JournalEditorContent|contentEditable/i.test(ui), 'the Library views contain NO editor - notes open in the existing Planner editor')
})

test('folders hydrate: a cleared folder list propagates (the old "length > 0" rule kept a deleted last folder forever); a failed load keeps local data', () => {
  const ctx = strip(read('components/xpadite/AppContext.tsx'))
  assert.match(ctx, /if \(sbJournalFolders !== null\) \{\s*setJournalFoldersState\(sbJournalFolders\)/)
  assert.match(strip(read('lib/supabase/journal-docs.ts')), /if \(error \|\| !data\) return null/)
  assert.match(ctx, /updateJournalFolder = useCallback/); assert.ok(ctx.includes('journalDocs,'))
})
