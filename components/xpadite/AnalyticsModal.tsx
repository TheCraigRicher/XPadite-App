'use client'

// ── Analytics modal — front-end + real data wiring ────────────────────────────
// The 4 timeframe cards are the dashboard hub: Today opens the existing
// DayDashboardModal (its own overlay, sized to match this modal's own card);
// Monthly opens the existing MonthFullPage (from MonthFullPage.tsx) directly
// embedded in this modal's own container via its `embedded` prop — Weekly and
// Yearly still only toggle a local selected state since those dashboards
// aren't built yet. The Overview section below is driven by real XPadite data
// via the SAME range-stats engine AnalyticsPage.tsx already uses
// (computeRangeStats, exported from there) and the streak functions from
// productivityEngine.ts (also used by StatsRow) — no parallel calculation
// system.
//
// Body scroll is locked locally (below) with the stronger position:fixed
// technique at every breakpoint — not the shared useLockBodyScroll, whose
// mobile branch doesn't fully stop iOS scroll-through once nested dashboards
// add their own scrollable regions. Reuses established XPadite patterns: the
// signature purple/lavender gradient header, the same solid-triangle date-nav glyphs
// used in DayModal/SendToOptionsModal, PremiumUpgradeModal for "AI Insight",
// and DayDashboardModal's exact responsive modal-sizing classes (mobile
// full-bleed → sm:max-w-[640px] → lg:max-w-[1296px]) so this modal matches
// the rest of the analytics/dashboard family.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { PremiumUpgradeModal } from './PremiumUpgradeModal'
import { MONTHS, formatMs, dateKey as buildDateKey, hexToRgba, resolveProgressColor } from './utils'
import { computeRangeStats, getCurrentWeekRange, getCurrentMonthRange } from './AnalyticsPage'
import { calculateBestStreak } from './productivityEngine'
import { DayDashboardModal } from './DayDashboardModal'
import { WeekFullPage } from './WeekFullPage'
import { MonthFullPage } from './MonthFullPage'
import { YearFullPage } from './YearFullPage'
import { ProductiveDot } from './LegendRow'
import type { CalendarData } from './types'

type Timeframe = 'today' | 'weekly' | 'monthly' | 'yearly'
type Scope = 'today' | 'week' | 'month' | 'year'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SCOPES: Scope[] = ['today', 'week', 'month', 'year']
const SCOPE_META: Record<Scope, { dropdownLabel: string; heading: string }> = {
  today: { dropdownLabel: 'Today',      heading: "Today's Overview" },
  week:  { dropdownLabel: 'This Week',  heading: "This Week's Overview" },
  month: { dropdownLabel: 'This Month', heading: "This Month's Overview" },
  year:  { dropdownLabel: 'This Year',  heading: "This Year's Overview" },
}

// Same solid-triangle glyphs used for day-nav arrows elsewhere (DayModal's
// header, SendToOptionsModal's month nav) — duplicated locally per the
// existing convention rather than extracting a shared one-off primitive.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)
const ChevronGlyph = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" fill="none" width="8" height="8" aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 150ms ease', transform: open ? 'rotate(180deg)' : 'none' }}>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ─── Key-list / duration helpers (mirror the exact conventions already
// established in AnalyticsPage.tsx / DayDashboardModal.tsx) ───────────────────

function keysInRange(start: Date, end: Date): string[] {
  const keys: string[] = []
  const cur = new Date(start); cur.setHours(0, 0, 0, 0)
  const e = new Date(end); e.setHours(0, 0, 0, 0)
  while (cur <= e) { keys.push(buildDateKey(cur.getFullYear(), cur.getMonth(), cur.getDate())); cur.setDate(cur.getDate() + 1) }
  return keys
}

function getSessionDurationMs(startTs: number, endTs: number): number {
  let d = endTs - startTs
  if (d < 0) d += 86_400_000
  return Math.max(d, 0)
}

// Hour-of-day histogram (ms per hour, 0–23) across every session in range —
// no existing source aggregates by hour-of-day (computeRangeStats aggregates
// per-day), so this is a genuinely new view, built with the identical
// session-iteration/duration-clamping pattern computeRangeStats already uses.
function computeHourlyBreakdown(calData: CalendarData, start: Date, end: Date): number[] {
  const buckets = new Array(24).fill(0) as number[]
  const cursor = new Date(start); cursor.setHours(0, 0, 0, 0)
  const e = new Date(end); e.setHours(23, 59, 59, 999)
  while (cursor <= e) {
    const k = buildDateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
    calData[k]?.tasks?.forEach(t => {
      ;(t.sessions ?? []).forEach(s => {
        if (s.endTs !== null) {
          const dur = getSessionDurationMs(s.startTs, s.endTs)
          if (dur > 0 && dur < 86_400_000) buckets[new Date(s.startTs).getHours()] += dur
        }
      })
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return buckets
}

// Deep Work Hours: the single task with the highest cumulative tracked time
// within the selected period. Each calendar day stores its own independent
// Task objects (own id, own sessions) — there's no cross-day recurring-task
// id in the data model — so "the same task across multiple days" is grouped
// by its trimmed/lower-cased text, the only stable identity available, before
// summing that group's session durations (same clamping as computeRangeStats).
function computeDeepWorkMs(calData: CalendarData, start: Date, end: Date): number {
  const totals = new Map<string, number>()
  const cursor = new Date(start); cursor.setHours(0, 0, 0, 0)
  const e = new Date(end); e.setHours(23, 59, 59, 999)
  while (cursor <= e) {
    const k = buildDateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
    calData[k]?.tasks?.forEach(t => {
      const key = t.text.trim().toLowerCase()
      if (!key) return
      const ms = (t.sessions ?? [])
        .filter(s => s.endTs !== null)
        .reduce((sum, s) => sum + getSessionDurationMs(s.startTs, s.endTs!), 0)
      if (ms > 0) totals.set(key, (totals.get(key) ?? 0) + ms)
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return totals.size > 0 ? Math.max(...totals.values()) : 0
}

function getScopeRange(scope: Scope, todayScopeDate: Date, today: Date): { start: Date; end: Date } {
  if (scope === 'today') { const d = new Date(todayScopeDate); d.setHours(0, 0, 0, 0); return { start: d, end: d } }
  if (scope === 'week') { const { start, end } = getCurrentWeekRange(); return { start, end } }
  if (scope === 'month') { const { start, end } = getCurrentMonthRange(); return { start, end } }
  return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31) }
}

function fmtShort(d: Date): string { return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` }

function scopePeriodLabel(scope: Scope, todayScopeDate: Date, today: Date): string {
  if (scope === 'today') return `${DAY_NAMES[todayScopeDate.getDay()]}, ${MONTHS[todayScopeDate.getMonth()].slice(0, 3)} ${todayScopeDate.getDate()}, ${todayScopeDate.getFullYear()}`
  if (scope === 'week') { const { start, end } = getCurrentWeekRange(); return `${fmtShort(start)} – ${fmtShort(end)}, ${start.getFullYear()}` }
  if (scope === 'month') return `${MONTHS[today.getMonth()]} ${today.getFullYear()}`
  return String(today.getFullYear())
}

// ─── Timeframe cards ───────────────────────────────────────────────────────────

// Reuses the EXACT gradients/shadows already implemented for the Settings →
// "Your Subscription Plan" cards (SettingsModal.tsx) — not an approximation.
// Today←Premium Yearly's orange/amber gradient, Weekly←Premium Monthly's
// green, Monthly←Lifetime Pro's cyan. hoverShadow reuses each color's own
// `.xp-plan-*:hover` box-shadow constant (xp-plan-orange's rule exists in
// SettingsModal.tsx but isn't currently attached to any card there — it's
// exactly the "orange hover" value this Today card needs). ringRgb drives
// the selected-state outline, matched to each card's own color family
// (Yearly keeps purple since purple IS its own color).
const TIMEFRAMES: { id: Timeframe; icon: string; title: string; desc: string; bg: string; shadow: string; hoverShadow: string; ringRgb: string }[] = [
  { id: 'today',   icon: '🚀', title: "Today's Dashboard", desc: "View today's productivity",
    bg: 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #fbbf24 100%)', shadow: '0 4px 18px rgba(217,119,6,0.42)', hoverShadow: '0 8px 28px rgba(234,88,12,0.38)', ringRgb: '234,88,12' },
  { id: 'weekly',  icon: '📆', title: 'Weekly Dashboard',  desc: "See this week's progress",
    bg: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)', shadow: '0 4px 18px rgba(22,163,74,0.30)', hoverShadow: '0 8px 28px rgba(22,163,74,0.38)', ringRgb: '34,197,94' },
  { id: 'monthly', icon: '📈', title: 'Monthly Dashboard', desc: 'Track monthly trends',
    bg: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)', shadow: '0 4px 18px rgba(6,182,212,0.28)', hoverShadow: '0 8px 28px rgba(6,182,212,0.38)', ringRgb: '6,182,212' },
  // Light side reuses #a78bfa — XPadite's established lighter lavender accent
  // (used elsewhere for "today" highlights, V2 badges, etc.) — transitioning
  // through the signature header's own #7c3aed → #5b21b6, so no new purple
  // is introduced.
  { id: 'yearly',  icon: '💎', title: 'Yearly Dashboard',  desc: 'View long-term growth',
    bg: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 55%, #5b21b6 100%)', shadow: '0 4px 18px rgba(124,58,237,0.32)', hoverShadow: '0 8px 28px rgba(124,58,237,0.42)', ringRgb: '124,58,237' },
]

function TimeframeCard({ def, selected, onSelect }: {
  def: (typeof TIMEFRAMES)[number]; selected: boolean; onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="text-left rounded-2xl p-4"
      style={{
        // Permanent rich gradient — always visible, never a hover-only effect.
        background: def.bg,
        filter: hovered ? 'brightness(1.07)' : 'none',
        // Selected uses a white ring (visible against any of the 4 base
        // colors, including the purple card itself) plus an accent ring in
        // the card's OWN color family — never a fill/overlay that would
        // wash out the card's own color.
        boxShadow: selected
          ? `0 0 0 2px rgba(255,255,255,0.92), 0 0 0 4px rgba(${def.ringRgb},0.65), ${def.shadow}`
          : hovered ? def.hoverShadow : def.shadow,
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'transform 160ms ease, box-shadow 160ms ease, filter 160ms ease',
      }}
    >
      <div className="mb-2" style={{ fontSize: 30, lineHeight: 1 }}>{def.icon}</div>
      <p className="text-[13px] font-bold" style={{ color: '#ffffff' }}>{def.title}</p>
      <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'rgba(255,255,255,0.80)' }}>{def.desc}</p>
    </button>
  )
}

// ─── Overview scope dropdown (replaces the old static "Today" pill) ──────────
// Mirrors StatsRow.tsx's ScopePill/DropdownOption visual language (pill
// trigger + chevron, absolute dropdown panel, checkmark on the selection) —
// simplified to 4 flat options since this picker has no date drilldown.

function OverviewScopeDropdown({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-full transition-opacity hover:opacity-90"
        style={{ background: '#7c3aed', color: '#ffffff', border: 'none', cursor: 'pointer' }}
      >
        {SCOPE_META[scope].dropdownLabel}
        <ChevronGlyph open={open} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden py-1"
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', minWidth: 148, boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10)' }}
        >
          {SCOPES.map(s => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
              style={{
                color: scope === s ? '#7c3aed' : 'var(--xp-txt)',
                background: scope === s ? 'rgba(124,58,237,0.08)' : 'transparent',
                fontWeight: scope === s ? 600 : 400,
              }}
            >
              {SCOPE_META[s].dropdownLabel}
              {scope === s && <span style={{ color: '#7c3aed', fontSize: 11 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Overview stat cards ───────────────────────────────────────────────────────
// Icon sits in a boxed tinted container on desktop (lg+, unchanged); on
// tablet/mobile the same icon renders bare, no container — item 8.

function OverviewStat({ icon, tint, value, label }: { icon: React.ReactNode; tint: string; value: string; label: string }) {
  return (
    <div className="rounded-2xl p-3.5 flex items-center gap-3" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
      <div className="hidden lg:flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: tint, fontSize: 16 }}>
        {icon}
      </div>
      <div className="flex lg:hidden items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, fontSize: 18 }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-extrabold leading-none" style={{ color: 'var(--xp-txt)' }}>{value}</p>
        <p className="text-[9.5px] mt-1 leading-snug" style={{ color: 'var(--xp-txt3)' }}>{label}</p>
      </div>
    </div>
  )
}

// ─── XPadite productive/streak markers ─────────────────────────────────────
function StreakMarker({ color }: { color: string }) {
  const dot = { width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 0 1.5px ${hexToRgba(color, 0.3)}` } as const
  const bar = { width: 9, height: 2, background: color } as const
  return (
    <div className="flex items-center flex-shrink-0">
      <div style={dot} /><div style={bar} /><div style={dot} /><div style={bar} /><div style={dot} />
    </div>
  )
}

// ─── Donut chart (Productive vs Non-Productive, built from real actBreakdown) ─

function Donut({ segments, size = 128, strokeWidth = 20 }: { segments: { color: string; pct: number }[]; size?: number; strokeWidth?: number }) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const arcs = segments.reduce<{ color: string; len: number; offset: number }[]>((acc, seg) => {
    const len = (seg.pct) * c
    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].len : 0
    return [...acc, { color: seg.color, len, offset }]
  }, [])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--xp-bdr2)" strokeWidth={strokeWidth} opacity={0.35} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {arcs.map((a, i) => (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={strokeWidth} strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.offset} />
        ))}
      </g>
    </svg>
  )
}

// ─── Hourly breakdown bar chart (real per-hour totals for the selected scope) ─

const HOURLY_WINDOW = Array.from({ length: 16 }, (_, i) => i + 6) // 6am–9pm
const HOUR_TICK_LABELS = ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM']

function HourlyBarChart({ buckets, isDark }: { buckets: number[]; isDark: boolean }) {
  const windowed = HOURLY_WINDOW.map(h => buckets[h])
  const peakMs = Math.max(...windowed, 0)
  const maxMs = peakMs > 0 ? peakMs * 1.15 : 3_600_000
  const W = 600, H = 170, padL = 30, padB = 20, padT = 8, padR = 6
  const plotW = W - padL - padR, plotH = H - padT - padB
  const slotW = plotW / windowed.length
  const barW = Math.max(6, slotW * 0.55)
  const gridLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const ticks = [0, maxMs / 2, maxMs]

  if (peakMs === 0) {
    return <p className="text-[11px] py-6 text-center" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded</p>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: H, display: 'block' }}>
      {ticks.map((v, i) => {
        const y = padT + plotH - (v / maxMs) * plotH
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={gridLine} strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--xp-txt3)">{v === 0 ? '0' : formatMs(v)}</text>
          </g>
        )
      })}
      {windowed.map((v, i) => {
        const x = padL + slotW * i + (slotW - barW) / 2
        const h = (v / maxMs) * plotH
        const y = padT + plotH - h
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={3} fill="#7c3aed" opacity={v > 0 ? 0.85 : 0.12} />
      })}
      {HOUR_TICK_LABELS.map((lbl, idx) => {
        const pos = idx / (HOUR_TICK_LABELS.length - 1)
        const x = padL + pos * plotW
        return <text key={lbl} x={x} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--xp-txt3)">{lbl}</text>
      })}
    </svg>
  )
}

// ─── Section card wrapper ──────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
      <p className="text-[12px] font-bold mb-3" style={{ color: 'var(--xp-txt)' }}>{title}</p>
      {children}
    </div>
  )
}

// ─── Bottom summary cards ──────────────────────────────────────────────────────

function SummaryCard({ icon, iconBg, title, value, sub }: {
  icon: string; iconBg: string; title: string; value: string; sub: string
}) {
  return (
    <button
      className="w-full flex items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-black/5"
      style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}
    >
      <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: iconBg, fontSize: 17 }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10.5px] font-medium" style={{ color: 'var(--xp-txt3)' }}>{title}</p>
        <p className="text-[14px] font-bold truncate" style={{ color: 'var(--xp-txt)' }}>{value}</p>
        <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>{sub}</p>
      </div>
      <span style={{ color: 'var(--xp-txt3)', fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  )
}

// ─── Legend ─────────────────────────────────────────────────────────────────

function AnalyticsLegend({ progressColor }: { progressColor: string }) {
  const items: { icon: React.ReactNode; label: string }[] = [
    { icon: <ProductiveDot color={progressColor} size={13} />, label: 'Productive' },
    { icon: <span style={{ fontSize: 11 }}>🔥</span>, label: 'Hyper productive' },
    { icon: <StreakMarker color={progressColor} />, label: 'Streak' },
    { icon: <span style={{ fontSize: 11 }}>🏆</span>, label: 'Milestone' },
    { icon: <span style={{ fontSize: 11 }}>🎯</span>, label: 'Goals Accomplished' },
  ]
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pt-1 pb-2">
      {items.map(item => (
        <span key={item.label} className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>
          {item.icon}
          {item.label}
        </span>
      ))}
    </div>
  )
}

// ─── AnalyticsModal (main export) ──────────────────────────────────────────────

export function AnalyticsModal({ onClose, onDayDoubleClick }: { onClose: () => void; onDayDoubleClick?: (key: string, month: number, day: number) => void }) {
  const { isDark, calData, activities, progressColor: rawProgressColor } = useApp()
  const progressColor = resolveProgressColor(rawProgressColor, isDark)

  // Freeze the page behind this modal at every breakpoint (not just desktop)
  // so neither wheel/trackpad nor touch-scroll-through can ever expose the
  // calendar underneath — including once a nested dashboard (Today's/Monthly)
  // adds its own scrollable region on top.
  useEffect(() => {
    const scrollY = window.scrollY
    const prevOverflow = document.body.style.overflow
    const prevPosition = document.body.style.position
    const prevTop = document.body.style.top
    const prevWidth = document.body.style.width
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.position = prevPosition
      document.body.style.top = prevTop
      document.body.style.width = prevWidth
      window.scrollTo(0, scrollY)
    }
  }, [])

  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('today')
  const [scope, setScope] = useState<Scope>('today')
  const [todayScopeDate, setTodayScopeDate] = useState(() => new Date())
  const [showPremium, setShowPremium] = useState(false)
  const [openDashboard, setOpenDashboard] = useState<'today' | 'weekly' | 'monthly' | 'yearly' | null>(null)

  function handleTimeframeSelect(id: Timeframe) {
    setSelectedTimeframe(id)
    setOpenDashboard(id)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showPremium) { setShowPremium(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showPremium])

  const today = useMemo(() => new Date(), [])
  function shiftTodayScopeDay(delta: number) {
    setTodayScopeDate(d => { const n = new Date(d); n.setDate(n.getDate() + delta); return n })
  }

  const range = useMemo(() => getScopeRange(scope, todayScopeDate, today), [scope, todayScopeDate, today])
  const periodLabel = useMemo(() => scopePeriodLabel(scope, todayScopeDate, today), [scope, todayScopeDate, today])

  const stats = useMemo(() => computeRangeStats(calData, activities, range.start, range.end), [calData, activities, range])
  const bestStreak = useMemo(() => calculateBestStreak(calData, keysInRange(range.start, range.end)), [calData, range])
  const hourlyBuckets = useMemo(() => computeHourlyBreakdown(calData, range.start, range.end), [calData, range])
  const deepWorkMs = useMemo(() => computeDeepWorkMs(calData, range.start, range.end), [calData, range])

  // Top 5 activities + an "Other" bucket for the rest, mirroring the same
  // cap AnalyticsPage.tsx's ActivityBars already uses (.slice(0, 6)).
  const donutSegments = useMemo(() => {
    const top = stats.actBreakdown.slice(0, 5)
    const restMs = stats.actBreakdown.slice(5).reduce((s, a) => s + a.ms, 0)
    const withOther = restMs > 0
      ? [...top, { actId: '__other', name: 'Other', color: '#9ca3af', ms: restMs, pct: stats.totalMs > 0 ? restMs / stats.totalMs : 0 }]
      : top
    return withOther
  }, [stats])

  const topActivity = stats.actBreakdown[0] ?? null

  return (
    <>
      {/* Outside-click intentionally does not close this modal — Analytics
          only closes via its own explicit close/navigation controls. Hidden
          (not unmounted, so its own scroll position/state survive) whenever
          a nested dashboard is open — otherwise this card's own height (which
          can differ from the nested dashboard's) peeks out from behind/below
          the nested overlay's semi-transparent backdrop. */}
      <div
        className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-50 flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4"
        style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)', display: openDashboard ? 'none' : undefined }}
      >
        <div
          className="flex flex-col w-full h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6"
          style={{
            background: 'var(--xp-bg)',
            border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
            boxShadow: isDark ? '0 30px 70px rgba(0,0,0,0.75)' : '0 20px 50px rgba(0,0,0,0.12)',
          }}
        >
          {/* XPadite signature purple header — vertical height matched to
              Today's Dashboard's header (min-h-[60px]/sm:min-h-[64px]);
              icon/title/subtitle/buttons sized down to fit that height. */}
          <div
            className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 min-h-[60px] sm:min-h-[64px]"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>📊</span>
              <div className="min-w-0">
                <h2 className="text-[14px] sm:text-[16px] font-extrabold leading-tight" style={{ color: '#ffffff' }}>Analytics</h2>
                <p className="text-[9px] sm:text-[10px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  Track your progress, performance &amp; productivity
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowPremium(true)}
                className="hidden sm:flex items-center gap-1.5 text-[10.5px] font-bold px-3 py-1.5 rounded-full transition-opacity hover:opacity-85"
                style={{ background: '#ffffff', color: '#7c3aed', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
              >
                ✨ AI Insight
              </button>
              <button
                onClick={() => setShowPremium(true)}
                className="sm:hidden flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
                style={{ width: 26, height: 26, background: '#ffffff', color: '#7c3aed', fontSize: 12 }}
                aria-label="AI Insight"
              >
                ✨
              </button>
              <button
                onClick={onClose}
                aria-label="Close Analytics"
                className="flex items-center justify-center rounded-full flex-shrink-0 transition-opacity hover:opacity-75"
                style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.18)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-5">

            {/* Timeframe cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
              {TIMEFRAMES.map(def => (
                <TimeframeCard key={def.id} def={def} selected={selectedTimeframe === def.id} onSelect={() => handleTimeframeSelect(def.id)} />
              ))}
            </div>

            {/* Overview heading + scope dropdown + date nav */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--xp-txt)' }}>{SCOPE_META[scope].heading}</h3>
              <div className="flex items-center gap-2">
                {scope === 'today' && (
                  <>
                    <button
                      onClick={() => shiftTodayScopeDay(-1)}
                      aria-label="Previous day"
                      className="flex items-center justify-center rounded-full transition-colors hover:bg-black/5"
                      style={{ width: 24, height: 24, color: 'var(--xp-txt3)', background: 'var(--xp-bg3)', border: 'none', cursor: 'pointer' }}
                    >
                      <PrevTriangle />
                    </button>
                    <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{periodLabel}</span>
                    <button
                      onClick={() => shiftTodayScopeDay(1)}
                      aria-label="Next day"
                      className="flex items-center justify-center rounded-full transition-colors hover:bg-black/5"
                      style={{ width: 24, height: 24, color: 'var(--xp-txt3)', background: 'var(--xp-bg3)', border: 'none', cursor: 'pointer' }}
                    >
                      <NextTriangle />
                    </button>
                  </>
                )}
                {scope !== 'today' && (
                  <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{periodLabel}</span>
                )}
                <OverviewScopeDropdown scope={scope} onChange={setScope} />
              </div>
            </div>

            {/* Overview stat cards — real data for the selected scope */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <OverviewStat icon={<ProductiveDot color={progressColor} />} tint={hexToRgba(progressColor, 0.10)} value={String(stats.productiveDays)} label="Productive Days" />
              <OverviewStat icon="🔥" tint="rgba(249,115,22,0.10)" value={String(stats.hyperDays)} label="Hyper Productive Days" />
              <OverviewStat icon={<StreakMarker color={progressColor} />} tint={hexToRgba(progressColor, 0.10)} value={`${bestStreak} day${bestStreak === 1 ? '' : 's'}`} label="Longest Streak" />
              <OverviewStat icon="⏱" tint="rgba(59,130,246,0.10)" value={formatMs(stats.totalMs)} label="Total Tracked Time" />
              <OverviewStat icon="✅" tint="rgba(34,197,94,0.10)" value={String(stats.completedTasks)} label="Tasks Completed" />
              <OverviewStat icon="🏆" tint="rgba(234,179,8,0.12)" value={String(stats.milestoneDays)} label="Milestones Achieved" />
              <OverviewStat icon="🎯" tint="rgba(20,184,166,0.10)" value={String(stats.goalDays)} label="Goals Accomplished" />
              <OverviewStat icon="🧠" tint="rgba(124,58,237,0.10)" value={deepWorkMs > 0 ? formatMs(deepWorkMs) : '—'} label="Deep Work Hours" />
            </div>

            {/* Analytics visuals — donut + hourly breakdown, real data */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Panel title="Productive vs Non-Productive">
                {stats.totalMs === 0 ? (
                  <p className="text-[11px] py-6 text-center" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded</p>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
                      <Donut segments={donutSegments.map(s => ({ color: s.color, pct: s.pct }))} />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[16px] font-extrabold" style={{ color: 'var(--xp-txt)' }}>{formatMs(stats.totalMs)}</span>
                        <span className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>Total Time</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      {donutSegments.map(seg => (
                        <div key={seg.actId} className="flex items-center gap-2">
                          <span className="rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: seg.color }} />
                          <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--xp-txt2)' }}>{seg.name}</span>
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{Math.round(seg.pct * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Hourly Breakdown">
                <HourlyBarChart buckets={hourlyBuckets} isDark={isDark} />
              </Panel>
            </div>

            {/* Bottom summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SummaryCard
                icon="🚀" iconBg="rgba(16,185,129,0.14)"
                title="Most Productive Activity"
                value={topActivity ? topActivity.name : '—'}
                sub={topActivity ? `${Math.round(topActivity.pct * 100)}% of total time` : 'No activity data yet'}
              />
              <SummaryCard
                icon="✅" iconBg="rgba(59,130,246,0.14)"
                title="Tasks Completed"
                value={stats.completedTasks.toLocaleString()}
                sub="Tasks Completed"
              />
            </div>

            {/* Legend / key */}
            <AnalyticsLegend progressColor={progressColor} />
          </div>
        </div>
      </div>

      {/* Today's Dashboard — the exact existing component (DayDashboardModal),
          same props/open-close flow AnalyticsPage.tsx itself uses. */}
      {openDashboard === 'today' && (
        <DayDashboardModal
          dateKey={buildDateKey(today.getFullYear(), today.getMonth(), today.getDate())}
          month={today.getMonth()}
          day={today.getDate()}
          onClose={() => setOpenDashboard(null)}
          onBack={() => setOpenDashboard(null)}
        />
      )}

      {/* Weekly Dashboard — built directly on Monthly/Yearly Dashboard's
          design system (WeekFullPage.tsx), opened into the IDENTICAL
          backdrop+card shell used by Monthly/Yearly above and by this
          modal's own main content, so switching between them never changes
          the outer modal's width/height. */}
      {openDashboard === 'weekly' && (
        <div
          className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[51] flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4"
          style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="flex flex-col w-full h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6"
            style={{
              background: 'var(--xp-bg)',
              border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
              boxShadow: isDark ? '0 30px 70px rgba(0,0,0,0.75)' : '0 20px 50px rgba(0,0,0,0.12)',
            }}
          >
            <WeekFullPage onClose={() => setOpenDashboard(null)} />
          </div>
        </div>
      )}

      {/* Monthly Dashboard — the exact existing Expandable Month Modal
          (MonthFullPage), opened straight into its own dashboard view and
          rendered via its `embedded` prop so it fills this modal's own
          card shell instead of bringing its own backdrop/sizing (which
          previously produced a second, mismatched modal layer). The shell
          here is the IDENTICAL backdrop+card recipe (incl. sm:h-auto) used
          by this modal's own main content and by DayDashboardModal, so
          switching Analytics → Monthly never changes the outer modal's
          width/height — MonthFullPage's scroll body switches to matching
          content-driven height on desktop/tablet via `embedded` (mobile
          still scrolls internally within this same bounded shell). */}
      {openDashboard === 'monthly' && (
        <div
          className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[51] flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4"
          style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="flex flex-col w-full h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6"
            style={{
              background: 'var(--xp-bg)',
              border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
              boxShadow: isDark ? '0 30px 70px rgba(0,0,0,0.75)' : '0 20px 50px rgba(0,0,0,0.12)',
            }}
          >
            <MonthFullPage
              month={today.getMonth()}
              initialView="dashboard"
              embedded
              onClose={() => setOpenDashboard(null)}
              onDayDoubleClick={onDayDoubleClick}
            />
          </div>
        </div>
      )}

      {/* Yearly Dashboard — built directly on Monthly Dashboard's design
          system (YearFullPage.tsx), opened into the IDENTICAL backdrop+card
          shell used by Monthly above and by this modal's own main content,
          so switching between them never changes the outer modal's
          width/height. */}
      {openDashboard === 'yearly' && (
        <div
          className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[51] flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4"
          style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="flex flex-col w-full h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6"
            style={{
              background: 'var(--xp-bg)',
              border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
              boxShadow: isDark ? '0 30px 70px rgba(0,0,0,0.75)' : '0 20px 50px rgba(0,0,0,0.12)',
            }}
          >
            <YearFullPage onClose={() => setOpenDashboard(null)} />
          </div>
        </div>
      )}

      {showPremium && <PremiumUpgradeModal onClose={() => setShowPremium(false)} />}
    </>
  )
}
