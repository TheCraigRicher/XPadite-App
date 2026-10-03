'use client'

// ── Analytics modal — front-end only ──────────────────────────────────────────
// Matches the finalized "Main Analytics Dashboard Modal" reference. This is
// intentionally presentational for now: the 4 timeframe cards only toggle a
// local selected state (no navigation into the deeper Today/Weekly/Monthly/
// Yearly dashboards yet — see AnalyticsPage.tsx for those, to be wired up in
// a follow-up task), and the overview stats / donut / hourly chart below use
// static placeholder values rather than real session data.
//
// Reuses established XPadite patterns: useLockBodyScroll (same freeze used by
// every other modal here), the signature purple/lavender gradient header, the
// same solid-triangle date-nav glyphs used in DayModal/SendToOptionsModal, and
// PremiumUpgradeModal for the "AI Insight" entry point.

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { PremiumUpgradeModal } from './PremiumUpgradeModal'
import { MONTHS } from './utils'

type Timeframe = 'today' | 'weekly' | 'monthly' | 'yearly'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Same solid-triangle glyphs used for day-nav arrows elsewhere (DayModal's
// header, SendToOptionsModal's month nav) — duplicated locally per the
// existing convention rather than extracting a shared one-off primitive.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)

// ─── Timeframe cards ───────────────────────────────────────────────────────────

const TIMEFRAMES: {
  id: Timeframe; icon: string; title: string; desc: string
  bgL: string; bgD: string; badge: string
}[] = [
  { id: 'today',   icon: '☀️', title: 'Today',   desc: "View today's productivity", bgL: '#f1edfe', bgD: 'rgba(124,58,237,0.14)', badge: '#7c3aed' },
  { id: 'weekly',  icon: '📅', title: 'Weekly',  desc: "See this week's progress",  bgL: '#eafaf2', bgD: 'rgba(16,185,129,0.14)', badge: '#10b981' },
  { id: 'monthly', icon: '🗓️', title: 'Monthly', desc: 'Track monthly trends',      bgL: '#fdedf0', bgD: 'rgba(244,63,94,0.14)',  badge: '#f43f5e' },
  { id: 'yearly',  icon: '📊', title: 'Yearly',  desc: 'View long-term growth',     bgL: '#f2effc', bgD: 'rgba(99,102,241,0.16)', badge: '#6366f1' },
]

function TimeframeCard({ def, selected, isDark, onSelect }: {
  def: (typeof TIMEFRAMES)[number]; selected: boolean; isDark: boolean; onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="text-left rounded-2xl p-4 transition-all duration-150"
      style={{
        background: isDark ? def.bgD : def.bgL,
        border: selected ? `2px solid ${def.badge}` : '2px solid transparent',
        boxShadow: selected ? `0 0 0 3px ${def.badge}22` : 'none',
      }}
    >
      <div
        className="flex items-center justify-center rounded-xl mb-3"
        style={{ width: 40, height: 40, background: def.badge, fontSize: 18 }}
      >
        {def.icon}
      </div>
      <p className="text-[13px] font-bold" style={{ color: 'var(--xp-txt)' }}>{def.title}</p>
      <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--xp-txt3)' }}>{def.desc}</p>
    </button>
  )
}

// ─── Overview stat cards ───────────────────────────────────────────────────────

const OVERVIEW_STATS = [
  { icon: '⏱', label: 'Productive Time',      value: '6h 24m', color: '#7c3aed', tint: 'rgba(124,58,237,0.10)' },
  { icon: '🔥', label: 'Current Streak days',  value: '12',     color: '#f97316', tint: 'rgba(249,115,22,0.10)' },
  { icon: '🏆', label: 'Milestones Achieved',  value: '3',      color: '#eab308', tint: 'rgba(234,179,8,0.12)' },
  { icon: '🎯', label: 'Goals Accomplished',   value: '8',      color: '#14b8a6', tint: 'rgba(20,184,166,0.10)' },
]

// ─── Donut chart (Productive vs Non-Productive) ───────────────────────────────

const DONUT_SEGMENTS = [
  { label: 'Deep Work',    pct: 62, color: '#7c3aed' },
  { label: 'Creative',     pct: 18, color: '#a78bfa' },
  { label: 'Study',        pct: 10, color: '#60a5fa' },
  { label: 'Meetings',     pct: 6,  color: '#fb923c' },
  { label: 'Break / Meal', pct: 4,  color: '#9ca3af' },
]

function Donut({ size = 128, strokeWidth = 20 }: { size?: number; strokeWidth?: number }) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  // Precompute each segment's arc length + cumulative start offset as a pure
  // derivation (no mutation during the render-producing .map below).
  const arcs = DONUT_SEGMENTS.reduce<{ seg: (typeof DONUT_SEGMENTS)[number]; len: number; offset: number }[]>((acc, seg) => {
    const len = (seg.pct / 100) * c
    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].len : 0
    return [...acc, { seg, len, offset }]
  }, [])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {arcs.map(({ seg, len, offset }) => (
          <circle
            key={seg.label}
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={seg.color} strokeWidth={strokeWidth}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        ))}
      </g>
    </svg>
  )
}

// ─── Hourly breakdown bar chart (placeholder data) ────────────────────────────

const HOURLY_PLACEHOLDER = [12, 18, 10, 22, 35, 48, 62, 75, 88, 80, 65, 50, 58, 42, 30, 18]
const HOUR_LABELS = ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM']

function HourlyBarChart({ isDark }: { isDark: boolean }) {
  const max = 90
  const W = 600, H = 170, padL = 26, padB = 20, padT = 8, padR = 6
  const plotW = W - padL - padR, plotH = H - padT - padB
  const slotW = plotW / HOURLY_PLACEHOLDER.length
  const barW = Math.max(6, slotW * 0.55)
  const gridLine = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: H, display: 'block' }}>
      {[0, 30, 60, 90].map(v => {
        const y = padT + plotH - (v / max) * plotH
        return (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={gridLine} strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--xp-txt3)">{v}</text>
          </g>
        )
      })}
      {HOURLY_PLACEHOLDER.map((v, i) => {
        const x = padL + slotW * i + (slotW - barW) / 2
        const h = (v / max) * plotH
        const y = padT + plotH - h
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={3} fill="#7c3aed" opacity={0.85} />
      })}
      {HOUR_LABELS.map((lbl, idx) => {
        const pos = idx / (HOUR_LABELS.length - 1)
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
        <p className="text-[14px] font-bold" style={{ color: 'var(--xp-txt)' }}>{value}</p>
        <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>{sub}</p>
      </div>
      <span style={{ color: 'var(--xp-txt3)', fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  )
}

// ─── AnalyticsModal (main export) ──────────────────────────────────────────────

export function AnalyticsModal({ onClose }: { onClose: () => void }) {
  const { isDark } = useApp()
  useLockBodyScroll()

  const [selected, setSelected] = useState<Timeframe>('today')
  const [overviewDate, setOverviewDate] = useState(() => new Date())
  const [showPremium, setShowPremium] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showPremium) { setShowPremium(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showPremium])

  function shiftDay(delta: number) {
    setOverviewDate(d => { const n = new Date(d); n.setDate(n.getDate() + delta); return n })
  }
  const today = new Date()
  const isOverviewToday = overviewDate.toDateString() === today.toDateString()
  const overviewDateLabel = `${DAY_NAMES[overviewDate.getDay()]}, ${MONTHS[overviewDate.getMonth()].slice(0, 3)} ${overviewDate.getDate()}, ${overviewDate.getFullYear()}`

  return (
    <>
      <div
        className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-5"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-[880px] rounded-[22px] overflow-hidden flex flex-col"
          style={{ background: 'var(--xp-bg)', maxHeight: '92vh', boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* XPadite signature purple header */}
          <div
            className="flex-shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 sm:py-5"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex items-center justify-center rounded-2xl flex-shrink-0"
                style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.18)', fontSize: 19 }}
              >
                📊
              </div>
              <div className="min-w-0">
                <h2 className="text-[17px] sm:text-[20px] font-extrabold leading-tight" style={{ color: '#ffffff' }}>Analytics</h2>
                <p className="text-[10.5px] sm:text-[12px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  Track your progress, performance &amp; productivity
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowPremium(true)}
                className="hidden sm:flex items-center gap-1.5 text-[11.5px] font-bold px-3.5 py-2 rounded-full transition-opacity hover:opacity-85"
                style={{ background: '#ffffff', color: '#7c3aed', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
              >
                ✨ AI Insight 👑
              </button>
              <button
                onClick={() => setShowPremium(true)}
                className="sm:hidden flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
                style={{ width: 30, height: 30, background: '#ffffff', color: '#7c3aed', fontSize: 13 }}
                aria-label="AI Insight"
              >
                ✨
              </button>
              <button
                onClick={onClose}
                aria-label="Close Analytics"
                className="flex items-center justify-center rounded-full flex-shrink-0 transition-opacity hover:opacity-75"
                style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.18)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-5">

            {/* Timeframe cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TIMEFRAMES.map(def => (
                <TimeframeCard key={def.id} def={def} selected={selected === def.id} isDark={isDark} onSelect={() => setSelected(def.id)} />
              ))}
            </div>

            {/* Today's Overview heading + date nav */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--xp-txt)' }}>Today&apos;s Overview</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => shiftDay(-1)}
                  aria-label="Previous day"
                  className="flex items-center justify-center rounded-full transition-colors hover:bg-black/5"
                  style={{ width: 24, height: 24, color: 'var(--xp-txt3)', background: 'var(--xp-bg3)', border: 'none', cursor: 'pointer' }}
                >
                  <PrevTriangle />
                </button>
                <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{overviewDateLabel}</span>
                <button
                  onClick={() => shiftDay(1)}
                  aria-label="Next day"
                  className="flex items-center justify-center rounded-full transition-colors hover:bg-black/5"
                  style={{ width: 24, height: 24, color: 'var(--xp-txt3)', background: 'var(--xp-bg3)', border: 'none', cursor: 'pointer' }}
                >
                  <NextTriangle />
                </button>
                <button
                  onClick={() => setOverviewDate(new Date())}
                  disabled={isOverviewToday}
                  className="text-[11px] font-semibold px-3 py-1 rounded-full transition-opacity"
                  style={{
                    background: isOverviewToday ? 'rgba(124,58,237,0.12)' : '#7c3aed',
                    color: isOverviewToday ? '#7c3aed' : '#ffffff',
                    border: 'none', cursor: isOverviewToday ? 'default' : 'pointer', opacity: isOverviewToday ? 0.7 : 1,
                  }}
                >
                  Today
                </button>
              </div>
            </div>

            {/* Overview stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {OVERVIEW_STATS.map(s => (
                <div key={s.label} className="rounded-2xl p-3.5 flex items-center gap-3" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
                  <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: s.tint, fontSize: 16 }}>
                    {s.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-extrabold leading-none" style={{ color: 'var(--xp-txt)' }}>{s.value}</p>
                    <p className="text-[9.5px] mt-1 leading-snug" style={{ color: 'var(--xp-txt3)' }}>{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Analytics visuals — donut + hourly breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Panel title="Productive vs Non-Productive">
                <div className="flex items-center gap-4">
                  <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
                    <Donut />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[16px] font-extrabold" style={{ color: 'var(--xp-txt)' }}>6h 24m</span>
                      <span className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>Total Time</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    {DONUT_SEGMENTS.map(seg => (
                      <div key={seg.label} className="flex items-center gap-2">
                        <span className="rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: seg.color }} />
                        <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--xp-txt2)' }}>{seg.label}</span>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{seg.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel title="Hourly Breakdown">
                <HourlyBarChart isDark={isDark} />
              </Panel>
            </div>

            {/* Bottom summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-1">
              <SummaryCard icon="🚀" iconBg="rgba(16,185,129,0.14)" title="Most Productive Activity" value="Deep Work" sub="28% of total time" />
              <SummaryCard icon="✅" iconBg="rgba(59,130,246,0.14)" title="Tasks Completed" value="1,284" sub="Tasks Completed" />
            </div>
          </div>
        </div>
      </div>

      {showPremium && <PremiumUpgradeModal onClose={() => setShowPremium(false)} />}
    </>
  )
}
