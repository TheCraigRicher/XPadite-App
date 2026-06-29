'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApp } from './AppContext'
import { dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR, getMonthStats } from './utils'
import { ShareCardModal } from './ShareCardModal'
import type { DayData } from './types'

function isStreakDay(data: DayData | undefined): boolean {
  return !!(data?.productive || data?.hyper || data?.milestone || data?.goal)
}

interface MonthZoomModalProps {
  month: number
  onClose: () => void
  onDayDoubleClick?: (key: string, month: number, day: number) => void
}

export function MonthZoomModal({ month, onClose, onDayDoubleClick }: MonthZoomModalProps) {
  const { calData, updateDay, setToast, isDark } = useApp()
  const gapColor = isDark ? '#1a1a28' : '#ffffff'
  const [shareOpen, setShareOpen] = useState(false)

  const clickRef = useRef<{
    key: string | null
    count: number
    timer: ReturnType<typeof setTimeout> | null
  }>({ key: null, count: 0, timer: null })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { cells, totalDays } = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const prevTd = new Date(APP_YEAR, month, 0).getDate()
    const result: { day: number; key: string; dayOfWeek: number; isGhost: boolean }[] = []

    for (let i = fd - 1; i >= 0; i--) {
      result.push({ day: prevTd - i, key: `gz-prev-${month}-${i}`, dayOfWeek: (fd - 1 - i + 7) % 7, isGhost: true })
    }
    for (let d = 1; d <= td; d++) {
      result.push({ day: d, key: dateKey(APP_YEAR, month, d), dayOfWeek: (fd + d - 1) % 7, isGhost: false })
    }
    const rem = result.length % 7
    const suf = rem === 0 ? 0 : 7 - rem
    for (let d = 1; d <= suf; d++) {
      result.push({ day: d, key: `gz-next-${month}-${d}`, dayOfWeek: (fd + td + d - 1) % 7, isGhost: true })
    }
    return { cells: result, totalDays: td }
  }, [month])

  const stats = useMemo(() => getMonthStats(calData, APP_YEAR, month), [calData, month])

  const handleCellClick = useCallback((key: string, day: number, wasStreak: boolean) => {
    if (clickRef.current.key !== key) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key, count: 0, timer: null }
    }
    clickRef.current.count++

    if (clickRef.current.count === 1) {
      clickRef.current.timer = setTimeout(() => {
        clickRef.current = { key: null, count: 0, timer: null }
        updateDay(key, prev => ({
          ...prev,
          productive: !prev.productive,
          hyper: prev.productive ? false : prev.hyper,
        }))
        if (!wasStreak) setToast('Day Complete ✅  Great work. See you tomorrow.')
      }, 260)
    } else if (clickRef.current.count === 2) {
      if (clickRef.current.timer) clearTimeout(clickRef.current.timer)
      clickRef.current = { key: null, count: 0, timer: null }
      onDayDoubleClick?.(key, month, day)
    }
  }, [updateDay, setToast, onDayDoubleClick, month])

  const STAT_ITEMS = [
    { label: 'Productive Days', value: stats.productiveDays, icon: '✅' },
    { label: 'Completion Rate', value: `${stats.completionRate}%`, icon: '📊' },
    { label: '🔥 Hyper Days', value: stats.hyperDays, icon: '' },
    { label: '🏆 Milestones', value: stats.milestoneDays, icon: '' },
    { label: '🎯 Goals Hit', value: stats.goalDays, icon: '' },
    { label: 'Tasks Done', value: `${stats.completedTasks}/${stats.totalTasks}`, icon: '✓' },
  ]

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl shadow-2xl overflow-hidden mb-8"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm transition-colors hover:text-violet-500"
            style={{ color: 'var(--xp-txt2)' }}
          >
            ← Back
          </button>
          <div className="text-center">
            <p className="text-base font-semibold" style={{ color: 'var(--xp-txt)' }}>
              {MONTHS[month]} {APP_YEAR}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
              Single click to mark productive · Double-click to edit
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all hover:opacity-85"
              style={{ background: '#7c3aed' }}
            >
              📤 Share
            </button>
            <button
              onClick={onClose}
              className="text-sm transition-colors hover:text-red-400"
              style={{ color: 'var(--xp-txt3)' }}
            >
              × Close
            </button>
          </div>
        </div>

        {/* Large calendar grid */}
        <div className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {DAY_HEADERS.map((d, i) => (
              <div key={d} className="text-center text-xs font-medium py-1" style={{ color: i === 0 ? '#f97316' : 'var(--xp-txt3)' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map(cell => {
              if (cell.isGhost) {
                return (
                  <div key={cell.key} className="aspect-square flex items-center justify-center text-sm" style={{ color: 'var(--xp-bdr2)' }}>
                    {cell.day}
                  </div>
                )
              }

              const dayData = calData[cell.key]
              const streak = isStreakDay(dayData)
              const productive = !!dayData?.productive
              const hyper = !!dayData?.hyper
              const milestone = !!dayData?.milestone
              const goal = !!dayData?.goal
              const todayCell = isToday(APP_YEAR, month, cell.day)
              const isSun = cell.dayOfWeek === 0

              const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
              const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
              const connectLeft = streak && cell.dayOfWeek !== 0 && !!prevKey && isStreakDay(calData[prevKey])
              const connectRight = streak && cell.dayOfWeek !== 6 && !!nextKey && isStreakDay(calData[nextKey])

              // Emoji cells extend to center; circles stop at edge (92% in zoom with gap-1)
              const connEdge = hyper || milestone || goal ? '50%' : '92%'
              const connL = connectLeft && (
                <div style={{ position: 'absolute', left: 0, right: connEdge, top: '50%', height: 2.5, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
              )
              const connR = connectRight && (
                <div style={{ position: 'absolute', left: connEdge, right: -4, top: '50%', height: 2.5, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
              )

              // ── Fire Day ──────────────────────────────────────────
              if (hyper) {
                return (
                  <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Fire Day!">
                    {connL}{connR}
                    <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '30px', lineHeight: 1, userSelect: 'none' }}>🔥</span>
                      <span style={{ position: 'absolute', top: '65%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, fontSize: '9px', fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 5px rgba(255,255,255,1)', pointerEvents: 'none' }}>
                        {cell.day}
                      </span>
                    </div>
                  </div>
                )
              }

              // ── Trophy / Milestone ─────────────────────────────────
              if (milestone) {
                return (
                  <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Milestone!">
                    {connL}{connR}
                    <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                      {/* Subtle purple star — sits behind trophy, above connector */}
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '28px', color: 'rgba(167, 139, 250, 0.20)', filter: 'drop-shadow(0 0 6px rgba(167, 139, 250, 0.55))', userSelect: 'none', lineHeight: 1, zIndex: 0 }}>★</span>
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '30px', lineHeight: 1, userSelect: 'none', zIndex: 1 }}>🏆</span>
                      <span style={{ position: 'absolute', top: '37%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, fontSize: '9px', fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 5px rgba(255,255,255,1)', pointerEvents: 'none' }}>
                        {cell.day}
                      </span>
                    </div>
                  </div>
                )
              }

              // ── Goal Achieved ──────────────────────────────────────
              if (goal) {
                return (
                  <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Goal Achieved!">
                    {connL}{connR}
                    <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '28px', lineHeight: 1, userSelect: 'none' }}>🎯</span>
                      <span style={{ position: 'absolute', top: '52%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, fontSize: '9px', fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 5px rgba(255,255,255,1)', pointerEvents: 'none' }}>
                        {cell.day}
                      </span>
                    </div>
                  </div>
                )
              }

              // ── Productive / Today / Default ──────────────────────
              let circleStyle: React.CSSProperties = { color: isSun ? '#f97316' : 'var(--xp-txt3)', fontSize: '13px' }

              if (productive) {
                circleStyle = { background: '#16a34a', color: 'white', fontWeight: 700, fontSize: '13px', boxShadow: `0 0 0 2.5px ${gapColor}, 0 0 0 5.5px rgba(22,163,74,0.7)` }
              } else if (todayCell) {
                circleStyle = { color: 'var(--xp-acc)', background: 'rgba(124,58,237,0.08)', outline: '2px solid var(--xp-acc)', outlineOffset: '-1px', fontSize: '13px' }
              }

              return (
                <div
                  key={cell.key}
                  className="aspect-square relative cursor-pointer select-none group"
                  onClick={() => handleCellClick(cell.key, cell.day, streak)}
                >
                  {connL}{connR}
                  <div
                    className="absolute inset-[8%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-105"
                    style={{ zIndex: 1, ...circleStyle }}
                  >
                    {cell.day}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Month stats */}
        <div
          className="grid grid-cols-6 gap-2 px-4 py-3"
          style={{ borderTop: '0.5px solid var(--xp-bdr)', background: 'var(--xp-bg3)' }}
        >
          {STAT_ITEMS.map(s => (
            <div key={s.label} className="text-center">
              <div className="text-base font-bold" style={{ color: 'var(--xp-acc)' }}>{s.value}</div>
              <div className="text-[9px] mt-0.5 leading-tight" style={{ color: 'var(--xp-txt3)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
    {shareOpen && <ShareCardModal month={month} onClose={() => setShareOpen(false)} />}
    </>
  )
}
