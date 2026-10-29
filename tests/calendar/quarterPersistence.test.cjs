// Main Calendar (Q1–Q4 quarter toggles): the collapsed/expanded state is remembered per device in localStorage.
// Behaviour was verified in real Chrome during development (reload, mobile width, painted-frame sampling, corrupt
// storage); this file guards the implementation contract. The real helpers are executed, not copied.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/CalendarSection.tsx'), 'utf8')

// Pull out and run the two storage helpers against a fake localStorage.
const block = src.slice(src.indexOf("const STORAGE_KEY"), src.indexOf('const ChevronIcon'))
const QUARTERS = [{ label: 'Q1' }, { label: 'Q2' }, { label: 'Q3' }, { label: 'Q4' }]
function load(store) {
  const js = ts.transpileModule(block + '\nmodule.exports = { readSavedQuarters, saveQuarter, STORAGE_KEY }', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', 'QUARTERS', 'localStorage', js)(m, m.exports, QUARTERS, store)
  return m.exports
}
const fake = (init = {}) => { const d = { ...init }; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = v }, d } }

test('first-time user (nothing stored): no saved preference, so the existing all-expanded default is kept', () => {
  const { readSavedQuarters } = load(fake()); assert.deepEqual(readSavedQuarters(), {})
})
test('toggling saves "collapsed" / "expanded" immediately, merged per quarter', () => {
  const s = fake(), { saveQuarter, readSavedQuarters, STORAGE_KEY } = load(s)
  saveQuarter('Q2', false); assert.deepEqual(JSON.parse(s.d[STORAGE_KEY]), { Q2: 'collapsed' })
  saveQuarter('Q4', false); saveQuarter('Q2', true)
  assert.deepEqual(JSON.parse(s.d[STORAGE_KEY]), { Q2: 'expanded', Q4: 'collapsed' })
  assert.deepEqual(readSavedQuarters(), { Q2: true, Q4: false })
})
test('only quarters the user toggled are restored; unknown quarters and junk values are ignored', () => {
  const { readSavedQuarters } = load(fake({ 'xp-cal-quarters': JSON.stringify({ Q1: 'collapsed', Q9: 'collapsed', Q3: 'banana' }) }))
  assert.deepEqual(readSavedQuarters(), { Q1: false })
})
test('unreadable stored value never throws, falls back to default, and the next toggle repairs it', () => {
  const s = fake({ 'xp-cal-quarters': '{not json' }), { readSavedQuarters, saveQuarter, STORAGE_KEY } = load(s)
  assert.deepEqual(readSavedQuarters(), {})
  saveQuarter('Q1', false); assert.deepEqual(JSON.parse(s.d[STORAGE_KEY]), { Q1: 'collapsed' })
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  const b = load(blocked); assert.deepEqual(b.readSavedQuarters(), {}); assert.doesNotThrow(() => b.saveQuarter('Q1', true))
})
test('wiring: restored in a layout effect (before paint), manual toggle persists, jump-to-today does not', () => {
  assert.ok(/useLayoutEffect\(\(\) => \{\s*const saved = readSavedQuarters\(\)/.test(src))
  assert.ok(/Q1: true, Q2: true, Q3: true, Q4: true,/.test(src), 'default state unchanged')
  assert.ok(/function toggle\(q: string\) \{[\s\S]*?saveQuarter\(q, next\)/.test(src))
  const jump = src.slice(src.indexOf('function jumpToToday'), src.indexOf('return (\n    <div className="-mx-2'))
  assert.ok(!/saveQuarter/.test(jump), 'a programmatic expand is not a saved preference')
})
test('scope: no script/style injection, no changes to other calendars', () => {
  assert.ok(!/dangerouslySetInnerHTML|<script/.test(src))
  for (const f of ['MonthCard', 'MonthFullPage', 'MonthZoomModal', 'YearFullPage']) assert.ok(!/xp-cal-quarters/.test(fs.readFileSync(path.join(__dirname, '..', '..', `components/xpadite/${f}.tsx`), 'utf8')))
})
