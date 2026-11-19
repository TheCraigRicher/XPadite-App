'use client'

// v1.351 — the small dialogs the Planner-wide actions open after "Continue": the label picker (Assign Label), the merge confirmation, and a plain
// "can't do that" notice (v1.354: and the confirmation for deleting a day's only section). Presentational only: the editor decides and applies; nothing here touches a document.
import React from 'react'
import { createPortal } from 'react-dom'
import { useEscapeLayer } from './escapeLayers'

export interface LabelOption { id: string; name: string; color: string }

function Shell({ isDark, label, onClose, children, testId }: { isDark: boolean; label: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  useEscapeLayer(true, () => onClose())
  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={label} data-testid={testId}
        style={{ width: '100%', maxWidth: 380, maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box', padding: 18, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 12,
          background: isDark ? '#1e1b2e' : '#ffffff', color: isDark ? '#f1f5f9' : '#0f172a', border: '1px solid rgba(124,58,237,0.35)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
        {children}
      </div>
    </div>, document.body)
}

const btn = (isDark: boolean, primary: boolean, danger = false): React.CSSProperties => ({
  minHeight: 38, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : `0.5px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)'}`,
  background: primary ? (danger ? '#dc2626' : 'rgba(124,58,237,0.95)') : 'transparent', color: primary ? '#fff' : (isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'),
})

/** Assign Label: pick one of the Library's existing labels (or none) for the chosen sections. Never creates a label. */
export function LabelPickerDialog({ isDark, labels, count, currentLabelId, onPick, onCancel }: {
  isDark: boolean; labels: LabelOption[]; count: number
  /** the label every chosen section already has (null = none / mixed) */
  currentLabelId: string | null
  onPick: (labelId: string | null) => void; onCancel: () => void
}) {
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 500,
    background: 'transparent', color: 'inherit', border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}` }
  return (
    <Shell isDark={isDark} label="Assign label" onClose={onCancel} testId="label-picker">
      <div style={{ fontSize: 15, fontWeight: 700 }}>Assign label</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>For {count} {count === 1 ? 'section' : 'sections'}. Labels come from your Library; the sections stay Planner sections.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {labels.map(l => (
          <button key={l.id} type="button" data-testid="label-option" data-label-id={l.id} onClick={() => onPick(l.id)}
            style={{ ...row, ...(currentLabelId === l.id ? { borderColor: 'rgba(124,58,237,0.8)', background: isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.08)' } : null) }}>
            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
            {currentLabelId === l.id && <span aria-hidden="true" style={{ fontSize: 12, color: '#a78bfa' }}>✓</span>}
          </button>
        ))}
        <button type="button" data-testid="label-remove" onClick={() => onPick(null)} style={{ ...row, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)' }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid currentColor', flexShrink: 0, opacity: 0.6 }} />Remove label
        </button>
      </div>
      <button type="button" data-testid="label-cancel" onClick={onCancel} style={{ ...btn(isDark, false), alignSelf: 'flex-end' }}>Cancel</button>
    </Shell>
  )
}

export interface MergeItem { id: string; title: string; kind: 'section' | 'text'; important: boolean; labelName: string | null; color: string | null; custom: boolean }

/** Merge confirmation: shows exactly which sections, lets the user choose the destination, and discloses what the other sections lose. */
export function MergeConfirmDialog({ isDark, items, destId, onDest, onConfirm, onCancel, undoNote }: {
  isDark: boolean; items: MergeItem[]; destId: string; onDest: (id: string) => void; onConfirm: () => void; onCancel: () => void; undoNote: string
}) {
  const others = items.filter(i => i.id !== destId)
  const lost: string[] = []
  const titled = others.filter(i => i.kind === 'section' && i.title)
  if (titled.length) lost.push(`Titles: ${titled.map(i => `"${i.title}"`).join(', ')}`)
  const imp = others.filter(i => i.important); if (imp.length) lost.push(`Important marks on ${imp.map(i => `"${i.title || 'Untitled'}"`).join(', ')}`)
  const lab = others.filter(i => i.labelName); if (lab.length) lost.push(`Labels: ${lab.map(i => i.labelName).join(', ')}`)
  const sections = others.filter(i => i.kind === 'section')
  if (sections.length) lost.push(`Colors, creation dates and custom dates of ${sections.length === 1 ? 'that section' : 'those sections'}`)
  return (
    <Shell isDark={isDark} label="Merge sections" onClose={onCancel} testId="merge-confirm">
      <div style={{ fontSize: 15, fontWeight: 700 }}>Merge {items.length} sections</div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>Choose the section to keep. The others&apos; text is added to its end, in Planner order, and those sections are then removed.</div>
      <div role="radiogroup" aria-label="Destination section" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(i => (
          <button key={i.id} type="button" role="radio" aria-checked={i.id === destId} data-testid="merge-dest" data-dest-id={i.id} onClick={() => onDest(i.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 42, padding: '0 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: i.id === destId ? 700 : 500, color: 'inherit',
              background: i.id === destId ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.09)') : 'transparent', border: `1px solid ${i.id === destId ? 'rgba(124,58,237,0.8)' : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)')}` }}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0, border: `1.5px solid ${i.id === destId ? '#7c3aed' : 'rgba(128,128,128,0.7)'}`, background: i.id === destId ? '#7c3aed' : 'transparent', boxShadow: i.id === destId ? 'inset 0 0 0 3px #fff' : 'none' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title || (i.kind === 'section' ? 'Untitled section' : 'Unsectioned text')}</span>
            {i.id === destId && <span style={{ fontSize: 10.5, opacity: 0.7 }}>kept</span>}
          </button>
        ))}
      </div>
      <div data-testid="merge-loss" style={{ fontSize: 12, padding: '8px 10px', borderRadius: 8, background: isDark ? 'rgba(245,158,11,0.12)' : '#fffbeb', border: '0.5px solid rgba(245,158,11,0.5)' }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>What changes</div>
        <div>The kept section&apos;s title, color, Important mark, label and dates stay as they are.</div>
        {lost.length > 0 && <div style={{ marginTop: 4 }}>Not kept from the other sections: {lost.join(' · ')}.</div>}
        <div style={{ marginTop: 4 }}>{undoNote}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" data-testid="merge-cancel" onClick={onCancel} style={btn(isDark, false)}>Cancel</button>
        <button type="button" data-testid="merge-confirm-btn" onClick={onConfirm} style={btn(isDark, true)}>Merge sections</button>
      </div>
    </Shell>
  )
}

export function NoticeDialog({ isDark, title, message, onClose }: { isDark: boolean; title: string; message: string[]; onClose: () => void }) {
  return (
    <Shell isDark={isDark} label={title} onClose={onClose} testId="planner-notice">
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {message.map((m, i) => <div key={i} style={{ fontSize: 12.5, opacity: 0.85 }}>{m}</div>)}
      <button type="button" data-testid="notice-ok" onClick={onClose} style={{ ...btn(isDark, true), alignSelf: 'flex-end' }}>OK</button>
    </Shell>
  )
}

/** v1.354: Delete on a day's ONLY section asks first (deleting it replaces it with an empty section). Cancel is the focused default. */
export function DeleteOnlySectionDialog({ isDark, onConfirm, onCancel }: { isDark: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Shell isDark={isDark} label="Delete this section?" onClose={onCancel} testId="delete-confirm">
      <div style={{ fontSize: 15, fontWeight: 700 }}>Delete this section?</div>
      <div style={{ fontSize: 12.5, opacity: 0.85 }}>This is the only section for this day. Deleting it will remove its contents and replace it with an empty section.</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" autoFocus data-testid="delete-cancel" onClick={onCancel} style={btn(isDark, false)}>Cancel</button>
        <button type="button" data-testid="delete-confirm-btn" onClick={onConfirm} style={btn(isDark, true, true)}>Delete</button>
      </div>
    </Shell>
  )
}
