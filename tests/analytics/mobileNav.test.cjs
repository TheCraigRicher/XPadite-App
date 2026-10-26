// Mobile navigation: choosing any destination other than Analytics must close the Analytics overlay (it is not a mobileTab).
// Runs the REAL executeNav from XpaditeApp.tsx against recording setters.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const src = fs.readFileSync(path.join(ROOT, 'components/xpadite/XpaditeApp.tsx'), 'utf8')
const body = src.slice(src.indexOf('  function executeNav(tab: MobileTab) {'), src.indexOf('  function handleMobileNav('))
const js = ts.transpileModule(body.replace('function executeNav(tab: MobileTab)', 'function executeNav(tab)') + '\nreturn executeNav', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText

function run(tab, initial = { analyticsOpen: true }) {
  const state = { analyticsOpen: !!initial.analyticsOpen, analyticsRestore: { month: 9 }, mobileTab: 'analytics-not-a-tab', modalDay: null, dashboardDay: { key: 'x' }, fullPageMonth: 3, order: [] }
  const rec = name => v => { state[name] = v; state.order.push(name) }
  const fn = new Function('setDashboardDay', 'setFullPageMonth', 'setMobileTab', 'setModalDay', 'setAnalyticsOpen', 'setAnalyticsRestore', 'dateKey', js.replace(/^"use strict";?/, ''))(
    rec('dashboardDay'), rec('fullPageMonth'), rec('mobileTab'), rec('modalDay'), rec('analyticsOpen'), rec('analyticsRestore'), (y, m, d) => `${y}-${m}-${d}`)
  fn(tab)
  return state
}

test('selecting Calendar, Tasks, Planner or AI Coach closes Analytics (bottom nav AND hamburger share this path)', () => {
  for (const tab of ['calendar', 'tasks', 'planner', 'ai-coach']) {
    const s = run(tab)
    assert.equal(s.analyticsOpen, false, tab + ' closes Analytics')
    assert.equal(s.analyticsRestore, null, tab + ' clears the return-to-month state')
    assert.equal(s.dashboardDay, null)
  }
})

test('each destination still opens as before', () => {
  assert.equal(run('calendar').mobileTab, 'calendar'); assert.equal(run('calendar').fullPageMonth, null)
  const t = run('tasks'); assert.equal(t.mobileTab, 'calendar'); assert.ok(t.modalDay && t.modalDay.skipAnim === true)
  assert.equal(run('planner').mobileTab, 'planner')
  assert.equal(run('ai-coach').mobileTab, 'ai-coach')
})

test('selecting Analytics keeps it open (no close/reopen flicker) and shows it over the calendar tab', () => {
  const s = run('analytics')
  assert.equal(s.analyticsOpen, true); assert.equal(s.mobileTab, 'calendar')
  // closing happens before opening in the same batch only for non-analytics tabs
  assert.deepEqual(run('analytics').order.filter(n => n === 'analyticsOpen').length, 1)
})

test('Analytics can be reopened after navigating away (state is plain open/closed, nothing sticky)', () => {
  assert.equal(run('planner').analyticsOpen, false)
  assert.equal(run('analytics', { analyticsOpen: false }).analyticsOpen, true)
})

test('the unsaved-changes guard path also closes it (pending navigation calls the same executeNav)', () => {
  assert.equal((src.match(/pendingNavRef\.current = \(\) => executeNav\(tab\)/g) || []).length, 4)
  assert.ok(/onTabChange=\{handleMobileNav\}/.test(src))
  assert.ok(/function executeNav\(tab: MobileTab\) \{\s*setDashboardDay\(null\)[\s\S]*?if \(tab !== 'analytics'\) \{\s*setAnalyticsRestore\(null\)\s*setAnalyticsOpen\(false\)/.test(src))
})

test('active indicator follows analyticsOpen, so it moves with the closed overlay', () => {
  assert.ok(/activeTab=\{modalDay \? 'tasks' : analyticsOpen \? 'analytics' : mobileTab\}/.test(src))
})
