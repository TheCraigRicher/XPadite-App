'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'
import { COLOR_PALETTE } from './utils'
import type { Activity } from './types'

// ─── Icons ────────────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
    <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
  </svg>
)

const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
    <polyline points="3 6 5 6 21 6" strokeLinecap="round" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Inline form for Add / Edit ───────────────────────────────────────────────

const EMOJI_PRESETS = ['💻', '🎯', '💪', '📚', '🎨', '☕', '🏃', '🧘', '✍️', '🔬', '🎵', '🌱', '💰', '🏠', '✈️']

interface ActivityFormProps {
  initial?: { name: string; color: string; emoji: string }
  onSave: (name: string, color: string, emoji: string) => void
  onCancel: () => void
  saveLabel: string
}

function ActivityForm({ initial, onSave, onCancel, saveLabel }: ActivityFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? COLOR_PALETTE[0])
  const [emoji, setEmoji] = useState(initial?.emoji ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed, color, emoji)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
      {/* Name */}
      <div>
        <label className="block text-[10px] font-semibold mb-1" style={{ color: 'var(--xp-txt3)' }}>Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Activity name"
          maxLength={24}
          autoFocus
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}
        />
      </div>

      {/* Emoji presets */}
      <div>
        <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Emoji (optional)</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setEmoji('')}
            className="w-7 h-7 rounded-lg text-xs flex items-center justify-center transition-all"
            style={{
              background: !emoji ? 'rgba(124,58,237,0.15)' : 'var(--xp-card)',
              border: `0.5px solid ${!emoji ? 'rgba(124,58,237,0.4)' : 'var(--xp-bdr)'}`,
              color: 'var(--xp-txt3)',
            }}
          >
            —
          </button>
          {EMOJI_PRESETS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className="w-7 h-7 rounded-lg text-base flex items-center justify-center transition-all"
              style={{
                background: emoji === e ? 'rgba(124,58,237,0.15)' : 'var(--xp-card)',
                border: `0.5px solid ${emoji === e ? 'rgba(124,58,237,0.4)' : 'var(--xp-bdr)'}`,
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Color palette */}
      <div>
        <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Color</label>
        <div className="flex flex-wrap gap-2">
          {COLOR_PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-6 h-6 rounded-full transition-all flex-shrink-0"
              style={{
                background: c,
                transform: color === c ? 'scale(1.2)' : 'scale(1)',
                boxShadow: color === c ? `0 0 0 2px var(--xp-card), 0 0 0 3.5px ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-70"
          style={{ background: 'var(--xp-bg)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-85"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
        >
          {saveLabel}
        </button>
      </div>
    </form>
  )
}

// ─── ActivityManagerModal ─────────────────────────────────────────────────────

interface ActivityManagerModalProps {
  onClose: () => void
}

export function ActivityManagerModal({ onClose }: ActivityManagerModalProps) {
  const { activities, addActivity, removeActivity, updateActivity, selectedActId, setSelectedActId, activeSession } = useApp()
  const [mode, setMode] = useState<'list' | 'add' | 'edit' | 'confirm-remove'>('list')
  const [editTarget, setEditTarget] = useState<Activity | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (mode !== 'list') setMode('list'); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onClose])

  const selectedAct = activities.find(a => a.id === selectedActId) ?? activities[0] ?? null

  function handleAdd(name: string, color: string, emoji: string) {
    addActivity({ id: 'a' + Date.now(), name, color, emoji: emoji || undefined })
    setMode('list')
  }

  function handleEdit(name: string, color: string, emoji: string) {
    if (!editTarget) return
    updateActivity(editTarget.id, { name, color, emoji: emoji || undefined })
    setMode('list')
    setEditTarget(null)
  }

  function handleRemoveConfirm() {
    if (!selectedAct) return
    if (activeSession?.actId === selectedAct.id) return
    removeActivity(selectedAct.id)
    setMode('list')
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={mode === 'list' ? onClose : undefined}
    >
      <div
        className="w-full sm:max-w-[420px] sm:rounded-2xl rounded-t-2xl"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 sticky top-0"
          style={{ background: 'var(--xp-card)', borderBottom: '0.5px solid var(--xp-bdr)', zIndex: 1 }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>
              {mode === 'add' ? 'Add Activity' : mode === 'edit' ? 'Edit Activity' : mode === 'confirm-remove' ? 'Remove Activity' : 'Activities'}
            </h2>
            {mode === 'list' && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
                {activities.length} {activities.length === 1 ? 'activity' : 'activities'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === 'list' && (
              <button
                onClick={() => setMode('add')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
                style={{ background: '#7c3aed' }}
              >
                <PlusIcon /> Add
              </button>
            )}
            <button
              onClick={() => { if (mode !== 'list') setMode('list'); else onClose() }}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
              style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
            >
              {mode !== 'list' ? '←' : '✕'}
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {/* Add form */}
          {mode === 'add' && (
            <ActivityForm
              saveLabel="Add Activity"
              onSave={handleAdd}
              onCancel={() => setMode('list')}
            />
          )}

          {/* Edit form */}
          {mode === 'edit' && editTarget && (
            <ActivityForm
              initial={{ name: editTarget.name, color: editTarget.color, emoji: editTarget.emoji ?? '' }}
              saveLabel="Save Changes"
              onSave={handleEdit}
              onCancel={() => { setMode('list'); setEditTarget(null) }}
            />
          )}

          {/* Remove confirm */}
          {mode === 'confirm-remove' && selectedAct && (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <TrashIcon />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>Remove &ldquo;{selectedAct.name}&rdquo;?</p>
                <p className="text-xs mt-1" style={{ color: 'var(--xp-txt3)' }}>Past sessions and data remain intact.</p>
              </div>
              {activeSession?.actId === selectedAct.id && (
                <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                  Cannot remove — this activity has an active session. Clock out first.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('list')}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
                  style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemoveConfirm}
                  disabled={activeSession?.actId === selectedAct.id}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-85"
                  style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* Activity list */}
          {mode === 'list' && (
            <div className="space-y-2">
              {activities.length === 0 ? (
                <p className="text-center py-8 text-sm" style={{ color: 'var(--xp-txt3)' }}>
                  No activities yet. Tap &ldquo;Add&rdquo; to create one.
                </p>
              ) : (
                activities.map(act => {
                  const isSelected = act.id === (selectedActId ?? activities[0]?.id)
                  const isActive = activeSession?.actId === act.id
                  return (
                    <div
                      key={act.id}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150"
                      style={{
                        background: isSelected ? 'rgba(124,58,237,0.08)' : 'var(--xp-bg3)',
                        border: `0.5px solid ${isSelected ? 'rgba(124,58,237,0.3)' : 'var(--xp-bdr)'}`,
                      }}
                      onClick={() => setSelectedActId(act.id)}
                    >
                      {/* Color dot */}
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: act.color }} />

                      {/* Name + active badge */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: 'var(--xp-txt)' }}>
                          {act.emoji ? `${act.emoji} ` : ''}{act.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>● Active session</span>
                        )}
                      </div>

                      {/* Selected checkmark */}
                      {isSelected && (
                        <span className="text-[11px] font-bold flex-shrink-0" style={{ color: '#7c3aed' }}>✓</span>
                      )}

                      {/* Edit button */}
                      <button
                        onClick={e => { e.stopPropagation(); setEditTarget(act); setMode('edit') }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-70"
                        style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
                        aria-label={`Edit ${act.name}`}
                      >
                        <EditIcon />
                      </button>

                      {/* Remove button */}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedActId(act.id); setMode('confirm-remove') }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-70"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
                        aria-label={`Remove ${act.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
