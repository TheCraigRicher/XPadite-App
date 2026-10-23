// Journal export tests: build REAL TXT / PDF / DOCX files from a realistic saved JournalDoc and parse the bytes back.
// Run: npm run test:journal   (no network, no browser)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const JSZip = require('jszip')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-journal-tests')
fs.mkdirSync(OUT, { recursive: true })
function load(rel, name = path.basename(rel, '.ts')) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  fs.writeFileSync(path.join(OUT, name + '.js'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
  return require(path.join(OUT, name + '.js'))
}
const X = load('components/xpadite/journalExport.ts')

// ── fixtures ───────────────────────────────────────────────────────────────
const T = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const P = (...c) => ({ type: 'paragraph', content: c })
const doc = (...c) => JSON.stringify({ type: 'doc', content: c })
const cell = (type, ...c) => ({ type, content: [P(...c)] })

const body = doc(
  { type: 'heading', attrs: { level: 2 }, content: [T('Morning Plan')] },
  P(T('Normal paragraph one. ')),
  P(T('Bold words', [{ type: 'bold' }]), T(' and '), T('underlined words', [{ type: 'underline' }]), T(' and '), T('red words', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]), T('.')),
  P(),
  P(T('Second paragraph after a blank line.'), { type: 'hardBreak' }, T('Line after break.')),
  { type: 'bulletList', content: [{ type: 'listItem', content: [P(T('Bullet alpha')), { type: 'bulletList', content: [{ type: 'listItem', content: [P(T('Nested bullet beta'))] }] }] }] },
  { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [P(T('First step'))] }, { type: 'listItem', content: [P(T('Second step'))] }] },
  { type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [P(T('Done task'))] },
    { type: 'taskItem', attrs: { checked: false }, content: [P(T('Open task')), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, subItem: true }, content: [P(T('Sub task'))] }] }] },
  ] },
  { type: 'table', content: [
    { type: 'tableRow', content: [cell('tableHeader', T('Name')), cell('tableHeader', T('Score'))] },
    { type: 'tableRow', content: [cell('tableCell', T('Ada')), cell('tableCell', T('42'))] },
  ] },
)
const sectionContent = doc(P(T('Inside a section', [{ type: 'bold' }])), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [P(T('Section checked item'))] }] })
const cellA = doc(P(T('Left partition text')))
const cellB = doc(P(T('Right partition text')))
const unicode = doc(P(T('Café déjà vu — “quotes” – € 5 • ñ ü ß')), P(T('日本語 emoji 😀 mixed')))

const journal = {
  v: 1,
  blocks: [
    { id: 'b1', type: 'text', content: body, createdAt: 1, updatedAt: 1 },
    { id: 'b2', type: 'section', sectionColor: 'blue', collapsed: true, content: sectionContent, createdAt: 1, updatedAt: 1 },
    { id: 'b3', type: 'section', sectionColor: 'pink', content: '', partitions: [{ kind: 'content', content: cellA }, { kind: 'content', content: cellB }], createdAt: 1, updatedAt: 1 },
    { id: 'b4', type: 'image', src: 'data:image/png;base64,AAAA', name: 'photo.png', createdAt: 1, updatedAt: 1 },
    { id: 'b5', type: 'drawing', src: 'data:image/png;base64,AAAA', name: 'Mind Map 1', canvasData: '[]', createdAt: 1, updatedAt: 1 },
    { id: 'b6', type: 'text', content: unicode, createdAt: 1, updatedAt: 1 },
  ],
}
const entry = (notes, title = 'My Journal Day') => ({ title, dateKey: '2026-9-22', notes, year: 2026, month: 9, day: 22 })
const FULL = entry(JSON.stringify(journal))

// ── parsers for the generated files ─────────────────────────────────────────
const bytes = async blob => Buffer.from(await blob.arrayBuffer())
const squash = s => s.replace(/\s+/g, '')
function pdfText(buf) {
  const s = new TextDecoder('windows-1252').decode(buf)
  const out = []
  for (const m of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1].replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))))
  return { text: out.join(''), raw: s }
}
async function docxXml(buf) {
  const zip = await JSZip.loadAsync(buf)
  return zip.file('word/document.xml').async('string')
}
const docxText = xml => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')).join('')

const EXPECTED = ['My Journal Day', 'October 22, 2026', 'Morning Plan', 'Normal paragraph one.', 'Bold words', 'underlined words', 'red words',
  'Second paragraph after a blank line.', 'Line after break.', 'Bullet alpha', 'Nested bullet beta', 'First step', 'Second step',
  'Done task', 'Open task', 'Sub task', 'Name', 'Score', 'Ada', '42', 'Inside a section', 'Section checked item', 'Left partition text', 'Right partition text']

// ── TXT ──────────────────────────────────────────────────────────────────────
test('TXT: title, date and the full Journal body (all blocks, sections, partitions, tables, tasks)', () => {
  const t = X.buildTxt([FULL])
  for (const e of EXPECTED) assert.ok(t.includes(e), 'TXT missing: ' + e)
  assert.match(t, /\[x\] Done task/); assert.match(t, /\[ \] Open task/); assert.match(t, /\[x\] Section checked item/)
  assert.match(t, /  \[ \] Sub task/)
  assert.match(t, /• Bullet alpha/); assert.match(t, /  • Nested bullet beta/); assert.match(t, /1\. First step/); assert.match(t, /2\. Second step/)
  assert.match(t, /Name \| Score\nAda \| 42/)
  assert.match(t, /\[Image: photo\.png\]/); assert.match(t, /\[Mind map drawing: Mind Map 1\]/)
  assert.ok(t.indexOf('Morning Plan') < t.indexOf('Inside a section') && t.indexOf('Inside a section') < t.indexOf('Left partition text') && t.indexOf('Left partition text') < t.indexOf('Right partition text'), 'order preserved')
  assert.equal(t.split('Normal paragraph one.').length, 2, 'no duplicates')
  assert.ok(t.includes('Café déjà vu — “quotes” – € 5 • ñ ü ß') && t.includes('日本語 emoji 😀 mixed'), 'unicode preserved in TXT')
})

// ── PDF ──────────────────────────────────────────────────────────────────────
test('PDF: valid file containing title, date and the actual body text; formatting, checkboxes, table', async () => {
  const buf = await bytes(await X.buildPdf([FULL]))
  assert.equal(buf.slice(0, 5).toString(), '%PDF-')
  const { text, raw } = pdfText(buf)
  const sq = squash(text)
  for (const e of EXPECTED) assert.ok(sq.includes(squash(e)), 'PDF missing: ' + e)
  assert.ok(sq.includes('[x]Donetask') && sq.includes('[]Opentask'), 'checkbox markers')
  assert.ok(/Helvetica-Bold/.test(raw), 'bold font used')
  assert.ok(/^1\.?0* 0\.?0* 0\.?0* rg\r?$/m.test(raw), 'red text colour set')
  assert.ok(sq.includes(squash('[Image: photo.png]')))
  assert.ok(sq.includes(squash('Café déjà vu')) && sq.includes('€5'), 'Latin-1/WinAnsi text kept')
  assert.ok(sq.includes('?emoji?mixed') || sq.includes('emoji?mixed'), 'unsupported glyphs shown as ? (built-in PDF fonts)')
})

test('PDF: long content paginates and nothing is dropped', async () => {
  const paras = Array.from({ length: 120 }, (_, i) => P(T(`Paragraph number ${i} with some filler words to take up room on the page.`)))
  const buf = await bytes(await X.buildPdf([entry(JSON.stringify({ v: 1, blocks: [{ id: 'x', type: 'text', content: doc(...paras) }] }))]))
  const { text, raw } = pdfText(buf)
  assert.ok((raw.match(/\/Type \/Page\b/g) || []).length > 1, 'multiple pages')
  assert.ok(squash(text).includes('Paragraphnumber0with') && squash(text).includes('Paragraphnumber119with'))
})

// ── DOCX ─────────────────────────────────────────────────────────────────────
test('DOCX: valid package with title, date, body text, formatting, tasks and a real table', async () => {
  const buf = await bytes(await X.buildDocx([FULL]))
  const xml = await docxXml(buf)
  const text = docxText(xml)
  for (const e of EXPECTED) assert.ok(squash(text).includes(squash(e)), 'DOCX missing: ' + e)
  assert.ok(text.includes('☑ Done task') && text.includes('☐ Open task') && text.includes('☑ Section checked item'))
  assert.ok(/<w:tbl>/.test(xml) && (xml.match(/<w:tr[ >]/g) || []).length === 2, 'table with two rows')
  assert.ok(/<w:b\/>|<w:b /.test(xml), 'bold'); assert.ok(/<w:u /.test(xml), 'underline'); assert.ok(/<w:color w:val="FF0000"\/>/.test(xml), 'red colour')
  assert.match(text, /\[Image: photo\.png\]/)
  assert.ok(text.includes('Café déjà vu — “quotes” – € 5 • ñ ü ß') && text.includes('日本語 emoji 😀 mixed'), 'unicode preserved in DOCX')
})

// ── edge cases across all formats ───────────────────────────────────────────
async function allFormats(e) {
  return { txt: X.buildTxt([e]), pdf: pdfText(await bytes(await X.buildPdf([e]))).text, docx: docxText(await docxXml(await bytes(await X.buildDocx([e])))) }
}

test('empty / blank entries export title and date without crashing', async () => {
  for (const notes of [undefined, '', '   ', JSON.stringify({ v: 1, blocks: [] }), JSON.stringify({ v: 1, blocks: [{ id: 'a', type: 'text', content: '' }] }), doc(P())]) {
    const r = await allFormats(entry(notes))
    assert.ok(r.txt.includes('My Journal Day') && squash(r.pdf).includes('MyJournalDay') && r.docx.includes('My Journal Day'), String(notes))
  }
})

test('legacy entries still export: bare Tiptap doc and plain text', async () => {
  const legacy = await allFormats(entry(doc(P(T('Legacy tiptap body')))))
  assert.ok(legacy.txt.includes('Legacy tiptap body') && squash(legacy.pdf).includes('Legacytiptapbody') && legacy.docx.includes('Legacy tiptap body'))
  const plain = await allFormats(entry('Just plain text\nsecond line'))
  assert.ok(plain.txt.includes('Just plain text\nsecond line') && squash(plain.pdf).includes('Justplaintext') && plain.docx.includes('second line'))
})

test('malformed / hostile rich text never throws and keeps readable text', async () => {
  const survivor = { type: 'paragraph', content: [{ type: 'text' }, { type: 'text', text: 123 }, 'x', { type: 'text', text: 'Survivor <script>alert(1)</script> & "q"', marks: [{ type: 'textStyle', attrs: { color: 'red;}</w:color><evil/>' } }, null, { type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }
  const hostile = JSON.stringify({ v: 1, blocks: [
    null, 42, 'str', { type: 'text', content: '{not json' },
    { type: 'text', content: JSON.stringify({ type: 'doc', content: [null, 7, survivor, { type: 'mystery', content: [P(T('Inside unknown node'))] }, { type: 'table', content: [{ type: 'tableRow', content: [null, { type: 'tableCell' }] }] }] }) },
    { type: 'section', partitions: [null, { kind: 'image' }], content: 'ignored?' },
  ] })
  const r = await allFormats(entry(hostile))
  for (const k of ['txt', 'docx']) { assert.ok(r[k].includes('Survivor <script>alert(1)</script> & "q"'), k); assert.ok(r[k].includes('Inside unknown node'), k) }
  assert.ok(squash(r.pdf).includes(squash('Survivor <script>alert(1)</script> & "q"')) && squash(r.pdf).includes('Insideunknownnode'))
  const xml = await docxXml(await bytes(await X.buildDocx([entry(hostile)])))
  assert.ok(!xml.includes('<evil/>') && !xml.includes('<script>'), 'markup in user text is escaped, colour value cannot inject XML')
  assert.ok(!/javascript:/.test(xml) && !/<w:hyperlink/.test(xml), 'unsafe links are never turned into hyperlinks')
})

test('control characters are stripped (they would corrupt DOCX XML) and pale colours are dropped', async () => {
  const e = entry(doc(P(T('Ctrl\u0001\u0008char', [{ type: 'textStyle', attrs: { color: '#ffffff' } }]))))
  const r = await allFormats(e)
  assert.ok(r.txt.includes('Ctrlchar') && r.docx.includes('Ctrlchar'))
  const xml = await docxXml(await bytes(await X.buildDocx([e])))
  assert.ok(!/w:val="FFFFFF"/.test(xml), 'white text would vanish on white paper')
})

test('multiple entries export in order', async () => {
  const a = entry(doc(P(T('First entry body'))), 'Entry A'); const b = entry(doc(P(T('Second entry body'))), 'Entry B')
  const txt = X.buildTxt([a, b])
  assert.ok(txt.indexOf('First entry body') < txt.indexOf('Entry B') && txt.indexOf('Entry B') < txt.indexOf('Second entry body'))
  const pdf = squash(pdfText(await bytes(await X.buildPdf([a, b]))).text)
  assert.ok(pdf.includes('Firstentrybody') && pdf.includes('Secondentrybody'))
  const docx = docxText(await docxXml(await bytes(await X.buildDocx([a, b]))))
  assert.ok(docx.includes('First entry body') && docx.includes('Second entry body'))
})

test('makeFilename unchanged', () => {
  assert.equal(X.makeFilename('My Day!', '2026-9-2'), 'My-Day-2026-10-02')
  assert.equal(X.makeFilename('', '2026-0-15'), 'XPadite-Journal-2026-01-15')
})
