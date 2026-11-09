// My Schedule v1.328: due-date pill, event → Calendar → Task Manager deadline linking, saved locations, persistence mapping,
// migration safety, calendar marker wiring. Logic tests run the real modules; wiring tests pin the structure.
// NOTE: nothing here talks to a live Supabase — the database layer is covered by pure row mapping + migration/RLS structure checks.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-v328'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const js = f => ts.transpileModule(read(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
const compile = (f, out) => fs.writeFileSync(path.join(OUT, out + '.js'), js(f))
compile('components/xpadite/scheduleLogic.ts', 'scheduleLogic')
compile('components/xpadite/deadlineLink.ts', 'deadlineLink')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const D = require(path.join(OUT, 'deadlineLink.js'))
// schedule-data imports the browser Supabase client and the '@/' alias: load it with stubs
const sd = { exports: {} }
new Function('require', 'module', 'exports', js('lib/supabase/schedule-data.ts'))(
  id => (id === '@/lib/supabase/client' ? { createClient: () => ({}) } : id === '@/components/xpadite/scheduleLogic' ? L : require(id)), sd, sd.exports)
const S = sd.exports
const src = f => read(`components/xpadite/${f}`)
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (over = {}) => ({ id: 'e1', title: 'Report', category: 'assignment', startAt: at(2026, 11, 9, 9), endAt: at(2026, 11, 9, 17), isDeadline: true, ...over })
/** applies a plan's ops to a calendar the way the server's schedule_apply does (parity-tested against the real SQL in scheduleSql.test.cjs) */
function apply(cal, plan) { return { ...cal, ...D.applyOpsLocal(cal, plan.ops) } }
const sync = (cal, e, prevKey) => { const plan = D.planDeadlineSync(cal, e.id, e, prevKey, 'act1'); return { plan, cal: apply(cal, plan) } }
const tasksOf = (cal, key) => (cal[key]?.tasks ?? [])

// ── Phase 2/3: form ─────────────────────────────────────────────────────────
test('phone: Date row, then Start | End side by side (own labels); tablet/desktop keep the Date | Start | End row', () => {
  const p = src('ScheduleParts.tsx')
  assert.ok(/className=\{phone \? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 min-\[420px\]:grid-cols-3 gap-3'\}/.test(p), 'phone 2 columns; others unchanged')
  assert.ok(/\{phone && \(\s*<Field label="Date \*"/.test(p) && /\{!phone && \(\s*<Field label="Date \*"/.test(p), 'date is its own phone row but stays in the row elsewhere')
  assert.ok(/<Field label="Start \*"/.test(p) && /<Field label="End \*"/.test(p), 'each field keeps its own label')
  assert.ok(/\+ Ends on a different day/.test(p), 'overnight control kept')
  assert.ok(/<TimeField id="sch-start"/.test(p) && /<TimeField id="sch-end"/.test(p), 'same TimeField: typing, list, AM/PM or 24h')
})

test('Set as Due Date pill: both labels, check icon when on, switch semantics, all sizes', () => {
  const p = src('ScheduleParts.tsx')
  const pill = p.slice(p.indexOf('function DueDatePill'), p.indexOf('function LocationField'))
  assert.ok(/'Due Date Set' : 'Set as Due Date'/.test(pill) && /role="switch"/.test(pill) && /aria-checked=\{on\}/.test(pill) && /polyline/.test(pill))
  assert.ok(!/phone/.test(pill), 'not phone specific')
  assert.ok(p.indexOf('<DueDatePill') > p.indexOf('+ Ends on a different day') && p.indexOf('<DueDatePill') < p.indexOf('<Field label="Category"'), 'sits right under the time fields')
  assert.ok(/rgba\(239,68,68/.test(pill), 'selected styling is a soft red, the field itself is not recoloured')
})

test('form model: the due flag round-trips and is independent of priority/category; toggling off keeps the event', () => {
  const e = { id: 'x', title: 'T', category: 'study', startAt: at(2026, 11, 9, 20), endAt: at(2026, 11, 10, 1), isDeadline: true }
  const f = L.eventToForm(e)
  assert.equal(f.isDeadline, true); assert.equal(f.endDate, '2026-11-10'); assert.equal(f.end, '01:00')
  const back = L.formToEventFields(f)
  assert.equal(back.isDeadline, true); assert.equal(back.endAt, e.endAt, 'overnight due date uses the real end date')
  assert.equal(back.category, 'study')
  const off = L.formToEventFields({ ...f, isDeadline: false })
  assert.equal(off.isDeadline, undefined); assert.equal(off.title, 'T'); assert.equal(off.endAt, e.endAt)
  assert.equal(L.blankForm(new Date(2026, 10, 9)).isDeadline, false)
  assert.ok(!('dueAt' in back) && !('dueDate' in back), 'no second competing due date field')
})

// ── Phase 4: linking ────────────────────────────────────────────────────────
test('creating a deadline creates ONE linked task on the due day, with a stable id and the event reference', () => {
  const { plan, cal } = sync({}, ev())
  assert.equal(plan.outcome, 'created'); assert.equal(plan.taskDateKey, '2026-11-09')
  const t = tasksOf(cal, '2026-11-09'); assert.equal(t.length, 1)
  assert.equal(t[0].id, 'dl-e1'); assert.equal(t[0].sourceEventId, 'e1'); assert.equal(t[0].text, 'Report'); assert.equal(t[0].done, false)
  assert.ok(!('isPriority' in t[0]) || !t[0].isPriority, 'priority is not changed by a deadline')
})

test('overnight deadline: the task lands on the END date', () => {
  const { cal, plan } = sync({}, ev({ startAt: at(2026, 11, 9, 22), endAt: at(2026, 11, 10, 1, 30) }))
  assert.equal(plan.taskDateKey, '2026-11-10'); assert.equal(tasksOf(cal, '2026-11-10').length, 1); assert.equal(tasksOf(cal, '2026-11-09').length, 0)
})

test('no duplicates: repeated saves, retries and stale refreshes all collapse onto the same task', () => {
  let { cal, plan } = sync({}, ev())
  for (let i = 0; i < 4; i++) ({ cal, plan } = sync(cal, ev(), plan.taskDateKey))
  assert.equal(tasksOf(cal, '2026-11-09').length, 1)
  // a retry that does not know where the task lives (previous key lost) still finds it on the target day
  const again = sync(cal, ev(), null); assert.equal(tasksOf(again.cal, '2026-11-09').length, 1)
  // applying the very same plan twice is also harmless
  const twice = apply(apply({}, D.planDeadlineSync({}, 'e1', ev(), null, 'a')), D.planDeadlineSync({}, 'e1', ev(), null, 'a'))
  assert.equal(tasksOf(twice, '2026-11-09').length, 1)
})

test('editing the title updates the task; editing the end moves the SAME task (sessions, notes, completion kept)', () => {
  let { cal, plan } = sync({}, ev())
  const day = cal['2026-11-09']
  cal = { ...cal, '2026-11-09': { ...day, tasks: day.tasks.map(t => ({ ...t, journal: 'my notes', done: true, sessions: [{ id: 's', startTs: 1, endTs: 2, note: '', tags: [] }] })) } }
  const r1 = sync(cal, ev({ title: 'Report v2' }), plan.taskDateKey)
  assert.equal(r1.plan.outcome, 'updated'); assert.equal(tasksOf(r1.cal, '2026-11-09')[0].text, 'Report v2'); assert.equal(tasksOf(r1.cal, '2026-11-09')[0].journal, 'my notes')
  const r2 = sync(r1.cal, ev({ title: 'Report v2', endAt: at(2026, 11, 12, 10) }), r1.plan.taskDateKey)
  assert.equal(r2.plan.outcome, 'moved'); assert.equal(r2.plan.taskDateKey, '2026-11-12')
  assert.equal(tasksOf(r2.cal, '2026-11-09').length, 0); const moved = tasksOf(r2.cal, '2026-11-12'); assert.equal(moved.length, 1)
  assert.equal(moved[0].done, true); assert.equal(moved[0].sessions.length, 1); assert.equal(moved[0].journal, 'my notes')
  assert.deepEqual([r2.plan.ops[0].kind, r2.plan.ops[0].date_key, r2.plan.ops[0].from_key], ['move', '2026-11-12', '2026-11-09'], 'one atomic move: the task is never in neither day')
})

test('completion stays the user\'s: nothing here ever marks a deadline task done, and an ended event does not complete it', () => {
  const { cal } = sync({}, ev({ endAt: at(2020, 1, 1, 10), startAt: at(2020, 1, 1, 9) }))
  assert.equal(tasksOf(cal, '2020-01-01')[0].done, false)
  assert.ok(!/done: true|done:true/.test(strip(read('components/xpadite/deadlineLink.ts'))))
})

test('removing the designation: an untouched task is removed; a task with user work is kept and just unlinked', () => {
  let { cal, plan } = sync({}, ev())
  const clean = sync(cal, ev({ isDeadline: false }), plan.taskDateKey)
  assert.equal(clean.plan.outcome, 'removed'); assert.equal(tasksOf(clean.cal, '2026-11-09').length, 0); assert.equal(clean.plan.taskDateKey, null)
  const day = cal['2026-11-09']
  const worked = { ...cal, '2026-11-09': { ...day, tasks: day.tasks.map(t => ({ ...t, sessions: [{ id: 's', startTs: 1, endTs: 2, note: '', tags: [] }] })) } }
  const kept = sync(worked, ev({ isDeadline: false }), plan.taskDateKey)
  assert.equal(kept.plan.outcome, 'unlinked'); const t = tasksOf(kept.cal, '2026-11-09'); assert.equal(t.length, 1); assert.equal(t[0].sourceEventId, undefined); assert.equal(t[0].sessions.length, 1)
  // re-enabling later re-links the very same task instead of creating a second
  const back = sync(kept.cal, ev(), null); assert.equal(tasksOf(back.cal, '2026-11-09').length, 1); assert.equal(tasksOf(back.cal, '2026-11-09')[0].sourceEventId, 'e1')
  for (const patch of [{ done: true }, { journal: 'x' }, { timerStart: 5 }, { noteDone: true }, { attachments: [{}] }]) {
    const d = { ...cal['2026-11-09'], tasks: cal['2026-11-09'].tasks.map(x => ({ ...x, ...patch })) }
    assert.equal(D.planDeadlineSync({ '2026-11-09': d }, 'e1', null, '2026-11-09', 'a').outcome, 'unlinked', JSON.stringify(patch))
  }
})

test('deleting the event resolves its task the same safe way; unrelated tasks (even with the same title) are never touched or merged', () => {
  const mine = { id: 'user-task', text: 'Report', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [] }
  const start = { '2026-11-09': { productive: false, hyper: false, notes: '', journal: '', tasks: [mine] } }
  const { cal, plan } = sync(start, ev())
  assert.equal(tasksOf(cal, '2026-11-09').length, 2, 'a same-titled user task is NOT adopted')
  assert.deepEqual(tasksOf(cal, '2026-11-09').find(t => t.id === 'user-task'), mine)
  const del = D.planDeadlineSync(cal, 'e1', null, plan.taskDateKey, 'a')
  const after = apply(cal, del)
  assert.equal(del.outcome, 'removed'); assert.deepEqual(tasksOf(after, '2026-11-09'), [mine])
  assert.equal(D.planDeadlineSync({}, 'ghost', null, null, 'a').outcome, 'none')
})

test('a sub-task parent is never auto-deleted', () => {
  const { cal, plan } = sync({}, ev())
  const day = cal['2026-11-09']
  const withChild = { ...cal, '2026-11-09': { ...day, tasks: [...day.tasks, { id: 'c', text: 'sub', parentTaskId: 'dl-e1', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [] }] } }
  assert.equal(D.planDeadlineSync(withChild, 'e1', null, plan.taskDateKey, 'a').outcome, 'unlinked')
})

// ── Phase 5/6: presentation helpers ─────────────────────────────────────────
test('due status: Overdue / Due Today / Upcoming from real local time', () => {
  const now = at(2026, 11, 6, 12)
  assert.equal(D.dueStatus(at(2026, 11, 6, 15), now), 'today'); assert.equal(D.dueStatus(at(2026, 11, 6, 9), now), 'overdue')
  assert.equal(D.dueStatus(at(2026, 11, 7, 0, 5), now), 'upcoming'); assert.equal(D.dueStatus(at(2026, 11, 5, 23, 59), now), 'overdue')
  assert.deepEqual(D.DUE_LABEL, { overdue: 'Overdue', today: 'Due Today', upcoming: 'Upcoming' })
})

test('Calendar data: deadlines group by local due day; many on one day = one entry per day; cancelled and non-deadlines ignored', () => {
  const m = D.deadlineDayMap([ev({ id: 'a', endAt: at(2026, 11, 9, 17) }), ev({ id: 'b', endAt: at(2026, 11, 9, 9) }), ev({ id: 'c', isDeadline: false }), ev({ id: 'd', isCancelled: true }), ev({ id: 'f', endAt: at(2026, 11, 18, 23, 30) })])
  assert.deepEqual(Object.keys(m).sort(), ['2026-11-09', '2026-11-18'])
  assert.deepEqual(m['2026-11-09'].map(e => e.id), ['b', 'a'], 'all deadlines of the day stay reachable, ordered by time')
})

test('Task Manager: deadline tasks reuse the existing red urgent styling exactly once; the priority value is untouched; popup extended, not replaced', () => {
  const d = src('DayModal.tsx')
  assert.ok(/const urgent = !!task\.isPriority \|\| isDeadlineTask\(task\)/.test(d), 'only DEADLINE tasks (dl-) get the urgent look; ordinary synced event tasks (ev-) do not')
  assert.ok(/urgent \? 'rgba\(239,68,68,0\.28\)'/.test(d) && /const colorOverlay = urgent/.test(d) && /\{urgent && \(/.test(d), 'one shared urgent flag drives border, tint and "!"')
  assert.ok(!/isPriority: !t\.isPriority \|\| |sourceEventId.*isPriority\s*=/.test(d))
  assert.ok(/<DeadlineInfoLine dueAt=\{deadlineEvent\.endAt\}/.test(d) && (d.match(/>Dismiss<\/button>/g) || []).length === 1, 'the existing popup (single Dismiss) shows the due line')
  const line = d.slice(d.indexOf('function DeadlineInfoLine'), d.indexOf('function TaskRow'))
  assert.ok(/DUE_LABEL\[status\]/.test(line) && /longDateLabel\(dueAt\)/.test(line) && /clockLabel\(dueAt, fmt\)/.test(line) && /!done &&/.test(line))
})

// ── Phase 7: saved locations ────────────────────────────────────────────────
test('saved locations: add, duplicate (normalised), empty, limit, remove, sanitize', () => {
  let r = L.addSavedLocation([], '  Room   204 ')
  assert.equal(r.status, 'added'); assert.deepEqual(r.list, ['Room 204'])
  assert.equal(L.addSavedLocation(r.list, 'room 204').status, 'duplicate'); assert.equal(L.addSavedLocation(r.list, '   ').status, 'empty')
  assert.deepEqual(L.addSavedLocation(r.list, 'Library').list, ['Room 204', 'Library'])
  const full = Array.from({ length: L.MAX_SAVED_LOCATIONS }, (_, i) => `P${i}`); assert.equal(L.addSavedLocation(full, 'one more').status, 'full')
  assert.deepEqual(L.removeSavedLocation(['A', 'B'], ' a '), ['B'])
  assert.deepEqual(L.sanitizeSavedLocations(['A', 'a', 5, null, ' B ', '']), ['A', 'B']); assert.deepEqual(L.sanitizeSavedLocations('nope'), [])
})

test('removing a saved location cannot alter any event (events keep their own text; the list is separate)', () => {
  const events = [ev({ location: 'Room 204' })]
  const before = JSON.stringify(events)
  L.removeSavedLocation(['Room 204'], 'Room 204')
  assert.equal(JSON.stringify(events), before)
  const p = src('ScheduleParts.tsx'); const lf = p.slice(p.indexOf('function LocationField'), p.indexOf('interface EventFormProps'))
  assert.ok(/onSavedChange\?\.\(removeSavedLocation/.test(lf) && !/onChange\(''\)/.test(lf), 'remove only edits the list, never the field/event')
  assert.ok(/Undo/.test(lf) && /role="listbox"/.test(lf) && /aria-label=\{`Remove saved location/.test(lf) && /type="button"/.test(lf), 'undo, accessible list, keyboard-safe buttons')
  assert.ok(/\+ Add/.test(lf) && />Remove</.test(lf) && /<input id="sch-location"/.test(lf), 'manual entry stays; + Add | Remove controls')
})

// ── Phase 9: persistence mapping + safety ───────────────────────────────────
test('row <-> event mapping keeps instants (timezone-safe), overnight ends, deadline flag, category and notes', () => {
  const e = { ...ev({ startAt: at(2026, 11, 9, 22), endAt: at(2026, 11, 10, 1), location: 'Lab', meetingUrl: 'https://x.test', notes: 'n', reminderMins: 15, recurrence: 'weekly', category: 'cat-custom' }), taskDateKey: '2026-11-10' }
  const row = S.eventToRow('u1', e)
  assert.equal(row.user_id, 'u1'); assert.equal(row.start_at, new Date(e.startAt).toISOString()); assert.equal(row.end_at, new Date(e.endAt).toISOString())
  assert.equal(row.is_deadline, true); assert.equal(row.task_date_key, '2026-11-10')
  const { user_id, ...rest } = row
  assert.deepEqual(S.rowToEvent(rest), { ...e, rev: undefined, taskLink: 'linked' })
  assert.deepEqual([S.rowToEvent({ ...rest, rev: 7, task_link: 'detached' }).rev, S.rowToEvent({ ...rest, rev: 7, task_link: 'detached' }).taskLink], [7, 'detached'], 'revision + the user\'s Task Manager choice come back from the row')
  assert.equal(S.rowToEvent({ ...rest, task_link: 'garbage' }).taskLink, 'linked')
  assert.equal(S.rowToEvent({ ...rest, recurrence: 'bogus' }).recurrence, 'none')
  assert.equal(S.rowToEvent({ ...rest, is_deadline: false }).isDeadline, undefined)
  assert.equal(S.eventToRow('u', { id: 'p', title: 't', category: 'meeting', startAt: 1000, endAt: 2000 }).is_deadline, false)
})

test('DST: an event set for 9:00 wall-clock keeps its instant and shows 9:00 again after a round trip (America/Los_Angeles, across the Nov 1 change)', () => {
  const { spawnSync } = require('node:child_process')
  const code = `const L=require(${JSON.stringify(path.join(OUT, 'scheduleLogic.js'))});const f=L.blankFormAt(new Date(2026,10,2),9*60,60);f.isDeadline=true;const fields=L.formToEventFields(f);const back=L.eventToForm({id:'a',...JSON.parse(JSON.stringify(fields))});console.log(JSON.stringify([back.start,back.end,back.date,new Date(fields.startAt).toISOString()]))`
  const r = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), ['09:00', '10:00', '2026-11-02', '2026-11-02T17:00:00.000Z'])
})

test('migration 022 is additive, user-scoped with RLS, uniquely keyed, and adds no realtime subscription', () => {
  const m = read('supabase/migrations/022_schedule_events.sql')
  const code = m.split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
  assert.ok(/create table if not exists public\.schedule_events/.test(code) && /enable row level security/.test(code))
  for (const op of ['select', 'insert', 'update', 'delete']) assert.ok(new RegExp(`on public\\.schedule_events for ${op}`).test(code), `${op} policy`)
  assert.equal((code.match(/auth\.uid\(\) = user_id/g) || []).length >= 5, true, 'every policy is owner-only')
  assert.ok(/unique \(user_id, event_id\)/.test(code) && /references auth\.users\(id\) on delete cascade/.test(code))
  assert.ok(!/drop table|drop column|truncate|delete from|alter column|rename/i.test(code), 'nothing destructive')
  assert.ok(!/drop policy(?! if exists)/i.test(code))
  assert.ok(/add column if not exists saved_locations/.test(code) && /add column if not exists schedule_categories/.test(code))
  assert.ok(!/supabase_realtime/.test(code), 'no realtime publication / egress')
  assert.ok(/check \(end_at > start_at\)/.test(code))
})

test('writes are confirmed before anything looks saved; failures leave events AND tasks exactly as they were', () => {
  const a = strip(src('AppContext.tsx'))
  const save = a.slice(a.indexOf('const saveInner'), a.indexOf('const saveScheduleEvent'))
  const at = save.indexOf('await applyScheduleChange')
  assert.ok(at > -1 && at < save.indexOf('commitEvents(') && at < save.indexOf('adoptServerDays('), 'the single atomic call comes before any local change')
  assert.ok(save.indexOf('await flushFor(plan.ops)') > -1 && save.indexOf('await flushFor(plan.ops)') < at, 'pending local edits of the affected days reach the server first')
  assert.ok(/catch \(err\) \{ throw scheduleError\(err\) \}/.test(save), 'errors are rethrown, never swallowed')
  const del = a.slice(a.indexOf('const deleteScheduleEvent'), a.indexOf('const detachDeadlineTask'))
  assert.ok(del.indexOf('await applyScheduleChange') < del.indexOf('commitEvents(') && del.indexOf('await applyScheduleChange') < del.indexOf('adoptServerDays('))
  assert.ok(/deleteEventId: id/.test(del), 'event row and task change in ONE transaction')
  assert.ok(!/upsertScheduleEvent|deleteScheduleEventRow|updateDay\(p\.key/.test(a), 'the old two-step (event write, then task write) path is gone')
  const m = strip(src('MeetingsModal.tsx'))
  assert.ok(/await saveScheduleEvent\(\{ \.\.\.existing, id, \.\.\.fields \}\)/.test(m) && /setSaveError\(saveFailureMessage\(err\)\)/.test(m), 'the form stays open with its inputs and shows the error')
  assert.ok(/try \{ await deleteScheduleEvent\(id\) \} catch \(err\) \{ setToast\(saveFailureMessage\(err\)\); return \}/.test(m), 'delete only closes after success')
  assert.ok(!/not saved yet|this preview/.test(m), 'no leftover "preview / not saved" messaging')
})

test('user isolation: every read and write is scoped to the signed-in user (and RLS repeats it server side)', () => {
  const s = strip(read('lib/supabase/schedule-data.ts'))
  assert.ok((s.match(/\.eq\('user_id', userId\)/g) || []).length >= 2, 'fetch events, read preferences')
  assert.ok(/\.rpc\('schedule_apply'/.test(s) && /\.rpc\('schedule_set_task_link'/.test(s) && !/\.from\('schedule_events'\)\.(insert|upsert|delete|update)/.test(s), 'writes go through the owner-scoped (auth.uid()) functions')
  assert.ok(/const row: Record<string, unknown> = \{ user_id: userId \}/.test(s), 'preference writes carry the owner')
  assert.ok(/service_role|SERVICE_ROLE/i.test(s) === false, 'no service-role credentials in browser code')
  assert.ok(/user_id: userId,/.test(s), 'rows built for the server carry the owner')
})

test('no demo events exist, so nothing is ever "adopted": only the user own saved events are shown (see scheduleV329Fix.test.cjs)', () => {
  const m = strip(src('MeetingsModal.tsx'))
  assert.ok(!/SAMPLE_PREFIX|sampleEvents|setSampleEvents|wasSample|buildSampleScheduleEvents/.test(m))
})

// ── Phase 6/8: calendar + category wiring ───────────────────────────────────
test('Calendar marker is wired into the quarterly cards, the month page and the month zoom; the existing indicators are not removed', () => {
  for (const f of ['MonthCard.tsx', 'MonthFullPage.tsx', 'MonthZoomModal.tsx']) {
    const s = src(f)
    assert.ok(/from '\.\/DeadlineMark'/.test(s) && /deadlineDays/.test(s) && /DeadlineCorner/.test(s) && /deadlineSquareStyle/.test(s), f)
    assert.ok(/🔥/.test(s) && /🏆/.test(s) && /🎯/.test(s), `${f}: fire/trophy/target still rendered`)
  }
  assert.ok(/xp-streak-conn/.test(src('MonthCard.tsx')) && /isStreakDay/.test(src('MonthCard.tsx')), 'streak logic untouched')
  assert.ok(!/deadline/i.test(strip(src('productivityEngine.ts'))), 'productivity statistics ignore deadlines')
})

test('every day-cell branch gets exactly one corner marker (fire / trophy / target / productive|plain), never stacked copies', () => {
  const count = f => (src(f).match(/<DeadlineCorner events=/g) || []).length
  assert.equal(count('MonthCard.tsx'), 4, 'quarterly cards: 3 emoji branches + the circle branch')
  assert.equal(count('MonthZoomModal.tsx'), 4, 'month zoom: 3 emoji branches + the circle branch')
  assert.equal(count('MonthFullPage.tsx'), 1, 'month page: one shared marker for every state')
  for (const f of ['MonthCard.tsx', 'MonthZoomModal.tsx']) {
    const lines = src(f).split('\n')
    lines.forEach((l, i) => { if (/<DeadlineCorner events=/.test(l)) assert.ok(!/<DeadlineCorner events=/.test(lines[i + 1] || ''), `${f}:${i + 1} duplicated marker`) })
  }
})

test('marker design: translucent red tokens for light and dark, one marker per day, never an absolute square over the number', () => {
  const dm = src('DeadlineMark.tsx')
  assert.ok(/rgba\(239,68,68,0\.18\)/.test(dm) && /rgba\(248,113,113,0\.24\)/.test(dm), 'light 0.18, dark 0.24 (inside/near the brief\'s 0.16-0.22)')
  assert.ok(/color: t\.fg/.test(dm) && /#991b1b/.test(dm) && /#fecaca/.test(dm), 'dark red text on light, pale red on dark (never white on pale red)')
  assert.ok(/className="xp-dl-corner"/.test(dm) && /pointerEvents: 'none'/.test(dm))
  const css = read('app/globals.css')
  assert.ok(/\.xp-dl-corner \{[^}]*width: clamp\(3px, 22%, 13px\)/.test(css) && /\.xp-dl-corner \{\s*position: absolute;\s*top: 0;\s*right: 0;/.test(css) && /data-size="sm"/.test(css) && /zIndex: 0/.test(dm) && /size="sm"/.test(read('components/xpadite/MonthZoomModal.tsx')) && /\.xp-dl-corner\[data-pos="br"\]/.test(css) && /pos="br"/.test(read('components/xpadite/MonthCard.tsx')) && /pos=\{!rawHyper && !rawMil && rawGoal \? 'br' : 'tr'\}/.test(read('components/xpadite/MonthFullPage.tsx')), 'sized from the cell; flush in the corner on phone quarterly cells')
  assert.equal((dm.match(/export function Deadline/g) || []).length, 1)
  const card = src('MonthCard.tsx')
  assert.ok(/const plainDl = !!dls && !productive && !todayCell/.test(card) && /\{dls && !plainDl && <DeadlineCorner/.test(card), 'a day shows exactly one of: container square OR corner square')
})

test('category dropdown is the single selector on every size and matches the approved phone look', () => {
  const p = src('ScheduleParts.tsx')
  assert.equal((p.match(/<CategorySelect id="sch-category"/g) || []).length, 1)
  assert.ok(!/role="radio"/.test(p.slice(p.indexOf('function EventFormInner'))))
  assert.ok(/background: cur\.bg, borderColor: cur\.edge, color: cur\.text/.test(p) && /<CategoryDot id=\{value\} size=\{12\}/.test(p) && /<ChevronDown \/>/.test(p))
  assert.ok(/categories\.map\(\(c, i\)/.test(p), 'built-in and custom categories')
})

test('deadline indicator on schedule cards keeps the category colour (never an all-red card) and shows in Event Details', () => {
  const v = src('MyScheduleView.tsx'); const pa = src('ScheduleParts.tsx')
  assert.ok(/data-testid="deadline-flag"/.test(v) && /\{ev\.isDeadline && heightPx >= 30/.test(v))
  assert.ok(!/isDeadline[^\n]*background/.test(v))
  assert.ok(/data-testid="deadline-badge"/.test(pa) && /longDateLabel\(ev\.endAt\)/.test(pa) && /clockLabel\(ev\.endAt, fmt\)/.test(pa), 'due date and time come from the event end, in the user format')
})

test('unrelated scope untouched: Maximize/Restore, conflict detection and read-only synced events are still wired', () => {
  const m = src('MeetingsModal.tsx')
  assert.ok(/data-testid="maximize-btn"/.test(m) && /const maximized = desktop && maxRequested/.test(m))
  assert.ok(/formConflict\(v, allEvents/.test(m) && /findConflicts\(/.test(m))
  assert.ok(/if \(ev\.readOnly\) return/.test(m))
})
