'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useApp, EMPTY_DAY } from './AppContext'
import type { Task, TaskSession } from './types'
import { formatMs, formatHMS, formatTime, APP_YEAR } from './utils'
import { ReminderModal } from './ReminderModal'

// ─── Recent-emoji localStorage helpers ───────────────────────────────────────

const RECENT_KEY = 'xp9e'

function getRecentEmojis(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}

function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...getRecentEmojis().filter(e => e !== emoji)].slice(0, 20)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

// ─── Expanded emoji dataset ───────────────────────────────────────────────────

const EMOJI_CATS = [
  { key: 'recent',     icon: '🕐', name: 'Recent',     emojis: [] as string[] },
  { key: 'smileys',   icon: '😊', name: 'Smileys',
    emojis: ['😊','😄','😂','🤣','😍','🥰','😎','🤩','😅','🥺','😱','🤔','😢','😡','🥳','😮','🤯','😤','🙄','😪','🤗','😇','😆','😁','😀','😏','😌','😋','😛','🤑','😞','😔','😟','😕','🤨','🧐','🥸','😒','😑','😶'],
  },
  { key: 'hands',     icon: '👍', name: 'Hands',
    emojis: ['👍','👎','👋','✌️','🤞','💪','🙏','🤝','✋','☝️','👆','👇','👌','🤙','💅','✍️','🫶','🤜','👊','✊','👏','🙌','👐','🤲','🤘','🖖','🫵','🤛','🫸','🫷','🖐️','🤏','🫂','🧑','👶','🧒','👦','👧','🧑‍💻','👩‍💼'],
  },
  { key: 'animals',   icon: '🐶', name: 'Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🦋','🐝','🐛','🦎','🐢','🐍','🦅','🦆','🦉','🦚','🦜','🐬','🐳','🐋','🦈','🐙','🦑','🦀','🦞','🐠','🐟','🐡'],
  },
  { key: 'food',      icon: '🍎', name: 'Food',
    emojis: ['🍎','🍊','🍋','🍇','🍓','🍑','🍒','🍌','🍉','🥝','🍅','🥑','🥦','🥕','🌽','🍕','🍔','🌮','🌯','🥗','🍜','🍣','🍱','🍿','🍰','🎂','🍩','🍪','🧁','☕','🍵','🧃','🥤','🍺','🥂','🍾','🧊','🥞','🥓','🍳'],
  },
  { key: 'activities',icon: '🎯', name: 'Activities',
    emojis: ['🎯','🚀','💡','⚡','✅','🔥','🏆','💼','📝','📊','📈','💻','📱','📅','🔑','⚙️','🛠️','📌','🎉','💯','🎵','🎮','⚽','🏀','🎸','🎨','✏️','📚','🔬','🏋️','🧘','🎭','🎪','⛷️','🏊','🚴','🧗','🎲','🃏','🎰'],
  },
  { key: 'travel',    icon: '✈️', name: 'Travel',
    emojis: ['✈️','🚀','🏠','🏡','🏢','🌍','🌎','🌏','🗺️','🏔️','⛰️','🌋','🏖️','🏝️','🌊','🌅','🌄','🌠','⛺','🏕️','🚗','🚕','🚌','🚢','⛵','🏍️','🚁','🛶','🗽','🗼','🏯','🎡','🎢','🎠','🚦','🚧','⛽','🛣️','🌃','🌆'],
  },
  { key: 'objects',   icon: '💡', name: 'Objects',
    emojis: ['💡','🔦','📱','💻','🖥️','⌨️','🖱️','📷','📸','📹','🎥','📺','📻','🎙️','🔋','🔌','💾','💿','📀','🗂️','📁','📂','📋','📌','📍','🔒','🔓','🔑','🗝️','🔨','⚙️','🔧','🛠️','🔩','💊','🩺','🔭','🧪','🧬','🧲'],
  },
  { key: 'symbols',   icon: '❤️', name: 'Symbols',
    emojis: ['❤️','💛','💚','💙','💜','🖤','🤍','💔','✨','🌟','⭐','💫','🎆','🎇','🔮','🔔','💐','🎊','♾️','⚡','🔴','🟢','🔵','🟣','🟡','🟠','⚪','⚫','♻️','🆘','⚠️','🔱','☮️','✡️','☯️','🔯','✝️','☪️','🕉️','☮️'],
  },
  { key: 'flags',     icon: '🏳️', name: 'Flags',
    emojis: ['🏳️','🏴','🚩','🏁','🎌','🏳️‍🌈','🏳️‍⚧️','🇺🇸','🇬🇧','🇨🇦','🇦🇺','🇩🇪','🇫🇷','🇯🇵','🇰🇷','🇨🇳','🇮🇳','🇧🇷','🇲🇽','🇮🇹','🇪🇸','🇳🇱','🇷🇺','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇮🇪','🇵🇹','🇵🇱','🇺🇦','🇹🇷','🇦🇷','🇿🇦','🇳🇿','🇸🇬','🇦🇪','🇮🇱','🇸🇦','🇨🇭'],
  },
]

// ─── Task helpers ─────────────────────────────────────────────────────────────

function deduplicateTaskSessions(sessions: TaskSession[]): TaskSession[] {
  const completed = sessions.filter(s => s.endTs !== null)
  const running   = sessions.filter(s => s.endTs === null)
  if (completed.length <= 1) return sessions
  const sorted = [...completed].sort((a, b) => (b.endTs! - b.startTs) - (a.endTs! - a.startTs))
  const kept: TaskSession[] = []
  for (const s of sorted) {
    if (!kept.some(k => k.startTs <= s.startTs && s.endTs! <= k.endTs!)) kept.push(s)
  }
  return [...kept.sort((a, b) => a.startTs - b.startTs), ...running]
}

function getTaskTotalMs(task: Task, isActive: boolean, now: number): number {
  const sessions = task.sessions ?? []
  let total = sessions.reduce((acc, s) => {
    if (s.endTs) return acc + (s.endTs - s.startTs)
    if (isActive && s.endTs === null) return acc + (now - s.startTs)
    return acc
  }, 0)
  if (total === 0 && task.timerStart) {
    const end = task.timerEnd ?? (isActive ? now : null)
    if (end) total = end - task.timerStart
  }
  return total
}

function getRunningSession(task: Task): TaskSession | null {
  return (task.sessions ?? []).find(s => s.endTs === null) ?? null
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function ConfettiPop({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t) }, [onDone])
  const COLORS = ['#f97316','#7c3aed','#22d3ee','#4ade80','#fbbf24','#f472b6','#a78bfa','#34d399','#fb7185','#60a5fa']
  const particles = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * 360 + (Math.random() * 20 - 10)
    const dist  = 55 + Math.random() * 60
    const rad   = (angle * Math.PI) / 180
    return { color: COLORS[i % COLORS.length], tx: Math.cos(rad) * dist, ty: Math.sin(rad) * dist - 20, rot: Math.random() * 540 - 270, size: 4 + Math.random() * 5, delay: Math.random() * 0.15, isRect: i % 3 !== 0 }
  })
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', width: p.size, height: p.isRect ? p.size * 2.2 : p.size, borderRadius: p.isRect ? 2 : '50%', background: p.color, ['--tx' as string]: `${p.tx}px`, ['--ty' as string]: `${p.ty}px`, ['--rot' as string]: `${p.rot}deg`, animation: `xp-confetti 1.3s ${p.delay}s cubic-bezier(0.2,0.8,0.4,1) forwards` } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><polygon points="5 3 19 12 5 21 5 3" /></svg>
const StopIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
const DotsIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>

const GENERATED_TASKS = [
  'Complete morning planning and set daily priorities',
  'Focus on primary work goal for 2+ hours uninterrupted',
  'Review progress and document key learnings',
]

// ─── Adjust Time Modal ────────────────────────────────────────────────────────

interface AdjustTimeProps {
  task: Task
  dateKey: string
  onClose: () => void
  onSave: (sessionId: string | null, startTs: number, endTs: number, note: string) => void
}

function AdjustTimeModal({ task, dateKey, onClose, onSave }: AdjustTimeProps) {
  const runningSession  = getRunningSession(task)
  const lastSession     = task.sessions?.findLast?.(s => s.endTs !== null) ?? null
  const editingSession  = runningSession ?? lastSession

  function tsToInput(ts: number | null): string {
    if (!ts) return ''
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
  function inputToTs(val: string, baseTs: number): number {
    const [h, m] = val.split(':').map(Number)
    const d = new Date(baseTs); d.setHours(h, m, 0, 0); return d.getTime()
  }

  const baseTs: number = editingSession?.startTs ?? task.timerStart ?? (() => {
    const [y, mo, d] = dateKey.split('-').map(Number); return new Date(y, mo, d).getTime()
  })()

  const sessionId = editingSession?.id ?? null
  const [startVal, setStartVal] = useState(tsToInput(editingSession?.startTs ?? null))
  const [endVal,   setEndVal]   = useState(editingSession?.endTs != null ? tsToInput(editingSession.endTs) : (runningSession ? tsToInput(Date.now()) : ''))
  const [noteVal,  setNoteVal]  = useState('')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-[320px] rounded-2xl shadow-2xl p-5" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>Adjust Session</h3>
        <p className="text-[10px] mb-4" style={{ color: 'var(--xp-txt3)' }}>{task.text}</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>Start Time</label>
            <input type="time" value={startVal} onChange={e => setStartVal(e.target.value)} className="w-full text-xs px-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
          </div>
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>End Time</label>
            <input type="time" value={endVal} onChange={e => setEndVal(e.target.value)} className="w-full text-xs px-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
          </div>
        </div>
        {startVal && endVal && (() => { const sTs = inputToTs(startVal, baseTs); let eTs = inputToTs(endVal, baseTs); if (eTs <= sTs) eTs += 86_400_000; return <p className="text-[10px] mb-3" style={{ color: 'var(--xp-txt3)' }}>Duration: {formatMs(Math.max(0, eTs - sTs))}</p> })()}
        <div className="mb-4">
          <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>Reason (optional)</label>
          <input type="text" value={noteVal} onChange={e => setNoteVal(e.target.value)} placeholder="Why are you adjusting this time?" className="w-full text-xs px-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5" style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>Cancel</button>
          <button onClick={() => { if (startVal && endVal) { const sTs = inputToTs(startVal, baseTs); let eTs = inputToTs(endVal, baseTs); if (eTs <= sTs) eTs += 86_400_000; onSave(sessionId, sTs, eTs, noteVal); onClose() } }} className="text-xs px-5 py-1.5 rounded-full text-white hover:opacity-80" style={{ background: '#7c3aed' }}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── Task 3-dot Menu ──────────────────────────────────────────────────────────

interface TaskMenuProps { onAdjustTime: () => void; onDuplicate: () => void; onDelete: () => void; onSetReminder: () => void; onClose: () => void }

function TaskMenu({ onAdjustTime, onDuplicate, onDelete, onSetReminder, onClose }: TaskMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', onClick), 10)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const items = [
    { icon: '🔔', label: 'Set Reminder',   action: onSetReminder },
    { icon: '🕒', label: 'Adjust Time',    action: onAdjustTime  },
    { icon: '📄', label: 'Duplicate Task', action: onDuplicate   },
    { icon: '🗑',  label: 'Delete Task',   action: onDelete, danger: true },
  ]
  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden z-10" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', minWidth: 162 }}>
      {items.map(item => (
        <button key={item.label} onClick={() => { item.action(); onClose() }} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs transition-colors hover:bg-black/5" style={{ color: item.danger ? '#ef4444' : 'var(--xp-txt)' }}>
          <span className="text-sm">{item.icon}</span>{item.label}
        </button>
      ))}
    </div>
  )
}

// ─── WhatsApp-style Emoji Picker ──────────────────────────────────────────────

function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const [catKey,  setCatKey]  = useState('smileys')
  const [search,  setSearch]  = useState('')
  const [recents, setRecents] = useState<string[]>(() => getRecentEmojis())
  const ref                   = useRef<HTMLDivElement>(null)
  const searchRef             = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', onDown), 10)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  useEffect(() => { searchRef.current?.focus() }, [])

  function handleSelect(emoji: string) {
    const next = pushRecentEmoji(emoji)
    setRecents(next)
    onSelect(emoji)
    onClose()
  }

  // Resolve display list
  const allEmojis = EMOJI_CATS.flatMap(c => c.key === 'recent' ? [] : c.emojis)
  const currentCat = EMOJI_CATS.find(c => c.key === catKey)!
  const displayList = search.trim()
    ? allEmojis
    : catKey === 'recent'
      ? (recents.length > 0 ? recents : allEmojis.slice(0, 40))
      : currentCat.emojis

  return (
    <div ref={ref} className="absolute bottom-full right-0 mb-1.5 rounded-2xl z-30 flex flex-col overflow-hidden" style={{ width: 288, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 12px 40px rgba(0,0,0,0.22),0 4px 12px rgba(0,0,0,0.10)' }}>
      {/* Search */}
      <div className="px-2.5 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--xp-bg2)', border: '1px solid var(--xp-bdr)' }}>
          <span style={{ fontSize: 12, opacity: 0.5 }}>🔍</span>
          <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emoji..." className="flex-1 bg-transparent outline-none text-[11px]" style={{ color: 'var(--xp-txt)' }} />
          {search && <button onClick={() => setSearch('')} style={{ color: 'var(--xp-txt3)', fontSize: 12 }}>×</button>}
        </div>
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex items-center gap-0 px-1.5 pb-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {EMOJI_CATS.map(c => (
            <button key={c.key} onClick={() => setCatKey(c.key)} title={c.name} className="flex items-center justify-center rounded-lg transition-all flex-shrink-0" style={{ width: 28, height: 24, fontSize: 14, background: catKey === c.key ? 'rgba(124,58,237,0.12)' : 'transparent', border: `1px solid ${catKey === c.key ? 'rgba(124,58,237,0.30)' : 'transparent'}` }}>
              {c.icon}
            </button>
          ))}
        </div>
      )}

      {search && !search.trim() && <p className="px-3 pb-1 text-[10px]" style={{ color: 'var(--xp-txt3)' }}>All emojis</p>}

      {/* Emoji grid with smooth scrolling */}
      <div style={{ maxHeight: 192, overflowY: 'auto', padding: '0 8px 8px', scrollBehavior: 'smooth' }}>
        {displayList.length === 0 ? (
          <p className="text-center py-6 text-[11px]" style={{ color: 'var(--xp-txt3)' }}>No recent emojis yet</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1 }}>
            {displayList.map((emoji, i) => (
              <button key={`${catKey}-${i}`} onClick={() => handleSelect(emoji)} className="flex items-center justify-center rounded-lg transition-colors" style={{ width: 30, height: 30, fontSize: 18 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.09)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

const PILL_W = 100 // fixed pill width — all pills identical

interface TaskRowProps {
  task: Task
  index: number
  isActive: boolean
  now: number
  editMode: boolean
  dateKey: string
  expanded: boolean
  onExpandToggle: () => void
  onToggle: () => void
  onDelete: () => void
  onDuplicate: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  onJournalChange: (text: string) => void
  onTextChange: (text: string) => void
  onActChange: (actId: string) => void
  onAdjustTime: (sessionId: string | null, startTs: number, endTs: number, note: string) => void
  onSetReminder: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  bellTriggerKey: number
}

function TaskRow({
  task, index, isActive, now, editMode, dateKey,
  expanded, onExpandToggle,
  onToggle, onDelete, onDuplicate, onStartTimer, onStopTimer,
  onJournalChange, onTextChange, onActChange, onAdjustTime, onSetReminder,
  onDragStart, onDragOver, onDrop, bellTriggerKey,
}: TaskRowProps) {
  const { activities, reminders, isDark } = useApp()
  const hasReminder = reminders.some(r => r.taskId === task.id && r.dateKey === dateKey && r.isActive)

  const [menuOpen,       setMenuOpen]       = useState(false)
  const [adjustOpen,     setAdjustOpen]     = useState(false)
  const [emojiOpen,      setEmojiOpen]      = useState(false)
  const [isDragOver,     setIsDragOver]     = useState(false)
  const [notesViewMode,  setNotesViewMode]  = useState<'preview' | 'edit'>('preview')

  // Reset notes view when task collapses
  useEffect(() => { if (!expanded) setNotesViewMode('preview') }, [expanded])

  // Bell animation
  const [isBellAnimating, setIsBellAnimating] = useState(false)
  const mountedRef     = useRef(false)
  const prevTriggerRef = useRef(bellTriggerKey)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; if (hasReminder) setIsBellAnimating(true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (bellTriggerKey !== prevTriggerRef.current) { prevTriggerRef.current = bellTriggerKey; setIsBellAnimating(true) }
  }, [bellTriggerKey])

  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Checklist helpers
  function toggleChecklistLine(lineIndex: number) {
    const lines = (task.journal || '').split('\n')
    const line  = lines[lineIndex]
    if (line.startsWith('☐ '))      lines[lineIndex] = '☑ ' + line.slice(2)
    else if (line.startsWith('☑ ')) lines[lineIndex] = '☐ ' + line.slice(2)
    onJournalChange(lines.join('\n'))
  }

  function insertChecklistItem() {
    if (notesViewMode === 'preview') {
      const next = task.journal + (task.journal ? '\n' : '') + '☐ '
      onJournalChange(next)
      setNotesViewMode('edit')
      return
    }
    const ta   = notesRef.current
    const item = '☐ '
    if (ta) {
      const start  = ta.selectionStart ?? task.journal.length
      const value  = task.journal
      const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
      const next   = value.slice(0, start) + prefix + item + value.slice(start)
      onJournalChange(next)
      requestAnimationFrame(() => { ta.setSelectionRange(start + prefix.length + item.length, start + prefix.length + item.length); ta.focus() })
    } else {
      onJournalChange(task.journal + (task.journal ? '\n' : '') + item)
    }
  }

  function handleEmojiSelect(emoji: string) {
    if (notesViewMode === 'edit' && notesRef.current) {
      const ta     = notesRef.current
      const start  = ta.selectionStart ?? task.journal.length
      const next   = task.journal.slice(0, start) + emoji + task.journal.slice(start)
      onJournalChange(next)
      requestAnimationFrame(() => { ta.setSelectionRange(start + emoji.length, start + emoji.length); ta.focus() })
    } else {
      onJournalChange(task.journal + emoji)
    }
  }

  const totalMs        = getTaskTotalMs(task, isActive, now)
  const runningSession = getRunningSession(task)
  const latestSession  = task.sessions?.findLast?.(s => s.endTs !== null)
  const activity       = activities.find(a => a.id === task.actId)
  const multiSession   = (task.sessions?.filter(s => s.endTs !== null).length ?? 0) > 1

  // ── Card visuals: purple accent for active (not green) ─────────────────────
  const cardBorder = expanded ? 'rgba(124,58,237,0.28)' : 'var(--xp-bdr)'

  const cardBg = expanded
    ? (isDark ? 'rgba(255,255,255,0.035)' : '#ffffff')
    : isActive
    ? (isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)')
    : 'var(--xp-bg3)'

  // Build box-shadow array
  const shadows: string[] = []
  if (isActive)  shadows.push('inset 3px 0 0 rgba(124,58,237,0.80)')          // purple left accent bar
  if (isActive)  shadows.push('0 0 30px rgba(124,58,237,0.09), 0 2px 10px rgba(0,0,0,0.06)')  // ambient glow
  if (expanded)  shadows.push(isDark
    ? '0 4px 20px rgba(0,0,0,0.28),0 0 0 0.5px rgba(124,58,237,0.16)'
    : '0 2px 14px rgba(0,0,0,0.07),0 0 0 0.5px rgba(124,58,237,0.10)')
  const cardShadow = shadows.length ? shadows.join(',') : 'none'

  const titleBg     = editMode ? (isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)') : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')
  const titleBorder = editMode ? 'var(--xp-acc)' : 'var(--xp-bdr)'

  return (
    <>
      <style>{`@keyframes xp-active-pulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
      <div
        className={`rounded-xl overflow-visible relative transition-all duration-200 ${isDragOver ? 'ring-2 ring-violet-400 ring-offset-1' : ''}`}
        style={{ border: `0.5px solid ${cardBorder}`, background: cardBg, boxShadow: cardShadow }}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); onDragOver(e) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={() => { setIsDragOver(false); onDrop() }}
      >
        {/* ── HEADER ROW ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">

          {/* Drag handle */}
          <span draggable onDragStart={onDragStart} className="cursor-grab active:cursor-grabbing select-none flex-shrink-0 opacity-25 hover:opacity-55 transition-opacity" style={{ color: 'var(--xp-txt3)', fontSize: 13 }}>⠿</span>

          {/* Task N */}
          <span className="text-[10px] font-semibold flex-shrink-0 tabular-nums" style={{ color: 'var(--xp-txt3)', minWidth: 38 }}>Task {index + 1}</span>

          {/* Completion checkbox */}
          <button onClick={onToggle} className="w-[17px] h-[17px] rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150" style={{ borderColor: task.done ? '#16a34a' : 'var(--xp-bdr2)', background: task.done ? '#16a34a' : 'transparent' }}>
            {task.done && <span className="text-white font-bold leading-none" style={{ fontSize: 9 }}>✓</span>}
          </button>

          {/* Reminder bell — before title */}
          {hasReminder && (
            <span className={`flex-shrink-0 leading-none text-[13px] ${isBellAnimating ? 'xp-bell-ring' : ''}`} onAnimationEnd={() => setIsBellAnimating(false)} title="Reminder set">🔔</span>
          )}

          {/* Title — always in subtle rounded container */}
          <div className="flex-1 min-w-0 rounded-lg px-2.5 py-1 transition-all" style={{ background: titleBg, border: `0.5px solid ${titleBorder}` }}>
            {editMode ? (
              <input type="text" value={task.text} onChange={e => onTextChange(e.target.value)} className="w-full bg-transparent outline-none text-xs leading-snug" style={{ color: 'var(--xp-txt)' }} placeholder="Task title..." />
            ) : (
              <span className="text-xs leading-snug block truncate" style={{ color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)', textDecoration: task.done ? 'line-through' : 'none' }}>
                {task.text || <span style={{ opacity: 0.4 }}>Untitled</span>}
              </span>
            )}
          </div>

          {/* Category pill — fixed width, arrow always visible */}
          <div className="relative flex-shrink-0" style={{ width: PILL_W }}>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md pointer-events-none w-full" style={{ background: activity ? `${activity.color}18` : 'var(--xp-bg2)', border: `0.5px solid ${activity ? activity.color + '55' : 'var(--xp-bdr2)'}` }}>
              <span className="text-[10px] font-medium truncate flex-1 min-w-0" style={{ color: activity ? activity.color : 'var(--xp-txt3)' }}>
                {activity?.name ?? 'Category'}
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 9, height: 9, flexShrink: 0, color: activity ? activity.color : 'var(--xp-txt3)', opacity: 0.7 }}>
                <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <select value={task.actId} onChange={e => onActChange(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', fontSize: 0 }}>
              <option value="">Category</option>
              {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          {/* 3-dot */}
          <div className="relative flex-shrink-0">
            <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: 'var(--xp-txt3)' }}><DotsIcon /></button>
            {menuOpen && <TaskMenu onSetReminder={onSetReminder} onAdjustTime={() => setAdjustOpen(true)} onDuplicate={onDuplicate} onDelete={onDelete} onClose={() => setMenuOpen(false)} />}
          </div>
        </div>

        {/* ── DETAILS ROW ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 pb-2">

          {/* Total: duration */}
          {totalMs > 0 && (
            <span className="text-[10px] flex-shrink-0 flex items-center gap-1">
              <span style={{ color: 'var(--xp-txt3)', opacity: 0.6 }}>Total:</span>
              <span className="font-mono font-semibold" style={{ color: isActive ? '#7c3aed' : 'var(--xp-txt2)' }}>
                {isActive && runningSession ? formatHMS(now - runningSession.startTs) : formatMs(totalMs)}
              </span>
              {multiSession && !isActive && <span style={{ fontSize: 8, color: 'var(--xp-txt3)', opacity: 0.45 }}>all</span>}
            </span>
          )}

          {/* Play / Stop */}
          {!isActive ? (
            <button onClick={onStartTimer} className="p-1 rounded-md hover:bg-violet-500/15 transition-colors flex-shrink-0" style={{ color: totalMs > 0 ? '#7c3aed' : 'var(--xp-txt3)' }} title="Start timer"><PlayIcon /></button>
          ) : (
            <button onClick={onStopTimer} className="p-1 rounded-md hover:bg-red-500/15 transition-colors flex-shrink-0" style={{ color: '#ef4444' }} title="Stop timer"><StopIcon /></button>
          )}

          {/* Time range */}
          {latestSession && !isActive && (
            <span className="text-[9px] flex-shrink-0 tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
              {formatTime(latestSession.startTs)}–{formatTime(latestSession.endTs!)}
            </span>
          )}

          <div className="flex-1" />

          {/* Green active indicator — pulsing dot */}
          {isActive && (
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', display: 'inline-block', flexShrink: 0, animation: 'xp-active-pulse 1.4s ease-in-out infinite' }} />
              <span className="text-[10px] font-semibold" style={{ color: '#16a34a' }}>Active</span>
            </span>
          )}

          {/* Expand arrow */}
          <button onClick={onExpandToggle} className="flex items-center justify-center w-5 h-5 rounded hover:bg-black/5 transition-colors flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>
            <span style={{ display: 'inline-block', fontSize: 10, lineHeight: 1, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
          </button>
        </div>

        {/* Running gradient bar (green — "live" signal) */}
        {isActive && <div style={{ height: 2, background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', animation: 'xp-blink 2s ease-in-out infinite' }} />}

        {/* ── EXPANDABLE NOTES ───────────────────────────────────────────────── */}
        <div aria-hidden={!expanded} style={{ maxHeight: expanded ? 440 : 0, overflow: 'hidden', opacity: expanded ? 1 : 0, transition: expanded ? 'max-height 250ms ease,opacity 200ms ease' : 'max-height 220ms ease,opacity 150ms ease' }}>
          <div className="px-3 pb-3 pt-2.5" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>

            {/* Session info */}
            {latestSession && (
              <div className="flex items-center gap-3 mb-2 text-[10px] tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
                <span className="flex items-center gap-1"><span style={{ color: '#16a34a' }}>▶</span>{formatTime(latestSession.startTs)}</span>
                <span style={{ color: 'var(--xp-bdr2)' }}>→</span>
                <span className="flex items-center gap-1"><span style={{ color: '#ef4444' }}>■</span>{latestSession.endTs ? formatTime(latestSession.endTs) : '—'}</span>
                <span className="ml-auto font-medium" style={{ color: 'var(--xp-txt2)' }}>{latestSession.endTs ? formatMs(latestSession.endTs - latestSession.startTs) : 'Running'}</span>
              </div>
            )}

            {/* ── INTERACTIVE NOTES AREA ── */}
            <div>
              {notesViewMode === 'preview' ? (
                // Preview: interactive checklist + rendered text
                <div
                  className="text-xs rounded-lg px-2.5 py-2"
                  style={{ minHeight: 68, border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)', cursor: 'text' }}
                  onClick={() => { if (!task.journal) setNotesViewMode('edit') }}
                >
                  {task.journal ? (
                    <div>
                      {(task.journal).split('\n').map((line, i) => {
                        const isCheck = line.startsWith('☐ ') || line.startsWith('☑ ')
                        if (isCheck) {
                          const checked = line.startsWith('☑ ')
                          const text    = line.slice(2)
                          return (
                            <button
                              key={i}
                              onClick={e => { e.stopPropagation(); toggleChecklistLine(i) }}
                              className="flex items-center gap-2 w-full text-left py-0.5 transition-opacity hover:opacity-75"
                            >
                              <span style={{ fontSize: 13, flexShrink: 0, color: checked ? '#16a34a' : 'var(--xp-txt3)', lineHeight: 1 }}>{checked ? '☑' : '☐'}</span>
                              <span style={{ textDecoration: checked ? 'line-through' : 'none', color: checked ? 'var(--xp-txt3)' : 'var(--xp-txt)', fontSize: 11, lineHeight: 1.5 }}>
                                {text || <span style={{ opacity: 0.35, fontStyle: 'italic' }}>Empty item</span>}
                              </span>
                            </button>
                          )
                        }
                        return line
                          ? <p key={i} style={{ padding: '1px 0', lineHeight: 1.55, fontSize: 11, color: 'var(--xp-txt2)' }}>{line}</p>
                          : <div key={i} style={{ height: 5 }} />
                      })}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--xp-txt3)', opacity: 0.4, fontSize: 11 }}>
                      Click ✏️ to add notes, or ☐ to add a checklist item...
                    </span>
                  )}
                </div>
              ) : (
                // Edit: raw textarea
                <textarea
                  ref={notesRef}
                  autoFocus
                  value={task.journal}
                  onChange={e => onJournalChange(e.target.value)}
                  placeholder="Add notes, or use ☐ to insert checklist items..."
                  rows={3}
                  tabIndex={expanded ? 0 : -1}
                  className="w-full text-xs px-2.5 py-2 rounded-lg outline-none resize-none leading-relaxed"
                  style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)' }}
                />
              )}

              {/* Controls row */}
              <div className="flex items-center justify-between mt-1.5">
                {/* Mode toggle */}
                <button
                  onClick={() => setNotesViewMode(m => m === 'preview' ? 'edit' : 'preview')}
                  className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5"
                  style={{ color: 'var(--xp-txt3)' }}
                >
                  {notesViewMode === 'preview' ? '✏️ Edit notes' : '👁 Preview'}
                </button>

                <div className="flex items-center gap-1.5">
                  {/* Checklist insert */}
                  <button
                    onClick={insertChecklistItem}
                    tabIndex={expanded ? 0 : -1}
                    className="flex items-center justify-center transition-all hover:scale-105"
                    style={{ width: 22, height: 22, border: '1.5px solid var(--xp-bdr2)', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)', borderRadius: 5, fontSize: 13, color: 'var(--xp-txt3)' }}
                    title="Insert checklist item"
                  >☐</button>

                  {/* Emoji picker */}
                  <div className="relative flex-shrink-0">
                    <button onClick={() => setEmojiOpen(o => !o)} tabIndex={expanded ? 0 : -1} className="hover:scale-110 transition-transform leading-none" style={{ fontSize: 17 }} title="Insert emoji">😊</button>
                    {emojiOpen && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setEmojiOpen(false)} />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {adjustOpen && (
        <AdjustTimeModal task={task} dateKey={dateKey} onClose={() => setAdjustOpen(false)} onSave={(sid, s, e, n) => { onAdjustTime(sid, s, e, n); setAdjustOpen(false) }} />
      )}
    </>
  )
}

// ─── Today's Status Dropdown ──────────────────────────────────────────────────

type StatusValue = 'milestone' | 'hyper' | 'goal' | 'productive'

const STATUS_OPTIONS: { value: StatusValue; icon: string; label: string }[] = [
  { value: 'productive', icon: '✅', label: 'Productive Day'   },
  { value: 'hyper',      icon: '🔥', label: 'Hyper Productive' },
  { value: 'milestone',  icon: '🏆', label: 'Milestone Day'    },
  { value: 'goal',       icon: '🎯', label: 'Goal Achieved'    },
]

function TodayStatusDropdown({ value, onChange, isDark }: { value: StatusValue | null; onChange: (v: StatusValue | null) => void; isDark: boolean }) {
  const [open,    setOpen]    = useState(false)
  const [hovered, setHovered] = useState<StatusValue | null>(null)
  const containerRef          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false) }
    setTimeout(() => document.addEventListener('mousedown', onOutside), 10)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const selected = STATUS_OPTIONS.find(o => o.value === value)

  return (
    <>
      <style>{`@keyframes xp-status-drop-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${value ? 'rgba(124,58,237,0.35)' : 'var(--xp-bdr2)'}`, background: value ? 'rgba(124,58,237,0.07)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: value ? '#7c3aed' : 'var(--xp-txt3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {selected ? `${selected.icon} ${selected.label}` : 'Not Selected'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 12, height: 12, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 30, minWidth: 210, borderRadius: 14, overflow: 'hidden', background: isDark ? '#1a1530' : '#ffffff', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.18)'}`, boxShadow: isDark ? '0 16px 48px rgba(0,0,0,0.40)' : '0 12px 40px rgba(0,0,0,0.14)', animation: 'xp-status-drop-in 160ms cubic-bezier(0.16,1,0.3,1) forwards' }}>
            {STATUS_OPTIONS.map(opt => {
              const isAct = value === opt.value
              const isHov = hovered === opt.value
              return (
                <button key={opt.value} onMouseEnter={() => setHovered(opt.value)} onMouseLeave={() => setHovered(null)} onClick={() => { onChange(isAct ? null : opt.value); setOpen(false); setHovered(null) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: 'pointer', border: 'none', borderLeft: `2.5px solid ${isAct ? '#7c3aed' : 'transparent'}`, background: isAct ? 'rgba(124,58,237,0.09)' : isHov ? 'rgba(124,58,237,0.05)' : 'transparent' }}>
                  <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{opt.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: isAct ? 600 : 500, color: isAct ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.85)' : '#111827', flex: 1 }}>{opt.label}</span>
                  {isAct && <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" style={{ width: 13, height: 13, flexShrink: 0 }}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ─── DayModal ─────────────────────────────────────────────────────────────────

interface DayModalProps {
  dateKey: string
  month: number
  day: number
  onClose: () => void
  onDashboard?: () => void
}

export function DayModal({ dateKey, month, day, onClose, onDashboard }: DayModalProps) {
  const {
    calData, updateDay, activeTaskTimer, setActiveTaskTimer,
    activities, activeSession, setActiveSession, selectedActId,
    reminders, isDark, setToast, sessions,
  } = useApp()

  const dayData = calData[dateKey] ?? { ...EMPTY_DAY }

  const currentStatus: StatusValue | null =
    dayData.milestone ? 'milestone' : dayData.hyper ? 'hyper' : dayData.goal ? 'goal' : dayData.productive ? 'productive' : null

  function handleStatusSelect(newValue: StatusValue | null) {
    const wasGoal = !!dayData.goal
    updateDay(dateKey, prev => {
      if (newValue === null)         return { ...prev, productive: false, hyper: false, milestone: false, goal: false }
      if (newValue === 'productive') return { ...prev, productive: true,  hyper: false, milestone: false, goal: false }
      if (newValue === 'hyper')      return { ...prev, productive: true,  hyper: true,  milestone: false, goal: false }
      if (newValue === 'milestone')  return { ...prev, productive: true,  hyper: false, milestone: true,  goal: false }
      return                                { ...prev, productive: true,  hyper: false, milestone: false, goal: true  }
    })
    if (newValue === 'goal' && !wasGoal) setShowConfetti(true)
  }

  const [addingTask,       setAddingTask]       = useState(false)
  const [newTaskText,      setNewTaskText]       = useState('')
  const [editMode,         setEditMode]          = useState(false)
  const [notesOpen,        setNotesOpen]         = useState(false)
  const [now,              setNow]               = useState(Date.now())
  const [dragItemId,       setDragItemId]        = useState<string | null>(null)
  const [showConfetti,     setShowConfetti]      = useState(false)
  const [reminderTaskId,   setReminderTaskId]    = useState<string | null>(null)
  const [reminderSavedKey, setReminderSavedKey]  = useState<Record<string, number>>({})
  const [expandedTaskId,   setExpandedTaskId]    = useState<string | null>(null)
  const onConfettiDone = useCallback(() => setShowConfetti(false), [])

  const dateLabel = useMemo(() => {
    const d = new Date(APP_YEAR, month, day)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [month, day])

  const isActiveHere  = activeTaskTimer?.dateKey === dateKey
  const isSessionHere = activeSession?.dateKey === dateKey

  useEffect(() => {
    if (!isActiveHere && !isSessionHere) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActiveHere, isSessionHere])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Total Focus Time Today — shared source of truth with Dashboard / StatsRow
  const totalFocusMsToday = useMemo(() => {
    const workMs   = sessions.filter(s => s.dateKey === dateKey && s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
    const taskMs   = (dayData.tasks ?? []).reduce((t, task) => t + (task.sessions ?? []).filter(s => s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0), 0)
    const activeMs = isSessionHere ? Math.max(0, now - activeSession!.startTs) : 0
    return workMs + taskMs + activeMs
  }, [sessions, dayData.tasks, activeSession, isSessionHere, dateKey, now])

  // One-time dedup on open
  useEffect(() => {
    updateDay(dateKey, prev => {
      const nextTasks = prev.tasks.map(t => {
        const cleaned = deduplicateTaskSessions(t.sessions ?? [])
        return cleaned.length !== (t.sessions ?? []).length ? { ...t, sessions: cleaned } : t
      })
      return nextTasks.some((t, i) => t !== prev.tasks[i]) ? { ...prev, tasks: nextTasks } : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Task CRUD ─────────────────────────────────────────────────────────────

  function makeTask(text: string): Task {
    return { id: 't' + Date.now() + Math.random().toString(36).slice(2), text, done: false, journal: '', timerStart: null, timerEnd: null, actId: activities[0]?.id ?? '', sessions: [] }
  }

  function addTask(text?: string) {
    const t = (text ?? newTaskText).trim()
    if (!t) return
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, makeTask(t)] }))
    setNewTaskText(''); setAddingTask(false)
  }

  function generateTasks() {
    const existing = new Set(dayData.tasks.map(t => t.text))
    const toAdd    = GENERATED_TASKS.filter(t => !existing.has(t))
    if (!toAdd.length) return
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, ...toAdd.map(t => makeTask(t))] }))
  }

  function toggleTask(id: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  function deleteTask(id: string) {
    if (activeTaskTimer?.taskId === id) setActiveTaskTimer(null)
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) }))
    if (expandedTaskId === id) setExpandedTaskId(null)
  }

  function duplicateTask(id: string) {
    const src = dayData.tasks.find(t => t.id === id); if (!src) return
    const copy = makeTask(src.text + ' (copy)'); copy.actId = src.actId
    updateDay(dateKey, prev => {
      const idx  = prev.tasks.findIndex(t => t.id === id)
      const next = [...prev.tasks]; next.splice(idx + 1, 0, copy)
      return { ...prev, tasks: next }
    })
  }

  function updateTaskText(id: string, text: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, text } : t) }))
  }
  function updateTaskAct(id: string, actId: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, actId } : t) }))
  }
  function updateTaskJournal(id: string, journal: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, journal } : t) }))
  }

  // ── Timers ────────────────────────────────────────────────────────────────

  function startTimer(taskId: string, taskIndex: number) {
    const task = dayData.tasks.find(t => t.id === taskId); if (!task) return
    if (activeTaskTimer?.dateKey === dateKey && activeTaskTimer.taskId !== taskId) stopTimer(activeTaskTimer.taskId)
    const sessionId  = 'sess' + Date.now()
    const newSession: TaskSession = { id: sessionId, startTs: Date.now(), endTs: null, note: '', tags: [] }
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, timerStart: t.timerStart ?? Date.now(), sessions: [...(t.sessions ?? []), newSession] } : t) }))
    setActiveTaskTimer({ taskId, dateKey, sessionId, startTs: Date.now(), taskText: task.text, taskIndex })
    setNow(Date.now())
    if (!activeSession) {
      const act = activities.find(a => a.id === (task.actId || selectedActId)) ?? activities[0]
      if (act) setActiveSession({ id: 's' + Date.now(), actId: act.id, actName: act.name, actColor: act.color, startTs: Date.now(), dateKey })
    }
  }

  function stopTimer(taskId: string) {
    const endTs = Date.now()
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id !== taskId ? t : { ...t, timerEnd: endTs, sessions: (t.sessions ?? []).map(s => s.endTs === null ? { ...s, endTs } : s) }) }))
    setActiveTaskTimer(null)
  }

  function adjustTime(taskId: string, sessionId: string | null, startTs: number, endTs: number, note: string) {
    let closedRunning = false
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        const sessions = t.sessions ?? []; let updated: TaskSession[]
        if (sessionId) {
          if (sessions.find(s => s.id === sessionId)?.endTs === null) closedRunning = true
          updated = sessions.map(s => s.id === sessionId ? { ...s, startTs, endTs, note } : s)
        } else {
          const runIdx  = sessions.findIndex(s => s.endTs === null)
          const lastIdx = sessions.reduce((idx, s, i) => s.endTs !== null ? i : idx, -1)
          if (runIdx >= 0)       { closedRunning = true; updated = sessions.map((s, i) => i === runIdx  ? { ...s, startTs, endTs, note } : s) }
          else if (lastIdx >= 0) {                       updated = sessions.map((s, i) => i === lastIdx ? { ...s, startTs, endTs, note } : s) }
          else                   {                       updated = [{ id: 'manual-' + Date.now(), startTs, endTs, note, tags: [] }] }
        }
        return { ...t, timerStart: startTs, timerEnd: endTs, sessions: updated }
      }),
    }))
    if (closedRunning && activeTaskTimer?.taskId === taskId) setActiveTaskTimer(null)
    setToast('Time adjusted')
  }

  // ── Drag reorder ──────────────────────────────────────────────────────────

  function handleDrop(targetId: string) {
    if (!dragItemId || dragItemId === targetId) { setDragItemId(null); return }
    const tasks = [...dayData.tasks]
    const fromIdx = tasks.findIndex(t => t.id === dragItemId)
    const toIdx   = tasks.findIndex(t => t.id === targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragItemId(null); return }
    const [item] = tasks.splice(fromIdx, 1); tasks.splice(toIdx, 0, item)
    updateDay(dateKey, prev => ({ ...prev, tasks })); setDragItemId(null)
  }

  const doneCount = dayData.tasks.filter(t => t.done).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          maxHeight: '93vh',
          // ── Popup depth: primary shadow + subtle purple ambient (spec §11) ──
          boxShadow: '0 24px 60px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(124,58,237,0.06), 0 0 100px rgba(124,58,237,0.06)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)', background: 'var(--xp-bg3)' }}>
          <button onClick={onClose} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all hover:opacity-80" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', color: 'var(--xp-acc)' }}>← Back</button>
          <div className="text-center px-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>{dateLabel}</p>
            <p className="text-[9px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Single click = toggle productive · Double click = notes</p>
          </div>
          <button onClick={onClose} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all hover:opacity-80" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>× Close</button>
        </div>

        {/* Today's Status row */}
        <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 flex-wrap" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>Today&apos;s Status</span>
          <TodayStatusDropdown value={currentStatus} onChange={handleStatusSelect} isDark={isDark} />
          <div style={{ flex: 1 }} />
          <button onClick={onDashboard} className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg font-medium text-white transition-all hover:opacity-85 flex-shrink-0" style={{ background: '#7c3aed' }}>📊 Today&apos;s Dashboard</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>

            {/* Section header */}
            <div className="flex items-start justify-between mb-2 gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--xp-txt)' }}>
                  Accomplishments
                  {dayData.tasks.length > 0 && <span className="ml-1 font-normal" style={{ color: 'var(--xp-txt3)' }}>· {doneCount}/{dayData.tasks.length} Completed</span>}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
                  Total Focus Time Today:{' '}
                  <span className="font-semibold" style={{ color: totalFocusMsToday > 0 ? 'var(--xp-txt2)' : 'var(--xp-txt3)' }}>
                    {totalFocusMsToday > 0 ? formatMs(totalFocusMsToday) : '—'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => setEditMode(o => !o)} className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all" style={{ background: editMode ? '#7c3aed11' : 'var(--xp-bg2)', border: `1px solid ${editMode ? '#7c3aed' : 'var(--xp-bdr2)'}`, color: editMode ? '#7c3aed' : 'var(--xp-txt3)' }}>✏️ {editMode ? 'Done' : 'Edit'}</button>
                <button onClick={generateTasks} className="text-[10px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500" style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}>✨ Generate 3</button>
                <button onClick={() => setAddingTask(true)} className="text-[10px] px-2.5 py-1 rounded-lg text-white font-medium transition-opacity hover:opacity-85 flex-shrink-0" style={{ background: '#16a34a' }}>+ Add Task</button>
              </div>
            </div>

            {/* Empty state */}
            {dayData.tasks.length === 0 && !addingTask && (
              <div className="text-center py-7">
                <div className="text-2xl mb-2">📋</div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--xp-txt)' }}>No accomplishments yet.</p>
                <p className="text-xs mb-4" style={{ color: 'var(--xp-txt3)' }}>Start with one small win.</p>
                <button onClick={() => setAddingTask(true)} className="text-xs px-5 py-2 rounded-full text-white font-medium transition-opacity hover:opacity-80" style={{ background: '#16a34a' }}>+ Add Task</button>
              </div>
            )}

            {/* Task list */}
            <div className="space-y-2">
              {dayData.tasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={index}
                  isActive={activeTaskTimer?.taskId === task.id && activeTaskTimer.dateKey === dateKey}
                  now={now}
                  editMode={editMode}
                  dateKey={dateKey}
                  expanded={expandedTaskId === task.id}
                  onExpandToggle={() => setExpandedTaskId(prev => prev === task.id ? null : task.id)}
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  onDuplicate={() => duplicateTask(task.id)}
                  onStartTimer={() => startTimer(task.id, index)}
                  onStopTimer={() => stopTimer(task.id)}
                  onJournalChange={text => updateTaskJournal(task.id, text)}
                  onTextChange={text => updateTaskText(task.id, text)}
                  onActChange={actId => updateTaskAct(task.id, actId)}
                  onAdjustTime={(sid, s, e, n) => adjustTime(task.id, sid, s, e, n)}
                  onSetReminder={() => setReminderTaskId(task.id)}
                  onDragStart={() => setDragItemId(task.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(task.id)}
                  bellTriggerKey={reminderSavedKey[task.id] ?? 0}
                />
              ))}

              {addingTask && (
                <div className="flex items-center gap-2">
                  <input autoFocus type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskText('') } }} placeholder="What did you accomplish?" className="flex-1 text-xs px-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
                  <button onClick={() => addTask()} className="text-xs px-3.5 py-2 rounded-lg text-white transition-opacity hover:opacity-80 flex-shrink-0 font-medium" style={{ background: '#16a34a' }}>Add</button>
                  <button onClick={() => { setAddingTask(false); setNewTaskText('') }} className="text-sm px-2 py-1.5 flex-shrink-0 transition-colors hover:text-red-400" style={{ color: 'var(--xp-txt3)' }}>×</button>
                </div>
              )}
            </div>

            {dayData.tasks.length > 0 && !addingTask && (
              <button onClick={() => setAddingTask(true)} className="mt-2 w-full text-xs py-2.5 rounded-xl text-white font-semibold transition-all hover:opacity-85" style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)', boxShadow: '0 2px 10px rgba(124,58,237,0.35)' }}>
                + Add accomplishment
              </button>
            )}
          </div>

          {/* Journal notes */}
          <div className="px-4 py-3">
            <button onClick={() => setNotesOpen(o => !o)} className="flex items-center gap-2 text-xs font-medium w-full text-left transition-colors hover:text-violet-500 mb-1" style={{ color: 'var(--xp-txt2)' }}>
              <span>{notesOpen ? '▾' : '▸'} Journal notes</span>
            </button>
            {notesOpen && (
              <textarea value={dayData.notes ?? ''} onChange={e => updateDay(dateKey, prev => ({ ...prev, notes: e.target.value }))} placeholder="What made today great? Reflections, insights, gratitude..." rows={4} className="w-full text-xs px-3 py-2.5 rounded-xl outline-none resize-none leading-relaxed" style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5" style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>Cancel</button>
          <button onClick={onClose} className="text-xs px-5 py-1.5 rounded-full text-white font-medium transition-opacity hover:opacity-80" style={{ background: '#7c3aed' }}>✓ Save</button>
        </div>
      </div>

      {showConfetti && <ConfettiPop onDone={onConfettiDone} />}

      {reminderTaskId && (() => {
        const reminderTask = dayData.tasks.find(t => t.id === reminderTaskId)
        const existing     = reminders.find(r => r.taskId === reminderTaskId && r.dateKey === dateKey && r.isActive) ?? null
        return reminderTask ? (
          <ReminderModal taskId={reminderTaskId} dateKey={dateKey} taskText={reminderTask.text} existingReminder={existing} onClose={() => setReminderTaskId(null)} onSaved={() => setReminderSavedKey(prev => ({ ...prev, [reminderTaskId]: (prev[reminderTaskId] ?? 0) + 1 }))} />
        ) : null
      })()}
    </div>
  )
}
