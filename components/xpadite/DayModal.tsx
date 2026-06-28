'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useApp, EMPTY_DAY } from './AppContext'
import type { Task, TaskSession } from './types'
import { formatMs, formatHMS, formatTime, APP_YEAR } from './utils'

// ─── Confetti Pop ─────────────────────────────────────────────────────────────

function ConfettiPop({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500)
    return () => clearTimeout(t)
  }, [onDone])

  const COLORS = ['#f97316', '#7c3aed', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb7185', '#60a5fa']
  const particles = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * 360 + (Math.random() * 20 - 10)
    const dist = 55 + Math.random() * 60
    const rad = (angle * Math.PI) / 180
    return {
      color: COLORS[i % COLORS.length],
      tx: Math.cos(rad) * dist,
      ty: Math.sin(rad) * dist - 20,
      rot: Math.random() * 540 - 270,
      size: 4 + Math.random() * 5,
      delay: Math.random() * 0.15,
      isRect: i % 3 !== 0,
    }
  })

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.isRect ? p.size * 2.2 : p.size,
            borderRadius: p.isRect ? 2 : '50%',
            background: p.color,
            ['--tx' as string]: `${p.tx}px`,
            ['--ty' as string]: `${p.ty}px`,
            ['--rot' as string]: `${p.rot}deg`,
            animation: `xp-confetti 1.3s ${p.delay}s cubic-bezier(0.2,0.8,0.4,1) forwards`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
)

const DotsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)

// ─── Constants ────────────────────────────────────────────────────────────────

const GENERATED_TASKS = [
  'Complete morning planning and set daily priorities',
  'Focus on primary work goal for 2+ hours uninterrupted',
  'Review progress and document key learnings',
]


// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── TogglePill ───────────────────────────────────────────────────────────────

function TogglePill({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border select-none"
      style={{
        borderColor: active ? color : 'var(--xp-bdr2)',
        background: active ? `${color}22` : 'transparent',
        color: active ? color : 'var(--xp-txt3)',
      }}
    >
      {label}
    </button>
  )
}

// ─── Adjust Time Modal ────────────────────────────────────────────────────────

interface AdjustTimeProps {
  task: Task
  onClose: () => void
  onSave: (startTs: number, endTs: number, note: string) => void
}

function AdjustTimeModal({ task, onClose, onSave }: AdjustTimeProps) {
  const runningSession = getRunningSession(task)
  const lastSession = task.sessions?.findLast?.(s => s.endTs !== null) ?? null

  function tsToInput(ts: number | null): string {
    if (!ts) return ''
    const d = new Date(ts)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }

  function inputToTs(val: string): number {
    const [h, m] = val.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }

  const refStart = runningSession?.startTs ?? lastSession?.startTs ?? null
  const refEnd = runningSession?.endTs ?? lastSession?.endTs ?? null

  const [startVal, setStartVal] = useState(tsToInput(refStart))
  const [endVal, setEndVal] = useState(tsToInput(refEnd))
  const [noteVal, setNoteVal] = useState('')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-[320px] rounded-2xl shadow-2xl p-5"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>Adjust Session</h3>
        <p className="text-[10px] mb-4" style={{ color: 'var(--xp-txt3)' }}>{task.text}</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>Start Time</label>
            <input
              type="time"
              value={startVal}
              onChange={e => setStartVal(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>End Time</label>
            <input
              type="time"
              value={endVal}
              onChange={e => setEndVal(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
            />
          </div>
        </div>

        {startVal && endVal && (
          <p className="text-[10px] mb-3" style={{ color: 'var(--xp-txt3)' }}>
            Duration: {formatMs(Math.max(0, inputToTs(endVal) - inputToTs(startVal)))}
          </p>
        )}

        <div className="mb-4">
          <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--xp-txt3)' }}>Reason (optional)</label>
          <input
            type="text"
            value={noteVal}
            onChange={e => setNoteVal(e.target.value)}
            placeholder="Why are you adjusting this time?"
            className="w-full text-xs px-3 py-2 rounded-lg outline-none"
            style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5"
            style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (startVal && endVal) {
                onSave(inputToTs(startVal), inputToTs(endVal), noteVal)
              }
              onClose()
            }}
            className="text-xs px-5 py-1.5 rounded-full text-white transition-opacity hover:opacity-80"
            style={{ background: '#7c3aed' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task 3-dot Menu ──────────────────────────────────────────────────────────

interface TaskMenuProps {
  onAdjustTime: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}

function TaskMenu({ onAdjustTime, onDuplicate, onDelete, onClose }: TaskMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', onClick), 10)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  const items = [
    { icon: '⏱', label: 'Adjust Time', action: onAdjustTime },
    { icon: '⧉', label: 'Duplicate Task', action: onDuplicate },
    { icon: '🗑', label: 'Delete Task', action: onDelete, danger: true },
  ]

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden z-10"
      style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', minWidth: 160 }}
    >
      {items.map(item => (
        <button
          key={item.label}
          onClick={() => { item.action(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs transition-colors hover:bg-black/5"
          style={{ color: item.danger ? '#ef4444' : 'var(--xp-txt)' }}
        >
          <span className="text-sm">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task
  index: number
  isActive: boolean
  now: number
  editMode: boolean
  onToggle: () => void
  onDelete: () => void
  onDuplicate: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  onJournalChange: (text: string) => void
  onTextChange: (text: string) => void
  onActChange: (actId: string) => void
  onAdjustTime: (startTs: number, endTs: number, note: string) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}

function TaskRow({
  task, index, isActive, now, editMode,
  onToggle, onDelete, onDuplicate, onStartTimer, onStopTimer,
  onJournalChange, onTextChange, onActChange, onAdjustTime,
  onDragStart, onDragOver, onDrop,
}: TaskRowProps) {
  const { activities } = useApp()
  const [journalOpen, setJournalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const totalMs = getTaskTotalMs(task, isActive, now)
  const runningSession = getRunningSession(task)
  const latestSession = task.sessions?.findLast?.(s => s.endTs !== null)

  const activity = activities.find(a => a.id === task.actId)

  return (
    <>
      <div
        className={`rounded-xl overflow-visible transition-all duration-150 relative ${isDragOver ? 'ring-2 ring-violet-400 ring-offset-1' : ''}`}
        style={{ border: `0.5px solid ${isActive ? 'rgba(22,163,74,0.4)' : 'var(--xp-bdr)'}`, background: isActive ? 'rgba(22,163,74,0.04)' : 'var(--xp-bg3)' }}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); onDragOver(e) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={() => { setIsDragOver(false); onDrop() }}
      >
        {/* Main row */}
        <div className="flex items-center gap-2 px-3 py-2.5 group">

          {/* Drag handle */}
          <span
            draggable
            onDragStart={onDragStart}
            className="cursor-grab active:cursor-grabbing select-none flex-shrink-0 opacity-30 group-hover:opacity-60 transition-opacity"
            style={{ color: 'var(--xp-txt3)', fontSize: 13 }}
            title="Drag to reorder"
          >
            ⠿
          </span>

          {/* Task label */}
          <span
            className="text-[10px] font-semibold flex-shrink-0 tabular-nums"
            style={{ color: 'var(--xp-txt3)', minWidth: 38 }}
          >
            Task {index + 1}
          </span>

          {/* Checkbox */}
          <button
            onClick={onToggle}
            className="w-[17px] h-[17px] rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150"
            style={{ borderColor: task.done ? '#16a34a' : 'var(--xp-bdr2)', background: task.done ? '#16a34a' : 'transparent' }}
          >
            {task.done && <span className="text-white font-bold leading-none" style={{ fontSize: 9 }}>✓</span>}
          </button>

          {/* Title */}
          {editMode ? (
            <input
              type="text"
              value={task.text}
              onChange={e => onTextChange(e.target.value)}
              className="flex-1 text-xs px-2 py-1 rounded-md outline-none min-w-0"
              style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)' }}
            />
          ) : (
            <span
              className="flex-1 text-xs leading-relaxed min-w-0 truncate"
              style={{
                color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)',
                textDecoration: task.done ? 'line-through' : 'none',
              }}
            >
              {task.text}
            </span>
          )}

          {/* Activity pill */}
          <select
            value={task.actId}
            onChange={e => onActChange(e.target.value)}
            className="text-[10px] px-1.5 py-0.5 rounded-md outline-none flex-shrink-0"
            style={{
              background: activity ? `${activity.color}18` : 'var(--xp-bg2)',
              border: `0.5px solid ${activity ? activity.color + '55' : 'var(--xp-bdr2)'}`,
              color: activity ? activity.color : 'var(--xp-txt3)',
              maxWidth: 76,
            }}
          >
            <option value="">Category</option>
            {activities.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          {/* Timer display */}
          {isActive && runningSession ? (
            <span className="text-[10px] font-mono flex-shrink-0 font-semibold" style={{ color: '#16a34a' }}>
              {formatHMS(now - runningSession.startTs)}
            </span>
          ) : totalMs > 0 ? (
            <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>
              {formatMs(totalMs)}
            </span>
          ) : null}

          {/* Timer start/stop */}
          {!isActive ? (
            <button
              onClick={onStartTimer}
              className="p-1.5 rounded-lg transition-colors hover:bg-green-500/15 flex-shrink-0"
              style={{ color: totalMs > 0 ? '#16a34a' : 'var(--xp-txt3)' }}
              title="Start timer"
            >
              <PlayIcon />
            </button>
          ) : (
            <button
              onClick={onStopTimer}
              className="p-1.5 rounded-lg transition-colors hover:bg-red-500/15 flex-shrink-0"
              style={{ color: '#ef4444' }}
              title="Stop timer"
            >
              <StopIcon />
            </button>
          )}

          {/* Time display (start → end) */}
          {latestSession && !isActive && (
            <span className="text-[9px] flex-shrink-0 hidden lg:inline tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
              {formatTime(latestSession.startTs)}→{formatTime(latestSession.endTs!)}
            </span>
          )}

          {/* 3-dot menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors opacity-0 group-hover:opacity-100"
              style={{ color: 'var(--xp-txt3)' }}
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <TaskMenu
                onAdjustTime={() => setAdjustOpen(true)}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>

          {/* Notes toggle — bigger arrow */}
          <button
            onClick={() => setJournalOpen(o => !o)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-black/5 flex-shrink-0"
            style={{ color: 'var(--xp-txt3)' }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{journalOpen ? '▾' : '▸'}</span>
          </button>
        </div>

        {/* Running indicator bar */}
        {isActive && (
          <div
            style={{
              height: 2,
              background: 'linear-gradient(90deg, #16a34a, #4ade80)',
              animation: 'xp-blink 2s ease-in-out infinite',
            }}
          />
        )}

        {/* Additional notes section */}
        {journalOpen && (
          <div className="px-3 pb-3 pt-2.5" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
            <p className="text-[10px] font-semibold mb-2" style={{ color: 'var(--xp-txt3)' }}>Additional notes</p>

            {/* Session info row */}
            {latestSession && (
              <div className="flex items-center gap-3 mb-2 text-[10px] tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
                <span className="flex items-center gap-1">
                  <span style={{ color: '#16a34a' }}>▶</span>
                  {formatTime(latestSession.startTs)}
                </span>
                <span style={{ color: 'var(--xp-bdr2)' }}>→</span>
                <span className="flex items-center gap-1">
                  <span style={{ color: '#ef4444' }}>■</span>
                  {latestSession.endTs ? formatTime(latestSession.endTs) : '—'}
                </span>
                <span className="ml-auto font-medium" style={{ color: 'var(--xp-txt2)' }}>
                  {latestSession.endTs ? formatMs(latestSession.endTs - latestSession.startTs) : 'Running'}
                </span>
              </div>
            )}

            {/* Notes textarea + quick emoji */}
            <div className="relative">
              <textarea
                value={task.journal}
                onChange={e => onJournalChange(e.target.value)}
                placeholder="Additional notes about this task..."
                rows={3}
                className="w-full text-xs px-2.5 py-2 rounded-lg outline-none resize-none leading-relaxed"
                style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)', paddingBottom: 28 }}
              />
              {/* Quick emoji strip */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                {['😊', '🔥', '✅', '💡', '⚡'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => onJournalChange(task.journal + emoji)}
                    className="text-sm hover:scale-125 transition-transform leading-none"
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Adjust Time modal */}
      {adjustOpen && (
        <AdjustTimeModal
          task={task}
          onClose={() => setAdjustOpen(false)}
          onSave={(startTs, endTs, note) => {
            onAdjustTime(startTs, endTs, note)
            setAdjustOpen(false)
          }}
        />
      )}
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
  const { calData, updateDay, activeTaskTimer, setActiveTaskTimer, activities, activeSession, setActiveSession, selectedActId } = useApp()
  const dayData = calData[dateKey] ?? { ...EMPTY_DAY }

  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const onConfettiDone = useCallback(() => setShowConfetti(false), [])

  const dateLabel = useMemo(() => {
    const d = new Date(APP_YEAR, month, day)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [month, day])

  // Track local running timer
  const isActiveHere = activeTaskTimer?.dateKey === dateKey

  useEffect(() => {
    if (!isActiveHere) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActiveHere])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Toggles ──────────────────────────────────────────────────────────────

  function toggleProductive() {
    updateDay(dateKey, prev => ({ ...prev, productive: !prev.productive, hyper: prev.productive ? false : prev.hyper }))
  }
  function toggleHyper() {
    updateDay(dateKey, prev => ({ ...prev, hyper: !prev.hyper, productive: !prev.hyper ? true : prev.productive }))
  }
  function toggleMilestone() {
    updateDay(dateKey, prev => ({ ...prev, milestone: !prev.milestone, productive: !prev.milestone ? true : prev.productive }))
  }
  function toggleGoal() {
    const wasGoal = !!dayData.goal
    updateDay(dateKey, prev => ({ ...prev, goal: !prev.goal, productive: !prev.goal ? true : prev.productive }))
    if (!wasGoal) setShowConfetti(true)
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  function makeTask(text: string): Task {
    return {
      id: 't' + Date.now() + Math.random().toString(36).slice(2),
      text,
      done: false,
      journal: '',
      timerStart: null,
      timerEnd: null,
      actId: activities[0]?.id ?? '',
      sessions: [],
    }
  }

  function addTask(text?: string) {
    const t = (text ?? newTaskText).trim()
    if (!t) return
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, makeTask(t)] }))
    setNewTaskText('')
    setAddingTask(false)
  }

  function generateTasks() {
    const existing = new Set(dayData.tasks.map(t => t.text))
    const toAdd = GENERATED_TASKS.filter(t => !existing.has(t))
    if (!toAdd.length) return
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, ...toAdd.map(t => makeTask(t))] }))
  }

  function toggleTask(id: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  function deleteTask(id: string) {
    if (activeTaskTimer?.taskId === id) setActiveTaskTimer(null)
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) }))
  }

  function duplicateTask(id: string) {
    const src = dayData.tasks.find(t => t.id === id)
    if (!src) return
    const copy = makeTask(src.text + ' (copy)')
    copy.actId = src.actId
    updateDay(dateKey, prev => {
      const idx = prev.tasks.findIndex(t => t.id === id)
      const next = [...prev.tasks]
      next.splice(idx + 1, 0, copy)
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
    const task = dayData.tasks.find(t => t.id === taskId)
    if (!task) return

    // Stop any currently running timer on this day
    if (activeTaskTimer?.dateKey === dateKey && activeTaskTimer.taskId !== taskId) {
      stopTimer(activeTaskTimer.taskId)
    }

    const sessionId = 'sess' + Date.now()
    const newSession: TaskSession = { id: sessionId, startTs: Date.now(), endTs: null, note: '', tags: [] }

    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t =>
        t.id === taskId
          ? { ...t, timerStart: t.timerStart ?? Date.now(), sessions: [...(t.sessions ?? []), newSession] }
          : t
      ),
    }))

    setActiveTaskTimer({ taskId, dateKey, sessionId, startTs: Date.now(), taskText: task.text, taskIndex })
    setNow(Date.now())

    // Auto-start main clock if not already running (timer sync)
    if (!activeSession) {
      const act = activities.find(a => a.id === (task.actId || selectedActId)) ?? activities[0]
      if (act) {
        setActiveSession({
          id: 's' + Date.now(),
          actId: act.id,
          actName: act.name,
          actColor: act.color,
          startTs: Date.now(),
          dateKey,
        })
      }
    }
  }

  function stopTimer(taskId: string) {
    const endTs = Date.now()
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        const sessions = (t.sessions ?? []).map(s =>
          s.endTs === null ? { ...s, endTs } : s
        )
        return { ...t, timerEnd: endTs, sessions }
      }),
    }))
    setActiveTaskTimer(null)
  }

  function adjustTime(taskId: string, startTs: number, endTs: number, note: string) {
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        const sessionId = 'manual' + Date.now()
        const session: TaskSession = { id: sessionId, startTs, endTs, note, tags: [] }
        return { ...t, timerStart: startTs, timerEnd: endTs, sessions: [...(t.sessions ?? []), session] }
      }),
    }))
  }

  // ── Drag Reorder ──────────────────────────────────────────────────────────

  function handleDrop(targetId: string) {
    if (!dragItemId || dragItemId === targetId) { setDragItemId(null); return }
    const tasks = [...dayData.tasks]
    const fromIdx = tasks.findIndex(t => t.id === dragItemId)
    const toIdx = tasks.findIndex(t => t.id === targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragItemId(null); return }
    const [item] = tasks.splice(fromIdx, 1)
    tasks.splice(toIdx, 0, item)
    updateDay(dateKey, prev => ({ ...prev, tasks }))
    setDragItemId(null)
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  function updateNotes(notes: string) {
    updateDay(dateKey, prev => ({ ...prev, notes }))
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const doneCount = dayData.tasks.filter(t => t.done).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', maxHeight: '93vh' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)', background: 'var(--xp-bg3)' }}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all hover:opacity-80"
            style={{
              background: 'rgba(124,58,237,0.08)',
              border: '1px solid rgba(124,58,237,0.2)',
              color: 'var(--xp-acc)',
            }}
          >
            ← Back
          </button>
          <div className="text-center px-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>{dateLabel}</p>
            <p className="text-[9px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
              Single click = toggle productive · Double click = notes
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all hover:opacity-80"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: '#ef4444',
            }}
          >
            × Close
          </button>
        </div>

        {/* ── Toggles row ────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 flex-wrap flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <TogglePill active={dayData.productive} color="#16a34a" label="✅ Productive day" onClick={toggleProductive} />
          <TogglePill active={!!dayData.hyper} color="#f97316" label="🔥 Hyper Productive" onClick={toggleHyper} />
          <div style={{ flex: 1 }} />
          <button
            onClick={onDashboard}
            className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg font-medium text-white transition-all hover:opacity-85 flex-shrink-0"
            style={{ background: '#7c3aed' }}
          >
            📊 Today's Dashboard
          </button>
        </div>

        {/* Milestone + Goal row */}
        <div
          className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <TogglePill active={!!dayData.milestone} color="#7c3aed" label="🏆 Milestone day" onClick={toggleMilestone} />
          <TogglePill active={!!dayData.goal} color="#0891b2" label="🎯 Goal Achieved" onClick={toggleGoal} />
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Accomplishments section */}
          <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>

            {/* Section header */}
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--xp-txt)' }}>
                  Accomplishments
                  {dayData.tasks.length > 0 && (
                    <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--xp-txt3)' }}>
                      {doneCount}/{dayData.tasks.length} done
                    </span>
                  )}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>What I accomplished today</p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Edit mode toggle */}
                <button
                  onClick={() => setEditMode(o => !o)}
                  className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all"
                  style={{
                    background: editMode ? '#7c3aed11' : 'var(--xp-bg2)',
                    border: `1px solid ${editMode ? '#7c3aed' : 'var(--xp-bdr2)'}`,
                    color: editMode ? '#7c3aed' : 'var(--xp-txt3)',
                  }}
                >
                  ✏️ {editMode ? 'Done' : 'Edit'}
                </button>

                {/* Generate */}
                <button
                  onClick={generateTasks}
                  className="text-[10px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
                  style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
                >
                  ✨ Generate 3
                </button>

                {/* Add task — green */}
                <button
                  onClick={() => setAddingTask(true)}
                  className="text-[10px] px-2.5 py-1 rounded-lg text-white font-medium transition-opacity hover:opacity-85 flex-shrink-0"
                  style={{ background: '#16a34a' }}
                >
                  + Add Task
                </button>
              </div>
            </div>

            {/* Empty state */}
            {dayData.tasks.length === 0 && !addingTask && (
              <div className="text-center py-7">
                <div className="text-2xl mb-2">📋</div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--xp-txt)' }}>No accomplishments yet.</p>
                <p className="text-xs mb-4" style={{ color: 'var(--xp-txt3)' }}>Start with one small win.</p>
                <button
                  onClick={() => setAddingTask(true)}
                  className="text-xs px-5 py-2 rounded-full text-white font-medium transition-opacity hover:opacity-80"
                  style={{ background: '#16a34a' }}
                >
                  + Add Task
                </button>
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
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  onDuplicate={() => duplicateTask(task.id)}
                  onStartTimer={() => startTimer(task.id, index)}
                  onStopTimer={() => stopTimer(task.id)}
                  onJournalChange={text => updateTaskJournal(task.id, text)}
                  onTextChange={text => updateTaskText(task.id, text)}
                  onActChange={actId => updateTaskAct(task.id, actId)}
                  onAdjustTime={(s, e, n) => adjustTime(task.id, s, e, n)}
                  onDragStart={() => setDragItemId(task.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(task.id)}
                />
              ))}

              {/* Inline add input */}
              {addingTask && (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newTaskText}
                    onChange={e => setNewTaskText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addTask()
                      if (e.key === 'Escape') { setAddingTask(false); setNewTaskText('') }
                    }}
                    placeholder="What did you accomplish?"
                    className="flex-1 text-xs px-3 py-2 rounded-lg outline-none"
                    style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
                  />
                  <button
                    onClick={() => addTask()}
                    className="text-xs px-3.5 py-2 rounded-lg text-white transition-opacity hover:opacity-80 flex-shrink-0 font-medium"
                    style={{ background: '#16a34a' }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setAddingTask(false); setNewTaskText('') }}
                    className="text-sm px-2 py-1.5 flex-shrink-0 transition-colors hover:text-red-400"
                    style={{ color: 'var(--xp-txt3)' }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* Add accomplishment — purple solid */}
            {dayData.tasks.length > 0 && !addingTask && (
              <button
                onClick={() => setAddingTask(true)}
                className="mt-2 w-full text-xs py-2.5 rounded-xl text-white font-semibold transition-all hover:opacity-85"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                  boxShadow: '0 2px 10px rgba(124,58,237,0.35)',
                }}
              >
                + Add accomplishment
              </button>
            )}
          </div>

          {/* Journal notes — collapsible */}
          <div className="px-4 py-3">
            <button
              onClick={() => setNotesOpen(o => !o)}
              className="flex items-center gap-2 text-xs font-medium w-full text-left transition-colors hover:text-violet-500 mb-1"
              style={{ color: 'var(--xp-txt2)' }}
            >
              <span>{notesOpen ? '▾' : '▸'} Journal notes</span>
            </button>
            {notesOpen && (
              <textarea
                value={dayData.notes}
                onChange={e => updateNotes(e.target.value)}
                placeholder="What made today great? Reflections, insights, gratitude..."
                rows={4}
                className="w-full text-xs px-3 py-2.5 rounded-xl outline-none resize-none leading-relaxed"
                style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
              />
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderTop: '0.5px solid var(--xp-bdr)' }}
        >
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5"
            style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="text-xs px-5 py-1.5 rounded-full text-white font-medium transition-opacity hover:opacity-80"
            style={{ background: '#7c3aed' }}
          >
            ✓ Save
          </button>
        </div>
      </div>

      {/* Confetti — only on Goal Achieved activation */}
      {showConfetti && <ConfettiPop onDone={onConfettiDone} />}
    </div>
  )
}
