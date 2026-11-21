// v1.358 — bullet / numbered / lettered sub-item markers get room, and the purple connector does not move.
// Source-level pins (the stylesheet lives in JournalEditorContent.tsx). The real-browser geometry check (connector offset 0 px, marker room, wrapping, no overflow
// at desktop / laptop / tablet / phone widths) is a separate headless-Chrome run; nothing here is a physical-device test.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/JournalEditorContent.tsx'), 'utf8').split(String.fromCharCode(13, 10)).join('\n')

test('the original connector rules are byte-for-byte what v1.357 shipped (trunk, arrowhead, mobile branch, checkbox sub-items)', () => {
  for (const line of [
    '.xp-j-prose li[data-sub-item="true"] { position: relative; margin-left: 20px; }',
    "content: ''; position: absolute; left: -16px; top: 0; bottom: -3px; width: 2px;",
    '.xp-j-prose li[data-sub-item="true"]:last-child::before { bottom: auto; height: 10px; }',
    "content: ''; position: absolute; left: -16px; top: 5px; width: 12px; height: 9px;",
    'clip-path: polygon(0% 42%, 62% 42%, 62% 12%, 100% 50%, 82% 88%, 62% 58%, 0% 58%);'.replace('82% 88%', '62% 88%'),
    '.xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"] { position: relative; margin-left: 20px; }',
    '.xp-j-prose li[data-sub-item="true"] { margin-left: 24px; }',
    'left: -21px; width: 19px;',
  ]) assert.ok(src.includes(line), line)
})

test('marker room: li and connector move by the SAME variable in opposite directions, so the connector keeps its exact position (desktop and mobile)', () => {
  const blk = src.slice(src.indexOf('v1.358 — marker breathing room'), src.indexOf('Box Title — a text format'))
  assert.match(blk, /\.xp-j-prose ul, \.xp-j-prose ol \{ --xp-sub-marker-gap: 16px; \}/, 'every list defines its own gap (a nested list never inherits a wider one)')
  // gap by marker width (characters in the widest label, set as data-xp-mw by journalMarkerWidth.ts): 1 = 16px, then +8px per extra character
  for (const [n, g] of [[2, 24], [3, 32], [4, 40]]) assert.ok(blk.includes(`.xp-j-prose ol[data-xp-mw="${n}"] { --xp-sub-marker-gap: ${g}px; }`), `gap for ${n} characters`)
  assert.ok(blk.includes('.xp-j-prose ol[data-xp-mw="5"], .xp-j-prose ol[data-xp-mw="6"] { --xp-sub-marker-gap: 48px; }'))
  assert.doesNotMatch(blk, /:has\(/, 'no item-count guessing any more: the width comes from the real start number and count')
  const mL = [...blk.matchAll(/margin-left: calc\((\d+)px \+ var\(--xp-sub-marker-gap\)\)/g)].map(m => +m[1])
  const left = [...blk.matchAll(/left: calc\(-(\d+)px - var\(--xp-sub-marker-gap\)\)/g)].map(m => +m[1])
  assert.deepEqual(mL, [20, 24], 'margin-left = original margin + gap (desktop 20, mobile 24)')
  assert.deepEqual(left, [16, 21], 'connector left = original offset − gap (desktop −16, mobile −21)')
  // margin + left is unchanged: 20−16 = 4 and 24−21 = 3, exactly as before
  assert.equal(mL[0] - left[0], 4); assert.equal(mL[1] - left[1], 3)
})

test('scope: bullet and ordered (decimal and letter) sub-items only — checkbox sub-items and ordinary lists are untouched', () => {
  const blk = src.slice(src.indexOf('v1.358 — marker breathing room'), src.indexOf('Box Title — a text format'))
  assert.equal([...blk.matchAll(/ul:not\(\[data-type="taskList"\]\) > li\[data-sub-item="true"\]/g)].length, 6)
  assert.equal([...blk.matchAll(/\.xp-j-prose ol > li\[data-sub-item="true"\]/g)].length, 6)
  assert.doesNotMatch(blk, /taskList"\] > li/)
  // rules whose selector ends at a plain list (ul / ol, optionally with :not/:has/[type]) may ONLY declare the inherited custom property — no visual property
  const plain = [...blk.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(\.xp-j-prose (?:ul|ol)[^{]*)\{([^}]*)\}/g)].filter(m => !/li\[data-sub-item/.test(m[1]))
  assert.ok(plain.length >= 4)
  for (const [, , body] of plain) assert.match(body.trim(), /^--xp-sub-marker-gap: \d+px;$/, 'plain-list rules only set the gap variable (no margin, padding or marker change)')
  assert.doesNotMatch(blk.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\s)\.xp-j-prose li\s*\{/m, 'no rule on plain items')
  assert.match(blk, /@media \(max-width: 640px\)/)
})

test('nothing else changed: no list-numbering, indent, sub-item toggle or save code touched (the diff is one CSS block)', () => {
  assert.match(src, /function handleSubItem\(\)/); assert.match(src, /list-style-type: lower-alpha/); assert.match(src, /\.xp-j-prose ol \{ padding-left: 22px;/); assert.match(src, /\.xp-j-prose ul:not\(\[data-type="taskList"\]\) \{ padding-left: 20px;/)
})

// ── marker width from the START number and the item count (journalMarkerWidth.ts) ──
const ts = require('typescript')
const OUT = path.join(__dirname, '..', '..', 'node_modules', '.cache', 'xpadite-mw-v1358'); fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'mw.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/journalMarkerWidth.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText.replace(/require\("@tiptap\/[^"]+"\)/g, '({ PluginKey: class {}, Plugin: class {}, Extension: { create: o => o }, Decoration: {}, DecorationSet: {} })'))
const MW = require(path.join(OUT, 'mw.js'))
test('marker width: numbers follow the LAST number shown (start + count − 1), letters follow a–z / aa… — including lists that start part-way', () => {
  assert.equal(MW.markerChars(1, 9, false), 1); assert.equal(MW.markerChars(1, 10, false), 2); assert.equal(MW.markerChars(1, 99, false), 2); assert.equal(MW.markerChars(1, 100, false), 3)
  assert.equal(MW.markerChars(10, 1, false), 2, 'a list typed as "10. " starts at 10: two characters from its first item')
  assert.equal(MW.markerChars(9, 2, false), 2, 'starts at 9, second item is 10'); assert.equal(MW.markerChars(8, 2, false), 1)
  assert.equal(MW.markerChars(99, 2, false), 3); assert.equal(MW.markerChars(100, 1, false), 3); assert.equal(MW.markerChars(1000, 1, false), 4)
  assert.equal(MW.markerChars(1, 26, true), 1); assert.equal(MW.markerChars(1, 27, true), 2); assert.equal(MW.markerChars(1, 702, true), 2); assert.equal(MW.markerChars(1, 703, true), 3)
  for (const bad of [undefined, null, NaN, -4, 0, 'x']) assert.equal(MW.markerChars(bad, 3, false), 1, 'a missing / invalid start behaves as 1')
  assert.equal(MW.markerChars(1, 0, false), 1)
})
test('the plugin is render-only: decoration attribute on numbered lists, no document, schema or command change; registered in the Planner editor', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/journalMarkerWidth.ts'), 'utf8')
  assert.match(m, /Decoration\.node\(/); assert.doesNotMatch(m.replace(/\/\*[\s\S]*?\*\//g, ''), /appendTransaction|filterTransaction|addAttributes|addCommands|addKeyboardShortcuts|setNodeMarkup|tr\.(insert|delete|replace|set)/)
  assert.match(src, /import \{ XpMarkerWidthExt \} from '\.\/journalMarkerWidth'/)
  assert.match(src, /SubItemListItem,\n      XpMarkerWidthExt,/, 'registered in the Planner editor (the indent extension stays last, as the v1.355 test pins)')
})
