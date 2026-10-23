'use client'

// Journal export (TXT / PDF / DOCX).
//
// A journal entry's saved `notes` string is normally a JournalDoc — `{ v: 1, blocks: [...] }` — whose text/section blocks
// each hold their own Tiptap JSON string (sections may also be split into two cells or hold a single image). Older entries
// are a bare Tiptap doc or plain text. `parseBlocks` flattens ALL of those, in order (collapsed sections included, since
// `collapsed` is presentational only), into one list of DocBlocks that the three writers share.

// ─── Types ────────────────────────────────────────────────────────────────────

interface TiptapNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

/** A styled stretch of text. `color` is always a validated 6-digit hex without '#', never raw user input. */
interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string }

interface TableCellData { runs: Run[]; header: boolean }

type DocBlock =
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'bullet'; runs: Run[]; depth: number }
  | { kind: 'ordered'; runs: Run[]; index: number; depth: number }
  | { kind: 'task'; runs: Run[]; checked: boolean; depth: number }
  | { kind: 'codeblock'; text: string }
  | { kind: 'table'; rows: TableCellData[][] }
  | { kind: 'note'; text: string }
  | { kind: 'hr' }
  | { kind: 'blank' }

export interface ExportEntry {
  title: string
  dateKey: string
  notes: string | undefined
  year: number
  month: number
  day: number
}

// ─── Tiptap → DocBlock walker ──────────────────────────────────────────────────

const MAX_DEPTH = 40

/** Accepts #rgb, #rrggbb and rgb(r,g,b); anything else (or a colour too pale to read on white paper) is dropped. */
function normalizeColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  let r: number, g: number, b: number
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) { [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16)) }
  else if ((m = /^#([0-9a-f]{6})$/i.exec(s))) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16) }
  else if ((m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s))) { r = +m[1]; g = +m[2]; b = +m[3] }
  else return undefined
  if (r > 255 || g > 255 || b > 255) return undefined
  if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.88) return undefined
  return [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function isNode(n: unknown): n is TiptapNode {
  return typeof n === 'object' && n !== null && !Array.isArray(n)
}

function childrenOf(node: TiptapNode): TiptapNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : []
}

function runStyle(node: TiptapNode): Omit<Run, 'text'> {
  const st: Omit<Run, 'text'> = {}
  for (const mk of Array.isArray(node.marks) ? node.marks : []) {
    if (!mk || typeof mk !== 'object') continue
    if (mk.type === 'bold') st.bold = true
    else if (mk.type === 'italic') st.italic = true
    else if (mk.type === 'underline') st.underline = true
    else if (mk.type === 'textStyle') { const c = normalizeColor(mk.attrs?.color); if (c) st.color = c }
  }
  return st
}

function inlineRuns(node: TiptapNode, out: Run[] = [], depth = 0): Run[] {
  if (depth > MAX_DEPTH) return out
  if (node.type === 'text') {
    if (typeof node.text === 'string' && node.text) out.push({ text: node.text, ...runStyle(node) })
  } else if (node.type === 'hardBreak') {
    out.push({ text: '\n' })
  } else {
    for (const c of childrenOf(node)) inlineRuns(c, out, depth + 1)
  }
  return out
}

function plainText(runs: Run[]): string { return runs.map(r => r.text).join('') }

interface ListCtx { type: 'bullet' | 'ordered'; depth: number; counter: number }
interface Ctx { list?: ListCtx; taskDepth: number }

function walkNodes(nodes: TiptapNode[], blocks: DocBlock[], ctx: Ctx, depth: number): void {
  for (const n of nodes) walkNode(n, blocks, ctx, depth)
}

/** All the text of a table cell: its paragraphs/lists joined with newlines. */
function cellRuns(cell: TiptapNode): Run[] {
  const runs: Run[] = []
  const tmp: DocBlock[] = []
  walkNodes(childrenOf(cell), tmp, { taskDepth: 0 }, 1)
  for (const b of tmp) {
    let piece: Run[] | null = null
    if (b.kind === 'heading' || b.kind === 'paragraph') piece = b.runs
    else if (b.kind === 'bullet') piece = [{ text: '• ' }, ...b.runs]
    else if (b.kind === 'ordered') piece = [{ text: `${b.index}. ` }, ...b.runs]
    else if (b.kind === 'task') piece = [{ text: b.checked ? '[x] ' : '[ ] ' }, ...b.runs]
    else if (b.kind === 'codeblock') piece = [{ text: b.text }]
    else if (b.kind === 'note') piece = [{ text: b.text }]
    if (!piece) continue
    if (runs.length) runs.push({ text: '\n' })
    runs.push(...piece)
  }
  return runs
}

function walkNode(node: TiptapNode, blocks: DocBlock[], ctx: Ctx, depth: number): void {
  if (!isNode(node) || depth > MAX_DEPTH) return
  switch (node.type) {
    case 'heading':
      blocks.push({ kind: 'heading', level: Number(node.attrs?.level) || 1, runs: inlineRuns(node) })
      break

    case 'paragraph': {
      const runs = inlineRuns(node)
      blocks.push(plainText(runs).trim() ? { kind: 'paragraph', runs } : { kind: 'blank' })
      break
    }

    case 'bulletList':
    case 'orderedList': {
      const list: ListCtx = {
        type: node.type === 'bulletList' ? 'bullet' : 'ordered',
        depth: (ctx.list?.depth ?? 0) + 1,
        counter: node.type === 'orderedList' ? (Number(node.attrs?.start) || 1) : 1,
      }
      walkNodes(childrenOf(node), blocks, { ...ctx, list }, depth + 1)
      break
    }

    case 'listItem': {
      const kids = childrenOf(node)
      const first = kids.findIndex(k => k.type === 'paragraph')
      const runs = first >= 0 ? inlineRuns(kids[first]) : []
      if (ctx.list?.type === 'ordered') blocks.push({ kind: 'ordered', runs, index: ctx.list.counter++, depth: ctx.list.depth })
      else if (ctx.list) blocks.push({ kind: 'bullet', runs, depth: ctx.list.depth })
      else blocks.push({ kind: 'paragraph', runs })
      walkNodes(kids.filter((_, i) => i !== first), blocks, ctx, depth + 1)
      break
    }

    case 'taskList':
      walkNodes(childrenOf(node), blocks, { ...ctx, list: undefined }, depth + 1)
      break

    case 'taskItem': {
      const kids = childrenOf(node)
      const first = kids.findIndex(k => k.type === 'paragraph')
      blocks.push({
        kind: 'task',
        runs: first >= 0 ? inlineRuns(kids[first]) : [],
        checked: node.attrs?.checked === true,
        depth: ctx.taskDepth + 1,
      })
      walkNodes(kids.filter((_, i) => i !== first), blocks, { list: undefined, taskDepth: ctx.taskDepth + 1 }, depth + 1)
      break
    }

    case 'table': {
      const rows: TableCellData[][] = childrenOf(node)
        .filter(r => r.type === 'tableRow')
        .map(r => childrenOf(r)
          .filter(c => c.type === 'tableCell' || c.type === 'tableHeader')
          .map(c => ({ runs: cellRuns(c), header: c.type === 'tableHeader' })))
        .filter(r => r.length > 0)
      if (rows.length) blocks.push({ kind: 'table', rows })
      break
    }

    case 'codeBlock':
      blocks.push({ kind: 'codeblock', text: plainText(inlineRuns(node)) })
      break

    case 'horizontalRule':
      blocks.push({ kind: 'hr' })
      break

    default:
      // doc, blockquote, anything unknown: keep reading its children so no text is lost
      walkNodes(childrenOf(node), blocks, ctx, depth + 1)
  }
}

/** Walks one Tiptap JSON string (or, for very old entries, plain text). */
function walkContentString(content: string | undefined, blocks: DocBlock[]): void {
  const str = (content ?? '').trim()
  if (!str) return
  let parsed: unknown
  try { parsed = JSON.parse(str) } catch { parsed = undefined }
  if (isNode(parsed) && parsed.type === 'doc') {
    walkNode(parsed, blocks, { taskDepth: 0 }, 0)
    return
  }
  if (parsed === undefined) {
    for (const line of str.split(/\r?\n/)) blocks.push(line.trim() ? { kind: 'paragraph', runs: [{ text: line }] } : { kind: 'blank' })
  }
}

function imageNote(label: string, name: unknown): DocBlock {
  const n = typeof name === 'string' && name.trim() ? `: ${name.trim()}` : ''
  return { kind: 'note', text: `[${label}${n}]` }
}

function walkCell(cell: unknown, blocks: DocBlock[]): void {
  if (!isNode(cell)) return
  const c = cell as { kind?: string; content?: string; name?: string; canvasData?: string }
  if (c.kind === 'image') blocks.push(imageNote(c.canvasData ? 'Mind map drawing' : 'Image', c.name))
  else walkContentString(c.content, blocks)
}

function parseBlocks(notes: string | undefined): DocBlock[] {
  const str = (notes ?? '').trim()
  if (!str) return []
  let parsed: unknown
  try { parsed = JSON.parse(str) } catch { parsed = undefined }

  const blocks: DocBlock[] = []
  if (isNode(parsed) && (parsed as { v?: unknown }).v === 1 && Array.isArray((parsed as { blocks?: unknown }).blocks)) {
    const list = (parsed as { blocks: unknown[] }).blocks
    list.forEach(raw => {
      if (!isNode(raw)) return
      const b = raw as { type?: string; content?: string; name?: string; canvasData?: string; partitions?: unknown[]; sectionImage?: unknown }
      const start = blocks.length
      if (b.type === 'image') blocks.push(imageNote('Image', b.name))
      else if (b.type === 'drawing') blocks.push(imageNote('Mind map drawing', b.name))
      else if (b.type === 'text' || b.type === 'section') {
        if (b.sectionImage) walkCell(b.sectionImage, blocks)
        else if (Array.isArray(b.partitions) && b.partitions.length) b.partitions.forEach(p => walkCell(p, blocks))
        else walkContentString(b.content, blocks)
      }
      if (blocks.length > start) blocks.push({ kind: 'blank' })
    })
    while (blocks.length && blocks[blocks.length - 1].kind === 'blank') blocks.pop()
    return blocks
  }
  if (isNode(parsed) && parsed.type === 'doc') { walkContentString(str, blocks); return blocks }
  if (parsed === undefined) walkContentString(str, blocks)   // plain text
  return blocks
}

// ─── Filename helper ───────────────────────────────────────────────────────────

export function makeFilename(title: string, dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const safe = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50)
  return safe ? `${safe}-${date}` : `XPadite-Journal-${date}`
}

// ─── Download helper ───────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Characters that cannot be written into XML (DOCX) or are noise in plain text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (s: string) => s.replace(CONTROL_CHARS, '')

// ─── TXT ──────────────────────────────────────────────────────────────────────

function oneLine(runs: Run[]): string { return plainText(runs).replace(/\s*\n\s*/g, ' ').trim() }

function blocksToText(blocks: DocBlock[]): string {
  return blocks.map(b => {
    switch (b.kind) {
      case 'heading':   return `${'#'.repeat(b.level)} ${plainText(b.runs)}`
      case 'paragraph': return plainText(b.runs)
      case 'bullet':    return `${'  '.repeat(b.depth - 1)}• ${plainText(b.runs)}`
      case 'ordered':   return `${'  '.repeat(b.depth - 1)}${b.index}. ${plainText(b.runs)}`
      case 'task':      return `${'  '.repeat(b.depth - 1)}[${b.checked ? 'x' : ' '}] ${plainText(b.runs)}`
      case 'codeblock': return `\`\`\`\n${b.text}\n\`\`\``
      case 'table':     return b.rows.map(r => r.map(c => oneLine(c.runs)).join(' | ')).join('\n')
      case 'note':      return b.text
      case 'hr':        return '─'.repeat(40)
      case 'blank':     return ''
    }
  }).join('\n')
}

export function buildTxt(entries: ExportEntry[]): string {
  const parts = entries.map(e => {
    const dateStr = `${MONTH_NAMES_LONG[e.month]} ${e.day}, ${e.year}`
    const width   = Math.max(e.title.length, dateStr.length, 20)
    const body    = blocksToText(parseBlocks(e.notes))
    return `${e.title}\n${dateStr}\n${'='.repeat(width)}${body ? '\n\n' + body : ''}`
  })
  return clean(parts.join('\n\n' + '─'.repeat(60) + '\n\n').replace(/\r/g, '')).replace(/\n{3,}/g, '\n\n')
}

export async function exportToTxt(entries: ExportEntry[], filename: string): Promise<void> {
  downloadBlob(new Blob([buildTxt(entries)], { type: 'text/plain;charset=utf-8' }), `${filename}.txt`)
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
// jsPDF's built-in fonts only cover Latin-1 + the Windows-1252 punctuation block. Anything else (emoji, CJK, …) would be
// written as garbage, so it is replaced with "?" — a visible, honest placeholder.

const WIN1252_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D,
  0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178])

function pdfSafe(text: string): string {
  let out = ''
  for (const ch of Array.from(clean(text))) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x0A || cp === 0x09 || (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || WIN1252_EXTRA.has(cp)) out += ch
    else if (cp === 0x200D || (cp >= 0xFE00 && cp <= 0xFE0F)) continue   // emoji joiners / variation selectors
    else out += '?'
  }
  return out
}

interface Seg { text: string; run: Run }

export async function buildPdf(entries: ExportEntry[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW  = 210, ml = 20, mr = 20, mt = 20, mb = 25, cW = 170, pageH = 297
  let y = mt

  const lineH = (size: number) => size * 0.38 + 1.5
  const fontOf = (r: Run, forceBold = false) => (r.bold || forceBold) ? (r.italic ? 'bolditalic' : 'bold') : (r.italic ? 'italic' : 'normal')

  function checkPage(need = 8) {
    if (y + need > pageH - mb) { pdf.addPage(); y = mt }
  }

  /** Greedy word-wrap of styled runs into lines of segments, each no wider than `width`. */
  function layout(runs: Run[], size: number, width: number, forceBold = false): Seg[][] {
    pdf.setFontSize(size)
    const lines: Seg[][] = [[]]
    let lineW = 0
    const push = (seg: Seg, w: number) => { lines[lines.length - 1].push(seg); lineW += w }
    const newLine = () => { lines.push([]); lineW = 0 }
    for (const run of runs) {
      const text = pdfSafe(run.text)
      pdf.setFont('helvetica', fontOf(run, forceBold))
      for (const tok of text.split(/(\n|[ \t]+)/)) {
        if (!tok) continue
        if (tok === '\n') { newLine(); continue }
        const isSpace = /^[ \t]+$/.test(tok)
        let w = pdf.getTextWidth(tok)
        if (isSpace) { if (lineW > 0) push({ text: tok, run }, w); continue }
        if (lineW + w > width && lineW > 0) newLine()
        if (w > width) {                       // a single token wider than the line: split by character
          let chunk = ''
          for (const ch of Array.from(tok)) {
            if (pdf.getTextWidth(chunk + ch) > width && chunk) { push({ text: chunk, run }, pdf.getTextWidth(chunk)); newLine(); chunk = '' }
            chunk += ch
          }
          if (chunk) { w = pdf.getTextWidth(chunk); push({ text: chunk, run }, w) }
          continue
        }
        push({ text: tok, run }, w)
      }
    }
    return lines
  }

  function drawLine(line: Seg[], x: number, size: number, forceBold: boolean, base: [number, number, number]) {
    pdf.setFontSize(size)
    let cx = x
    for (const seg of line) {
      pdf.setFont('helvetica', fontOf(seg.run, forceBold))
      const rgb = seg.run.color ? [parseInt(seg.run.color.slice(0, 2), 16), parseInt(seg.run.color.slice(2, 4), 16), parseInt(seg.run.color.slice(4, 6), 16)] : base
      pdf.setTextColor(rgb[0], rgb[1], rgb[2])
      pdf.text(seg.text, cx, y)
      const w = pdf.getTextWidth(seg.text)
      if (seg.run.underline) { pdf.setDrawColor(rgb[0], rgb[1], rgb[2]); pdf.setLineWidth(0.2); pdf.line(cx, y + 0.7, cx + w, y + 0.7) }
      cx += w
    }
  }

  const BODY: [number, number, number] = [30, 30, 40]

  /** Writes styled runs as wrapped lines, paginating line by line. */
  function writeRuns(runs: Run[], size: number, indent = 0, forceBold = false, base = BODY) {
    const lh = lineH(size)
    for (const line of layout(runs, size, cW - indent, forceBold)) {
      checkPage(lh)
      drawLine(line, ml + indent, size, forceBold, base)
      y += lh
    }
  }

  function writeTable(rows: TableCellData[][]) {
    const cols = Math.max(...rows.map(r => r.length))
    const colW = cW / cols
    const size = 9, lh = lineH(size), pad = 1.8
    y += 1
    for (const row of rows) {
      const laid = row.map(c => layout(c.runs, size, colW - pad * 2, c.header))
      const rowH = Math.max(...laid.map(l => l.length), 1) * lh + pad * 2 - 1
      checkPage(rowH + 1)
      const top = y - lh + 1
      row.forEach((c, i) => {
        const x = ml + i * colW
        if (c.header) { pdf.setFillColor(240, 235, 252); pdf.rect(x, top, colW, rowH, 'F') }
        pdf.setDrawColor(190, 180, 220); pdf.setLineWidth(0.2); pdf.rect(x, top, colW, rowH)
        const saveY = y
        y = top + pad + lh - 1.3
        for (const line of laid[i]) { drawLine(line, x + pad, size, c.header, BODY); y += lh }
        y = saveY
      })
      y = top + rowH + lh - 1
    }
    y += 1
  }

  entries.forEach((entry, ei) => {
    if (ei > 0) {
      checkPage(15)
      pdf.setDrawColor(180, 150, 240)
      pdf.setLineWidth(0.4)
      pdf.line(ml, y, pageW - mr, y)
      y += 8
    }

    writeRuns([{ text: entry.title }], 16, 0, true, [80, 20, 180])
    writeRuns([{ text: `${MONTH_NAMES_LONG[entry.month]} ${entry.day}, ${entry.year}` }], 9, 0, false, [120, 120, 150])
    y += 3

    for (const b of parseBlocks(entry.notes)) {
      switch (b.kind) {
        case 'heading':
          y += 2
          writeRuns(b.runs, b.level <= 2 ? 13 : 11, 0, true, [60, 20, 120])
          break
        case 'paragraph':
          writeRuns(b.runs, 10)
          y += 1
          break
        case 'bullet':
          writeRuns([{ text: '• ' }, ...b.runs], 10, (b.depth - 1) * 5)
          break
        case 'ordered':
          writeRuns([{ text: `${b.index}. ` }, ...b.runs], 10, (b.depth - 1) * 5)
          break
        case 'task':
          writeRuns([{ text: b.checked ? '[x] ' : '[ ] ' }, ...b.runs], 10, (b.depth - 1) * 5)
          break
        case 'table':
          writeTable(b.rows)
          break
        case 'note':
          writeRuns([{ text: b.text, italic: true }], 10, 0, false, [120, 120, 150])
          break
        case 'codeblock': {
          y += 1
          pdf.setFont('courier', 'normal'); pdf.setFontSize(9)
          const lines  = pdf.splitTextToSize(pdfSafe(b.text) || ' ', cW - 8) as string[]
          const boxH   = lines.length * 4.5 + 5
          checkPage(boxH + 3)
          pdf.setFillColor(245, 242, 255)
          pdf.rect(ml, y - 3, cW, boxH, 'F')
          pdf.setTextColor(80, 80, 110)
          pdf.text(lines, ml + 4, y + 1)
          y += boxH + 2
          break
        }
        case 'hr':
          y += 2
          pdf.setDrawColor(200, 185, 240)
          pdf.line(ml, y, pageW - mr, y)
          y += 4
          break
        case 'blank':
          y += 3
          break
      }
    }
    y += 4
  })

  return pdf.output('blob')
}

export async function exportToPdf(entries: ExportEntry[], filename: string): Promise<void> {
  downloadBlob(await buildPdf(entries), `${filename}.pdf`)
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export async function buildDocx(entries: ExportEntry[]): Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await import('docx') as any
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, Table, TableRow, TableCell, WidthType, ShadingType } = d

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textRuns = (runs: Run[], extra: Record<string, unknown> = {}): any[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = []
    for (const r of runs) {
      clean(r.text).split('\n').forEach((part, i) => {
        out.push(new TextRun({
          text: part,
          ...(i > 0 ? { break: 1 } : {}),
          ...(r.bold ? { bold: true } : {}),
          ...(r.italic ? { italics: true } : {}),
          ...(r.underline ? { underline: {} } : {}),
          ...(r.color ? { color: r.color } : {}),
          ...extra,
        }))
      })
    }
    return out
  }

  entries.forEach((entry, ei) => {
    if (ei > 0) children.push(new Paragraph({ children: [new PageBreak()] }))

    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: clean(entry.title), bold: true, color: '5014B4' })],
    }))
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${MONTH_NAMES_LONG[entry.month]} ${entry.day}, ${entry.year}`,
        italics: true, color: '888899', size: 18,
      })],
    }))
    children.push(new Paragraph({ children: [] }))

    for (const b of parseBlocks(entry.notes)) {
      switch (b.kind) {
        case 'heading':
          children.push(new Paragraph({
            heading: b.level === 1 ? HeadingLevel.HEADING_2
                   : b.level === 2 ? HeadingLevel.HEADING_3
                   : HeadingLevel.HEADING_4,
            children: textRuns(b.runs, { bold: true }),
          }))
          break
        case 'paragraph':
          children.push(new Paragraph({ children: textRuns(b.runs) }))
          break
        case 'bullet':
          children.push(new Paragraph({ bullet: { level: Math.max(0, Math.min(8, b.depth - 1)) }, children: textRuns(b.runs) }))
          break
        case 'ordered':
          children.push(new Paragraph({ indent: { left: 360 * b.depth }, children: textRuns([{ text: `${b.index}. ` }, ...b.runs]) }))
          break
        case 'task':
          children.push(new Paragraph({ indent: { left: 360 * (b.depth - 1) }, children: textRuns([{ text: b.checked ? '☑ ' : '☐ ' }, ...b.runs]) }))
          break
        case 'table':
          children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map(row => new TableRow({
              children: row.map(cell => new TableCell({
                ...(cell.header ? { shading: { type: ShadingType.CLEAR, fill: 'F0EBFC', color: 'auto' } } : {}),
                children: [new Paragraph({ children: textRuns(cell.runs, cell.header ? { bold: true } : {}) })],
              })),
            })),
          }))
          children.push(new Paragraph({ children: [] }))
          break
        case 'note':
          children.push(new Paragraph({ children: [new TextRun({ text: clean(b.text), italics: true, color: '888899' })] }))
          break
        case 'codeblock':
          children.push(new Paragraph({
            children: [new TextRun({ text: clean(b.text), font: 'Courier New', size: 18, color: '445566' })],
          }))
          break
        case 'hr':
          children.push(new Paragraph({ children: [new TextRun('─'.repeat(40))] }))
          break
        case 'blank':
          children.push(new Paragraph({ children: [] }))
          break
      }
    }
  })

  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBlob(doc)
}

export async function exportToDocx(entries: ExportEntry[], filename: string): Promise<void> {
  downloadBlob(await buildDocx(entries), `${filename}.docx`)
}
