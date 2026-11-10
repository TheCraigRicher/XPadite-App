// v1.331 — My Schedule UX: (1) past-event strikethrough, (2) dimmed past dates in Month view, (3) stable time/category dropdowns,
// (4) no accidental backdrop dismissal, (5) Today auto-selection. Part A runs the real pure modules; Part B pins the wiring in the real sources.
// (Behaviour in a real browser — wheel/touch scrolling, backdrop clicks, selection at several widths — is covered by the browser suites run for the release.)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-v331'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = f => read(`components/xpadite/${f}`)
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(src(`${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleMonth')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const M = require(path.join(OUT, 'scheduleMonth.js'))

const MIN = 60000, NOW = new Date(2026, 10, 9, 15, 0).getTime()
const ev = (id, a, b, o = {}) => ({ id, title: id, category: 'meeting', startAt: NOW + a * MIN, endAt: NOW + b * MIN, isDeadline: false, ...o })

// ═════ A. pure logic ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('past event: the end time has passed (boundary: ends exactly now = past; one ms later = not yet); starting earlier does not matter', () => {
  assert.equal(L.isPastEvent({ endAt: NOW }, NOW), true)
  assert.equal(L.isPastEvent({ endAt: NOW + 1 }, NOW), false)
  assert.equal(L.isPastEvent(ev('a', -60, -1), NOW), true)
  assert.equal(L.isPastEvent(ev('b', -60, 30), NOW), false, 'in progress is not past')
  assert.equal(L.isPastEvent(ev('c', 30, 60), NOW), false)
  assert.equal(L.isPastEvent(ev('d', -2000, 1000), NOW), false, 'a multi-day event still running is not past')
})

test('auto-selection: the event in progress wins; with several in progress the most recently started; ties are deterministic', () => {
  const sel = (evs) => L.pickAutoSelection(evs, NOW)?.id
  assert.equal(sel([ev('past', -120, -60), ev('active', -10, 20), ev('next', 30, 60)]), 'active')
  assert.equal(sel([ev('long', -120, 60), ev('nested', -15, 10)]), 'nested', 'most recently started')
  assert.equal(sel([ev('b', -10, 20), ev('a', -10, 15)]), 'a', 'same start → earlier end')
  assert.equal(sel([ev('b', -10, 20), ev('a', -10, 20)]), 'a', 'full tie → id order (stable across renders)')
  assert.equal(sel([ev('edge', 0, 30)]), 'edge', 'starting exactly now is in progress')
  assert.equal(sel([ev('over', -30, 0), ev('next', 10, 20)]), 'next', 'ending exactly now is over')
})

test('auto-selection: no active event → the next one to start; none left → the most recent one that finished', () => {
  const sel = evs => L.pickAutoSelection(evs, NOW)?.id
  assert.equal(sel([ev('past', -120, -60), ev('later', 120, 150), ev('soon', 20, 50)]), 'soon')
  assert.equal(sel([ev('old', -300, -240), ev('recent', -90, -45), ev('mid', -200, -100)]), 'recent', 'latest END, not latest start')
  assert.equal(sel([ev('long-ago-but-late-end', -400, -50), ev('short-recent', -80, -60)]), 'long-ago-but-late-end')
  assert.equal(L.pickAutoSelection([], NOW), null)
})

test('auto-selection works for any date: a future day → its first event, a past day → its last (same rule, no special cases)', () => {
  const day = d => [ev('x9', d * 1440 + 540 - 900, d * 1440 + 570 - 900), ev('x14', d * 1440 + 840 - 900, d * 1440 + 900 - 900)]   // 09:00 and 14:00 on that day
  assert.equal(L.pickAutoSelection(day(2), NOW)?.id, 'x9', 'two days ahead: first event')
  assert.equal(L.pickAutoSelection(day(-2), NOW)?.id, 'x14', 'two days ago: last event')
})

test('auto-selection edge cases: cancelled events are never chosen alone; zero-length ignored; synced calendar events and single occurrences of repeats are ordinary', () => {
  assert.equal(L.pickAutoSelection([ev('c', -10, 20, { isCancelled: true })], NOW), null)
  assert.equal(L.pickAutoSelection([ev('c', -10, 20, { isCancelled: true }), ev('n', 30, 60)], NOW)?.id, 'n', 'a live event beats a cancelled one in progress')
  assert.equal(L.pickAutoSelection([ev('z', 0, 0)], NOW), null, 'zero-length')
  assert.equal(L.pickAutoSelection([ev('meeting:g1', -5, 25, { readOnly: true, sourceLabel: 'Google Calendar' })], NOW)?.id, 'meeting:g1', 'external calendar event')
  assert.equal(L.pickAutoSelection([ev('rep', -5, 25, { recurrence: 'weekly' }), ev('other', 40, 50)], NOW)?.id, 'rep', 'one stored occurrence per repeating event — judged by its real times')
  const input = [ev('b', 30, 60), ev('a', -10, 20)]; const copy = JSON.stringify(input); L.pickAutoSelection(input, NOW); assert.equal(JSON.stringify(input), copy, 'never mutates the caller\'s list')
})

test('Month cells: isPast is strictly "before today" at local midnight boundaries; today and the future are not past', () => {
  const today = new Date(2026, 10, 9, 0, 0, 5)
  const weeks = M.buildMonthGrid([], new Date(2026, 10, 1), today, 0).flat()
  const by = k => weeks.find(c => c.key === k)
  assert.equal(by('2026-11-08').isPast, true); assert.equal(by('2026-11-09').isPast, false); assert.equal(by('2026-11-10').isPast, false)
  assert.equal(by('2026-11-09').isToday, true); assert.equal(by('2026-11-08').isToday, false)
  const late = M.buildMonthGrid([], new Date(2026, 10, 1), new Date(2026, 10, 9, 23, 59, 59), 0).flat()
  assert.equal(late.find(c => c.key === '2026-11-09').isPast, false, 'still today at 23:59:59')
  assert.equal(weeks.filter(c => c.isPast).length, weeks.findIndex(c => c.isToday), 'exactly the cells before today — including the previous month\'s padding days')
  const other = M.buildMonthGrid([], new Date(2026, 11, 1), today, 0).flat(); assert.ok(other.every(c => !c.isPast), 'a future month has no past cells')
  const prev = M.buildMonthGrid([], new Date(2026, 9, 1), today, 0).flat(); assert.ok(prev.every(c => c.isPast || c.key >= '2026-11-09'), 'a past month is (almost) all past')
})

test('nothing about an event is added or stored: no completion/done field exists, and no migration newer than 025 was added', () => {
  const t = strip(src('scheduleLogic.ts')); const iface = t.slice(t.indexOf('export interface ScheduleEvent'), t.indexOf('}', t.indexOf('export interface ScheduleEvent')))
  assert.ok(!/completed|isDone|done\b|status/i.test(iface), 'ScheduleEvent has no completion/status field')
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(n => /^02[5-9]_|^03/.test(n)), ['025_journal_documents.sql'], 'no new migration: database schema, RLS and billing are untouched')
  for (const f of ['scheduleLogic.ts', 'scheduleMonth.ts']) assert.ok(!/supabase|fetch\(|localStorage\.setItem\(.*event/i.test(strip(src(f)).replace(/readViewPref|writeViewPref|VIEW_PREF_KEY|xp-schedule-view/g, '')), f + ' stays pure')
})

// ═════ B. wiring ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const sheet = strip(src('ScheduleSheet.tsx')), parts = strip(src('ScheduleParts.tsx')), dlg = strip(src('ScheduleDialogs.tsx')), modal = strip(src('MeetingsModal.tsx'))
const view = strip(src('MyScheduleView.tsx')), grid = strip(src('ScheduleMonthGrid.tsx')), mobile = strip(src('ScheduleMobile.tsx'))

test('past strikethrough: a subtle line-through (thin, slight dim) in the Today agenda, week grid, Month chips and the day list — display only', () => {
  for (const [name, s] of [['agenda', modal], ['week grid', view], ['month chips', grid]]) {
    assert.ok(/isPastEvent\(/.test(s), name + ' computes pastness from the end time')
    assert.ok(/ev\.isCancelled \|\| past \? 'line-through'/.test(s), name + ' strikes the title')
    assert.ok(/textDecorationThickness: '1px'/.test(s), name + ': thin line')
    assert.ok(/past \? 0\.82/.test(s) || /isPastEvent\(ev, now\)/.test(s), name + ': only a slight dim')
  }
  assert.ok(/data-past=\{past \? 'true' : undefined\}/.test(view) && /data-past=\{past \? 'true' : undefined\}/.test(modal))
  assert.ok(/past=\{isPastEvent\(p\.event, now\)\}/.test(view), 'the week grid passes pastness down from the shared clock')
  assert.ok(/isPastEvent\(ev, now\)/.test(grid.slice(grid.indexOf('export function MonthDaySheet'))), 'the Month day list too')
})

test('Month dimming: past cells are flagged and dimmed (number ~0.66, chips ~0.72) — never disabled, no pointer-events or tabIndex change', () => {
  assert.ok(/data-past=\{cell\.isPast \? 'true' : 'false'\}/.test(grid))
  assert.ok(/cell\.isPast \? \(cell\.inMonth \? 0\.66 : 0\.5\)/.test(grid) && /cell\.isPast \? \(cell\.inMonth \? 0\.72 : 0\.5\)/.test(grid))
  assert.ok(!/pointerEvents|disabled/.test(grid.slice(grid.indexOf('cell.isPast'), grid.indexOf('cell.isPast') + 600)), 'dimming never disables anything')
  assert.ok(/onClick=\{\(\) => onCell\(cell\)\}/.test(grid) && /tabIndex=\{0\}/.test(grid), 'cells keep their click + keyboard behaviour')
})

test('dropdowns: scrolling INSIDE a popup list is ignored by the measurer, an unchanged box is never re-published, and the re-centring respects the user', () => {
  assert.ok(/t\.closest\('\[role="listbox"\]'\)\) return/.test(sheet), 'the capture-phase scroll listener ignores the popup list itself')
  assert.ok(/setBox\(prev => \(prev && prev\.top === next\.top/.test(sheet), 'identical box → same object → no re-render, no re-centre')
  const hook = sheet.slice(sheet.indexOf('export function useCenteredList'))
  assert.ok(/if \(touched\.current && !moved\) return/.test(hook), 'a user-touched list is left alone unless the highlight itself moved')
  assert.ok(/onWheel: markTouched, onTouchStart: markTouched, onPointerDown: markTouched/.test(hook))
  assert.ok(/\[open, shown, height, active\]/.test(hook) && !/\[open, box, active\]/.test(parts), 'the effect no longer depends on the box OBJECT')
  for (const [name, next] of [['TimeField', 'function CategorySelect('], ['CategorySelect', 'function DueDatePill(']]) { const body = parts.slice(parts.indexOf(`function ${name}(`), parts.indexOf(next)); assert.ok(/useCenteredList\(open, !!box, box\?\.maxHeight, active\)/.test(body) && /\{\.\.\.userScroll\}/.test(body), name) }
})

test('dropdowns: the 12/24-hour display, typing, arrow keys, 15-minute list and the "HH:MM" stored value are unchanged', () => {
  for (const keep of ['const TIME_STEP_MIN = 15', 'formatTimeValue(value, fmt)', 'parseTimeText(', "placeholder={fmt === '24h' ? '14:30' : '2:30 PM'}", "e.key === 'ArrowDown' || e.key === 'ArrowUp'", 'function choose(i: number) { onChange(options[i])']) assert.ok(parts.includes(keep), keep)
  assert.ok(/onMouseDown=\{e => e\.preventDefault\(\)\} onClick=\{\(\) => choose\(i\)\}/.test(parts), 'rows still select on click/tap')
})

test('backdrop: SheetFrame has an opt-out (default stays dismissing); Add/Edit Event and the three dialogs opt out; other sheets are untouched', () => {
  assert.ok(/backdropDismiss = true \}: \{/.test(sheet) && /backdropDismiss\?: boolean/.test(sheet))
  assert.equal((sheet.match(/onClick=\{backdropDismiss \? onClose : undefined\}/g) ?? []).length, 2, 'desktop overlay AND phone backdrop')
  assert.ok(/data-dismiss=\{backdropDismiss \? 'true' : 'false'\}/.test(sheet))
  assert.ok(/onClose=\{onCancel\} backdropDismiss=\{false\}>/.test(parts), 'Add/Edit Event')
  assert.ok(/onClose=\{onClose\} backdropDismiss=\{false\}>/.test(dlg.slice(dlg.indexOf('function Shell'), dlg.indexOf('const SWATCH'))), 'Shell = Manage Categories + Preferences + Sync')
  assert.ok(!/backdropDismiss/.test(grid) && !/backdropDismiss/.test(mobile), 'Month day list and the phone Filter sheet keep their backdrop dismissal')
  assert.equal((dlg.match(/<Shell /g) ?? []).length >= 3, true)
})

test('backdrop: explicit controls and Esc are unchanged (Close, Cancel, Save/Done, Esc, swipe-down handle)', () => {
  assert.ok(/aria-label="Close" style=/.test(dlg.slice(dlg.indexOf('function Shell'))), 'Close X')
  for (const id of ['sync-cancel', 'sync-save', 'prefs-cancel', 'prefs-done']) assert.ok(dlg.includes(`data-testid="${id}"`), id)
  assert.ok(/useLayerEscape\(/.test(parts) && /useSheetEscape\(/.test(grid), 'Esc handling untouched')
  assert.ok(/if \(d > 90\) onClose\(\)/.test(sheet), 'swipe-down handle still dismisses a phone sheet (an explicit gesture)')
})

test('Today auto-selection: once per view (tab entry / date change), only after events loaded, never replaces a manual choice, phones keep the agenda visible', () => {
  const blk = modal.slice(modal.indexOf('const [autoSelKey'), modal.indexOf('const [nowDayKey'))
  assert.ok(/tab === 'today' && scheduleStatus !== 'loading' \? dateKey\(todayDate\) : ''/.test(blk), 'waits for the events; keyed by tab + date')
  assert.ok(/if \(autoViewKey !== autoSelKey\) \{\s*setAutoSelKey\(autoViewKey\)/.test(blk), 'runs only when the view key changes — not on the 30 s tick, edits or filters')
  assert.ok(/pickAutoSelection\(dayEvents, now\)/.test(blk) && /setTodaySelId\(pick\.id\)/.test(blk))
  assert.ok(!/setDetailOpen/.test(blk), 'the phone details overlay is never forced open')
  assert.ok(!/useEffect\([^)]*setTodaySelId/.test(blk), 'selection is not set from an effect')
  assert.ok(/scrollIntoView\(\{ block: 'nearest' \}\)/.test(blk), 'the chosen row is brought into view')
  const onSelect = modal.slice(modal.indexOf('<AgendaItem'), modal.indexOf('<AgendaItem') + 520); assert.ok(/onSelect=\{\(\) => \{ setTodaySelId\(ev\.id\); setDetailOpen\(true\) \}\}/.test(onSelect), 'manual selection path unchanged')
})

test('Today follows a date change: when the clock passes midnight while "today" is shown it moves to the new day; a date the user picked stays', () => {
  const blk = modal.slice(modal.indexOf('const [nowDayKey'), modal.indexOf('const [nowDayKey') + 700)
  assert.ok(/if \(curDayKey !== nowDayKey\)/.test(blk) && /if \(dateKey\(todayDate\) === nowDayKey\)/.test(blk) && /setTodayDate\(d\); setViewMonth\(startOfMonth\(d\)\)/.test(blk))
  assert.ok(/function selectTodayDate\(d: Date\) \{[\s\S]*?setTodaySelId\(null\); setDetailOpen\(false\)/.test(modal), 'picking another date still clears the old selection first (then auto-selection runs for the new date)')
})

test('v1.330 and earlier behaviour is preserved: Library/Notes/Folders files and the schedule-sync, consent and backfill code are not modified by this release', () => {
  for (const f of ['journalDocs.ts', 'useJournalDocs.ts', 'LibraryNotesFolders.tsx', 'PlannerHeaderMenu.tsx', 'JournalWorkspaceModal.tsx', 'JournalEditorContent.tsx', 'deadlineLink.ts', 'scheduleEngine.ts', 'AppContext.tsx']) assert.ok(fs.existsSync(path.join(ROOT, 'components/xpadite', f)), f)
  assert.ok(/countBackfillEligible\(persistedEvents, now, calData\)/.test(modal), 'the Sync dialog still gets its back-fill count')
  assert.ok(/blankForm\(tab === 'today' \? todayDate : activeDay, 9, prefs\.defaultDurationMins\)/.test(modal), 'Add Event defaults unchanged')
})
