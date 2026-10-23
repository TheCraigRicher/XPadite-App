// Monthly-calendar day drill-down → latest Daily Dashboard (DayFullPage). Source-level guards + the date parser.
// (A real render needs the signed-in App; see the manual checklist in the release notes.)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const app = read('components/xpadite/XpaditeApp.tsx')
const dfp = read('components/xpadite/DayFullPage.tsx')

// Pull the pure parseDateKey out of DayFullPage.tsx and run it.
const fnSrc = dfp.slice(dfp.indexOf('export function parseDateKey'), dfp.indexOf('export function DayFullPage('))
const parseDateKey = new Function(ts.transpileModule(fnSrc.replace('export function', 'function') + '\nreturn parseDateKey', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText.replace(/^"use strict";?/, ''))()

test('parseDateKey: valid keys become that exact local day, including month/year boundaries and leap day', () => {
  for (const [key, y, m, d] of [['2026-10-22', 2026, 9, 22], ['2026-01-01', 2026, 0, 1], ['2025-12-31', 2025, 11, 31], ['2028-02-29', 2028, 1, 29], ['2026-03-01', 2026, 2, 1]]) {
    const dt = parseDateKey(key)
    assert.deepEqual([dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours()], [y, m, d, 0], key)
  }
})

test('parseDateKey: malformed or impossible dates fall back (null) instead of showing the wrong day', () => {
  for (const bad of [undefined, '', '2026-9-22', '2026-13-01', '2026-02-30', '2027-02-29', 'abc', '22-10-2026', '2026-10-22T00:00']) assert.equal(parseDateKey(bad), null, String(bad))
})

test('DayFullPage: opens on the requested day; all data stays keyed to the selected day; default is still today', () => {
  assert.ok(/useState\(\(\) => parseDateKey\(initialDateKey\) \?\? todayDateInTz\(effectiveTimezone\)\)/.test(dfp), 'initial day = key, else today (unchanged normal behaviour)')
  assert.ok(/const dayRecord = calData\[selectedKey\]/.test(dfp), 'sessions/tasks/pending come from the selected day only')
  assert.ok(/<DayFullPage onClose=\{onClose\} initialDateKey=\{key\} \/>/.test(dfp))
  assert.ok(/initialDateKey\?: string/.test(dfp))
})

test('Analytics keeps rendering DayFullPage with NO date (today), exactly as before', () => {
  const am = read('components/xpadite/AnalyticsModal.tsx')
  assert.ok(/<DayFullPage onClose=\{\(\) => setOpenDashboard\(null\)\} \/>/.test(am))
})

test('routing: Monthly calendar drill-downs (Expandable Month, month zoom, Analytics) are flagged and open the latest dashboard', () => {
  assert.equal((app.match(/fromMonthly: true/g) || []).length, 3, 'three monthly entry points flagged')
  assert.ok(/onDayDoubleClick=\{\(key, month, day\) => \{ setAnalyticsOpen\(false\); setModalDay\(\{ key, month, day, fromMonthly: true \}\) \}\}/.test(app))
  assert.ok(/dashboardDay\?\.fromMonthly && \(\s*<DayFullPageModal key=\{dashboardDay\.key\} dateKey=\{dashboardDay\.key\} onClose=\{\(\) => setDashboardDay\(null\)\} \/>/.test(app))
})

test('routing: other entry points (main calendar → Task Manager) keep the existing DayDashboardModal', () => {
  assert.ok(/dashboardDay && !dashboardDay\.fromMonthly && \(\s*<DayDashboardModal/.test(app))
  assert.ok(/onDayDoubleClick=\{\(key, month, day\) => setModalDay\(\{ key, month, day \}\)\}/.test(app), 'main calendar double-click is not flagged')
  const ap = read('components/xpadite/AnalyticsPage.tsx')
  assert.ok(ap.includes('<DayDashboardModal'), 'untouched')
})

test('day navigation inside the Task Manager day keeps the drill-down flag (no silent fallback to the old dashboard)', () => {
  assert.equal((app.match(/fromMonthly: modalDay\.fromMonthly/g) || []).length, 2, 'prev/next day and go-to-today both carry it')
})

test('back / close return to the day modal exactly like the dashboard they replace', () => {
  assert.ok(/onDashboard=\{\(\) => \{[\s\S]*?setDashboardDay\(modalDay\)/.test(app), 'the day (with its flag) is what opens the dashboard')
  assert.ok(/DayFullPageModal key=.*onClose=\{\(\) => setDashboardDay\(null\)\}/.test(app))
  assert.ok(/e\.key === 'Escape'\) onClose\(\)/.test(dfp.slice(dfp.indexOf('export function DayFullPageModal'))), 'Escape closes, as the old dashboard did')
  assert.ok(!/onClick=\{onClose\}[^>]*\n[^<]*backdrop/i.test(dfp), 'no click-outside dismissal introduced')
})

test('the shell matches the Analytics dashboard shell (one presentation), and no dashboard JSX was duplicated', () => {
  const shell = dfp.slice(dfp.indexOf('export function DayFullPageModal'))
  const am = read('components/xpadite/AnalyticsModal.tsx')
  const sig = 'sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6'
  assert.ok(shell.includes(sig) && am.includes(sig))
  assert.equal((app.match(/<DayFullPageModal/g) || []).length, 1)
})
