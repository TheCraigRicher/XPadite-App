// ── Planner → Task Manager bridge — shared pure helpers ─────────────────────
// Used by both JournalEditorContent.tsx (which owns the live TipTap editor and
// performs the actual Task Manager writes) and SendToOptionsModal.tsx (which
// owns the "Send to" wizard UI and needs the same tree-shaping logic for its
// selection/duplicate sub-views). Kept dependency-free and framework-agnostic
// on purpose — everything here operates on plain TipTap JSON and plain data.
//
// Only actual TipTap `taskItem` nodes are ever eligible — plain paragraphs,
// headings, bullets and section titles are structurally invisible to this walk,
// which is what keeps non-checkbox content from ever becoming a Task Manager task.

export interface PlannerTaskNode {
  id: string
  text: string
  checked: boolean
  sentTaskId: string | null
  children: PlannerTaskNode[]
}

function mkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function flattenTipTapText(node: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (Array.isArray(node.content)) return node.content.map(flattenTipTapText).join('')
  return ''
}

// Lazily assigns a stable id to any taskItem missing one (older documents predate
// this feature) — returns a deep-cloned doc plus whether any id was actually added,
// so the caller only needs to persist when something changed.
export function ensureTaskItemIds(doc: any): { doc: any; changed: boolean } { // eslint-disable-line @typescript-eslint/no-explicit-any
  let changed = false
  const cloned = JSON.parse(JSON.stringify(doc ?? {}))
  function walk(node: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!node || typeof node !== 'object') return
    if (node.type === 'taskItem' && !node.attrs?.xpId) {
      node.attrs = { ...(node.attrs ?? {}), xpId: mkId() }
      changed = true
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(cloned)
  return { doc: cloned, changed }
}

export function extractPlannerTaskTree(doc: any): PlannerTaskNode[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  function walkList(listNode: any): PlannerTaskNode[] { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!listNode || listNode.type !== 'taskList' || !Array.isArray(listNode.content)) return []
    return listNode.content.filter((n: any) => n.type === 'taskItem').map(walkItem) // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  function walkItem(item: any): PlannerTaskNode { // eslint-disable-line @typescript-eslint/no-explicit-any
    const firstPara = (item.content ?? []).find((n: any) => n.type === 'paragraph') // eslint-disable-line @typescript-eslint/no-explicit-any
    const childList = (item.content ?? []).find((n: any) => n.type === 'taskList') // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      id: item.attrs?.xpId ?? mkId(),
      text: flattenTipTapText(firstPara).trim(),
      checked: !!item.attrs?.checked,
      sentTaskId: item.attrs?.xpSentTaskId ?? null,
      children: childList ? walkList(childList) : [],
    }
  }
  const roots: PlannerTaskNode[] = []
  function walkNode(node: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!node) return
    if (node.type === 'taskList') { roots.push(...walkList(node)); return }
    if (Array.isArray(node.content)) node.content.forEach(walkNode)
  }
  walkNode(doc)
  return roots
}

// Keeps only selected nodes; a selected node whose ancestor wasn't selected is
// hoisted up so it never silently disappears (spec: preserve hierarchy only
// "where necessary for the selected items" — an unselected ancestor is skipped,
// not required).
export function filterSelectedTaskTree(nodes: PlannerTaskNode[], selected: Set<string>): PlannerTaskNode[] {
  const out: PlannerTaskNode[] = []
  for (const n of nodes) {
    const kids = filterSelectedTaskTree(n.children, selected)
    if (selected.has(n.id)) out.push({ ...n, children: kids })
    else out.push(...kids)
  }
  return out
}

// Keeps only never-sent nodes, hoisting a fresh descendant of an already-sent
// node up a level (mirrors filterSelectedTaskTree's hoisting rule).
export function filterFreshTaskTree(nodes: PlannerTaskNode[]): PlannerTaskNode[] {
  const out: PlannerTaskNode[] = []
  for (const n of nodes) {
    const kids = filterFreshTaskTree(n.children)
    if (!n.sentTaskId) out.push({ ...n, children: kids })
    else out.push(...kids)
  }
  return out
}

// Task Manager only supports one level of parent/subtask — deeper Planner
// nesting is flattened so every grandchild becomes a direct subtask of the
// nearest top-level task, rather than inventing a deeper hierarchy TM can't store.
export function flattenTaskTreeToTwoLevels(nodes: PlannerTaskNode[]): PlannerTaskNode[] {
  function collectDescendants(n: PlannerTaskNode): PlannerTaskNode[] {
    return n.children.flatMap(c => [{ ...c, children: [] }, ...collectDescendants(c)])
  }
  return nodes.map(n => ({ ...n, children: collectDescendants(n) }))
}

export function countPlannerTaskTree(nodes: PlannerTaskNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countPlannerTaskTree(n.children), 0)
}

export function countSentInTaskTree(nodes: PlannerTaskNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.sentTaskId ? 1 : 0) + countSentInTaskTree(n.children), 0)
}

export function makeTaskId(seed: number): string {
  return 't' + (Date.now() + seed) + Math.random().toString(36).slice(2, 8)
}
