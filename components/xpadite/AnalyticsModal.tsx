'use client'

// ── Analytics modal — front-end + real data wiring ────────────────────────────
// The 4 timeframe cards are the dashboard hub: each opens its own FullPage
// component (DayFullPage/WeekFullPage/MonthFullPage/YearFullPage), embedded
// in this modal's own container. Below them sits a compact, data-driven
// EXECUTIVE SUMMARY of the user's real analytics — Performance Pulse,
// Personal Records, Progress Trend, XPadite Insights, Next Target — rather
// than a duplicate of the detailed dashboards' own stats. Every number here
// is derived from the SAME `calData` source (and the same productive-
// session/deep-work conventions) the four detailed dashboards already use —
// see `daySummaries` below, the one per-day aggregation every section reads
// from, so there's a single source of truth rather than five parallel
// calculations.
//
// Body scroll is locked locally (below) with the stronger position:fixed
// technique at every breakpoint — not the shared useLockBodyScroll, whose
// mobile branch doesn't fully stop iOS scroll-through once nested dashboards
// add their own scrollable regions. Reuses established XPadite patterns: the
// signature purple/lavender gradient header and DayDashboardModal's exact
// responsive modal-sizing classes (mobile full-bleed → sm:max-w-[640px] →
// lg:max-w-[1296px]) so this modal matches the rest of the analytics/
// dashboard family.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { PremiumUpgradeModal } from './PremiumUpgradeModal'
import { formatMs, dateKey as buildDateKey, isProductiveActivity, resolveProgressColor } from './utils'
import { calculateBestStreak } from './productivityEngine'
import { AICoachMenuIcon } from './AppSidebar'
import { DayFullPage } from './DayFullPage'
import { WeekFullPage } from './WeekFullPage'
import { MonthFullPage } from './MonthFullPage'
import { YearFullPage } from './YearFullPage'
import { LegendRow, ProductiveDot } from './LegendRow'

type Timeframe = 'today' | 'weekly' | 'monthly' | 'yearly'
type Dir = 'up' | 'down' | 'flat'

// ─── Date helpers ───────────────────────────────────────────────────────────

function parseDateKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
// Monday→Sunday week definition — the same convention established for the
// Weekly Dashboard (WeekFullPage.tsx) and AnalyticsPage.tsx's
// getCurrentWeekRange, so "a week" means the same thing everywhere.
function mondayOf(d: Date): Date {
  const offset = d.getDay() === 0 ? 6 : d.getDay() - 1
  const m = new Date(d)
  m.setDate(d.getDate() - offset)
  m.setHours(0, 0, 0, 0)
  return m
}
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

// ─── Change-direction helpers ───────────────────────────────────────────────
// A small neutral tolerance keeps noisy/negligible differences from reading
// as a meaningful improvement or decline; prev<=0 is handled explicitly so a
// comparison against zero never produces Infinity/NaN.

function pctChange(cur: number, prev: number, tolerancePct = 3): { dir: Dir; pct: number | null } {
  if (prev <= 0) {
    if (cur <= 0) return { dir: 'flat', pct: 0 }
    return { dir: 'up', pct: null } // "New" — no previous baseline to ratio against
  }
  const raw = ((cur - prev) / prev) * 100
  if (Math.abs(raw) < tolerancePct) return { dir: 'flat', pct: Math.round(raw) }
  return { dir: raw > 0 ? 'up' : 'down', pct: Math.round(raw) }
}
function dirArrow(dir: Dir): string { return dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→' }
function dirColor(dir: Dir, isDark: boolean): string {
  if (dir === 'up') return isDark ? '#4ade80' : '#16a34a'
  if (dir === 'down') return isDark ? '#f87171' : '#dc2626'
  return 'var(--xp-txt3)'
}

// Dominant 2-hour focus window across a flat session list — a lighter,
// single-window version of the same time-of-day bucket algorithm the
// detailed dashboards' "Peak Performance Time" KPI already uses.
function computePeakWindow(sessions: { startTs: number; endTs: number }[]): string | null {
  if (sessions.length < 3) return null
  const BUCKET_HOURS = 2
  const NUM_BUCKETS = 24 / BUCKET_HOURS
  const counts = new Array(NUM_BUCKETS).fill(0) as number[]
  const durations = new Array(NUM_BUCKETS).fill(0) as number[]
  for (const s of sessions) {
    const bucket = Math.floor(new Date(s.startTs).getHours() / BUCKET_HOURS)
    counts[bucket] += 1
    durations[bucket] += getSessionDurationMs(s.startTs, s.endTs)
  }
  const maxCount = Math.max(...counts, 1)
  const maxDur = Math.max(...durations, 1)
  const scores = counts.map((c, i) => (c / maxCount) * 0.5 + (durations[i] / maxDur) * 0.5)
  let topIdx = 0
  for (let i = 1; i < NUM_BUCKETS; i++) if (scores[i] > scores[topIdx]) topIdx = i
  if (scores[topIdx] === 0) return null
  function fmtHour(h: number): string {
    const hh = ((h % 24) + 24) % 24
    const period = hh < 12 ? 'AM' : 'PM'
    let h12 = hh % 12
    if (h12 === 0) h12 = 12
    return `${h12} ${period}`
  }
  const start = topIdx * BUCKET_HOURS
  return `${fmtHour(start)}–${fmtHour(start + BUCKET_HOURS)}`
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
      className="text-left rounded-2xl p-4 sm:p-5 flex flex-col justify-center min-h-[92px] sm:min-h-[112px] lg:min-h-[140px]"
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

// ─── Section card wrapper ──────────────────────────────────────────────────────

function SectionCard({ icon, title, subtitle, right, children }: {
  icon: string; title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2 min-w-0">
          <span style={{ fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>{icon}</span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold" style={{ color: 'var(--xp-txt)' }}>{title}</p>
            {subtitle && <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function BaselineState({ text }: { text: string }) {
  return (
    <div className="py-5 text-center">
      <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>Building your baseline</p>
      <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>{text}</p>
    </div>
  )
}

// ─── Performance Index ──────────────────────────────────────────────────────
// A single deterministic 0-100 score blending consistency, intensity,
// achievement and task completion for a selected period — built entirely
// from the SAME day-level flags (productive/hyper/milestone/goal) and
// `daySummaries` aggregation every other section already uses, so there is
// no separate/duplicated data pipeline.

type PerfPeriod = '7d' | '30d' | 'year'
const PERF_PERIOD_LABEL: Record<PerfPeriod, string> = { '7d': 'Last 7 Days', '30d': 'Last 30 Days', year: 'This Year' }
const PERF_PERIOD_PREV_LABEL: Record<PerfPeriod, string> = { '7d': 'previous 7 days', '30d': 'previous 30 days', year: 'previous year' }

interface PerfTier { emoji: string; label: string; color: string }
const PERF_TIERS: { min: number; tier: PerfTier }[] = [
  { min: 90, tier: { emoji: '👑', label: 'Elite Mode', color: '#9253E6' } },
  { min: 75, tier: { emoji: '🔥', label: 'High Performance', color: '#f97316' } },
  { min: 60, tier: { emoji: '🚀', label: 'Strong Momentum', color: '#22c55e' } },
  { min: 40, tier: { emoji: '📈', label: 'Building Momentum', color: '#eab308' } },
  { min: 0, tier: { emoji: '🌱', label: 'Getting Started', color: '#94a3b8' } },
]
function perfTierFor(score: number): PerfTier {
  return (PERF_TIERS.find(t => score >= t.min) ?? PERF_TIERS[PERF_TIERS.length - 1]).tier
}

// Current period + its previous equivalent window, for the "vs previous
// period" comparison. Year uses Jan 1 → today vs. the same Jan 1 → same
// month/day a year earlier, so both windows cover an equal elapsed span.
function perfPeriodRanges(period: PerfPeriod, today: Date): { curStart: Date; curEnd: Date; prevStart: Date; prevEnd: Date } {
  const todayMid = new Date(today); todayMid.setHours(0, 0, 0, 0)
  if (period === '30d') {
    const curEnd = todayMid, curStart = addDays(todayMid, -29)
    const prevEnd = addDays(curStart, -1), prevStart = addDays(prevEnd, -29)
    return { curStart, curEnd, prevStart, prevEnd }
  }
  if (period === 'year') {
    const curStart = new Date(todayMid.getFullYear(), 0, 1)
    const prevStart = new Date(todayMid.getFullYear() - 1, 0, 1)
    const prevEnd = new Date(todayMid.getFullYear() - 1, todayMid.getMonth(), todayMid.getDate())
    return { curStart, curEnd: todayMid, prevStart, prevEnd }
  }
  const curEnd = todayMid, curStart = addDays(todayMid, -6)
  const prevEnd = addDays(curStart, -1), prevStart = addDays(prevEnd, -6)
  return { curStart, curEnd, prevStart, prevEnd }
}

interface PerfAggregate {
  prodDays: number; hyperDays: number; milestoneDays: number; goalDays: number
  completed: number; total: number; longestMs: number; totalDays: number; daysWithData: number
}
// `earliestDate` clamps the window's start to the user's actual first
// tracked day — so a brand-new account measured over "This Year" is scored
// against the days it could possibly have been active, not against months
// that predate the account and would otherwise read as "missed".
function perfAggregate(
  daySummaries: Map<string, { prodFlag: boolean; hyperFlag: boolean; milestoneFlag: boolean; goalFlag: boolean; completedTasks: number; totalTasks: number; ms: number }>,
  start: Date, end: Date, earliestDate: Date | null,
): PerfAggregate {
  const effectiveStart = earliestDate && earliestDate > start ? earliestDate : start
  if (effectiveStart > end) return { prodDays: 0, hyperDays: 0, milestoneDays: 0, goalDays: 0, completed: 0, total: 0, longestMs: 0, totalDays: 0, daysWithData: 0 }
  let prodDays = 0, hyperDays = 0, milestoneDays = 0, goalDays = 0, completed = 0, total = 0, longestMs = 0, daysWithData = 0
  for (let d = new Date(effectiveStart); d <= end; d = addDays(d, 1)) {
    const s = daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))
    if (!s) continue
    daysWithData++
    if (s.prodFlag) prodDays++
    if (s.hyperFlag) hyperDays++
    if (s.milestoneFlag) milestoneDays++
    if (s.goalFlag) goalDays++
    completed += s.completedTasks
    total += s.totalTasks
    if (s.ms > longestMs) longestMs = s.ms
  }
  return { prodDays, hyperDays, milestoneDays, goalDays, completed, total, longestMs, totalDays: keysInRange(effectiveStart, end).length, daysWithData }
}

// Normalizes each dimension to 0–1 before weighting, and caps the "longest
// day" dimension at 6 hours of full credit, so one extreme metric (above
// all, marathon hours) cannot dominate the score on its own. A dimension
// with no legitimate data (e.g. no tasks existed in the period) is omitted
// and its weight redistributed across the rest, rather than fabricated.
function perfScore(agg: PerfAggregate): number | null {
  if (agg.daysWithData === 0 || agg.totalDays === 0) return null
  const HOURS_CAP_MS = 6 * 3_600_000
  const dims: { weight: number; value: number }[] = [
    { weight: 0.30, value: Math.min(1, (agg.prodDays + agg.hyperDays + agg.milestoneDays + agg.goalDays) / agg.totalDays) },
    { weight: 0.15, value: Math.min(1, agg.hyperDays / agg.totalDays) },
    { weight: 0.20, value: Math.min(1, (agg.milestoneDays + agg.goalDays) / agg.totalDays) },
    { weight: 0.15, value: Math.min(1, agg.longestMs / HOURS_CAP_MS) },
  ]
  if (agg.total > 0) dims.push({ weight: 0.20, value: Math.min(1, agg.completed / agg.total) })
  const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
  if (totalWeight === 0) return null
  const raw = dims.reduce((s, d) => s + d.weight * d.value, 0) / totalWeight
  return Math.max(0, Math.min(100, Math.round(raw * 100)))
}

interface PerfMetrics {
  productiveDays: number; hyperDays: number; milestoneDays: number; goalDays: number
  longestMs: number; completedTasks: number; totalTasks: number
}
interface PerformanceIndexData {
  ready: boolean
  score?: number
  tier?: PerfTier
  delta?: { dir: Dir; pct: number | null } | null
  metrics?: PerfMetrics
}

function PeriodSelector({ period, onChange }: { period: PerfPeriod; onChange: (p: PerfPeriod) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10.5px] font-bold px-2.5 py-1 rounded-full"
        style={{ background: 'rgba(124,58,237,0.10)', color: '#7c3aed', border: '0.5px solid rgba(124,58,237,0.25)' }}
      >
        {PERF_PERIOD_LABEL[period]}
        <span style={{ fontSize: 8 }}>▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 rounded-xl overflow-hidden" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: 132 }}>
            {(Object.keys(PERF_PERIOD_LABEL) as PerfPeriod[]).map(p => (
              <button
                key={p}
                onClick={() => { onChange(p); setOpen(false) }}
                className="block w-full text-left text-[11px] px-3 py-2"
                style={{ color: p === period ? '#7c3aed' : 'var(--xp-txt)', background: p === period ? 'rgba(124,58,237,0.08)' : 'transparent', fontWeight: p === period ? 700 : 500 }}
              >
                {PERF_PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Large circular score gauge — animates the ring fill and the numeric
// count-up together from 0, and fires `onComplete` once the animation
// settles (Elite Mode's celebration waits for this so it never overlaps the
// count-up). Respects reduced-motion by jumping straight to the final value.
function PerformanceRing({ score, tier, emphasize, onComplete }: { score: number; tier: PerfTier; emphasize: boolean; onComplete?: () => void }) {
  const uid = useId().replace(/[:]/g, '')
  const SIZE = 148, SW = 12
  const r = (SIZE - SW) / 2
  const c = 2 * Math.PI * r
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [anim, setAnim] = useState(() => (reduceMotion ? score : 0))
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })

  // Every `setAnim`/completion call below runs inside a requestAnimationFrame
  // callback (never synchronously in the effect body itself), so re-running
  // this effect when `score` changes (e.g. switching periods) animates to
  // the new value in place rather than needing a remount.
  useEffect(() => {
    let cancelled = false
    let fired = false
    function fireComplete() { if (!fired) { fired = true; onCompleteRef.current?.() } }
    if (reduceMotion) {
      const raf = requestAnimationFrame(() => { if (!cancelled) { setAnim(score); fireComplete() } })
      return () => { cancelled = true; cancelAnimationFrame(raf) }
    }
    const DURATION = 1300
    const start = performance.now()
    let raf = 0
    function tick(now: number) {
      const t = Math.min((now - start) / DURATION, 1)
      setAnim(score * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(tick)
      else { setAnim(score); fireComplete() }
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [score, reduceMotion])

  const offset = c * (1 - anim / 100)
  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
      <style>{`@keyframes xp-perf-emphasize { 0% { transform: scale(1); } 40% { transform: scale(1.14); } 100% { transform: scale(1); } }`}</style>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#5b21b6" />
          </linearGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="rgba(124,58,237,0.14)" strokeWidth={SW} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke={`url(#${uid}-ring)`} strokeWidth={SW}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ animation: emphasize ? 'xp-perf-emphasize 700ms ease' : undefined }}>
        <span className="text-[30px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--xp-txt)' }}>{Math.round(anim)}%</span>
        <span className="text-[10px] font-bold mt-1.5 text-center px-2" style={{ color: tier.color }}>{tier.emoji} {tier.label}</span>
      </div>
    </div>
  )
}

function PerfMetricRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(124,58,237,0.045)' }}>
      <span className="flex items-center gap-2 text-[11px] font-medium min-w-0" style={{ color: 'var(--xp-txt)' }}>
        <span className="flex items-center justify-center" style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="text-[11.5px] font-bold flex-shrink-0 tabular-nums" style={{ color: 'var(--xp-txt)' }}>{value}</span>
    </div>
  )
}

// A tasteful, localized burst confined to the card itself (not full-screen)
// — reuses the exact same `xp-confetti` keyframe/particle technique already
// established for DayModal.tsx's own ConfettiPop, rather than inventing a
// second confetti system.
function PerfConfettiBurst({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t) }, [onDone])
  // Randomized once per mount via a lazy initializer (not recomputed on
  // re-render), the standard way to keep a one-time random value out of the
  // render body itself.
  const [particles] = useState(() => {
    const COLORS = ['#f97316', '#9253E6', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb7185', '#60a5fa']
    return Array.from({ length: 22 }, (_, i) => {
      const angle = (i / 22) * 360 + (Math.random() * 20 - 10)
      const dist = 55 + Math.random() * 65
      const rad = (angle * Math.PI) / 180
      return { color: COLORS[i % COLORS.length], tx: Math.cos(rad) * dist, ty: Math.sin(rad) * dist - 15, rot: Math.random() * 540 - 270, size: 4 + Math.random() * 5, delay: Math.random() * 0.15, isRect: i % 3 !== 0 }
    })
  })
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 16 }}>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', width: p.size, height: p.isRect ? p.size * 2.2 : p.size, borderRadius: p.isRect ? 2 : '50%', background: p.color, ['--tx' as string]: `${p.tx}px`, ['--ty' as string]: `${p.ty}px`, ['--rot' as string]: `${p.rot}deg`, animation: `xp-confetti 1.3s ${p.delay}s cubic-bezier(0.2,0.8,0.4,1) forwards` } as React.CSSProperties} />
      ))}
    </div>
  )
}

function PerformanceIndexCard({ data, period, onPeriodChange, pendingCelebration, onCelebrated, isDark, progressColor }: {
  data: PerformanceIndexData
  period: PerfPeriod
  onPeriodChange: (p: PerfPeriod) => void
  pendingCelebration: boolean
  onCelebrated: () => void
  isDark: boolean
  progressColor: string
}) {
  const [showConfetti, setShowConfetti] = useState(false)
  const [emphasize, setEmphasize] = useState(false)

  function handleGaugeComplete() {
    if (!pendingCelebration) return
    onCelebrated()
    setEmphasize(true)
    setShowConfetti(true)
    setTimeout(() => setEmphasize(false), 750)
    setTimeout(() => setShowConfetti(false), 1700)
  }

  if (!data.ready || data.score === undefined || !data.tier || !data.metrics) {
    return (
      <SectionCard
        icon="⚡" title="Performance Index" subtitle="Your productivity & achievement performance"
        right={<PeriodSelector period={period} onChange={onPeriodChange} />}
      >
        <BaselineState text="Keep using XPadite and your Performance Index will appear here." />
      </SectionCard>
    )
  }

  const m = data.metrics
  const longestLabel = m.longestMs > 0 ? formatMs(m.longestMs) : '—'
  const tasksLabel = m.totalTasks > 0 ? `${m.completedTasks} / ${m.totalTasks}` : '—'

  return (
    <SectionCard
      icon="⚡" title="Performance Index" subtitle="Your productivity & achievement performance"
      right={<PeriodSelector period={period} onChange={onPeriodChange} />}
    >
      <div className="relative">
        {showConfetti && <PerfConfettiBurst onDone={() => setShowConfetti(false)} />}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
          <div className="flex flex-col items-center flex-shrink-0">
            <PerformanceRing score={data.score} tier={data.tier} emphasize={emphasize} onComplete={handleGaugeComplete} />
            <p className="text-[10.5px] font-semibold mt-2" style={{ color: 'var(--xp-txt2)' }}>Performance Score</p>
            {data.delta && (
              <p className="text-[10px] font-bold mt-0.5 tabular-nums text-center" style={{ color: dirColor(data.delta.dir, isDark) }}>
                {data.delta.pct === null ? `${dirArrow(data.delta.dir)} New` : `${dirArrow(data.delta.dir)} ${Math.abs(data.delta.pct)}%`}
                <span className="font-normal ml-1" style={{ color: 'var(--xp-txt3)' }}>vs {PERF_PERIOD_PREV_LABEL[period]}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5 w-full min-w-0">
            <PerfMetricRow icon={<ProductiveDot color={progressColor} size={14} />} label="Productive Days" value={String(m.productiveDays)} />
            <PerfMetricRow icon="🔥" label="Hyper Productive Days" value={String(m.hyperDays)} />
            <PerfMetricRow icon="🏆" label="Milestones Accomplished" value={String(m.milestoneDays)} />
            <PerfMetricRow icon="🎯" label="Goals Achieved" value={String(m.goalDays)} />
            <PerfMetricRow icon="⏱️" label="Longest Hours Worked" value={longestLabel} />
            <PerfMetricRow icon="✅" label="Total Tasks Finished" value={tasksLabel} />
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Personal Records ───────────────────────────────────────────────────────

interface RecordsData {
  bestDay: { ms: number; date: Date } | null
  bestWeek: { ms: number; monday: Date } | null
  longestStreak: number
  bestActName: string | null
  bestActPct: number
}

function RecordTile({ icon, bg, label, value, sub }: { icon: string; bg: string; label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-xl p-3" style={{ background: bg }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <p className="text-[9.5px] font-medium mt-1" style={{ color: 'var(--xp-txt3)' }}>{label}</p>
      <p className="text-[14px] font-extrabold mt-0.5 truncate" style={{ color: 'var(--xp-txt)' }}>{value}</p>
      {sub && <p className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--xp-txt3)' }}>{sub}</p>}
    </div>
  )
}

function PersonalRecordsCard({ data, isDark }: { data: RecordsData | null; isDark: boolean }) {
  if (!data || (!data.bestDay && !data.bestWeek && data.longestStreak === 0 && !data.bestActName)) {
    return (
      <SectionCard icon="🏆" title="Personal Records" subtitle="Your best achievements across all time">
        <BaselineState text="Track a few productive days and your all-time records will show up here." />
      </SectionCard>
    )
  }
  return (
    <SectionCard icon="🏆" title="Personal Records" subtitle="Your best achievements across all time">
      <div className="grid grid-cols-2 gap-2">
        <RecordTile
          icon="🔥" bg={isDark ? 'rgba(249,115,22,0.10)' : 'rgba(249,115,22,0.08)'}
          label="Best Day Ever"
          value={data.bestDay ? formatMs(data.bestDay.ms) : '—'}
          sub={data.bestDay ? data.bestDay.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null}
        />
        <RecordTile
          icon="📅" bg={isDark ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.08)'}
          label="Best Week Ever"
          value={data.bestWeek ? formatMs(data.bestWeek.ms) : '—'}
          sub={data.bestWeek ? `Week of ${data.bestWeek.monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : null}
        />
        <RecordTile
          icon="⚡" bg={isDark ? 'rgba(234,179,8,0.10)' : 'rgba(234,179,8,0.08)'}
          label="Longest Streak"
          value={data.longestStreak > 0 ? `${data.longestStreak} day${data.longestStreak === 1 ? '' : 's'}` : '—'}
          sub={null}
        />
        <RecordTile
          icon="🎯" bg={isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.08)'}
          label="Most Productive Activity"
          value={data.bestActName ?? '—'}
          sub={data.bestActName ? `${data.bestActPct}% of total time` : null}
        />
      </div>
    </SectionCard>
  )
}

// ─── Progress Trend ─────────────────────────────────────────────────────────
// A lightweight 12-completed-week bird's-eye view — intentionally NOT the
// detailed Monthly/Weekly Progress chart (no tooltips, no trophy, no bar-
// clearance routing): just enough to answer "am I trending up or down?"

// Below the `sm` breakpoint (640px) — the same mobile/tablet boundary used
// throughout this file's own Tailwind classes. The initial value is read
// synchronously (SSR-safe) via the lazy useState initializer; only later
// genuine viewport changes (resize/rotate) flow through the matchMedia
// listener, so this never calls setState synchronously inside the effect
// body itself.
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function MiniTrendChart({ weeks, isDark }: { weeks: { label: string; ms: number }[]; isDark: boolean }) {
  // Unique per instance so multiple charts never collide on this def id.
  const uid = useId().replace(/[:]/g, '')
  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const isMobile = useIsMobileViewport()
  // Extra top padding (vs. the original 10px) so a lifted final point plus
  // its full arrowhead always has headroom and is never clipped by the
  // SVG's own top edge — cH (and therefore bar/point scaling) is kept
  // identical by growing H by the same amount, so nothing about the data
  // geometry itself shifts, only the blank space reserved above it.
  const W = 680
  const PAD = { top: 26, bottom: 16, left: 4, right: 4 }
  // Mobile-only: the plotting area itself (not the label padding) grows
  // ~60% taller — a real increase in drawable vertical space, not a CSS
  // stretch, so bars/line/labels stay correctly proportioned, just spread
  // across more room. Desktop/tablet keep the original 84px plot height.
  const cH = isMobile ? 134 : 84
  const H = PAD.top + cH + PAD.bottom
  const cW = W - PAD.left - PAD.right
  const slotW = cW / weeks.length
  const barW = Math.max(10, slotW * 0.42)
  const xCenter = (i: number) => PAD.left + i * slotW + slotW / 2
  const yPos = (ms: number) => PAD.top + cH - (ms / maxMs) * cH
  const baseY = PAD.top + cH
  // Clean, intentional clearance between each positive point and its own
  // bar's top — scaled down from the detailed dashboards' own gap to suit
  // this chart's smaller footprint, while still reading as a clear floating
  // gap. Genuine zero-value weeks are pinned exactly at the baseline and
  // never lifted, so a zero reading is never visually misrepresented as
  // non-zero.
  const POINT_GAP = 10
  const SAFE_MARGIN = 5

  interface MiniPt { x: number; y: number; pinned: boolean }
  const pts: MiniPt[] = weeks.map((w, i) => (
    !w.ms || w.ms <= 0
      ? { x: xCenter(i), y: baseY, pinned: true }
      : { x: xCenter(i), y: yPos(w.ms) - POINT_GAP, pinned: false }
  ))

  // The connecting line is drawn as plain straight point-to-point segments
  // only — no inserted bends. Where a straight segment arriving from (or
  // leaving to) a much lower neighbor would otherwise cut across this
  // point's own bar before reaching it, the point itself is lifted further
  // above its natural POINT_GAP position until the segment clears that
  // bar's safe height (mirrors TrendBarChart.tsx's same approach).
  function barSafeY(i: number): number | null {
    const ms = weeks[i]?.ms
    if (!ms || ms <= 0) return null
    return yPos(ms) - SAFE_MARGIN
  }
  function requiredY(i: number, nb: MiniPt): number | null {
    const safeY = barSafeY(i)
    if (safeY == null) return null
    const mine = pts[i]
    const edgeX = nb.x < mine.x ? xCenter(i) - barW / 2 : xCenter(i) + barW / 2
    const dx = mine.x - nb.x
    if (dx === 0) return null
    const t = (edgeX - nb.x) / dx
    if (t <= 0 || t > 1) return null
    return (safeY - nb.y * (1 - t)) / t
  }
  // Leaves enough room above this floor for the arrowhead (~8px tall) to
  // still clear the SVG's own top edge (y=0) even in the rare case a point
  // gets clamped all the way down to it.
  const MIN_Y = 14
  for (let pass = 0; pass < weeks.length; pass++) {
    let changed = false
    for (let i = 0; i < weeks.length; i++) {
      if (pts[i].pinned) continue
      let y = pts[i].y
      if (i > 0) { const r = requiredY(i, pts[i - 1]); if (r != null) y = Math.min(y, r) }
      if (i < weeks.length - 1) { const r = requiredY(i, pts[i + 1]); if (r != null) y = Math.min(y, r) }
      y = Math.max(y, MIN_Y)
      if (y < pts[i].y - 0.01) { pts[i] = { ...pts[i], y }; changed = true }
    }
    if (!changed) break
  }

  let linePath = ''
  if (pts.length > 1) {
    linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 1; i < pts.length; i++) linePath += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
  }

  // Open-chevron arrowhead at the final point, continuing naturally from the
  // last segment's own direction — the same treatment TrendBarChart.tsx
  // uses, scaled down to this chart's smaller marker size.
  let arrowPoints: string | null = null
  if (pts.length > 1) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const dirX = dx / len, dirY = dy / len
    const RING_R = 2, ARROW_LEN = 6, ARROW_W = 5
    const tipX = b.x - dirX * RING_R, tipY = b.y - dirY * RING_R
    const backX = b.x - dirX * (RING_R + ARROW_LEN), backY = b.y - dirY * (RING_R + ARROW_LEN)
    const px = -dirY, py = dirX
    const leftX = backX + px * (ARROW_W / 2), leftY = backY + py * (ARROW_W / 2)
    const rightX = backX - px * (ARROW_W / 2), rightY = backY - py * (ARROW_W / 2)
    arrowPoints = `${leftX.toFixed(1)},${leftY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
      <defs>
        {/* Same signature purple bar gradient every detailed dashboard's
            Progress chart uses (TrendBarChart.tsx), reused exactly here
            rather than approximated, so every Analytics bar graph shares
            one consistent purple visual language. */}
        <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        {/* Trajectory gradient — flows chronologically left→right, same
            start/end colors as TrendBarChart.tsx's own trend line. */}
        <linearGradient id={`${uid}-trend`} gradientUnits="userSpaceOnUse" x1={PAD.left} y1="0" x2={W - PAD.right} y2="0">
          <stop offset="0%" stopColor="#9253E6" />
          <stop offset="100%" stopColor="#BB00FF" />
        </linearGradient>
      </defs>
      <line x1={PAD.left} x2={W - PAD.right} y1={baseY} y2={baseY} stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'} strokeWidth={1} />
      {weeks.map((w, i) => {
        const h = (w.ms / maxMs) * cH
        return (
          <rect key={i} x={xCenter(i) - barW / 2} y={baseY - h} width={barW} height={Math.max(h, 0)} rx={3}
            fill={`url(#${uid}-bar)`} />
        )
      })}
      {linePath && <path d={linePath} fill="none" stroke={`url(#${uid}-trend)`} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill={`url(#${uid}-trend)`} />)}
      {arrowPoints && <polyline points={arrowPoints} fill="none" stroke={`url(#${uid}-trend)`} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />}
      {weeks.map((w, i) => (
        <text key={`l-${i}`} x={xCenter(i)} y={H - 2} textAnchor="middle" fontSize={7.5} fontWeight={600} fill={isDark ? 'rgba(226,232,240,0.55)' : 'var(--xp-txt3)'}>{w.label}</text>
      ))}
    </svg>
  )
}

function ProgressTrendCard({ data, isDark }: { data: { weeks: { label: string; ms: number }[]; status: Dir; hasEnoughData: boolean; totalMs: number }; isDark: boolean }) {
  if (data.totalMs === 0) {
    return (
      <SectionCard icon="📈" title="Progress Trend" subtitle="Your productivity trend over recent weeks">
        <BaselineState text="Complete a few weeks of tracked time to see your broader trend here." />
      </SectionCard>
    )
  }
  const statusText = data.status === 'up' ? 'Improving' : data.status === 'down' ? 'Declining' : 'Stable'
  return (
    <SectionCard
      icon="📈" title="Progress Trend" subtitle="Your productivity trend over the last 12 weeks"
      right={
        data.hasEnoughData ? (
          <span className="flex items-center gap-1 text-[10.5px] font-bold flex-shrink-0" style={{ color: dirColor(data.status, isDark) }}>
            {dirArrow(data.status)} {statusText}
          </span>
        ) : undefined
      }
    >
      <MiniTrendChart weeks={data.weeks} isDark={isDark} />
      {!data.hasEnoughData && (
        <p className="text-[9.5px] mt-1" style={{ color: 'var(--xp-txt3)' }}>More weeks of data will sharpen this trend.</p>
      )}
    </SectionCard>
  )
}

// ─── XPadite Insights ───────────────────────────────────────────────────────
// Deterministic, calculated-from-data observations — NOT the AI Insight
// feature (that lives inside Next Target below, same existing handler).

function XPaditeInsightsCard({ insights }: { insights: string[] }) {
  return (
    <SectionCard icon="💡" title="XPadite Insights" subtitle="Patterns detected in your activity">
      {insights.length === 0 ? (
        <BaselineState text="Keep tracking and XPadite will start surfacing useful patterns here." />
      ) : (
        <div className="flex flex-col gap-2">
          {insights.map((text, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(124,58,237,0.06)' }}>
              <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>✨</span>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--xp-txt)' }}>{text}</p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─── Next Target ────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 64 }: { pct: number; size?: number }) {
  const sw = 6
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct / 100)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(34,197,94,0.18)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#22c55e" strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={14}>🏆</text>
    </svg>
  )
}

function NextTargetCard({ target, onOpenPremium, isDark }: { target: { label: string; progressPct: number } | null; onOpenPremium: () => void; isDark: boolean }) {
  return (
    <SectionCard icon="🎯" title="Next Target" subtitle="Your next milestone within reach">
      <div className="flex items-center gap-3 mb-3">
        {target ? (
          <>
            <ProgressRing pct={target.progressPct} />
            <p className="text-[12.5px] font-semibold leading-snug flex-1 min-w-0" style={{ color: 'var(--xp-txt)' }}>{target.label}</p>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--xp-txt3)' }}>
            Keep building your history — a personal target will appear here once there&apos;s enough data to aim at.
          </p>
        )}
      </div>
      {/* Gradient/rounding/shadow/border reused exactly from PremiumUpgradeModal.tsx's
          own "Upgrade to Pro" button — the "Unlock AI Insights" modal this
          button opens — so both read as the same CTA. Width narrows and
          centers on tablet/desktop; mobile keeps its original full-width
          size/placement and only picks up the new gradient. */}
      <button
        onClick={onOpenPremium}
        className="flex items-center justify-center gap-1.5 text-[11.5px] font-bold py-2 rounded-2xl transition-opacity hover:opacity-90 w-full sm:w-[60%] sm:mx-auto lg:w-[210px]"
        style={{
          background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 50%, #a855f7 100%)',
          color: '#ffffff',
          boxShadow: isDark ? '0 6px 24px rgba(124,58,237,0.50)' : '0 4px 14px rgba(124,58,237,0.32)',
          border: '0.5px solid rgba(167,139,250,0.30)',
        }}
      >
        <AICoachMenuIcon size={15} />
        AI Insight
      </button>
    </SectionCard>
  )
}

// ─── AnalyticsModal (main export) ──────────────────────────────────────────────

export function AnalyticsModal({ onClose, onDayDoubleClick }: { onClose: () => void; onDayDoubleClick?: (key: string, month: number, day: number) => void }) {
  const { isDark, calData, activities, progressColor: _rawProgressColor } = useApp()
  const progressColor = resolveProgressColor(_rawProgressColor, isDark)

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

  // ── Day-level aggregation — the single data source every section below
  // derives from (productive time, sessions, deep work, completed tasks,
  // per-activity totals), reusing the exact productive-session/deep-work
  // conventions already established across Day/Week/Month/YearFullPage. ──
  const daySummaries = useMemo(() => {
    const map = new Map<string, {
      key: string; date: Date; ms: number; sessions: number; deepMs: number
      completedTasks: number; totalTasks: number; productive: boolean
      // Individual day-level flags (DayData.productive/hyper/milestone/goal
      // are mutually exclusive — a day is tagged as at most one of these),
      // kept separately alongside the combined `productive` above so the
      // Performance Index can count each one on its own rather than only
      // "was this day flagged at all".
      prodFlag: boolean; hyperFlag: boolean; milestoneFlag: boolean; goalFlag: boolean
      actMs: Map<string, number>
    }>()
    for (const key of Object.keys(calData)) {
      const day = calData[key]
      let ms = 0, sessions = 0, deepMs = 0, completedTasks = 0
      const actMs = new Map<string, number>()
      for (const t of day.tasks) {
        if (t.done) completedTasks++
        for (const s of t.sessions) {
          if (s.endTs !== null && isProductiveActivity(activities, t.actId)) {
            const dur = getSessionDurationMs(s.startTs, s.endTs)
            ms += dur; sessions++
            if (dur >= 45 * 60_000) deepMs += dur
            if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + dur)
          }
        }
      }
      map.set(key, {
        key, date: parseDateKey(key), ms, sessions, deepMs, completedTasks,
        totalTasks: day.tasks.length,
        productive: !!(day.productive || day.hyper || day.milestone || day.goal),
        prodFlag: !!day.productive, hyperFlag: !!day.hyper, milestoneFlag: !!day.milestone, goalFlag: !!day.goal,
        actMs,
      })
    }
    return map
  }, [calData, activities])

  // ── Performance Index ───────────────────────────────────────────────────────
  const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>('7d')

  const performanceIndex = useMemo((): PerformanceIndexData => {
    if (daySummaries.size < 7) return { ready: false }
    const sortedKeys = Array.from(daySummaries.keys()).sort()
    const earliestDate = sortedKeys.length ? parseDateKey(sortedKeys[0]) : null
    const { curStart, curEnd, prevStart, prevEnd } = perfPeriodRanges(perfPeriod, today)

    const curAgg = perfAggregate(daySummaries, curStart, curEnd, earliestDate)
    const score = perfScore(curAgg)
    if (score === null) return { ready: false }

    const prevAgg = perfAggregate(daySummaries, prevStart, prevEnd, earliestDate)
    const prevScore = perfScore(prevAgg)
    const delta = prevScore !== null ? pctChange(score, prevScore) : null

    return {
      ready: true, score, tier: perfTierFor(score), delta,
      metrics: {
        productiveDays: curAgg.prodDays, hyperDays: curAgg.hyperDays, milestoneDays: curAgg.milestoneDays, goalDays: curAgg.goalDays,
        longestMs: curAgg.longestMs, completedTasks: curAgg.completed, totalTasks: curAgg.total,
      },
    }
  }, [daySummaries, today, perfPeriod])

  // Elite Mode celebration — only on a genuine NEW entrance into Elite Mode
  // for the currently-selected period, not every time this modal happens to
  // reopen while already Elite (or when switching between periods that
  // happen to both read Elite). Persisted per period in localStorage so the
  // gate survives remounts; it resets automatically once that period's score
  // drops back below Elite, so a later re-entrance can celebrate again.
  const [pendingEliteCelebration, setPendingEliteCelebration] = useState(false)
  useEffect(() => {
    if (!performanceIndex.ready || !performanceIndex.tier) return
    const isElite = performanceIndex.tier.label === 'Elite Mode'
    const storageKey = `xp9-elite-state-${perfPeriod}`
    let newEntrance = false
    try {
      const prevState = localStorage.getItem(storageKey)
      if (isElite) {
        if (prevState !== 'elite') { localStorage.setItem(storageKey, 'elite'); newEntrance = true }
      } else if (prevState === 'elite') {
        localStorage.setItem(storageKey, 'non-elite')
      }
    } catch { /* localStorage unavailable — celebration just won't persist across sessions */ }
    if (!newEntrance) return
    // Deferred a frame so this never fires setState synchronously within the
    // effect body itself.
    const raf = requestAnimationFrame(() => setPendingEliteCelebration(true))
    return () => cancelAnimationFrame(raf)
  }, [performanceIndex.ready, performanceIndex.tier, perfPeriod])

  // ── Personal Records ───────────────────────────────────────────────────────
  const personalRecords = useMemo((): RecordsData | null => {
    if (daySummaries.size === 0) return null

    let bestDay: { ms: number; date: Date } | null = null
    for (const s of daySummaries.values()) if (s.ms > 0 && (!bestDay || s.ms > bestDay.ms)) bestDay = { ms: s.ms, date: s.date }

    const weekTotals = new Map<string, { ms: number; monday: Date }>()
    for (const s of daySummaries.values()) {
      const monday = mondayOf(s.date)
      const wk = buildDateKey(monday.getFullYear(), monday.getMonth(), monday.getDate())
      const entry = weekTotals.get(wk) ?? { ms: 0, monday }
      entry.ms += s.ms
      weekTotals.set(wk, entry)
    }
    let bestWeek: { ms: number; monday: Date } | null = null
    for (const w of weekTotals.values()) if (w.ms > 0 && (!bestWeek || w.ms > bestWeek.ms)) bestWeek = w

    const sortedKeys = Array.from(daySummaries.keys()).sort()
    const earliest = sortedKeys[0] ? parseDateKey(sortedKeys[0]) : today
    const longestStreak = calculateBestStreak(calData, keysInRange(earliest, today))

    const actTotals = new Map<string, number>()
    for (const s of daySummaries.values()) for (const [actId, ms] of s.actMs) actTotals.set(actId, (actTotals.get(actId) ?? 0) + ms)
    let bestActId: string | null = null, bestActMs = 0, totalActMs = 0
    for (const [actId, ms] of actTotals) { totalActMs += ms; if (ms > bestActMs) { bestActMs = ms; bestActId = actId } }
    const bestAct = bestActId ? activities.find(a => a.id === bestActId) ?? null : null

    return {
      bestDay, bestWeek, longestStreak,
      bestActName: bestAct?.name ?? null,
      bestActPct: totalActMs > 0 ? Math.round((bestActMs / totalActMs) * 100) : 0,
    }
  }, [daySummaries, calData, activities, today])

  // ── Progress Trend — last 12 COMPLETED weeks ───────────────────────────────
  const progressTrend = useMemo(() => {
    const todayMid = new Date(today); todayMid.setHours(0, 0, 0, 0)
    const lastCompletedSunday = addDays(mondayOf(todayMid), -1)
    const weeks: { label: string; ms: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const sunday = addDays(lastCompletedSunday, -7 * i)
      const monday = addDays(sunday, -6)
      let ms = 0
      for (let d = new Date(monday); d <= sunday; d = addDays(d, 1)) {
        ms += daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))?.ms ?? 0
      }
      weeks.push({ label: `W${12 - i}`, ms })
    }
    const nonZeroWeeks = weeks.filter(w => w.ms > 0).length
    const recentAvg = weeks.slice(8, 12).reduce((s, w) => s + w.ms, 0) / 4
    const earlierAvg = weeks.slice(0, 4).reduce((s, w) => s + w.ms, 0) / 4
    let status: Dir = 'flat'
    if (earlierAvg > 0) {
      const diffPct = ((recentAvg - earlierAvg) / earlierAvg) * 100
      status = Math.abs(diffPct) < 10 ? 'flat' : diffPct > 0 ? 'up' : 'down'
    } else if (recentAvg > 0) status = 'up'
    return { weeks, status, hasEnoughData: nonZeroWeeks >= 4, totalMs: weeks.reduce((s, w) => s + w.ms, 0) }
  }, [daySummaries, today])

  // ── XPadite Insights — top 3 deterministic observations ────────────────────
  const xpaditeInsights = useMemo(() => {
    const todayMid = new Date(today); todayMid.setHours(0, 0, 0, 0)
    const candidates: { text: string; priority: number }[] = []

    const recentSessions: { startTs: number; endTs: number }[] = []
    for (let d = addDays(todayMid, -13); d <= todayMid; d = addDays(d, 1)) {
      const day = calData[buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())]
      day?.tasks.forEach(t => t.sessions.forEach(s => {
        if (s.endTs !== null && isProductiveActivity(activities, t.actId)) recentSessions.push({ startTs: s.startTs, endTs: s.endTs })
      }))
    }
    const window = computePeakWindow(recentSessions)
    if (window) candidates.push({ text: `Your strongest focus window is ${window}.`, priority: 1 })

    if (daySummaries.size >= 10) {
      const dowMs = new Array(7).fill(0) as number[]
      for (let d = addDays(todayMid, -55); d <= todayMid; d = addDays(d, 1)) {
        const s = daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))
        if (s) dowMs[d.getDay()] += s.ms
      }
      let topDow = 0
      for (let i = 1; i < 7; i++) if (dowMs[i] > dowMs[topDow]) topDow = i
      if (dowMs[topDow] > 0) {
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        candidates.push({ text: `${names[topDow]} has been your strongest day recently.`, priority: 2 })
      }
    }

    const weekStart = mondayOf(todayMid)
    const weekAct = new Map<string, number>()
    for (let d = new Date(weekStart); d <= todayMid; d = addDays(d, 1)) {
      const s = daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))
      if (s) for (const [actId, ms] of s.actMs) weekAct.set(actId, (weekAct.get(actId) ?? 0) + ms)
    }
    let topActId: string | null = null, topActMs = 0
    for (const [actId, ms] of weekAct) if (ms > topActMs) { topActMs = ms; topActId = actId }
    if (topActId) {
      const act = activities.find(a => a.id === topActId)
      if (act) candidates.push({ text: `${act.name} led your productive time this week.`, priority: 3 })
    }

    if (daySummaries.size >= 7) {
      function sumSessions(start: Date, end: Date) {
        let ms = 0, count = 0
        for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
          const s = daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))
          if (s) { ms += s.ms; count += s.sessions }
        }
        return { ms, count }
      }
      const last7 = sumSessions(addDays(todayMid, -7), addDays(todayMid, -1))
      const prev7 = sumSessions(addDays(todayMid, -14), addDays(todayMid, -8))
      if (last7.count >= 3 && prev7.count >= 3) {
        const change = pctChange(last7.ms / last7.count, prev7.ms / prev7.count, 8)
        if (change.dir !== 'flat' && change.pct !== null) {
          candidates.push({ text: `Your average session was ${Math.abs(change.pct)}% ${change.dir === 'up' ? 'longer' : 'shorter'} than last week.`, priority: 4 })
        }
      }
    }

    return candidates.sort((a, b) => a.priority - b.priority).slice(0, 3).map(c => c.text)
  }, [calData, activities, daySummaries, today])

  // ── Next Target — closest meaningful personal record ───────────────────────
  const nextTarget = useMemo(() => {
    const todayMid = new Date(today); todayMid.setHours(0, 0, 0, 0)
    const todayKey = buildDateKey(todayMid.getFullYear(), todayMid.getMonth(), todayMid.getDate())
    const todaySummary = daySummaries.get(todayKey)
    const todayMs = todaySummary?.ms ?? 0
    const todayCompleted = todaySummary?.completedTasks ?? 0

    const candidates: { label: string; remainingFrac: number }[] = []
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    const weekday = todayMid.getDay()
    let bestWeekdayMs = 0
    for (const s of daySummaries.values()) {
      if (s.key === todayKey) continue
      if (s.date.getDay() === weekday && s.ms > bestWeekdayMs) bestWeekdayMs = s.ms
    }
    if (bestWeekdayMs > 0) {
      const remaining = bestWeekdayMs - todayMs
      if (remaining > 0) candidates.push({ label: `${formatMs(remaining)} to beat your best ${names[weekday]}`, remainingFrac: remaining / bestWeekdayMs })
    }

    if (personalRecords?.bestWeek && personalRecords.bestWeek.ms > 0) {
      const curWeekStart = mondayOf(todayMid)
      let curWeekMs = 0
      for (let d = new Date(curWeekStart); d <= todayMid; d = addDays(d, 1)) {
        curWeekMs += daySummaries.get(buildDateKey(d.getFullYear(), d.getMonth(), d.getDate()))?.ms ?? 0
      }
      const remaining = personalRecords.bestWeek.ms - curWeekMs
      if (remaining > 0) candidates.push({ label: `${formatMs(remaining)} to beat your best week`, remainingFrac: remaining / personalRecords.bestWeek.ms })
    }

    let bestDailyTasks = 0
    for (const s of daySummaries.values()) { if (s.key === todayKey) continue; if (s.completedTasks > bestDailyTasks) bestDailyTasks = s.completedTasks }
    if (bestDailyTasks > 0) {
      const remaining = bestDailyTasks - todayCompleted
      if (remaining > 0) candidates.push({ label: `${remaining} task${remaining === 1 ? '' : 's'} to beat your daily task record`, remainingFrac: remaining / bestDailyTasks })
    }

    if (personalRecords && personalRecords.longestStreak > 0) {
      const sortedKeys = Array.from(daySummaries.keys()).sort()
      let current = 0
      for (let i = sortedKeys.length - 1; i >= 0; i--) {
        if (daySummaries.get(sortedKeys[i])!.productive) current++
        else break
      }
      if (current > 0 && current < personalRecords.longestStreak) {
        const remaining = personalRecords.longestStreak - current
        candidates.push({ label: `${remaining} more productive day${remaining === 1 ? '' : 's'} to extend your longest streak`, remainingFrac: remaining / personalRecords.longestStreak })
      } else if (current > 0 && current >= personalRecords.longestStreak) {
        candidates.push({ label: '1 more productive day to set a new streak record', remainingFrac: 1 / (current + 1) })
      }
    }

    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.remainingFrac - b.remainingFrac)
    const best = candidates[0]
    return { label: best.label, progressPct: Math.max(0, Math.min(100, Math.round((1 - best.remainingFrac) * 100))) }
  }, [daySummaries, personalRecords, today])

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

            {/* Shared Analytics icon legend — the same LegendRow already used
                on the main Calendar page, shown once here (not duplicated
                inside any individual dashboard). */}
            <LegendRow />

            {/* Executive summary — real data, derived from daySummaries above */}
            <div>
              <h3 className="text-[12px] font-bold tracking-wide uppercase mb-3" style={{ color: 'var(--xp-txt3)' }}>Your Performance at a Glance</h3>

              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <PerformanceIndexCard
                    data={performanceIndex} period={perfPeriod} onPeriodChange={setPerfPeriod}
                    pendingCelebration={pendingEliteCelebration} onCelebrated={() => setPendingEliteCelebration(false)}
                    isDark={isDark} progressColor={progressColor}
                  />
                  <PersonalRecordsCard data={personalRecords} isDark={isDark} />
                </div>

                <ProgressTrendCard data={progressTrend} isDark={isDark} />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <XPaditeInsightsCard insights={xpaditeInsights} />
                  <NextTargetCard target={nextTarget} onOpenPremium={() => setShowPremium(true)} isDark={isDark} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Dashboard — built directly on Monthly Dashboard's design
          system (DayFullPage.tsx), opened into the IDENTICAL backdrop+card
          shell used by Weekly/Monthly/Yearly above, so switching between any
          of them never changes the outer modal's width/height. This is
          intentionally a different component from DayDashboardModal.tsx
          (which keeps its own established design for Task Manager's own
          "Today's Dashboard" entry point, untouched by this). */}
      {openDashboard === 'today' && (
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
            <DayFullPage onClose={() => setOpenDashboard(null)} />
          </div>
        </div>
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
