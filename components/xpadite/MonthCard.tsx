'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useApp } from './AppContext'
import { dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR } from './utils'
import type { DayData } from './types'

function isStreakDay(data: DayData | undefined): boolean {
  if (!data) return false
  return !!(data.productive || data.hyper || data.milestone)
}

const ChartBarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
    <line x1="18" y1="20" x2="18" y2="10" strokeLinecap="round" />
    <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" />
    <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" />
  </svg>
)

interface MonthCardProps {
  month: number
  isCurrentMonth: boolean
  onDayDoubleClick?: (key: string, month: number, day: number) => void
  onMonthDashboard?: (month: number) => void
}

interface CellData {
  day: number
  key: string
  dayOfWeek: number
}

export function MonthCard({ month, isCurrentMonth, onDayDoubleClick, onMonthDashboard }: MonthCardProps) {
  const { calData, updateDay, setToast } = useApp()

  const clickRef = useRef<{
    key: string | null
    count: number
    timer: ReturnType<typeof setTimeout> | null
  }>({ key: null, count: 0, timer: null })

  const { cells, totalDays } = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const result: Array<CellData | null> = []
    for (let i = 0; i < fd; i++) result.push(null)
    for (let d = 1; d <= td; d++) {
      result.push({
        day: d,
        key: dateKey(APP_YEAR, month, d),
        dayOfWeek: (fd + d - 1) % 7,
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
        background: isCurrentMonth ? 'var(--xp-card)' : 'var(--xp-bg3)',
        border: isCurrentMonth
          ? '1px solid rgba(124,58,237,0.2)'
          : '0.5px solid var(--xp-bdr)',
        boxShadow: isCurrentMonth ? '0 2px 8px rgba(124,58,237,0.07)' : 'none',
      }}
    >
      {/* Month header */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[11px] font-semibold"
          style={{ color: isCurrentMonth ? 'var(--xp-acc)' : 'var(--xp-txt)' }}
        >
          {MONTHS[month]}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onMonthDashboard?.(month) }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors hover:text-violet-500"
          style={{
            background: 'var(--xp-bg3)',
            border: '0.5px solid var(--xp-bdr2)',
            color: 'var(--xp-txt3)',
          }}
        >
          <ChartBarIcon /> Dashboard
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_HEADERS.map((d, i) => (
          <div
            key={d}
            className="text-center text-[7.5px] font-medium"
            style={{ color: i === 0 ? '#f97316' : 'var(--xp-txt3)' }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells — no gap so connectors are seamless */}
      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          if (!cell) {
            return <div key={`e${idx}`} className="aspect-square" />
          }

          const dayData = calData[cell.key]
          const streak = isStreakDay(dayData)
          const productive = !!dayData?.productive
          const hyper = !!dayData?.hyper
          const milestone = !!dayData?.milestone
          const todayCell = isToday(APP_YEAR, month, cell.day)
          const isSun = cell.dayOfWeek === 0

          // Streak connections — only within same week row
          const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
          const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
          const connectLeft = streak && cell.dayOfWeek !== 0 && !!prevKey && isStreakDay(calData[prevKey])
          const connectRight = streak && cell.dayOfWeek !== 6 && !!nextKey && isStreakDay(calData[nextKey])

          // Circle style
          let circleStyle: React.CSSProperties = {
            color: isSun ? '#f97316' : 'var(--xp-txt3)',
            fontSize: '9px',
          }
          if (productive && !hyper && !milestone) {
            circleStyle = {
              background: '#16a34a',
              color: 'white',
              fontSize: '9px',
              fontWeight: 600,
            }
          } else if (todayCell && !streak) {
            circleStyle = {
              color: 'var(--xp-acc)',
              background: 'rgba(124,58,237,0.1)',
              outline: '1.5px solid var(--xp-acc)',
              outlineOffset: '-1px',
              fontSize: '9px',
            }
          }

          // Emoji content for special days
          const isEmoji = hyper || milestone
          const content = hyper ? '🔥' : milestone ? '🏆' : cell.day

          return (
            <div
              key={cell.key}
              className="aspect-square relative cursor-pointer select-none group"
              onClick={() => handleCellClick(cell.key, cell.day, streak)}
              title={streak ? 'Click to unmark · Double-click to edit' : 'Click to mark productive'}
            >
              {/* Left streak connector */}
              {connectLeft && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: '50%',
                    top: '50%',
                    height: 2,
                    background: '#16a34a',
                    transform: 'translateY(-50%)',
                    zIndex: 0,
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Right streak connector */}
              {connectRight && (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    right: -1,
                    top: '50%',
                    height: 2,
                    background: '#16a34a',
                    transform: 'translateY(-50%)',
                    zIndex: 0,
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Day circle */}
              <div
                className="absolute inset-[8%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-110"
                style={{ zIndex: 1, ...circleStyle, fontSize: isEmoji ? '11px' : '9px' }}
              >
                {content}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
