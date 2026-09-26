'use client'

import { useState, useRef, useMemo } from 'react'
import { MonthCard } from './MonthCard'
import { APP_YEAR, todayKeyInTz } from './utils'
import { useApp } from './AppContext'

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

interface CalendarSectionProps {
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  onMonthZoom?: (month: number) => void
  activeMonth?: number | null
  onShareYear?: () => void
  cleanView?: boolean
}

export function CalendarSection({ onDayDoubleClick, onMonthZoom, activeMonth, onShareYear, cleanView }: CalendarSectionProps) {
  const { effectiveTimezone } = useApp()
  // Derived from the user's effective timezone (not a stale module-level
  // constant) so "today"/"current quarter" stay correct across a midnight
  // boundary and for users whose timezone differs from the device's.
  const currentRealMonth = useMemo(() => {
    const [, m] = todayKeyInTz(effectiveTimezone).split('-')
    return parseInt(m, 10) - 1
  }, [effectiveTimezone])
  const currentQuarterLabel = QUARTERS[Math.floor(currentRealMonth / 3)].label

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
    <div className="-mx-2 px-1 sm:mx-0 sm:px-3 pb-4 sm:pb-6">
      {/* Floating card container */}
      <div
        className="rounded-2xl overflow-hidden xp-calendar-card"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr)',
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
              <div className="xp-month-row grid grid-cols-3 gap-1 sm:gap-3 p-1 sm:p-3 pt-0">
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
                      isZoomed={activeMonth === m}
                      onDayDoubleClick={onDayDoubleClick}
                      onMonthZoom={onMonthZoom}
                      cleanView={cleanView}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Share Year Progress button — secondary, beneath calendar breathing room */}
      {onShareYear && (
        <div className="flex justify-center mt-10 sm:mt-12 mb-5 sm:mb-6">
          <button
            onClick={onShareYear}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-semibold transition-all hover:opacity-90 active:scale-95"
            style={{
              fontSize: 12,
              background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              color: '#fff',
              boxShadow: '0 1px 8px rgba(124,58,237,0.25)',
            }}
          >
            <svg viewBox="0 0 20 18" fill="none" width="12" height="11" aria-hidden="true">
              <circle cx="16" cy="2"  r="2" fill="currentColor" />
              <circle cx="16" cy="15" r="2" fill="currentColor" />
              <circle cx="4"  cy="9"  r="2" fill="currentColor" />
              <line x1="6" y1="8"  x2="14" y2="3"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Share {APP_YEAR} Year Progress
          </button>
        </div>
      )}
    </div>
  )
}
