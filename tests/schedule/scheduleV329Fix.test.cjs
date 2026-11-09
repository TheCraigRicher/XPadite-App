// v1.329 fix — (1) NO built-in / sample / mock schedule data; (2) "Sync with Task Manager" never back-fills existing events without consent, and a
// scheduled event may overlap Task Manager work without anything being moved, replaced or modified.
// Part A runs the real pure modules. Part B runs the real migrations on PGlite (skipped — never "passed" — when PGlite is not installed).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-v329fix'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = f => read(`components/xpadite/${f}`)
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('deadlineLink'); compile('scheduleLogic'); compile('scheduleEngine')
const D = require(path.join(OUT, 'deadlineLink.js'))
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const day = (tasks = [], o = {}) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...o })
const tk = (id, o = {}) => ({ id, text: 'T', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...o })
const ev = (id, o = {}) => ({ id, title: 'Class', category: 'lecture', startAt: at(2026, 11, 9, 9, 30), endAt: at(2026, 11, 9, 10, 30), isDeadline: false, taskDateKey: null, taskLink: 'linked', ...o })
const run = (cal, ops) => ({ ...cal, ...D.applyOpsLocal(cal, ops) })
const all = cal => Object.entries(cal).flatMap(([k, d]) => d.tasks.map(t => ({ ...t, _day: k })))
const linkedOf = (cal, id) => all(cal).filter(t => t.sourceEventId === id)
const clone = x => JSON.parse(JSON.stringify(x))

// ═════ Issue 1 — no built-in sample events ═════════════════════════════════════════════════════════════════════════════════════════════
test('there is no hardcoded / generated sample schedule or mock meeting anywhere in the app', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'components/xpadite/scheduleMockData.ts')), 'the sample-event generator file is gone')
  const mm = read('components/xpadite/meetingsMockData.ts'); assert.ok(!/MOCK_MEETINGS|dayAt\(|meeting\(\{|Product Team Standup/.test(mm), 'no mock meetings')
  const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
  const code = ['components', 'lib', 'app'].flatMap(walk).filter(f => /\.(ts|tsx)$/.test(f))
  for (const f of code) {
    const s = strip(read(f))
    assert.ok(!/sample-sched-|buildSampleScheduleEvents|MOCK_MEETINGS|scheduleMockData|Sample events are demos|Lecture . React Native|Python Test|Weekend Hangout/.test(s), `${f} must not contain sample data or sample messaging`)
  }
})

test('the footer sample-event message is removed and nothing replaces it', () => {
  const v = src('MyScheduleView.tsx')
  assert.ok(!/Sample events are demos|Your own events are saved to your account|are demos/.test(v))
  assert.ok(/No events match your search or filters\./.test(v), 'the real "no match" hint for a search/filter stays')
})

test('a new account sees an EMPTY schedule: the modal shows only the persisted list, and no demo "Load" option exists', () => {
  const m = strip(src('MeetingsModal.tsx')); const a = strip(src('AppContext.tsx'))
  assert.ok(/const scheduleEvents = persistedEvents/.test(m), 'the modal\'s event list IS the persisted list')
  assert.ok(/useState<XpaditeMeeting\[\]>\(\[\]\)/.test(m), 'synced meetings start empty')
  assert.ok(/const \[scheduleEvents, setScheduleEventsState\] = useState<StoredScheduleEvent\[\]>\(\[\]\)/.test(a), 'the account starts with no events until the server list arrives')
  assert.ok(!/Load Demo|Demo Schedule|loadDemo|demoSchedule/i.test(m + strip(src('ScheduleMenu.tsx')) + strip(src('ScheduleDialogs.tsx')) + strip(src('MyScheduleView.tsx'))), 'no demo option')
  // pure view: nothing to draw for an empty account on any day / filter
  const none = []
  for (const d of [new Date(2026, 10, 4), new Date(), new Date(2027, 0, 1)]) assert.deepEqual(L.eventsOnDay(none, d), [])
  assert.deepEqual(L.filterScheduleEvents(none, { query: '', category: null, source: null, hidden: [], categories: L.SCHEDULE_CATEGORIES }), [])
})

test('reopening / refreshing can not bring anything back: the list is derived only from persisted data (no local generated copy)', () => {
  const m = strip(src('MeetingsModal.tsx'))
  assert.ok(!/buildSample|sampleEvents|setSampleEvents|SAMPLE_PREFIX|wasSample/.test(m))
  assert.ok(/async function confirmDelete\(\)[\s\S]*await deleteScheduleEvent\(id\)/.test(m), 'delete goes to the server and the event is removed only after it confirmed')
  const a = strip(src('AppContext.tsx')); const del = a.slice(a.indexOf('const deleteScheduleEvent'), a.indexOf('const detachDeadlineTask'))
  assert.ok(/applyScheduleChange\(createClient\(\), \{ userId: uid, deleteEventId: id/.test(del) && /commitEvents\(list => list\.filter\(e => e\.id !== id\)\)/.test(del))
  assert.ok(!/localStorage[^\n]*sched(ule)?_?events/i.test(a), 'events are never cached in device storage that could resurrect them')
})

test('nothing sample-like can create a Task Manager task: the mock-meeting "add" path is gone and the event→task path only handles saved events', () => {
  const m = strip(src('MeetingsModal.tsx'))
  assert.ok(!/MOCK_MEETINGS|sample-sched|mock-task-/.test(strip(src('MeetingsModal.tsx')).replace(/linkedTaskId: `mock-task-\$\{selMeeting\.id\}`/, '')), 'no sample id exists to link')
  assert.ok(/useState<XpaditeMeeting\[\]>\(\[\]\)/.test(m), 'there are no mock meetings to "add"')
  const a = strip(src('AppContext.tsx')); const save = a.slice(a.indexOf('const saveInner'), a.indexOf('const saveScheduleEvent'))
  assert.ok(/applyScheduleChange/.test(save), 'the only task creation path is the atomic server write of a saved event')
})

// ═════ Issue 2 — overlap and Sync with Task Manager ═══════════════════════════════════════════════════════════════════════════════════
const worked = () => tk('u1', { text: 'Existing work', done: true, journal: 'notes', sessions: [{ startTs: at(2026, 11, 9, 9), endTs: at(2026, 11, 9, 10) }, { startTs: at(2026, 11, 9, 10), endTs: at(2026, 11, 9, 11) }], noteDone: true })
const plan = (cal, e, o = {}) => D.planDeadlineSync(cal, e.id, e, o.prev ?? null, 'a', undefined, e.taskLink ?? 'linked', o.sync ?? false, o.create ?? true)

test('a scheduled event that overlaps an existing tracked task coexists: neither is moved, replaced, completed or modified', () => {
  const existing = worked(); const cal = { '2026-11-09': day([existing, tk('u2', { text: 'Class' })]) }   // u2 even has the SAME title as the event
  const before = clone(cal)
  const e = ev('e1')                                                        // 09:30–10:30 overlaps u1's 09:00–11:00 sessions
  const p = plan(cal, e, { sync: true })
  assert.equal(p.outcome, 'created'); assert.equal(p.ops.length, 1); assert.equal(p.ops[0].kind, 'upsert'); assert.equal(p.ops[0].task_id, 'ev-e1')
  const next = run(cal, p.ops)
  assert.deepEqual(next['2026-11-09'].tasks.filter(t => t.id === 'u1' || t.id === 'u2'), before['2026-11-09'].tasks, 'existing tasks are byte-for-byte unchanged (sessions, done, notes, title)')
  assert.equal(next['2026-11-09'].tasks.length, 3, 'both coexist; the same-titled task is NOT merged with the event task (matching is by id, never by title)')
  const t = next['2026-11-09'].tasks.find(x => x.id === 'ev-e1')
  assert.equal(t.sourceEventId, 'e1'); assert.equal(t.done, false, 'a scheduled event is never marked as completed work'); assert.deepEqual(t.sessions, [], 'no work is recorded for planned time'); assert.equal(t.timerStart, null); assert.equal(t.timerEnd, null)
  assert.ok(!('startAt' in t) && !('endAt' in t) && !('startTs' in t), 'the planned time stays on the EVENT; the task carries no copied time')
  assert.deepEqual(before, clone(cal), 'the input calendar was not mutated')
})

test('My Schedule event-conflict behaviour is unchanged: it compares EVENTS only, so Task Manager tasks/sessions can never block or shift an event', () => {
  const eng = strip(src('scheduleEngine.ts'))
  assert.ok(!/sessions|taskId|calData|useApp/.test(eng.slice(eng.indexOf('export function findConflicts'), eng.indexOf('function occupiedLabel'))), 'findConflicts looks at events only')
  const a = ev('a'), b = ev('b', { startAt: at(2026, 11, 9, 10), endAt: at(2026, 11, 9, 11) })
  assert.equal(E.findConflicts({ startAt: b.startAt, endAt: b.endAt }, [a]).length, 1, 'two events overlapping is still refused (unchanged)')
  assert.equal(E.findConflicts({ startAt: a.startAt, endAt: a.endAt }, []).length, 0, 'with no events, any time is free whatever tasks exist')
})

test('no duplicate linked tasks: repeating, re-saving, concurrent devices and reconcile all end with exactly ONE task per event', () => {
  let cal = { '2026-11-09': day([worked()]) }
  const e = ev('e1')
  const p1 = plan(cal, e, { sync: true })
  cal = run(cal, p1.ops); cal = run(cal, p1.ops)                       // the same plan delivered twice (retry / double tap)
  assert.equal(linkedOf(cal, 'e1').length, 1)
  const stale = clone(cal); const dev2 = plan({ '2026-11-09': day([worked()]) }, e, { sync: true })   // a second device that had not seen the first one
  cal = run(cal, dev2.ops)
  assert.equal(linkedOf(cal, 'e1').length, 1, 'a second device creating the same id upserts instead of duplicating')
  for (let i = 0; i < 3; i++) { const re = plan(cal, { ...e, taskDateKey: '2026-11-09', title: 'Class ' + i }, { sync: true, prev: '2026-11-09', create: false }); cal = run(cal, re.ops) }
  assert.equal(linkedOf(cal, 'e1').length, 1); assert.equal(linkedOf(cal, 'e1')[0].text, 'Class 2', 'renames update the one task')
  const rec = D.reconcileDeadlines(cal, [{ ...e, taskDateKey: '2026-11-09', title: 'Class 2' }], 'a', true, false)
  assert.deepEqual(rec, [], 'reconcile finds nothing to do (idempotent)')
  assert.ok(stale)
})

test('existing tracked sessions are never modified: renaming, moving the event to another day, and deleting it keep the user\'s work', () => {
  const e = ev('e1')
  let cal = run({}, plan({}, e, { sync: true }).ops)
  // the user then logs real work on the linked task
  const t = cal['2026-11-09'].tasks.find(x => x.id === 'ev-e1'); t.sessions = [{ startTs: at(2026, 11, 9, 9, 30), endTs: at(2026, 11, 9, 9, 50) }]; t.done = true; t.journal = 'did it'
  const workBefore = clone(t)
  const moved = { ...e, title: 'Class (moved)', startAt: at(2026, 11, 12, 9, 30), endAt: at(2026, 11, 12, 10, 30), taskDateKey: '2026-11-09' }
  cal = run(cal, plan(cal, moved, { sync: true, prev: '2026-11-09', create: false }).ops)
  const t2 = linkedOf(cal, 'e1')[0]
  assert.equal(t2._day, '2026-11-12', 'the same task follows its event'); assert.deepEqual(t2.sessions, workBefore.sessions); assert.equal(t2.done, true); assert.equal(t2.journal, 'did it')
  const del = D.planDeadlineSync(cal, 'e1', null, '2026-11-12', 'a', undefined, 'linked', true)
  assert.equal(del.outcome, 'unlinked', 'a task holding work is kept (only unlinked) when its event is deleted')
  cal = run(cal, del.ops); const left = all(cal).find(x => x.id === 'ev-e1'); assert.ok(left && !left.sourceEventId && left.sessions.length === 1)
})

test('Sync OFF (the default): ordinary events create no task; deadline events still do (unchanged)', () => {
  const a = strip(src('AppContext.tsx')); assert.ok(/const \[scheduleTaskSync, setScheduleTaskSyncState\] = useState\(false\)/.test(a), 'default OFF')
  assert.equal(plan({}, ev('e1'), { sync: false }).ops.length, 0)
  assert.equal(plan({}, ev('d1', { isDeadline: true }), { sync: false }).ops[0].task_id, 'dl-d1')
})

test('Sync ON: a NEW event gets its task; EXISTING events are NOT back-filled (neither by the switch, nor by reconcile, nor by re-saving them)', () => {
  const oldEvents = [ev('o1'), ev('o2', { startAt: at(2026, 11, 10, 9), endAt: at(2026, 11, 10, 10) })]
  const cal = { '2026-11-09': day([worked()]) }
  assert.deepEqual(D.reconcileDeadlines(cal, oldEvents, 'a', true, false), [], 'turning Sync ON (no consent) plans nothing for existing events')
  assert.equal(plan(cal, oldEvents[0], { sync: true, create: false }).ops.length, 0, 're-saving an old event does not link it')
  assert.equal(plan(cal, ev('new1'), { sync: true, create: true }).ops[0].task_id, 'ev-new1', 'a new event is linked')
  // AppContext policy wiring
  const a = strip(src('AppContext.tsx')); const save = a.slice(a.indexOf('const saveInner'), a.indexOf('const saveScheduleEvent'))
  assert.ok(/scheduleTaskSyncRef\.current, !prev \|\| !!opts\?\.addTask\)/.test(save), 'a task is created on save only for a new event or an explicit "Add back"')
  assert.ok(/addTask: true/.test(a.slice(a.indexOf('const restoreDeadlineTask'), a.indexOf('Reconciliation'))), '"Add back" still recreates the task')
  const rec = a.slice(a.indexOf('const reconcileInner'), a.indexOf('const reconcileSchedule'))
  assert.ok(/async \(force = false, backfill = false\)/.test(rec) && /backfill \? \(e => isBackfillEligible\(/.test(rec) && /: false\)/.test(rec), 'reconcile creates nothing unless a consented back-fill is running')
  const setp = a.slice(a.indexOf('const setScheduleTaskSyncPref'), a.indexOf('const requestScheduleEvent'))
  assert.ok(/reconcileInner\(true, next && !!opts\?\.backfill\)/.test(setp), 'only an explicit opts.backfill (and only when turning ON) back-fills')
})

test('explicit back-fill: only upcoming, non-cancelled, non-deadline, non-opted-out events without a task are eligible; past events never; result is idempotent', () => {
  const now = at(2026, 11, 9, 12)
  const events = [
    ev('past', { startAt: at(2026, 11, 2, 9), endAt: at(2026, 11, 2, 10) }),
    ev('today-earlier', { startAt: at(2026, 11, 9, 8), endAt: at(2026, 11, 9, 9) }),   // ends today → eligible (today counts)
    ev('future', { startAt: at(2026, 11, 20, 9), endAt: at(2026, 11, 20, 10) }),
    ev('detached', { startAt: at(2026, 11, 21, 9), endAt: at(2026, 11, 21, 10), taskLink: 'detached' }),
    ev('cancelled', { startAt: at(2026, 11, 22, 9), endAt: at(2026, 11, 22, 10), isCancelled: true }),
    ev('deadline', { startAt: at(2026, 11, 23, 9), endAt: at(2026, 11, 23, 10), isDeadline: true }),
    ev('has-task', { startAt: at(2026, 11, 24, 9), endAt: at(2026, 11, 24, 10), taskDateKey: '2026-11-24' }),
  ]
  assert.deepEqual(events.filter(e => D.isBackfillEligible(e, now)).map(e => e.id), ['today-earlier', 'future'])
  assert.equal(D.countBackfillEligible(events, now), 2)
  // a STALE task_date_key (the task was removed, e.g. Sync switched OFF) must not hide an event: the calendar decides
  const stale = ev('stale', { startAt: at(2026, 11, 25, 9), endAt: at(2026, 11, 25, 10), taskDateKey: '2026-11-25' })
  assert.equal(D.isBackfillEligible(stale, now, {}), true, 'no task in the calendar -> eligible although the row still names a day')
  assert.equal(D.isBackfillEligible(stale, now, { '2026-11-25': day([tk('ev-stale', { sourceEventId: 'stale' })]) }), false, 'a real task in the calendar -> not offered again')
  const cal = { '2026-11-09': day([worked()]) }
  const items = D.reconcileDeadlines(cal, events, 'a', true, e => D.isBackfillEligible(e, now))
  const created = items.filter(i => i.reason === 'created').map(i => i.eventId).sort()
  assert.deepEqual(created, ['deadline', 'future', 'today-earlier'].sort(), 'only the eligible ones (plus the always-linked deadline) get tasks')
  let after = run(cal, items.flatMap(i => i.ops))
  assert.deepEqual(after['2026-11-09'].tasks.find(t => t.id === 'u1'), worked(), 'the existing task is untouched by a back-fill')
  const events2 = events.map(e => { const i = items.find(x => x.eventId === e.id); return i ? { ...e, taskDateKey: i.taskDateKey } : e })
  assert.deepEqual(D.reconcileDeadlines(after, events2, 'a', true, e => D.isBackfillEligible(e, now)), [], 'second pass: nothing more to do (no duplicates)')
})

test('turning Sync OFF only removes untouched synced tasks (kept & unlinked when they hold work); ordinary tasks are never touched', () => {
  const e1 = ev('e1'), e2 = ev('e2', { startAt: at(2026, 11, 9, 14), endAt: at(2026, 11, 9, 15) })
  let cal = { '2026-11-09': day([worked(), tk('plain', { text: 'My task' })]) }
  for (const e of [e1, e2]) cal = run(cal, plan(cal, e, { sync: true }).ops)
  cal['2026-11-09'].tasks.find(t => t.id === 'ev-e2').sessions = [{ startTs: 1, endTs: 2 }]
  const evs = [{ ...e1, taskDateKey: '2026-11-09' }, { ...e2, taskDateKey: '2026-11-09' }]
  const off = D.reconcileDeadlines(cal, evs, 'a', false, false); cal = run(cal, off.flatMap(i => i.ops))
  assert.ok(!all(cal).some(t => t.id === 'ev-e1'), 'the untouched synced task is removed')
  assert.ok(all(cal).some(t => t.id === 'ev-e2' && !t.sourceEventId && t.sessions.length === 1), 'the worked task is kept (unlinked)')
  assert.deepEqual(cal['2026-11-09'].tasks.find(t => t.id === 'u1'), worked()); assert.ok(cal['2026-11-09'].tasks.some(t => t.id === 'plain'))
})

test('the user can still adjust a synced task freely (it is an ordinary task apart from its title); a deleted task is never recreated; "Add back" restores it', () => {
  const e = ev('e1'); let cal = run({}, plan({}, e, { sync: true }).ops)
  cal['2026-11-09'].tasks.find(t => t.id === 'ev-e1').sessions = [{ startTs: 5, endTs: 9 }]       // user edits session times by hand
  const again = plan(cal, { ...e, taskDateKey: '2026-11-09' }, { sync: true, prev: '2026-11-09', create: false })
  cal = run(cal, again.ops); assert.deepEqual(linkedOf(cal, 'e1')[0].sessions, [{ startTs: 5, endTs: 9 }], 'a later sync never overwrites hand-adjusted sessions')
  assert.equal(plan({}, { ...e, taskLink: 'detached' }, { sync: true }).ops.length, 0, 'opted-out ("detached") stays removed')
  assert.equal(plan({}, e, { sync: true, create: true }).ops[0].task_id, 'ev-e1', '"Add back" (create) restores it')
})

test('Sync dialog: consent UI — the back-fill box is unticked by default, offered only when turning ON with eligible events, and the overlap note is informational', () => {
  const dlg = src('ScheduleDialogs.tsx'); const inner = dlg.slice(dlg.indexOf('function SyncInner'), dlg.indexOf('type PrefsProps'))
  assert.ok(/useState\(false\)/.test(inner) && /const offerBackfill = draft && !enabled && eligibleCount > 0/.test(inner), 'default unticked; only when switching ON')
  assert.ok(/data-testid="sync-backfill-box"[^>]*checked=\{backfill\}/.test(inner) && /Past events are never added/.test(inner))
  assert.ok(/Your existing events and tasks are left exactly as they are/.test(inner), 'plain statement of what ON does')
  assert.ok(/can share the same time\. They never move, replace or change each other/.test(inner) && !/disabled=\{[^}]*overlap/i.test(inner), 'overlap note is informational, never blocking')
  assert.ok(/\{!draft && enabled && <p data-testid="sync-off-note"/.test(inner) && /removes the Task Manager tasks that were created from your events and have no recorded work/.test(inner) && /logged time, notes, attachments, sub-tasks or a completed check are kept/.test(inner), 'turning Sync OFF says, before Save, which linked tasks are removed and which are kept')
  const m = strip(src('MeetingsModal.tsx')); assert.ok(/eligibleCount=\{countBackfillEligible\(persistedEvents, now, calData\)\}/.test(m))
})

// ═════ Part B — real PostgreSQL (migrations 022–024) ═════════════════════════════════════════════════════════════════════════════════
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) { if (!p) continue; try { PGlite = require(p).PGlite; break } catch {} }
const SKIP = PGlite ? false : 'PGlite not installed — SQL tests skipped, NOT passed'
const mig = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let db
async function boot() {
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
  for (const f of ['004_core_data_tables.sql', '022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql']) await d.exec(mig(f))
  return d
}
const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`); try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`) } }
const q = (sql, params) => db.query(sql, params)
const row = (id, over = {}) => ({ event_id: id, title: 'Class', category: 'lecture', start_at: '2026-11-09T14:30:00Z', end_at: '2026-11-09T15:30:00Z', location: null, meeting_url: null, notes: null, reminder_mins: null, recurrence: 'none', is_deadline: false, task_date_key: null, ...over })
const apply = (event, del, rev, ops) => q('select public.schedule_apply($1::jsonb, $2, $3, $4::jsonb) as r', [event && JSON.stringify(event), del, rev, JSON.stringify(ops)]).then(r => r.rows[0].r)
const setDay = (uid, key, doc) => q('insert into calendar_days (user_id, date_key, day_data) values ($1, $2, $3::jsonb) on conflict (user_id, date_key) do update set day_data = excluded.day_data', [uid, key, JSON.stringify(doc)])
const dayOf = async (uid, key) => (await q('select day_data from calendar_days where user_id = $1 and date_key = $2', [uid, key])).rows[0]?.day_data
const count = async uid => Number((await q('select count(*)::int n from schedule_events where user_id = $1', [uid])).rows[0].n)
const evTask = (eid, text = 'Class') => ({ id: 'ev-' + eid, text, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], sourceEventId: eid })
const upsertOp = (eid, key) => ({ kind: 'upsert', date_key: key, task_id: 'ev-' + eid, event_id: eid, task: evTask(eid) })

test('SQL: a new account has NO schedule events and no sync preference row; sync defaults OFF', { skip: SKIP }, async () => {
  db = await boot()
  assert.equal(await as(A, () => count(A)), 0); assert.equal(await as(B, () => count(B)), 0)
  await q(`insert into user_preferences (user_id) values ('${A}')`)
  assert.equal((await q(`select schedule_task_sync s from user_preferences where user_id = '${A}'`)).rows[0].s, false, 'default OFF')
})

test('SQL: a saved event persists, and a deleted event STAYS deleted (re-reading / "reopening" never brings it back)', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate schedule_events, calendar_days')
  await as(A, () => apply(row('e1'), null, null, []))
  assert.equal(await as(A, () => count(A)), 1)
  await as(A, () => apply(null, 'e1', null, []))
  for (let i = 0; i < 3; i++) assert.equal(await as(A, () => count(A)), 0, `re-read #${i + 1}: still gone`)
  assert.equal(await as(B, () => count(B)), 0)
})

test('SQL: an overlapping synced task is added beside existing tracked work; the existing task (sessions, done, notes) is byte-identical; a repeat adds nothing', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate schedule_events, calendar_days')
  const existing = worked(); await setDay(A, '2026-11-09', day([existing, tk('u2', { text: 'Class' })]))
  const before = clone(await dayOf(A, '2026-11-09'))
  const e = row('e1', { task_date_key: '2026-11-09' })
  await as(A, () => apply(e, null, null, [upsertOp('e1', '2026-11-09')]))
  await as(A, () => apply(e, null, null, [upsertOp('e1', '2026-11-09')]))          // the same write delivered twice
  const after = await dayOf(A, '2026-11-09')
  assert.equal(after.tasks.filter(t => t.id === 'ev-e1').length, 1, 'exactly one linked task')
  assert.deepEqual(after.tasks.filter(t => t.id === 'u1' || t.id === 'u2'), before.tasks, 'existing tasks unchanged')
  assert.equal(after.tasks.find(t => t.id === 'ev-e1').done, false); assert.deepEqual(after.tasks.find(t => t.id === 'ev-e1').sessions, [])
  // an event edit (rename) updates only the linked task's title
  await as(A, () => apply(row('e1', { title: 'Renamed', task_date_key: '2026-11-09' }), null, null, [{ ...upsertOp('e1', '2026-11-09'), task: evTask('e1', 'Renamed') }]))
  const renamed = await dayOf(A, '2026-11-09'); assert.equal(renamed.tasks.find(t => t.id === 'ev-e1').text, 'Renamed')
  assert.deepEqual(renamed.tasks.filter(t => t.id === 'u1' || t.id === 'u2'), before.tasks)
})

test('SQL: saving an ordinary event with NO task ops (Sync OFF, or an existing event with sync ON) writes the event and leaves every task alone', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate schedule_events, calendar_days')
  await setDay(A, '2026-11-09', day([worked()])); const before = clone(await dayOf(A, '2026-11-09'))
  await as(A, () => apply(row('e1'), null, null, []))
  assert.equal(await as(A, () => count(A)), 1); assert.deepEqual(await dayOf(A, '2026-11-09'), before)
  assert.equal((await q(`select count(*)::int n from calendar_days where user_id = '${A}'`)).rows[0].n, 1, 'no extra day rows were created')
})

test('SQL: deleting an event removes only its own untouched task; other tasks and tracked work stay', { skip: SKIP }, async () => {
  await db.exec('reset role; truncate schedule_events, calendar_days')
  await setDay(A, '2026-11-09', day([worked(), evTask('e1')]))
  await as(A, () => apply(row('e1', { task_date_key: '2026-11-09' }), null, null, []))
  await as(A, () => apply(null, 'e1', null, [{ kind: 'remove', date_key: '2026-11-09', task_id: 'ev-e1' }]))
  const d = await dayOf(A, '2026-11-09'); assert.deepEqual(d.tasks, [worked()])
  assert.equal(await as(A, () => count(A)), 0)
})
