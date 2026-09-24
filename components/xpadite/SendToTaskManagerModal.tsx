'use client'

// ── Send (Planner checklist items) → Task Manager ────────────────────────────
// Same modal shell/mini-calendar language as TransferSectionModal.tsx (which
// itself mirrors TransferTaskModal.tsx) — reused here for the one remaining
// decision this bridge needs: which date the new Task Manager tasks land on.
// This is always a SEND/COPY — the Planner document itself is never touched
// by this modal; that's enforced by the caller, not here.

import { useMemo, useState } from 'react'
import { dateKey as buildDateKey, isToday, todayKey, MONTHS, DAY_HEADERS } from './utils'

interface SendToTaskManagerModalProps {
  count: number
  onCancel: () => void
  onConfirm: (destDateKey: string) => void
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function SendToTaskManagerModal({ count, onCancel, onConfirm }: SendToTaskManagerModalProps) {
  const today = useMemo(() => parseDateKey(todayKey()), [])
  const [monthCursor, setMonthCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date>(today)

  const selectedKey   = buildDateKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
  const isTodaySel    = selectedKey === todayKey()

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
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onCancel() }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl overflow-hidden"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}
        >
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold" style={{ color: '#ffffff' }}>Send to Task Manager</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {count} {count === 1 ? 'task' : 'tasks'} will be added.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3.5">
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
          <div className="flex flex-col gap-0.5 mb-3">
            {weeks.map((row, ri) => (
              <div key={ri} className="grid grid-cols-7 gap-0.5">
                {row.map((d, ci) => {
                  if (!d) return <div key={ci} />
                  const key = buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())
                  const selected = key === selectedKey
                  const isTodayCell = isToday(d.getFullYear(), d.getMonth(), d.getDate())
                  return (
                    <button
                      key={ci}
                      onClick={() => setSelectedDate(d)}
                      className="aspect-square flex items-center justify-center text-[11px]"
                      style={{
                        borderRadius: 8,
                        fontWeight: selected ? 700 : isTodayCell ? 600 : 500,
                        background: selected ? '#7c3aed' : 'transparent',
                        color: selected ? '#ffffff' : isTodayCell ? '#7c3aed' : 'var(--xp-txt)',
                        border: !selected && isTodayCell ? '1.5px solid #7c3aed' : '1.5px solid transparent',
                      }}
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <p className="text-[11px] mb-3.5" style={{ color: 'var(--xp-txt3)' }}>
            Date: <span style={{ fontWeight: 600, color: 'var(--xp-txt2)' }}>{isTodaySel ? 'Today' : `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`}</span>
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={onCancel}
              className="flex-1 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
              style={{ padding: '9px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selectedKey)}
              className="flex-1 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed' }}
            >
              Send {count} {count === 1 ? 'Task' : 'Tasks'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
