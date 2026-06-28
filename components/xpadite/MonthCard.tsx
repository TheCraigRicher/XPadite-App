'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useApp } from './AppContext'
import { dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR } from './utils'
import type { DayData } from './types'

function isStreakDay(data: DayData | undefined): boolean {
  if (!data) return false
  return !!(data.productive || data.hyper || data.milestone)
}

interface MonthCardProps {
  month: number
  isCurrentMonth: boolean
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  onMonthDashboard?: (month: number) => void
  onMonthZoom?: (month: number) => void
}

interface Cell {
  day: number
  key: string
  dayOfWeek: number
  isGhost: boolean
}

export function MonthCard({ month, isCurrentMonth, onDayDoubleClick, onMonthDashboard, onMonthZoom }: MonthCardProps) {
  const { calData, updateDay, setToast, isDark } = useApp()
  const gapColor = isDark ? '#1a1a28' : '#ffffff'

  const clickRef = useRef<{
    key: string | null
    count: number
    timer: ReturnType<typeof setTimeout> | null
  }>({ key: null, count: 0, timer: null })

  const { cells, totalDays } = useMemo<{ cells: Cell[]; totalDays: number }>(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const prevTd = new Date(APP_YEAR, month, 0).getDate() // last day of previous month
    const result: Cell[] = []

    // Ghost prefix (last days of previous month)
    for (let i = fd - 1; i >= 0; i--) {
      result.push({
        day: prevTd - i,
        key: `ghost-prev-${month}-${i}`,
        dayOfWeek: (fd - 1 - i) === -1 ? 6 : (fd - 1 - i),
        isGhost: true,
      })
    }

    // Real days
    for (let d = 1; d <= td; d++) {
      result.push({
        day: d,
        key: dateKey(APP_YEAR, month, d),
        dayOfWeek: (fd + d - 1) % 7,
        isGhost: false,
      })
    }

    // Ghost suffix (first days of next month)
    const remainder = result.length % 7
    const suffixCount = remainder === 0 ? 0 : 7 - remainder
    for (let d = 1; d <= suffixCount; d++) {
      result.push({
        day: d,
        key: `ghost-next-${month}-${d}`,
        dayOfWeek: (fd + td + d - 1) % 7,
        isGhost: true,
      })
    }

    return { cells: result, totalDays: td }
  }, [month])

  const handleCellClick = useCallback((key: string, day: number, wasStreak: boolean) => {
    if (clickRef.current.key !== key) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key, count: 0, timer: null }
    }
    clickRef.current.count++

    if (clickRef.current.count === 1) {
      clickRef.current.timer = setTimeout(() => {
        clickRef.current = { key: null, count: 0, timer: null }
        const becomingProductive = !wasStreak
        updateDay(key, prev => ({
          ...prev,
          productive: !prev.productive,
          hyper: prev.productive ? false : prev.hyper,
        }))
        if (becomingProductive) {
          setToast('Day Complete ✅  Great work. See you tomorrow.')
        }
      }, 260)
    } else if (clickRef.current.count === 2) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key: null, count: 0, timer: null }
      onDayDoubleClick?.(key, month, day)
    }
  }, [updateDay, setToast, onDayDoubleClick, month])

  return (
    <div
      className="rounded-xl p-2 transition-all duration-200"
      style={{
        background: isCurrentMonth ? '#eff6ff' : 'var(--xp-card)',
        border: isCurrentMonth ? '1px solid #bfdbfe' : '0.5px solid var(--xp-bdr)',
        boxShadow: isCurrentMonth ? '0 2px 8px rgba(59,130,246,0.08)' : 'none',
      }}
    >
      {/* Month header */}
      <div className="flex items-center justify-between mb-1.5">
        <button
          onClick={() => onMonthZoom?.(month)}
          className="text-[11px] font-semibold transition-colors hover:underline"
          style={{ color: isCurrentMonth ? '#2563eb' : 'var(--xp-txt)' }}
        >
          {MONTHS[month]}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onMonthDashboard?.(month) }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors hover:text-violet-500"
          style={{
            background: 'var(--xp-bg3)',
            border: '0.5px solid var(--xp-bdr2)',
            color: 'var(--xp-txt3)',
          }}
        >
          📊 Monthly Dashboard
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_HEADERS.map((d, i) => (
          <div key={d} className="text-center text-[7.5px] font-medium" style={{ color: i === 0 ? '#f97316' : 'var(--xp-txt3)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          if (cell.isGhost) {
            return (
              <div key={cell.key} className="aspect-square flex items-center justify-center text-[8px]" style={{ color: 'var(--xp-bdr2)' }}>
                {cell.day}
              </div>
            )
          }

          const dayData = calData[cell.key]
          const streak = isStreakDay(dayData)
          const productive = !!dayData?.productive
          const hyper = !!dayData?.hyper
          const milestone = !!dayData?.milestone
          const todayCell = isToday(APP_YEAR, month, cell.day)
          const isSun = cell.dayOfWeek === 0

          const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
          const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
          const connectLeft = streak && cell.dayOfWeek !== 0 && !!prevKey && isStreakDay(calData[prevKey])
          const connectRight = streak && cell.dayOfWeek !== 6 && !!nextKey && isStreakDay(calData[nextKey])

          // Connectors stop at circle edge (inset-[11%] → circle edge at 11% / 89%)
          const connL = connectLeft && (
            <div style={{ position: 'absolute', left: 0, right: '89%', top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )
          const connR = connectRight && (
            <div style={{ position: 'absolute', left: '89%', right: -1, top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )

          // ── Fire Day ────────────────────────────────────────────────
          if (hyper) {
            return (
              <div
                key={cell.key}
                className="aspect-square relative cursor-pointer select-none group"
                onClick={() => handleCellClick(cell.key, cell.day, streak)}
                title="Fire Day! Click to unmark · Double-click to edit"
              >
                {connL}{connR}
                <div
                  className="absolute inset-[3%] flex items-center justify-center group-hover:scale-110 transition-transform duration-150"
                  style={{ zIndex: 1 }}
                >
                  <span style={{ fontSize: '22px', lineHeight: 1, userSelect: 'none' }}>🔥</span>
                </div>
                <span
                  style={{
                    position: 'absolute', top: '46%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 2, fontSize: '6px', fontWeight: 900,
                    color: '#0a0a0a',
                    textShadow: '0 0 4px rgba(255,255,255,1), 0 0 8px rgba(255,255,255,0.8)',
                    pointerEvents: 'none',
                  }}
                >
                  {cell.day}
                </span>
              </div>
            )
          }

          // ── Trophy / Milestone Day ───────────────────────────────────
          if (milestone) {
            return (
              <div
                key={cell.key}
                className="aspect-square relative cursor-pointer select-none group"
                onClick={() => handleCellClick(cell.key, cell.day, streak)}
                title="Milestone! Click to unmark · Double-click to edit"
              >
                {connL}{connR}
                <div
                  className="absolute inset-[3%] flex items-center justify-center group-hover:scale-110 transition-transform duration-150"
                  style={{ zIndex: 1 }}
                >
                  <span style={{ fontSize: '22px', lineHeight: 1, userSelect: 'none' }}>🏆</span>
                </div>
                <span
                  style={{
                    position: 'absolute', top: '33%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 2, fontSize: '6px', fontWeight: 900,
                    color: '#0a0a0a',
                    textShadow: '0 0 4px rgba(255,255,255,1), 0 0 8px rgba(255,255,255,0.8)',
                    pointerEvents: 'none',
                  }}
                >
                  {cell.day}
                </span>
              </div>
            )
          }

          // ── Productive / Today / Default ─────────────────────────────
          let circleStyle: React.CSSProperties = { color: isSun ? '#f97316' : 'var(--xp-txt3)', fontSize: '9px' }

          if (productive) {
            circleStyle = {
              background: '#16a34a',
              color: 'white',
              fontSize: '9px',
              fontWeight: 600,
              boxShadow: `0 0 0 2px ${gapColor}, 0 0 0 4.5px rgba(22,163,74,0.7)`,
            }
          } else if (todayCell) {
            circleStyle = {
              color: 'var(--xp-acc)',
              background: 'rgba(124,58,237,0.08)',
              outline: '1.5px solid var(--xp-acc)',
              outlineOffset: '-1px',
              fontSize: '9px',
            }
          }

          return (
            <div
              key={cell.key}
              className="aspect-square relative cursor-pointer select-none group"
              onClick={() => handleCellClick(cell.key, cell.day, streak)}
              title={streak ? 'Click to unmark · Double-click to edit' : 'Click to mark productive'}
            >
              {connL}{connR}
              <div
                className="absolute inset-[11%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-110"
                style={{ zIndex: 1, ...circleStyle }}
              >
                {cell.day}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
