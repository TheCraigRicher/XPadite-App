'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

type DocBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string; depth: number }
  | { kind: 'ordered'; text: string; index: number; depth: number }
  | { kind: 'task'; text: string; checked: boolean }
  | { kind: 'codeblock'; text: string }
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

function getNodeText(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(getNodeText).join('')
}

function walkNodes(
  nodes: TiptapNode[],
  blocks: DocBlock[],
  listCtx?: { type: 'bullet' | 'ordered'; depth: number; counter: number[] },
): void {
  for (const node of nodes) walkNode(node, blocks, listCtx)
}

function walkNode(
  node: TiptapNode,
  blocks: DocBlock[],
  listCtx?: { type: 'bullet' | 'ordered'; depth: number; counter: number[] },
): void {
  switch (node.type) {
    case 'heading':
      blocks.push({ kind: 'heading', level: (node.attrs?.level as number) ?? 1, text: getNodeText(node) })
      break

    case 'paragraph': {
      const text = getNodeText(node)
      blocks.push(text.trim() ? { kind: 'paragraph', text } : { kind: 'blank' })
      break
    }

    case 'bulletList': {
      const ctx = { type: 'bullet' as const, depth: (listCtx?.depth ?? 0) + 1, counter: [1] }
      walkNodes(node.content ?? [], blocks, ctx)
      break
    }

    case 'orderedList': {
      const ctx = {
        type: 'ordered' as const,
        depth: (listCtx?.depth ?? 0) + 1,
        counter: [(node.attrs?.start as number) ?? 1],
      }
      walkNodes(node.content ?? [], blocks, ctx)
      break
    }

    case 'listItem': {
      const para = node.content?.[0]
      if (!para) break
      const text = getNodeText(para)
      if (listCtx?.type === 'bullet') {
        blocks.push({ kind: 'bullet', text, depth: listCtx.depth })
      } else if (listCtx?.type === 'ordered') {
        blocks.push({ kind: 'ordered', text, index: listCtx.counter[0]++, depth: listCtx.depth })
      } else {
        blocks.push({ kind: 'paragraph', text })
      }
      if (node.content && node.content.length > 1) walkNodes(node.content.slice(1), blocks, listCtx)
      break
    }

    case 'taskList':
      walkNodes(node.content ?? [], blocks, undefined)
      break

    case 'taskItem': {
      const checked = (node.attrs?.checked as boolean) ?? false
      blocks.push({ kind: 'task', text: node.content?.[0] ? getNodeText(node.content[0]) : '', checked })
      if (node.content && node.content.length > 1) walkNodes(node.content.slice(1), blocks, undefined)
      break
    }

    case 'codeBlock':
      blocks.push({ kind: 'codeblock', text: getNodeText(node) })
      break

    case 'horizontalRule':
      blocks.push({ kind: 'hr' })
      break

    default:
      walkNodes(node.content ?? [], blocks, listCtx)
  }
}

function parseBlocks(notes: string | undefined): DocBlock[] {
  if (!notes?.trim()) return []
  try {
    const doc = JSON.parse(notes) as TiptapNode
    const blocks: DocBlock[] = []
    walkNode(doc, blocks, undefined)
    return blocks
  } catch {
    return notes.trim() ? [{ kind: 'paragraph', text: notes }] : []
  }
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

// ─── TXT ──────────────────────────────────────────────────────────────────────

const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function blocksToText(blocks: DocBlock[]): string {
  return blocks.map(b => {
    switch (b.kind) {
      case 'heading':  return `${'#'.repeat(b.level)} ${b.text}`
      case 'paragraph': return b.text
      case 'bullet':   return `${'  '.repeat(b.depth - 1)}• ${b.text}`
      case 'ordered':  return `${'  '.repeat(b.depth - 1)}${b.index}. ${b.text}`
      case 'task':     return `[${b.checked ? 'x' : ' '}] ${b.text}`
      case 'codeblock': return `\`\`\`\n${b.text}\n\`\`\``
      case 'hr':       return '─'.repeat(40)
      case 'blank':    return ''
    }
  }).join('\n')
}

export async function exportToTxt(entries: ExportEntry[], filename: string): Promise<void> {
  const parts = entries.map(e => {
    const dateStr = `${MONTH_NAMES_LONG[e.month]} ${e.day}, ${e.year}`
    const width   = Math.max(e.title.length, dateStr.length, 20)
    const body    = blocksToText(parseBlocks(e.notes))
    return `${e.title}\n${dateStr}\n${'='.repeat(width)}${body ? '\n\n' + body : ''}`
  })
  const content = parts.join('\n\n' + '─'.repeat(60) + '\n\n')
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${filename}.txt`)
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function exportToPdf(entries: ExportEntry[], filename: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW  = 210, ml = 20, mr = 20, mt = 20, mb = 25, cW = 170, pageH = 297
  let y = mt

  function checkPage(need = 8) {
    if (y + need > pageH - mb) { pdf.addPage(); y = mt }
  }

  function writeLine(text: string, size: number, style: 'normal' | 'bold' = 'normal', indent = 0) {
    pdf.setFont('helvetica', style)
    pdf.setFontSize(size)
    const lh    = size * 0.38 + 1.5
    const lines = pdf.splitTextToSize(text, cW - indent)
    checkPage(lines.length * lh)
    pdf.text(lines, ml + indent, y)
    y += lines.length * lh
  }

  entries.forEach((entry, ei) => {
    if (ei > 0) {
      checkPage(15)
      pdf.setDrawColor(180, 150, 240)
      pdf.setLineWidth(0.4)
      pdf.line(ml, y, pageW - mr, y)
      y += 8
    }

    pdf.setTextColor(80, 20, 180)
    writeLine(entry.title, 16, 'bold')

    pdf.setTextColor(120, 120, 150)
    writeLine(`${MONTH_NAMES_LONG[entry.month]} ${entry.day}, ${entry.year}`, 9)
    y += 3

    pdf.setTextColor(30, 30, 40)

    for (const b of parseBlocks(entry.notes)) {
      switch (b.kind) {
        case 'heading':
          y += 2
          pdf.setTextColor(60, 20, 120)
          writeLine(b.text, b.level <= 2 ? 13 : 11, 'bold')
          pdf.setTextColor(30, 30, 40)
          break
        case 'paragraph':
          writeLine(b.text, 10)
          y += 1
          break
        case 'bullet':
          writeLine(`• ${b.text}`, 10, 'normal', (b.depth - 1) * 5)
          break
        case 'ordered':
          writeLine(`${b.index}. ${b.text}`, 10, 'normal', (b.depth - 1) * 5)
          break
        case 'task':
          writeLine(`${b.checked ? '☑' : '☐'} ${b.text}`, 10)
          break
        case 'codeblock': {
          y += 1
          const lines  = pdf.splitTextToSize(b.text || ' ', cW - 8)
          const boxH   = lines.length * 4.5 + 5
          checkPage(boxH + 3)
          pdf.setFillColor(245, 242, 255)
          pdf.rect(ml, y - 3, cW, boxH, 'F')
          pdf.setFont('courier', 'normal')
          pdf.setFontSize(9)
          pdf.setTextColor(80, 80, 110)
          pdf.text(lines, ml + 4, y + 1)
          y += boxH + 2
          pdf.setTextColor(30, 30, 40)
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

  downloadBlob(pdf.output('blob'), `${filename}.pdf`)
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export async function exportToDocx(entries: ExportEntry[], filename: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await import('docx') as any
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = d

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = []

  entries.forEach((entry, ei) => {
    if (ei > 0) children.push(new Paragraph({ children: [new PageBreak()] }))

    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: entry.title, bold: true, color: '5014B4' })],
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
            children: [new TextRun({ text: b.text, bold: true })],
          }))
          break
        case 'paragraph':
          children.push(new Paragraph({ children: [new TextRun(b.text)] }))
          break
        case 'bullet':
          children.push(new Paragraph({
            bullet: { level: Math.max(0, b.depth - 1) },
            children: [new TextRun(b.text)],
          }))
          break
        case 'ordered':
          children.push(new Paragraph({ children: [new TextRun(`${b.index}. ${b.text}`)] }))
          break
        case 'task':
          children.push(new Paragraph({ children: [new TextRun(`${b.checked ? '☑' : '☐'} ${b.text}`)] }))
          break
        case 'codeblock':
          children.push(new Paragraph({
            children: [new TextRun({ text: b.text, font: 'Courier New', size: 18, color: '445566' })],
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
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `${filename}.docx`)
}
