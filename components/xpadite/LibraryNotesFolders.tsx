'use client'
// v1.332 — the Library's Notes collection (folders + Notes together, ONE level), Move-to-Folder dialog and the drag-and-drop tray.
// Presentation only: every action is a callback into JournalWorkspaceModal (which owns persistence), so Notes, regular documents and folders all
// go through the same pipeline. Responsive by construction (auto-fill grids, no fixed widths) and themed with the Library's own colours.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { JournalFolder } from './types'
import type { LibEntry } from './journalDocs'

export interface DragProps {
  draggable?: true
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}

/**
 * True only for a mouse-like pointer (hover + fine). HTML5 drag-and-drop is switched on only there: on touch screens (Android/iOS PWA, a Capacitor
 * WebView) `draggable` can hijack a scroll or long-press, and "Move to Folder" is the touch path anyway.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia('(hover: hover) and (pointer: fine)'); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    () => false,
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
const entryDate = (e: LibEntry) => fmtDate(e.kind === 'note' ? new Date(e.createdAt) : new Date(e.year, e.month, e.day))

function useTheme(isDark: boolean) {
  return {
    text: isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)',
    muted: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)',
    card: isDark ? 'rgba(255,255,255,0.045)' : 'rgba(124,58,237,0.045)',
    cardHover: isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.10)',
    border: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(124,58,237,0.16)',
    bdr: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    pop: isDark ? '#1a1530' : '#ffffff',
  }
}

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: 10, alignContent: 'start' }

// ─── ⋮ menu (viewport-clamped popover, closes on outside tap) ─────────────────
export interface MenuItem { label: string; icon: string; onClick: () => void; danger?: boolean; testId?: string }

function KebabMenu({ isDark, items, label }: { isDark: boolean; items: MenuItem[]; label: string }) {
  const t = useTheme(isDark)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const W = 176
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('touchstart', outside)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside) }
  }, [open])
  const toggle = () => {
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
      const top = r.bottom + 4 + items.length * 38 > window.innerHeight ? Math.max(8, r.top - 4 - items.length * 38) : r.bottom + 4
      setPos({ top, left })
    }
    setOpen(true)
  }
  return (
    <div ref={ref} style={{ position: 'absolute', top: 3, right: 3 }} onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
      <button ref={btnRef} onClick={toggle} title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        style={{ width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, lineHeight: 1,
          background: open ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)') : (isDark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.6)'),
          color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)' }}>⋮</button>
      {open && pos && (
        <div role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: W, zIndex: 90, background: t.pop, border: `0.5px solid ${t.bdr}`,
          borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.30)' }}>
          {items.map(it => (
            <button key={it.label} role="menuitem" data-testid={it.testId} onClick={() => { setOpen(false); it.onClick() }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 500, textAlign: 'left', color: it.danger ? '#f87171' : (isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)') }}>
              <span>{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Inline rename (mounted only while renaming, so its text starts from the current title with no effect) ───
function RenameInput({ isDark, initial, onCommit, onCancel }: { isDark: boolean; initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const t = useTheme(isDark)
  const [val, setVal] = useState(initial)
  return (
    <input autoFocus type="text" value={val} maxLength={80} aria-label="Rename" data-testid="rename-input"
      onChange={e => setVal(e.target.value)} onBlur={() => onCommit(val)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCommit(val) } if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
      onClick={e => e.stopPropagation()}
      style={{ marginTop: 8, width: '100%', fontSize: 11, padding: '2px 5px', borderRadius: 4, outline: 'none', boxSizing: 'border-box',
        background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)', border: '1px solid rgba(124,58,237,0.55)', color: t.text }} />
  )
}

// ─── Document / Note card ─────────────────────────────────────────────────────
function DocCard({ isDark, entry, menu, onOpen, drag, renaming, onRenameCommit, onRenameCancel, testId, badge }: {
  isDark: boolean; entry: LibEntry; menu: MenuItem[]; onOpen: () => void; drag?: DragProps; badge?: string
  renaming?: boolean; onRenameCommit?: (title: string) => void; onRenameCancel?: () => void; testId?: string
}) {
  const t = useTheme(isDark)
  return (
    <div role="button" tabIndex={0} data-testid={testId} data-doc-key={entry.key} title={entry.title}
      onClick={() => { if (!renaming) onOpen() }}
      onKeyDown={e => { if (e.key === 'Enter' && !renaming) onOpen() }}
      {...drag}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 8px 8px', borderRadius: 10, textAlign: 'center',
        cursor: 'pointer', minWidth: 0, background: t.card, border: `0.5px solid ${t.border}`, transition: 'background 120ms' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = t.cardHover }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = t.card }}>
      <KebabMenu isDark={isDark} items={menu} label={`${entry.kind === 'note' ? 'Note' : 'Document'} actions`} />
      <div style={{ width: 52, height: 60, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(124,58,237,0.07)', border: `0.5px solid ${t.border}` }}>
        {entry.kind === 'note' ? '🗒️' : '📝'}
      </div>
      {renaming ? (
        <RenameInput isDark={isDark} initial={entry.title} onCommit={v => onRenameCommit?.(v)} onCancel={() => onRenameCancel?.()} />
      ) : (
        <div style={{ marginTop: 8, width: '100%', fontSize: 11.5, fontWeight: 500, lineHeight: 1.3, color: t.text, overflow: 'hidden', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{entry.title}</div>
      )}
      {badge && <div data-testid="legacy-badge" style={{ marginTop: 4, fontSize: 9.5, fontWeight: 600, padding: '1px 7px', borderRadius: 9, color: isDark ? '#c4b5fd' : '#6d28d9', background: isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)' }}>{badge}</div>}
      <div style={{ marginTop: 'auto', paddingTop: 6, fontSize: 10, color: t.muted }}>{entryDate(entry)}</div>
    </div>
  )
}

// ─── Small shared dialogs ─────────────────────────────────────────────────────
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 85, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 340, maxHeight: '90%', overflowY: 'auto' }}>{children}</div>
    </div>
  )
}
const dialogBox = (isDark: boolean): React.CSSProperties => ({
  background: isDark ? '#1e1b2e' : '#ffffff', border: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
  borderRadius: 14, padding: '20px 22px', boxShadow: '0 8px 40px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', gap: 14,
})
const btn = (kind: 'primary' | 'ghost' | 'danger', isDark: boolean): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: kind === 'ghost' ? 500 : 600, cursor: 'pointer',
  background: kind === 'primary' ? 'rgba(124,58,237,0.92)' : kind === 'danger' ? 'rgba(239,68,68,0.88)' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
  border: kind === 'ghost' ? `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}` : 'none',
  color: kind === 'ghost' ? (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)') : '#fff',
})

export function NamePrompt({ isDark, title, initial, confirmLabel, onSubmit, onClose }: {
  isDark: boolean; title: string; initial: string; confirmLabel: string; onSubmit: (name: string) => void; onClose: () => void
}) {
  const t = useTheme(isDark)
  const [val, setVal] = useState(initial)
  const ok = val.trim().length > 0
  return (
    <Overlay onClose={onClose}>
      <form style={dialogBox(isDark)} onSubmit={e => { e.preventDefault(); if (ok) onSubmit(val.trim()) }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{title}</div>
        <input autoFocus type="text" value={val} maxLength={60} placeholder="Folder name" data-testid="name-prompt-input" onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
          style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, outline: 'none', boxSizing: 'border-box', width: '100%',
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', border: '1px solid rgba(124,58,237,0.5)', color: t.text }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btn('ghost', isDark)}>Cancel</button>
          <button type="submit" disabled={!ok} data-testid="name-prompt-ok" style={{ ...btn('primary', isDark), opacity: ok ? 1 : 0.45, cursor: ok ? 'pointer' : 'default' }}>{confirmLabel}</button>
        </div>
      </form>
    </Overlay>
  )
}

/** Mobile-friendly alternative to drag-and-drop: pick the destination folder (or "no folder"), or create a new one on the spot. */
export function MoveToFolderDialog({ isDark, folders, currentFolderId, count, onPick, onCreate, onClose }: {
  isDark: boolean; folders: JournalFolder[]; currentFolderId: string | null; count: number
  onPick: (folderId: string | null) => void; onCreate: () => void; onClose: () => void
}) {
  const t = useTheme(isDark)
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    background: 'transparent', border: `0.5px solid ${t.bdr}`, textAlign: 'left', fontSize: 13, color: t.text }
  return (
    <Overlay onClose={onClose}>
      <div style={dialogBox(isDark)} data-testid="move-dialog">
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Move {count === 1 ? 'to folder' : `${count} items to folder`}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {folders.map(f => (
            <button key={f.id} data-testid={`move-to-${f.id}`} onClick={() => onPick(f.id)} disabled={f.id === currentFolderId} style={{ ...row, opacity: f.id === currentFolderId ? 0.45 : 1 }}>
              <span style={{ fontSize: 18 }}>📁</span><span style={{ flex: 1, overflowWrap: 'anywhere' }}>{f.name}</span>{f.id === currentFolderId && <span style={{ fontSize: 11, color: t.muted }}>current</span>}
            </button>
          ))}
          {folders.length === 0 && <div style={{ fontSize: 12, color: t.muted }}>You have no folders yet.</div>}
          {currentFolderId && <button data-testid="move-to-none" onClick={() => onPick(null)} style={row}><span style={{ fontSize: 18 }}>↩︎</span>Remove from folder</button>}
        </div>
        <button onClick={onCreate} data-testid="move-create-folder" style={{ ...row, border: '0.5px dashed rgba(124,58,237,0.5)', color: '#a78bfa' }}>+ New folder…</button>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={onClose} style={btn('ghost', isDark)}>Cancel</button></div>
      </div>
    </Overlay>
  )
}

/** Appears while a card is being dragged: every folder becomes a drop target (the folder tab itself is not on screen in Documents / Notes). */
export function DragTray({ isDark, folders, currentFolderId, bleedX = 14, bleedBottom = 18, onDrop }: { isDark: boolean; folders: JournalFolder[]; currentFolderId?: string | null; bleedX?: number; bleedBottom?: number; onDrop: (folderId: string | null) => void }) {
  const t = useTheme(isDark)
  const [over, setOver] = useState<string | null>(null)
  const zone = (id: string | null, label: string, icon: string) => (
    <div key={id ?? 'none'} data-testid={`drop-${id ?? 'none'}`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(id ?? '__none') }}
      onDragLeave={() => setOver(null)}
      onDrop={e => { e.preventDefault(); setOver(null); onDrop(id) }}
      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500, maxWidth: 180,
        background: over === (id ?? '__none') ? 'rgba(124,58,237,0.40)' : (isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.10)'),
        border: `1px dashed ${over === (id ?? '__none') ? '#a78bfa' : 'rgba(124,58,237,0.5)'}`, color: t.text }}>
      <span>{icon}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
  return (
    <div data-testid="drag-tray" style={{ position: 'sticky', bottom: 0, zIndex: 40, margin: `14px -${bleedX}px -${bleedBottom}px`, padding: '10px 12px', display: 'flex', gap: 8, overflowX: 'auto',
      background: isDark ? 'rgba(14,8,34,0.96)' : 'rgba(255,255,255,0.97)', borderTop: `0.5px solid ${t.bdr}`, boxShadow: '0 -6px 20px rgba(0,0,0,0.25)' }}>
      {currentFolderId ? zone(null, 'Remove from folder', '↩︎') : null}
      {folders.filter(f => f.id !== currentFolderId).map(f => zone(f.id, f.name, '📁'))}
      {folders.length === 0 && <div style={{ fontSize: 12, color: t.muted, padding: '8px 4px' }}>Create a folder first (⋮ → Folders)</div>}
    </div>
  )
}

// ─── Pane chrome ──────────────────────────────────────────────────────────────
function PaneBar({ isDark, back, backLabel, title, count, action }: { isDark: boolean; back: () => void; backLabel: string; title: string; count: string; action?: React.ReactNode }) {
  const t = useTheme(isDark)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexShrink: 0, flexWrap: 'wrap', minHeight: 44, borderBottom: `0.5px solid ${t.bdr}`,
      background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
      <button onClick={back} data-testid="pane-back" style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
        background: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)', border: '0.5px solid rgba(124,58,237,0.32)', color: isDark ? '#c4b5fd' : '#7c3aed' }}>‹ {backLabel}</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: '1 1 120px' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
        <span style={{ fontSize: 11, color: t.muted, whiteSpace: 'nowrap' }}>{count}</span>
      </div>
      {action}
    </div>
  )
}
const Empty = ({ isDark, children }: { isDark: boolean; children: React.ReactNode }) => (
  <div style={{ textAlign: 'center', padding: '40px 16px', fontSize: 13, lineHeight: 1.5, color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)' }}>{children}</div>
)
const Unavailable = ({ isDark }: { isDark: boolean }) => (
  <div data-testid="docs-unavailable" style={{ margin: '12px 14px 0', padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.45,
    background: isDark ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.10)', border: '0.5px solid rgba(245,158,11,0.4)', color: isDark ? '#fcd34d' : '#92400e' }}>
    Notes need a one-time update to your XPadite database. Your existing documents are not affected.
  </div>
)

// ─── Notes collection: folders + Notes together (ONE folder level) ────────────────────────────────────────────────
/**
 * The Library's Notes tab. Root = every folder tile + every Note that is not in a folder. Opening a folder shows the Notes filed in it (plus, so that
 * nothing is ever hidden, any ordinary Planner document that v1.330 allowed into a folder — marked "Planner document", openable, and removable from
 * the folder, but never movable INTO one). No nesting: a folder can not contain folders. No "+ Create Note" / "back to Library" controls here — Notes are
 * created from the Planner menu, and the Library tabs are how you return to your documents.
 */
export function NotesLibrary({ isDark, folders, notes, filedDocs, openFolderId, unavailable, onOpenFolder, onOpen, onRename, onDelete, onMove, onUnfile, onRenameFolder, onDeleteFolder, onDropOnFolder, dragProps, footer }: {
  isDark: boolean; folders: JournalFolder[]; notes: LibEntry[]; filedDocs: LibEntry[]; openFolderId: string | null; unavailable: boolean
  onOpenFolder: (id: string | null) => void; onOpen: (key: string) => void
  onRename: (key: string, title: string) => void; onDelete: (key: string) => void; onMove: (key: string) => void; onUnfile: (key: string) => void
  onRenameFolder: (id: string, name: string) => void; onDeleteFolder: (id: string) => void
  onDropOnFolder: (key: string, folderId: string) => void; dragProps: (key: string) => DragProps; footer?: React.ReactNode
}) {
  const t = useTheme(isDark)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ id: string; name: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const counts = new Map<string, number>()
  for (const e of [...notes, ...filedDocs]) if (e.folderId) counts.set(e.folderId, (counts.get(e.folderId) ?? 0) + 1)
  const open = openFolderId ? folders.find(f => f.id === openFolderId) ?? null : null
  const noteMenu = (n: LibEntry, inFolder: boolean): MenuItem[] => [
    { label: 'Rename', icon: '✏️', onClick: () => setRenaming(n.key), testId: 'note-rename' },
    { label: 'Move to Folder', icon: '📁', onClick: () => onMove(n.key), testId: 'note-move' },
    ...(inFolder ? [{ label: 'Remove from folder', icon: '↩︎', onClick: () => onUnfile(n.key), testId: 'item-unfile' }] : []),
    { label: 'Delete', icon: '🗑', danger: true, onClick: () => onDelete(n.key), testId: 'note-delete' },
  ]
  const noteCard = (n: LibEntry, inFolder: boolean) => (
    <DocCard key={n.key} isDark={isDark} entry={n} testId="note-card" drag={dragProps(n.key)} onOpen={() => onOpen(n.key)} renaming={renaming === n.key}
      onRenameCommit={v => { setRenaming(null); onRename(n.key, v) }} onRenameCancel={() => setRenaming(null)} menu={noteMenu(n, inFolder)} />
  )
  const promptEl = prompt && (
    <NamePrompt isDark={isDark} title="Rename Folder" initial={prompt.name} confirmLabel="Save" onSubmit={name => { onRenameFolder(prompt.id, name); setPrompt(null) }} onClose={() => setPrompt(null)} />
  )

  if (open) {
    const inside = notes.filter(n => n.folderId === open.id), legacy = filedDocs.filter(d => d.folderId === open.id)
    const total = inside.length + legacy.length
    return (
      <>
        <PaneBar isDark={isDark} back={() => onOpenFolder(null)} backLabel="Notes" title={`📁 ${open.name}`} count={`${total} ${total === 1 ? 'item' : 'items'}`} />
        <div data-testid="folder-contents" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 18px', position: 'relative' }}>
          {total === 0 ? <Empty isDark={isDark}>This folder is empty.<br />Move a Note here with its ⋮ menu (Move to Folder){`, or drag it onto the folder.`}</Empty> : (
            <div style={GRID}>
              {inside.map(n => noteCard(n, true))}
              {legacy.map(d => (
                <DocCard key={d.key} isDark={isDark} entry={d} testId="folder-item-legacy" badge="Planner document" drag={dragProps(d.key)} onOpen={() => onOpen(d.key)}
                  menu={[{ label: 'Open', icon: '📖', onClick: () => onOpen(d.key) }, { label: 'Remove from folder', icon: '↩︎', onClick: () => onUnfile(d.key), testId: 'item-unfile' }]} />
              ))}
            </div>
          )}
          {footer}
        </div>
        {promptEl}
      </>
    )
  }

  const unfiled = notes.filter(n => !n.folderId)
  return (
    <>
      <div data-testid="notes-pane" style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 18px', position: 'relative' }}>
        {unavailable && <Unavailable isDark={isDark} />}
        {folders.length === 0 && unfiled.length === 0
          ? <Empty isDark={isDark}>{unavailable ? '' : 'No Notes yet. Create one from the Planner menu (☰ → + Create Note).'}</Empty>
          : (
            <div style={GRID}>
              {folders.map(f => {
                const n = counts.get(f.id) ?? 0
                const hot = over === f.id
                return (
                  <div key={f.id} role="button" tabIndex={0} data-testid="folder-card" data-folder-id={f.id} title={f.name}
                    onClick={() => onOpenFolder(f.id)} onKeyDown={e => { if (e.key === 'Enter') onOpenFolder(f.id) }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(f.id) }}
                    onDragLeave={() => setOver(null)}
                    onDrop={e => { e.preventDefault(); setOver(null); const k = e.dataTransfer.getData('text/xp-doc'); if (k) onDropOnFolder(k, f.id) }}
                    style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 8px 8px', borderRadius: 10, textAlign: 'center', cursor: 'pointer', minWidth: 0,
                      background: hot ? 'rgba(124,58,237,0.30)' : t.card, border: `${hot ? 1.5 : 0.5}px solid ${hot ? '#a78bfa' : t.border}`, transition: 'background 120ms' }}>
                    <KebabMenu isDark={isDark} label="Folder actions" items={[
                      { label: 'Rename', icon: '✏️', onClick: () => setPrompt({ id: f.id, name: f.name }), testId: 'folder-rename' },
                      { label: 'Delete', icon: '🗑', danger: true, onClick: () => onDeleteFolder(f.id), testId: 'folder-delete' },
                    ]} />
                    <div style={{ fontSize: 40, lineHeight: '60px', height: 60 }}>📁</div>
                    <div style={{ marginTop: 6, width: '100%', fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: t.text, overflow: 'hidden', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{f.name}</div>
                    <div style={{ fontSize: 10.5, color: t.muted, marginTop: 2 }}>{n} {n === 1 ? 'item' : 'items'}</div>
                    <div style={{ marginTop: 'auto', paddingTop: 6, fontSize: 10, color: t.muted }}>{f.createdAt ? fmtDate(new Date(f.createdAt)) : ''}</div>
                  </div>
                )
              })}
              {unfiled.map(n => noteCard(n, false))}
            </div>
          )}
        {footer}
      </div>
      {promptEl}
    </>
  )
}

/** Confirmation for deleting a folder — states plainly that no document is deleted. */
export function DeleteFolderDialog({ isDark, folder, itemCount, onConfirm, onClose }: { isDark: boolean; folder: JournalFolder; itemCount: number; onConfirm: () => void; onClose: () => void }) {
  const t = useTheme(isDark)
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...dialogBox(isDark), border: `1px solid ${isDark ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.25)'}` }} data-testid="delete-folder-dialog">
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Delete folder “{folder.name}”?</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: t.muted }}>
          {itemCount > 0
            ? <>Its {itemCount} {itemCount === 1 ? 'item is' : 'items are'} <strong style={{ color: t.text }}>not deleted</strong> — {itemCount === 1 ? 'it goes' : 'they go'} back to your Library, outside any folder.</>
            : 'The folder is empty. No notes or documents will be deleted.'}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('ghost', isDark)}>Cancel</button>
          <button onClick={onConfirm} data-testid="delete-folder-confirm" style={btn('danger', isDark)}>Delete folder</button>
        </div>
      </div>
    </Overlay>
  )
}
