'use client'

// ── Task Manager: "Due Date" modal (v1.345) ──────────────────────────────────────────────────────────────────────────────────────────
// Opened from a task's three-dot menu. Two kinds of task:
//   • an ordinary task — set / edit / remove its OWN due date (stored on the task: { date, time?, dateOnly }); date-only deadlines stay valid through the
//     end of that date, timed ones respect the time (always read in the user's selected timezone).
//   • a task linked to a My Schedule deadline — the due date belongs to the event, so it is shown read-only with a link to edit it there.
// Mark Complete / Completed works on the task itself (the same checkbox state the Task Manager already uses; a linked deadline follows it automatically).

import { useState } from 'react'
import { useApp } from './AppContext'
import { useEscapeLayer } from './escapeLayers'
import { useDeadlineActions } from './useDeadlines'
import { isDeadlineTask } from './deadlineLink'
import { completionPatch, dueInfo, formatDueDate, formatDueTime, taskDueInstant } from './dueStatus'
import { AssignedDateNote, CompleteControl, DueChip } from './DeadlineStatus'
import type { Task } from './types'

const field: React.CSSProperties = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: 10, border: '0.5px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)', fontSize: 14, outline: 'none' }

export function TaskDueDateModal({ task, dateKey, onClose }: { task: Task; dateKey: string; onClose: () => void }) {
  const { scheduleEvents, effectiveTimezone: tz, scheduleTimeFormat, requestScheduleEvent, setToast, updateDay } = useApp()
  const { setTaskDue } = useDeadlineActions()
  useEscapeLayer(true, onClose)
  const [now] = useState(() => Date.now())

  const ev = task.sourceEventId ? scheduleEvents.find(e => e.id === task.sourceEventId) : undefined
  const isDl = isDeadlineTask(task) && !!ev?.isDeadline
  const own = !task.sourceEventId
  const [date, setDate] = useState(task.due?.date ?? dateKey)
  const [hasTime, setHasTime] = useState(!!task.due && !task.due.dateOnly && !!task.due.time)
  const [time, setTime] = useState(task.due?.time ?? '17:00')
  const hour12 = scheduleTimeFormat !== '24h'

  const dueAt = isDl && ev ? ev.endAt : own && task.due ? taskDueInstant(task.due, tz) : null
  const info = dueAt != null ? dueInfo({ dueAt, done: task.done, completedAt: task.completedAt }, now, tz) : null
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const timeOk = !hasTime || /^\d{2}:\d{2}$/.test(time)

  const setDone = (next: boolean) => {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => (t.id === task.id ? { ...t, ...completionPatch(next) } : t)) }))
    setToast(next ? 'Marked complete ✓' : 'Marked as not completed')
  }
  const save = () => {
    if (!dateOk || !timeOk) return
    setTaskDue(dateKey, task.id, { date, time: hasTime ? time : null, dateOnly: !hasTime })
    setToast('Due date saved ✓'); onClose()
  }
  const remove = () => { setTaskDue(dateKey, task.id, null); setToast('Due date removed'); onClose() }

  const dlg = (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} data-testid="task-due-modal">
      <div role="dialog" aria-modal="true" aria-label="Due Date" className="w-full max-w-[340px] rounded-2xl shadow-2xl" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)', borderRadius: '16px 16px 0 0', padding: '16px 20px 14px', textAlign: 'center' }}>
          <p style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>Due Date</p>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.text || 'Untitled task'}</p>
        </div>
        <div style={{ padding: '16px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {info && dueAt != null && (
            <div data-testid="due-current" className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5, color: 'var(--xp-txt2)' }}>
              <DueChip info={info} />
              <span>{formatDueDate(dueAt, tz)}{own && task.due?.dateOnly ? <> &middot; all day</> : <> &middot; {formatDueTime(dueAt, tz, hour12)}</>}</span>
            </div>
          )}
          {isDl && dueAt != null && <AssignedDateNote assignedKey={dateKey} dueAt={dueAt} tz={tz} hour12={hour12} />}
          {isDl && (
            <p style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--xp-txt3)' }}>
              This task is a My Schedule deadline, so its due date is set there.{' '}
              <button type="button" data-testid="due-edit-in-schedule" onClick={() => { onClose(); if (task.sourceEventId) requestScheduleEvent(task.sourceEventId) }} style={{ fontWeight: 700, color: '#7c3aed', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Edit in My Schedule &rarr;</button>
            </p>
          )}
          {!own && !isDl && <p style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--xp-txt3)' }}>This task comes from a My Schedule event, which is not a due date. Mark the event &ldquo;Set as Due Date&rdquo; in My Schedule to make it a deadline.</p>}

          {own && (
            <>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--xp-txt3)' }}>Date
                <input type="date" data-testid="due-date-input" value={date} onChange={e => setDate(e.target.value)} style={{ ...field, marginTop: 4 }} />
              </label>
              <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--xp-txt2)', cursor: 'pointer' }}>
                <input type="checkbox" data-testid="due-has-time" checked={hasTime} onChange={e => setHasTime(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#7c3aed' }} />
                <span>Add a deadline time <span style={{ color: 'var(--xp-txt3)' }}>(otherwise it is due at the end of the day)</span></span>
              </label>
              {hasTime && (
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--xp-txt3)' }}>Time
                  <input type="time" data-testid="due-time-input" value={time} onChange={e => setTime(e.target.value)} style={{ ...field, marginTop: 4 }} />
                </label>
              )}
            </>
          )}

          {(own ? !!task.due : isDl) && (
            <div className="flex flex-wrap items-center gap-2" data-testid="due-complete-row">
              <CompleteControl done={task.done} onMark={() => setDone(true)} onReopen={() => setDone(false)} />
            </div>
          )}

          <div className="flex items-center justify-between gap-2" style={{ marginTop: 4 }}>
            {own && task.due ? <button type="button" data-testid="due-remove" onClick={remove} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px' }}>Remove due date</button> : <span />}
            <div className="flex items-center gap-2">
              <button type="button" data-testid="due-cancel" onClick={onClose} style={{ minHeight: 38, padding: '0 16px', borderRadius: 10, border: '0.5px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt2)', fontSize: 13, cursor: 'pointer' }}>{own ? 'Cancel' : 'Close'}</button>
              {own && <button type="button" data-testid="due-save" disabled={!dateOk || !timeOk} onClick={save} style={{ minHeight: 38, padding: '0 18px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !dateOk || !timeOk ? 0.5 : 1 }}>Save</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
  // rendered in place (not portalled to <body>): the app's theme variables (--xp-card, --xp-bdr2 …) live on the app wrapper, so a body-level portal would lose them
  return dlg
}
