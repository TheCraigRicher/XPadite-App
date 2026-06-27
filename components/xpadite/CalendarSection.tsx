'use client'

import { useState } from 'react'
import { MonthCard } from './MonthCard'
import { APP_YEAR } from './utils'

const QUARTERS = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
]

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-3.5 h-3.5 transition-transform duration-200"
    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
  >
    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const currentRealMonth = new Date().getMonth()

interface CalendarSectionProps {
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  onMonthDashboard?: (month: number) => void
}

export function CalendarSection({ onDayDoubleClick, onMonthDashboard }: CalendarSectionProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Q1: true,
    Q2: true,
    Q3: true,
    Q4: true,
  })

  function toggle(q: string) {
    setOpen(prev => ({ ...prev, [q]: !prev[q] }))
  }

  return (
    <div className="px-3 pb-6">
      {/* Hint */}
      <p
        className="text-center text-[10px] mb-3"
        style={{ color: 'var(--xp-txt3)' }}
      >
        Single click to mark productive &middot; Double click to add notes
      </p>

      {QUARTERS.map(q => (
        <div key={q.label} className="mb-3">
          {/* Quarter header / collapse toggle */}
          <button
            onClick={() => toggle(q.label)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg mb-2 text-left transition-colors hover:opacity-80"
            style={{
              color: 'var(--xp-txt2)',
              background: 'var(--xp-bg3)',
              border: '0.5px solid var(--xp-bdr)',
            }}
          >
            <ChevronIcon open={open[q.label]} />
            <span className="text-xs font-semibold" style={{ color: 'var(--xp-acc)' }}>
              {q.label}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
              {APP_YEAR}
            </span>
          </button>

          {/* 3-column grid of month cards */}
          {open[q.label] && (
            <div className="grid grid-cols-3 gap-2">
              {q.months.map(m => (
                <MonthCard
                  key={m}
                  month={m}
                  isCurrentMonth={m === currentRealMonth}
                  onDayDoubleClick={onDayDoubleClick}
                  onMonthDashboard={onMonthDashboard}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
