// My Schedule v1.326 polish: whole-hour slot highlight, time dropdown, owner editing, phone sheets, rounded arrows, category
// dropdown, pastel palette. Logic tests run the real modules; structure tests pin the wiring that unit tests cannot see.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-v326'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleEngine')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))
const src = f => read(`components/xpadite/${f}`)
const ev = (id, s, e, x = {}) => ({ id, title: id, category: 'meeting', startAt: s, endAt: e, ...x })
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

// ── Task 1: whole-hour highlight ────────────────────────────────────────────
test('empty-slot selection is a whole hour: click anywhere in 7:xx → 07:00, full-height cell, default duration applied', () => {
  assert.equal(E.SLOT_MINUTES, 60)
  for (const off of [0, 1, 27, 28, 55]) assert.equal(E.minutesFromOffset(7 * 56 + off, 56), 7 * 60, `offset ${off}px inside the 7 AM cell`)
  assert.equal(E.minutesFromOffset(8 * 56, 56), 8 * 60)
  const f = L.blankFormAt(new Date(2026, 10, 4), 7 * 60, 45); assert.deepEqual([f.start, f.end], ['07:00', '07:45'], 'start on the hour, end from the preferred duration')
  assert.deepEqual([L.blankFormAt(new Date(2026, 10, 4), 23 * 60, 120).start, L.blankFormAt(new Date(2026, 10, 4), 23 * 60, 120).end], ['23:00', '23:59'])
})
test('slot highlight wiring: full column width, one-hour height, dashed purple, centred + Add, under events', () => {
  const v = src('MyScheduleView.tsx')
  const hl = v.slice(v.indexOf('data-testid="slot-highlight"'), v.indexOf('data-testid="slot-add"'))
  assert.ok(/absolute left-0 right-0 flex items-center justify-center/.test(hl) && /height: \(SLOT_MINUTES \/ 60\) \* HOUR_PX/.test(hl), 'left-0/right-0 = whole column; height = SLOT_MINUTES (60) of HOUR_PX')
  assert.ok(/border: '1\.5px dashed #7c3aed'/.test(hl) && /borderRadius: 6/.test(hl) && /zIndex: 1/.test(hl), 'dashed purple, rounded, below events (z 2+)')
  assert.ok(/zIndex: selected \? 3 : 2/.test(v), 'event blocks sit above the highlight')
  assert.ok(/isDoubleTap\(lastTapRef\.current, key, Date\.now\(\)\)/.test(v) && /onAddAt\(d, slotHere\.min\)/.test(v), 'click + Add / double-click still open the form for that hour')
})

// ── Task 2: time list ───────────────────────────────────────────────────────
test('time list data: every 15 minutes, 96 entries, both formats round-trip, 24-hour stored value untouched', () => {
  const o = L.timeOptions(15); assert.equal(o.length, 96); assert.deepEqual([o[0], o[36], o[37], o[38], o[39], o[95]], ['00:00', '09:00', '09:15', '09:30', '09:45', '23:45'])
  assert.deepEqual([36, 37, 38, 39].map(i => L.formatTimeValue(o[i], '12h')), ['9:00 AM', '9:15 AM', '9:30 AM', '9:45 AM'])
  assert.deepEqual([36, 37, 38, 39].map(i => L.formatTimeValue(o[i], '24h')), ['09:00', '09:15', '09:30', '09:45'])
  assert.deepEqual([0, 48, 95].map(i => L.formatTimeValue(o[i], '12h')), ['12:00 AM', '12:00 PM', '11:45 PM'], 'clear AM/PM at midnight and noon')
  for (const t of o) assert.equal(L.parseTimeText(L.formatTimeValue(t, '12h')), t)
})
test('time picker UI: a real listbox (not a datalist), highlight + scroll to the selected time, manual entry and keys kept', () => {
  const p = src('ScheduleParts.tsx')
  assert.ok(!/<datalist/.test(p) && /role="listbox"/.test(p) && /role="combobox"/.test(p) && /data-testid="time-list"/.test(p))
  assert.ok(/aria-selected=\{sel\}/.test(p) && /ul\.scrollTop = el\.offsetTop - ul\.clientHeight \/ 2/.test(p), 'selected row highlighted and centred')
  assert.ok(/overflowY: 'auto'/.test(p) && /overscrollBehavior: 'contain'/.test(p), 'mouse-wheel and touch scrolling')
  assert.ok(/onClick=\{\(\) => \{ if \(!open\) openList\(\) \}\}/.test(p) && /data-testid=\{`\$\{id\}-arrow`\}/.test(p), 'tapping the field or its arrow opens the list')
  assert.ok(/parseTimeText\(t\)/.test(p) && /e\.key === 'Enter' && draft !== null/.test(p) && /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/.test(p) && /e\.key === 'Escape'/.test(p), 'typing, Enter, arrows, Escape')
  assert.ok(/formatTimeValue\(o, fmt\)/.test(p) && /timeOptions\(TIME_STEP_MIN\)/.test(p) && /TIME_STEP_MIN = 15/.test(p), '15-minute list in the chosen format')
  assert.ok(!/type="time"/.test(p.replace(/\/\*[\s\S]*?\*\//g, '')), 'no browser-native time input reintroduced')
})
test('popup positioning stays inside the visible viewport (keyboard-aware) and never behind the modal', () => {
  const s = src('ScheduleSheet.tsx')
  assert.ok(/window\.visualViewport/.test(s) && /position: 'fixed'/.test(src('ScheduleParts.tsx')) && /maxHeight/.test(s), 'fixed, measured against the visual viewport, height-capped')
  assert.ok(/transform: dragY !== null \? `translateY\(\$\{dragY\}px\)` : visible \? 'none' : 'translateY\(100%\)'/.test(s), 'a settled sheet has NO transform, so fixed popups inside it are positioned against the viewport')
})
test('overnight, end dates, 7-day cap, DST-safe parsing and conflicts are untouched by the picker change', () => {
  assert.deepEqual(L.validateScheduleForm({ title: 'x', date: '2026-11-04', endDate: '2026-11-05', start: '22:00', end: '01:30', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none' }), {})
  assert.ok(L.validateScheduleForm({ title: 'x', date: '2026-11-04', endDate: '2026-11-20', start: '10:00', end: '11:00', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none' }).endDate)
  assert.match(E.formConflict({ date: '2026-11-04', endDate: '2026-11-04', start: '10:30', end: '11:30' }, [ev('A', at(2026, 11, 4, 10), at(2026, 11, 4, 11))]), /already have 'A'/)
  assert.equal(E.DOUBLE_TAP_MS, 400)
})

// ── Task 3: XPadite-owned events ────────────────────────────────────────────
test('a Meet / Zoom / Teams link never makes an XPadite event read-only: it stays editable, duplicable, draggable', () => {
  for (const url of ['https://meet.google.com/abc-defg-hij', 'https://zoom.us/j/123', 'https://teams.microsoft.com/l/meetup-join/x']) {
    const f = { title: 'Sync', date: '2026-11-04', endDate: '2026-11-04', start: '09:00', end: '10:00', category: 'meeting', location: 'Room 1', meetingUrl: url, notes: 'n', reminderMins: 15, recurrence: 'none' }
    const fields = L.formToEventFields(f); const e = { id: 'user-sched-1', ...fields }
    assert.equal(e.readOnly, undefined); assert.equal(e.source, undefined); assert.ok(e.meetingUrl)
    assert.equal(E.canDuplicate(e), true); assert.equal(E.dragBlockReason(e), null)
    assert.equal(E.planMove(e, new Date(2026, 10, 5), 14 * 60, [e]).ok, true)
    const back = L.eventToForm(e); assert.equal(back.meetingUrl, fields.meetingUrl, 'the link survives an edit round-trip')
    assert.deepEqual(L.validateScheduleForm({ ...back, title: 'Sync 2', location: 'Room 2', notes: 'm' }), {})
  }
})
test('synced Google / Outlook events stay read-only with a clear marker; nothing claims to write to them', () => {
  const g = L.meetingToScheduleEvent({ id: 'g1', provider: 'google', calendarSource: 'Google Calendar', title: 'Standup', startAt: 1, endAt: 2, meetingUrl: 'https://meet.google.com/x', isCancelled: false, notes: '' })
  assert.equal(g.readOnly, true); assert.equal(g.source, 'google'); assert.equal(E.canDuplicate(g), false); assert.equal(E.dragBlockReason(g).block, 'readonly')
  const p = src('ScheduleParts.tsx'), v = src('MyScheduleView.tsx'), m = src('MeetingsModal.tsx')
  assert.ok(/data-testid="readonly-badge"/.test(p) && /· read-only/.test(p) && /\{!ev\.readOnly && \(/.test(p), 'badge shown, edit/delete only for non-read-only')
  assert.ok(/data-testid="readonly-lock"/.test(v), 'lock marker on synced blocks in the grid')
  assert.ok(/if \(ev\.readOnly\) return/.test(m), 'the modal also refuses to open the editor for a read-only event')
  assert.ok(!/googleapis|graph\.microsoft|fetch\(/.test(m + v + p), 'no external write integration')
})

// ── Tasks 4–5: phone toolbar + Filter sheet ─────────────────────────────────
test('phone breakpoint is below sm (640px); portrait tablets (768+) are not phones', () => {
  assert.match(src('ScheduleSheet.tsx'), /PHONE_QUERY = '\(max-width: 639px\)'/)
  assert.ok(/export \{ PHONE_QUERY, useIsPhone \} from '\.\/ScheduleSheet'/.test(src('ScheduleMobile.tsx')))
})
test('phone toolbar: rounded-square arrows (not bare triangles), Today + Filter in row 2, no third row', () => {
  const v = src('MyScheduleView.tsx'), mb = src('ScheduleMobile.tsx')
  const phoneBranch = v.slice(v.indexOf('{phone ? ('), v.indexOf(') : (\n              <>'))
  assert.equal((phoneBranch.match(/<NavGroup compact/g) || []).length, 2, 'month and week use the rounded NavGroup')
  assert.ok(!/TriangleNav|Triangle/.test(v + mb), 'bare triangles are gone')
  assert.ok(/borderRadius: 10/.test(v.slice(v.indexOf('if (compact)'), v.indexOf('if (compact)') + 700)) && /background: 'var\(--xp-card\)'/.test(v.slice(v.indexOf('if (compact)'), v.indexOf('if (compact)') + 1200)), 'rounded, filled controls')
  const tf = v.slice(v.indexOf('const phoneTodayFilter'), v.indexOf('const dragEv'))     // Today + Filter are one unit (grouped on the right in Month View)
  assert.ok(phoneBranch.indexOf('<NavGroup compact') < phoneBranch.indexOf('phoneTodayFilter') && tf.indexOf('today-btn') > -1 && tf.indexOf('today-btn') < tf.indexOf('<FilterIconButton'), 'month, week, Today, Filter in order')
  assert.ok(/weekRangeShort\(anchor, prefs\.weekStart\)/.test(phoneBranch), 'week-start preference kept')
  assert.ok(/\.xp-nav-sq::after \{ content: ''; position: absolute; inset: -7px -2px; \}/.test(v), 'enlarged invisible tap area')
  const rest = v.slice(v.indexOf(') : (\n              <>'), v.indexOf('{/* Grid */}'))
  assert.ok(/<NavGroup label=\{monthYearLabel\(anchor\)\} shortLabel=\{monthYearShort\(anchor\)\} minWidth=\{64\}/.test(rest) && /<FilterSelect/.test(rest), 'tablet/desktop navigation and filter dropdown untouched')
})
test('Filter is a bottom sheet over the calendar (not a push-down panel): slides up, dimmed backdrop, rounded top, swipe/backdrop/Cancel', () => {
  const v = src('MyScheduleView.tsx'), mb = src('ScheduleMobile.tsx'), s = src('ScheduleSheet.tsx')
  assert.ok(/<FilterSheet open=\{panel\.kind === 'filter'\}/.test(v) && !/<FilterPanel/.test(v + mb), 'the icon and the menu drive the same sheet')
  assert.ok(/<SlideDown open=\{panel\.kind === 'search'\}/.test(v), 'only Search uses the slide-down bar; opening Filter never pushes the calendar')
  assert.ok(/<SheetFrame phone visible=\{visible\} variant="sheet" label="Filter events"/.test(mb), 'bottom-sheet variant')
  assert.ok(/borderTopLeftRadius: full \? 0 : 22/.test(s) && /rgba\(15,10,30,0\.5\)/.test(s) && /maxHeight: full \? '100%' : '88%'/.test(s) && /env\(safe-area-inset-bottom/.test(s), 'rounded top, dim backdrop, height cap, safe area')
  assert.ok(/onClick=\{onClose\} data-testid="sheet-backdrop"/.test(s) && /data-testid="sheet-handle"/.test(s) && /if \(d > 90\) onClose\(\)/.test(s), 'backdrop tap and swipe-down dismiss')
  assert.ok(/data-testid="filter-cancel"/.test(mb) && /data-testid="filter-apply"/.test(mb) && /data-testid="filter-reset"/.test(mb) && /categories\.map\(c =>/.test(mb) && /FILTER_SOURCES\.map/.test(mb) && /overflow-y-auto/.test(mb), 'Cancel / Apply / Reset, categories and calendars, scrollable (list redesigned in v1.327)')
  assert.ok(/top: sheetTop/.test(v) && /new ResizeObserver\(measure\)/.test(v), 'the sheet starts below the toolbar so the header and both rows stay clear')
  assert.ok(/isFilterActive\(\{ filter, hidden, hiddenSources \}\)/.test(v) && /data-testid="filter-active-dot"/.test(mb), 'active-filter indicator')
  assert.ok(/useSheetEscape\(visible, onClose\)/.test(mb), 'Escape closes it')
})
test('Search (not redesigned) keeps working: menu entry, shared query, bar under row 2, chip, one-panel-at-a-time', () => {
  const m = src('MeetingsModal.tsx'), v = src('MyScheduleView.tsx'), mb = src('ScheduleMobile.tsx')
  assert.ok(/onSearch=\{phone && tab !== 'today'/.test(m) && /onFilter=\{phone && tab !== 'today'/.test(m))
  assert.ok(/kind === null \? \{ \.\.\.p, kind: null \} : \{ kind, nonce: p\.nonce \+ 1 \}/.test(m), 'opening one panel replaces the other')
  assert.ok(/<SearchPanel query=\{query\}/.test(v) && /<ActiveSearchChip/.test(v) && /data-testid="search-clear"/.test(mb) && /const \[query, setQuery\] = useState\(''\)/.test(m))
  assert.ok(/<FilterSheet key=/.test(v) === false && /key=\{panel\.nonce\}/.test(v) === false, 'sheet unmounts itself after closing, so every open starts from the applied filter')
})

// ── Tasks 6–8, 13: sheets and full-screen form ──────────────────────────────
test('one reusable sheet frame serves Filter, Manage Categories, Preferences and Add/Edit', () => {
  const s = src('ScheduleSheet.tsx')
  for (const f of ['ScheduleMobile.tsx', 'ScheduleDialogs.tsx', 'ScheduleParts.tsx']) assert.ok(/SheetFrame/.test(src(f)), f)
  assert.equal((src('ScheduleDialogs.tsx').match(/variant="sheet"/g) || []).length, 1, 'Manage Categories + Preferences share one Shell')
  assert.ok(/variant="full" as="form"/.test(src('ScheduleParts.tsx')), 'Add/Edit is the full-screen variant')
  assert.ok(/export function useSheetPhase\(open: boolean, animate: boolean\)/.test(s) && /SHEET_MS \+ 40/.test(s) && /return animate \? \{ mounted, visible \} : \{ mounted: open, visible: open \}/.test(s), 'exit animation on phones; instant (unchanged) elsewhere')
  const m = src('MeetingsModal.tsx')
  assert.ok(/\.xp-sheet-fade \{ transition: opacity 260ms ease; \}/.test(m) && /\.xp-sheet-panel \{ transition: transform 280ms cubic-bezier\(0\.32, 0\.72, 0, 1\); \}/.test(m) && /prefers-reduced-motion: reduce\) \{ \.xp-sheet-fade, \.xp-sheet-panel \{ transition: none !important; \}/.test(m), 'one easing/duration; reduced motion honoured')
  assert.ok(/open=\{!!form\}/.test(m) && /open=\{dialog === 'categories'\}/.test(m) && /open=\{dialog === 'prefs'\}/.test(m), 'overlays stay mounted through their exit')
})
test('non-phone rendering of the dialogs is the original centred dialog (same classes as v1.325)', () => {
  const s = src('ScheduleSheet.tsx'); const i = s.indexOf('if (!phone) {'), j = s.indexOf('const full = variant')
  const block = s.slice(i, j)
  assert.ok(/absolute inset-0 \$\{zClass\} flex items-end sm:items-center justify-center sm:p-4/.test(block) && /xp-sch-sheet w-full \$\{desktopClass\} flex flex-col/.test(block) && /rgba\(0,0,0,0\.5\)/.test(block) && /borderRadius: 18, maxHeight: '94%'/.test(block))
  assert.ok(/desktopClass = 'sm:max-w-\[480px\]'/.test(s))
})
test('Add/Edit on phones: full-screen with sticky actions, safe areas, keyboard handling; header + footer unchanged on larger screens', () => {
  const p = src('ScheduleParts.tsx'), s = src('ScheduleSheet.tsx')
  assert.ok(/height: full \? '100%' : undefined/.test(s) && /paddingBottom: 'env\(safe-area-inset-bottom/.test(s))
  assert.ok(/paddingTop: phone \? 'max\(14px, env\(safe-area-inset-top, 0px\)\)' : undefined/.test(p), 'status-bar safe area on the header')
  assert.ok(/flex-1 min-h-0 overflow-y-auto/.test(p) && /flex gap-2 px-4 py-3 flex-shrink-0/.test(p), 'scrolling body, pinned action row')
  assert.ok(/onFocusCapture/.test(p) && /scrollIntoView\(\{ block: 'center'/.test(p), 'focused field kept clear of the keyboard')
  assert.ok(/EventFormInner \{\.\.\.props\} phone=\{phone\} visible=\{visible\}/.test(p), 'form state lives in the inner component, so it is kept while open and reset after the exit')
})

// ── Task 9: category dropdown ───────────────────────────────────────────────
test('phone category dropdown lists built-in + custom categories with colours; desktop keeps the pills', () => {
  const p = src('ScheduleParts.tsx')
  assert.ok(/\{phone \? <CategorySelect id="sch-category" value=\{v\.category\}/.test(p) && /role="radiogroup" aria-label="Category"/.test(p), 'dropdown on phones, pills elsewhere')
  const c = p.slice(p.indexOf('function CategorySelect'), p.indexOf('interface EventFormProps'))
  assert.ok(/categories\.map\(\(c, i\)/.test(c) && /role="listbox"/.test(c) && /overflowY|popupStyle/.test(c) && /onChange\(categories\[i\]\.id\)/.test(c), 'every category, by id')
  assert.ok(/aria-expanded=\{open\}/.test(c) && /e\.key === 'ArrowDown'/.test(c) && /e\.key === 'Escape'/.test(c), 'keyboard + ARIA')
  assert.ok(/background: cur\.bg, borderColor: cur\.edge, color: cur\.text/.test(c), 'shows the selected category colour')
})

// ── Task 10: palette ────────────────────────────────────────────────────────
test('pastel palette: ten soft colours, readable derived text, no clash with the six defaults; existing data not recoloured', () => {
  const sw = E.CATEGORY_SWATCHES; assert.equal(sw.length, 10); assert.equal(new Set(sw).size, 10)
  const luma = h => { const n = parseInt(h.slice(1), 16); return 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255) }
  for (const h of sw) assert.ok(luma(h) >= 150, `${h} is a soft colour`)
  const used = new Set(L.SCHEDULE_CATEGORIES.map(c => c.edge)); for (const h of sw) assert.ok(!used.has(h), h)
  const lum = h => { const n = parseInt(h.slice(1), 16); const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255) }
  for (const h of sw) { const c = E.categoryColors(h); const [a, b] = [lum(c.bg), lum(c.text)].sort((x, y) => y - x); assert.ok((a + 0.05) / (b + 0.05) >= 4.5, h) }
  assert.deepEqual(L.SCHEDULE_CATEGORIES.map(c => c.bg), ['#e4d4fb', '#bff5d9', '#fbd3ea', '#c3e2fb', '#fbf6a8', '#fddbae'], 'the six default colours are unchanged')
  const old = { id: 'cat-old', label: 'Old', ...E.categoryColors('#ef4444') }
  const cats = [...L.SCHEDULE_CATEGORIES, old]; const added = E.addCategory(cats, 'New', sw[0], 'cat-new')
  assert.equal(added.ok, true); assert.deepEqual(added.categories.find(c => c.id === 'cat-old'), old, 'an existing custom category keeps its colour')
  assert.equal(E.addCategory(cats, 'Again', '#ef4444', 'cat-x').ok, false, 'old saturated colours still count as used')
})
test('circular custom colour picker: same size as the swatches, selected state, native colour input, keyboard focus ring', () => {
  const d = src('ScheduleDialogs.tsx')
  assert.ok(/const SWATCH = 28/.test(d) && (d.match(/width: SWATCH, height: SWATCH/g) || []).length >= 2 && (d.match(/borderRadius: '50%'/g) || []).length >= 2, 'swatches and the custom control share one circular size')
  assert.ok(/data-testid="custom-color"/.test(d) && /<input type="color"[\s\S]{0,200}aria-label="Custom colour"/.test(d) && /xp-cpick:focus-within/.test(d), 'native colour input, accessible, focus ring')
  assert.ok(/custom \? '3px solid var\(--xp-txt\)'/.test(d) && /conic-gradient/.test(d), 'clear selected state; rainbow ring until used')
  assert.ok(!/Custom<\/label>|Custom\n/.test(d.replace(/aria-label="Custom colour"/g, '')), 'no rectangular swatch + text label')
})

// ── Task 11 + 12 + frontend-only ────────────────────────────────────────────
test('recurring events still cannot be dragged; series editing not introduced', () => {
  const w = ev('w', 1, 2, { recurrence: 'weekly' }); assert.equal(E.dragBlockReason(w).block, 'recurring'); assert.equal(E.planMove(w, new Date(2026, 10, 5), 14 * 60, [w]).ok, false)
  assert.ok(!/exception|series/i.test(src('scheduleEngine.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
})
test('still frontend-only: no storage, network, Supabase, or version bump', () => {
  for (const f of ['ScheduleSheet.tsx', 'ScheduleMobile.tsx', 'ScheduleDialogs.tsx', 'ScheduleParts.tsx', 'MyScheduleView.tsx', 'MeetingsModal.tsx', 'scheduleEngine.ts']) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/supabase|fetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest/i.test(code), f)
  }
  assert.ok(!/1\.326|1\.325/.test(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''), 'version is not tracked in package.json')
})
