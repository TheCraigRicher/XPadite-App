'use client'

import { useState, useEffect, useMemo } from 'react'
import { useApp, EMPTY_DAY } from './AppContext'
import type { Task } from './types'
import { formatMs, formatTime, MONTHS, APP_YEAR } from './utils'

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

const GENERATED_TASKS = [
  'Complete morning planning and set daily priorities',
  'Focus on primary work goal for 2+ hours uninterrupted',
  'Review progress and document key learnings',
]

interface TogglePillProps {
  active: boolean
  color: string
  label: string
  onClick: () => void
}

function TogglePill({ active, color, label, onClick }: TogglePillProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border select-none"
      style={{
        borderColor: active ? color : 'var(--xp-bdr2)',
        background: active ? `${color}1e` : 'transparent',
        color: active ? color : 'var(--xp-txt3)',
      }}
    >
      {label}
    </button>
  )
}

interface TaskRowProps {
  task: Task
  isTimerActive: boolean
  now: number
  onToggle: () => void
  onDelete: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  onJournalChange: (text: string) => void
}

function TaskRow({ task, isTimerActive, now, onToggle, onDelete, onStartTimer, onStopTimer, onJournalChange }: TaskRowProps) {
  const [journalOpen, setJournalOpen] = useState(false)
  const elapsed = isTimerActive
    ? now - (task.timerStart ?? 0)
    : task.timerStart && task.timerEnd
    ? task.timerEnd - task.timerStart
    : 0

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--xp-bdr)', background: 'var(--xp-bg3)' }}>
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2.5 group">
        {/* Drag handle */}
        <span className="text-[11px] cursor-grab select-none flex-shrink-0" style={{ color: 'var(--xp-bdr2)' }}>⠿</span>

        {/* Checkbox */}
        <button
          onClick={onToggle}
          className="w-[18px] h-[18px] rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150"
          style={{ borderColor: task.done ? '#16a34a' : 'var(--xp-bdr2)', background: task.done ? '#16a34a' : 'transparent' }}
        >
          {task.done && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
        </button>

        {/* Text */}
        <span
          className="flex-1 text-xs leading-relaxed min-w-0"
          style={{ color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)', textDecoration: task.done ? 'line-through' : 'none' }}
        >
          {task.text}
        </span>

        {/* Timer display */}
        {task.timerStart !== null && (
          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: isTimerActive ? '#16a34a' : 'var(--xp-txt3)' }}>
            {formatMs(elapsed)}
          </span>
        )}
        {task.timerStart && task.timerEnd && !isTimerActive && (
          <span className="text-[9px] flex-shrink-0 hidden sm:inline" style={{ color: 'var(--xp-txt3)' }}>
            {formatTime(task.timerStart)}→{formatTime(task.timerEnd)}
          </span>
        )}

        {/* Timer control */}
        {!isTimerActive ? (
          <button onClick={onStartTimer} className="p-1 rounded hover:bg-green-500/15 transition-colors flex-shrink-0" style={{ color: 'var(--xp-txt3)' }} title="Start timer">
            <PlayIcon />
          </button>
        ) : (
          <button onClick={onStopTimer} className="p-1 rounded hover:bg-red-500/15 transition-colors flex-shrink-0" style={{ color: '#ef4444' }} title="Stop timer">
            <StopIcon />
          </button>
        )}

        {/* Delete */}
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-red-500/15 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0 text-sm"
          style={{ color: '#ef4444' }}
          title="Delete"
        >
          ×
        </button>

        {/* Journal toggle */}
        <button
          onClick={() => setJournalOpen(o => !o)}
          className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-black/5 flex-shrink-0"
          style={{ color: 'var(--xp-txt3)' }}
        >
          {journalOpen ? '▴' : '▾'} Journal
        </button>
      </div>

      {/* Journal notes inline dropdown */}
      {journalOpen && (
        <div className="px-3 pb-2.5 pt-1" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <textarea
            value={task.journal}
            onChange={e => onJournalChange(e.target.value)}
            placeholder="What made this task meaningful?"
            rows={2}
            className="w-full text-xs px-2.5 py-2 rounded-lg outline-none resize-none transition-colors leading-relaxed"
            style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)' }}
          />
        </div>
      )}
    </div>
  )
}

interface DayModalProps {
  dateKey: string
  month: number
  day: number
  onClose: () => void
}

export function DayModal({ dateKey, month, day, onClose }: DayModalProps) {
  const { calData, updateDay } = useApp()
  const dayData = calData[dateKey] ?? { ...EMPTY_DAY }

  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [activeTimerTaskId, setActiveTimerTaskId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  const dateLabel = useMemo(() => {
    const d = new Date(APP_YEAR, month, day)
    return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${MONTHS[month]} ${day}`
  }, [month, day])

  useEffect(() => {
    const running = dayData.tasks.find(t => t.timerStart !== null && t.timerEnd === null)
    setActiveTimerTaskId(running?.id ?? null)
  }, [dayData.tasks])

  useEffect(() => {
    if (!activeTimerTaskId) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [activeTimerTaskId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Toggles
  function toggleProductive() {
    updateDay(dateKey, prev => ({ ...prev, productive: !prev.productive, hyper: prev.productive ? false : prev.hyper }))
  }
  function toggleHyper() {
    updateDay(dateKey, prev => ({ ...prev, hyper: !prev.hyper, productive: !prev.hyper ? true : prev.productive }))
  }
  function toggleMilestone() {
    updateDay(dateKey, prev => ({ ...prev, milestone: !prev.milestone, productive: !prev.milestone ? true : prev.productive }))
  }

  // Tasks
  function addTask(text?: string) {
    const t = (text ?? newTaskText).trim()
    if (!t) return
    const task: Task = { id: 't' + Date.now(), text: t, done: false, journal: '', timerStart: null, timerEnd: null, actId: '' }
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, task] }))
    setNewTaskText('')
    setAddingTask(false)
  }

  function generateTasks() {
    const existing = new Set(dayData.tasks.map(t => t.text))
    const toAdd = GENERATED_TASKS.filter(t => !existing.has(t))
    if (!toAdd.length) return
    const newTasks: Task[] = toAdd.map(text => ({
      id: 't' + Date.now() + Math.random(),
      text, done: false, journal: '', timerStart: null, timerEnd: null, actId: '',
    }))
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, ...newTasks] }))
  }

  function toggleTask(id: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  function deleteTask(id: string) {
    if (activeTimerTaskId === id) setActiveTimerTaskId(null)
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) }))
  }

  function startTimer(id: string) {
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id === id) return { ...t, timerStart: Date.now(), timerEnd: null }
        if (t.timerStart !== null && t.timerEnd === null) return { ...t, timerEnd: Date.now() }
        return t
      }),
    }))
    setActiveTimerTaskId(id)
    setNow(Date.now())
  }

  function stopTimer(id: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, timerEnd: Date.now() } : t) }))
    setActiveTimerTaskId(null)
  }

  function updateTaskJournal(id: string, journal: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, journal } : t) }))
  }

  function updateNotes(notes: string) {
    updateDay(dateKey, prev => ({ ...prev, notes }))
  }

  const doneCount = dayData.tasks.filter(t => t.done).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <button onClick={onClose} className="flex items-center gap-1 text-xs transition-colors hover:text-violet-500" style={{ color: 'var(--xp-txt2)' }}>
            ← Back
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>{dateLabel}</p>
            <p className="text-[9px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Single click = toggle productive · Double click = notes</p>
          </div>
          <button onClick={onClose} className="text-xs transition-colors hover:text-red-400" style={{ color: 'var(--xp-txt3)' }}>
            × Close
          </button>
        </div>

        {/* Toggles row */}
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <TogglePill active={dayData.productive} color="#16a34a" label="✅ Productive day" onClick={toggleProductive} />
          <TogglePill active={dayData.hyper} color="#f97316" label="🔥 Hyper" onClick={toggleHyper} />
          <div style={{ flex: 1 }} />
          <button
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500 flex-shrink-0"
            style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
          >
            📊 Day Dashboard
          </button>
        </div>

        {/* Milestone row */}
        <div className="flex items-center px-4 py-2 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <TogglePill active={!!dayData.milestone} color="#7c3aed" label="🏆 Milestone day" onClick={toggleMilestone} />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Accomplishments section */}
          <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--xp-txt)' }}>Accomplishments</p>
                <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
                  What I accomplished
                  {dayData.tasks.length > 0 && (
                    <span className="ml-1">({doneCount}/{dayData.tasks.length})</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={generateTasks}
                  className="text-[10px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
                  style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
                  title="Add 3 suggested accomplishments (AI-powered coming soon)"
                >
                  ✨ Generate 3
                </button>
                <button
                  onClick={() => setAddingTask(true)}
                  className="text-[10px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
                  style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
                >
                  + Add task
                </button>
              </div>
            </div>

            {/* Empty state */}
            {dayData.tasks.length === 0 && !addingTask && (
              <div className="text-center py-6">
                <p className="text-xs" style={{ color: 'var(--xp-txt3)' }}>
                  No accomplishments yet.
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--xp-txt3)' }}>
                  Start with one small win.
                </p>
                <button
                  onClick={() => setAddingTask(true)}
                  className="text-xs px-4 py-1.5 rounded-full text-white transition-opacity hover:opacity-80"
                  style={{ background: '#7c3aed' }}
                >
                  + Add Task
                </button>
              </div>
            )}

            {/* Task list */}
            <div className="space-y-1.5">
              {dayData.tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isTimerActive={activeTimerTaskId === task.id}
                  now={now}
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  onStartTimer={() => startTimer(task.id)}
                  onStopTimer={() => stopTimer(task.id)}
                  onJournalChange={text => updateTaskJournal(task.id, text)}
                />
              ))}

              {/* Add task inline */}
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
                    className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                    style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
                  />
                  <button onClick={() => addTask()} className="text-xs px-3 py-2 rounded-lg text-white transition-opacity hover:opacity-80 flex-shrink-0" style={{ background: '#7c3aed' }}>Add</button>
                  <button onClick={() => { setAddingTask(false); setNewTaskText('') }} className="text-sm px-2 py-1.5 flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>×</button>
                </div>
              )}
            </div>

            {/* Add accomplishment CTA at bottom */}
            {dayData.tasks.length > 0 && !addingTask && (
              <button
                onClick={() => setAddingTask(true)}
                className="mt-2 w-full text-xs py-2 rounded-xl border border-dashed transition-colors hover:border-violet-400 hover:text-violet-500"
                style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
              >
                + Add accomplishment
              </button>
            )}
          </div>

          {/* Global journal notes — collapsible */}
          <div className="px-4 py-3">
            <button
              onClick={() => setNotesOpen(o => !o)}
              className="flex items-center gap-2 text-xs font-medium w-full text-left transition-colors hover:text-violet-500"
              style={{ color: 'var(--xp-txt2)' }}
            >
              <span>{notesOpen ? '▾' : '▸'} Journal notes</span>
            </button>
            {notesOpen && (
              <textarea
                value={dayData.notes}
                onChange={e => updateNotes(e.target.value)}
                placeholder="What made today great?"
                rows={4}
                className="mt-2 w-full text-xs px-3 py-2.5 rounded-xl outline-none resize-none transition-colors leading-relaxed"
                style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5"
            style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="text-xs px-5 py-1.5 rounded-full text-white transition-opacity hover:opacity-80"
            style={{ background: '#7c3aed' }}
          >
            ✓ Save
          </button>
        </div>
      </div>
    </div>
  )
}
