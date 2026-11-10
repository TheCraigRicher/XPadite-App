'use client'
// v1.330 — the Planner editor's top-left header burger: Mind Mapping / + Create New / + Create Note.
// Presentation only. "Mind Mapping" opens the EXISTING Mind Mapping canvas (the editor passes its own opener); the two Create actions are routed by the editor
// through its unsaved-changes guard before anything is switched. Lives in its own file so the very large editor component gains no state or effects.
import { useEffect, useRef, useState } from 'react'

export function PlannerHeaderMenu({ onMindMap, onCreateNew, onCreateNote }: { onMindMap: () => void; onCreateNew: () => void; onCreateNote: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('touchstart', outside)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside) }
  }, [open])

  const items = [
    { id: 'mindmap', label: '🧠 Mind Mapping', run: onMindMap },
    { id: 'create-new', label: '+ Create New', run: onCreateNew },
    { id: 'create-note', label: '+ Create Note', run: onCreateNote },
  ]
  return (
    <div ref={ref} style={{ position: 'absolute', left: 6, top: 10, zIndex: 5 }}>
      <button
        onClick={() => setOpen(v => !v)}
        data-testid="editor-burger"
        aria-label="Planner menu" aria-haspopup="menu" aria-expanded={open}
        title="Menu"
        style={{
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
          background: open ? 'rgba(255,255,255,0.18)' : 'transparent', border: 'none', borderRadius: 8, color: '#fff',
        }}
      >
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M1 1.5h16M1 7h16M1 12.5h16" />
        </svg>
      </button>
      {open && (
        <div role="menu" data-testid="editor-burger-menu" style={{
          position: 'absolute', top: 38, left: 0, minWidth: 190, zIndex: 60,
          background: '#160a30', border: '0.5px solid rgba(124,58,237,0.40)', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)', padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {items.map(it => (
            <button key={it.id} role="menuitem" data-testid={`editor-menu-${it.id}`}
              onClick={() => { setOpen(false); it.run() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer', border: 'none',
                background: 'transparent', color: 'rgba(255,255,255,0.88)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.16)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
