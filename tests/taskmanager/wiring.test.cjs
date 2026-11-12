// Task Manager data-loss P0: proves the app code is actually wired to the durable sync queue and that the
// original defects (swallowed write errors, "success" before the server confirms, unordered move writes,
// stale-snapshot rollback, click-trapping closing overlay, stale queued navigation) cannot return.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const ctx = read('components/xpadite/AppContext.tsx')
const dm = read('components/xpadite/DayModal.tsx')
const tr = read('components/xpadite/TransferTaskModal.tsx')
const app = read('components/xpadite/XpaditeApp.tsx')

test('persistence: no fire-and-forget day upsert that only console.errors (the original silent-loss path)', () => {
  assert.ok(!/pendingDaySync(Timers|Data)Ref/.test(ctx), 'old debounce maps are gone')
  assert.ok(!/upsertDayData\(createClient\(\), uid, key, (dayData|updated)\)\.catch/.test(ctx), 'no swallow-and-forget upsert')
  assert.ok(/new DaySyncQueue<DayData>/.test(ctx) && /write: \(key, data, signal\) => writeDayRef\.current\(key, data, signal\)/.test(ctx) && /await saveDayCas\(sb, key, mine,/.test(ctx) && /await upsertDayData\(sb, uid, key, (data|mine), signal\)/.test(ctx), 'writes go through the queue and are awaited (v1.328: compare-and-swap; the plain upsert is only the fallback for a database without migration 024)')
})

test('hydration and realtime never overwrite a day whose latest edit is unconfirmed (pending, in flight OR failed)', () => {
  assert.ok(/if \(!daySync\.hasUnsynced\(key\)\) \{\s*merged\[key\] = dayData/.test(ctx), 'initial load')
  assert.ok(/if \(!daySync\.hasUnsynced\(dateKey\)\)/.test(ctx), 'realtime echo')
})

test('a refresh resumes unconfirmed days from the local copy (marker is per-account) instead of losing them', () => {
  assert.ok(/UNSYNCED_KEY = 'xp9d-unsynced'/.test(ctx))
  assert.ok(/marker\.uid === userId/.test(ctx) && /daySync\.schedule\(key, local\[key\]\)/.test(ctx), 'resume, only for the same account')
  assert.ok(/onUnsyncedChange: keys =>/.test(ctx))
  assert.ok(/addEventListener\('online'/.test(ctx) && /daySync\.retryNow\(\)/.test(ctx), 'retry on reconnect / foreground')
})

test('failed sync is surfaced to the user, and recovery is announced', () => {
  assert.ok(/onError: \(key, err\)[\s\S]{0,200}setToast\('⚠ Couldn’t save to the cloud/.test(ctx))
  assert.ok(/onRecovered: \(\) => setToast\('Changes synced ✓'\)/.test(ctx))
})

test('MOVE: destination is written first and the origin removal is ordered after it; duplicate ids are never re-added', () => {
  const move = tr.slice(tr.indexOf("// Always a true, lossless relocation"), tr.indexOf('setToast(isMultiple\n        ? `${tasks.length} tasks moved'))
  assert.ok(move.indexOf('updateDay(selectedKey') < move.indexOf('updateDay(dateKey'), 'destination first')
  assert.ok(/\{ after: \[selectedKey\] \}/.test(move), 'origin depends on destination')
  assert.ok(/!prev\.tasks\.some\(t => t\.id === a\.id\)/.test(move), 'idempotent destination add')
  assert.ok(/if \(mode === 'move'\) onTransferred\?\.\(\)/.test(tr))
})

test('MOVE then Cancel / Close Without Saving cannot roll the moved task back onto the origin day', () => {
  assert.ok(/onTransferred=\{\(\) => \{ rebaselineAfterMoveRef\.current = true \}\}/.test(dm))
  assert.ok(/rebaselineAfterMoveRef\.current = false\s*\n\s*openSnapshotRef\.current = JSON\.parse\(JSON\.stringify\(calData\[dateKey\] \?\? EMPTY_DAY\)\)/.test(dm))
  assert.ok(/dateKey, baselineTick\]\)/.test(dm), 'dirty state recomputed after re-baseline')
})

test('Save shows "Saved" only after the server confirmed it; a failure keeps the window open with the edits', () => {
  const s = dm.slice(dm.indexOf('const persistRef = useRef'), dm.indexOf('function handleOpenPlannerNotes'))
  assert.ok(/await Promise\.race\(\[flushDays\(\), slow\]\)/.test(s), 'still waits for the server to confirm (bounded)')
  assert.ok(/async function handleMainSave\(\) \{\s*if \(!\(await persistConfirmed\(\)\) \|\| !mountedRef\.current\) return\s*setMainSaving\(true\)/.test(s), 'Saved only after confirmation')
  assert.ok(/async function handleSaveAndClose\(\) \{\s*if \(!\(await persistConfirmed\(\)\) \|\| !mountedRef\.current\) return\s*setMainSaving\(true\)/.test(s), 'Save & Close does not close on failure')
  assert.ok(/if \(persistRef\.current\) return persistRef\.current/.test(s), 'a second click cannot start a second concurrent save: it joins the one in flight (v1.338; it used to be silently ignored)')
  assert.ok(/disabled=\{mainSaving \|\| saveBusy\}/.test(dm) && /'Saving…'/.test(dm))
})

test('closing: idempotent, never leaves a lingering layer, and self-heals if the parent did not unmount it', () => {
  assert.ok(/if \(closingRef\.current \|\| !mountedRef\.current\) return/.test(dm))
  // v1.338: the fading window absorbs taps (they used to fall through onto the calendar); it still cannot linger — see the self-heal
  assert.ok(!/pointerEvents: isClosing/.test(dm))
  assert.ok(/later\(\(\) => \{ closingRef\.current = false; setIsClosing\(false\) \}, 1500\)/.test(dm))
})

test('a queued "after close" navigation captured for another day is dropped when the user changes day', () => {
  const nav = app.slice(app.indexOf('onNavigateDay={delta'), app.indexOf('closeIntent={dayModalCloseIntent}'))
  assert.equal((nav.match(/pendingNavRef\.current = null/g) || []).length, 2, 'onNavigateDay and onGoToToday')
})

test('no destructive data operations were introduced in the day persistence path', () => {
  const q = read('components/xpadite/daySync.ts')
  assert.ok(!/createClient|@\/lib\/supabase|\.remove\(|truncate|drop table/i.test(q), 'the queue only calls the injected write()')
  assert.ok(!/\.delete\(|\.remove\(/.test(tr), 'Transfer never deletes via the database')
  assert.ok(!/localStorage\.removeItem\('xp9d'/.test(ctx))
})
