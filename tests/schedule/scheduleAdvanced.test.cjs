// My Schedule — advanced frontend: conflict detection, drag-and-drop rules, empty-slot add, custom categories,
// preferences, duplicate, and structural checks for the menu / sidebar / gesture wiring.
// Real modules (components/xpadite/scheduleEngine.ts + scheduleLogic.ts), transpiled — not copies.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-adv'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleEngine')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))
// A small in-test fixture of OVERLAPPING events (the built-in sample schedule no longer exists in the app).
const buildSampleScheduleEvents = () => {
  const t = (d, h, mi = 0) => new Date(2026, 10, d, h, mi).getTime()
  const e = (id, title, d, h1, m1, h2, m2) => ({ id, title, category: 'meeting', startAt: t(d, h1, m1), endAt: t(d, h2, m2), recurrence: 'none' })
  return [e('fx-1', 'Presentation', 6, 8, 0, 9, 0), e('fx-2', 'Python Test', 6, 9, 30, 11, 30), e('fx-3', 'Lecture – Databases', 6, 9, 0, 10, 0), e('fx-4', 'Lunch', 6, 12, 0, 13, 0)]
}

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (id, s, e, extra = {}) => ({ id, title: id, category: 'meeting', startAt: s, endAt: e, ...extra })
const day = (y, m, d) => new Date(y, m - 1, d)
const D = (h, mi = 0) => at(2026, 11, 4, h, mi)           // Wed Nov 4 2026

// ── 1–2. overlap rule and back-to-back boundaries ───────────────────────────
test('interval rule: newStart < existingEnd && newEnd > existingStart', () => {
  assert.equal(E.intervalsOverlap(D(10), D(11), D(10, 30), D(12)), true)
  assert.equal(E.intervalsOverlap(D(9), D(10, 45), D(10), D(11)), true, 'the brief’s "not allowed" example')
  assert.equal(E.intervalsOverlap(D(9), D(18), D(10), D(11)), true, 'one fully inside another')
  assert.equal(E.intervalsOverlap(D(10), D(11), D(10), D(11)), true, 'identical intervals')
  assert.equal(E.intervalsOverlap(D(9), D(10), D(11), D(12)), false)
})
test('back-to-back events share a boundary without conflicting (the brief’s allowed chain)', () => {
  const a = ev('A', D(10), D(11, 45)), b = ev('B', D(11, 45), D(13)), c = ev('C', D(13), D(13, 45))
  assert.deepEqual(E.findConflicts({ startAt: b.startAt, endAt: b.endAt, excludeId: 'B' }, [a, b, c]), [])
  assert.deepEqual(E.findConflicts({ startAt: c.startAt, endAt: c.endAt, excludeId: 'C' }, [a, b, c]), [])
  assert.equal(E.findConflicts({ startAt: D(8), endAt: D(10) }, [a]).length, 0, 'ends exactly when A starts')
  assert.equal(E.findConflicts({ startAt: D(11, 45), endAt: D(12) }, [a]).length, 0, 'starts exactly when A ends')
  assert.equal(E.findConflicts({ startAt: D(11, 44), endAt: D(12) }, [a]).length, 1, 'one minute of overlap is a conflict')
})

// ── 3. cross-day ────────────────────────────────────────────────────────────
test('events crossing midnight conflict with both days they cover', () => {
  const late = ev('late', D(22), at(2026, 11, 5, 0, 30))
  assert.equal(E.findConflicts({ startAt: D(23), endAt: D(23, 30) }, [late]).length, 1)
  assert.equal(E.findConflicts({ startAt: at(2026, 11, 5, 0, 15), endAt: at(2026, 11, 5, 1) }, [late]).length, 1, 'next morning, inside the overhang')
  assert.equal(E.findConflicts({ startAt: at(2026, 11, 5, 0, 30), endAt: at(2026, 11, 5, 1) }, [late]).length, 0, 'starts exactly when the overnight event ends')
  // a candidate that itself crosses midnight
  assert.equal(E.findConflicts({ startAt: D(23), endAt: at(2026, 11, 5, 1) }, [ev('early', at(2026, 11, 5, 0, 30), at(2026, 11, 5, 2))]).length, 1)
  assert.equal(E.findConflicts({ startAt: D(21), endAt: D(22) }, [late]).length, 0)
})
// ── 4–5. self-exclusion, duplicate, form-level conflicts ────────────────────
test('editing never conflicts with the event itself, only with others', () => {
  const a = ev('A', D(9), D(10)), b = ev('B', D(10), D(11))
  assert.equal(E.findConflicts({ startAt: D(9), endAt: D(10, 30), excludeId: 'A' }, [a, b]).length, 1, 'stretching A into B conflicts with B…')
  assert.equal(E.findConflicts({ startAt: D(9), endAt: D(10, 30), excludeId: 'A' }, [a, b])[0].id, 'B', '…and never with A itself')
  assert.equal(E.findConflicts({ startAt: D(9, 15), endAt: D(9, 45), excludeId: 'A' }, [a, b]).length, 0)
})
test('cancelled and zero-length events occupy no time; external events DO block', () => {
  assert.equal(E.findConflicts({ startAt: D(9), endAt: D(10) }, [ev('c', D(9), D(10), { isCancelled: true })]).length, 0)
  assert.equal(E.findConflicts({ startAt: D(9), endAt: D(10) }, [ev('z', D(9, 30), D(9, 30))]).length, 0)
  const g = ev('meeting:g1', D(9), D(10), { readOnly: true, source: 'google', sourceLabel: 'Google Calendar' })
  const c = E.findConflicts({ startAt: D(9, 30), endAt: D(10, 30) }, [g]); assert.equal(c.length, 1)
  assert.match(E.conflictMessage(c, D(9, 30)), /\(Google Calendar\)/)
})
test('conflict message names the event and its occupied time, in the brief’s wording', () => {
  const lec = ev('Lecture — JavaScript', D(9), D(10, 45))
  assert.equal(E.conflictMessage([lec], D(10)), "You already have 'Lecture — JavaScript' scheduled from 9:00 AM to 10:45 AM. Please select another available time.")
  assert.match(E.conflictMessage([lec], D(10), '24h'), /from 09:00 to 10:45/)
  assert.match(E.conflictMessage([lec, ev('b', D(10), D(11)), ev('c', D(10), D(11))], D(10)), /2 other events also overlap/)
  assert.equal(E.conflictMessage([], D(10)), null)
  const overnight = ev('Late', D(22), at(2026, 11, 5, 0, 30))
  assert.match(E.conflictMessage([overnight], D(23)), /from Wed, Nov 4, 2026, 10:00 PM to Thu, Nov 5, 2026, 12:30 AM/, 'multi-day events state both dates')
})
const form = (o = {}) => ({ title: 'T', date: '2026-11-04', start: '10:00', end: '11:00', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none', ...o })
test('form conflicts: create, edit date/start/end/duration; inputs are never altered', () => {
  const events = [ev('A', D(9), D(10, 45))]
  const f = form({ start: '10:00', end: '11:00' }); const copy = JSON.stringify(f)
  assert.match(E.formConflict(f, events), /already have 'A'/)
  assert.equal(JSON.stringify(f), copy, 'the form values are untouched so the user can correct them')
  assert.equal(E.formConflict(form({ start: '10:45', end: '11:30' }), events), null, 'back-to-back is fine')
  assert.equal(E.formConflict(form({ start: '08:00', end: '09:01' }), events) !== null, true, 'duration change into A')
  assert.equal(E.formConflict(form({ date: '2026-11-05' }), events), null, 'another day')
  assert.equal(E.formConflict(form({ start: '12:00', end: '11:00' }), events), null, 'invalid ranges are the validator’s job, not a conflict')
  assert.equal(E.formConflict(form({ date: '2026-02-31' }), events), null)
})
test('editing: an event that already overlaps (sample data) stays editable until its TIME changes', () => {
  const a = ev('A', D(9), D(10, 45)), b = ev('B', D(10), D(11))                     // pre-existing overlap
  const events = [a, b]
  const same = form({ start: '10:00', end: '11:00' })
  assert.equal(E.formConflict(same, events, { excludeId: 'B', original: { startAt: b.startAt, endAt: b.endAt } }), null, 'title/notes edit with unchanged time is allowed')
  assert.match(E.formConflict(form({ start: '10:00', end: '11:15' }), events, { excludeId: 'B', original: { startAt: b.startAt, endAt: b.endAt } }), /already have 'A'/, 'changing the end re-checks')
  assert.equal(E.formConflict(form({ start: '11:00', end: '12:00' }), events, { excludeId: 'B', original: { startAt: b.startAt, endAt: b.endAt } }), null, 'moving it clear is fine')
})
test('Add / Duplicate: moving the start carries the end along (same length, capped at 23:59)', () => {
  const f = form({ start: '09:00', end: '10:30' })
  assert.deepEqual(['14:00', '15:30'], [E.withStartChange(f, { start: '14:00' }).start, E.withStartChange(f, { start: '14:00' }).end])
  assert.equal(E.withStartChange(f, { date: '2026-11-09' }).end, '10:30')
  assert.equal(E.withStartChange(f, { start: '23:00' }).end, '23:59')
  assert.deepEqual(E.withStartChange(f, { start: '' }).end, '10:30', 'a cleared start leaves the form alone')
})

// ── Duplicate ───────────────────────────────────────────────────────────────
test('duplicate: copies the content, recalculates the end from the original duration, picks a free slot, never edits the original', () => {
  const orig = ev('o1', D(9), D(10, 30), { title: 'Study', category: 'study', location: 'Library', notes: 'Ch. 4', meetingUrl: 'https://zoom.us/j/1', reminderMins: 15, recurrence: 'none' })
  const frozen = JSON.stringify(orig)
  const other = ev('x', D(10, 30), D(11, 30))
  const f = E.duplicateFormValues(orig, [orig, other])
  assert.deepEqual([f.title, f.category, f.location, f.notes, f.meetingUrl, f.reminderMins], ['Study', 'study', 'Library', 'Ch. 4', 'https://zoom.us/j/1', 15])
  assert.equal(f.date, '2026-11-04'); assert.equal(f.start, '11:30', 'first free slot at/after the original’s end')
  assert.equal(f.end, '13:00', '90 minutes, like the original')
  assert.equal(E.formConflict(f, [orig, other]), null, 'the suggestion itself is conflict-free')
  assert.equal(JSON.stringify(orig), frozen, 'original untouched')
  // choosing the SAME time as the original is a conflict (duplicate vs original)
  assert.match(E.formConflict({ ...f, start: '09:00', end: '10:30' }, [orig, other]), /already have 'Study'/)
})
test('duplicate eligibility: only XPadite events — never synced calendar events or ones with an external source', () => {
  assert.equal(E.canDuplicate(ev('mine', 1, 2)), true)
  assert.equal(E.canDuplicate(ev('meeting:g', 1, 2, { readOnly: true, source: 'google' })), false)
  assert.equal(E.canDuplicate(ev('odd', 1, 2, { source: 'microsoft' })), false)
  assert.equal(E.canDuplicate(null), false); assert.equal(E.canDuplicate(undefined), false)
  const f = E.duplicateFormValues(ev('meeting:g', D(9), D(10), { readOnly: true, source: 'google', sourceLabel: 'Google Calendar' }), [])
  assert.ok(!('source' in f) && !('readOnly' in f) && !('id' in f), 'no external identifiers can reach the form')
})
test('nextFreeStart skips occupied time, keeps a copy on one day and gives up after a week', () => {
  assert.equal(E.nextFreeStart([ev('a', D(9), D(12))], D(9), 3600_000), D(12))
  assert.equal(E.nextFreeStart([], D(23, 30), 3600_000), at(2026, 11, 5, 0), 'a 1-hour copy cannot start at 11:30 PM and stay on one day → next midnight')
  const wall = Array.from({ length: 9 }, (_, i) => ev('w' + i, at(2026, 11, 4 + i, 0), at(2026, 11, 5 + i, 0)))
  assert.equal(E.nextFreeStart(wall, D(9), 3600_000), null)
})

// ── 6–8, 14. drag & drop ────────────────────────────────────────────────────
test('drop on a free slot: new date/start/end, exact duration kept, 15-minute snap', () => {
  const e = ev('m', at(2026, 11, 2, 9), at(2026, 11, 2, 10, 30))                      // Mon 9:00–10:30
  const p = E.planMove(e, day(2026, 11, 5), 14 * 60 + 4, [e])                         // Thu, raw 2:04 PM → snaps to 2:00
  assert.equal(p.ok, true); assert.equal(p.startAt, at(2026, 11, 5, 14)); assert.equal(p.endAt, at(2026, 11, 5, 15, 30))
  assert.equal(p.endAt - p.startAt, e.endAt - e.startAt, 'duration preserved exactly')
  assert.equal(E.planMove(e, day(2026, 11, 5), 14 * 60 + 8, [e]).startAt, at(2026, 11, 5, 14, 15), '8 minutes rounds to the nearest 15')
  assert.equal(new Date(p.startAt).getDay(), 4, 'Thursday')
})
test('drop onto an occupied or overlapping interval is refused with the conflicting event named; nothing else moves', () => {
  const e = ev('m', D(9), D(10)), other = ev('Lunch', D(12), D(13))
  const list = [e, other]; const frozen = JSON.stringify(list)
  const p = E.planMove(e, day(2026, 11, 4), 12 * 60 + 30, list)
  assert.equal(p.ok, false); assert.equal(p.block, 'conflict'); assert.deepEqual(p.conflicts.map(c => c.id), ['Lunch'])
  assert.match(p.message, /already have 'Lunch' scheduled from 12:00 PM to 1:00 PM/)
  assert.equal(JSON.stringify(list), frozen, 'nothing was mutated')
  assert.equal(E.planMove(e, day(2026, 11, 4), 11 * 60 + 15, list).ok, false, '11:15–12:15 clips the start of Lunch')
  assert.equal(E.planMove(e, day(2026, 11, 4), 11 * 60, list).ok, true, '11:00–12:00 touches Lunch only at the boundary')
  assert.equal(E.planMove(e, day(2026, 11, 4), 13 * 60, list).ok, true, 'starting exactly when Lunch ends')
})
test('a move never conflicts with the moving event’s own old position', () => {
  const e = ev('m', D(9), D(10))
  const p = E.planMove(e, day(2026, 11, 4), 9 * 60 + 30, [e])                         // overlaps its own old slot only
  assert.equal(p.ok, true); assert.equal(p.startAt, D(9, 30))
  assert.equal(E.planMove(e, day(2026, 11, 4), 9 * 60, [e]).unchanged, true, 'dropping where it already is changes nothing')
  assert.equal(E.planMove(e, day(2026, 11, 4), 9 * 60, [e]).message, null)
})
test('moves keep the exact duration across day boundaries, midnight spill-over and DST', () => {
  const e = ev('night', D(20), D(22, 30))                                             // 2.5 h
  const late = E.planMove(e, day(2026, 11, 6), 23 * 60, [e])                          // Fri 11 PM → ends Sat 1:30 AM
  assert.equal(late.ok, true); assert.equal(late.endAt - late.startAt, 150 * 60_000); assert.equal(new Date(late.endAt).getDate(), 7)
  const clash = E.planMove(e, day(2026, 11, 6), 23 * 60, [e, ev('sat', at(2026, 11, 7, 1), at(2026, 11, 7, 2))])
  assert.equal(clash.ok, false, 'the spill-over into Saturday is checked too')
  const overnight = ev('ov', D(22), at(2026, 11, 5, 0, 30))                           // already crosses midnight
  const m = E.planMove(overnight, day(2026, 11, 6), 21 * 60, [overnight]); assert.equal(m.endAt - m.startAt, 150 * 60_000)
})
test('outside the supported range is refused (before midnight / after the last slot)', () => {
  const e = ev('m', D(9), D(10))
  assert.equal(E.planMove(e, day(2026, 11, 5), -40, [e]).block, 'range')
  assert.equal(E.planMove(e, day(2026, 11, 5), 24 * 60, [e]).block, 'range')
  assert.equal(E.planMove(e, day(2026, 11, 5), 24 * 60 - 15, [e]).ok, true, 'the last 15-minute slot is valid')
})
test('read-only (Google / Outlook) and repeating events cannot be dragged; plain ones can', () => {
  const g = ev('meeting:g', D(9), D(10), { readOnly: true, source: 'google', sourceLabel: 'Google Calendar' })
  const o = ev('meeting:o', D(9), D(10), { readOnly: true, source: 'microsoft', sourceLabel: 'Outlook Calendar' })
  const w = ev('weekly', D(9), D(10), { recurrence: 'weekly' })
  for (const [x, block] of [[g, 'readonly'], [o, 'readonly'], [w, 'recurring']]) {
    assert.equal(E.dragBlockReason(x).block, block)
    const p = E.planMove(x, day(2026, 11, 6), 14 * 60, [x]); assert.equal(p.ok, false); assert.equal(p.block, block); assert.equal(p.startAt, x.startAt, 'stays where it was')
  }
  assert.match(E.dragBlockReason(g).message, /Google Calendar are read-only/)
  assert.equal(E.dragBlockReason(ev('p', 1, 2)), null); assert.equal(E.dragBlockReason(ev('p', 1, 2, { recurrence: 'none' })), null)
})
test('overlapping events are untouched: they remain, and are never rewritten by the engine', () => {
  const evs = buildSampleScheduleEvents(new Date(2026, 10, 4)); const frozen = JSON.stringify(evs)
  const fri = L.layoutDayEvents(evs, day(2026, 11, 6)); assert.ok(fri.some(p => p.lanes > 1), 'Python Test / Lecture – Databases still overlap')
  const py = evs.find(e => e.title === 'Python Test'); E.planMove(py, day(2026, 11, 6), 9 * 60, evs); E.findConflicts({ startAt: py.startAt, endAt: py.endAt }, evs)
  assert.equal(JSON.stringify(evs), frozen)
  assert.ok(evs.length >= 4)
})

// ── 12–13. empty-slot add, double-tap, long press ───────────────────────────
test('grid position → slot start: floors to the whole hour cell and stays inside the day', () => {
  assert.equal(E.SLOT_MINUTES, 60)
  assert.equal(E.minutesFromOffset(0, 56), 0); assert.equal(E.minutesFromOffset(55, 56), 0); assert.equal(E.minutesFromOffset(56, 56), 60)
  assert.equal(E.minutesFromOffset(56 * 9 + 10, 56), 540); assert.equal(E.minutesFromOffset(56 * 9 + 55, 56), 540); assert.equal(E.minutesFromOffset(56 * 10, 56), 600)
  assert.equal(E.minutesFromOffset(56 * 24 + 50, 56), 24 * 60 - 60, 'clamped to the last hour'); assert.equal(E.minutesFromOffset(-30, 56), 0)
  assert.equal(E.minutesFromOffset(NaN, 56), 0); assert.equal(E.minutesFromOffset(100, 0), 0)
  assert.equal(E.minutesFromOffset(56 * 9 + 30, 56, 30), 570, 'a finer step is still available to callers')
})
test('empty-slot Add form: prefilled date/start, default-duration end, adjustable, valid, never crossing midnight', () => {
  const f = L.blankFormAt(day(2026, 11, 4), 14 * 60 + 30, 90)
  assert.deepEqual([f.date, f.start, f.end], ['2026-11-04', '14:30', '16:00'])
  assert.deepEqual(L.validateScheduleForm({ ...f, title: 'x' }), {})
  const late = L.blankFormAt(day(2026, 11, 4), 23 * 60 + 30, 120); assert.deepEqual([late.start, late.end], ['23:30', '23:59']); assert.deepEqual(L.validateScheduleForm({ ...late, title: 'x' }), {})
  assert.equal(L.blankFormAt(day(2026, 11, 4), 0, 15).start, '00:00')
  assert.equal(L.blankForm(day(2026, 11, 4), 9, 30).end, '09:30', 'the Add button follows the preferred duration too')
  assert.deepEqual(L.validateScheduleForm({ ...L.blankForm(day(2026, 11, 4), 23, 120), title: 'x' }), {})
  // the whole proposed duration is conflict-checked, not just the start
  assert.match(E.formConflict(f, [ev('Class', at(2026, 11, 4, 15, 30), at(2026, 11, 4, 17))]), /already have 'Class'/)
})
test('double-click / double-tap: same slot within the window opens Add; slower, or another slot, just selects', () => {
  const k = '1:540'
  assert.equal(E.isDoubleTap(null, k, 1000), false)
  assert.equal(E.isDoubleTap({ key: k, at: 1000 }, k, 1250), true)
  assert.equal(E.isDoubleTap({ key: k, at: 1000 }, k, 1000 + E.DOUBLE_TAP_MS + 1), false, 'too slow')
  assert.equal(E.isDoubleTap({ key: k, at: 1000 }, '1:570', 1200), false, 'different slot')
  assert.equal(E.isDoubleTap({ key: k, at: 1000 }, k, 900), false, 'clock going backwards never counts')
})

// ── 9–10. categories ────────────────────────────────────────────────────────
const BASE = L.SCHEDULE_CATEGORIES
const addOk = (cats, name, hex, id) => { const r = E.addCategory(cats, name, hex, id); assert.equal(r.ok, true, JSON.stringify(r)); return r.categories }
test('create: unlimited custom categories with names and distinct colours; the six built-ins stay first and protected', () => {
  let cats = BASE
  const hexes = E.CATEGORY_SWATCHES
  for (let i = 0; i < hexes.length; i++) cats = addOk(cats, `Custom ${i}`, hexes[i], `cat-${i}`)
  assert.equal(cats.length, 6 + hexes.length); assert.deepEqual(cats.slice(0, 6).map(c => c.id), BASE.map(c => c.id))
  assert.ok(cats.slice(6).every(c => !c.builtIn) && cats.slice(0, 6).every(c => c.builtIn))
  // more than the swatches: custom hex values keep working
  for (let i = 0; i < 30; i++) cats = addOk(cats, `More ${i}`, '#' + (0x100000 + i * 0x010203).toString(16).padStart(6, '0'), `m-${i}`)
  assert.equal(cats.length, 6 + hexes.length + 30)
  const c = cats.find(x => x.id === 'cat-0'); assert.deepEqual([c.label, c.edge], ['Custom 0', hexes[0]]); assert.match(c.bg, /^#[0-9a-f]{6}$/); assert.match(c.text, /^#[0-9a-f]{6}$/)
  assert.notEqual(c.bg, c.edge); assert.notEqual(c.text, c.bg)
})
test('names: trimmed, collapsed, case-insensitive, slash-spacing-insensitive duplicates rejected (also against the six built-ins)', () => {
  assert.equal(E.normalizeCategoryName('  Gym   Time '), 'Gym Time')
  assert.equal(E.categoryNameKey('study/focus'), E.categoryNameKey('Study / Focus'))
  for (const dup of ['meeting', ' MEETING ', 'study/focus', 'Lecture  /  Class', 'Ｍeeting' /* full-width M */]) assert.ok(E.validateCategoryName(dup, BASE), dup)
  assert.ok(E.validateCategoryName('', BASE)); assert.ok(E.validateCategoryName('   ', BASE)); assert.ok(E.validateCategoryName('x'.repeat(E.CATEGORY_NAME_MAX + 1), BASE))
  assert.equal(E.validateCategoryName('x'.repeat(E.CATEGORY_NAME_MAX), BASE), null)
  const cats = addOk(BASE, 'Gym', '#ef4444', 'g')
  assert.ok(E.validateCategoryName('gym', cats), 'duplicate of a custom one'); assert.equal(E.validateCategoryName('gym', cats, 'g'), null, 'renaming to a case change of itself is fine')
  assert.equal(E.addCategory(cats, 'Gym 2', '#ef4444', 'h').ok, false, 'a colour that is already used is refused'); assert.equal(E.addCategory(cats, 'Gym 2', 'red', 'h').ok, false)
  assert.equal(E.addCategory(cats, 'Gym', '#3b82f6', 'h').ok, false); assert.equal(E.addCategory(cats, 'Okay', '#3b82f6', 'g').ok, false, 'id clash')
})
test('rename and recolour custom categories; the built-ins cannot be changed', () => {
  const cats = addOk(BASE, 'Gym', '#ef4444', 'g')
  const renamed = E.renameCategory(cats, 'g', '  Fitness '); assert.equal(renamed.ok, true); assert.equal(renamed.categories.find(c => c.id === 'g').label, 'Fitness')
  assert.equal(E.renameCategory(cats, 'g', 'Meeting').ok, false); assert.equal(E.renameCategory(cats, 'nope', 'X').ok, false)
  const rec = E.recolorCategory(cats, 'g', '#14b8a6'); assert.equal(rec.ok, true)
  const g = rec.categories.find(c => c.id === 'g'); assert.equal(g.edge, '#14b8a6'); assert.deepEqual([g.bg, g.text], [E.categoryColors('#14b8a6').bg, E.categoryColors('#14b8a6').text])
  assert.equal(E.recolorCategory(cats, 'g', BASE[0].edge).ok, false, 'cannot take a built-in’s colour'); assert.equal(E.recolorCategory(cats, 'g', 'nope').ok, false)
  assert.equal(E.recolorCategory(cats, 'g', '#ef4444').ok, true, 'keeping its own colour is fine')
  for (const b of BASE) { assert.equal(E.renameCategory(cats, b.id, 'Renamed').ok, false); assert.equal(E.recolorCategory(cats, b.id, '#14b8a6').ok, false); assert.equal(E.deleteCategory(cats, [], b.id).ok, false, b.label + ' is protected') }
})
test('delete: unused → removed; used → a replacement is REQUIRED and events are moved (no orphans); the original list is not mutated', () => {
  const cats = addOk(BASE, 'Gym', '#ef4444', 'g')
  const events = [ev('a', 1, 2, { category: 'g' }), ev('b', 3, 4, { category: 'study' }), ev('c', 5, 6, { category: 'g' })]
  const frozen = JSON.stringify(events)
  assert.equal(E.categoryUsage(events, 'g'), 2)
  for (const bad of [undefined, 'g', 'does-not-exist']) assert.equal(E.deleteCategory(cats, events, 'g', bad).ok, false, String(bad))
  const r = E.deleteCategory(cats, events, 'g', 'other'); assert.equal(r.ok, true); assert.equal(r.reassigned, 2)
  assert.deepEqual(r.events.map(e => e.category), ['other', 'study', 'other']); assert.ok(!r.categories.some(c => c.id === 'g'))
  assert.ok(r.events.every(e => r.categories.some(c => c.id === e.category)), 'no orphaned references')
  assert.equal(JSON.stringify(events), frozen)
  const unused = E.deleteCategory(cats, [ev('b', 3, 4, { category: 'study' })], 'g'); assert.equal(unused.ok, true); assert.equal(unused.reassigned, 0)
  const second = addOk(cats, 'Club', '#3b82f6', 'club'); const toCustom = E.deleteCategory(second, events, 'g', 'club'); assert.equal(toCustom.ok, true); assert.equal(toCustom.events[0].category, 'club', 'a custom replacement is allowed')
})
test('custom categories drive the dropdown, the search and the colours', () => {
  const cats = addOk(BASE, 'Gym', '#ef4444', 'g')
  const opts = L.filterOptions(cats)
  assert.deepEqual(opts.map(o => o.label), ['All', ...BASE.map(c => c.label), 'Gym', 'Google Calendar', 'Outlook'], 'custom ones sit after the built-ins, calendars last')
  assert.deepEqual(L.splitFilter('g'), { category: 'g', source: 'all' }); assert.deepEqual(L.splitFilter('google'), { category: 'all', source: 'google' })
  const list = [ev('Run', 1, 2, { category: 'g' }), ev('Lecture', 1, 2, { category: 'lecture' })]
  const run = o => L.filterScheduleEvents(list, { query: '', category: 'all', hidden: [], categories: cats, ...o }).map(e => e.id)
  assert.deepEqual(run({ category: 'g' }), ['Run']); assert.deepEqual(run({ hidden: ['g'] }), ['Lecture']); assert.deepEqual(run({ query: 'gym' }), ['Run'], 'category name is searchable')
  assert.deepEqual(run({ query: 'gym', categories: undefined }), [], 'without the list the custom name is unknown (falls back to Other)')
  assert.equal(L.categoryMeta('g', cats).edge, '#ef4444'); assert.equal(L.categoryMeta('g').id, 'other', 'unknown ids fall back to Other so nothing is unstyled')
  assert.equal(L.categoryMeta('lecture', cats).bg, BASE[0].bg)
})
test('derived colours: readable text on the pastel fill for every swatch', () => {
  const lum = h => { const n = parseInt(h.slice(1), 16); const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const hex of E.CATEGORY_SWATCHES) { const c = E.categoryColors(hex); assert.ok(ratio(c.bg, c.text) >= 4.5, `${hex}: ${ratio(c.bg, c.text).toFixed(2)}`) }
  assert.equal(E.isHexColor('#a1B2c3'), true); assert.equal(E.isHexColor('#abc'), false)
})

// ── 11. preferences ─────────────────────────────────────────────────────────
test('preferences: defaults, sanitising, and the stored shape', () => {
  assert.deepEqual(L.DEFAULT_PREFS, { defaultDurationMins: 60, weekStart: 0, timeFormat: '12h' })
  assert.deepEqual(L.sanitizePrefs({ defaultDurationMins: 45, weekStart: 1, timeFormat: '24h' }), { defaultDurationMins: 45, weekStart: 1, timeFormat: '24h' })
  assert.deepEqual(L.sanitizePrefs({ defaultDurationMins: 7, weekStart: 3, timeFormat: 'x' }), L.DEFAULT_PREFS); assert.deepEqual(L.sanitizePrefs(null), L.DEFAULT_PREFS); assert.deepEqual(L.sanitizePrefs({}), L.DEFAULT_PREFS)
  assert.ok(L.DURATION_CHOICES.includes(60) && L.DURATION_CHOICES.every(m => m > 0 && m % 15 === 0))
})
test('week start Monday: weeks, ranges and the month grid all shift; Sunday stays the default', () => {
  const wed = new Date(2026, 10, 4)
  assert.deepEqual(L.weekDays(wed, 1).map(d => d.getDay()), [1, 2, 3, 4, 5, 6, 0]); assert.equal(L.weekRangeLabel(wed, 1), 'Nov 2 – Nov 8'); assert.equal(L.weekRangeLabel(wed), 'Nov 1 – Nov 7')
  assert.equal(L.startOfWeek(new Date(2026, 10, 1), 1).getDate(), 26, 'Sunday Nov 1 belongs to the Monday-start week of Oct 26')
  assert.equal(L.startOfWeek(new Date(2026, 10, 2), 1).getDate(), 2)
  for (const ws of [0, 1]) for (let m = 0; m < 12; m++) {
    const grid = L.monthWeeks(new Date(2026, m, 1), ws); const flat = grid.flat()
    assert.ok(grid.every(r => r.length === 7 && r[0].getDay() === ws), `month ${m} ws ${ws}`)
    for (let i = 1; i < flat.length; i++) assert.equal(flat[i].getTime(), L.addDays(flat[i - 1], 1).getTime())
    assert.ok(flat.some(d => d.getMonth() === m && d.getDate() === 1) && flat.some(d => d.getMonth() === m && d.getDate() === new Date(2026, m + 1, 0).getDate()))
    for (let d = 1; d <= new Date(2026, m + 1, 0).getDate(); d++) assert.ok(L.weekRowIndex(new Date(2026, m, 1), new Date(2026, m, d), ws) >= 0)
  }
  assert.equal(L.monthWeeks(new Date(2026, 10, 1), 1).length, 6, 'Nov 1 2026 is a Sunday: Oct 26–Nov 1 is the first Monday-start row, so November needs six'); assert.equal(L.monthWeeks(new Date(2026, 10, 1), 0).length, 5); assert.equal(L.monthWeeks(new Date(2026, 5, 1), 1)[0][0].getDate(), 1, 'Jun 1 2026 is a Monday → starts the first row')
  let a = L.startOfWeek(new Date(2026, 2, 1), 1); for (let i = 0; i < 60; i++) { a = L.addDays(a, 7); assert.equal(a.getDay(), 1); assert.equal(a.getHours(), 0) }
})
test('time format: 12-hour (default) and 24-hour labels for hours, clock times and ranges', () => {
  assert.deepEqual([0, 5, 12, 13, 23].map(h => L.hourLabel(h, '24h')), ['00:00', '05:00', '12:00', '13:00', '23:00'])
  assert.deepEqual([0, 5, 13].map(h => L.hourLabel(h, '12h')), ['12 AM', '5 AM', '1 PM'])
  assert.equal(L.clockLabel(D(0, 5), '24h'), '00:05'); assert.equal(L.clockLabel(D(15, 45), '24h'), '15:45'); assert.equal(L.clockLabel(D(15, 45)), '3:45 PM')
  assert.equal(L.timeRangeLabel(D(8), D(9, 30), '24h'), '08:00 – 09:30'); assert.equal(L.timeRangeLabel(D(8), D(9, 30)), '8:00 AM – 9:30 AM')
})

// ── structure: wiring that unit tests can't see ─────────────────────────────
const M = () => read('components/xpadite/MeetingsModal.tsx'), V = () => read('components/xpadite/MyScheduleView.tsx'), P = () => read('components/xpadite/ScheduleParts.tsx')
test('hamburger menu: sits beside the single Add Event button, with exactly the approved items in order (v1.328 adds Sync with Task Manager last) — and no Go to Date', () => {
  const m = M(), menu = read('components/xpadite/ScheduleMenu.tsx')
  const navRow = m.slice(m.indexOf('Tabs + the one Add Event button'), m.indexOf('{/* Body */}'))
  assert.ok(/aria-label="Add Event"[\s\S]*<ScheduleMenu/.test(navRow), 'menu immediately follows Add Event in the same row')
  assert.equal((m.match(/aria-label="Add Event"/g) || []).length, 1, 'still one Add Event button')
  assert.deepEqual([...menu.matchAll(/role="menuitem"[\s\S]*?>\s*([A-Z][A-Za-z ]+?)\s*(?:\{|<)/g)].map(x => x[1]), ['Search Events', 'Filter Events', 'Manage Categories', 'Duplicate Event', 'Schedule Preferences', 'Sync with Task Manager'], 'source order; Search/Filter are phone-only')
  assert.ok(/onSearch=\{phone && tab !== 'today'/.test(m) && /onFilter=\{phone && tab !== 'today'/.test(m) && /\{onSearch && \(/.test(menu) && /\{onFilter && \(/.test(menu), 'tablet/desktop never receive the two extra entries — their menu stays the original three plus Sync with Task Manager (all sizes)')
  assert.ok(!/go to date/i.test(m + menu + V() + P() + read('components/xpadite/ScheduleDialogs.tsx')), 'Go to Date was rejected and must not exist')
  assert.ok(/aria-label="Schedule menu"/.test(menu) && /aria-haspopup="menu"/.test(menu) && /aria-expanded=\{open\}/.test(menu), 'accessible, and distinct from the app’s main burger menu')
  assert.ok(/aria-disabled=\{duplicateOff\}/.test(menu) && /Select one of your events first/.test(m) && /Synced calendar events can/.test(m), 'Duplicate is disabled with an explanation when nothing eligible is selected')
  assert.ok(/data-xp-sched-layer|LAYER_ATTR/.test(menu), 'Escape closes the menu before the modal')
})
test('conflicts are enforced at every entry point: form (live + submit), move, and the engine is shared', () => {
  const m = M(), p = P(), v = V()
  assert.ok(/getConflict=\{formConflictFor\}/.test(m) && /formConflict\(v, allEvents/.test(m) && /excludeId: form\.id, original: form\.original/.test(m), 'create / edit / duplicate go through formConflict, excluding the edited event')
  assert.ok(/if \(Object\.keys\(errs\)\.length === 0 && !conflict\) onSubmit\(v\)/.test(p) && /Scheduling Conflict/.test(p) && /role="alert"/.test(p), 'the form refuses to save and shows the message, keeping its inputs')
  assert.ok(/findConflicts\(\{ startAt, endAt, excludeId: cur\.id \}, allEvents\)/.test(m) && /dragBlockReason\(cur\)/.test(m), 'drops are re-validated before state changes')
  assert.ok(/planMove\(s\.ev, dys\[idx\], raw, evs, f\)/.test(v), 'the grid previews validity with the same planMove')
  assert.ok(/allEvents = useMemo\(\(\) => \[\.\.\.scheduleEvents, \.\.\.meetings\.map\(meetingToScheduleEvent\)\]/.test(m), 'conflicts consider synced Google/Outlook events as well as native ones')
})
test('empty slot + drag wiring: click/double-click, keyboard, long-press, scroll protection, read-only guard', () => {
  const v = V()
  assert.ok(/onClick=\{e => onColumnClick\(e, d\)\}/.test(v) && /isDoubleTap\(lastTapRef\.current, key, Date\.now\(\)\)/.test(v) && /data-testid="slot-add"/.test(v), 'tap → highlight + "+ Add"; double-tap/double-click → Add')
  assert.ok(/onClick=\{e => \{ e\.stopPropagation\(\); onSelect\(\) \}\}/.test(v), 'clicking an existing event never reaches the slot handler')
  assert.ok(/tabIndex=\{0\}/.test(v) && /ArrowDown/.test(v) && /e\.key === 'Enter'/.test(v), 'slots are keyboard reachable')
  assert.ok(/LONG_PRESS_MS = 450/.test(v) && /LONG_PRESS_SLOP_PX/.test(v) && /s\.touch\) \{ if \(dist > LONG_PRESS_SLOP_PX\) s\.finish\(false\)/.test(v), 'touch: long-press picks up; moving first means scroll')
  assert.ok(/addEventListener\('touchmove', block, \{ passive: false \}\)/.test(v) && /dragRef\.current\?\.active && e\.cancelable/.test(v), 'once dragging, the page does not scroll')
  assert.ok(/dragBlockReason\(s\.ev\)/.test(v) && /data-movable=/.test(v), 'read-only/repeating events refuse to start a drag')
  assert.ok(/suppressClickRef/.test(v) && /key === 'Escape'|ke\.key === 'Escape'/.test(v), 'a drop does not also click; Escape cancels')
  assert.ok(/\.xp-sch-col \{ touch-action: manipulation/.test(v) && /-webkit-touch-callout: none/.test(v), 'no double-tap zoom on slots; no callout on long-press')
})
test('sidebar alignment: the grid and the sidebar share one row, the footer note sits outside it, cards flex to fill the height', () => {
  const v = V()
  const row = v.slice(v.indexOf('<div className="flex-1 min-h-0 flex">'), v.indexOf('Preview — sample events'))
  assert.ok(row.includes('data-testid="schedule-grid"') && row.includes('data-testid="schedule-sidebar"'), 'grid and sidebar are siblings in the same flex row, so their bottoms align')
  assert.ok(/<aside className="hidden lg:flex flex-col gap-3 w-\[296px\] flex-shrink-0 min-h-0/.test(v), 'sidebar is exactly as tall as the row (min-h-0, no fixed height)')
  assert.ok(/flex: grow > 0 \? `\$\{grow\} 1 0%`/.test(v) && /<Card title=\{`Upcoming[^`]*`\} grow=\{1\} minHeight=\{120\}/.test(v) && /title="Selected Event" grow=\{1\.25\} minHeight=\{150\}/.test(v), 'Upcoming and Selected Event take proportional shares of the height (flexible, not fixed pixels) with small floors')
  assert.ok(!/maxHeight: showAllUpcoming|showAllUpcoming/.test(v), 'no fixed-height upcoming list')
  assert.ok(/<Card title="Color Categories" maxHeight="42%"/.test(v), 'a long custom-category list scrolls inside its card instead of squeezing Upcoming / Selected Event')
  assert.ok(/aside[\s\S]*Color Categories[\s\S]*<\/aside>/.test(v) && !/hidden lg:flex[^>]*sm:/.test(v), 'sidebar stays a large-screen layout; phones keep the bottom sheet')
  assert.ok(/<EventSheet/.test(v) && /lg:hidden absolute inset-0/.test(P()), 'mobile sheet kept')
})
test('Today tab, modal sizing and the single Add Event are unchanged by this milestone', () => {
  const m = M()
  assert.ok(/fixed inset-0 z-\[70\]/.test(m) && /sm:max-w-\[640px\] md:max-w-\[900px\] lg:max-w-\[1296px\]/.test(m))
  assert.ok(/onToggle=\{toggleCalendar\}/.test(m) && /▶/.test(read('components/xpadite/ScheduleMiniCalendar.tsx')) && /rotate\(90deg\)/.test(read('components/xpadite/ScheduleMiniCalendar.tsx')), 'dark mini calendar + triangle collapse')
  assert.ok(/weekStart=\{prefs\.weekStart\}/.test(m), 'the mini calendar follows the week-start preference')
})
test('frontend-only: no persistence, backend, migrations or recurrence expansion were introduced', () => {
  for (const f of ['MyScheduleView.tsx', 'ScheduleParts.tsx', 'ScheduleMenu.tsx', 'ScheduleDialogs.tsx', 'ScheduleMiniCalendar.tsx', 'scheduleLogic.ts', 'scheduleEngine.ts', 'scheduleContext.ts']) {
    const code = read(`components/xpadite/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/supabase|fetch\(|localStorage|sessionStorage|useApp|addTask|XMLHttpRequest|indexedDB/i.test(code), `${f} must stay frontend-only`)
  }
  const code = M().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/supabase|fetch\(|localStorage|sessionStorage/i.test(code))
  assert.ok(!/expandRecurr|rrule/i.test(read('components/xpadite/scheduleEngine.ts') + read('components/xpadite/scheduleLogic.ts')), 'recurrence is still stored/displayed only')
  assert.ok(!/Sample events are demos/.test(V()), 'no sample-event messaging: there is no sample data (v1.329 fix)')
  assert.ok(/Custom categories are saved to your account/.test(read('components/xpadite/ScheduleDialogs.tsx')), 'Manage Categories still says its categories are not saved (the Preferences preview note was removed in v1.327 by request; preferences stay session-only)')
})

