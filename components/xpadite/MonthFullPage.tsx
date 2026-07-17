'use client'

import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import { useApp } from './AppContext'
import { GaugeMeter } from './GaugeMeter'
import { generateShareCardDataUri } from './ShareCardModal'
import { addGalleryItem } from './GalleryModal'
import type { GalleryItem } from './GalleryModal'
import {
  dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR, getMonthStats, formatMs,
  hexToRgba, resolveProgressColor,
} from './utils'
import { useUpcomingReminderDates } from './useUpcomingReminderDates'

// ─── Injected styles (keyframes + premium button hover rules) ─────────────────

const MFP_STYLES = `
  @keyframes xp-mfp-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes xp-from-right{from{opacity:0;transform:translateX(52px)}to{opacity:1;transform:translateX(0)}}
  @keyframes xp-from-left{from{opacity:0;transform:translateX(-52px)}to{opacity:1;transform:translateX(0)}}

  .xp-mfp-back{
    display:inline-flex;align-items:center;gap:6px;
    padding:7px 20px;border-radius:24px;font-size:11px;font-weight:700;
    cursor:pointer;background:white;color:#7c3aed;
    border:1px solid rgba(124,58,237,0.30);
    box-shadow:0 1px 5px rgba(124,58,237,0.14);
    transition:all 180ms ease;
  }
  .xp-mfp-back:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 16px rgba(124,58,237,0.42),0 2px 6px rgba(124,58,237,0.22)!important;
    transform:translateY(-1px);
  }

  .xp-mfp-close{
    width:36px;height:36px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:13px;cursor:pointer;
    background:white;color:#7c3aed;
    border:1px solid rgba(124,58,237,0.30);
    box-shadow:0 1px 5px rgba(124,58,237,0.14);
    transition:all 180ms ease;flex-shrink:0;
  }
  .xp-mfp-close:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 14px rgba(124,58,237,0.40)!important;
    transform:translateY(-1px);
  }

  .xp-mfp-nav:not(:disabled):hover{
    background:#7c3aed!important;color:#fff!important;
    border-color:#7c3aed!important;
    box-shadow:0 2px 10px rgba(124,58,237,0.38)!important;
  }
  .xp-mfp-nav:disabled{opacity:0.2!important;cursor:default!important;}

  .xp-mfp-share:hover{
    background:#7c3aed!important;color:white!important;
    border-color:#7c3aed!important;
    box-shadow:0 4px 14px rgba(124,58,237,0.40)!important;
    transform:translateY(-1px);
  }
`

// ─── Platform definitions ─────────────────────────────────────────────────────

interface Platform {
  id: string; label: string; sublabel?: string
  color: string; bg: string; abbr: string
}

const PLATFORMS: Platform[] = [
  { id: 'ig-story', label: 'Instagram', sublabel: 'Story', color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'ig-post',  label: 'Instagram', sublabel: 'Post',  color: '#fff', bg: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', abbr: 'IG' },
  { id: 'fb',       label: 'Facebook',  sublabel: 'Post',  color: '#fff', bg: '#1877F2', abbr: 'f'  },
  { id: 'linkedin', label: 'LinkedIn',  sublabel: 'Post',  color: '#fff', bg: '#0A66C2', abbr: 'in' },
  { id: 'x',        label: 'X',         sublabel: 'Post',  color: '#fff', bg: '#000000', abbr: 'X'  },
  { id: 'tiktok',   label: 'TikTok',    sublabel: '',      color: '#fff', bg: '#010101', abbr: 'TT' },
  { id: 'snapchat', label: 'Snapchat',  sublabel: 'Story', color: '#000', bg: '#FFFC00', abbr: 'SC' },
  { id: 'whatsapp', label: 'WhatsApp',  sublabel: '',      color: '#fff', bg: '#25D366', abbr: 'WA' },
]

const CONN_KEY = 'xp9_connections'
function getConnections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(CONN_KEY) || '{}') } catch { return {} }
}
function markConnected(id: string) {
  const c = getConnections(); c[id] = true; localStorage.setItem(CONN_KEY, JSON.stringify(c))
}

// ─── PlatformLogo ─────────────────────────────────────────────────────────────

function PlatformLogo({ p }: { p: Platform }) {
  const smallAbbr = p.abbr === 'in' || p.abbr === 'TT' || p.abbr === 'WA' || p.abbr === 'SC'
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
      background: p.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: smallAbbr ? 10 : 15, fontWeight: 800, color: p.color,
      fontStyle: p.abbr === 'f' ? 'italic' : 'normal',
    }}>
      {p.abbr}
    </div>
  )
}

// ─── ShareIcon ────────────────────────────────────────────────────────────────

const ShareIcon = () => (
  <svg viewBox="0 0 20 18" fill="none" width="14" height="13" aria-hidden="true">
    <circle cx="16" cy="2" r="2" fill="currentColor"/>
    <circle cx="16" cy="15" r="2" fill="currentColor"/>
    <circle cx="4" cy="9" r="2" fill="currentColor"/>
    <line x1="5.8" y1="8" x2="14.3" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="5.8" y1="10" x2="14.3" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

// ─── Share Card Preview (CSS mockup shown inside the share panel) ─────────────

function ShareCardPreview({ month, stats, totalMs, currentStreak, longestStreak }: {
  month: number
  stats: ReturnType<typeof getMonthStats>
  totalMs: number
  currentStreak: number
  longestStreak: number
}) {
  type Chip = { emoji: string; label: string; value: string }
  const chips: Chip[] = [
    { emoji: '✅', label: 'Productive',  value: `${stats.productiveDays}/${stats.totalDays}d` },
    { emoji: '📈', label: 'Completion',  value: `${stats.completionRate}%` },
    { emoji: '🔗', label: 'Streak',      value: `${currentStreak}d` },
    { emoji: '⚡', label: 'Best Streak', value: `${longestStreak}d` },
  ]
  if (stats.hyperDays > 0)     chips.push({ emoji: '🔥', label: 'Hyper',     value: String(stats.hyperDays) })
  if (stats.milestoneDays > 0) chips.push({ emoji: '🏆', label: 'Milestone', value: String(stats.milestoneDays) })
  if (stats.goalDays > 0)      chips.push({ emoji: '🎯', label: 'Goals',     value: String(stats.goalDays) })
  if (totalMs > 0)              chips.push({ emoji: '⏱', label: 'Hours',     value: formatMs(totalMs) })

  return (
    <div style={{
      background: 'linear-gradient(135deg,#1a0533 0%,#2d1b69 45%,#1a1a3e 100%)',
      borderRadius: 18, padding: '18px 20px 14px',
      border: '1px solid rgba(167,139,250,0.18)',
      boxShadow: '0 8px 32px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.06)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -50, right: -50, width: 130, height: 130, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,0.32) 0%,transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -30, left: -30, width: 90, height: 90, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.20) 0%,transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(216,180,254,0.52)', marginBottom: 6, position: 'relative' }}>XPADITE MONTHLY RECAP</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'white', lineHeight: 1.1, marginBottom: 14, position: 'relative' }}>
        {MONTHS[month]} <span style={{ opacity: 0.6, fontSize: 16 }}>{APP_YEAR}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, position: 'relative' }}>
        {chips.slice(0, 8).map(c => (
          <div key={c.label} style={{
            background: 'rgba(255,255,255,0.07)', borderRadius: 11, padding: '8px 4px',
            border: '0.5px solid rgba(255,255,255,0.08)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, lineHeight: 1, marginBottom: 3 }}>{c.emoji}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{c.value}</div>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 7, color: 'rgba(167,139,250,0.35)', marginTop: 11, textAlign: 'center', letterSpacing: '0.07em', position: 'relative' }}>
        XPADITE · YOUR PRODUCTIVITY JOURNEY
      </div>
    </div>
  )
}

// ─── Reminder ring overlay ────────────────────────────────────────────────────

function ReminderRing({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <>
      <div
        aria-label={count === 1 ? 'Has 1 upcoming reminder' : `Has ${count} upcoming reminders`}
        className="absolute inset-[14%] rounded-full pointer-events-none"
        style={{
          border: '2px solid rgba(239,68,68,0.55)',
          boxShadow: '0 0 0 2px rgba(239,68,68,0.08)',
          zIndex: 2,
          transition: 'opacity 200ms ease',
        }}
      />
      {count > 1 && (
        <span
          aria-hidden="true"
          className="absolute flex items-center justify-center pointer-events-none"
          style={{
            top: '6%', right: '6%',
            minWidth: 10, height: 10,
            padding: '0 2px',
            borderRadius: 6,
            background: 'rgba(239,68,68,0.90)',
            fontSize: 6, fontWeight: 800, color: 'white',
            lineHeight: '10px',
            zIndex: 5,
          }}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </>
  )
}

// ─── Large interactive calendar ───────────────────────────────────────────────

function MonthCalendarLarge({
  month,
  calData,
  onDayDoubleClick,
}: {
  month: number
  calData: Record<string, unknown>
  onDayDoubleClick?: (key: string, month: number, day: number) => void
}) {
  const { progressColor: _rawColor, isDark, updateDay, setToast, reminders, calData: appCalData } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)
  const gapColor = isDark ? '#1a1a28' : '#ffffff'
  const reminderDates = useUpcomingReminderDates(reminders, appCalData)

  const clickRef = useRef<{ key: string | null; count: number; timer: ReturnType<typeof setTimeout> | null }>(
    { key: null, count: 0, timer: null }
  )

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

  const { cells, totalDays } = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const prevTd = new Date(APP_YEAR, month, 0).getDate()
    const result: { day: number; key: string; isGhost: boolean; dow: number }[] = []
    for (let i = fd - 1; i >= 0; i--) {
      result.push({ day: prevTd - i, key: `g-p-${month}-${i}`, isGhost: true, dow: fd - 1 - i })
    }
    for (let d = 1; d <= td; d++) {
      result.push({ day: d, key: dateKey(APP_YEAR, month, d), isGhost: false, dow: (fd + d - 1) % 7 })
    }
    // Always pad to 42 cells (6 rows)
    let nd = 1
    while (result.length < 42) {
      result.push({ day: nd++, key: `g-n-${month}-${nd}`, isGhost: true, dow: result.length % 7 })
    }
    return { cells: result, totalDays: td }
  }, [month])

  const cd = calData as Record<string, { productive?: boolean; hyper?: boolean; milestone?: boolean; goal?: boolean }>
  const connGlow = isDark ? `0 0 7px 2px ${hexToRgba(progressColor, 0.28)}` : undefined

  return (
    <div className="w-full">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-2">
        {DAY_HEADERS.map((d, i) => (
          <div key={d} className="text-center font-semibold py-1.5" style={{ fontSize: 10, color: i === 0 ? '#f97316' : 'var(--xp-txt3)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (cell.isGhost) return (
            <div key={idx} className="aspect-square flex items-center justify-center" style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.22)' : '#b0bac6' }}>
              {cell.day}
            </div>
          )

          const data = cd[cell.key]
          const productive = !!data?.productive
          const hyper      = !!data?.hyper
          const milestone  = !!data?.milestone
          const goal       = !!data?.goal
          const streak     = productive || hyper || milestone || goal
          const todayCell  = isToday(APP_YEAR, month, cell.day)
          const reminderCount = reminderDates.get(cell.key) ?? 0

          const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
          const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
          const connL = streak && cell.dow !== 0 && !!prevKey && (() => { const d = cd[prevKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()
          const connR = streak && cell.dow !== 6 && !!nextKey && (() => { const d = cd[nextKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()

          const connEdge = hyper || milestone || goal ? '50%' : '92%'
          const connLeft = connL && (
            <div style={{ position: 'absolute', left: 0, right: connEdge, top: '50%', height: 2.5, background: progressColor, boxShadow: connGlow, transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )
          const connRight = connR && (
            <div style={{ position: 'absolute', left: connEdge, right: -4, top: '50%', height: 2.5, background: progressColor, boxShadow: connGlow, transform: 'translateY(-50%)', zIndex: 0, pointerEvents: 'none' }} />
          )

          // ── Hyper Productive (🔥) ────────────────────────────────────────────
          if (hyper) return (
            <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Hyper Productive">
              {connLeft}{connRight}
              <ReminderRing count={reminderCount} />
              <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 46, lineHeight: 1, userSelect: 'none' }}>🔥</span>
                <span style={{ position: 'absolute', top: '66%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 2, pointerEvents: 'none' }}>{cell.day}</span>
              </div>
            </div>
          )

          // ── Milestone (🏆) ───────────────────────────────────────────────────
          if (milestone) return (
            <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Milestone">
              {connLeft}{connRight}
              <ReminderRing count={reminderCount} />
              <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 38, color: 'rgba(167,139,250,0.20)', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.55))', lineHeight: 1, userSelect: 'none', zIndex: 0 }}>★</span>
                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 42, lineHeight: 1, userSelect: 'none', zIndex: 1 }}>🏆</span>
                <span style={{ position: 'absolute', top: '37%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 2, pointerEvents: 'none' }}>{cell.day}</span>
              </div>
            </div>
          )

          // ── Goal Achieved (🎯) ───────────────────────────────────────────────
          if (goal) return (
            <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)} title="Goal Achieved">
              {connLeft}{connRight}
              <ReminderRing count={reminderCount} />
              <div className="absolute inset-0 transition-transform duration-[160ms] group-hover:scale-110" style={{ zIndex: 1 }}>
                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 48, lineHeight: 1, userSelect: 'none', zIndex: 1 }}>🎯</span>
                <span style={{ position: 'absolute', top: '54%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 12, fontWeight: 900, color: '#0a0a0a', textShadow: '0 0 6px rgba(255,255,255,1)', zIndex: 2, pointerEvents: 'none' }}>{cell.day}</span>
              </div>
            </div>
          )

          // ── Productive / Today / Default ─────────────────────────────────────
          // Circle reduced ~15%: inset-[8%] → inset-[14%] (circle 84% → 71% of cell)
          let circleStyle: React.CSSProperties = {
            color: cell.dow === 0 ? '#f97316' : isDark ? 'rgba(255,255,255,0.70)' : '#374151',
            fontSize: 14,
          }
          if (productive) circleStyle = {
            background: progressColor, color: progressColor === '#ffffff' ? '#000000' : 'white', fontWeight: 700, fontSize: 14,
            boxShadow: `0 0 0 2.5px ${gapColor}, 0 0 0 5.5px ${hexToRgba(progressColor, 0.7)}`,
          }
          else if (todayCell) circleStyle = {
            color: 'var(--xp-acc)', background: 'rgba(124,58,237,0.08)',
            outline: '2px solid var(--xp-acc)', outlineOffset: '-1px', fontSize: 14,
          }

          return (
            <div key={cell.key} className="aspect-square relative cursor-pointer select-none group" onClick={() => handleCellClick(cell.key, cell.day, streak)}>
              {connLeft}{connRight}
              <ReminderRing count={reminderCount} />
              <div className="absolute inset-[14%] rounded-full flex items-center justify-center transition-all duration-150 group-hover:scale-105" style={{ zIndex: 1, ...circleStyle }}>
                {cell.day}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly progress bars ─────────────────────────────────────────────────────

function MonthWeeklyBars({ month, sessions }: { month: number; sessions: { dateKey: string; startTs: number; endTs: number | null }[] }) {
  const weeks = useMemo(() => {
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const result: { label: string; ms: number }[] = []
    let wk = 1
    for (let start = 1; start <= td; start += 7) {
      const end = Math.min(start + 6, td)
      const keys = new Set<string>()
      for (let d = start; d <= end; d++) keys.add(dateKey(APP_YEAR, month, d))
      const ms = sessions.filter(s => s.endTs !== null && keys.has(s.dateKey)).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
      result.push({ label: `Wk ${wk++}`, ms })
    }
    return result
  }, [month, sessions])

  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const COLORS = ['#6366f1', '#7c3aed', '#ef4444', '#f97316', '#eab308']

  return (
    <div className="flex items-end gap-3 h-28">
      {weeks.map((w, i) => {
        const pct = (w.ms / maxMs) * 100
        const hrs = w.ms / 3_600_000
        return (
          <div key={w.label} className="flex flex-col items-center flex-1 gap-1">
            {w.ms > 0 && (
              <span className="text-[9px] font-bold" style={{ color: COLORS[i % COLORS.length] }}>
                {hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(w.ms / 60_000)}m`}
              </span>
            )}
            <div className="w-full flex-1 flex items-end">
              <div className="w-full rounded-t-md" style={{ height: `${Math.max(pct, w.ms > 0 ? 4 : 0)}%`, background: COLORS[i % COLORS.length], opacity: w.ms > 0 ? 1 : 0.12, minHeight: w.ms > 0 ? 4 : 0 }} />
            </div>
            <span className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>{w.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Activity donut chart ─────────────────────────────────────────────────────

type ActivityRow = { name: string; color: string; ms: number }

function ActivityPieChart({ breakdown, totalMs }: { breakdown: ActivityRow[]; totalMs: number }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const { isDark } = useApp()
  const surface = isDark ? '#16162a' : '#ffffff'

  if (breakdown.length === 0 || totalMs === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <p className="text-2xl mb-2">⏱</p>
        <p className="text-xs" style={{ color: 'var(--xp-txt3)' }}>No tracked time this month</p>
      </div>
    )
  }

  const cx = 110, cy = 110, ro = 85, ri = 44
  const toRad = (d: number) => d * Math.PI / 180

  type Slice = ActivityRow & { pct: number; start: number; end: number }
  const slices: Slice[] = []
  let cursor = -90
  for (const a of breakdown) {
    const pct = a.ms / totalMs
    const sweep = pct * 360
    slices.push({ ...a, pct, start: cursor, end: cursor + sweep })
    cursor += sweep
  }

  function arcPath(s: Slice): string {
    if (s.pct >= 0.9999) {
      return `M ${(cx - ro).toFixed(1)} ${cy} A ${ro} ${ro} 0 1 1 ${(cx + ro).toFixed(1)} ${cy} A ${ro} ${ro} 0 1 1 ${(cx - ro).toFixed(1)} ${cy} Z`
    }
    const x1 = cx + ro * Math.cos(toRad(s.start))
    const y1 = cy + ro * Math.sin(toRad(s.start))
    const x2 = cx + ro * Math.cos(toRad(s.end))
    const y2 = cy + ro * Math.sin(toRad(s.end))
    const large = (s.end - s.start) > 180 ? 1 : 0
    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ro} ${ro} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
  }

  const h = hovered !== null ? slices[hovered] : null

  return (
    <svg viewBox="0 0 220 220" className="w-full max-w-[220px] mx-auto">
      {slices.map((s, i) => (
        <path
          key={i} d={arcPath(s)} fill={s.color} stroke={surface} strokeWidth={2.5}
          opacity={hovered === null || hovered === i ? 1 : 0.4}
          style={{ cursor: 'pointer', transition: 'opacity 140ms ease' }}
          onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
        />
      ))}
      <circle cx={cx} cy={cy} r={ri} fill={surface} />
      {h ? (
        <>
          <text x={cx} y={cy - 14} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={h.color}>{h.name.length > 11 ? h.name.slice(0, 10) + '…' : h.name}</text>
          <text x={cx} y={cy + 4}  textAnchor="middle" fontSize="17"  fontWeight="900" fill={h.color}>{Math.round(h.pct * 100)}%</text>
          <text x={cx} y={cy + 19} textAnchor="middle" fontSize="8" fill="var(--xp-txt3)">{formatMs(h.ms)}</text>
        </>
      ) : (
        <>
          <text x={cx} y={cy + 5}  textAnchor="middle" fontSize="20" fontWeight="900" fill="var(--xp-txt)">{breakdown.length}</text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="8" fill="var(--xp-txt3)">activities</text>
        </>
      )}
    </svg>
  )
}

// ─── Stat tile + section divider ──────────────────────────────────────────────

function StatTile({ emoji, label, value, accent }: { emoji: string; label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-4 px-2 rounded-2xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-xl font-bold leading-none" style={{ color: accent ?? 'var(--xp-acc)' }}>{value}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-center leading-tight" style={{ color: 'var(--xp-txt3)' }}>{label}</span>
    </div>
  )
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--xp-txt3)' }}>{title}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--xp-bdr)' }} />
    </div>
  )
}

// ─── MonthFullPage ────────────────────────────────────────────────────────────

interface MonthFullPageProps {
  month: number
  onClose: () => void
  onMonthDashboard?: (month: number) => void
  onDayDoubleClick?: (key: string, month: number, day: number) => void
}

export function MonthFullPage({ month, onClose, onDayDoubleClick }: MonthFullPageProps) {
  const { calData, sessions, activities, isDark, progressColor: _rawColor2, setToast } = useApp()
  const progressColor = resolveProgressColor(_rawColor2, isDark)
  const [view, setView]               = useState<'calendar' | 'dashboard'>('calendar')
  const [currentMonth, setCurrentMonth] = useState(month)
  const [animType, setAnimType]        = useState<'fade' | 'right' | 'left'>('fade')

  // Share panel state
  const [panelOpen, setPanelOpen]         = useState(false)
  const [panelAnim, setPanelAnim]         = useState(false)
  const [sharing, setSharing]             = useState(false)
  const [connectTarget, setConnectTarget] = useState<Platform | null>(null)

  // Modal Escape — closes MonthFullPage
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Share panel Escape — intercepts before modal listener via capture phase
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); closePanel() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panelOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function openPanel() {
    setPanelOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelAnim(true)))
  }
  function closePanel() {
    setPanelAnim(false)
    setTimeout(() => setPanelOpen(false), 380)
  }

  async function executeShare() {
    if (sharing) return
    setSharing(true)
    try {
      const mStats = getMonthStats(calData, APP_YEAR, currentMonth)
      const uri = await generateShareCardDataUri(currentMonth, mStats)
      const monthName = MONTHS[currentMonth]
      const item: GalleryItem = {
        id: 'card-' + Date.now(), type: 'month-share', createdAt: Date.now(),
        title: `${monthName} ${APP_YEAR}`, month: currentMonth, year: APP_YEAR, dataUri: uri,
        stats: {
          productiveDays: mStats.productiveDays, totalDays: mStats.totalDays,
          hyperDays: mStats.hyperDays, milestoneDays: mStats.milestoneDays,
          goalDays: mStats.goalDays, completionRate: mStats.completionRate,
        },
      }
      addGalleryItem(item)
      setToast(`${monthName} share card saved to Gallery ✓`)
      const shareText = `${monthName} ${APP_YEAR}: ${mStats.completionRate}% completion — XPadite`
      if (navigator.share) {
        try {
          const res = await fetch(uri)
          const blob = await res.blob()
          const file = new File([blob], `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`, { type: 'image/png' })
          const canFiles = navigator.canShare?.({ files: [file] })
          await navigator.share(
            canFiles
              ? { title: `${monthName} XPadite`, text: shareText, files: [file] }
              : { title: `${monthName} XPadite`, text: shareText }
          )
        } catch {
          const a = document.createElement('a')
          a.href = uri; a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`; a.click()
        }
      } else {
        const a = document.createElement('a')
        a.href = uri; a.download = `xpadite-${monthName.toLowerCase()}-${APP_YEAR}.png`; a.click()
      }
      closePanel()
    } finally { setSharing(false) }
  }

  async function copyImage() {
    if (sharing) return
    setSharing(true)
    try {
      const mStats = getMonthStats(calData, APP_YEAR, currentMonth)
      const uri = await generateShareCardDataUri(currentMonth, mStats)
      const res = await fetch(uri)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setToast('Share card copied to clipboard ✓')
      closePanel()
    } catch {
      setToast('Copy failed — try Download PNG instead.')
    } finally { setSharing(false) }
  }

  function handlePlatformClick(p: Platform) {
    const connections = getConnections()
    if (!connections[p.id]) setConnectTarget(p)
    else void executeShare()
  }
  function handleConnect() {
    if (!connectTarget) return
    markConnected(connectTarget.id)
    setConnectTarget(null)
    void executeShare()
  }

  function goNext() { if (currentMonth < 11) { setAnimType('right'); setCurrentMonth(m => m + 1) } }
  function goPrev() { if (currentMonth > 0)  { setAnimType('left');  setCurrentMonth(m => m - 1) } }
  function toggleView() { setAnimType('fade'); setView(v => v === 'calendar' ? 'dashboard' : 'calendar') }

  // ── Data computations (all keyed to currentMonth) ──────────────────────────

  const stats = useMemo(() => getMonthStats(calData, APP_YEAR, currentMonth), [calData, currentMonth])

  const monthScore = useMemo(() => {
    const now = new Date()
    const isCurrentCalMonth = now.getMonth() === currentMonth && now.getFullYear() === APP_YEAR
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    const elapsed = isCurrentCalMonth ? now.getDate() : td
    const rate = elapsed > 0 ? (stats.productiveDays / elapsed) * 100 : 0
    let ms = 0
    for (let d = 1; d <= elapsed; d++) {
      const k = dateKey(APP_YEAR, currentMonth, d)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(calData[k] as any)?.tasks?.forEach((t: any) => {
        ;((t.sessions ?? []) as any[]).filter((s: any) => s.endTs !== null).forEach((s: any) => { ms += s.endTs - s.startTs })
      })
    }
    const hours = ms / 3_600_000
    let score = 0
    if (rate >= 30)  score += 20; if (rate >= 50)  score += 20
    if (rate >= 70)  score += 15; if (rate >= 90)  score += 15
    if (hours >= 5)  score += 10; if (hours >= 15) score += 5
    if (stats.hyperDays >= 1)     score += 8
    if (stats.milestoneDays >= 1) score += 5
    if (stats.goalDays >= 1)      score += 2
    return Math.min(100, score)
  }, [stats, currentMonth, calData])

  const monthKeys = useMemo(() => {
    const s = new Set<string>()
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    for (let d = 1; d <= td; d++) s.add(dateKey(APP_YEAR, currentMonth, d))
    return s
  }, [currentMonth])

  const monthSessions = useMemo(
    () => sessions.filter(s => monthKeys.has(s.dateKey)),
    [sessions, monthKeys]
  )

  const totalMs = useMemo(
    () => monthSessions.filter(s => s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0),
    [monthSessions]
  )

  const actBreakdown = useMemo((): ActivityRow[] => {
    const actMs = new Map<string, number>()
    for (const key of monthKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const day = calData[key] as any
      if (!day) continue
      ;(day.tasks ?? []).forEach((t: any) => {
        ;((t.sessions ?? []) as any[]).filter((s: any) => s.endTs !== null).forEach((s: any) => {
          if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + (s.endTs - s.startTs))
        })
      })
    }
    return Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
    }).sort((a, b) => b.ms - a.ms).slice(0, 7)
  }, [calData, monthKeys, activities])

  const { currentStreak, longestStreak } = useMemo(() => {
    const td = new Date(APP_YEAR, currentMonth + 1, 0).getDate()
    type D = { productive?: boolean; hyper?: boolean; milestone?: boolean; goal?: boolean }
    const isProd = (k: string) => { const d = calData[k] as D | undefined; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) }
    let longest = 0, run = 0
    for (let d = 1; d <= td; d++) { if (isProd(dateKey(APP_YEAR, currentMonth, d))) { run++; if (run > longest) longest = run } else run = 0 }
    const now = new Date()
    const last = currentMonth === now.getMonth() && APP_YEAR === now.getFullYear() ? Math.min(now.getDate(), td) : td
    let current = 0
    for (let d = last; d >= 1; d--) { if (isProd(dateKey(APP_YEAR, currentMonth, d))) current++; else break }
    return { currentStreak: current, longestStreak: longest }
  }, [calData, currentMonth])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])
  const animName = animType === 'right' ? 'xp-from-right' : animType === 'left' ? 'xp-from-left' : 'xp-mfp-in'

  const navBtnStyle: React.CSSProperties = {
    width: 34, height: 34, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, fontWeight: 300, lineHeight: 1, cursor: 'pointer',
    background: 'white', color: '#7c3aed',
    border: '1px solid rgba(124,58,237,0.30)',
    boxShadow: '0 1px 5px rgba(124,58,237,0.14)',
    transition: 'all 180ms ease', flexShrink: 0,
  }

  return (
    <>
      <style>{MFP_STYLES}</style>
      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(15,23,42,0.60)' }}
        onClick={onClose}
      >
        <div className="min-h-full flex items-start justify-center py-5 px-4">
          <div
            className="w-full rounded-2xl"
            style={{
              maxWidth: 1400, background: 'var(--xp-card)',
              border: '0.5px solid var(--xp-bdr)', overflow: 'clip',
              boxShadow: isDark
                ? `0 24px 64px rgba(0,0,0,0.50), 0 0 80px 16px ${hexToRgba(progressColor, 0.07)}`
                : '0 24px 64px rgba(0,0,0,0.14)',
            }}
            onClick={stopProp}
          >
            {/* ── Premium 3-column header ────────────────────────────────────── */}
            <div
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                gap: 16, padding: '14px 20px',
                position: 'sticky', top: 0, zIndex: 10,
                background: 'var(--xp-card)',
                borderBottom: '0.5px solid var(--xp-bdr)',
                alignItems: 'center',
              }}
            >
              {/* Left: Back */}
              <div>
                <button onClick={onClose} className="xp-mfp-back">← Back</button>
              </div>

              {/* Center: [‹ Month Year ›] over [Monthly Dashboard toggle] */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={goPrev}
                    disabled={currentMonth === 0}
                    className="xp-mfp-nav"
                    style={navBtnStyle}
                    title="Previous month"
                  >‹</button>
                  <h1 style={{ fontSize: 13, fontWeight: 700, color: 'var(--xp-txt)', minWidth: 120, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {MONTHS[currentMonth]} {APP_YEAR}
                  </h1>
                  <button
                    onClick={goNext}
                    disabled={currentMonth === 11}
                    className="xp-mfp-nav"
                    style={navBtnStyle}
                    title="Next month"
                  >›</button>
                </div>
                <button
                  onClick={toggleView}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 18px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: view === 'dashboard' ? '#7c3aed' : 'rgba(124,58,237,0.08)',
                    color: view === 'dashboard' ? '#fff' : '#7c3aed',
                    border: view === 'dashboard' ? '1px solid #7c3aed' : '1px solid rgba(124,58,237,0.25)',
                    boxShadow: view === 'dashboard' ? '0 2px 8px rgba(124,58,237,0.35)' : 'none',
                    cursor: 'pointer', transition: 'all 180ms ease', whiteSpace: 'nowrap',
                  }}
                >
                  {view === 'calendar' ? '📊 Monthly Dashboard' : '📅 Calendar'}
                </button>
              </div>

              {/* Right: Close */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={onClose} className="xp-mfp-close" title="Close">✕</button>
              </div>
            </div>

            {/* ── Animated body ──────────────────────────────────────────────── */}
            <div key={`${view}-${currentMonth}`} style={{ animation: `${animName} 270ms ease` }}>

              {/* ── CALENDAR VIEW ─────────────────────────────────────────────── */}
              {view === 'calendar' && (
                <div className="p-8" style={{ background: 'var(--xp-bg)' }}>
                  <div style={{ maxWidth: 860, margin: '0 auto' }}>
                    <MonthCalendarLarge
                      month={currentMonth}
                      calData={calData as Record<string, unknown>}
                      onDayDoubleClick={onDayDoubleClick}
                    />
                    {/* Share button — centered below calendar, same pattern as MonthCard */}
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 28, paddingBottom: 4 }}>
                      <button
                        onClick={openPanel}
                        className="xp-mfp-share"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '9px 24px', borderRadius: 24, fontSize: 12, fontWeight: 600,
                          background: 'rgba(124,58,237,0.08)', color: '#7c3aed',
                          border: '1px solid rgba(124,58,237,0.28)',
                          boxShadow: '0 1px 5px rgba(124,58,237,0.10)',
                          cursor: 'pointer', transition: 'all 180ms ease',
                        }}
                      >
                        <ShareIcon /> Share {MONTHS[currentMonth]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DASHBOARD VIEW ─────────────────────────────────────────────── */}
              {view === 'dashboard' && (
                <div className="p-6" style={{ maxWidth: 1200, margin: '0 auto' }}>

                  {/* Row 1: Performance | Productivity */}
                  <div className="grid grid-cols-2 gap-5 mb-5">
                    <div className="rounded-2xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                      <SectionDivider title="Performance" />
                      <GaugeMeter score={monthScore} />
                    </div>
                    <div className="rounded-2xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                      <SectionDivider title="Productivity" />
                      <div className="grid grid-cols-2 gap-3">
                        <StatTile emoji="✅" label="Productive Days" value={`${stats.productiveDays}/${stats.totalDays}`} />
                        <StatTile emoji="🔥" label="Hyper Days"      value={String(stats.hyperDays)}     accent="#f97316" />
                        <StatTile emoji="🏆" label="Milestones"      value={String(stats.milestoneDays)} accent="#a855f7" />
                        <StatTile emoji="🎯" label="Goals Achieved"  value={String(stats.goalDays)}      accent="#22c55e" />
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Time | Progress */}
                  <div className="grid grid-cols-2 gap-5 mb-5">
                    <div className="rounded-2xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                      <SectionDivider title="Time" />
                      <div className="flex items-center justify-between px-3 py-3 rounded-xl mb-4" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
                        <span className="text-sm font-medium" style={{ color: 'var(--xp-txt2)' }}>⏱ Total Hours</span>
                        <span className="text-lg font-bold" style={{ color: 'var(--xp-acc)' }}>{formatMs(totalMs)}</span>
                      </div>
                      <MonthWeeklyBars month={currentMonth} sessions={monthSessions} />
                    </div>
                    <div className="rounded-2xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                      <SectionDivider title="Progress" />
                      <div className="grid grid-cols-3 gap-3">
                        <StatTile emoji="📈" label="Completion"  value={`${stats.completionRate}%`} />
                        <StatTile emoji="🔗" label="Cur Streak"  value={`${currentStreak}d`} />
                        <StatTile emoji="⚡" label="Best Streak" value={`${longestStreak}d`} />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Activities full width */}
                  <div className="rounded-2xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                    <SectionDivider title="Activities" />
                    {actBreakdown.length > 0 ? (
                      <div className="grid gap-6" style={{ gridTemplateColumns: '220px 1fr' }}>
                        <div className="flex flex-col items-center justify-center">
                          <ActivityPieChart breakdown={actBreakdown} totalMs={totalMs} />
                          <p className="text-[9px] font-medium mt-2" style={{ color: 'var(--xp-txt3)' }}>Hover slice for details</p>
                        </div>
                        <div className="flex flex-col gap-3 justify-center">
                          {actBreakdown.map(a => {
                            const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                            const hrs = (a.ms / 3_600_000).toFixed(1)
                            return (
                              <div key={a.name}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                                  <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--xp-txt)' }}>{a.name}</span>
                                  <span className="text-xs font-bold flex-shrink-0" style={{ color: a.color }}>{pct}%</span>
                                  <span className="text-[10px] flex-shrink-0 w-10 text-right" style={{ color: 'var(--xp-txt3)' }}>{hrs}h</span>
                                </div>
                                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--xp-card)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: a.color, transition: 'width 600ms ease' }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8">
                        <p className="text-2xl mb-2">⏱</p>
                        <p className="text-xs" style={{ color: 'var(--xp-txt3)' }}>Start a work timer to see activity analytics</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Share panel — fixed bottom sheet, spring slide-up ───────────────── */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-[60]"
          style={{ background: panelAnim ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)', transition: 'background 0.25s ease' }}
          onClick={closePanel}
        >
          <div
            className="absolute left-0 right-0 bottom-0 rounded-t-2xl shadow-2xl"
            style={{
              background: '#111114',
              border: '0.5px solid rgba(255,255,255,0.10)',
              transform: panelAnim ? 'translateY(0)' : 'translateY(100%)',
              opacity: panelAnim ? 1 : 0,
              transition: 'transform 0.38s cubic-bezier(0.34,1.4,0.64,1), opacity 0.22s ease',
              maxWidth: 520, margin: '0 auto',
              paddingBottom: 'env(safe-area-inset-bottom, 8px)',
              maxHeight: '92vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            </div>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px 12px', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Share {MONTHS[currentMonth]}</p>
                <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>Card saved to Gallery automatically</p>
              </div>
              <button onClick={closePanel} style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', cursor: 'pointer', padding: 4 }}>✕</button>
            </div>

            {/* Share Card preview */}
            <div style={{ padding: '14px 20px 8px' }}>
              <ShareCardPreview
                month={currentMonth} stats={stats}
                totalMs={totalMs} currentStreak={currentStreak} longestStreak={longestStreak}
              />
            </div>

            {/* Platform grid (5 columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, padding: '8px 16px 4px' }}>
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePlatformClick(p)}
                  disabled={sharing}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                    padding: '11px 4px', borderRadius: 14,
                    background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                  }}
                >
                  <PlatformLogo p={p} />
                  <div style={{ textAlign: 'center', lineHeight: 1.25 }}>
                    <p style={{ fontSize: 8.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</p>
                    {p.sublabel && <p style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.38)' }}>{p.sublabel}</p>}
                  </div>
                </button>
              ))}
            </div>

            {/* Copy Image + Download PNG — wide buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '8px 16px 16px' }}>
              <button
                onClick={() => void copyImage()}
                disabled={sharing}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '12px 16px', borderRadius: 14,
                  background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)',
                  cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                    <rect x="1.5" y="5" width="9.5" height="10" rx="1.5" stroke="white" strokeWidth="1.4"/>
                    <rect x="5" y="1.5" width="9.5" height="10" rx="1.5" stroke="white" strokeWidth="1.4" fill="#7c3aed"/>
                  </svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>Copy Image</p>
                  <p style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.38)' }}>To clipboard</p>
                </div>
              </button>
              <button
                onClick={() => void executeShare()}
                disabled={sharing}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '12px 16px', borderRadius: 14,
                  background: 'rgba(79,70,229,0.12)', border: '1px solid rgba(79,70,229,0.25)',
                  cursor: 'pointer', opacity: sharing ? 0.4 : 1, transition: 'all 140ms ease',
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 16 16" fill="none" width="16" height="16">
                    <path d="M8 2v9M4 7l4 5 4-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="2" y1="14" x2="14" y2="14" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>Download</p>
                  <p style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.38)' }}>Save as PNG</p>
                </div>
              </button>
            </div>

            {sharing && (
              <p style={{ textAlign: 'center', fontSize: 10, paddingBottom: 12, color: 'rgba(255,255,255,0.40)' }}>
                Generating share card…
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Connect Account dialog ──────────────────────────────────────────── */}
      {connectTarget && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.70)' }}
          onClick={() => setConnectTarget(null)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl p-6 shadow-2xl"
            style={{ background: '#111114', border: '0.5px solid rgba(255,255,255,0.12)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <PlatformLogo p={connectTarget} />
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'white', textAlign: 'center', marginBottom: 6 }}>
              Connect {connectTarget.label}?
            </h3>
            <p style={{ fontSize: 11, textAlign: 'center', color: 'rgba(255,255,255,0.45)', marginBottom: 20, lineHeight: 1.55 }}>
              Allow XPadite to share your monthly progress to {connectTarget.label}.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConnectTarget(null)}
                style={{ flex: 1, padding: '9px', borderRadius: 12, fontSize: 12, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: '0.5px solid rgba(255,255,255,0.10)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                style={{ flex: 1, padding: '9px', borderRadius: 12, fontSize: 12, fontWeight: 600, color: connectTarget.color, background: connectTarget.bg.startsWith('linear') ? '#E1306C' : connectTarget.bg, cursor: 'pointer' }}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
