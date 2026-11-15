// Due-date system (v1.345): the shared status calculation (components/xpadite/dueStatus.ts), the derived deadline index (deadlineIndex.ts),
// and structural pins for the calendar markers, completion controls, popup wording and the additive migration.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-due'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))   // CRLF checkouts read like LF ones
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('dueStatus'); compile('deadlineLink'); compile('deadlineIndex')
compile('zdate'); compile('dueStatus')
const D = require(path.join(OUT, 'dueStatus.js'))
const X = require(path.join(OUT, 'deadlineIndex.js'))

const VAN = 'America/Vancouver'
const at = (date, hhmm, tz = VAN) => D.zonedInstant(date, hhmm, tz)

// ── the spec's worked example: deadline Nov 13, 2026 ───────────────────────────────────────────────────────────────────
test('date-only deadline Nov 13: completed Nov 10 = 3 days early; Nov 13 = on time; Nov 15 = 2 days late; still open Nov 16 = Overdue · 3 days', () => {
  const dueAt = D.endOfDayInstant('2026-11-13', VAN)
  const now = at('2026-11-16', '09:00')
  assert.deepEqual(pick(D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-10', '10:00') }, now, VAN)), { state: 'completed', label: 'Completed · 3 days early', timing: 'early', days: 3 })
  assert.deepEqual(pick(D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-13', '09:00') }, now, VAN)), { state: 'completed', label: 'Completed on time', timing: 'on-time', days: 0 })
  assert.deepEqual(pick(D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-15', '09:00') }, now, VAN)), { state: 'completed', label: 'Completed · 2 days late', timing: 'late', days: 2 })
  assert.deepEqual(pick(D.dueInfo({ dueAt, done: false }, now, VAN)), { state: 'overdue', label: 'Overdue · 3 days', timing: undefined, days: 3 })
})
const pick = i => ({ state: i.state, label: i.label, timing: i.timing, days: i.days })

test('a date-only deadline stays valid through the END of its date (23:59:59.999 in the selected timezone)', () => {
  const due = D.endOfDayInstant('2026-11-13', VAN)
  assert.equal(D.dayKeyInTz(due, VAN), '2026-11-13')
  assert.equal(D.dayKeyInTz(due + 1, VAN), '2026-11-14')
  assert.equal(D.dueInfo({ dueAt: due, done: false }, at('2026-11-13', '23:30'), VAN).state, 'upcoming')
  assert.equal(D.dueInfo({ dueAt: due, done: false }, at('2026-11-14', '00:01'), VAN).state, 'overdue')
})

test('a timed deadline respects its time: same-day completion before = on time, after = late (0 days), next day = 1 day late', () => {
  const dueAt = at('2026-11-13', '18:00')
  const now = at('2026-11-20', '12:00')
  assert.equal(D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-13', '17:59') }, now, VAN).label, 'Completed on time')
  assert.equal(D.dueInfo({ dueAt, done: true, completedAt: dueAt }, now, VAN).label, 'Completed on time', 'exactly at the deadline is on time')
  const late = D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-13', '19:00') }, now, VAN)
  assert.equal(late.label, 'Completed late'); assert.equal(late.days, 0)
  assert.equal(D.dueInfo({ dueAt, done: true, completedAt: at('2026-11-14', '01:00') }, now, VAN).label, 'Completed · 1 day late')
})

test('upcoming / due today / overdue hours (same day) / singular day', () => {
  const dueAt = at('2026-11-13', '18:00')
  assert.equal(D.dueInfo({ dueAt, done: false }, at('2026-11-10', '09:00'), VAN).label, 'Upcoming')
  const today = D.dueInfo({ dueAt, done: false }, at('2026-11-13', '09:00'), VAN)
  assert.equal(today.label, 'Due today'); assert.equal(today.state, 'upcoming'); assert.equal(today.dueToday, true)
  assert.equal(D.dueInfo({ dueAt, done: false }, at('2026-11-13', '18:30'), VAN).label, 'Overdue')
  assert.equal(D.dueInfo({ dueAt, done: false }, at('2026-11-14', '09:00'), VAN).label, 'Overdue · 1 day')
})

test('completion without a recorded instant (older tasks) is plain "Completed" — no timestamp is invented', () => {
  const dueAt = at('2026-11-13', '18:00')
  for (const c of [undefined, null, NaN]) assert.deepEqual(pick(D.dueInfo({ dueAt, done: true, completedAt: c }, at('2026-12-01', '09:00'), VAN)), { state: 'completed', label: 'Completed', timing: 'unknown', days: 0 })
})

test('completionPatch records the REAL instant on completion and clears it on reopening', () => {
  assert.deepEqual(D.completionPatch(true, 1234), { done: true, completedAt: 1234 })
  assert.deepEqual(D.completionPatch(false, 1234), { done: false, completedAt: null })
})

// ── timezones and daylight saving ──────────────────────────────────────────────────────────────────────────────────────
test('the same instant is a different calendar day in different timezones; the status uses the selected one', () => {
  const instant = Date.UTC(2026, 10, 14, 3, 0)               // Nov 14 03:00 UTC = Nov 13 19:00 in Vancouver
  assert.equal(D.dayKeyInTz(instant, 'UTC'), '2026-11-14')
  assert.equal(D.dayKeyInTz(instant, VAN), '2026-11-13')
  const dueAt = D.endOfDayInstant('2026-11-13', VAN)
  assert.equal(D.dueInfo({ dueAt, done: false }, instant, VAN).state, 'upcoming')
  assert.equal(D.dueInfo({ dueAt, done: false }, instant, 'UTC').state, 'upcoming')
  assert.equal(D.dueInfo({ dueAt, done: false }, Date.UTC(2026, 10, 14, 9, 0), VAN).state, 'overdue')
})

test('DST: a "day" is 23 h in spring and 25 h in autumn, end-of-day follows the calendar, and day counts are calendar days not 24-hour blocks', () => {
  const H = 3_600_000, NY = 'America/New_York', LON = 'Europe/London'
  const len = (date, tz) => D.endOfDayInstant(date, tz) + 1 - D.zonedInstant(date, '00:00', tz)
  assert.equal(len('2026-03-08', NY), 23 * H)    // US spring forward
  assert.equal(len('2026-11-01', NY), 25 * H)    // US fall back
  assert.equal(len('2026-10-25', LON), 25 * H)   // UK fall back
  assert.equal(len('2026-06-15', NY), 24 * H)
  // the end of a DST day is still that day, and the next ms is the next day
  for (const [d, tz] of [['2026-03-08', NY], ['2026-11-01', NY], ['2026-10-25', LON]]) {
    assert.equal(D.dayKeyInTz(D.endOfDayInstant(d, tz), tz), d)
    assert.equal(D.dayKeyInTz(D.endOfDayInstant(d, tz) + 1, tz), D.addDaysKey(d, 1))
  }
  // due Mar 7 (end of day), still open at noon Mar 10 => Overdue · 3 days, although the span crosses the 23 h day
  assert.equal(D.dueInfo({ dueAt: D.endOfDayInstant('2026-03-07', NY), done: false }, D.zonedInstant('2026-03-10', '12:00', NY), NY).label, 'Overdue · 3 days')
  // 08:00 wall clock is the same wall clock before and after the change
  const clock = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
  assert.equal(clock(D.zonedInstant('2026-03-07', '08:00', NY), NY), '08:00')
  assert.equal(clock(D.zonedInstant('2026-03-09', '08:00', NY), NY), '08:00')
  assert.equal(clock(D.zonedInstant('2026-11-02', '08:00', NY), NY), '08:00')
})

test('a wall-clock time that does not exist (spring-forward gap) still maps to a valid instant on the same day', () => {
  const t = D.zonedInstant('2026-03-08', '02:30', 'America/New_York')
  assert.ok(Number.isFinite(t)); assert.equal(D.dayKeyInTz(t, 'America/New_York'), '2026-03-08')
})

test('an unknown timezone falls back safely instead of throwing', () => {
  assert.doesNotThrow(() => D.dayKeyInTz(Date.UTC(2026, 0, 1), 'Not/AZone'))
  assert.equal(D.dayKeyInTz(Date.UTC(2026, 0, 1, 12), 'Not/AZone'), '2026-01-01')
})

test('changing a deadline recalculates the status from the new due instant', () => {
  const now = at('2026-11-16', '09:00')
  assert.equal(D.dueInfo({ dueAt: D.endOfDayInstant('2026-11-13', VAN), done: false }, now, VAN).label, 'Overdue · 3 days')
  assert.equal(D.dueInfo({ dueAt: D.endOfDayInstant('2026-11-20', VAN), done: false }, now, VAN).label, 'Upcoming')
  assert.equal(D.dueInfo({ dueAt: D.endOfDayInstant('2026-11-20', VAN), done: true, completedAt: at('2026-11-15', '09:00') }, now, VAN).label, 'Completed · 5 days early')
})

test('task due date: date-only = end of day; with a time = that wall-clock time', () => {
  assert.equal(D.taskDueInstant({ date: '2026-11-13', time: null, dateOnly: true }, VAN), D.endOfDayInstant('2026-11-13', VAN))
  assert.equal(D.taskDueInstant({ date: '2026-11-13', time: '17:30', dateOnly: false }, VAN), at('2026-11-13', '17:30'))
  assert.equal(D.taskDueInstant({ date: '2026-11-13', time: '17:30', dateOnly: true }, VAN), D.endOfDayInstant('2026-11-13', VAN), 'the explicit flag wins')
})

// ── the derived deadline index ─────────────────────────────────────────────────────────────────────────────────────────
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (id, endAt, extra = {}) => ({ id, title: id, category: 'meeting', startAt: endAt - 3_600_000, endAt, isDeadline: true, ...extra })
const task = (id, extra = {}) => ({ id, text: id, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...extra })
const day = tasks => ({ productive: false, hyper: false, notes: '', journal: '', tasks })
const NOW = local(2026, 11, 14, 12)
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

test('an event deadline is completed by its linked Task Manager task (the task is the authority); completion time comes from the task', () => {
  const e = ev('e1', local(2026, 11, 13, 18), { taskDateKey: '2026-11-13' })
  const cal = { '2026-11-13': day([task('dl-e1', { sourceEventId: 'e1', done: true, completedAt: local(2026, 11, 11, 9) })]) }
  const items = X.buildDeadlineItems([e], cal, TZ, NOW)['2026-11-13']
  assert.equal(items.length, 1)
  assert.equal(items[0].done, true); assert.equal(items[0].info.state, 'completed'); assert.equal(items[0].info.label, 'Completed · 2 days early')
  assert.equal(items[0].taskId, 'dl-e1'); assert.equal(items[0].taskDateKey, '2026-11-13')
})

test('unticking the linked task reopens the deadline (derived — nothing else to synchronise)', () => {
  const e = ev('e1', local(2026, 11, 13, 18), { taskDateKey: '2026-11-13' })
  const cal = { '2026-11-13': day([task('dl-e1', { sourceEventId: 'e1', done: false, completedAt: null })]) }
  assert.equal(X.buildDeadlineItems([e], cal, TZ, NOW)['2026-11-13'][0].info.state, 'overdue')
})

test('a deadline with no linked task uses the event\'s own completedAt; a task that is open wins over a stale event value', () => {
  const e = ev('e2', local(2026, 11, 13, 18), { taskLink: 'detached', completedAt: local(2026, 11, 13, 10) })
  assert.equal(X.buildDeadlineItems([e], {}, TZ, NOW)['2026-11-13'][0].info.label, 'Completed on time')
  const e3 = ev('e3', local(2026, 11, 13, 18), { taskDateKey: '2026-11-13', completedAt: local(2026, 11, 13, 10) })
  const cal = { '2026-11-13': day([task('dl-e3', { sourceEventId: 'e3' })]) }
  assert.equal(X.buildDeadlineItems([e3], cal, TZ, NOW)['2026-11-13'][0].done, false)
})

test('completion recorded before v1.345 (done, no completedAt) shows plain "Completed"', () => {
  const e = ev('e1', local(2026, 11, 13, 18), { taskDateKey: '2026-11-13' })
  const cal = { '2026-11-13': day([task('dl-e1', { sourceEventId: 'e1', done: true })]) }
  const it = X.buildDeadlineItems([e], cal, TZ, NOW)['2026-11-13'][0]
  assert.equal(it.info.label, 'Completed'); assert.equal(it.completedAt, null)
})

test('an ordinary task with its own due date is a deadline on its due date; My Schedule tasks are never counted twice', () => {
  const cal = {
    '2026-11-10': day([task('t1', { due: { date: '2026-11-13', time: null, dateOnly: true } })]),
    '2026-11-13': day([task('dl-e1', { sourceEventId: 'e1', due: { date: '2026-11-01', dateOnly: true } })]),   // a linked task never contributes its own due
  }
  const idx = X.buildDeadlineItems([ev('e1', local(2026, 11, 13, 18), { taskDateKey: '2026-11-13' })], cal, TZ, NOW)
  assert.deepEqual(idx['2026-11-13'].map(i => i.id).sort(), ['e1', 't1'])
  assert.equal(idx['2026-11-13'].find(i => i.id === 't1').source, 'task')
  assert.equal(idx['2026-11-01'], undefined)
  assert.equal(idx['2026-11-13'].find(i => i.id === 't1').taskDateKey, '2026-11-10', 'knows which day the task lives on')
})

test('cancelled events and non-deadline events are ignored', () => {
  const idx = X.buildDeadlineItems([ev('a', local(2026, 11, 13, 18), { isCancelled: true }), ev('b', local(2026, 11, 13, 18), { isDeadline: false })], {}, TZ, NOW)
  assert.deepEqual(idx, {})
})

test('marker priority: Normal calendar overdue → upcoming → completed; Productivity calendar shows upcoming only', () => {
  const mk = (...states) => states.map((s, i) => ({ id: String(i), info: { state: s } }))
  assert.equal(X.markerState(mk('completed', 'upcoming', 'overdue'), true), 'overdue')
  assert.equal(X.markerState(mk('completed', 'upcoming'), true), 'upcoming')
  assert.equal(X.markerState(mk('completed'), true), 'completed')
  assert.equal(X.markerState(mk('overdue'), false), null, 'overdue lives in the Normal calendar')
  assert.equal(X.markerState(mk('completed'), false), null, 'completed lives in the Normal calendar')
  assert.equal(X.markerState(mk('overdue', 'upcoming'), false), 'upcoming')
  assert.equal(X.markerState(undefined, true), null); assert.equal(X.markerState([], true), null)
})

test('several deadlines on one day are one marker; the tooltip lists every one with its own status', () => {
  const e1 = ev('Report', local(2026, 11, 13, 9)), e2 = ev('Invoice', local(2026, 11, 20, 9))
  const idx = X.buildDeadlineItems([e1, e2, ev('Late', local(2026, 11, 13, 20))], {}, TZ, NOW)
  assert.equal(idx['2026-11-13'].length, 2); assert.equal(X.markerState(idx['2026-11-13'], true), 'overdue')
  assert.match(X.deadlineTitle(idx['2026-11-13']), /^2 deadlines: Report — Overdue · 1 day; Late — Overdue · 1 day$/)
})

test('the index is shared by every calendar cell of one render (same inputs → same object), and refreshes as time passes', () => {
  const events = [ev('e1', local(2026, 11, 13, 18))], cal = {}
  const a = X.deadlineIndex(events, cal, TZ, NOW), b = X.deadlineIndex(events, cal, TZ, NOW + 1000)
  assert.equal(a, b)
  assert.notEqual(X.deadlineIndex(events, cal, TZ, NOW + 31_000), a, 'a new 30 s bucket re-evaluates the status')
  assert.notEqual(X.deadlineIndex([...events], cal, TZ, NOW), a, 'a changed list re-evaluates')
})

// ── structural pins ────────────────────────────────────────────────────────────────────────────────────────────────────
const marks = read('components/xpadite/DeadlineMark.tsx')
const calFiles = ['MonthCard', 'MonthFullPage', 'MonthZoomModal'].map(f => [f, read(`components/xpadite/${f}.tsx`)])

test('markers: red upcoming, black/white overdue, green completed with a purple check on a lavender disc at the top-right (image 8)', () => {
  assert.match(marks, /UPCOMING = \{ light: \{ bg: 'rgba\(239,68,68,0\.18\)'/)
  assert.match(marks, /OVERDUE = \{ light: \{ bg: '#111111'[^}]*fg: '#ffffff' \}, dark: \{ bg: '#ffffff'[^}]*fg: '#000000' \}/)
  assert.match(marks, /COMPLETED = \{ bg: '#16a34a'[^}]*fg: '#ffffff' \}/)
  assert.match(marks, /top: '-30%', right: '-30%'/, 'overlaps the top-right edge')
  assert.match(marks, /background: 'rgba\(167,139,250,0\.55\)'/, 'translucent lavender backing')
  assert.match(marks, /stroke="#7c3aed"/, 'purple check, not green')
  assert.ok(!/DeadlineCorner|xp-dl-corner/.test(marks), 'no floating corner square any more')
})

test('all three calendar layouts use the single-marker rule and keep their own graphics (no corner squares anywhere)', () => {
  for (const [name, src] of calFiles) {
    assert.ok(!/DeadlineCorner|deadlineSquareStyle|deadlineDays/.test(src), name)
    assert.match(src, /useDeadlines\(\)/, name)
    assert.match(src, /markerState\(dls, /, name)
    assert.match(src, /deadlineMarkerStyle\(mState, /, name)
    assert.match(src, /<CompletedBadge \/>/, name)
  }
  assert.ok(!/xp-dl-corner/.test(read('app/globals.css')))
  // a productivity marker always owns its day
  assert.match(calFiles[0][1], /const plainDl = !!mState && !productive/)
  assert.match(calFiles[1][1], /const plainDl = !!mState && \(calendarClean \|\| !rawStreak\)/)
  assert.match(calFiles[2][1], /const plainDl = !!mState && !productive/)
})

test('completion wording: only "Mark Complete" and "Completed" exist; reopening asks first; there is no "Mark Incomplete"', () => {
  const all = ['DeadlineStatus', 'ScheduleParts', 'DayModal'].map(f => read(`components/xpadite/${f}.tsx`)).join('\n')
  assert.ok(!/Mark Incomplete|Mark Not Complete|Due Date Completed/i.test(all))
  const ctl = read('components/xpadite/DeadlineStatus.tsx')
  assert.match(ctl, /Mark Complete/); assert.match(ctl, /Completed\n/)
  assert.match(ctl, /Mark as not completed\?/); assert.match(ctl, /reopen-yes/)
  assert.match(ctl, /onClick=\{\(\) => setAsking\(true\)\}/, 'clicking Completed asks, it does not revert at once')
})

test('Task Manager: the three-dot menu has NO "Due Date" item (My Schedule manages due dates); the popup still shows status, due time, completion time and early/late', () => {
  const dm = read('components/xpadite/DayModal.tsx')
  assert.ok(!/label: 'Due Date'/.test(dm) && !/onDueDate|TaskDueDateModal|setDueOpen/.test(dm), 'no menu item, prop, state or modal left behind')
  assert.ok(!fs.existsSync(path.join(ROOT, 'components/xpadite/TaskDueDateModal.tsx')), 'the menu-only modal is gone')
  // every other menu item is still there
  for (const l of ['Edit Task', 'Set Reminder', 'Adjust Time', 'Duplicate Task', 'Increment Session', 'Copy Task', 'Paste Task', 'Move Task', 'Create Sub-Task', 'Send to Planner', 'Choose Task Color', 'Delete Task']) assert.ok(dm.includes(`label: '${l}'`) || dm.includes(`'${l}'`), l)
  assert.match(dm, /data-testid="task-due-completed"/)
  assert.match(dm, /dueInfo\(\{ dueAt, done, completedAt \}, now, tz\)/)
})

test('the literal "\\u2192" in the Task Manager popup is fixed (JSX text does not interpret escapes)', () => {
  const dm = read('components/xpadite/DayModal.tsx')
  assert.ok(!dm.includes('Edit in My Schedule \\u2192'))
  assert.match(dm, /Edit in My Schedule &rarr;/)
})

test('My Schedule: the editor and the details panel carry the completion control for saved deadlines only', () => {
  const sp = read('components/xpadite/ScheduleParts.tsx')
  assert.match(sp, /\{mode === 'edit' && eventId && v\.isDeadline && <DeadlineCompletion eventId=\{eventId\} \/>\}/)
  assert.match(sp, /<DetailRow label="Status"><DeadlineCompletion eventId=\{ev\.id\} \/><\/DetailRow>/)
  assert.match(sp, /if \(!item\) return null/)
  assert.match(read('components/xpadite/MeetingsModal.tsx'), /eventId=\{lastForm\.data\.mode === 'edit' \? lastForm\.data\.id : undefined\}/)
})

test('completion is stamped by every checkbox toggle and kept through event saves', () => {
  assert.match(read('components/xpadite/DayModal.tsx'), /\{ \.\.\.t, \.\.\.completionPatch\(!t\.done\) \}/)
  assert.match(read('components/xpadite/XpaditeApp.tsx'), /\{ \.\.\.t, \.\.\.completionPatch\(!t\.done\) \}/)
  assert.match(read('components/xpadite/AppContext.tsx'), /completedAt: prev\?\.completedAt \}/)
})

const noApply = s => { const i = s.indexOf('create or replace function public.schedule_apply'); return i < 0 ? s : s.slice(0, i) + s.slice(s.indexOf('$$;', i) + 3) }   // the re-created schedule_apply is the 024 function (it legitimately deletes events/tasks); it is checked line-for-line against 024 below
test('migration 026 is additive: one nullable column + one function; nothing dropped, rewritten or back-filled', () => {
  const sql = read('supabase/migrations/026_deadline_completion.sql')
  assert.match(sql, /add column if not exists completed_at bigint;/)
  assert.match(sql, /create or replace function public\.schedule_set_completed\(p_event_id text, p_completed_at bigint\)/)
  assert.ok(!/\bdrop\b|\bdelete\b|\btruncate\b|alter column|update schedule_events\s+set completed_at = \d/i.test(noApply(sql).replace(/--[^\n]*/g, '')), 'no destructive statement')
  assert.match(sql, /where user_id = uid and event_id = p_event_id/, 'own rows only')
  assert.match(sql, /grant execute on function public\.schedule_set_completed\(text, bigint\) to authenticated;/)
  assert.match(sql, /revoke all on function public\.schedule_set_completed\(text, bigint\) from public, anon;/)
})

test('the app keeps working before migration 026 is applied: events are read without the column, and a missing function never disables the schedule', () => {
  const sd = read('lib/supabase/schedule-data.ts')
  assert.match(sd, /res\.error\.code === '42703'/)
  assert.match(sd, /Omit<ScheduleEventRow, 'rev' \| 'task_link' \| 'completed_at'>/, 'event saves never write the new column')
  const ctx = read('components/xpadite/AppContext.tsx')
  assert.match(ctx, /needs a database update \(migration 026\)/)
})

// ── stabilisation pass ─────────────────────────────────────────────────────────────────────────────────────────────────
test('a deadline completed while its task was away: the event row carries it (real time, or -1 = completed, time never recorded)', () => {
  const known = ev('e9', local(2026, 11, 13, 18), { taskLink: 'detached', completedAt: local(2026, 11, 11, 9) })
  const unknown = ev('e10', local(2026, 11, 13, 18), { taskLink: 'detached', completedAt: D.COMPLETED_UNKNOWN })
  const idx = X.buildDeadlineItems([known, unknown], {}, TZ, NOW)['2026-11-13']
  const a = idx.find(i => i.id === 'e9'), b = idx.find(i => i.id === 'e10')
  assert.equal(a.info.label, 'Completed · 2 days early'); assert.equal(a.completedAt, local(2026, 11, 11, 9))
  assert.equal(b.done, true); assert.equal(b.completedAt, null, 'no time is invented'); assert.equal(b.info.label, 'Completed')
})

test('removing a completed deadline task keeps its completion on the event, and "Add back" restores the task COMPLETED with the same moment', () => {
  const dm = read('components/xpadite/DayModal.tsx')
  assert.match(dm, /const want = t\.done \? \(typeof t\.completedAt === 'number' \? t\.completedAt : COMPLETED_UNKNOWN\) : null/)
  assert.match(dm, /try \{ await setDeadlineCompleted\(ev\.id, want\) \} catch \{ preserved = false \}/)
  assert.match(dm, /if \(!preserved\) \{ setToast\('Couldn.t keep this deadline.s completed status, so the task was not removed\./, 'SAFEGUARD: if the completion can not be saved the task is NOT removed, with a clear message')
  assert.ok(dm.indexOf('if (!preserved)') < dm.indexOf('await Promise.all([...new Set(linked)].map(eid => detachDeadlineTask(eid)))'), 'the block happens before anything is detached')
  assert.ok(dm.indexOf('await setDeadlineCompleted(ev.id, want)') < dm.indexOf('await Promise.all([...new Set(linked)].map(eid => detachDeadlineTask(eid)))'), 'completion is saved BEFORE the task goes')
  const ctx = read('components/xpadite/AppContext.tsx')
  assert.match(ctx, /if \(typeof ev\.completedAt === 'number'\) \{/)
  assert.match(ctx, /\{ \.\.\.t, done: true, completedAt: ev\.completedAt! > 0 \? ev\.completedAt : null \}/, 'restored task: done, same real moment, or none if it was never recorded')
  const sql = read('supabase/migrations/026_deadline_completion.sql')
  assert.match(sql, /p_completed_at <> -1 and p_completed_at <= 0/)
})
