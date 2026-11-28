// v1.361 — Deadline acknowledgment ("Did you meet the deadline…?") and the Deadlines panel. The REAL modules (dueStatus, deadlineAck, deadlineIndex, deadlineLink) are
// compiled and run; the panel / Hide wiring is pinned structurally and exercised in a browser run. No database is touched here.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-ack-v1361'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
for (const n of ['dueStatus', 'deadlineAck', 'deadlineIndex', 'deadlineLink', 'zdate', 'scheduleLogic']) fs.writeFileSync(path.join(OUT, n + '.js'), ts.transpileModule(read(`components/xpadite/${n}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
const S = require(path.join(OUT, 'dueStatus.js'))
const A = require(path.join(OUT, 'deadlineAck.js'))
const X = require(path.join(OUT, 'deadlineIndex.js'))
const DL = require(path.join(OUT, 'deadlineLink.js'))

const TZ = 'America/New_York'
const at = (date, hhmm, tz = TZ) => S.zonedInstant(date, hhmm, tz)
const MIN = 60_000

// ═══ the shared status calculation ═══
test('"Yes" after the due time is recorded as MET (not late), with no timestamp invented; completing before the due time is judged exactly as before; "No" then completing is plain Completed late', () => {
  const due = at('2026-11-27', '14:00'), afterDue = at('2026-11-27', '15:00')
  const met = S.dueInfo({ dueAt: due, done: true, completedAt: afterDue, outcome: 'met' }, afterDue + MIN, TZ)
  assert.deepEqual([met.state, met.label, met.timing], ['completed', 'Met deadline', 'on-time'])
  assert.equal(S.dueInfo({ dueAt: due, done: true, completedAt: afterDue, outcome: null }, afterDue + MIN, TZ).label, 'Completed late', 'without an answer the existing late classification is untouched')
  assert.equal(S.dueInfo({ dueAt: due, done: true, completedAt: due - 45 * MIN, outcome: 'met' }, afterDue, TZ).label, 'Completed on time', 'finished before the due time: judged from the real instant as always')
  assert.match(S.dueInfo({ dueAt: due, done: true, completedAt: due - 3 * 86400_000, outcome: 'met' }, afterDue, TZ).label, /3 days early/)
  assert.equal(S.dueInfo({ dueAt: due, done: true, completedAt: null, outcome: 'met' }, afterDue, TZ).label, 'Met deadline', 'a legacy completion with no recorded time + "met"')
  assert.equal(S.dueInfo({ dueAt: due, done: false, completedAt: null, outcome: 'missed' }, afterDue, TZ).state, 'overdue', 'No keeps the deadline open and overdue')
  const lateAfterNo = S.dueInfo({ dueAt: due, done: true, completedAt: afterDue + 2 * 86400_000, outcome: null }, afterDue + 3 * 86400_000, TZ)
  assert.deepEqual([lateAfterNo.state, lateAfterNo.timing], ['completed', 'late'])
  assert.equal(S.dueInfo({ dueAt: due, done: false }, due - MIN, TZ).state, 'upcoming')
})

// ═══ which answers count ═══
test('an answer counts only for the exact deadline it was given for, "met" only while done, "missed" only matters while open; malformed data is ignored', () => {
  const due = at('2026-11-27', '14:00')
  const ack = o => ({ dueAt: due, outcome: 'met', at: due + 3600_000, ...o })
  assert.equal(A.validAck(ack(), due, true), 'met'); assert.equal(A.validAck(ack(), due, false), null, 'reopened after "met": open and asked again')
  assert.equal(A.validAck(ack({ outcome: 'missed' }), due, false), 'missed'); assert.equal(A.validAck(ack({ outcome: 'missed' }), due, true), 'missed', 'still recorded (completion later is judged on its own)')
  assert.equal(A.validAck(ack(), due + 3600_000, true), null, 'the deadline was rescheduled: an old answer is not inherited')
  for (const bad of [undefined, null, {}, { dueAt: due }, { dueAt: due, outcome: 'maybe' }, 'met', 5]) assert.equal(A.validAck(bad, due, true), null)
})
test('the question appears only for an OPEN deadline whose time has been reached and which has no applicable answer', () => {
  const due = at('2026-11-27', '14:00')
  assert.equal(A.needsAck(false, due, due - 1, null), false, 'before the deadline time: no question'); assert.equal(A.needsAck(false, due, due, null), true, 'at the deadline time'); assert.equal(A.needsAck(false, due, due + 86400_000, null), true)
  assert.equal(A.needsAck(true, due, due + MIN, null), false, 'already completed (checkbox): never asked'); assert.equal(A.needsAck(false, due, due + MIN, 'missed'), false, 'already answered No'); assert.equal(A.needsAck(false, due, NaN, null), false)
})

// ═══ wording ═══
test('question wording: today / yesterday / earlier date, the deadline\'s OWN time (never hard-coded), 12- and 24-hour, account timezone, date-only deadlines, other years', () => {
  const now = at('2026-11-27', '16:30')
  assert.equal(A.ackQuestion(at('2026-11-27', '14:00'), false, now, TZ, true), 'Did you meet the deadline today at 2:00 PM?')
  assert.equal(A.ackQuestion(at('2026-11-27', '09:05'), false, now, TZ, true), 'Did you meet the deadline today at 9:05 AM?')
  assert.equal(A.ackQuestion(at('2026-11-26', '14:00'), false, now, TZ, true), 'Did you meet the deadline yesterday at 2:00 PM?')
  assert.equal(A.ackQuestion(at('2026-11-25', '14:00'), false, now, TZ, true), 'Did you meet the deadline on November 25 at 2:00 PM?')
  assert.equal(A.ackQuestion(at('2025-12-31', '23:15'), false, now, TZ, true), 'Did you meet the deadline on December 31, 2025 at 11:15 PM?', 'the year only when it differs')
  assert.match(A.ackQuestion(at('2026-11-27', '14:00'), false, now, TZ, false), /today at 14:00\?$/)
  assert.equal(A.ackQuestion(at('2026-11-27', '23:59'), true, now, TZ, true), 'Did you meet the deadline today?', 'a date-only deadline has no time to quote')
  const lateNight = Date.UTC(2026, 10, 28, 2, 0)                      // 9 PM on Nov 27 in New York, already Nov 28 in UTC
  assert.equal(A.ackQuestion(at('2026-11-27', '14:00'), false, lateNight, TZ, true), 'Did you meet the deadline today at 2:00 PM?', 'day words follow the account timezone, not the device or UTC')
  assert.equal(A.ackQuestion(at('2026-11-27', '14:00', 'Pacific/Auckland'), false, at('2026-11-27', '20:00', 'Pacific/Auckland'), 'Pacific/Auckland', true), 'Did you meet the deadline today at 2:00 PM?')
})

// ═══ the deadline index with real events and task documents ═══
const ev = (o = {}) => ({ id: 'ev1', title: 'Licensing Deal', category: 'assignment', startAt: at('2026-11-27', '13:00'), endAt: at('2026-11-27', '14:00'), isDeadline: true, taskDateKey: '2026-11-27', recurrence: 'none', ...o })
const task = (e, o = {}) => ({ id: DL.linkedTaskId(e.id, 'deadline'), text: e.title, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], sourceEventId: e.id, ...o })
const day = (tasks, acks) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...(acks ? { deadlineAcks: acks } : null) })
const item = (events, cal, now) => X.buildDeadlineItems(events, cal, TZ, now)['2026-11-27'][0]

test('index: asks only once the time is reached; an answer removes the question; Yes + done reads "Met deadline"; No keeps it open/overdue and silent; completing later is "Completed … late"', () => {
  const e = ev(), due = e.endAt
  const open = { '2026-11-27': day([task(e)]) }
  assert.equal(item([e], open, due - MIN).needsAck, false); assert.equal(item([e], open, due - MIN).info.state, 'upcoming')
  assert.equal(item([e], open, due + MIN).needsAck, true); assert.equal(item([e], open, due + MIN).info.state, 'overdue')
  const no = { '2026-11-27': day([task(e)], { ev1: { dueAt: due, outcome: 'missed', at: due + 5 * MIN } }) }
  const n = item([e], no, due + 10 * MIN); assert.deepEqual([n.needsAck, n.ack, n.done, n.info.state], [false, 'missed', false, 'overdue'])
  const yes = { '2026-11-27': day([task(e, { done: true, completedAt: due + 3600_000 })], { ev1: { dueAt: due, outcome: 'met', at: due + 3600_000 } }) }
  const y = item([e], yes, due + 2 * 3600_000); assert.deepEqual([y.needsAck, y.ack, y.done, y.info.label, y.info.state], [false, 'met', true, 'Met deadline', 'completed'])
  const lateAfterNo = { '2026-11-27': day([task(e, { done: true, completedAt: due + 86400_000 + 3600_000 })], { ev1: { dueAt: due, outcome: 'missed', at: due + 5 * MIN } }) }
  const l = item([e], lateAfterNo, due + 2 * 86400_000); assert.match(l.info.label, /^Completed · 1 day late$/); assert.equal(l.needsAck, false)
  const checkbox = { '2026-11-27': day([task(e, { done: true, completedAt: due - 30 * MIN })]) }
  const c = item([e], checkbox, due + 3600_000); assert.deepEqual([c.needsAck, c.info.label], [false, 'Completed on time'])
  const reopened = { '2026-11-27': day([task(e)], { ev1: { dueAt: due, outcome: 'met', at: due + 3600_000 } }) }
  assert.equal(item([e], reopened, due + 4 * 3600_000).needsAck, true, 'unchecked after "Yes": open again, asked again')
})
test('index: rescheduling does not inherit the old answer; a pasted / duplicated deadline (new event id) starts unanswered; two deadlines are answered independently', () => {
  const e = ev(), acks = { ev1: { dueAt: e.endAt, outcome: 'missed', at: e.endAt + MIN } }
  const moved = ev({ endAt: e.endAt + 2 * 3600_000 })
  const m = item([moved], { '2026-11-27': day([task(moved)], acks) }, moved.endAt + MIN); assert.deepEqual([m.needsAck, m.ack], [true, null])
  const copy = ev({ id: 'ev-copy', title: 'Licensing Deal' })
  const items = X.buildDeadlineItems([e, copy], { '2026-11-27': day([task(e), task(copy)], acks) }, TZ, e.endAt + 3600_000)['2026-11-27']
  const byId = Object.fromEntries(items.map(i => [i.id, i])); assert.deepEqual([byId.ev1.needsAck, byId['ev-copy'].needsAck], [false, true], 'the copy has its own unanswered question')
  const e2 = ev({ id: 'ev2', title: 'Second', startAt: at('2026-11-27', '15:00'), endAt: at('2026-11-27', '16:00') })
  const two = X.buildDeadlineItems([e, e2], { '2026-11-27': day([task(e), task(e2)], { ev1: { dueAt: e.endAt, outcome: 'missed', at: 1 } }) }, TZ, e2.endAt + MIN)['2026-11-27']
  assert.deepEqual(two.map(i => [i.id, i.needsAck]), [['ev1', false], ['ev2', true]])
})
test('index: a deadline with no linked task (removed on purpose) and a task with its own due date are asked and answered the same way', () => {
  const e = ev({ taskLink: 'detached' }), due = e.endAt
  const noTask = X.buildDeadlineItems([e], { '2026-11-27': day([], { ev1: { dueAt: due, outcome: 'missed', at: 1 } }) }, TZ, due + MIN)['2026-11-27'][0]
  assert.deepEqual([noTask.needsAck, noTask.ack], [false, 'missed']); assert.equal(X.buildDeadlineItems([e], { '2026-11-27': day([]) }, TZ, due + MIN)['2026-11-27'][0].needsAck, true)
  const own = { id: 't1', text: 'Write report', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], due: { date: '2026-11-27', time: '14:00', dateOnly: false } }
  const ownDue = S.zonedInstant('2026-11-27', '14:00', TZ)
  assert.equal(X.buildDeadlineItems([], { '2026-11-27': day([own]) }, TZ, ownDue + MIN)['2026-11-27'][0].needsAck, true)
  assert.equal(X.buildDeadlineItems([], { '2026-11-27': day([own], { t1: { dueAt: ownDue, outcome: 'missed', at: 1 } }) }, TZ, ownDue + MIN)['2026-11-27'][0].needsAck, false)
})

// ═══ structure: nothing stored outside the day document, Yes uses the existing completion path, Hide is temporary, visuals ═══
test('wiring: Yes completes through the existing setDone path BEFORE recording the answer; No only records; no migration, storage or server code is added', () => {
  const h = read('components/xpadite/useDeadlines.ts'), a = h.slice(h.indexOf('const acknowledge = useCallback'), h.indexOf('/** Sets (due) or clears'))
  assert.match(a, /if \(outcome === 'met' && !item\.done\) \{ if \(!\(await setDone\(item, true\)\)\) return false \}/); assert.ok(a.indexOf('setDone(item, true)') < a.indexOf('updateDay(item.dayKey'), 'the answer is recorded only after the completion succeeded')
  assert.match(a, /updateDay\(item\.dayKey, prev => withAck\(prev, item\.id, ack\)\)/); assert.doesNotMatch(a, /completedAt:|Date\.now\(\) - |fetch\(|supabase/, 'no completion time is invented')
  const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(n => /^02[8-9]_|^03/.test(n)); assert.deepEqual(migs, ['028_reminder_alarm.sql'])
  const ack = read('components/xpadite/deadlineAck.ts'); assert.doesNotMatch(ack.replace(/\/\/.*$/gm, ''), /localStorage|sessionStorage|fetch\(|supabase/)
})
test('wiring: the panel is charcoal #292630 with the specified colours, one Hide button, a collapse that frees its space (grid 1fr → 0fr + fade, 280 ms), reduced-motion respected, no Show button / storage', () => {
  const d = read('components/xpadite/DayModal.tsx'), p = d.slice(d.indexOf('data-testid="day-deadlines-wrap"'), d.indexOf('{/* Scrollable body */}'))
  for (const c of ['#292630', '#F5F3F8', '#C4BFCE', '#494451', '#168344', '#C63843', '#7c3aed']) assert.ok(p.includes(c), c)
  assert.equal((p.match(/data-testid="deadlines-hide"/g) || []).length, 1, 'one Hide button for the whole panel'); assert.match(p, />Hide<\/button>/)
  assert.match(p, /gridTemplateRows: dlHiding \? '0fr' : '1fr'/); assert.match(p, /grid-template-rows 280ms cubic-bezier\(0\.4, 0, 0\.2, 1\), opacity 240ms ease-in-out/)
  assert.match(d, /prefers-reduced-motion: reduce/); assert.match(d, /setTimeout\(finishHideDeadlines, 450\)/)
  assert.doesNotMatch(p, /Show deadlines|Deadlines hidden|localStorage|sessionStorage/)
  assert.match(p, /data-testid="deadline-ack-yes"[\s\S]{0,700}#168344[\s\S]{0,700}Yes/); assert.match(p, /data-testid="deadline-ack-no"[\s\S]{0,700}#C63843[\s\S]{0,700}No/)
  assert.match(d, /if \(ackBusyRef\.current\.has\(it\.id\)\) return/, 'rapid repeated taps are ignored per deadline')
  assert.match(d, /Could not save your answer\. Nothing was changed\./)
})
test('wiring: the hidden flag lives in the parent and is reset on EVERY Task Manager close path (so a reopened Task Manager shows the panel again), and is never persisted', () => {
  const x = read('components/xpadite/XpaditeApp.tsx')
  assert.match(x, /const \[deadlinesHidden, setDeadlinesHidden\]\s*=\s*useState\(false\)/); assert.match(x, /deadlinesHidden=\{deadlinesHidden\}\s*\n\s*onHideDeadlines=\{\(\) => setDeadlinesHidden\(true\)\}/)
  assert.equal((x.match(/setDeadlinesHidden\(false\)/g) || []).length, 2, 'both close paths reset it')
  assert.match(x, /setModalDay\(null\); setDeadlinesHidden\(false\)/); assert.match(x, /setModalDay\(null\)\n\s*setDeadlinesHidden\(false\)/)
  assert.doesNotMatch(x.slice(x.indexOf('const [deadlinesHidden'), x.indexOf('const [deadlinesHidden') + 400), /localStorage/)
})
test('the v1.360 Copy & Paste and the existing completion / sync code are untouched', () => {
  for (const f of ['components/xpadite/MeetingsModal.tsx', 'components/xpadite/MyScheduleView.tsx', 'components/xpadite/SchedulePasteBar.tsx', 'components/xpadite/AppContext.tsx', 'components/xpadite/deadlineLink.ts', 'components/xpadite/scheduleEngine.ts']) assert.doesNotMatch(read(f), /deadlineAcks|deadlineAck\b|needsAck/, f)
})
