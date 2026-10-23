// ONE Daily Dashboard (DayFullPage) at every entry point. Source-level guards + the date parser.
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
const am = read('components/xpadite/AnalyticsModal.tsx')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

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
  assert.ok(/useState\(\(\) => parseDateKey\(initialDateKey\) \?\? todayDateInTz\(effectiveTimezone\)\)/.test(dfp))
  assert.ok(/const dayRecord = calData\[selectedKey\]/.test(dfp))
  assert.ok(/<DayFullPage onClose=\{onClose\} initialDateKey=\{key\} \/>/.test(dfp))
})

test('Analytics → Today still renders DayFullPage with NO date (defaults to today)', () => {
  assert.ok(/<DayFullPage onClose=\{\(\) => setOpenDashboard\(null\)\} \/>/.test(am))
})

test('main App: EVERY Dashboard action (main calendar, month zoom, Expandable Month, Analytics) opens the latest dashboard for the selected day', () => {
  const code = strip(app)
  assert.ok(!/DayDashboardModal/.test(code), 'the old dashboard is no longer rendered anywhere in the App shell')
  assert.equal((code.match(/<DayFullPageModal/g) || []).length, 1, 'a single dashboard mount')
  assert.ok(/\{dashboardDay && \(\s*<DayFullPageModal\s+key=\{dashboardDay\.key\}\s+dateKey=\{dashboardDay\.key\}/.test(code), 'opens on the selected day')
  // the day window's Dashboard button hands over the day that was opened, from any calendar
  assert.ok(/onDashboard=\{\(\) => \{[\s\S]*?setDashboardDay\(modalDay\)/.test(code))
  // main calendar double-click still opens the Task Manager day window first (intermediate window preserved)
  assert.ok(/<CalendarSection\s+onDayDoubleClick=\{\(key, month, day\) => setModalDay\(\{ key, month, day \}\)\}/.test(code))
  assert.ok(/<DayModal\b/.test(code))
})

test('no component outside the dashboard family still uses the retired DayDashboardModal component', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'components/xpadite')).filter(x => /\.tsx?$/.test(x))) {
    const code = strip(read('components/xpadite/' + f))
    assert.ok(!/<DayDashboardModal\b/.test(code) && !/import \{[^}]*\bDayDashboardModal\b[^}]*\}/.test(code), f)
  }
  const old = read('components/xpadite/DayDashboardModal.tsx')
  assert.ok(!/export function DayDashboardModal/.test(old))
  // the shared building blocks other dashboards import must still be there
  for (const name of ['AchievementBanner', 'PERFORMANCE_TIERS', 'getTaskPerformanceLevel', 'DonutChart', 'TASK_GRAD_STRINGS']) assert.ok(new RegExp(`export (function|const) ${name}\\b`).test(old), name)
})

test('legacy AnalyticsPage "today" view uses the same dashboard', () => {
  const ap = strip(read('components/xpadite/AnalyticsPage.tsx'))
  assert.ok(/<DayFullPageModal dateKey=\{todK\} onClose=\{\(\) => setSubView\(null\)\} \/>/.test(ap) && !/DayDashboardModal/.test(ap))
})

test('Back / Escape / × all close the dashboard to the day window underneath (as before); no click-outside dismissal', () => {
  const shell = dfp.slice(dfp.indexOf('export function DayFullPageModal'))
  assert.ok(/e\.key === 'Escape'\) onClose\(\)/.test(shell))
  assert.ok(/<DayFullPage onClose=\{onClose\}/.test(shell))
  assert.ok(!/onClick/.test(shell.slice(0, shell.indexOf('<DayFullPage onClose'))), 'the backdrop has no click handler')
})

test('Analytics → Monthly: the day opened from its calendar remembers the month; closing returns to that month\'s calendar', () => {
  const code = strip(app)
  assert.ok(/setAnalyticsRestore\(null\); setAnalyticsOpen\(false\); setModalDay\(\{ key, month, day, fromAnalyticsMonth: month \}\)/.test(code))
  assert.equal((code.match(/fromAnalyticsMonth: modalDay\.fromAnalyticsMonth/g) || []).length, 2, 'prev/next day and go-to-today keep it')
  // day window closes normally → return; but NOT when it closed in order to navigate elsewhere (pending navigation)
  assert.ok(/if \(pending\) \{[\s\S]*?pending\(\)\s*\} else \{\s*reopenAnalyticsMonth\(closing\)\s*\}/.test(code))
  // dashboard closed while no day window is open (the dirty-guard path) → also return
  assert.ok(/if \(!modalDay\) reopenAnalyticsMonth\(closing\)/.test(code))
  assert.ok(/function reopenAnalyticsMonth\(day: ModalDay \| null \| undefined\) \{\s*if \(day\?\.fromAnalyticsMonth === undefined\) return/.test(code))
  assert.ok(/function handleAnalyticsClose\(\) \{\s*setAnalyticsRestore\(null\)/.test(code), 'a normal close clears the restore')
  // other entry points never set it
  assert.equal((code.match(/fromAnalyticsMonth: month/g) || []).length, 1)
  const modal = strip(am)
  assert.ok(/restore\?: \{ month: number \}/.test(modal) && /\(restore \? 'monthly' : null\)/.test(modal))
  assert.ok(/month=\{restore\?\.month \?\? today\.getMonth\(\)\}/.test(modal) && /initialView=\{restore \? 'calendar' : 'dashboard'\}/.test(modal))
})

test('normal Analytics opening is unaffected (no restore → Today/Weekly/Monthly/Yearly cards as before)', () => {
  const modal = strip(am)
  assert.ok(/month=\{restore\?\.month \?\? today\.getMonth\(\)\}/.test(modal))
  assert.ok(/<AnalyticsModal\s+restore=\{analyticsRestore \?\? undefined\}/.test(strip(app)))
})
