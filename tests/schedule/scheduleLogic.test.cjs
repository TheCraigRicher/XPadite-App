// My Schedule (components/xpadite/scheduleLogic.ts — the real module): week/month maths, 24h slicing, overlap lanes,
// filtering, link safety and form validation. Plus structural checks that the Meetings → My Schedule wiring kept
// the existing Today/Upcoming/integration code and removed only the intended UI.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleMockData')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const { buildSampleScheduleEvents } = require(path.join(OUT, 'scheduleMockData.js'))

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (id, s, e, extra = {}) => ({ id, title: id, category: 'meeting', startAt: s, endAt: e, ...extra })

// ── dates ───────────────────────────────────────────────────────────────────
test('week is Sunday → Saturday and matches the reference week (Nov 1–7 2026)', () => {
  const days = L.weekDays(new Date(2026, 10, 4))                         // Wed Nov 4 2026
  assert.equal(days.length, 7)
  assert.deepEqual(days.map(d => d.getDay()), [0, 1, 2, 3, 4, 5, 6])
  assert.equal(days[0].getDate(), 1); assert.equal(days[6].getDate(), 7)
  assert.equal(L.weekRangeLabel(new Date(2026, 10, 4)), 'Nov 1 – Nov 7')
})
test('weeks cross month and year boundaries correctly', () => {
  assert.equal(L.weekRangeLabel(new Date(2026, 9, 30)), 'Oct 25 – Oct 31')
  assert.equal(L.weekRangeLabel(new Date(2026, 11, 30)), 'Dec 27, 2026 – Jan 2, 2027')
  const d = L.weekDays(new Date(2027, 0, 1)); assert.equal(d[0].getFullYear(), 2026); assert.equal(d[6].getFullYear(), 2027)
  assert.equal(L.addDays(new Date(2026, 11, 31), 1).getFullYear(), 2027)
})
test('previous/next week arithmetic is exact across a DST change (always lands on local midnight Sunday)', () => {
  let a = L.startOfWeek(new Date(2026, 2, 1))
  for (let i = 0; i < 60; i++) { a = L.addDays(a, 7); assert.equal(a.getDay(), 0); assert.equal(a.getHours(), 0) }
  for (let i = 0; i < 120; i++) { a = L.addDays(a, -7); assert.equal(a.getDay(), 0); assert.equal(a.getHours(), 0) }
})
test('month navigation keeps the day, clamps to month length, and rolls the year', () => {
  assert.deepEqual([L.shiftMonth(new Date(2026, 0, 31), 1).getMonth(), L.shiftMonth(new Date(2026, 0, 31), 1).getDate()], [1, 28])
  assert.equal(L.shiftMonth(new Date(2028, 0, 31), 1).getDate(), 29)                  // leap year
  const dec = L.shiftMonth(new Date(2026, 11, 15), 1); assert.deepEqual([dec.getFullYear(), dec.getMonth(), dec.getDate()], [2027, 0, 15])
  const jan = L.shiftMonth(new Date(2026, 0, 15), -1); assert.deepEqual([jan.getFullYear(), jan.getMonth()], [2025, 11])
  assert.equal(L.monthYearLabel(new Date(2026, 10, 4)), 'November 2026')
})
test('hour and clock labels cover all 24 hours', () => {
  assert.deepEqual([0, 1, 5, 11, 12, 13, 23].map(L.hourLabel), ['12 AM', '1 AM', '5 AM', '11 AM', '12 PM', '1 PM', '11 PM'])
  assert.equal(L.clockLabel(at(2026, 11, 4, 0, 5)), '12:05 AM'); assert.equal(L.clockLabel(at(2026, 11, 4, 12, 30)), '12:30 PM')
  assert.equal(L.timeRangeLabel(at(2026, 11, 6, 8), at(2026, 11, 6, 9)), '8:00 AM – 9:00 AM')
  assert.equal(L.durationLabel(at(2026, 11, 6, 8), at(2026, 11, 6, 9)), '1 hr')
  assert.equal(L.durationLabel(at(2026, 11, 6, 8), at(2026, 11, 6, 9, 15)), '1 hr 15 min'); assert.equal(L.durationLabel(0, 15 * 60000), '15 min')
})

// ── positioning ─────────────────────────────────────────────────────────────
test('15- and 30-minute starts/ends are positioned to the minute', () => {
  const d = new Date(2026, 10, 4)
  const [p] = L.layoutDayEvents([ev('a', at(2026, 11, 4, 9, 15), at(2026, 11, 4, 10, 45))], d)
  assert.equal(p.startMin, 9 * 60 + 15); assert.equal(p.endMin, 10 * 60 + 45); assert.equal(p.lanes, 1)
})
test('an event running past midnight shows on both days, clipped to each', () => {
  const e = ev('late', at(2026, 11, 4, 22), at(2026, 11, 5, 0, 30))
  assert.deepEqual(L.daySlice(e, new Date(2026, 10, 4)), { startMin: 22 * 60, endMin: 1440 })
  assert.deepEqual(L.daySlice(e, new Date(2026, 10, 5)), { startMin: 0, endMin: 30 })
  assert.equal(L.daySlice(e, new Date(2026, 10, 6)), null); assert.equal(L.daySlice(e, new Date(2026, 10, 3)), null)
  // ending exactly at midnight does not leak onto the next day
  const m = ev('m', at(2026, 11, 4, 23), at(2026, 11, 5, 0))
  assert.equal(L.daySlice(m, new Date(2026, 10, 5)), null); assert.equal(L.daySlice(m, new Date(2026, 10, 4)).endMin, 1440)
})
test('zero/negative length events are never drawn', () => {
  assert.equal(L.layoutDayEvents([ev('z', at(2026, 11, 4, 9), at(2026, 11, 4, 9))], new Date(2026, 10, 4)).length, 0)
  assert.equal(L.layoutDayEvents([ev('n', at(2026, 11, 4, 10), at(2026, 11, 4, 9))], new Date(2026, 10, 4)).length, 0)
})
test('overlapping events get side-by-side lanes; non-overlapping ones stay full width', () => {
  const d = new Date(2026, 10, 6)
  const out = L.layoutDayEvents([
    ev('present', at(2026, 11, 6, 8), at(2026, 11, 6, 9)),
    ev('db', at(2026, 11, 6, 9), at(2026, 11, 6, 10)),            // touches 'present' end — NOT an overlap
    ev('py', at(2026, 11, 6, 9, 30), at(2026, 11, 6, 11, 30)),    // overlaps 'db'
    ev('lunch', at(2026, 11, 6, 12), at(2026, 11, 6, 13)),
  ], d)
  const by = Object.fromEntries(out.map(p => [p.event.id, p]))
  assert.equal(by.present.lanes, 1); assert.equal(by.lunch.lanes, 1)
  assert.equal(by.db.lanes, 2); assert.equal(by.py.lanes, 2); assert.notEqual(by.db.lane, by.py.lane)
})
test('three-way overlap uses three lanes; a freed lane is reused', () => {
  const d = new Date(2026, 10, 6)
  const out = L.layoutDayEvents([
    ev('a', at(2026, 11, 6, 9), at(2026, 11, 6, 12)), ev('b', at(2026, 11, 6, 9, 30), at(2026, 11, 6, 10)),
    ev('c', at(2026, 11, 6, 9, 45), at(2026, 11, 6, 11)), ev('d', at(2026, 11, 6, 10), at(2026, 11, 6, 10, 30)),
  ], d)
  const by = Object.fromEntries(out.map(p => [p.event.id, p]))
  assert.ok(out.every(p => p.lanes === 3))
  assert.equal(by.d.lane, by.b.lane, 'd starts as b ends, so it reuses b’s lane')
  // no two events in the same lane overlap
  for (const x of out) for (const y of out) if (x !== y && x.lane === y.lane) assert.ok(x.endMin <= y.startMin || y.endMin <= x.startMin)
})
test('a very short event is drawn (and lane-checked) at least 20 minutes tall', () => {
  const d = new Date(2026, 10, 6)
  const out = L.layoutDayEvents([ev('s', at(2026, 11, 6, 9), at(2026, 11, 6, 9, 5)), ev('t', at(2026, 11, 6, 9, 10), at(2026, 11, 6, 10))], d)
  assert.equal(out.find(p => p.event.id === 's').endMin - 540, 20); assert.ok(out.every(p => p.lanes === 2))
})

// ── filtering ───────────────────────────────────────────────────────────────
test('search, category dropdown and legend visibility all filter without deleting', () => {
  const list = [ev('Team Meeting', 1, 2), ev('Python Test', 1, 2, { category: 'assignment', location: 'Exam Hall B' }), ev('Lunch', 1, 2, { category: 'personal', notes: 'campus cafe' })]
  const f = (o) => L.filterScheduleEvents(list, { query: '', category: 'all', hidden: [], ...o }).map(e => e.id)
  assert.deepEqual(f({}), ['Team Meeting', 'Python Test', 'Lunch'])
  assert.deepEqual(f({ query: 'exam' }), ['Python Test']); assert.deepEqual(f({ query: '  CAFE ' }), ['Lunch'])
  assert.deepEqual(f({ query: 'assignment' }), ['Python Test'], 'category names are searchable')
  assert.deepEqual(f({ category: 'personal' }), ['Lunch'])
  assert.deepEqual(f({ hidden: ['assignment', 'personal'] }), ['Team Meeting'])
  assert.equal(list.length, 3)
})

// ── links ───────────────────────────────────────────────────────────────────
test('only http(s) links are ever made clickable', () => {
  assert.equal(L.safeHttpUrl('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij')
  assert.equal(L.safeHttpUrl('zoom.us/j/123'), 'https://zoom.us/j/123')
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com/a', 'not a link', 'localhost', '', '   ', null, undefined]) assert.equal(L.safeHttpUrl(bad), null, String(bad))
  assert.equal(L.meetingLinkLabel('https://meet.google.com/x'), 'Google Meet'); assert.equal(L.meetingLinkLabel('https://us02web.zoom.us/j/1'), 'Zoom')
  assert.equal(L.meetingLinkLabel('https://teams.microsoft.com/l/x'), 'Microsoft Teams'); assert.equal(L.meetingLinkLabel('https://www.example.com/a'), 'example.com')
})

// ── form validation ─────────────────────────────────────────────────────────
const ok = () => ({ title: 'Study', date: '2026-11-04', start: '09:00', end: '10:30', category: 'study', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none' })
test('valid form passes; title is required', () => {
  assert.deepEqual(L.validateScheduleForm(ok()), {})
  assert.ok(L.validateScheduleForm({ ...ok(), title: '   ' }).title)
})
test('end must be after start; equal and reversed are rejected, 15-min steps accepted', () => {
  assert.ok(L.validateScheduleForm({ ...ok(), end: '09:00' }).end); assert.ok(L.validateScheduleForm({ ...ok(), end: '08:00' }).end)
  assert.deepEqual(L.validateScheduleForm({ ...ok(), start: '09:15', end: '09:30' }), {})
  assert.ok(L.validateScheduleForm({ ...ok(), start: '', end: '' }).start)
})
test('impossible dates are rejected (no silent rollover)', () => {
  assert.ok(L.validateScheduleForm({ ...ok(), date: '2026-02-31' }).date); assert.ok(L.validateScheduleForm({ ...ok(), date: '' }).date)
  assert.equal(L.parseLocal('2026-02-31', '09:00'), null); assert.equal(L.parseLocal('2026-11-04', '24:00'), null)
  assert.deepEqual(L.validateScheduleForm({ ...ok(), date: '2028-02-29' }), {})
})
test('a malformed meeting link is rejected; an empty one is fine', () => {
  assert.ok(L.validateScheduleForm({ ...ok(), meetingUrl: 'javascript:alert(1)' }).meetingUrl)
  assert.deepEqual(L.validateScheduleForm({ ...ok(), meetingUrl: 'https://zoom.us/j/1' }), {})
})
test('form → event → form round-trips; optional fields are dropped when empty', () => {
  const f = { ...ok(), location: ' Room 1 ', meetingUrl: 'zoom.us/j/9', notes: ' hi ', reminderMins: 15, recurrence: 'weekly' }
  const fields = L.formToEventFields(f)
  assert.equal(fields.title, 'Study'); assert.equal(fields.location, 'Room 1'); assert.equal(fields.meetingUrl, 'https://zoom.us/j/9'); assert.equal(fields.notes, 'hi')
  assert.equal(fields.endAt - fields.startAt, 90 * 60000)
  const back = L.eventToForm({ id: 'x', ...fields })
  assert.deepEqual([back.date, back.start, back.end, back.reminderMins, back.recurrence], ['2026-11-04', '09:00', '10:30', 15, 'weekly'])
  const bare = L.formToEventFields(ok()); assert.equal(bare.location, undefined); assert.equal(bare.meetingUrl, undefined); assert.equal(bare.notes, undefined)
})
test('blank Add form defaults to a valid 1-hour block, even late in the evening', () => {
  assert.deepEqual(L.validateScheduleForm({ ...L.blankForm(new Date(2026, 10, 4)), title: 'x' }), {})
  assert.deepEqual(L.validateScheduleForm({ ...L.blankForm(new Date(2026, 10, 4), 23), title: 'x' }), {})
})
test('reminder / recurrence labels only appear when set', () => {
  assert.equal(L.reminderLabel(null), null); assert.equal(L.reminderLabel(undefined), null)
  assert.equal(L.reminderLabel(0), 'At start time'); assert.equal(L.reminderLabel(15), '15 minutes before')
  assert.equal(L.recurrenceLabel('none'), null); assert.equal(L.recurrenceLabel(undefined), null); assert.equal(L.recurrenceLabel('weekly'), 'Every week')
})

// ── categories ──────────────────────────────────────────────────────────────
test('the six categories keep their agreed names and one colour each', () => {
  assert.deepEqual(L.SCHEDULE_CATEGORIES.map(c => c.label), ['Lecture / Class', 'Meeting', 'Assignment / Test', 'Study / Focus', 'Personal', 'Other'])
  assert.equal(new Set(L.SCHEDULE_CATEGORIES.map(c => c.bg)).size, 6)
  assert.equal(L.categoryMeta('meeting').label, 'Meeting')
})

// ── sample data ─────────────────────────────────────────────────────────────
test('sample events are valid, categorised, uniquely identified and stay within the displayed week/next week', () => {
  const today = new Date(2026, 10, 4); const evs = buildSampleScheduleEvents(today)
  assert.ok(evs.length >= 10); assert.equal(new Set(evs.map(e => e.id)).size, evs.length)
  const ids = new Set(L.SCHEDULE_CATEGORIES.map(c => c.id))
  for (const e of evs) { assert.ok(e.endAt > e.startAt, e.title); assert.ok(ids.has(e.category)); assert.ok(e.id.startsWith('sample-sched-')) }
  const w = L.startOfWeek(today).getTime(); assert.ok(evs.every(e => e.startAt >= w && e.startAt < L.addDays(L.startOfWeek(today), 14).getTime()))
  assert.ok(evs.some(e => L.daySlice(e, new Date(2026, 10, 6)) && L.layoutDayEvents(evs, new Date(2026, 10, 6)).some(p => p.lanes > 1)), 'the sample week includes overlapping events')
})

// ── combined filter (categories + sources) ─────────────────────────────────
const mk = (id, category, source) => ({ id, title: id, category, startAt: 1, endAt: 2, ...(source ? { source } : {}) })
test('the single dropdown lists All, the six categories, then Google Calendar and Outlook at the bottom', () => {
  assert.deepEqual(L.FILTER_OPTIONS.map(o => o.label), ['All', 'Lecture / Class', 'Meeting', 'Assignment / Test', 'Study / Focus', 'Personal', 'Other', 'Google Calendar', 'Outlook'])
  assert.deepEqual(L.FILTER_OPTIONS.map(o => o.value), ['all', 'lecture', 'meeting', 'assignment', 'study', 'personal', 'other', 'google', 'microsoft'])
  assert.deepEqual(L.splitFilter('all'), { category: 'all', source: 'all' }); assert.deepEqual(L.splitFilter('study'), { category: 'study', source: 'all' })
  assert.deepEqual(L.splitFilter('google'), { category: 'all', source: 'google' }); assert.deepEqual(L.splitFilter('microsoft'), { category: 'all', source: 'microsoft' })
})
test('source filtering: Google / Outlook keep only that calendar’s events; All keeps everything; categories still apply', () => {
  const list = [mk('g1', 'meeting', 'google'), mk('g2', 'meeting', 'google'), mk('o1', 'meeting', 'microsoft'), mk('mine', 'study'), mk('mine2', 'lecture')]
  const run = v => L.filterScheduleEvents(list, { query: '', ...L.splitFilter(v), hidden: [] }).map(e => e.id)
  assert.deepEqual(run('all'), ['g1', 'g2', 'o1', 'mine', 'mine2'])
  assert.deepEqual(run('google'), ['g1', 'g2']); assert.deepEqual(run('microsoft'), ['o1'])
  assert.deepEqual(run('meeting'), ['g1', 'g2', 'o1'], 'category Meeting covers synced meetings from both calendars')
  assert.deepEqual(run('study'), ['mine'])
  // an event with BOTH a category and a source obeys both the legend checkboxes and the source choice
  const both = L.filterScheduleEvents(list, { query: '', ...L.splitFilter('google'), hidden: ['meeting'] }).map(e => e.id)
  assert.deepEqual(both, [], 'hiding the Meeting category hides Google meetings even when Google is chosen (filters combine)')
})
test('synced meetings become read-only Meeting events that carry their calendar source', () => {
  const m = { id: 'x1', provider: 'microsoft', calendarSource: 'Outlook Calendar', title: 'Sync', startAt: 5, endAt: 9, meetingUrl: null, isCancelled: true, notes: 'n' }
  const e = L.meetingToScheduleEvent(m)
  assert.deepEqual([e.id, e.category, e.readOnly, e.source, e.sourceLabel, e.isCancelled, e.meetingUrl, e.notes], ['meeting:x1', 'meeting', true, 'microsoft', 'Outlook Calendar', true, undefined, 'n'])
  assert.equal(L.meetingToScheduleEvent({ ...m, notes: '' }).notes, undefined)
})

// ── Today: agenda + mini calendar maths ─────────────────────────────────────
test('agenda for a day is chronological and includes events that run past midnight', () => {
  const evs = [ev('b', at(2026, 11, 4, 14), at(2026, 11, 4, 15)), ev('late', at(2026, 11, 3, 23), at(2026, 11, 4, 0, 30)), ev('a', at(2026, 11, 4, 9), at(2026, 11, 4, 10)), ev('other', at(2026, 11, 5, 9), at(2026, 11, 5, 10))]
  assert.deepEqual(L.eventsOnDay(evs, new Date(2026, 10, 4)).map(e => e.id), ['late', 'a', 'b'])
  assert.deepEqual(L.eventsOnDay(evs, new Date(2026, 10, 5)).map(e => e.id), ['other'])
})
test('month grid: real consecutive Sunday-first weeks, including neighbouring-month days', () => {
  const nov = L.monthWeeks(new Date(2026, 10, 15))
  assert.equal(nov.length, 5); assert.equal(nov[0][0].getDate(), 1); assert.equal(nov[0][0].getMonth(), 10); assert.equal(nov[4][6].getMonth(), 11, 'last row ends in December')
  const oct = L.monthWeeks(new Date(2026, 9, 1)); assert.equal(oct[0][0].getMonth(), 8); assert.equal(oct[0][0].getDate(), 27)
  const aug = L.monthWeeks(new Date(2026, 7, 1)); assert.equal(aug.length, 6, 'a month spanning six weeks gets six rows')
  for (const grid of [nov, oct, aug]) {
    const flat = grid.flat(); assert.ok(flat.every(d => d.getHours() === 0))
    for (let i = 1; i < flat.length; i++) assert.equal(flat[i].getTime(), L.addDays(flat[i - 1], 1).getTime(), 'no gaps or repeats')
    assert.ok(grid.every(r => r[0].getDay() === 0 && r[6].getDay() === 6))
  }
})
test('collapsed calendar shows exactly the week holding the selected date — also across month and year boundaries', () => {
  const row = (m, d) => L.monthWeeks(m)[L.weekRowIndex(m, d)]
  const nov30 = new Date(2026, 10, 30), r = row(new Date(2026, 10, 1), nov30)
  assert.ok(r.some(d => L.isSameLocalDay(d, nov30))); assert.deepEqual([r[0].getMonth(), r[0].getDate(), r[6].getMonth(), r[6].getDate()], [10, 29, 11, 5], 'Nov 29 – Dec 5 (straddles two months, all real dates)')
  const dec31 = new Date(2026, 11, 31), r2 = row(new Date(2026, 11, 1), dec31); assert.equal(r2[6].getFullYear(), 2027); assert.ok(r2.some(d => L.isSameLocalDay(d, dec31)))
  const jan1 = new Date(2027, 0, 1), r3 = row(new Date(2027, 0, 1), jan1); assert.equal(r3[0].getFullYear(), 2026, 'week of Jan 1 starts in December'); assert.ok(r3.some(d => L.isSameLocalDay(d, jan1)))
  assert.equal(L.weekRowIndex(new Date(2026, 10, 1), new Date(2027, 5, 1)), -1)
  for (let d = 1; d <= 30; d++) { const x = new Date(2026, 10, d); assert.ok(row(new Date(2026, 10, 1), x).some(c => L.isSameLocalDay(c, x))) }
})

// ── wiring (structure) ──────────────────────────────────────────────────────
test('Meetings → My Schedule: naming, exactly two tabs, banners gone, integrations untouched', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), side = read('components/xpadite/AppSidebar.tsx')
  assert.ok(/label: 'My Schedule',\s+action: 'meetings'/.test(side) && !/label: 'Meetings'/.test(side), 'burger menu renamed, same action')
  assert.ok(/>My Schedule<\/h2>/.test(m) && /Schedule your day, all in one place\./.test(m))
  const tabsBlock = m.slice(m.indexOf('const TABS'), m.indexOf('\n]', m.indexOf('const TABS')))
  assert.deepEqual([...tabsBlock.matchAll(/key: '(\w+)'/g)].map(x => x[1]), ['schedule', 'today'], 'exactly two tabs in order: My Schedule | Today')
  assert.ok(/type TabKey = 'schedule' \| 'today'\r?\n/.test(m), 'tab state no longer knows an upcoming tab')
  assert.ok(!/key: 'upcoming'|Upcoming \(|selectTab|SourceFilter\b|setSourceFilter|All Sources/.test(m), 'no stale Upcoming-tab / All-Sources references in the modal')
  assert.ok(/useState<TabKey>\('schedule'\)/.test(m), 'My Schedule is the default tab')
  assert.ok(!/Past \(/.test(m) && !/Monthly Meetings/.test(m), 'Past and Monthly tabs removed from the UI')
  assert.ok(!/Automatically add meetings to Task Manager/.test(m) && !/are read-only\. You can view them, join them/.test(m), 'both banners removed')
  // preserved behaviour
  assert.ok(/function MeetingDetail/.test(m) && /useLockBodyScroll\(\)/.test(m))
  assert.ok(/const \[autoAdd\] = useState\(true\)/.test(m) && /addedToTaskManager: true, linkedTaskId/.test(m), 'Task Manager add logic kept')
  assert.ok(/MOCK_MEETINGS/.test(m) && /handleRemove/.test(m) && /handleJoin/.test(m) && /onNotesChange=\{text => updateMeeting/.test(m), 'notes + remove-from-XPadite + join kept')
  assert.ok(/setMeetingsOpen\(true\)/.test(read('components/xpadite/XpaditeApp.tsx')) && /<MeetingsModal onClose/.test(read('components/xpadite/XpaditeApp.tsx')), 'opening/closing wiring unchanged')
  assert.ok(/upcoming = useMemo/.test(read('components/xpadite/MyScheduleView.tsx')), 'upcoming events still live in the weekly view (now a scrolling list that fills the sidebar — no View All toggle needed)')
})
test('exactly ONE Add Event button, in the modal navigation row, shared by both tabs', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), v = read('components/xpadite/MyScheduleView.tsx')
  assert.equal((m.match(/aria-label="Add Event"/g) || []).length, 1, 'one button in the modal')
  assert.ok(/onClick=\{openAdd\}/.test(m) && !/Add Event/.test(v), 'removed from the weekly toolbar')
  const navRow = m.slice(m.indexOf('Tabs + the one Add Event button'), m.indexOf('{/* Body */}'))
  assert.ok(/aria-label="Add Event"/.test(navRow) && /TABS\.map/.test(navRow), 'sits beside the tabs, outside either tab body')
  assert.ok(/blankForm\(tab === 'today' \? todayDate : activeDay, 9, prefs\.defaultDurationMins\)/.test(m), 'defaults to the day being looked at, using the preferred duration')
})
test('one combined filter control; the old All Sources dropdown is gone', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), v = read('components/xpadite/MyScheduleView.tsx'), p = read('components/xpadite/ScheduleParts.tsx')
  assert.ok(/<FilterSelect/.test(v) && /filterOptions\(categories\)\.map/.test(p) && (v.match(/<FilterSelect/g) || []).length === 1)
  assert.ok(!/All Sources|SourceFilterDropdown/.test(m + v + p))
  assert.ok(/splitFilter\(filter\)/.test(m) && /splitFilter\(filter\)/.test(v), 'the same filter drives Today’s agenda and the weekly grid')
  assert.ok(/CategoryChecklist/.test(v) && /Color Categories/.test(v), 'legend checkboxes kept')
})
test('modal sizing: Analytics’ rules on desktop, full screen on phones with safe areas', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), a = read('components/xpadite/AnalyticsModal.tsx')
  assert.ok(/lg:max-w-\[1296px\]/.test(a) && /sm:max-w-\[640px\]/.test(a) && /sm:p-3 sm:pt-4/.test(a), 'Analytics’ rules (the reference)')
  assert.ok(/fixed inset-0 z-\[70\]/.test(m) && /sm:p-3 sm:pt-4/.test(m) && /sm:max-w-\[640px\] md:max-w-\[900px\] lg:max-w-\[1296px\]/.test(m), 'same padding and max widths as Analytics (+ md:900 for tablets)')
  assert.ok(!/bottom-14/.test(m), 'no longer stops above the phone bottom bar')
  assert.ok(/env\(safe-area-inset-top/.test(m) && /env\(safe-area-inset-bottom/.test(m), 'safe areas respected')
  const nav = read('components/xpadite/MobileBottomNav.tsx'); assert.ok(/zIndex: 50/.test(nav), 'bottom bar is z-50, below this z-[70] layer')
})
test('Today tab: dark mini calendar with the purple triangle, agenda, and details; no leftover Upcoming list', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), c = read('components/xpadite/ScheduleMiniCalendar.tsx')
  assert.ok(/ScheduleMiniCalendar/.test(m) && /onToggle=\{toggleCalendar\}/.test(m) && /data-testid="today-agenda"/.test(m))
  assert.ok(/▶/.test(c) && /rotate\(90deg\)/.test(c) && /aria-expanded=\{expanded\}/.test(c), 'the signature ▶ triangle rotates when expanded')
  assert.ok(/setViewMonth\(startOfMonth\(todayDate\)\)/.test(m) && !/setTodayDate\(startOfDay\(new Date\(\)\)\)\s*\n\s*setCalExpanded/.test(m), 'toggling never changes the selected date')
  assert.ok(/<MeetingDetail/.test(m) && /<EventDetails/.test(m), 'synced meeting detail (read-only + notes) and XPadite event detail (edit/delete)')
})
test('My Schedule never touches storage, network, Supabase or the Task Manager', () => {
  for (const f of ['MyScheduleView.tsx', 'ScheduleParts.tsx', 'ScheduleMiniCalendar.tsx', 'scheduleLogic.ts', 'scheduleMockData.ts']) {
    const src = read(`components/xpadite/${f}`)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')   // comments may mention Supabase; code must not use it
    assert.ok(!/supabase|fetch\(|localStorage|sessionStorage|useApp|addTask|XMLHttpRequest/i.test(code), `${f} must stay frontend-only`)
  }
})
test('grid structure: 24 hours, 5 AM initial scroll, sticky header sharing the body’s column template', () => {
  const v = read('components/xpadite/MyScheduleView.tsx')
  assert.ok(/INITIAL_SCROLL_HOUR = 5/.test(v) && /scrollTop = INITIAL_SCROLL_HOUR \* HOUR_PX/.test(v))
  assert.ok(/length: 24/.test(v) && /height: 24 \* HOUR_PX/.test(v))
  assert.equal((v.match(/gridTemplateColumns: GRID_COLS/g) || []).length, 2, 'header + body use the same template')
  assert.ok(/sticky top-0/.test(v))
  assert.ok(!/Quick Actions/.test(v), 'no Quick Actions panel')
  assert.ok(/Upcoming \(\$\{upcoming\.length\}\)/.test(v) && /title="Selected Event"/.test(v) && /title="Color Categories"/.test(v))
})
test('burger menu: My Schedule sits right after Task Manager, once, with its icon, label and handler intact', () => {
  const side = read('components/xpadite/AppSidebar.tsx')
  const order = [...side.match(/const FINAL_ORDER[^=]*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'([\w-]+)'/g)].map(x => x[1])
  assert.deepEqual(order.slice(0, 5), ['profile', 'tasks', 'meetings', 'activities', 'journal-notes'], 'Profile, Task Manager, My Schedule, Activity Manager, Planner/Journal')
  assert.equal(order.filter(a => a === 'meetings').length, 1, 'no duplicate')
  assert.deepEqual(order.slice(5), ['analytics', 'goal-manager', 'notifications', 'qotd', 'ai-coach', 'motivate', 'gallery', 'sync-calendar', 'settings', 'tutorials', 'help', 'whats-new'], 'every other item keeps its relative order')
  assert.ok(/icon: '👥', label: 'My Schedule',\s+action: 'meetings'/.test(side) && /case 'meetings':\s+onMeetings\?\.\(\)/.test(side), 'icon, label and handler preserved')
  assert.ok(/onMeetings=\{\(\) => setMeetingsOpen\(true\)\}/.test(read('components/xpadite/XpaditeApp.tsx')))
})
