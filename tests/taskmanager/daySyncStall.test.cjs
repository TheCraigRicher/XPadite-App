// v1.338 — a save request that never answers must not block the day sync queue forever (the real module, no mocks of it).
// Before: one hung write left `flight` pending for ever, so the same day's newer edits were never sent, flushAll() never resolved and
// anything ordered after it (a move's origin day) waited behind it. Now an attempt is bounded, aborted, and retried like any failure.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-daysync-stall'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'daySync.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, 'components/xpadite/daySync.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const { DaySyncQueue, DaySyncParked, DaySyncTimeout } = require(path.join(OUT, 'daySync.js'))
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const K = '2026-11-12'
const mk = (write, extra = {}) => new DaySyncQueue({ write, debounceMs: 5, retryDelaysMs: [15, 15, 15], attemptTimeoutMs: 60, ...extra })
const clone = o => JSON.parse(JSON.stringify(o))

test('a request that never answers is abandoned after the attempt timeout: flush resolves false, the data is kept, the request is aborted', async () => {
  const signals = []
  const q = mk((k, d, signal) => { signals.push(signal); return new Promise(() => {}) }, { retryDelaysMs: [10000] })
  q.schedule(K, { v: 1 })
  const t0 = Date.now(); const ok = await q.flush(K)
  assert.equal(ok, false); assert.ok(Date.now() - t0 < 1000, 'did not hang')
  assert.equal(q.hasUnsynced(K), true, 'nothing was dropped: still queued')
  assert.deepEqual(q.peek(K), { v: 1 })
  assert.equal(signals[0].aborted, true, 'the hung request itself was cancelled, so it can not land late')
  q.dispose()
})

test('after a hung attempt the queue recovers by itself: the next attempt writes the NEWEST data and confirms it', async () => {
  const rows = {}; let n = 0
  const q = mk(async (k, d) => { n++; if (n === 1) await new Promise(() => {}); rows[k] = clone(d) })
  q.schedule(K, { v: 1 })
  assert.equal(await q.flush(K), false)
  q.schedule(K, { v: 2 })                                    // the user keeps editing while the first attempt was stuck
  for (let i = 0; i < 100 && q.hasUnsynced(K); i++) await tick(20)   // debounce + back-off retry
  assert.deepEqual(rows[K], { v: 2 }); assert.equal(q.hasUnsynced(K), false)
  assert.equal(n, 2, 'one abandoned attempt, one successful')
})

test('an edit made DURING a stuck attempt is not lost: it is written once the stuck attempt is given up', async () => {
  const rows = {}; let n = 0
  const q = mk(async (k, d) => { n++; if (n === 1) await new Promise(() => {}); rows[k] = clone(d) })
  q.schedule(K, { v: 1 }); const first = q.flush(K)
  await tick(10); q.schedule(K, { v: 'newer' })              // while attempt #1 is in flight (and silent)
  assert.equal(await first, false)
  for (let i = 0; i < 100 && q.hasUnsynced(K); i++) await tick(20)
  assert.deepEqual(rows[K], { v: 'newer' }, 'the newest edit won, nothing older overwrote it')
})

test('ordering is preserved: a move\'s origin day still waits for its destination, and neither is lost when the destination hangs', async () => {
  const order = [], rows = {}; let destHangs = true
  const q = mk(async (k, d) => { if (k === 'dest' && destHangs) { destHangs = false; await new Promise(() => {}) } order.push(k); rows[k] = clone(d) })
  q.schedule('dest', { tasks: ['t'] })
  q.schedule('origin', { tasks: [] }, { after: ['dest'] })   // a move: origin may only be written after dest is confirmed
  await q.flushAll()                                          // the first destination attempt times out; whoever retries first goes through
  for (let i = 0; i < 100 && (q.hasUnsynced('dest') || q.hasUnsynced('origin')); i++) await tick(20)
  // the invariant that makes a move safe: the origin write is only ever sent AFTER the destination write landed (the hung attempt wrote nothing)
  assert.equal(order[0], 'dest', 'the destination landed first'); assert.equal(order.filter(k => k === 'dest').length, 1)
  assert.ok(order.every((k, i) => i === 0 || k === 'origin'), 'every later write is the origin (a repeat of the same write is harmless)')
  assert.deepEqual(rows.dest, { tasks: ['t'] }); assert.deepEqual(rows.origin, { tasks: [] })
  assert.equal(q.hasUnsynced('dest') || q.hasUnsynced('origin'), false)
})

test('a stuck day does not block a DIFFERENT day', async () => {
  const rows = {}
  const q = mk(async (k, d) => { if (k === 'stuck') await new Promise(() => {}); rows[k] = clone(d) }, { attemptTimeoutMs: 2000 })
  q.schedule('stuck', { a: 1 }); q.schedule('other', { b: 2 })
  assert.equal(await q.flush('other'), true); assert.deepEqual(rows.other, { b: 2 })
  q.dispose()
})

test('a write that answers late after being abandoned can not mark a newer edit as confirmed', async () => {
  const rows = {}; let n = 0, release
  const q = mk(async (k, d) => {
    n++
    if (n === 1) { await new Promise(r => { release = r }); rows[k] = clone(d); return }   // ignores the abort, answers late with OLD data
    rows[k] = clone(d)
  })
  q.schedule(K, { v: 'old' })
  assert.equal(await q.flush(K), false)                       // abandoned
  q.schedule(K, { v: 'new' })
  release()                                                   // the abandoned request now "answers"
  for (let i = 0; i < 100 && q.hasUnsynced(K); i++) await tick(20)
  assert.deepEqual(rows[K], { v: 'new' }, 'the retry wrote the newest data after the late answer')
  assert.equal(q.hasUnsynced(K), false)
})

test('the user is told once per outage (onError), and a recovered queue says so', async () => {
  const errors = []; let recovered = 0; let n = 0
  const q = mk(async () => { n++; if (n <= 2) await new Promise(() => {}) }, { onError: (k, e) => errors.push(e), onRecovered: () => recovered++ })
  q.schedule(K, { v: 1 })
  for (let i = 0; i < 150 && q.hasUnsynced(K); i++) await tick(20)
  assert.equal(errors.length, 1, 'first failure of the outage only'); assert.ok(errors[0] instanceof DaySyncTimeout)
  assert.equal(recovered, 1); assert.equal(q.hasUnsynced(K), false)
})

test('the merge-conflict path is unchanged: a parked day is kept and never retried, and no timer is left behind', async () => {
  let n = 0
  const q = mk(async () => { n++; throw new DaySyncParked() })
  q.schedule(K, { v: 1 })
  assert.equal(await q.flush(K), false); await tick(120)
  assert.equal(n, 1, 'not retried'); assert.equal(q.isParked(K), true); assert.equal(q.hasUnsynced(K), true)
})

test('a fast, healthy write is unaffected (no spurious timeout, no leaked timer)', async () => {
  const rows = {}; const q = mk(async (k, d) => { rows[k] = clone(d) }, { attemptTimeoutMs: 40 })
  q.schedule(K, { v: 1 }); assert.equal(await q.flush(K), true); await tick(80)
  assert.deepEqual(rows[K], { v: 1 }); assert.equal(q.hasUnsynced(K), false)
})

test('the writer passes the abort signal down to the actual requests (source pin)', () => {
  const ctx = fs.readFileSync(path.join(ROOT, 'components/xpadite/AppContext.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const core = fs.readFileSync(path.join(ROOT, 'lib/supabase/core-data.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(ctx, /write: \(key, data, signal\) => writeDayRef\.current\(key, data, signal\)/)
  assert.match(ctx, /saveDayCas\(sb, key, mine, base\?\.rev \?\? null, signal\)/)
  assert.equal((ctx.match(/upsertDayData\(sb, uid, key, (data|mine), signal\)/g) || []).length, 2)
  assert.match(core, /signal \? call\.abortSignal\(signal\) : call/)
  assert.equal((core.match(/abortSignal\(signal\)/g) || []).length, 2, 'both write paths (CAS rpc and plain upsert)')
  const q = fs.readFileSync(path.join(ROOT, 'components/xpadite/daySync.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(q, /attemptTimeoutMs: 30000/)
})
