'use client'

import { useState, useRef, useEffect } from 'react'
import { useApp } from './AppContext'
import { COLOR_PALETTE } from './utils'
import type { Activity } from './types'

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
    <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
)

const MinusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
)

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function AddActivityModal({ onClose }: { onClose: () => void }) {
  const { addActivity, setSelectedActId } = useApp()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(COLOR_PALETTE[0])

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    const newAct: Activity = { id: 'a' + Date.now(), name: trimmed, color }
    addActivity(newAct)
    setSelectedActId(newAct.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-2xl p-5 w-full max-w-[280px] shadow-2xl"
        style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}
      >
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Add Activity</h3>
        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Coding, Gym…"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 mb-4 transition-colors"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        <label className="block text-xs text-gray-500 mb-2">Color</label>
        <div className="flex gap-2 flex-wrap mb-5">
          {COLOR_PALETTE.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-5 h-5 rounded-full transition-all duration-150"
              style={{
                background: c,
                border: color === c ? '2.5px solid #0f172a' : '2.5px solid transparent',
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={save} className="px-3 py-1.5 text-xs text-white rounded-lg transition-opacity hover:opacity-80" style={{ background: '#7c3aed' }}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function ActivityDropdown() {
  const { activities, selectedActId, setSelectedActId, removingMode } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const selected = activities.find(a => a.id === selectedActId) ?? activities[0]
  if (!selected) return null

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => { if (!removingMode) setOpen(o => !o) }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 hover:border-violet-400"
        style={{
          borderColor: selected.color + '60',
          background: selected.color + '15',
          color: selected.color,
        }}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selected.color }} />
        {selected.name}
        <ChevronIcon />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 rounded-xl shadow-xl py-1 z-30 min-w-[160px]"
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        >
          {activities.map(a => (
            <button
              key={a.id}
              onClick={() => { setSelectedActId(a.id); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-black/5"
              style={{
                color: a.id === selectedActId ? a.color : 'var(--xp-txt)',
                fontWeight: a.id === selectedActId ? 600 : 400,
              }}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
              {a.name}
              {a.id === selectedActId && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ActivityBar() {
  const { activities, selectedActId, setSelectedActId, removeActivity, removingMode, setRemovingMode } = useApp()
  const [showAddModal, setShowAddModal] = useState(false)

  return (
    <>
      <div
        className="flex items-center gap-2 px-4 py-2 flex-wrap"
        style={{ background: 'var(--xp-bg2)', borderBottom: '0.5px solid var(--xp-bdr)' }}
      >
        {/* Label */}
        <span className="text-[10px] uppercase tracking-widest font-medium flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>
          Activities
        </span>

        {/* Add — purple */}
        <button
          onClick={() => { setRemovingMode(false); setShowAddModal(true) }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white transition-opacity hover:opacity-80 flex-shrink-0"
          style={{ background: '#7c3aed' }}
        >
          <PlusIcon /> Add
        </button>

        {/* Remove — danger outline */}
        <button
          onClick={() => setRemovingMode(!removingMode)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-150 flex-shrink-0"
          style={{
            background: removingMode ? '#fef2f2' : '#f3f4f6',
            color: removingMode ? '#ef4444' : '#6b7280',
            border: `1px solid ${removingMode ? '#fecaca' : '#e5e7eb'}`,
          }}
        >
          <MinusIcon /> Remove
        </button>

        <div className="w-px h-4 flex-shrink-0" style={{ background: 'var(--xp-bdr2)' }} />

        {/* Dropdown quick-select */}
        <ActivityDropdown />

        {/* Individual pills */}
        {activities.map(a => (
          <div key={a.id} className="relative flex-shrink-0">
            <div
              onClick={() => { if (!removingMode) setSelectedActId(a.id) }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-all duration-150 select-none"
              style={{
                color: a.color,
                background: 'var(--xp-bg3)',
                border: `1.5px solid ${a.id === selectedActId && !removingMode ? a.color : 'transparent'}`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
              {a.name}
            </div>

            {/* Minus badge in remove mode */}
            {removingMode && (
              <button
                onClick={() => removeActivity(a.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[11px] font-bold leading-none hover:bg-red-600 transition-colors shadow-sm z-10"
                aria-label={`Remove ${a.name}`}
              >
                −
              </button>
            )}
          </div>
        ))}
      </div>

      {showAddModal && <AddActivityModal onClose={() => setShowAddModal(false)} />}
    </>
  )
}
