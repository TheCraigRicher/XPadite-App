'use client'

import { useState } from 'react'
import { useApp } from './AppContext'
import { COLOR_PALETTE } from './utils'
import type { Activity } from './types'

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5">
    <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
)

const MinusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5">
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
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
      <div className="bg-white rounded-2xl p-5 w-full max-w-[280px] shadow-xl border border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Add Activity</h3>

        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Coding, Gym…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:border-violet-500 mb-4 transition-colors"
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
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-xs text-white rounded-lg transition-opacity hover:opacity-80"
            style={{ background: '#7c3aed' }}
          >
            Add
          </button>
        </div>
      </div>
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
        <span
          className="text-[10px] uppercase tracking-widest font-medium flex-shrink-0"
          style={{ color: 'var(--xp-txt3)' }}
        >
          Activities
        </span>

        {/* Activity pills */}
        {activities.map(a => (
          <div
            key={a.id}
            onClick={() => { if (!removingMode) setSelectedActId(a.id) }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-all duration-150 select-none"
            style={{
              color: a.color,
              background: 'var(--xp-bg3)',
              border: `1.5px solid ${a.id === selectedActId && !removingMode ? a.color : 'transparent'}`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: a.color }}
            />
            {a.name}
            {removingMode && (
              <button
                onClick={e => { e.stopPropagation(); removeActivity(a.id) }}
                className="ml-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px] leading-none font-bold hover:bg-red-600 transition-colors"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Add button */}
        <button
          onClick={() => { setRemovingMode(false); setShowAddModal(true) }}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-dashed transition-colors hover:border-violet-500 hover:text-violet-500"
          style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
        >
          <PlusIcon /> Add
        </button>

        {/* Remove mode toggle — pill with minus */}
        <button
          onClick={() => setRemovingMode(!removingMode)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all duration-150"
          style={{
            borderColor: removingMode ? '#ef4444' : 'var(--xp-bdr2)',
            color: removingMode ? '#ef4444' : 'var(--xp-txt3)',
            background: removingMode ? '#fef2f2' : 'transparent',
          }}
        >
          <MinusIcon /> Remove
        </button>
      </div>

      {showAddModal && <AddActivityModal onClose={() => setShowAddModal(false)} />}
    </>
  )
}
