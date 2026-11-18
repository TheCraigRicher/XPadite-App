'use client'

// v1.351 — the round Maximize/Restore + Close buttons of the Planner modal header, for the Library and Journal Calendar tabs. They are the SAME controls
// the Editor tab has had since v1.347 (same 30px circle, icons, colours, hover/focus/press states, same My Schedule look): one maximise state lives in the
// modal shell (JournalWorkspaceModal), so there is a single system and it survives switching tabs.
import React from 'react'

const HDR_ICON_BTN: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.88)', border: '0.5px solid rgba(255,255,255,0.25)',
}

export function PlannerHeaderButtons({ maximized, onToggleMaximize, onClose }: {
  maximized: boolean
  /** omitted below 1024px (those screens keep their existing full-screen layout) */
  onToggleMaximize?: () => void
  onClose: () => void
}) {
  return (
    <div className="hidden sm:flex items-center gap-2" style={{ flexShrink: 0 }}>
      <style>{`
        .xp-hdr-btn { transition: background-color 120ms ease, transform 120ms ease; }
        .xp-hdr-btn:hover { background: rgba(255,255,255,0.26) !important; }
        .xp-hdr-btn:active { transform: scale(0.93); }
        .xp-hdr-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .xp-hdr-btn { transition: none; } }
      `}</style>
      {onToggleMaximize && (
        <button
          type="button" onClick={onToggleMaximize} data-testid="planner-maximize-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'}
          className="xp-hdr-btn flex items-center justify-center flex-shrink-0"
          style={HDR_ICON_BTN}
        >
          {maximized ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><path d="M10 4v6H4M10 10 4 4" /><path d="M14 4v6h6M14 10l6-6" /><path d="M10 20v-6H4M10 14l-6 6" /><path d="M14 20v-6h6M14 14l6 6" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><path d="M4 9V4h5M4 4l6 6" /><path d="M20 9V4h-5M20 4l-6 6" /><path d="M4 15v5h5M4 20l6-6" /><path d="M20 15v5h-5M20 20l-6-6" /></svg>
          )}
        </button>
      )}
      <button
        type="button" onClick={onClose} aria-label="Close" title="Close" data-testid="planner-close-btn"
        className="xp-hdr-btn flex items-center justify-center flex-shrink-0"
        style={HDR_ICON_BTN}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}
