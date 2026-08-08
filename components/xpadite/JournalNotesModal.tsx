'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'

const LS_KEY = 'xp9-journal'

function loadNotes(): string {
  if (typeof window === 'undefined') return ''
  try { return localStorage.getItem(LS_KEY) ?? '' } catch { return '' }
}

interface JournalNotesModalProps {
  onClose: () => void
}

export function JournalNotesModal({ onClose }: JournalNotesModalProps) {
  const { isDark } = useApp()
  const [notes, setNotes] = useState(loadNotes)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSave() {
    try { localStorage.setItem(LS_KEY, notes) } catch {}
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[480px] sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{
            background: isDark
              ? 'linear-gradient(135deg, #0a0a1a 0%, #091a12 100%)'
              : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
            borderBottom: '0.5px solid var(--xp-bdr)',
          }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>📝 Journal Notes</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Capture your thoughts, reflections, and ideas.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ background: 'rgba(22,163,74,0.12)', color: '#16a34a' }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 px-5 py-5 overflow-y-auto" style={{ flex: 1 }}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Write your thoughts, goals, reflections, or ideas…"
            style={{
              minHeight: 200,
              padding: '12px',
              borderRadius: 12,
              border: '0.5px solid var(--xp-bdr2)',
              background: 'var(--xp-bg3)',
              color: 'var(--xp-txt)',
              fontSize: 13,
              lineHeight: 1.65,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSave}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-85"
            style={{
              background: saved
                ? 'linear-gradient(135deg, #15803d, #166534)'
                : 'linear-gradient(135deg, #16a34a, #15803d)',
            }}
          >
            {saved ? '✓ Saved' : 'Save Notes'}
          </button>
          <p className="text-[10px] text-center" style={{ color: 'var(--xp-txt3)' }}>
            More journaling features coming soon — entries by date, search, and tags.
          </p>
        </div>
      </div>
    </div>
  )
}
