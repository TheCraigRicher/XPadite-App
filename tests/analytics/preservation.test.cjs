// Feature preservation after retiring DayDashboardModal: AI Insights is reachable again; export/email had no entry point.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const dfp = read('components/xpadite/DayFullPage.tsx')
const am = read('components/xpadite/AnalyticsModal.tsx')

test('AI Insights pill exists in the dashboard header only when a handler is passed (standalone day dashboard)', () => {
  assert.ok(/onAiInsights\?: \(\) => void/.test(dfp))
  assert.ok(/\{onAiInsights && \(\s*<button\s+onClick=\{onAiInsights\}\s+aria-label="AI Insights"/.test(dfp))
  assert.ok(/<AICoachMenuIcon size=\{16\} \/>/.test(dfp), 'same icon asset as the old pill')
  const shell = dfp.slice(dfp.indexOf('export function DayFullPageModal'))
  assert.ok(/onAiInsights=\{\(\) => setShowAi\(true\)\}/.test(shell) && /\{showAi && <PremiumUpgradeModal onClose=\{\(\) => setShowAi\(false\)\} \/>\}/.test(shell))
})

test('Analytics → Today header is unchanged (no AI pill passed)', () => {
  assert.ok(/<DayFullPage onClose=\{\(\) => setOpenDashboard\(null\)\} \/>/.test(am))
})

test('the Today shortcut still shows only when viewing another day, and Escape does not close the dashboard under the AI dialog', () => {
  assert.ok(/\{!isToday && \(\s*<button\s+onClick=\{\(\) => setSelectedDate\(todayDateInTz\(effectiveTimezone\)\)\}/.test(dfp))
  assert.ok(/e\.key === 'Escape' && !showAi/.test(dfp))
})

test('the existing Unlock-AI dialog is reused, not rebuilt', () => {
  const pm = read('components/xpadite/PremiumUpgradeModal.tsx')
  assert.ok(/export function PremiumUpgradeModal\(\{ onClose \}/.test(pm) && pm.includes('Unlock AI Insights'))
  assert.equal((dfp.match(/Unlock AI/g) || []).length, 0)
})

test('dashboard export / email: the old UI had no entry point (openExport was never called), and the API route is preserved', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app/api/dashboard-export-email/route.ts')), 'route kept')
  // whole-App search: nothing in the UI calls the route or an export of the dashboard any more
  const files = []
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f.name)) files.push(p) } }
  walk(path.join(ROOT, 'components')); walk(path.join(ROOT, 'lib'))
  assert.deepEqual(files.filter(f => fs.readFileSync(f, 'utf8').includes('dashboard-export-email')), [])
})
