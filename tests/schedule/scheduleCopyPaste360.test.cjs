// v1.360 — My Schedule Copy & Paste. The REAL modules (scheduleEngine.ts copy / paste logic, the conflict rule, the reminder due-time maths and the Task Manager
// sync planner) are compiled and run; the wiring is pinned structurally. Nothing here touches a database; real persistence, cross-device refresh and touch behaviour are
// covered by the browser run and by the manual checks listed in the v1.360 report.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-copypaste-v1360'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const compile = (srcPath, name) => fs.writeFileSync(path.join(OUT, name + '.js'), ts.transpileModule(read(srcPath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  .replace(/require\("@\/lib\/push\/([A-Za-z]+)"\)/g, 'require("./$1")').replace(/require\("@\/components\/xpadite\/([A-Za-z]+)"\)/g, 'require("./$1")'))
for (const n of ['scheduleLogic', 'scheduleEngine', 'zdate', 'dueStatus', 'deadlineLink', 'dueSync']) { try { compile(`components/xpadite/${n}.ts`, n) } catch { /* optional helper */ } }
compile('lib/push/reminderDue.ts', 'reminderDue')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))
const D = require(path.join(OUT, 'reminderDue.js'))
let DL = null; try { DL = require(path.join(OUT, 'deadlineLink.js')) } catch (e) { DL = null }

const MIN = 60_000, HOUR = 60 * MIN
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const IDS = ['lecture', 'meeting', 'assignment', 'study', 'personal', 'other', 'cat-custom']
const orig = (o = {}) => ({ id: 'orig-1', title: 'Success in College Revenue Deal', category: 'meeting', startAt: at(2026, 12, 15, 14), endAt: at(2026, 12, 15, 15), location: 'Room 4', meetingUrl: 'https://meet.example/abc', notes: 'Bring the deck', reminderMins: 30, recurrence: 'none', ...o })

// ═══ copy ═══
test('Copy remembers content + length only; the original object is never modified; synced / read-only events cannot be copied', () => {
  const ev = orig({ reminderAlarm: true, isDeadline: true, completedAt: 123, taskLink: 'detached', source: undefined })
  const before = JSON.stringify(ev)
  const c = E.copyEventClip(ev)
  assert.deepEqual(c, { title: ev.title, category: 'meeting', location: 'Room 4', meetingUrl: 'https://meet.example/abc', notes: 'Bring the deck', reminderMins: 30, reminderAlarm: true, recurrence: 'none', isDeadline: true, durationMs: HOUR })
  for (const k of ['id', 'completedAt', 'taskLink', 'taskDateKey', 'rev', 'source', 'readOnly', 'isCancelled', 'startAt', 'endAt']) assert.ok(!(k in c), 'not copied: ' + k)
  assert.equal(JSON.stringify(ev), before, 'the original is untouched')
  assert.equal(E.copyEventClip(orig({ readOnly: true })), null); assert.equal(E.copyEventClip(orig({ source: 'google', sourceLabel: 'Google Calendar' })), null); assert.equal(E.copyEventClip(null), null)
})
test('a reminder-less event copies with no reminder and no alarm, even if a stale alarm flag is present', () => {
  const c = E.copyEventClip(orig({ reminderMins: null, reminderAlarm: true, location: undefined, notes: undefined, meetingUrl: undefined }))
  assert.equal(c.reminderMins, null); assert.ok(!('reminderAlarm' in c)); assert.ok(!('location' in c) && !('notes' in c) && !('meetingUrl' in c))
})

// ═══ paste: time + duration ═══
test('Example 1: Tue Dec 15 2:00–3:00 PM pasted into Fri Dec 18 at 1:00 PM → Fri Dec 18 1:00–2:00 PM (the slot\'s one-hour cell does not limit the length)', () => {
  const c = E.copyEventClip(orig()); const p = E.pasteFromClip(c, at(2026, 12, 18, 13), 'new-1', IDS)
  assert.equal(p.startAt, at(2026, 12, 18, 13)); assert.equal(p.endAt, at(2026, 12, 18, 14))
})
test('Example 2: a 2 h 30 min event pasted at 9:00 AM runs 9:00–11:30 AM; any duration is kept, including past midnight', () => {
  const c = E.copyEventClip(orig({ startAt: at(2026, 12, 15, 14), endAt: at(2026, 12, 15, 16, 30) }))
  const p = E.pasteFromClip(c, at(2026, 12, 21, 9), 'n', IDS); assert.equal(p.endAt - p.startAt, 150 * MIN); assert.equal(p.endAt, at(2026, 12, 21, 11, 30))
  const late = E.pasteFromClip(c, at(2026, 12, 21, 23), 'n2', IDS); assert.equal(late.endAt, at(2026, 12, 22, 1, 30), 'crosses midnight like any overnight event')
  const overnight = E.copyEventClip(orig({ startAt: at(2026, 12, 15, 22), endAt: at(2026, 12, 16, 2) })); assert.equal(E.pasteFromClip(overnight, at(2026, 12, 19, 21), 'n3', IDS).endAt, at(2026, 12, 20, 1))
})
test('across a daylight-saving change the paste keeps the exact elapsed duration (absolute instants)', () => {
  const c = E.copyEventClip(orig({ startAt: at(2026, 3, 1, 10), endAt: at(2026, 3, 1, 12) }))
  const p = E.pasteFromClip(c, at(2026, 3, 8, 1), 'n', IDS); assert.equal(p.endAt - p.startAt, 2 * HOUR)
})

// ═══ paste: independence ═══
test('every paste is a NEW independent event: new id, no completion / task link / date / revision / source, status resets to upcoming; the clip survives for more pastes', () => {
  const c = E.copyEventClip(orig({ completedAt: at(2026, 12, 15, 15), taskLink: 'detached', isDeadline: true }))
  const a = E.pasteFromClip(c, at(2026, 12, 18, 13), 'new-a', IDS), b = E.pasteFromClip(c, at(2026, 12, 19, 13), 'new-b', IDS)
  assert.notEqual(a.id, b.id); assert.notEqual(a.id, 'orig-1')
  for (const e of [a, b]) for (const k of ['completedAt', 'taskLink', 'taskDateKey', 'rev', 'source', 'readOnly', 'isCancelled', 'sourceLabel']) assert.ok(!(k in e), `${k} must not be copied`)
  assert.deepEqual({ ...a, id: 'x', startAt: 0, endAt: 0 }, { ...b, id: 'x', startAt: 0, endAt: 0 }, 'identical content every time')
  a.title = 'edited'; assert.equal(b.title, orig().title); assert.equal(c.title, orig().title, 'editing a paste cannot change another paste or the clip')
})
test('properties kept: title, notes, location, link, category, type (deadline flag), recurrence; a deleted category falls back to Meeting', () => {
  const c = E.copyEventClip(orig({ category: 'cat-custom', recurrence: 'weekly', isDeadline: true }))
  const p = E.pasteFromClip(c, at(2026, 12, 18, 9), 'n', IDS)
  assert.deepEqual([p.title, p.notes, p.location, p.meetingUrl, p.category, p.recurrence, p.isDeadline], [orig().title, 'Bring the deck', 'Room 4', 'https://meet.example/abc', 'cat-custom', 'weekly', true])
  assert.equal(E.pasteFromClip(c, at(2026, 12, 18, 9), 'n', IDS.filter(x => x !== 'cat-custom')).category, 'meeting')
  assert.equal(p.endAt, at(2026, 12, 18, 10), 'a deadline\'s due date is the pasted event\'s own end')
})

// ═══ reminders ═══
test('reminders: the lead and the alarm type are kept; the trigger time is recalculated from the PASTED start (preset and custom leads, standard and Persistent Alarm, recurring)', () => {
  for (const [mins, alarm, rec] of [[5, false, 'none'], [30, false, 'none'], [30, true, 'none'], [690, false, 'none'], [1440, true, 'none'], [15, true, 'weekly'], [0, false, 'daily']]) {
    const c = E.copyEventClip(orig({ reminderMins: mins, reminderAlarm: alarm, recurrence: rec }))
    const start = at(2026, 12, 18, 13), p = E.pasteFromClip(c, start, 'n', IDS)
    assert.equal(p.reminderMins, mins); assert.equal(!!p.reminderAlarm, alarm); assert.equal(p.recurrence, rec)
    const fire = start - mins * MIN
    const due = D.dueReminders([{ eventId: p.id, title: p.title, startAt: p.startAt, reminderMins: p.reminderMins, recurrence: p.recurrence }], fire + 30_000, 'UTC', 5 * MIN)
    assert.ok(due.length >= 1 && due.some(d => d.fireAt === fire), `${mins}/${alarm}/${rec}: due exactly ${mins} min before the NEW start`)
    assert.ok(!due.some(d => d.fireAt === orig().startAt - mins * MIN), 'never the original event\'s time')
  }
  assert.ok(!('reminderAlarm' in E.pasteFromClip(E.copyEventClip(orig({ reminderMins: 30, reminderAlarm: false })), at(2026, 12, 18, 9), 'n', IDS)), 'Standard stays the default (no flag)')
})

// ═══ eligibility + conflicts ═══
test('pasting is allowed only into a slot that has not begun: past days and elapsed slots today are refused; later today and future weeks / months are fine', () => {
  const now = at(2026, 12, 15, 14, 10)
  assert.equal(E.canPasteAt(at(2026, 12, 14, 18), now), false, 'yesterday')
  assert.equal(E.canPasteAt(at(2026, 12, 15, 13), now), false, 'an earlier hour today')
  assert.equal(E.canPasteAt(at(2026, 12, 15, 14), now), false, 'the hour that already began (14:00 < 14:10)')
  assert.equal(E.canPasteAt(at(2026, 12, 15, 15), now), true, 'the next hour today')
  assert.equal(E.canPasteAt(at(2026, 12, 21, 9), now), true, 'next week'); assert.equal(E.canPasteAt(at(2027, 2, 3, 9), now), true, 'a later month')
  assert.equal(E.canPasteAt(now, now), true, 'exactly now is not yet elapsed'); assert.equal(E.canPasteAt(NaN, now), false)
})
test('the existing overlap policy applies to a paste: an overlapping time is refused with the existing message, a back-to-back time is fine', () => {
  const existing = [orig({ id: 'busy', title: 'Busy block', startAt: at(2026, 12, 18, 13), endAt: at(2026, 12, 18, 14) })]
  const c = E.copyEventClip(orig({ startAt: at(2026, 12, 15, 9), endAt: at(2026, 12, 15, 11) }))
  const clash = E.pasteFromClip(c, at(2026, 12, 18, 12), 'n', IDS)             // 12:00–14:00 overlaps 13:00–14:00
  const conflicts = E.findConflicts({ startAt: clash.startAt, endAt: clash.endAt }, existing)
  assert.equal(conflicts.length, 1); assert.match(E.conflictMessage(conflicts, clash.startAt, '12h'), /You already have 'Busy block'/)
  const fine = E.pasteFromClip(c, at(2026, 12, 18, 14), 'n2', IDS); assert.equal(E.findConflicts({ startAt: fine.startAt, endAt: fine.endAt }, existing).length, 0)
  const second = E.pasteFromClip(c, at(2026, 12, 18, 11), 'n3', IDS); assert.equal(E.findConflicts({ startAt: second.startAt, endAt: second.endAt }, [...existing]).length, 0, '11:00–13:00 touches but does not overlap 13:00')
})

// ═══ Task Manager ═══
test('Task Manager: a pasted deadline is a NEW event, so the existing sync planner gives it its OWN task (never the original\'s) and touches nothing of the original\'s', { skip: DL ? false : 'deadlineLink not loadable here' }, () => {
  const origId = 'orig-1', newId = 'user-sched-new'
  const cal = { '2026-12-15': { productive: false, hyper: false, notes: '', journal: '', tasks: [{ id: DL.linkedTaskId(origId, 'deadline'), text: 'Revenue Deal', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], sourceEventId: origId }] } }
  const snapshot = JSON.stringify(cal)
  const c = E.copyEventClip(orig({ isDeadline: true, startAt: at(2026, 12, 14, 9), endAt: at(2026, 12, 15, 15) }))
  const pasted = E.pasteFromClip(c, at(2026, 12, 20, 9), newId, IDS)
  for (const syncOn of [true, false]) {
    const plan = DL.planDeadlineSync(cal, newId, { title: pasted.title, startAt: pasted.startAt, endAt: pasted.endAt, isDeadline: true }, null, 'act1', undefined, 'linked', syncOn, true)
    const touched = plan.ops.map(o => o.task_id)
    assert.ok(!touched.includes(DL.linkedTaskId(origId, 'deadline')), 'the original\'s task is never referenced')
    for (const o of plan.ops) { assert.equal(o.kind, 'upsert'); assert.equal(o.task_id, DL.linkedTaskId(newId, 'deadline')); assert.equal(o.event_id, newId) }
    assert.ok(plan.ops.length <= 1, 'at most one task for the one pasted event')
  }
  assert.equal(JSON.stringify(cal), snapshot, 'planning is pure: the calendar was not modified')
})
test('Task Manager: a plain (non-deadline) paste follows the user\'s Sync switch exactly like Add / Duplicate — nothing when it is off; when it is on, ONE task of its own (named for the NEW event), never the original\'s', { skip: DL ? false : 'deadlineLink not loadable here' }, () => {
  const c = E.copyEventClip(orig()); const p = E.pasteFromClip(c, at(2026, 12, 20, 9), 'n', IDS)
  const ev = { title: p.title, startAt: p.startAt, endAt: p.endAt, isDeadline: false }
  assert.deepEqual(DL.planDeadlineSync({}, 'n', ev, null, 'act1', undefined, 'linked', false, true).ops, [], 'Sync off: no task work')
  const on = DL.planDeadlineSync({}, 'n', ev, null, 'act1', undefined, 'linked', true, true).ops
  assert.equal(on.length, 1); assert.equal(on[0].task_id, 'ev-n'); assert.equal(on[0].event_id, 'n'); assert.notEqual(on[0].task_id, DL.linkedTaskId('orig-1', 'event'))
})

// ═══ wiring ═══
test('wiring: Paste uses the SAME save path as Add / Duplicate (saveScheduleEvent), re-checks the slot and the overlap rule, guards double taps, never shows success on failure', () => {
  const m = read('components/xpadite/MeetingsModal.tsx')
  const a = m.slice(m.indexOf('async function pasteAt'), m.indexOf('async function undoLastPaste'))
  assert.match(a, /if \(!clip \|\| pasteBusyRef\.current\) return/); assert.match(a, /canPasteAt\(startAt, Date\.now\(\)\)/); assert.match(a, /pasteFromClip\(clip, startAt, newEventId\(\), categories\.map\(c => c\.id\)\)/)
  assert.match(a, /findConflicts\(\{ startAt: ev\.startAt, endAt: ev\.endAt \}, allEvents\)/); assert.match(a, /await saveScheduleEvent\(ev\)/)
  assert.ok(a.indexOf('catch (err)') > a.indexOf('await saveScheduleEvent') && a.indexOf("setToast('Event pasted successfully.')") > a.indexOf('catch (err)'), 'success is reported only after the save returned')
  assert.match(a, /catch \(err\) \{[\s\S]{0,160}return\s*\} finally \{ pasteBusyRef\.current = false \}/, 'a failed save returns before any success message and releases the guard')
  assert.doesNotMatch(a, /taskLink|taskDateKey|completedAt|sourceEventId|\.rev\b/, 'no task / completion / revision fields are written by the paste code')
  assert.match(m, /setToast\('Event copied\. Select an empty time slot to paste\.'\)/)
  const u = m.slice(m.indexOf('async function undoLastPaste'), m.indexOf('function formConflictFor'))
  assert.match(u, /await deleteScheduleEvent\(u\.id\)/, 'Undo removes only the pasted event, through the normal delete path (which also removes its own linked task)'); assert.match(u, /pasteBusyRef\.current/)
  assert.match(m, /window\.setTimeout\(\(\) => setUndoPaste\(null\), 8000\)/)
  assert.match(m, /const \[clip, setClip\] = useState<EventClip \| null>\(null\)/, 'the clipboard is in-memory only (no storage, no database)')
  assert.doesNotMatch(m.slice(m.indexOf('function copyEvent'), m.indexOf('function formConflictFor')), /localStorage|sessionStorage|supabase|fetch\(/)
})
test('wiring: the grid offers Paste only on an eligible slot and keeps + Add otherwise; Copy sits beside Duplicate with the same look; Duplicate and + Add are unchanged', () => {
  const v = read('components/xpadite/MyScheduleView.tsx')
  assert.match(v, /const pasteHere = !!slotHere && clipTitle !== null && canPasteAt\(/)
  assert.match(v, /\{pasteHere && \(\s*<button type="button" data-testid="slot-paste"/); assert.match(v, /\{!pasteHere && <button type="button" data-testid="slot-add"/)
  assert.match(v, /onAddAt\(d, slotHere\.min\) \}\}/, '+ Add still opens the Add form'); assert.match(v, /if \(isDoubleTap\(lastTapRef\.current, key, Date\.now\(\)\)\)[\s\S]{0,120}onAddAt\(d, min\)/, 'double tap still adds')
  assert.match(v, /<SchedulePasteBar clipTitle=\{clipTitle\}/)
  const p = read('components/xpadite/ScheduleParts.tsx')
  assert.match(p, /<button type="button" onClick=\{onDuplicate\} className="inline-flex items-center gap-1\.5 text-\[12px\] font-semibold"\s*\n\s*style=\{\{ padding: '6px 11px', borderRadius: 9, background: 'rgba\(124,58,237,0\.10\)', border: '0\.5px solid rgba\(124,58,237,0\.28\)', color: '#7c3aed' \}\}>/)
  assert.match(p, /data-testid="event-copy" onClick=\{onCopy\} className="inline-flex items-center gap-1\.5 text-\[12px\] font-semibold"\s*\n\s*style=\{\{ padding: '6px 11px', borderRadius: 9, background: 'rgba\(124,58,237,0\.10\)', border: '0\.5px solid rgba\(124,58,237,0\.28\)', color: '#7c3aed' \}\}>/, 'identical styling to Duplicate')
  assert.match(p, /<EventDetails ev=\{ev\} onEdit=\{onEdit\} onDelete=\{onDelete\} onDuplicate=\{onDuplicate\} onCopy=\{onCopy\} \/>/, 'the phone / tablet sheet shows Copy too')
  const bar = read('components/xpadite/SchedulePasteBar.tsx'); assert.match(bar, /Event copied/); assert.match(bar, /Cancel/); assert.match(bar, /Event pasted successfully\./); assert.match(bar, /Undo/)
})
test('no database, API, dependency or reminder-pipeline change: Copy & Paste adds no migration and touches none of the server reminder files', () => {
  const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(n => /^02[8-9]_|^03/.test(n)); assert.deepEqual(migs, ['028_reminder_alarm.sql'])
  for (const f of ['components/xpadite/SchedulePasteBar.tsx']) assert.doesNotMatch(read(f), /supabase|fetch\(|localStorage/)
  const e = read('components/xpadite/scheduleEngine.ts'); const added = e.slice(e.indexOf('v1.360 — Copy & Paste events'))
  assert.doesNotMatch(added, /supabase|fetch\(|localStorage|require\(/)
})
