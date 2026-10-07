'use client'

// ── Transfer Task (Move / Copy to another date) ─────────────────────────────
//
// Move is always a true relocation: the task (and its family, if a parent)
// is removed from the origin day's task array and the exact same object —
// id, sessions, done state, and every other property — is inserted into the
// destination day's task array, unchanged. This applies regardless of how
// many tasks remain on the origin date or whether the task has logged
// session history; an origin date correctly becomes empty when its only
// task is moved. Because Analytics (getMonthStats/DayDashboardModal) sums a
// day's hours from whichever day's task array physically holds the task's
// sessions, moving a task with logged time also moves that logged time's
// Analytics attribution to the destination date — this is intentional.
//
// Copy never touches the origin at all, and always creates fresh task(s)
// (new id, zero sessions, not done) on the destination.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { dateKey as buildDateKey, isToday, MONTHS, DAY_HEADERS } from './utils'
import type { Task } from './types'

type TransferMode = 'move' | 'copy'

interface TransferTaskModalProps {
  // One task (the individual 3-dot "Move Task" action) or several (the
  // top-level bulk "Move" action) — same modal, same rules either way. Each
  // entry is treated as its own family (itself + its own children), exactly
  // like the single-task case always was.
  tasks: Task[]
  dateKey: string
  onClose: () => void
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function makeTransferId(seed: number): string {
  return 't' + (Date.now() + seed) + Math.random().toString(36).slice(2, 8)
}

function fmtShort(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function TransferTaskModal({ tasks, dateKey, onClose }: TransferTaskModalProps) {
  const { calData, updateDay, activeTaskTimer, setToast, effectiveTimezone } = useApp()

  const isMultiple = tasks.length > 1
  const anyDone = tasks.some(t => t.done)

  const originDate = useMemo(() => parseDateKey(dateKey), [dateKey])
  const [monthCursor, setMonthCursor] = useState(() => new Date(originDate.getFullYear(), originDate.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [mode, setMode] = useState<TransferMode>(anyDone ? 'copy' : 'move')
  const [showCompletedDialog, setShowCompletedDialog] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showCompletedDialog) { setShowCompletedDialog(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showCompletedDialog])

  // Each selected task is its own family (itself + its own children) — same
  // as the single-task case always was, just one per selected task now.
  const families = useMemo(
    () => tasks.map(root => ({
      root,
      members: [root, ...(calData[dateKey]?.tasks ?? []).filter(c => c.parentTaskId === root.id)],
    })),
    [calData, dateKey, tasks],
  )

  const isRunning = families.some(f => f.members.some(t => activeTaskTimer?.taskId === t.id && activeTaskTimer.dateKey === dateKey))

  const selectedKey = selectedDate ? buildDateKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : null
  const isSameAsOrigin = selectedKey === dateKey
  const canConfirm = !!selectedDate && !isSameAsOrigin && !isRunning

  // ── Mini month calendar ────────────────────────────────────────────────────
  const weeks = useMemo(() => {
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDow = new Date(year, month, 1).getDay()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [monthCursor])

  // Builds fresh (new-id, zero-session, not-done) copies of one family for
  // the destination day — used by Copy mode, factored out so bulk mode
  // applies it per-family without re-deriving the rules.
  function buildFreshFamily(members: Task[], rootId: string, seedOffset: number): Task[] {
    const idMap = new Map<string, string>()
    members.forEach((t, i) => idMap.set(t.id, makeTransferId(seedOffset + i)))
    return members.map(t => ({
      id: idMap.get(t.id)!,
      text: t.text,
      done: false,
      journal: t.journal,
      timerStart: null,
      timerEnd: null,
      actId: t.actId,
      sessions: [],
      taskColor: t.taskColor,
      isPriority: t.isPriority,
      // A transferred child keeps pointing at the new parent's id; the root
      // itself never carries a parentTaskId on the destination day, since
      // its actual parent (if any) stays behind on the origin day.
      ...(t.id !== rootId && t.parentTaskId ? { parentTaskId: idMap.get(t.parentTaskId) } : {}),
    }))
  }

  function performTransfer() {
    if (!canConfirm || !selectedDate || !selectedKey) return

    if (mode === 'copy') {
      const allFresh: Task[] = []
      families.forEach(({ root, members }) => {
        allFresh.push(...buildFreshFamily(members, root.id, allFresh.length))
      })
      updateDay(selectedKey, prev => ({ ...prev, tasks: [...prev.tasks, ...allFresh] }))
      setToast(isMultiple ? `${tasks.length} tasks copied to ${fmtShort(selectedDate)} ✓` : `Task copied to ${fmtShort(selectedDate)} ✓`)
    } else {
      // Always a true, lossless relocation — every member of every selected
      // family (root + children) is removed from the origin and the exact
      // same objects (id, sessions, done state, every property) land on the
      // destination, regardless of session history or how many tasks remain
      // on the origin date afterward. An origin date with its last task
      // moved away correctly ends up with zero tasks.
      const removeIds = new Set<string>()
      const destAdditions: Task[] = []
      families.forEach(({ root, members }) => {
        members.forEach(t => removeIds.add(t.id))
        members.forEach(t => destAdditions.push(t.id === root.id && t.parentTaskId ? { ...t, parentTaskId: undefined } : t))
      })
      if (removeIds.size > 0) {
        updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => !removeIds.has(t.id)) }))
      }
      if (destAdditions.length > 0) {
        updateDay(selectedKey, prev => ({ ...prev, tasks: [...prev.tasks, ...destAdditions] }))
      }
      setToast(isMultiple
        ? `${tasks.length} tasks moved to ${fmtShort(selectedDate)} ✓`
        : `Task moved to ${fmtShort(selectedDate)} ✓`)
    }
    onClose()
  }

  return (
    <div
      className="xp-transfer-backdrop fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onClose() }}
    >
      {/* Mobile-only: a touch stronger backdrop blur than the plain dimming
          used elsewhere, since this dialog stacks on top of the already-busy
          Task Manager. Matches the blur SettingsModal's own stacked
          "Unsaved Changes" dialog uses (blur(6px)) rather than a new value. */}
      <style>{`@media (max-width: 640px) { .xp-transfer-backdrop { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); } }`}</style>
      <div
        className="w-full max-w-[360px] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)', maxHeight: '100%' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)', flexShrink: 0 }}
        >
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold" style={{ color: '#ffffff' }}>Move Task</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {isMultiple ? 'Move or copy selected tasks to another date.' : 'Move or copy this task to another date.'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}
          >
            ✕
          </button>
        </div>

        <div className="px-4 pt-3.5" style={{ overflowY: 'auto', minHeight: 0 }}>
          {/* Task name — or a compact selected-count for bulk mode */}
          <p
            className="text-[12.5px] font-medium mb-3 truncate"
            style={{ color: 'var(--xp-txt)', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', borderRadius: 9, padding: '7px 10px' }}
            title={isMultiple ? undefined : tasks[0].text}
          >
            {isMultiple ? `${tasks.length} tasks selected` : (tasks[0].text || '(untitled task)')}
          </p>

          {isRunning && (
            <p className="text-[11.5px] mb-3" style={{ color: '#dc2626', background: 'rgba(220,38,38,0.08)', border: '0.5px solid rgba(220,38,38,0.22)', borderRadius: 9, padding: '8px 10px' }}>
              {isMultiple ? 'Stop the active timer before moving these tasks.' : 'Stop the active timer before transferring this task.'}
            </p>
          )}

          {/* Mode selector — purple = selected, white = available, gray = disabled */}
          <div className="flex flex-col gap-2 mb-3.5">
            <button
              onClick={() => setMode('copy')}
              className="text-left transition-colors duration-150"
              style={{
                borderRadius: 10, padding: '9px 11px',
                border: `1.5px solid ${mode === 'copy' ? '#7c3aed' : 'var(--xp-bdr2)'}`,
                background: mode === 'copy' ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'var(--xp-card)',
              }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: mode === 'copy' ? '#ffffff' : 'var(--xp-txt)' }}>📋 Copy to Date</span>
              <p className="text-[10.5px] mt-0.5" style={{ color: mode === 'copy' ? 'rgba(255,255,255,0.80)' : 'var(--xp-txt3)' }}>
                {isMultiple ? 'Creates copies on another date. The original tasks stay here.' : 'Creates a copy on another date. The original task stays here.'}
              </p>
            </button>

            <button
              onClick={() => { if (anyDone) setShowCompletedDialog(true); else setMode('move') }}
              className="text-left transition-colors duration-150"
              style={{
                borderRadius: 10, padding: '9px 11px',
                border: `1.5px solid ${anyDone ? 'var(--xp-bdr)' : mode === 'move' ? '#7c3aed' : 'var(--xp-bdr2)'}`,
                background: anyDone ? 'var(--xp-bg3)' : mode === 'move' ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'var(--xp-card)',
                opacity: anyDone ? 0.55 : 1,
                cursor: anyDone ? 'default' : 'pointer',
              }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: anyDone ? 'var(--xp-txt3)' : mode === 'move' ? '#ffffff' : 'var(--xp-txt)' }}>
                ➡️ Move to Date
              </span>
              <p className="text-[10.5px] mt-0.5" style={{ color: anyDone ? 'var(--xp-txt3)' : mode === 'move' ? 'rgba(255,255,255,0.80)' : 'var(--xp-txt3)' }}>
                {anyDone
                  ? (isMultiple
                      ? 'One or more selected tasks are completed and cannot be moved because their completion history belongs to the original date.'
                      : 'Completed tasks cannot be moved because their completion history belongs to the original date.')
                  : (isMultiple
                      ? 'Moves selected tasks to another date. The original tasks are removed from this day’s task list.'
                      : 'Moves this task to another date. The original task is removed from this day’s task list.')}
              </p>
            </button>
          </div>

          {/* Mini month calendar */}
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >
              ‹
            </button>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--xp-txt)', minWidth: 120, textAlign: 'center' }}>
              {MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </span>
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              aria-label="Next month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-[9.5px] font-semibold py-1" style={{ color: 'var(--xp-txt3)' }}>{d}</div>
            ))}
          </div>
          <div className="flex flex-col gap-0.5 mb-3.5">
            {weeks.map((row, ri) => (
              <div key={ri} className="grid grid-cols-7 gap-0.5">
                {row.map((d, ci) => {
                  if (!d) return <div key={ci} />
                  const key = buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())
                  const selected = key === selectedKey
                  const today = isToday(d.getFullYear(), d.getMonth(), d.getDate(), effectiveTimezone)
                  const isOriginDate = key === dateKey
                  return (
                    <button
                      key={ci}
                      onClick={() => setSelectedDate(d)}
                      className="aspect-square flex items-center justify-center text-[11px] relative"
                      style={{
                        borderRadius: 8,
                        fontWeight: selected ? 700 : today ? 600 : 500,
                        background: selected ? '#7c3aed' : 'transparent',
                        color: selected ? '#ffffff' : today ? '#7c3aed' : 'var(--xp-txt)',
                        border: !selected && today ? '1.5px solid #7c3aed' : '1.5px solid transparent',
                      }}
                      title={isOriginDate ? "Task's current date" : undefined}
                    >
                      {d.getDate()}
                      {isOriginDate && !selected && (
                        <span style={{ position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: '50%', background: '#7c3aed' }} />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {isSameAsOrigin && (
            <p className="text-[11px] mb-3" style={{ color: 'var(--xp-txt3)' }}>
              This is already the task&apos;s current date — pick another date to transfer it.
            </p>
          )}
        </div>

        {/* Actions — fixed footer, always reachable even if the content
            above has to scroll on a short mobile viewport. */}
        <div className="px-4 pt-2.5 pb-3.5 flex items-center gap-2.5" style={{ flexShrink: 0 }}>
          <button
            onClick={onClose}
            className="flex-1 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
            style={{ padding: '9px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}
          >
            Cancel
          </button>
          <button
            onClick={performTransfer}
            disabled={!canConfirm}
            className="flex-1 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
            style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed' }}
          >
            {selectedDate ? `${mode === 'copy' ? 'Copy' : 'Move'} to ${fmtShort(selectedDate)}` : (mode === 'copy' ? 'Copy' : 'Move')}
          </button>
        </div>
      </div>

      {showCompletedDialog && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={e => { e.stopPropagation(); setShowCompletedDialog(false) }}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl p-4"
            style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h4 className="text-[13.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Completed Task</h4>
              <button
                onClick={() => setShowCompletedDialog(false)}
                aria-label="Close"
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
              >
                ✕
              </button>
            </div>
            <p className="text-[11.5px] leading-relaxed mb-3.5" style={{ color: 'var(--xp-txt3)' }}>
              {isMultiple
                ? 'One or more selected tasks have already been completed, so they can’t be moved to another date because their completion history belongs to the original date.'
                : 'This task has already been completed, so it can’t be moved to another date because its completion history belongs to the original date.'}
              <br /><br />
              You can copy {isMultiple ? 'them' : 'it'} to another date instead.
            </p>
            <button
              onClick={() => setShowCompletedDialog(false)}
              className="w-full text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
