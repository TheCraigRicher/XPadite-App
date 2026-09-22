'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { COLOR_PALETTE, normalizeHexColor } from './utils'
import { ColorPickerModal } from './ColorPickerModal'
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

// ─── Emoji categories — general-purpose ──────────────────────────────────────

const EMOJI_CATS = [
  // Recent: populated at runtime from localStorage; tab is a clock face
  { tab: '🕐', label: 'Recent', emojis: [] as string[] },
  {
    tab: '😀', label: 'Smileys',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😜','🤪','😝','🤑','🤗','🤔','😐','😑','😶','😏','😒','🙄','😬','😮','😲','😱','😳','🥺','😭','😢','😥','😤','😡','🤬','😔','😪','😴','🤩','😎','🤓','🧐','🥳','🤠','😈'],
  },
  {
    tab: '👋', label: 'People',
    emojis: ['👋','🤚','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','👍','👎','✊','👊','👏','🙌','🤝','🙏','💪','🦾','👀','👁️','👄','🫦','💋','🫶','❤️‍🔥','🤲','👐','🤜','🤛','🖐️','☝️','🤙','💅','🧠','🫀','🫁','🦷','🦴','🦿','🦽'],
  },
  {
    tab: '🐶', label: 'Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦋','🐝','🐢','🐍','🐠','🐟','🐬','🐋','🦈','🐙','🦑','🐾','🌹','🌺','🌸','🌼','🌻','🍀','🌴','🌵','🍄','🌈','☀️','🌙','🌊','🔥','💧','⛄','🌍'],
  },
  {
    tab: '🍔', label: 'Food',
    emojis: ['🍕','🍔','🌮','🌯','🥙','🍳','🥞','🥓','🍗','🍖','🌭','🍟','🧀','🍱','🍣','🍜','🍝','🥗','🍦','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🫖','🧃','🥤','🍺','🍻','🥂','🍷','🍸','🍹','🧋','🥛','🍼','🌽','🥕','🧄','🧅','🥑','🍇','🍓','🍒','🍑','🍋'],
  },
  {
    tab: '⚽', label: 'Activity',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','⛷️','🏊','🚣','🧘','🚵','🏄','🏋️','🥊','🥋','🎯','🎳','🎮','🕹️','🎲','♟️','🧩','🧸','🎨','🎭','🎵','🎶','🎸','🎹','🎺','🎻','🥁','🎤','🎧','🎬','🎡','🎢','🎪','🏆','🥇','🥈','🥉','🎫','🎟️','🎉'],
  },
  {
    tab: '✈️', label: 'Travel',
    emojis: ['✈️','🚗','🚕','🚌','🚑','🚒','🚓','🚚','🏎️','🏍️','🛵','🚲','🛴','🚤','🛥️','🚢','🚁','🚀','🛸','🏔️','⛰️','🌋','🏕️','🏖️','🏝️','🏛️','🏙️','🗼','🗽','⛪','🕌','⛩️','🌁','🌃','🌄','🌅','🌆','🌇','🌉','🌌','🛣️','🗺️','🧭','⛺','🏟️','🏯','🏰'],
  },
  {
    tab: '💼', label: 'Work',
    emojis: ['💻','🖥️','📱','⌨️','📂','📊','📈','📝','✏️','🔬','🎯','💡','🔑','💼','📋','🗂️','📞','📎','📌','🔧','🔩','⚙️','🔒','🔓','💰','💵','💸','💳','💹','📡','🔭','🩺','🧬','🏥','📚','📖','🖊️','📐','📏','🗃️','🗑️','🖨️','📷','📸','🎥','📻','📺','⌚','📡'],
  },
  {
    tab: '❤️', label: 'Symbols',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💞','💓','💗','💖','💘','💝','💟','✨','⭐','🌟','💫','🔥','✅','❌','❓','❗','💯','♻️','🔰','⚜️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🎁','💎','🏅','🎖️','🚩','🏳️','☮️','🕊️','🌐','🔮','💠'],
  },
]

// localStorage recent emoji helpers
const RECENT_KEY = 'xp9-recent-emojis'
const MAX_RECENT = 24

function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch { return [] }
}

function saveRecentEmoji(emoji: string): void {
  try {
    const list = getRecentEmojis().filter(e => e !== emoji)
    list.unshift(emoji)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
  } catch {}
}

// ─── Inline emoji picker — general-purpose with horizontal scroll category bar ─

function InlineEmojiPicker({ onSelect, onClear }: { onSelect: (e: string) => void; onClear: () => void }) {
  const [recents, setRecents] = useState<string[]>([])
  const [cat, setCat] = useState(1) // start on Smileys; switches to 0 when recents exist

  useEffect(() => {
    const r = getRecentEmojis()
    setRecents(r)
    if (r.length > 0) setCat(0)
  }, [])

  function handleSelect(emoji: string) {
    saveRecentEmoji(emoji)
    onSelect(emoji)
  }

  const cats = EMOJI_CATS.map((c, i) => i === 0 ? { ...c, emojis: recents } : c)
  const currentEmojis = cats[cat].emojis

  return (
    <div
      className="mt-2 rounded-xl overflow-hidden"
      style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
    >
      {/* Category bar — horizontally scrollable, hides scrollbar */}
      <div
        className="flex items-center p-1.5 gap-0.5"
        style={{
          borderBottom: '0.5px solid var(--xp-bdr)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {cats.map((c, i) => {
          // Hide Recent tab when no recents exist
          if (i === 0 && recents.length === 0) return null
          return (
            <button
              key={i}
              type="button"
              onClick={() => setCat(i)}
              title={c.label}
              className="flex-shrink-0 w-8 h-7 rounded-lg text-base flex items-center justify-center transition-all"
              style={{ background: cat === i ? 'rgba(124,58,237,0.12)' : 'transparent' }}
            >
              {c.tab}
            </button>
          )
        })}
        {/* Spacer to push X to the right */}
        <div className="flex-1 min-w-[4px]" />
        <button
          type="button"
          onClick={onClear}
          title="No emoji"
          className="flex-shrink-0 w-7 h-7 rounded-lg text-[11px] flex items-center justify-center hover:opacity-70"
          style={{ color: '#9ca3af' }}
        >
          ✕
        </button>
      </div>

      {/* Emoji grid — independently scrollable */}
      <div className="grid grid-cols-6 gap-0.5 p-2 overflow-y-auto" style={{ maxHeight: 160 }}>
        {currentEmojis.length === 0 ? (
          <p className="col-span-6 text-center py-4 text-xs" style={{ color: 'var(--xp-txt3)' }}>
            No recent emojis yet.
          </p>
        ) : (
          currentEmojis.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => handleSelect(e)}
              className="aspect-square rounded-lg text-xl flex items-center justify-center transition-colors"
            >
              {e}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ─── ActivityForm ─────────────────────────────────────────────────────────────

interface ActivityFormProps {
  initial?: { name: string; color: string; emoji: string }
  onSave: (name: string, color: string, emoji: string) => void
  onCancel: () => void
  saveLabel: string
}

function ActivityForm({ initial, onSave, onCancel, saveLabel }: ActivityFormProps) {
  const { customColors, addCustomColor, removeCustomColor, setToast } = useApp()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? COLOR_PALETTE[0])
  const [emoji, setEmoji] = useState(initial?.emoji ?? '')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const normalizedColor = normalizeHexColor(color)
  const isSavedCustom = customColors.some(c => normalizeHexColor(c) === normalizedColor)
  const isPreset = (COLOR_PALETTE as readonly string[]).some(c => normalizeHexColor(c) === normalizedColor)
  // The rainbow swatch shows the live color only while it's custom AND not
  // already represented by one of the saved swatches below it.
  const isCustomColor = !isPreset && !isSavedCustom

  function clearLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }
  function startLongPress(hex: string) {
    clearLongPress()
    longPressTimer.current = setTimeout(() => removeCustomColor(hex), 550)
  }

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

      {/* Emoji — single button trigger + inline picker */}
      <div>
        <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Emoji (optional)</label>
        <button
          type="button"
          onClick={() => setShowEmojiPicker(s => !s)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm w-full text-left transition-all"
          style={{
            background: emoji ? 'rgba(124,58,237,0.06)' : 'var(--xp-card)',
            border: `0.5px solid ${emoji ? 'rgba(124,58,237,0.35)' : 'var(--xp-bdr2)'}`,
            color: 'var(--xp-txt)',
          }}
        >
          <span className="text-xl w-6 text-center leading-none flex-shrink-0">{emoji || '🙂'}</span>
          <span className="text-xs flex-1" style={{ color: 'var(--xp-txt3)' }}>
            {emoji ? 'Change emoji' : 'Pick an emoji'}
          </span>
          {emoji && (
            <span
              role="button"
              onClick={ev => { ev.stopPropagation(); setEmoji(''); setShowEmojiPicker(false) }}
              className="text-[11px] flex-shrink-0 hover:opacity-70 cursor-pointer"
              style={{ color: '#9ca3af' }}
            >
              ✕
            </span>
          )}
        </button>
        {showEmojiPicker && (
          <InlineEmojiPicker
            onSelect={e => { setEmoji(e); setShowEmojiPicker(false) }}
            onClear={() => { setEmoji(''); setShowEmojiPicker(false) }}
          />
        )}
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
          {/* Custom color — shows the exact custom color when one is active (and unsaved), otherwise a neutral rainbow swatch */}
          <button
            type="button"
            onClick={() => setShowColorPicker(true)}
            title="Custom color"
            className="w-6 h-6 rounded-full transition-all flex-shrink-0"
            style={{
              background: isCustomColor ? color : 'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
              transform: isCustomColor ? 'scale(1.2)' : 'scale(1)',
              boxShadow: isCustomColor ? `0 0 0 2px var(--xp-card), 0 0 0 3.5px ${color}` : 'none',
            }}
          />
        </div>
      </div>

      {/* Saved custom colors — only shown once the user has at least one */}
      {customColors.length > 0 && (
        <div>
          <label className="block text-[10px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Custom</label>
          <div className="flex flex-wrap gap-2">
            {customColors.map(c => {
              const selected = normalizeHexColor(c) === normalizedColor
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  onContextMenu={e => { e.preventDefault(); removeCustomColor(c) }}
                  onPointerDown={() => startLongPress(c)}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  title="Click to use — right-click or long-press to remove"
                  className="w-6 h-6 rounded-full transition-all flex-shrink-0"
                  style={{
                    background: c,
                    transform: selected ? 'scale(1.2)' : 'scale(1)',
                    boxShadow: selected ? `0 0 0 2px var(--xp-card), 0 0 0 3.5px ${c}` : 'none',
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {showColorPicker && (
        <ColorPickerModal
          initialColor={color}
          onCancel={() => setShowColorPicker(false)}
          onApply={hex => {
            setColor(hex)
            setShowColorPicker(false)
            if (!addCustomColor(hex)) {
              setToast('Custom color limit reached. Remove a saved color to add another.')
            }
          }}
        />
      )}

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

// ─── Shared purple header ─────────────────────────────────────────────────────

function PurpleHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4 flex-shrink-0"
      style={{
        background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)',
        borderBottom: '0.5px solid rgba(255,255,255,0.12)',
      }}
    >
      {children}
    </div>
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
  const [isMobile, setIsMobile] = useState(false)

  // Client-side mobile detection (matches Tailwind sm: breakpoint = 640px)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Lock body scroll while any modal layer is open; release on unmount
  useLockBodyScroll()

  // Escape key: close innermost layer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode !== 'list') setMode('list')
        else onClose()
      }
    }
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

  /*
   * On mobile, 'add' mode opens a second overlay sheet ABOVE the main panel
   * so Activity Manager stays visible (dimmed) underneath.
   * On desktop, 'add' mode replaces the main panel content as before.
   */
  const isAddSheetOpen = mode === 'add' && isMobile

  // Which content to show in the main panel body
  const showAddInMain     = mode === 'add' && !isMobile
  const showEditInMain    = mode === 'edit' && !!editTarget
  const showConfirmInMain = mode === 'confirm-remove' && !!selectedAct

  // Main panel header title
  const mainHeaderTitle =
    mode === 'edit' ? 'Edit Activity'
    : mode === 'confirm-remove' ? 'Remove Activity'
    : 'Activities'  // 'list' and mobile 'add' both show 'Activities'

  return (
    <>
      {/*
       * ── Primary overlay + Activity Manager panel ─────────────────────────
       *
       * Mobile: overlay stops 56px above screen bottom (bottom-14) so the
       * fixed bottom nav (z-50, 56px tall) remains visible and tappable.
       * Card fills full overlay height (h-full) → top-to-bottom coverage.
       *
       * Desktop (sm+): full-viewport overlay, centered modal card.
       */}
      <div
        className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={mode === 'list' ? onClose : undefined}
      >
        <div
          className="w-full h-full sm:h-auto sm:max-w-[420px] sm:max-h-[88vh] sm:rounded-2xl flex flex-col overflow-hidden"
          style={{
            background: 'var(--xp-card)',
            border: '0.5px solid var(--xp-bdr2)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Purple header */}
          <PurpleHeader>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'white' }}>
                {mainHeaderTitle}
              </h2>
              {(mode === 'list' || isAddSheetOpen) && (
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  {activities.length} {activities.length === 1 ? 'activity' : 'activities'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mode === 'list' && (
                <button
                  onClick={() => setMode('add')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-85"
                  style={{ background: 'rgba(255,255,255,0.18)', color: 'white', border: '0.5px solid rgba(255,255,255,0.28)' }}
                >
                  <PlusIcon /> Add
                </button>
              )}
              <button
                onClick={() => {
                  // When add sheet is open on mobile, the backdrop handles close — guard here
                  if (isAddSheetOpen) return
                  if (mode !== 'list') setMode('list')
                  else onClose()
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
              >
                {(mode !== 'list' && !isAddSheetOpen) ? '←' : '✕'}
              </button>
            </div>
          </PurpleHeader>

          {/*
           * Scrollable body — locked when the add sheet is open above it on
           * mobile so the list doesn't scroll through the backdrop overlay.
           */}
          <div
            className="px-5 py-4 flex-1"
            style={{ overflowY: isAddSheetOpen ? 'hidden' : 'auto' }}
          >
            {/* Add form (desktop only — mobile uses the sheet below) */}
            {showAddInMain && (
              <ActivityForm
                saveLabel="Add Activity"
                onSave={handleAdd}
                onCancel={() => setMode('list')}
              />
            )}

            {/* Edit form */}
            {showEditInMain && (
              <ActivityForm
                initial={{ name: editTarget!.name, color: editTarget!.color, emoji: editTarget!.emoji ?? '' }}
                saveLabel="Save Changes"
                onSave={handleEdit}
                onCancel={() => { setMode('list'); setEditTarget(null) }}
              />
            )}

            {/* Remove confirm */}
            {showConfirmInMain && (
              <div className="text-center space-y-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(239,68,68,0.1)' }}>
                  <TrashIcon />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>Remove &ldquo;{selectedAct!.name}&rdquo;?</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--xp-txt3)' }}>Past sessions and data remain intact.</p>
                </div>
                {activeSession?.actId === selectedAct!.id && (
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
                    disabled={activeSession?.actId === selectedAct!.id}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-85"
                    style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            {/* Activity list — shows when list mode, or mobile add-sheet mode */}
            {!showAddInMain && !showEditInMain && !showConfirmInMain && (
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
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: act.color }} />

                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block" style={{ color: 'var(--xp-txt)' }}>
                            {act.emoji ? `${act.emoji} ` : ''}{act.name}
                          </span>
                          {isActive && (
                            <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>● Active session</span>
                          )}
                        </div>

                        {isSelected && (
                          <span className="text-[11px] font-bold flex-shrink-0" style={{ color: '#7c3aed' }}>✓</span>
                        )}

                        <button
                          onClick={e => { e.stopPropagation(); setEditTarget(act); setMode('edit') }}
                          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-70"
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}
                          aria-label={`Edit ${act.name}`}
                        >
                          <EditIcon />
                        </button>

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

      {/*
       * ── Mobile Add Activity sheet ────────────────────────────────────────
       *
       * Renders ABOVE the Activity Manager panel (z-[80] > z-[70]).
       * The backdrop uses blur + dim to subdue Activity Manager without
       * hiding it — communicating that Add Activity is a child action.
       * Activity Manager list scroll is locked (overflow: hidden above)
       * and body scroll is locked via the mount effect.
       * Clicking the backdrop dismisses the sheet and returns to the list.
       */}
      {isAddSheetOpen && (
        <div
          className="fixed inset-x-0 top-0 bottom-14 z-[80] flex items-end"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
          onClick={() => setMode('list')}
        >
          <div
            className="w-full rounded-t-2xl flex flex-col overflow-hidden"
            style={{
              background: 'var(--xp-card)',
              border: '0.5px solid var(--xp-bdr2)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
              maxHeight: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Purple header with back arrow */}
            <PurpleHeader>
              <h2 className="text-sm font-semibold" style={{ color: 'white' }}>Add Activity</h2>
              <button
                onClick={() => setMode('list')}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
                aria-label="Back to activities"
              >
                ←
              </button>
            </PurpleHeader>

            {/* Scrollable form body */}
            <div className="overflow-y-auto flex-1 px-5 py-4">
              <ActivityForm
                saveLabel="Add Activity"
                onSave={handleAdd}
                onCancel={() => setMode('list')}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
