'use client'

import { useState, useRef } from 'react'
import { MonthCard } from './MonthCard'
import { APP_YEAR } from './utils'

const QUARTERS: { label: string; months: [number, number, number] }[] = [
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

const today = new Date()
const currentRealMonth = today.getMonth()
const currentQuarterLabel = QUARTERS[Math.floor(currentRealMonth / 3)].label

interface CalendarSectionProps {
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  onMonthZoom?: (month: number) => void
}

export function CalendarSection({ onDayDoubleClick, onMonthZoom }: CalendarSectionProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Q1: true, Q2: true, Q3: true, Q4: true,
  })
  const [flashMonth, setFlashMonth] = useState<number | null>(null)
  const currentMonthRef = useRef<HTMLDivElement | null>(null)

  function toggle(q: string) {
    setOpen(prev => ({ ...prev, [q]: !prev[q] }))
  }

  function jumpToToday() {
    // Expand the current quarter
    setOpen(prev => ({ ...prev, [currentQuarterLabel]: true }))
    // Brief flash on current month card
    setFlashMonth(currentRealMonth)
    setTimeout(() => setFlashMonth(null), 1200)
    // Scroll to current month
    setTimeout(() => {
      currentMonthRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
  }

  return (
    <div className="px-3 pb-6">
      {/* Controls row: hint + today button */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
          Single click to mark productive &middot; Double-click to add notes
        </p>
        <button
          onClick={jumpToToday}
          className="text-[10px] px-2.5 py-1 rounded-full border transition-colors hover:border-violet-400 hover:text-violet-500"
          style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt3)' }}
        >
          Today
        </button>
      </div>

      {/* Floating card container */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          maxWidth: 1160,
          margin: '0 auto',
        }}
      >
        {QUARTERS.map(q => (
          <div key={q.label} style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
            {/* Quarter toggle row */}
            <button
              onClick={() => toggle(q.label)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/3"
              style={{ color: 'var(--xp-txt2)' }}
            >
              <ChevronIcon open={open[q.label]} />
              <span className="text-xs font-semibold" style={{ color: 'var(--xp-acc)' }}>
                {q.label}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
                {APP_YEAR}
              </span>
            </button>

            {open[q.label] && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 pt-0">
                {q.months.map(m => (
                  <div
                    key={m}
                    ref={m === currentRealMonth ? currentMonthRef : null}
                    className="flex flex-col h-full"
                    style={{
                      transition: 'box-shadow 0.4s ease',
                      borderRadius: 12,
                      boxShadow: flashMonth === m ? '0 0 0 3px rgba(124,58,237,0.5)' : 'none',
                    }}
                  >
                    <MonthCard
                      month={m}
                      isCurrentMonth={m === currentRealMonth}
                      onDayDoubleClick={onDayDoubleClick}
                      onMonthZoom={onMonthZoom}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
