// v1.328 hardening: atomic linking ops, reconciliation, "removed from Task Manager" policy, title ownership, retry limits, time format.
// Logic tests run the real modules (mocked data, no network). The same op semantics are cross-checked against REAL Postgres in scheduleSql.test.cjs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-v328-hardening'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const compile = (f, out) => fs.writeFileSync(path.join(OUT, out + '.js'), ts.transpileModule(read(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('components/xpadite/scheduleLogic.ts', 'scheduleLogic'); compile('components/xpadite/deadlineLink.ts', 'deadlineLink')
const D = require(path.join(OUT, 'deadlineLink.js')); const L = require(path.join(OUT, 'scheduleLogic.js'))
const src = f => read(`components/xpadite/${f}`)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const day = (tasks = [], o = {}) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...o })
const tk = (id, o = {}) => ({ id, text: 'T', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...o })
const E = (id, o = {}) => ({ id, title: 'Report', endAt: at(2026, 11, 24, 17), isDeadline: true, taskDateKey: null, taskLink: 'linked', ...o })
const linked = (id, o = {}) => tk('dl-' + id, { text: 'Report', sourceEventId: id, ...o })
/** applies ops the way the server does, merging the changed days into the calendar */
const run = (cal, ops) => ({ ...cal, ...D.applyOpsLocal(cal, ops) })
const converge = (cal, events) => { const items = D.reconcileDeadlines(cal, events, 'a'); return { items, cal: run(cal, items.flatMap(i => i.ops)) } }

test('plan ops: created / updated / moved / removed / unlinked, and `changed` is false when nothing differs', () => {
  const none = D.planDeadlineSync({}, 'e1', E('e1'), null, 'a')
  assert.equal(none.outcome, 'created'); assert.deepEqual(none.ops.map(o => [o.kind, o.date_key, o.task_id]), [['upsert', '2026-11-24', 'dl-e1']])
  const cal = { '2026-11-24': day([linked('e1')]) }
  const same = D.planDeadlineSync(cal, 'e1', E('e1'), '2026-11-24', 'a'); assert.equal(same.outcome, 'updated'); assert.equal(same.changed, false)
  assert.equal(D.planDeadlineSync(cal, 'e1', E('e1', { title: 'New' }), '2026-11-24', 'a').changed, true)
  const mv = D.planDeadlineSync(cal, 'e1', E('e1', { endAt: at(2026, 11, 26, 9) }), '2026-11-24', 'a'); assert.deepEqual([mv.outcome, mv.ops[0].kind, mv.ops[0].from_key, mv.ops[0].date_key], ['moved', 'move', '2026-11-24', '2026-11-26'])
  assert.equal(D.planDeadlineSync(cal, 'e1', E('e1', { isDeadline: false }), '2026-11-24', 'a').ops[0].kind, 'remove')
  const worked = { '2026-11-24': day([linked('e1', { done: true })]) }
  assert.equal(D.planDeadlineSync(worked, 'e1', null, '2026-11-24', 'a').ops[0].kind, 'unlink')
})

test('the task is found wherever it really is (moved by a transfer, recorded day lost) — never recreated beside the real one', () => {
  const cal = { '2026-11-30': day([linked('e1', { journal: 'notes' })]) }                // user (or a bug) moved it to another day
  const plan = D.planDeadlineSync(cal, 'e1', E('e1'), '2026-11-24', 'a')
  assert.equal(plan.outcome, 'moved'); const after = run(cal, plan.ops)
  assert.equal(after['2026-11-30'].tasks.length, 0); assert.equal(after['2026-11-24'].tasks.length, 1); assert.equal(after['2026-11-24'].tasks[0].journal, 'notes')
})

test('duplicates (two devices, stale overwrite) collapse to one, keeping the copy that holds work', () => {
  const cal = { '2026-11-24': day([linked('e1')]), '2026-11-25': day([linked('e1', { done: true, journal: 'work' })]) }
  const { cal: fixed } = converge(cal, [E('e1')])
  const all = Object.values(fixed).flatMap(d => d.tasks).filter(t => t.id === 'dl-e1')
  assert.equal(all.length, 1, 'one task left')
  assert.deepEqual([all[0].sourceEventId, all[0].done, all[0].journal], ['e1', true, 'work'], 'the linked task is the one carrying the work')
  assert.equal(fixed['2026-11-24'].tasks.length, 1); assert.equal(fixed['2026-11-25'].tasks.length, 0, 'the empty copy is gone')
  // both copies hold work: nothing is destroyed (the extra is kept as an ordinary, unlinked task)
  const both = converge({ '2026-11-24': day([linked('e1', { journal: 'a' })]), '2026-11-25': day([linked('e1', { journal: 'b' })]) }, [E('e1')]).cal
  assert.equal(Object.values(both).flatMap(d => d.tasks).length, 2); assert.equal(Object.values(both).flatMap(d => d.tasks).filter(t => t.sourceEventId).length, 1)
})

test('"removed from Task Manager" (detached): never recreated, deadline unaffected, stray copy removed; restoring links again', () => {
  const ev = E('e1', { taskLink: 'detached' })
  assert.deepEqual(D.reconcileDeadlines({}, [ev], 'a'), [], 'no task is created for a detached deadline')
  assert.equal(D.planDeadlineSync({}, 'e1', ev, null, 'a', undefined, 'detached').taskDateKey, null)
  const stray = { '2026-11-24': day([linked('e1')]) }
  const { cal } = converge(stray, [ev]); assert.equal(cal['2026-11-24'].tasks.length, 0, 'an untouched stray (delete that never reached the server) is cleaned up')
  const strayWork = { '2026-11-24': day([linked('e1', { sessions: [{ id: 's' }] })]) }
  const r = converge(strayWork, [ev]).cal['2026-11-24'].tasks; assert.equal(r.length, 1); assert.equal(r[0].sourceEventId, undefined, 'work is kept, just unlinked')
  assert.equal(D.deadlineDayMap([{ ...ev, endAt: ev.endAt }]).hasOwnProperty('2026-11-24'), true, 'the Calendar marker is independent of the task')
  const restored = converge({}, [E('e1', { taskLink: 'linked' })]).cal; assert.equal(restored['2026-11-24'].tasks[0].id, 'dl-e1')
})

test('reconcile repairs: missing task, stale title, wrong day; leaves everything else byte-identical; second pass is empty (idempotent)', () => {
  const mine = tk('mine', { text: 'Report', journal: 'keep' }), other = tk('other')
  const cal = {
    '2026-11-24': day([mine, other], { productive: true, notes: 'n' }),                // e1: task missing here
    '2026-11-25': day([linked('e2', { text: 'Old title', done: true, journal: 'w' })]),  // e2: stale title (and finished)
    '2026-11-27': day([linked('e3')]),                                                   // e3: sits on the wrong day
  }
  const events = [E('e1'), E('e2', { title: 'Fresh', endAt: at(2026, 11, 25, 10) }), E('e3', { endAt: at(2026, 11, 29, 10) })]
  const r1 = converge(cal, events)
  assert.deepEqual(r1.items.map(i => [i.eventId, i.reason]).sort(), [['e1', 'created'], ['e2', 'updated'], ['e3', 'moved']])
  const f = r1.cal
  assert.deepEqual(f['2026-11-24'].tasks.filter(t => !t.id.startsWith('dl-')), [mine, other], 'same-titled / unrelated tasks untouched')
  assert.equal(f['2026-11-24'].productive, true); assert.equal(f['2026-11-24'].notes, 'n')
  assert.deepEqual([f['2026-11-25'].tasks[0].text, f['2026-11-25'].tasks[0].done, f['2026-11-25'].tasks[0].journal], ['Fresh', true, 'w'])
  assert.equal(f['2026-11-27'].tasks.length, 0); assert.equal(f['2026-11-29'].tasks[0].id, 'dl-e3')
  assert.deepEqual(D.reconcileDeadlines(f, events, 'a'), [], 'converged: nothing left to do')
})

test('reconcile: orphans (event deleted elsewhere) and un-designated events are removed — or kept unlinked when they hold work', () => {
  const cal = { '2026-11-24': day([linked('gone'), linked('worked', { done: true })]), '2026-11-25': day([linked('e9')]) }
  const events = [E('e9', { isDeadline: false })]
  const { items, cal: f } = converge(cal, events)
  assert.ok(items.some(i => i.reason === 'orphan') && items.some(i => i.eventId === 'e9'))
  const t = Object.values(f).flatMap(d => d.tasks)
  assert.ok(!t.some(x => x.id === 'dl-gone') && !t.some(x => x.id === 'dl-e9'))
  assert.equal(t.find(x => x.id === 'dl-worked').sourceEventId, undefined); assert.equal(t.find(x => x.id === 'dl-worked').done, true)
  assert.deepEqual(D.reconcileDeadlines(f, events, 'a'), [])
})

test('ordinary tasks are never touched or removed, even ones that look similar (same title, "dl-" like id without a link)', () => {
  const cal = { '2026-11-24': day([tk('dl-lookalike'), tk('x', { text: 'Report' }), tk('y', { sourceEventId: 'unknown-but-not-dl' })]) }
  const items = D.reconcileDeadlines(cal, [], 'a'); assert.deepEqual(items, [], 'no orphan ops for non-dl ids / unlinked tasks')
  assert.throws(() => D.applyOpsLocal(cal, [{ kind: 'remove', date_key: '2026-11-24', task_id: 'x' }]), /bad_op/, 'the op layer refuses non-deadline ids')
})

test('subtasks, notes, sessions, attachments and timers survive every op', () => {
  const rich = linked('e1', { done: false, journal: 'j', sessions: [{ id: 's', startTs: 1, endTs: 2 }], attachments: [{ id: 'a' }], noteDone: true, timerStart: 5 })
  const cal = { '2026-11-24': day([rich, tk('kid', { parentTaskId: 'dl-e1' })]) }
  const moved = run(cal, D.planDeadlineSync(cal, 'e1', E('e1', { title: 'N', endAt: at(2026, 11, 28, 9) }), '2026-11-24', 'a').ops)
  const t = moved['2026-11-28'].tasks[0]; assert.deepEqual([t.journal, t.sessions.length, t.attachments.length, t.noteDone, t.timerStart, t.text], ['j', 1, 1, true, 5, 'N'])
  const gone = run(cal, D.planDeadlineSync(cal, 'e1', null, '2026-11-24', 'a').ops)
  assert.equal(gone['2026-11-24'].tasks.length, 2, 'parent with a sub-task + all its data is kept (unlinked)'); assert.equal(gone['2026-11-24'].tasks[0].sourceEventId, undefined)
})

test('retry safety: batches respect the 6-op limit; opKeys lists both days of a move; ops are idempotent when replayed', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ eventId: 'e' + i, ops: [{ kind: 'upsert' }, { kind: 'remove' }, { kind: 'unlink' }], taskDateKey: null, reason: 'x' }))
  const b = D.batchItems(items); assert.deepEqual(b.map(x => x.reduce((n, i) => n + i.ops.length, 0)), [6, 6, 3]); assert.ok(b.every(x => x.reduce((n, i) => n + i.ops.length, 0) <= 6))
  assert.deepEqual(D.opKeys([{ kind: 'move', date_key: 'B', from_key: 'A' }, { kind: 'remove', date_key: 'A' }]).sort(), ['A', 'B'])
  const cal = { '2026-11-24': day([linked('e1', { done: true })]) }
  const ops = D.planDeadlineSync(cal, 'e1', E('e1', { endAt: at(2026, 11, 26, 9), title: 'X' }), '2026-11-24', 'a').ops
  const once = run(cal, ops), twice = run(once, ops)
  assert.deepEqual(twice['2026-11-26'], once['2026-11-26'], 'a retried request changes nothing more')
  assert.equal(Object.values(twice).flatMap(d => d.tasks).filter(t => t.id === 'dl-e1').length, 1)
})

test('Task Manager: deadline task title is owned by the event; deleting = remove from Task Manager (choice saved first); no move; popup offers the event', () => {
  const d = src('DayModal.tsx')
  assert.ok(/const startEdit = \(\) => \{\s*if \(task\.sourceEventId\)/.test(d) && /onEdit=\{\(\) => \{ startEdit\(\); setMenuOpen\(false\) \}\}/.test(d), 'rename is explained, not allowed')
  assert.ok(/data-testid="edit-in-schedule"/.test(d) && /requestScheduleEvent\(task\.sourceEventId as string\)/.test(d), 'popup navigates to the originating event')
  const del = d.slice(d.indexOf('async function detachLinked'), d.indexOf('function setTaskColor'))
  assert.ok(/detachDeadlineTask\(eid\)/.test(del) && del.indexOf('await detachLinked(idsToDelete)') < del.indexOf('updateDay(dateKey'), 'single delete: the choice is saved BEFORE the task disappears')
  assert.ok(/if \(!\(await detachLinked\(idsToDelete\)\)\) \{ setPendingDeleteId\(null\); return \}/.test(del), 'if it cannot be saved the task stays')
  assert.ok(/await detachLinked\(toDelete\)/.test(d), 'bulk delete uses the same policy')
  assert.ok(/\|\| !!t\.sourceEventId/.test(d) && /A deadline task stays on its due day/.test(d), 'Move Task is disabled for deadline tasks')
  assert.ok(!/isPriority: !t\.isPriority \|\| sourceEventId/.test(d))
})

test('time format: one shared (session-only) choice drives the popup, Event Details and the schedule; nothing claims persistence', () => {
  const d = src('DayModal.tsx'), a = src('AppContext.tsx'), m = src('MeetingsModal.tsx')
  assert.ok(/fmt=\{scheduleTimeFormat\}/.test(d) && /clockLabel\(dueAt, fmt\)/.test(d) && !/clockLabel\(dueAt, '12h'\)/.test(d))
  assert.ok(/useState<TimeFormat>\('12h'\)/.test(a) && /SESSION-ONLY/.test(a) && !/localStorage[^\n]*timefmt|time_format/i.test(strip(a)))
  assert.ok(/timeFormat: scheduleTimeFormat/.test(m) && /setScheduleTimeFormat\(p\.timeFormat\)/.test(m))
  const ts1 = at(2026, 11, 24, 17, 5)
  assert.equal(L.clockLabel(ts1, '12h'), '5:05 PM'); assert.equal(L.clockLabel(ts1, '24h'), '17:05'); assert.equal(L.clockLabel(at(2026, 11, 24, 0, 30), '24h'), '00:30'); assert.equal(L.clockLabel(at(2026, 11, 24, 0, 30), '12h'), '12:30 AM')
})

test('reconcile is bounded: 3 failed tries per event, no timers or loops, runs on load/changes/Retry only; a persistent failure is shown', () => {
  const a = strip(src('AppContext.tsx')); const rec = a.slice(a.indexOf('const reconcileAttemptsRef'), a.indexOf('const retryScheduleSync'))
  assert.ok(/< 3\)/.test(rec) && /attempts\.set\(it\.eventId, \(attempts\.get\(it\.eventId\) \?\? 0\) \+ 1\)/.test(rec), 'attempt cap')
  assert.ok(!/setInterval|setTimeout|while \(/.test(rec), 'no polling / retry loop')
  assert.ok(/setScheduleSyncIssue\(bad > 0/.test(rec) && /if \(force\) reconcileAttemptsRef\.current\.clear\(\)/.test(rec), 'surfaced, and Retry resets the counters')
  assert.ok(/\[scheduleStatus, calHydrated, scheduleEvents, scheduleTaskSync, reconcileSchedule\]/.test(a), 'triggers: after load, event changes, the sync switch (not on every calendar change)')
  assert.ok(/const exclusive = useCallback/.test(a) && /syncChainRef/.test(a), 'writes are serialised inside a tab')
  const m = src('MeetingsModal.tsx'); assert.ok(/data-testid="schedule-sync-issue"/.test(m) && /data-testid="schedule-sync-retry"/.test(m) && /role="alert"/.test(m))
})

test('a stale tab is refused (revision check) and told so; the form keeps its inputs', () => {
  const m = strip(src('MeetingsModal.tsx')), s = strip(read('lib/supabase/schedule-data.ts'))
  assert.ok(/XS409/.test(s) && /class ScheduleConflictError/.test(s) && /expectedRev: prev\?\.rev \?\? null/.test(strip(src('AppContext.tsx'))))
  assert.ok(/code === 'conflict'/.test(m) && /setSaveError\(saveFailureMessage\(err\)\)/.test(m))
})

test('migration 023: SECURITY INVOKER only, no anon/PUBLIC execute, deadline-task ids only, additive', () => {
  const sql = read('supabase/migrations/023_schedule_sync.sql').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
  assert.ok(!/security definer/i.test(sql), 'no SECURITY DEFINER in 023')
  assert.equal((sql.match(/security invoker/gi) || []).length, 2)
  assert.ok(/revoke all on function public\.schedule_apply[^;]*from public, anon/.test(sql) && /grant execute on function public\.schedule_apply[^;]*to authenticated/.test(sql))
  assert.ok(/tid not like 'dl-%'/.test(sql) && /uid uuid := auth\.uid\(\)/.test(sql) && !/p_user/.test(sql), 'the owner can only ever be auth.uid(); the caller can not name another user')
  assert.ok(!/drop table|drop column|truncate|delete from (?!schedule_events where user_id = uid)/i.test(sql))
})

test('a retried "add" re-sends the SAME event id (lost-response safe); restore and "Edit in My Schedule" are wired end to end', () => {
  const m = strip(src('MeetingsModal.tsx')), a = strip(src('AppContext.tsx')), x = strip(src('XpaditeApp.tsx'))
  assert.ok(/attemptRef = useRef/.test(m) && /attemptRef\.current\.formKey !== lastForm\?\.id/.test(m) && /attemptRef\.current = null/.test(m), 'one id per open form, cleared only after a confirmed save')
  assert.ok(/restoreTask: \(id: string\) =>/.test(m) && /restoreDeadlineTask\(id\)/.test(m))
  assert.ok(/await saveInner\(/.test(a.slice(a.indexOf('const restoreDeadlineTask'), a.indexOf('// ── Reconciliation'))), 'restoring goes through the same atomic save')
  assert.ok(/scheduleFocusRequest/.test(m) && /openEdit\(ev\)/.test(m) && /clearScheduleFocusRequest\(\)/.test(m))
  assert.ok(/scheduleFocusRequest/.test(x) && /setMeetingsOpen\(true\)/.test(x))
  const parts = src('ScheduleParts.tsx'); assert.ok(/data-testid="restore-task"/.test(parts) && /Not in your Task Manager/.test(parts) && /ev\.taskLink === 'detached'/.test(parts))
})

test('the old non-atomic helpers are gone from the data layer; every write is one RPC', () => {
  const s = strip(read('lib/supabase/schedule-data.ts'))
  assert.ok(!/export async function (upsertScheduleEvent|deleteScheduleEventRow)/.test(s))
  assert.equal((s.match(/\.rpc\(/g) || []).length, 3, 'schedule_apply, schedule_set_task_link, schedule_set_sync')
})
