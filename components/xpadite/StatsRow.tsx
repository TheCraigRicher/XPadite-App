'use client'

import { useMemo } from 'react'
import { useApp } from './AppContext'
import { getBestStreak, getProductiveDaysForYear, todayKey, APP_YEAR } from './utils'

export function StatsRow() {
  const { calData, sessions } = useApp()

  const stats = useMemo(() => {
    const productiveDays = getProductiveDaysForYear(calData, APP_YEAR)
    const bestStreak = getBestStreak(calData)

    const today = new Date()
    const startOfYear = new Date(APP_YEAR, 0, 1).getTime()
    const dayOfYear = Math.floor((today.getTime() - startOfYear) / 86_400_000) + 1
    const yearPct = dayOfYear > 0 ? Math.round((productiveDays / dayOfYear) * 100) : 0

    const tKey = todayKey()
    const todayMs = sessions
      .filter((s): s is typeof s & { endTs: number } => s.dateKey === tKey && s.endTs !== null)
      .reduce((sum, s) => sum + (s.endTs - s.startTs), 0)
    const todayHrs = Math.round(todayMs / 360_000) / 10

    return { productiveDays, bestStreak, yearPct, todayHrs }
  }, [calData, sessions])

  const items = [
    { value: stats.productiveDays, label: 'Productive days' },
    { value: stats.bestStreak, label: 'Best streak' },
    { value: `${stats.yearPct}%`, label: 'Year progress' },
    { value: `${stats.todayHrs}h`, label: 'Hours today' },
  ]

  return (
    <div className="flex justify-center gap-3 px-4 py-3 flex-wrap">
      {items.map(item => (
        <div
          key={item.label}
          className="text-center px-3.5 py-2 rounded-xl min-w-[82px]"
          style={{
            background: 'var(--xp-bg3)',
            border: '0.5px solid var(--xp-bdr)',
          }}
        >
          <div
            className="text-lg font-semibold"
            style={{ color: 'var(--xp-acc)' }}
          >
            {item.value}
          </div>
          <div
            className="text-[10px] mt-0.5"
            style={{ color: 'var(--xp-txt3)' }}
          >
            {item.label}
          </div>
        </div>
      ))}
    </div>
  )
}
