// Task Manager history persistence: the day sync queue (components/xpadite/daySync.ts) — the real module, no mocks of it.
// Covers failed writes keeping edits, retry, ordering of a move, async ordering of rapid edits, and confirm-before-success.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-daysync'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'daySync.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, 'components/xpadite/daySync.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const { DaySyncQueue } = require(path.join(OUT, 'daySync.js'))

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

// An in-memory "Supabase" whose behaviour the test controls.
function server({ failFirst = 0, latency = 0 } = {}) {
  const rows = {}, log = []
  let toFail = failFirst
  return {
    rows, log,
    failNext(n) { toFail = n },
    write: async (key, data) => {
      log.push(['start', key, JSON.stringify(data)])
      if (latency) await tick(latency)
      if (toFail > 0) { toFail--; log.push(['fail', key]); throw new Error('network') }
      rows[key] = JSON.parse(JSON.stringify(data)); log.push(['ok', key])
    },
  }
}
const mk = (srv, extra = {}) => new DaySyncQueue({ write: srv.write, debounceMs: 5, retryDelaysMs: [10, 10, 10], ...extra })

test('a successful edit is written once, then no longer unsynced', async () => {
  const s = server(), q = mk(s)
  q.schedule('2026-10-26', { v: 1 })
  assert.equal(q.hasUnsynced('2026-10-26'), true, 'unsynced from the moment of the edit')
  assert.equal(await q.flush('2026-10-26'), true)
  assert.deepEqual(s.rows['2026-10-26'], { v: 1 }); assert.equal(q.hasUnsynced('2026-10-26'), false)
})

test('FAILED write: the edit is kept, flagged unsynced (so a load cannot overwrite it), reported once, and retried until it lands', async () => {
  const s = server({ failFirst: 2 }); const errors = []; let recovered = 0
  const q = mk(s, { onError: (k) => errors.push(k), onRecovered: () => { recovered++ } })
  q.schedule('d', { hist: 'edited' })
  assert.equal(await q.flush('d'), false, 'Save must NOT report success when the server rejected it')
  assert.equal(q.hasUnsynced('d'), true); assert.deepEqual(s.rows.d, undefined)
  await tick(80)                                   // background retries
  assert.deepEqual(s.rows.d, { hist: 'edited' }); assert.equal(q.hasUnsynced('d'), false)
  assert.equal(errors.length, 1, 'one notification per outage, not one per retry'); assert.equal(recovered, 1)
})

test('rapid consecutive edits: the LAST value wins, and an older in-flight write cannot clear or overwrite a newer edit', async () => {
  const s = server({ latency: 20 }), q = mk(s)
  q.schedule('d', { n: 1 })
  const first = q.flush('d')                       // v1 now in flight
  await tick(5)
  q.schedule('d', { n: 2 }); q.schedule('d', { n: 3 })
  assert.equal(await first, true)
  assert.deepEqual(s.rows.d, { n: 3 }, 'final server state is the newest edit'); assert.equal(q.hasUnsynced('d'), false)
  const order = s.log.filter(l => l[0] === 'ok').length; assert.ok(order >= 2, 'the newer edit was written after the in-flight one')
})

test('debounce coalesces a burst into one write of the latest value', async () => {
  const s = server(), q = mk(s)
  for (let i = 1; i <= 10; i++) q.schedule('d', { i })
  await tick(40)
  assert.equal(s.log.filter(l => l[0] === 'start').length, 1); assert.deepEqual(s.rows.d, { i: 10 })
})

test('MOVE yesterday→today: the origin removal is never sent before the destination is confirmed', async () => {
  const s = server(); const q = mk(s)
  q.schedule('origin', { tasks: ['edited-log'] })                 // user edited yesterday earlier (origin already dirty)
  q.schedule('dest', { tasks: ['moved'] })                        // move: destination first …
  q.schedule('origin', { tasks: [] }, { after: ['dest'] })        // … origin removal depends on it
  assert.equal(await q.flush('origin'), true)
  const oks = s.log.filter(l => l[0] === 'ok').map(l => l[1])
  assert.deepEqual(oks, ['dest', 'origin'])
  assert.deepEqual(s.rows.dest, { tasks: ['moved'] }); assert.deepEqual(s.rows.origin, { tasks: [] })
})

test('MOVE with a failing destination write: the origin write is HELD, so the task still exists on the server (no loss)', async () => {
  const s = server(); const q = mk(s)
  q.schedule('origin', { tasks: ['T'] }); await q.flush('origin') // origin previously synced (has T)
  s.failNext(1)                                                    // destination's first attempt fails
  q.schedule('dest', { tasks: ['T'] }); q.schedule('origin', { tasks: [] }, { after: ['dest'] })
  assert.equal(await q.flush('origin'), false)
  assert.deepEqual(s.rows.origin, { tasks: ['T'] }, 'origin on the server still has the task')
  assert.equal(q.hasUnsynced('origin'), true); assert.equal(q.hasUnsynced('dest'), true)
  await tick(80)                                                   // retry succeeds → dest first, then origin
  assert.deepEqual(s.rows.dest, { tasks: ['T'] }); assert.deepEqual(s.rows.origin, { tasks: [] })
})

test('moving back and forth never deadlocks (dependency cycles are broken)', async () => {
  const s = server(), q = mk(s)
  q.schedule('a', { x: 1 }); q.schedule('b', { x: 2 })
  q.schedule('a', { x: 3 }, { after: ['b'] }); q.schedule('b', { x: 4 }, { after: ['a'] })
  assert.equal(await q.flushAll(), true); assert.deepEqual([s.rows.a, s.rows.b], [{ x: 3 }, { x: 4 }])
})

test('flushAll (page hide / reconnect) writes everything and reports honestly', async () => {
  const s = server(), q = mk(s)
  q.schedule('a', 1); q.schedule('b', 2)
  assert.equal(await q.flushAll(), true); assert.deepEqual([s.rows.a, s.rows.b], [1, 2])
  s.failNext(1); q.schedule('c', 3); assert.equal(await q.flushAll(), false); assert.equal(q.hasUnsynced('c'), true)
})

test('unsynced-set changes are reported so a refresh can resume them', async () => {
  const s = server(), seen = [], q = mk(s, { onUnsyncedChange: k => seen.push(k) })
  q.schedule('a', 1); await q.flush('a')
  assert.deepEqual(seen, [['a'], []])
})
