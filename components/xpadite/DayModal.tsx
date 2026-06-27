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

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
    <polyline points="3 6 5 6 21 6" strokeLinecap="round" />
    <path d="M19 6l-1 14H6L5 6" strokeLinecap="round" />
    <path d="M10 11v6M14 11v6" strokeLinecap="round" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
    <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
  </svg>
)

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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border"
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

interface TaskItemProps {
  task: Task
  isTimerActive: boolean
  now: number
  onToggle: () => void
  onDelete: () => void
  onStartTimer: () => void
  onStopTimer: () => void
}

function TaskItem({ task, isTimerActive, now, onToggle, onDelete, onStartTimer, onStopTimer }: TaskItemProps) {
  const hasTimer = task.timerStart !== null
  const elapsed = isTimerActive
    ? now - (task.timerStart ?? 0)
    : hasTimer && task.timerEnd
    ? task.timerEnd - (task.timerStart ?? 0)
    : 0

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg group transition-colors"
      style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className="w-[18px] h-[18px] rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150"
        style={{
          borderColor: task.done ? '#16a34a' : 'var(--xp-bdr2)',
          background: task.done ? '#16a34a' : 'transparent',
        }}
      >
        {task.done && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
      </button>

      {/* Task text */}
      <span
        className="flex-1 text-xs leading-relaxed"
        style={{
          color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)',
          textDecoration: task.done ? 'line-through' : 'none',
        }}
      >
        {task.text}
      </span>

      {/* Timer display */}
      {hasTimer && (
        <span
          className="text-[10px] font-mono flex-shrink-0"
          style={{ color: isTimerActive ? '#16a34a' : 'var(--xp-txt3)' }}
        >
          {isTimerActive ? formatMs(elapsed) : formatMs(elapsed)}
        </span>
      )}

      {/* Timer start/end display when stopped */}
      {hasTimer && !isTimerActive && task.timerStart && task.timerEnd && (
        <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>
          {formatTime(task.timerStart)}→{formatTime(task.timerEnd)}
        </span>
      )}

      {/* Controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {!isTimerActive ? (
          <button
            onClick={onStartTimer}
            className="p-1 rounded transition-colors hover:bg-green-500/15"
            title="Start timer"
            style={{ color: 'var(--xp-txt3)' }}
          >
            <PlayIcon />
          </button>
        ) : (
          <button
            onClick={onStopTimer}
            className="p-1 rounded transition-colors hover:bg-red-500/15"
            title="Stop timer"
            style={{ color: '#ef4444' }}
          >
            <StopIcon />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1 rounded transition-all duration-150 opacity-0 group-hover:opacity-100 hover:bg-red-500/15"
          title="Delete task"
          style={{ color: '#ef4444' }}
        >
          <TrashIcon />
        </button>
      </div>
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
  const [now, setNow] = useState(Date.now())

  const dateLabel = useMemo(() => {
    const d = new Date(APP_YEAR, month, day)
    return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${MONTHS[month]} ${day}`
  }, [month, day])

  // Sync active timer from task state
  useEffect(() => {
    const running = dayData.tasks.find(t => t.timerStart !== null && t.timerEnd === null)
    setActiveTimerTaskId(running?.id ?? null)
  }, [dayData.tasks])

  // Live clock tick
  useEffect(() => {
    if (!activeTimerTaskId) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [activeTimerTaskId])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Day toggles
  function toggleProductive() {
    updateDay(dateKey, prev => ({
      ...prev,
      productive: !prev.productive,
      hyper: prev.productive ? false : prev.hyper,
    }))
  }

  function toggleHyper() {
    updateDay(dateKey, prev => ({
      ...prev,
      hyper: !prev.hyper,
      productive: !prev.hyper ? true : prev.productive,
    }))
  }

  function toggleMilestone() {
    updateDay(dateKey, prev => ({
      ...prev,
      milestone: !prev.milestone,
      productive: !prev.milestone ? true : prev.productive,
    }))
  }

  // Task CRUD
  function addTask() {
    const text = newTaskText.trim()
    if (!text) return
    const task: Task = {
      id: 't' + Date.now(),
      text,
      done: false,
      journal: '',
      timerStart: null,
      timerEnd: null,
      actId: '',
    }
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, task] }))
    setNewTaskText('')
    setAddingTask(false)
  }

  function toggleTask(id: string) {
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t),
    }))
  }

  function deleteTask(id: string) {
    if (activeTimerTaskId === id) setActiveTimerTaskId(null)
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) }))
  }

  function startTimer(id: string) {
    // Stop any other running timer first
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
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === id ? { ...t, timerEnd: Date.now() } : t),
    }))
    setActiveTimerTaskId(null)
  }

  function updateNotes(notes: string) {
    updateDay(dateKey, prev => ({ ...prev, notes }))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          maxHeight: '90vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest font-medium mb-0.5" style={{ color: 'var(--xp-txt3)' }}>
              Day Details
            </p>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>
              {dateLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-black/8 mt-0.5"
            style={{ color: 'var(--xp-txt3)' }}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {/* Day type toggles */}
          <div
            className="flex items-center gap-2 px-5 py-3 flex-wrap"
            style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
          >
            <TogglePill
              active={dayData.productive}
              color="#16a34a"
              label="✅ Productive"
              onClick={toggleProductive}
            />
            <TogglePill
              active={dayData.hyper}
              color="#f97316"
              label="🔥 Hyper"
              onClick={toggleHyper}
            />
            <TogglePill
              active={!!dayData.milestone}
              color="#7c3aed"
              label="🏆 Milestone"
              onClick={toggleMilestone}
            />
          </div>

          {/* Tasks */}
          <div
            className="px-5 py-4"
            style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold" style={{ color: 'var(--xp-txt)' }}>
                Tasks
                {dayData.tasks.length > 0 && (
                  <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--xp-txt3)' }}>
                    {dayData.tasks.filter(t => t.done).length}/{dayData.tasks.length}
                  </span>
                )}
              </span>
              <button
                onClick={() => setAddingTask(true)}
                className="text-[11px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
                style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
              >
                + Add task
              </button>
            </div>

            <div className="space-y-1.5">
              {dayData.tasks.length === 0 && !addingTask && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--xp-txt3)' }}>
                  No tasks yet. Click &quot;+ Add task&quot; to begin.
                </p>
              )}

              {dayData.tasks.map(task => (
                <TaskItem
                  key={task.id}
                  task={task}
                  isTimerActive={activeTimerTaskId === task.id}
                  now={now}
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  onStartTimer={() => startTimer(task.id)}
                  onStopTimer={() => stopTimer(task.id)}
                />
              ))}

              {addingTask && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    autoFocus
                    type="text"
                    value={newTaskText}
                    onChange={e => setNewTaskText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addTask()
                      if (e.key === 'Escape') { setAddingTask(false); setNewTaskText('') }
                    }}
                    placeholder="Task name…"
                    className="flex-1 text-xs px-3 py-2 rounded-lg outline-none transition-colors"
                    style={{
                      border: '1px solid var(--xp-acc)',
                      background: 'var(--xp-bg3)',
                      color: 'var(--xp-txt)',
                    }}
                  />
                  <button
                    onClick={addTask}
                    className="text-xs px-3 py-2 rounded-lg text-white transition-opacity hover:opacity-80 flex-shrink-0"
                    style={{ background: '#7c3aed' }}
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setAddingTask(false); setNewTaskText('') }}
                    className="text-sm px-2 py-1.5 rounded-lg transition-colors hover:bg-black/5 flex-shrink-0"
                    style={{ color: 'var(--xp-txt3)' }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="px-5 py-4">
            <label
              className="block text-xs font-semibold mb-2"
              style={{ color: 'var(--xp-txt)' }}
            >
              Notes
            </label>
            <textarea
              value={dayData.notes}
              onChange={e => updateNotes(e.target.value)}
              placeholder="Write your thoughts, wins, or reflections for this day…"
              rows={3}
              className="w-full text-xs px-3 py-2.5 rounded-xl outline-none resize-none transition-colors leading-relaxed"
              style={{
                border: '1px solid var(--xp-bdr2)',
                background: 'var(--xp-bg3)',
                color: 'var(--xp-txt)',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderTop: '0.5px solid var(--xp-bdr)' }}
        >
          <button
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
            style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
            onClick={() => {}}
          >
            📊 Day Dashboard
          </button>
          <button
            onClick={onClose}
            className="text-xs px-5 py-1.5 rounded-full text-white transition-opacity hover:opacity-80"
            style={{ background: '#7c3aed' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
