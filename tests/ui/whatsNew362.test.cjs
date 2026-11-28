// v1.362 — What's New / Coming Soon content: the centralized data file (real module compiled) + structural pins on the modal. No database, API or storage is involved.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-whatsnew-v1362'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
fs.writeFileSync(path.join(OUT, 'whatsNewData.js'), ts.transpileModule(read('components/xpadite/whatsNewData.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
const D = require(path.join(OUT, 'whatsNewData.js'))

test('nine What\'s New entries in the specified order, unique ids, every title and description present', () => {
  assert.equal(D.WHATS_NEW_ENTRIES.length, 9)
  assert.deepEqual(D.WHATS_NEW_ENTRIES.map(e => e.title), [
    'Task Manager — Deadline Reminders', 'My Schedule — Expanded Categories', 'My Schedule — Copy & Paste', 'Planner / Journal — Read Aloud', 'My Schedule — Persistent Alarms',
    'Planner / Journal — Indent & Outdent', 'Planner / Journal — Additional Section Colors', 'Planner / Journal — Editable Timestamps', 'Task Manager & My Schedule — Deadline Sync'])
  assert.equal(new Set(D.WHATS_NEW_ENTRIES.map(e => e.id)).size, 9)
  assert.ok(D.WHATS_NEW_ENTRIES.every(e => e.title.trim() && e.description.trim().length > 40))
  assert.match(D.WHATS_NEW_ENTRIES[0].description, /Yes or No/); assert.match(D.WHATS_NEW_ENTRIES[4].description, /five minutes/)
})

test('last-updated date formats as "Nov 27, 2026" regardless of timezone; bad input is passed through', () => {
  assert.equal(D.WHATS_NEW_LAST_UPDATED, '2026-11-27'); assert.equal(D.formatLastUpdated(D.WHATS_NEW_LAST_UPDATED), 'Nov 27, 2026')
  assert.equal(D.formatLastUpdated('2027-01-05'), 'Jan 5, 2027'); assert.equal(D.formatLastUpdated('soon'), 'soon')
})

test('Coming Soon leads with Schedule Import & Sync: file icon, purple status line, no dates or formats promised beyond the brief', () => {
  const e = D.COMING_SOON_ENTRIES[0]
  assert.equal(e.title, 'My Schedule — Schedule Import & Sync'); assert.equal(e.icon, 'table'); assert.equal(e.note, 'Currently planned for an upcoming release')
  assert.match(e.description, /CSV files, Excel spreadsheets and other compatible file formats/)
  assert.ok(!/20\d\d|Q[1-4]|\bby\b/i.test(e.description + e.note))
})

test('modal: data comes from the centralized file; numbers are derived from position (no hard-coded numbering); only the body scrolls; no persistence / network / badges added', () => {
  const m = read('components/xpadite/WhatsNewModal.tsx')
  assert.match(m, /from '\.\/whatsNewData'/); assert.match(m, /n=\{i \+ 1\}/, 'automatic numbering')
  assert.match(m, /minmax\(0, 1fr\)/); assert.match(m, /overflowY: 'auto'/); assert.match(m, /overscrollBehavior: 'contain'/); assert.match(m, /useLockBodyScroll\(\)/)
  assert.match(m, /Last updated: \{formatLastUpdated\(WHATS_NEW_LAST_UPDATED\)\}/)
  assert.ok(!/localStorage|sessionStorage|fetch\(|supabase|createClient/.test(m + read('components/xpadite/whatsNewData.ts')), 'announcements are static code, never user data')
  assert.ok(!/unread|setWhatsNewOpen\(true\)/i.test(m), 'no unread indicator or auto-popup in the modal')
  const app = read('components/xpadite/XpaditeApp.tsx'); assert.equal((app.match(/setWhatsNewOpen\(true\)/g) || []).length, 1, 'still only opened from the menu')
})
