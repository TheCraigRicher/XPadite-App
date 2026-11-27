'use client'

// v1.360 — the two small, dismissible pills for Copy & Paste in My Schedule: "Event copied · Cancel" while an event is on the clipboard, and "Event pasted
// successfully. Undo" for a few seconds after a paste. They float in the bottom-left corner of the schedule (no layout space is taken), never over the toolbar,
// and they only report state / call the callbacks they are given.

interface Props {
  /** Title of the copied event (null = nothing copied) */
  clipTitle: string | null
  onCancelCopy: () => void
  /** Title of the event that was just pasted (null = no undo available) */
  undoTitle: string | null
  onUndo: () => void
}

const pill = { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minHeight: 30, padding: '4px 6px 4px 11px', borderRadius: 16, fontSize: 11.5, fontWeight: 600, pointerEvents: 'auto',
  background: '#1e1130', color: '#f1f5f9', border: '1px solid rgba(167,139,250,0.55)', boxShadow: '0 6px 18px rgba(0,0,0,0.35)' } as const
const act = { minHeight: 24, padding: '0 9px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, background: 'rgba(167,139,250,0.28)', color: '#ede9fe', flexShrink: 0 } as const

export function SchedulePasteBar({ clipTitle, onCancelCopy, undoTitle, onUndo }: Props) {
  if (clipTitle === null && undoTitle === null) return null
  return (
    <div data-testid="paste-bar" className="absolute z-[25] flex flex-col items-start gap-1.5" style={{ left: 14, bottom: 14, right: 14, pointerEvents: 'none' }}>
      {undoTitle !== null && (
        <div data-testid="paste-undo" role="status" aria-live="polite" style={pill}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Event pasted successfully.</span>
          <button type="button" data-testid="paste-undo-btn" onClick={onUndo} aria-label={`Undo paste of ${undoTitle}`} style={act}>Undo</button>
        </div>
      )}
      {clipTitle !== null && (
        <div data-testid="copy-chip" role="status" style={pill}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0 }}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" strokeLinecap="round" /></svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Event copied<span className="hidden sm:inline" style={{ opacity: 0.75, fontWeight: 500 }}> · {clipTitle}</span></span>
          <button type="button" data-testid="copy-cancel" onClick={onCancelCopy} aria-label="Cancel copy mode" style={act}>Cancel</button>
        </div>
      )}
    </div>
  )
}
