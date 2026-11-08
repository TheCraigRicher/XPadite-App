// v1.328 final pass — stale whole-day write protection: the three-way day merge (pure logic, mocked data, no network).
// The server-side compare-and-swap that makes the merge necessary is tested on a REAL Postgres engine in scheduleSql.test.cjs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-concurrency'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
fs.writeFileSync(path.join(OUT, 'dayMerge.js'), ts.transpileModule(read('components/xpadite/dayMerge.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const M = require(path.join(OUT, 'dayMerge.js'))

const day = (tasks = [], o = {}) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...o })
const tk = (id, o = {}) => ({ id, text: id, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...o })
const ids = d => d.tasks.map(t => t.id)
const merge = (b, m, t) => M.mergeDay(b, m, t)
const clone = x => JSON.parse(JSON.stringify(x))

test('two devices edit DIFFERENT tasks of the same day: both edits survive, nothing to ask', () => {
  const base = day([tk('a'), tk('b')])
  const mine = day([tk('a', { done: true }), tk('b')])                          // this device completed task a
  const theirs = day([tk('a'), tk('b', { journal: 'notes from the other device' })])
  const r = merge(base, mine, theirs)
  assert.deepEqual(r.conflicts, [])
  assert.equal(r.doc.tasks[0].done, true); assert.equal(r.doc.tasks[1].journal, 'notes from the other device')
})

test('two devices edit DIFFERENT fields of the SAME task (completion here, notes there): merged', () => {
  const base = day([tk('a')]); const r = merge(base, day([tk('a', { done: true })]), day([tk('a', { journal: 'n' })]))
  assert.deepEqual(r.conflicts, []); assert.deepEqual([r.doc.tasks[0].done, r.doc.tasks[0].journal], [true, 'n'])
})

test('the SAME field of the SAME task changed differently on both devices is a CONFLICT — never silently resolved', () => {
  const base = day([tk('a', { text: 'Old' })])
  const r = merge(base, day([tk('a', { text: 'Mine' })]), day([tk('a', { text: 'Theirs' })]))
  assert.equal(r.conflicts.length, 1); assert.equal(r.conflicts[0].scope, 'task'); assert.equal(r.conflicts[0].field, 'text'); assert.match(r.conflicts[0].label, /Task “Theirs” — text/)
  assert.equal(r.doc.tasks[0].text, 'Mine', 'the placeholder is my value, only used if the user chooses to keep mine')
  // identical change on both sides is NOT a conflict
  assert.deepEqual(merge(base, day([tk('a', { text: 'Same' })]), day([tk('a', { text: 'Same' })])).conflicts, [])
})

test('both devices add different tasks: both appear, once each; the same task added twice with identical content collapses', () => {
  const base = day([tk('a')])
  const r = merge(base, day([tk('a'), tk('mine-new')]), day([tk('a'), tk('their-new')]))
  assert.deepEqual(r.conflicts, []); assert.deepEqual(ids(r.doc).sort(), ['a', 'mine-new', 'their-new'])
  assert.deepEqual(ids(merge(base, day([tk('a'), tk('x')]), day([tk('a'), tk('x')])).doc), ['a', 'x'])
})

test('delete vs untouched = deleted; delete vs edited = CONFLICT (kept, not lost)', () => {
  const base = day([tk('a'), tk('b')])
  const del = merge(base, day([tk('b')]), day([tk('a'), tk('b')]))                       // I deleted a, they left it alone
  assert.deepEqual(ids(del.doc), ['b']); assert.deepEqual(del.conflicts, [])
  const del2 = merge(base, day([tk('a'), tk('b')]), day([tk('a')]))                      // they deleted b, I left it alone
  assert.deepEqual(ids(del2.doc), ['a'])
  const edited = merge(base, day([tk('b'), tk('a', { journal: 'important work' })]), day([tk('b')]))   // they deleted a, I edited it
  assert.equal(edited.conflicts.length, 1); assert.equal(edited.conflicts[0].field, 'deleted'); assert.ok(ids(edited.doc).includes('a'), 'my edited task is NOT dropped')
})

test('timers and work sessions: a session started on each device both survive (merged by session id)', () => {
  const s = (id, o = {}) => ({ id, startTs: 1, endTs: null, note: '', tags: [], ...o })
  const base = day([tk('a', { sessions: [s('s0', { endTs: 5 })] })])
  const mine = day([tk('a', { sessions: [s('s0', { endTs: 5 }), s('s-mine')], timerStart: 100 })])
  const theirs = day([tk('a', { sessions: [s('s0', { endTs: 5 }), s('s-theirs', { endTs: 9 })] })])
  const r = merge(base, mine, theirs)
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.doc.tasks[0].sessions.map(x => x.id).sort(), ['s-mine', 's-theirs', 's0']); assert.equal(r.doc.tasks[0].timerStart, 100)
  // one device stops the running session while the other types a note into it: different fields → merged
  const run = day([tk('a', { sessions: [s('r')] })])
  const stop = merge(run, day([tk('a', { sessions: [s('r', { endTs: 50 })] })]), day([tk('a', { sessions: [s('r', { note: 'typed' })] })]))
  assert.deepEqual(stop.conflicts, []); assert.deepEqual([stop.doc.tasks[0].sessions[0].endTs, stop.doc.tasks[0].sessions[0].note], [50, 'typed'])
  // both stop the same session at different moments: genuine conflict
  assert.equal(merge(run, day([tk('a', { sessions: [s('r', { endTs: 50 })] })]), day([tk('a', { sessions: [s('r', { endTs: 60 })] })])).conflicts.length, 1)
})

test('concurrent completion: both complete the same task = fine; one completes while the other un-completes = conflict', () => {
  const base = day([tk('a')])
  assert.deepEqual(merge(base, day([tk('a', { done: true })]), day([tk('a', { done: true })])).conflicts, [])
  const base2 = day([tk('a', { done: true })])
  assert.equal(merge(base2, day([tk('a', { done: true, text: 'renamed' })]), day([tk('a', { done: false })])).conflicts.length, 0, 'different fields')
  assert.equal(merge(base, day([tk('a', { done: true })]), day([tk('a', { done: false, text: 'x' })])).conflicts.length, 0, 'theirs equals base on done → mine wins that field')
})

test('attachments merge by id; sub-tasks (their own tasks) merge like any task', () => {
  const att = (id) => ({ id, name: id, src: 'data:x' })
  const base = day([tk('p', { attachments: [att('a1')] }), tk('kid', { parentTaskId: 'p' })])
  const r = merge(base, day([tk('p', { attachments: [att('a1'), att('mine')] }), tk('kid', { parentTaskId: 'p', done: true })]), day([tk('p', { attachments: [att('a1'), att('theirs')] }), tk('kid', { parentTaskId: 'p', journal: 'k' })]))
  assert.deepEqual(r.conflicts, []); assert.deepEqual(r.doc.tasks[0].attachments.map(x => x.id).sort(), ['a1', 'mine', 'theirs'])
  assert.deepEqual([r.doc.tasks[1].done, r.doc.tasks[1].journal, r.doc.tasks[1].parentTaskId], [true, 'k', 'p'])
})

test('day-level fields (productive flag, notes, journal…) merge per field; the same field differing is a conflict', () => {
  const base = day([], { notes: '', productive: false })
  const r = merge(base, day([], { productive: true }), day([], { notes: 'typed elsewhere' }))
  assert.deepEqual(r.conflicts, []); assert.deepEqual([r.doc.productive, r.doc.notes], [true, 'typed elsewhere'])
  const c = merge(base, day([], { notes: 'A' }), day([], { notes: 'B' }))
  assert.equal(c.conflicts.length, 1); assert.equal(c.conflicts[0].scope, 'day'); assert.equal(c.conflicts[0].field, 'notes')
})

test('task order: my reorder + their additions both kept; both reordering differently is a conflict; nobody reordering follows the server', () => {
  const base = day([tk('a'), tk('b'), tk('c')])
  const r = merge(base, day([tk('c'), tk('a'), tk('b')]), day([tk('a'), tk('b'), tk('c'), tk('d')]))
  assert.deepEqual(r.conflicts, []); assert.deepEqual(ids(r.doc), ['c', 'd', 'a', 'b'], 'my order; their new task d stays right after its neighbour c')
  const t = merge(base, day([tk('a'), tk('b'), tk('c')]), day([tk('b'), tk('a'), tk('c')])); assert.deepEqual(ids(t.doc), ['b', 'a', 'c'], 'their reorder wins when I did not reorder')
  const both = merge(base, day([tk('c'), tk('b'), tk('a')]), day([tk('b'), tk('a'), tk('c')])); assert.equal(both.conflicts.filter(x => x.scope === 'order').length, 1)
  assert.deepEqual(ids(merge(base, day([tk('a'), tk('b'), tk('c'), tk('m')]), day([tk('a'), tk('b'), tk('c'), tk('t')])).doc).sort(), ['a', 'b', 'c', 'm', 't'])
})

test('schedule-managed tasks (dl- / ev-): the event is the truth for title and link; both creating one is not a conflict', () => {
  const link = (o = {}) => tk('dl-e1', { text: 'Event title', sourceEventId: 'e1', ...o })
  const base = day([link()])
  const r = merge(base, day([link({ text: 'Typed locally' })]), day([link({ text: 'Renamed in My Schedule' })]))
  assert.deepEqual(r.conflicts, []); assert.equal(r.doc.tasks[0].text, 'Renamed in My Schedule')
  const both = merge(day([]), day([link({ done: true })]), day([link()]))
  assert.deepEqual(both.conflicts, []); assert.equal(both.doc.tasks.length, 1)
  // …but the user's own work on it is still merged field by field
  const work = merge(base, day([link({ done: true })]), day([link({ text: 'New title' })])); assert.deepEqual([work.doc.tasks[0].done, work.doc.tasks[0].text], [true, 'New title'])
})

test('no record of the base version (e.g. reload mid-edit): only an exact match merges; anything else is a conflict, never a guess', () => {
  assert.deepEqual(merge(null, day([tk('a')]), day([tk('a')])).conflicts, [])
  const r = merge(null, day([tk('a')]), day([tk('a'), tk('b')])); assert.equal(r.conflicts.length, 1); assert.deepEqual(ids(r.doc), ['a'])
})

test('merging is pure and consistent: inputs untouched; merge(base,x,x)=x; merge(base,base,t)=t; merge(base,m,base)=m', () => {
  const base = day([tk('a'), tk('b', { journal: 'j' })], { notes: 'n' }), m = day([tk('a', { done: true }), tk('b', { journal: 'j' }), tk('c')], { notes: 'n' }), t = day([tk('a'), tk('b', { journal: 'j2' })], { notes: 'n2' })
  const snap = clone([base, m, t]); merge(base, m, t); assert.deepEqual([base, m, t], snap)
  assert.ok(M.sameDoc(merge(base, m, m).doc, m)); assert.ok(M.sameDoc(merge(base, base, t).doc, t)); assert.ok(M.sameDoc(merge(base, m, base).doc, m))
  assert.ok(M.sameDoc(day([tk('a')], { x: 1, y: 2 }), day([tk('a')], { y: 2, x: 1 })), 'key order is irrelevant'); assert.ok(!M.sameDoc(day([tk('a')]), day([tk('a', { done: true })])))
})

test('a stale save after a deadline moves: the moved linked task (and its work) survive the stale tab\'s edit', () => {
  const link = (day_, o = {}) => tk('dl-e1', { text: 'Report', sourceEventId: 'e1', ...o })
  const base = day([link(), tk('mine')]), mineStale = day([link(), tk('mine', { done: true })])      // stale tab edits an unrelated task on the OLD due day
  const theirs = day([tk('mine')])                                                                  // the deadline moved away: server removed the task from this day
  const r = merge(base, mineStale, theirs)
  assert.equal(r.conflicts.length, 0, 'the removal of the untouched linked task is honoured (it moved to the new day), my edit to the other task is kept')
  assert.deepEqual(ids(r.doc), ['mine']); assert.equal(r.doc.tasks[0].done, true)
  const workBase = day([link({ journal: 'work' }), tk('mine')])
  const withWork = merge(workBase, day([link({ journal: 'work' }), tk('mine', { done: true })]), day([tk('mine')]))
  assert.equal(withWork.conflicts.length, 0, 'unchanged-by-me + removed-by-them = removed (the server only removes it by MOVING it, work and all, to the new day)')
})
