'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { dateKey as buildDateKey, isToday, MONTHS, DAY_HEADERS } from './utils'

interface SendToPlannerModalProps {
  taskText: string
  sourceDate: string     // dateKey of the TM source — calendar opens here and is pre-selected
  onSend: (destDateKey: string) => void
  onClose: () => void
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtShort(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function SendToPlannerModal({ taskText, sourceDate, onSend, onClose }: SendToPlannerModalProps) {
  const { effectiveTimezone } = useApp()

  const sourceAsDate = useMemo(() => parseDateKey(sourceDate), [sourceDate])
  const [monthCursor, setMonthCursor] = useState(() => new Date(sourceAsDate.getFullYear(), sourceAsDate.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date>(sourceAsDate)  // pre-select TM date

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedKey = buildDateKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())

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

  return (
    <div
      className="xp-stp-backdrop fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onClose() }}
    >
      <style>{`@media (max-width: 640px) { .xp-stp-backdrop { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); } }`}</style>
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
            <h3 className="text-[14px] font-semibold" style={{ color: '#ffffff' }}>Send to Planner</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Choose which Planner date to send this task to.
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
          {/* Task name */}
          <p
            className="text-[12.5px] font-medium mb-3 truncate"
            style={{ color: 'var(--xp-txt)', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', borderRadius: 9, padding: '7px 10px' }}
            title={taskText || undefined}
          >
            {taskText || '(untitled task)'}
          </p>

          {/* Month navigation */}
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >‹</button>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--xp-txt)', minWidth: 120, textAlign: 'center' }}>
              {MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </span>
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              aria-label="Next month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >›</button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-[9.5px] font-semibold py-1" style={{ color: 'var(--xp-txt3)' }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="flex flex-col gap-0.5 mb-3.5">
            {weeks.map((row, ri) => (
              <div key={ri} className="grid grid-cols-7 gap-0.5">
                {row.map((d, ci) => {
                  if (!d) return <div key={ci} />
                  const key = buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())
                  const selected = key === selectedKey
                  const today = isToday(d.getFullYear(), d.getMonth(), d.getDate(), effectiveTimezone)
                  return (
                    <button
                      key={ci}
                      onClick={() => setSelectedDate(d)}
                      className="aspect-square flex items-center justify-center text-[11px]"
                      style={{
                        borderRadius: 8,
                        fontWeight: selected ? 700 : today ? 600 : 500,
                        background: selected ? '#7c3aed' : 'transparent',
                        color: selected ? '#ffffff' : today ? '#7c3aed' : 'var(--xp-txt)',
                        border: !selected && today ? '1.5px solid #7c3aed' : '1.5px solid transparent',
                      }}
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 pt-2.5 pb-3.5 flex items-center gap-2.5" style={{ flexShrink: 0 }}>
          <button
            onClick={onClose}
            className="flex-1 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
            style={{ padding: '9px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSend(selectedKey)}
            className="flex-1 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed' }}
          >
            Send to {fmtShort(selectedDate)}
          </button>
        </div>
      </div>
    </div>
  )
}
