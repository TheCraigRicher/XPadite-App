'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from './AppContext'
import { exportLocalData } from '@/lib/data-backup'
import { resolveProgressColor } from './utils'

const PROGRESS_COLORS: { name: string; value: string; darkCheck?: boolean }[] = [
  { name: 'Green',            value: '#16a34a' },
  { name: 'Blue',             value: '#2563eb' },
  { name: 'Purple (Default)', value: '#7c3aed' },
  { name: 'Orange',           value: '#ea580c' },
  { name: 'Pink',             value: '#db2777' },
  { name: 'Gold',             value: '#d97706' },
  { name: 'Red',              value: '#dc2626' },
  { name: 'Dark Teal',        value: '#0d9488' },
  { name: 'Teal',             value: '#00A2B0' },
  { name: 'Neon Pink',        value: '#FF00FB' },
  { name: 'Lime',             value: '#A6FF00', darkCheck: true },
  { name: 'Cyan',             value: '#00FFF2', darkCheck: true },
  { name: 'Black & White',    value: 'bw'      },
]

const DEFAULT_COLOR = '#7c3aed'

const LANGUAGES = [
  'English (US)', 'English (UK)', 'French', 'Spanish',
  'German', 'Portuguese', 'Hindi',
]

const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Australia/Sydney',    label: 'Australia — Sydney'               },
  { value: 'America/Toronto',     label: 'Canada — Toronto'                 },
  { value: 'America/Vancouver',   label: 'Canada — Vancouver'               },
  { value: 'Europe/Paris',        label: 'France — Paris'                   },
  { value: 'Europe/Berlin',       label: 'Germany — Berlin'                 },
  { value: 'Asia/Kolkata',        label: 'India — Kolkata'                  },
  { value: 'Asia/Tokyo',          label: 'Japan — Tokyo'                    },
  { value: 'Pacific/Auckland',    label: 'New Zealand — Auckland'           },
  { value: 'Asia/Singapore',      label: 'Singapore'                        },
  { value: 'Europe/London',       label: 'United Kingdom — London'          },
  { value: 'America/Chicago',     label: 'USA — Chicago (Central)'          },
  { value: 'America/Denver',      label: 'USA — Denver (Mountain)'          },
  { value: 'America/Los_Angeles', label: 'USA — Los Angeles (Pacific)'      },
  { value: 'America/New_York',    label: 'USA — New York (Eastern)'         },
  { value: 'UTC',                 label: 'UTC (Coordinated Universal Time)' },
]

// ── Plan popup data ────────────────────────────────────────────────────────

const PRO_CORE_FEATURES = [
  'Productivity Calendar & history',
  'Productive / Hyper-Productive / Milestone tracking',
  'Streak tracking',
  'Performance Analytics — Today, Weekly, Monthly, Yearly',
  'Full Task Manager',
  'Task timers & session history',
  'Activities',
  'Planner / Journal Notes',
  'Notifications & Reminders',
  'Gallery / Photos',
  'Calendar & meeting integrations',
  'Sharing features',
]

const AI_FEATURES = [
  'XPadite AI Coach',
  'AI-powered productivity insights',
  'AI plan & journal-to-task conversion',
  'AI-powered Motivate Me',
]

type PlanConfig = {
  title: string
  subtitle: string
  badge: string
  badgeIcon: string
  price: string
  priceLabel: string
  savings?: string
  headerGradient: string
  accentColor: string
  accentGlow: string
  interiorLight: string
  interiorDark: string
  ctaLabel: string
  ctaBg: string
  ctaGlow: string
  includedFeatures: string[]
  excludedFeatures: string[]
  note?: string
}

export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  'pro-monthly': {
    title: 'Pro Plan',
    subtitle: 'Everything you need to plan, execute and track your progress.',
    badge: 'Current Plan',
    badgeIcon: '✓',
    price: '$7',
    priceLabel: '/ month',
    headerGradient: 'linear-gradient(135deg, #6b7280 0%, #9ca3af 55%, #d1d5db 100%)',
    accentColor: '#6b7280',
    accentGlow: 'rgba(107,114,128,0.20)',
    interiorLight: '#f9fafb',
    interiorDark: '#111318',
    ctaLabel: 'Get Pro Monthly',
    ctaBg: 'linear-gradient(135deg, #6b7280 0%, #9ca3af 55%, #d1d5db 100%)',
    ctaGlow: 'rgba(107,114,128,0.40)',
    includedFeatures: PRO_CORE_FEATURES,
    excludedFeatures: AI_FEATURES,
  },
  'pro-yearly': {
    title: 'Pro Plan',
    subtitle: 'Everything you need to plan, execute and track your progress.',
    badge: 'Save 29%',
    badgeIcon: '⭐',
    price: '$59.99',
    priceLabel: '/ year',
    savings: 'Save $24 vs monthly',
    headerGradient: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 45%, #7c3aed 100%)',
    accentColor: '#7c3aed',
    accentGlow: 'rgba(124,58,237,0.22)',
    interiorLight: '#fdf9ff',
    interiorDark: '#100a22',
    ctaLabel: 'Get Pro Yearly',
    ctaBg: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
    ctaGlow: 'rgba(124,58,237,0.44)',
    includedFeatures: PRO_CORE_FEATURES,
    excludedFeatures: AI_FEATURES,
  },
  'premium-monthly': {
    title: 'Premium Plan',
    subtitle: 'Everything in Pro, powered up with XPadite AI.',
    badge: 'Best Value',
    badgeIcon: '✦',
    price: '$10',
    priceLabel: '/ month',
    headerGradient: 'linear-gradient(135deg, #14532d 0%, #15803d 45%, #22c55e 100%)',
    accentColor: '#16a34a',
    accentGlow: 'rgba(22,163,74,0.22)',
    interiorLight: '#f0fdf4',
    interiorDark: '#071a10',
    ctaLabel: 'Get Premium Monthly',
    ctaBg: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
    ctaGlow: 'rgba(22,163,74,0.40)',
    includedFeatures: [...PRO_CORE_FEATURES, ...AI_FEATURES],
    excludedFeatures: [],
  },
  'premium-yearly': {
    title: 'Premium Plan',
    subtitle: 'Everything in Pro, powered up with XPadite AI.',
    badge: 'Save 25%',
    badgeIcon: '✦',
    price: '$89.99',
    priceLabel: '/ year',
    savings: 'Save $30 vs monthly',
    headerGradient: 'linear-gradient(135deg, #b45309 0%, #d97706 45%, #f59e0b 75%, #fbbf24 100%)',
    accentColor: '#b45309',
    accentGlow: 'rgba(180,83,9,0.18)',
    interiorLight: '#fffbeb',
    interiorDark: '#1c0f00',
    ctaLabel: 'Get Premium Yearly',
    ctaBg: 'linear-gradient(135deg, #b45309 0%, #d97706 55%, #fbbf24 100%)',
    ctaGlow: 'rgba(217,119,6,0.48)',
    includedFeatures: [...PRO_CORE_FEATURES, ...AI_FEATURES],
    excludedFeatures: [],
  },
  'ltd': {
    title: 'Lifetime Deal',
    subtitle: "Get XPadite's core productivity system for life with one payment.",
    badge: 'Limited Time',
    badgeIcon: '💎',
    price: '$99',
    priceLabel: 'one-time payment',
    headerGradient: 'linear-gradient(135deg, #0c4a6e 0%, #0891b2 45%, #22d3ee 100%)',
    accentColor: '#0891b2',
    accentGlow: 'rgba(6,182,212,0.22)',
    interiorLight: '#ecfeff',
    interiorDark: '#031a22',
    ctaLabel: 'Get Lifetime Deal',
    ctaBg: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)',
    ctaGlow: 'rgba(6,182,212,0.38)',
    includedFeatures: PRO_CORE_FEATURES,
    excludedFeatures: AI_FEATURES,
    note: 'AI features are not included. XPadite AI Coach and other Premium AI functionality require a separate Premium subscription.',
  },
}

function getBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return TIMEZONES.some(t => t.value === tz) ? tz : 'America/Vancouver'
  } catch {
    return 'America/Vancouver'
  }
}

function SectionIcon({ emoji }: { emoji: string }) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: 'rgba(124,58,237,0.13)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{
        width: 16, height: 16, flexShrink: 0,
        transition: 'transform 240ms cubic-bezier(0.4,0,0.2,1)',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
      }}
    >
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DropItem({ label, selected, isDark, hasDivider, onSelect }: {
  label: string; selected: boolean; isDark: boolean; hasDivider: boolean; onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
      style={{
        width: '100%', padding: '9px 14px', textAlign: 'left',
        background: hovered
          ? '#7c3aed'
          : selected ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.08)') : 'transparent',
        border: 'none',
        borderBottom: hasDivider
          ? `0.5px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
          : 'none',
        cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
        color: hovered ? 'white' : selected ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.80)' : '#374151'),
        transition: 'background 120ms, color 120ms',
      }}
    >{label}</button>
  )
}

function SelectMenu({
  value, onChange, options, isDark,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[] | string[]
  isDark: boolean
}) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [trigHovered, setTrigHovered] = useState(false)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // Close on outside click — must check both trigger and the portaled dropdown
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (
        btnRef.current  && !btnRef.current.contains(t) &&
        dropRef.current && !dropRef.current.contains(t)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const maxH = 210
      const spaceBelow = window.innerHeight - r.bottom
      // Flip upward if not enough room below
      const top = spaceBelow >= maxH + 8 ? r.bottom + 4 : r.top - maxH - 4
      setDropPos({ top, left: r.left, width: r.width })
    }
    setOpen(v => !v)
  }

  const items = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  const selectedLabel = items.find(o => o.value === value)?.label ?? value

  const isActive = open || trigHovered
  const triggerStyle: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 14px', borderRadius: 12,
    border: isActive ? '1.5px solid #7c3aed' : `1px solid ${isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.10)'}`,
    background: isDark ? 'rgba(255,255,255,0.07)' : '#ffffff',
    color: isDark ? 'rgba(255,255,255,0.85)' : '#374151',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', outline: 'none', textAlign: 'left',
    boxShadow: isActive ? '0 0 0 3px rgba(124,58,237,0.12)' : 'none',
    transition: 'border 150ms, box-shadow 150ms',
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        style={triggerStyle}
        onClick={handleToggle}
        onMouseEnter={() => setTrigHovered(true)}
        onMouseLeave={() => setTrigHovered(false)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabel}</span>
        <span style={{ color: isDark ? 'rgba(255,255,255,0.40)' : '#9ca3af', display: 'flex', flexShrink: 0, marginLeft: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ width: 14, height: 14, transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : 'none' }}>
            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed',
            top: dropPos.top, left: dropPos.left, width: dropPos.width,
            zIndex: 9999,
            background: isDark ? '#1a0e38' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            borderRadius: 12,
            boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 8px 28px rgba(0,0,0,0.16)',
            overflow: 'hidden',
            maxHeight: 210, overflowY: 'auto',
          }}
        >
          {items.map((o, i) => (
            <DropItem
              key={o.value}
              label={o.label}
              selected={o.value === value}
              isDark={isDark}
              hasDivider={i < items.length - 1}
              onSelect={() => { onChange(o.value); setOpen(false) }}
            />
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export function PlanPopup({ planId, isDark, onClose }: {
  planId: string
  isDark: boolean
  onClose: () => void
}) {
  const cfg = PLAN_CONFIGS[planId]
  if (!cfg) return null

  const popupBg    = isDark ? cfg.interiorDark : '#ffffff'
  const bodyBg     = isDark ? cfg.interiorDark : cfg.interiorLight
  const textPrimary   = isDark ? 'rgba(255,255,255,0.90)' : '#111827'
  const textSecondary = isDark ? 'rgba(255,255,255,0.42)' : '#6b7280'
  const divider    = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9900,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: isDark ? 'rgba(5,2,15,0.74)' : 'rgba(15,5,40,0.46)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        animation: 'xp-set-backdrop 200ms ease forwards',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          borderRadius: 24, overflow: 'hidden',
          background: popupBg,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          boxShadow: '0 32px 80px rgba(0,0,0,0.50)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(90vh - 32px)',
          animation: 'xp-set-card 240ms cubic-bezier(0.34,1.06,0.64,1) forwards',
        }}
      >

        {/* ── Gradient Header ── */}
        <div style={{ background: cfg.headerGradient, padding: '22px 22px 20px', position: 'relative', flexShrink: 0 }}>

          {/* Badge — top right */}
          <div className="xp-badge-pill" style={{
            position: 'absolute', top: 16, right: 52,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.22)',
            border: '1px solid rgba(255,255,255,0.32)',
            borderRadius: 20, padding: '4px 11px',
            fontSize: 10.5, fontWeight: 700, color: 'white', letterSpacing: '0.02em',
          }}>
            {cfg.badgeIcon} {cfg.badge}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 14, right: 14,
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'white', flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 12, height: 12 }}>
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </button>

          {/* Plan name */}
          <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.60)', marginBottom: 2, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>XPadite</p>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: 'white', letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: 8 }}>
            {cfg.title}
          </h2>
          <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.70)', lineHeight: 1.5, maxWidth: 360 }}>{cfg.subtitle}</p>
        </div>

        {/* ── Scrollable Body ── */}
        <div
          className="xp-set-body"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: bodyBg, padding: '20px 22px 4px' }}
        >

          {/* Pricing */}
          {cfg.savings ? (
            /* Yearly plans: price+label centered, savings pill centered on its own row below */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 44, fontWeight: 800, color: textPrimary, lineHeight: 1, letterSpacing: '-0.03em' }}>
                  {cfg.price}
                </span>
                <span style={{ fontSize: 14, color: textSecondary, fontWeight: 500 }}>
                  {cfg.priceLabel}
                </span>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, color: cfg.accentColor,
                background: cfg.accentGlow, padding: '4px 11px', borderRadius: 8,
              }}>{cfg.savings}</span>
            </div>
          ) : (
            /* Non-yearly plans: price + label centered, no savings badge */
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 44, fontWeight: 800, color: textPrimary, lineHeight: 1, letterSpacing: '-0.03em' }}>
                {cfg.price}
              </span>
              <span style={{ fontSize: 14, color: textSecondary, fontWeight: 500 }}>
                {cfg.priceLabel}
              </span>
            </div>
          )}

          <div style={{ height: 1, background: divider, margin: '14px 0' }} />

          {/* Feature list — centered block, items left-aligned within */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingBottom: 4, maxWidth: 360, margin: '0 auto' }}>
            {cfg.includedFeatures.map((feat, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: cfg.accentGlow,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke={cfg.accentColor} strokeWidth="2.8" style={{ width: 11, height: 11 }}>
                    <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span style={{ fontSize: 12.5, color: textPrimary, lineHeight: 1.4, flex: 1 }}>{feat}</span>
              </div>
            ))}

            {cfg.excludedFeatures.length > 0 && (
              <>
                <div style={{ height: 1, background: divider, margin: '6px 0' }} />
                {cfg.excludedFeatures.map((feat, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(239,68,68,0.10)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.8" style={{ width: 11, height: 11 }}>
                        <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span style={{ fontSize: 12.5, color: textSecondary, lineHeight: 1.4, flex: 1 }}>{feat}</span>
                  </div>
                ))}
              </>
            )}
          </div>

        </div>

        {/* ── CTA Footer ── */}
        <div style={{
          padding: '16px 22px 20px', flexShrink: 0,
          background: isDark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.95)',
          borderTop: `1px solid ${divider}`,
        }}>
          <button className="xp-plan-cta" style={{
            width: '100%', padding: '14px 20px', borderRadius: 14, cursor: 'pointer',
            background: cfg.ctaBg, border: 'none', color: 'white',
            fontSize: 14.5, fontWeight: 700, letterSpacing: '0.01em',
            boxShadow: `0 4px 20px ${cfg.ctaGlow}`,
          }}>
            {cfg.ctaLabel}
          </button>
          {cfg.note && (
            <p style={{ textAlign: 'center', fontSize: 10.5, color: textSecondary, marginTop: 10, lineHeight: 1.5 }}>
              {cfg.note}
            </p>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { isDark, setIsDark, progressColor, setProgressColor } = useApp()
  const pc = resolveProgressColor(progressColor, isDark)

  const [openTheme,  setOpenTheme]  = useState(true)
  const [openColor,  setOpenColor]  = useState(true)
  const [openPlan,   setOpenPlan]   = useState(true)
  const [openLocale, setOpenLocale] = useState(true)

  const [language, setLanguage] = useState('English (US)')
  const [timezone, setTimezone] = useState(() => getBrowserTimezone())

  // Capture committed state when modal opens
  const initialRef = useRef({ isDark, progressColor, language: 'English (US)', timezone: getBrowserTimezone() })

  const hasChanges =
    isDark !== initialRef.current.isDark ||
    progressColor !== initialRef.current.progressColor ||
    language !== initialRef.current.language ||
    timezone !== initialRef.current.timezone

  const [showPrompt, setShowPrompt] = useState(false)
  const [hoveredSwatch, setHoveredSwatch] = useState<string | null>(null)
  const [activePlanPopup, setActivePlanPopup] = useState<string | null>(null)

  const handleClose = () => {
    if (hasChanges) { setShowPrompt(true) } else { onClose() }
  }

  const handleSaveAndClose = () => {
    initialRef.current = { isDark, progressColor, language, timezone }
    setShowPrompt(false)
    onClose()
  }

  const handleDiscardAndClose = () => {
    setIsDark(initialRef.current.isDark)
    setProgressColor(initialRef.current.progressColor)
    setLanguage(initialRef.current.language)
    setTimezone(initialRef.current.timezone)
    setShowPrompt(false)
    onClose()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (activePlanPopup) { setActivePlanPopup(null) }
        else if (showPrompt) { setShowPrompt(false) }
        else { handleClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPrompt, hasChanges, activePlanPopup])

  // ── Design tokens ──────────────────────────────────────────────────────────
  const modalBg       = isDark ? '#15102a'                  : '#f0ecff'
  const cardBg        = isDark ? 'rgba(255,255,255,0.044)'  : '#f8f7fc'
  const cardBorder    = isDark ? 'rgba(255,255,255,0.085)'  : 'rgba(0,0,0,0.075)'
  const dividerColor  = isDark ? 'rgba(255,255,255,0.07)'   : 'rgba(0,0,0,0.07)'
  const titleColor    = isDark ? 'rgba(255,255,255,0.92)'   : '#111827'
  const subtitleColor = isDark ? 'rgba(255,255,255,0.42)'   : '#6b7280'
  const chevronColor  = isDark ? 'rgba(255,255,255,0.32)'   : '#9ca3af'
  const footerBg      = isDark ? 'rgba(0,0,0,0.15)'         : 'rgba(255,255,255,0.70)'

  return (
    <>
      <style>{`
        @keyframes xp-set-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes xp-set-card { from { opacity: 0; transform: scale(0.96) translateY(12px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes xpSetHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-set-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpSetHdrFlow 14s ease infinite;
        }
        .xp-set-body::-webkit-scrollbar { width: 5px }
        .xp-set-body::-webkit-scrollbar-track { background: transparent }
        .xp-set-body::-webkit-scrollbar-thumb { background: rgba(124,58,237,0.38); border-radius: 10px }
        .xp-set-body::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.58) }
        .xp-set-body { scrollbar-width: thin; scrollbar-color: rgba(124,58,237,0.38) transparent }
        .xp-sec-btn {
          width: 100%; display: flex; align-items: center; gap: 13px;
          padding: 18px 22px; cursor: pointer; background: none; border: none;
          text-align: left;
        }
        .xp-sec-btn:hover { background: rgba(124,58,237,0.035) }
        .xp-plan-card { transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; cursor: pointer }
        .xp-plan-card:hover { transform: translateY(-2px); filter: brightness(1.07) }
        .xp-plan-purple:hover { box-shadow: 0 8px 28px rgba(124,58,237,0.42) !important }
        .xp-plan-green:hover  { box-shadow: 0 8px 28px rgba(22,163,74,0.38) !important }
        .xp-plan-orange:hover { box-shadow: 0 8px 28px rgba(234,88,12,0.38) !important }
        .xp-plan-cyan:hover   { box-shadow: 0 8px 28px rgba(6,182,212,0.38) !important }
        .xp-set-close:hover   { background: rgba(255,255,255,0.22) !important }
        .xp-reset-txt { background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 5px; padding: 6px 2px; font-size: 12px; font-weight: 500; transition: color 150ms }
        .xp-reset-txt:hover { color: #7c3aed !important }
        .xp-set-default:hover:not(:disabled) { background: #6d28d9 !important }
        .xp-swatch { transition: transform 220ms cubic-bezier(0.34,1.06,0.64,1), outline-offset 150ms ease, box-shadow 160ms ease }
        .xp-swatch:hover { transform: scale(1.10) !important }
        .xp-cancel:hover { opacity: 0.75 }
        .xp-save:hover { opacity: 0.88 }
        .xp-plan-cta { transition: opacity 160ms, transform 180ms cubic-bezier(0.34,1.06,0.64,1), box-shadow 200ms, filter 160ms }
        .xp-plan-cta:hover { opacity: 0.93; transform: translateY(-2px) scale(1.013); filter: brightness(1.10) }
        .xp-plan-cta:active { transform: scale(0.965) translateY(0px) !important; opacity: 0.80; filter: brightness(0.92) }
        .xp-badge-pill { transition: transform 180ms cubic-bezier(0.34,1.06,0.64,1); transform-origin: center; cursor: default }
        .xp-badge-pill:hover { transform: scale(1.14) }
      `}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{
          background: isDark ? 'rgba(10,4,24,0.65)' : 'rgba(30,10,60,0.32)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'xp-set-backdrop 200ms ease forwards',
        }}
      >

        {/*
         * ── Modal shell ──────────────────────────────────────────────────────
         * Three-region flex column:
         *   1. Header  → flex-shrink: 0   (never scrolls, always visible)
         *   2. Body    → flex: 1 1 0      (scrolls when content exceeds height)
         *   3. Footer  → flex-shrink: 0   (never scrolls, always visible)
         *
         * The critical fix is flex: '1 1 0' + minHeight: 0 on the body.
         * Without minHeight: 0 a flex child cannot shrink below its intrinsic
         * height, so overflow-y: auto never activates.
         */}
        <div
          className="w-full max-w-[600px]"
          style={{
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            maxHeight: 'calc(90vh - 32px)',
            background: modalBg,
            border: `1px solid ${isDark ? 'rgba(124,58,237,0.36)' : 'rgba(124,58,237,0.18)'}`,
            borderRadius: 24,
            boxShadow: isDark
              ? '0 0 0 4px rgba(124,58,237,0.10), 0 32px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(124,58,237,0.18)'
              : '0 0 0 4px rgba(124,58,237,0.06), 0 24px 64px rgba(124,58,237,0.16), 0 6px 20px rgba(0,0,0,0.10)',
            animation: 'xp-set-card 230ms cubic-bezier(0.34,1.06,0.64,1) forwards',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >

          {/* ════════════════════════════════════════════════════════════════
              REGION 1 — FIXED HEADER (never scrolls)
          ════════════════════════════════════════════════════════════════ */}
          <div
            className="xp-set-hdr"
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px',
              borderBottom: '0.5px solid rgba(255,255,255,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(255,255,255,0.18)',
                border: '1.5px solid rgba(255,255,255,0.32)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.20)',
              }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" style={{ width: 20, height: 20 }}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.2 }}>Settings</h2>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', marginTop: 3 }}>Personalize your experience</p>
              </div>
            </div>
            <button
              className="xp-set-close"
              onClick={handleClose}
              style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.13)',
                color: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(255,255,255,0.22)',
                cursor: 'pointer', transition: 'background 150ms',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* ════════════════════════════════════════════════════════════════
              REGION 2 — SCROLLABLE BODY
              flex: 1 1 0  →  grows to fill available space
              minHeight: 0 →  allows shrinking below intrinsic size (critical)
              overflow-y: auto → scrolls when content exceeds bounded height
          ════════════════════════════════════════════════════════════════ */}
          <div
            className="xp-set-body flex-1"
            style={{
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '20px 18px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >

            {/* ══ THEME MODE ══════════════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, boxShadow: openTheme ? (isDark ? '0 4px 20px rgba(124,58,237,0.14)' : '0 4px 20px rgba(124,58,237,0.10)') : 'none', transition: 'box-shadow 220ms' }}>

              {/* Section header — clickable to toggle */}
              <button className="xp-sec-btn" onClick={() => setOpenTheme(v => !v)}>
                <SectionIcon emoji={isDark ? '🌙' : '☀️'} />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Theme Mode</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Switch between light and dark mode</p>
                </div>
                <span style={{ color: chevronColor }}><Chevron open={openTheme} /></span>
              </button>

              {/* Section content — full natural height, no maxHeight cap */}
              {openTheme && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '18px 20px 22px 36px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                    {/* Light */}
                    <button
                      onClick={() => setIsDark(false)}
                      style={{
                        borderRadius: 14, padding: '14px 14px', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                        transition: 'all 180ms',
                        background: !isDark ? 'rgba(124,58,237,0.08)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                        border: !isDark ? '1.5px solid #7c3aed' : `1px solid ${cardBorder}`,
                      }}
                    >
                      <span style={{ fontSize: 22, flexShrink: 0 }}>☀️</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 2, color: !isDark ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.50)' : '#374151' }}>Light</p>
                        <p style={{ fontSize: 10.5, lineHeight: 1.4, color: isDark ? 'rgba(255,255,255,0.28)' : '#9ca3af' }}>Clean, bright and focused</p>
                      </div>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${!isDark ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {!isDark && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed' }} />}
                      </div>
                    </button>

                    {/* Dark */}
                    <button
                      onClick={() => setIsDark(true)}
                      style={{
                        borderRadius: 14, padding: '14px 14px', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                        transition: 'all 180ms',
                        background: isDark ? 'linear-gradient(135deg, #1e0a3c 0%, #2d1060 100%)' : 'rgba(0,0,0,0.035)',
                        border: isDark ? '1.5px solid rgba(124,58,237,0.58)' : `1px solid ${cardBorder}`,
                      }}
                    >
                      <span style={{ fontSize: 22, flexShrink: 0 }}>🌙</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 2, color: isDark ? 'white' : '#374151' }}>Dark</p>
                        <p style={{ fontSize: 10.5, lineHeight: 1.4, color: isDark ? 'rgba(255,255,255,0.48)' : '#9ca3af' }}>Easy on the eyes</p>
                      </div>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        background: isDark ? '#7c3aed' : 'transparent',
                        border: `2px solid ${isDark ? '#a78bfa' : 'rgba(0,0,0,0.18)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isDark && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" style={{ width: 10, height: 10 }}>
                            <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>

                  </div>
                </div>
              )}
            </div>

            {/* ══ THEME COLOR ═════════════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, boxShadow: openColor ? (isDark ? '0 4px 20px rgba(124,58,237,0.14)' : '0 4px 20px rgba(124,58,237,0.10)') : 'none', transition: 'box-shadow 220ms' }}>

              {/* Section header — div (not button) because it contains a nested button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '18px 22px' }}>
                <SectionIcon emoji="🎨" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Theme Color</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Used for productive day circles &amp; streak lines</p>
                </div>
                <button
                  className="xp-set-default"
                  onClick={() => setProgressColor(DEFAULT_COLOR)}
                  disabled={progressColor === DEFAULT_COLOR}
                  style={{
                    fontSize: 11, fontWeight: 600, flexShrink: 0, color: 'white',
                    background: progressColor === DEFAULT_COLOR ? 'rgba(124,58,237,0.38)' : '#7c3aed',
                    border: 'none', borderRadius: 9, padding: '6px 13px',
                    cursor: progressColor === DEFAULT_COLOR ? 'default' : 'pointer',
                    transition: 'background 150ms',
                    opacity: progressColor === DEFAULT_COLOR ? 0.55 : 1,
                  }}
                >
                  Set to default
                </button>
                <button
                  onClick={() => setOpenColor(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: chevronColor, padding: '4px', display: 'flex', flexShrink: 0 }}
                >
                  <Chevron open={openColor} />
                </button>
              </div>

              {openColor && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '18px 22px 24px 36px' }}>

                  {/* Color swatches */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    {PROGRESS_COLORS.map(({ name, value, darkCheck }) => {
                      const active      = progressColor === value
                      const isHov       = hoveredSwatch === value
                      const isBW        = value === 'bw'
                      const swatchBg    = isBW ? 'conic-gradient(#000000 0turn 0.5turn, #f0f0f0 0.5turn 1turn)' : value
                      const ringColor   = isBW ? '#7c3aed' : value
                      const checkStroke = isBW ? '#7c3aed' : darkCheck ? '#1a1a1a' : 'white'
                      const glowColor   = isBW ? '#b0b7c3' : value
                      // Glow: same hue, spread 14px, 52% opacity via 85 hex alpha
                      const glowShadow  = `0 0 14px 4px ${glowColor}85`
                      const baseShadow  = active
                        ? `0 0 0 5px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}, 0 4px 12px rgba(0,0,0,0.25)`
                        : '0 2px 6px rgba(0,0,0,0.18)'
                      return (
                        <button
                          key={value}
                          className="xp-swatch"
                          onClick={() => setProgressColor(value)}
                          onMouseEnter={() => setHoveredSwatch(value)}
                          onMouseLeave={() => setHoveredSwatch(null)}
                          title={name}
                          style={{
                            width: 36, height: 36, borderRadius: '50%', cursor: 'pointer',
                            background: swatchBg, flexShrink: 0, position: 'relative', overflow: 'hidden',
                            border: isBW ? `0.5px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'transparent'}` : 'none',
                            outline: active ? `2.5px solid ${ringColor}` : '2.5px solid transparent',
                            outlineOffset: active ? 3 : 0,
                            boxShadow: isHov ? `${baseShadow}, ${glowShadow}` : baseShadow,
                            transform: active ? 'scale(1.10)' : 'scale(1)',
                            clipPath: isBW ? 'circle(49%)' : undefined,
                          }}
                        >
                          {active && (
                            <svg viewBox="0 0 24 24" fill="none" stroke={checkStroke} strokeWidth="3"
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '7px' }}>
                              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>

                </div>
              )}
            </div>

            {/* ══ SUBSCRIPTION PLAN ═══════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, boxShadow: openPlan ? (isDark ? '0 4px 20px rgba(124,58,237,0.14)' : '0 4px 20px rgba(124,58,237,0.10)') : 'none', transition: 'box-shadow 220ms' }}>

              <button className="xp-sec-btn" onClick={() => setOpenPlan(v => !v)}>
                <SectionIcon emoji="💎" />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Your Subscription Plan</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Manage your current plan</p>
                </div>
                <span style={{ color: chevronColor }}><Chevron open={openPlan} /></span>
              </button>

              {openPlan && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '18px 20px 22px 36px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                    {/* Pro Monthly — light gray */}
                    <div className="xp-plan-card" onClick={() => setActivePlanPopup('pro-monthly')} style={{
                      background: 'linear-gradient(135deg, #6b7280 0%, #9ca3af 60%, #d1d5db 100%)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(107,114,128,0.34)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90,
                      transition: 'transform 160ms ease, box-shadow 160ms ease, filter 160ms ease', cursor: 'pointer',
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Pro Monthly Plan $7</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.88)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" style={{ width: 11, height: 11, flexShrink: 0 }}>
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Current Plan
                      </p>
                    </div>

                    {/* Pro Yearly — purple */}
                    <div className="xp-plan-card xp-plan-purple" onClick={() => setActivePlanPopup('pro-yearly')} style={{
                      background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(124,58,237,0.32)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90,
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Pro Yearly Plan $59.99</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>Upgrade</p>
                    </div>

                    {/* Premium Monthly — green */}
                    <div className="xp-plan-card xp-plan-green" onClick={() => setActivePlanPopup('premium-monthly')} style={{
                      background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(22,163,74,0.30)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90,
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Premium Monthly Plan $10</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.70)', marginTop: 6 }}>Upgrade</p>
                    </div>

                    {/* Premium Yearly — true gold */}
                    <div className="xp-plan-card" onClick={() => setActivePlanPopup('premium-yearly')} style={{
                      background: 'linear-gradient(135deg, #92400e 0%, #d97706 50%, #fbbf24 100%)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(217,119,6,0.42)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90,
                      transition: 'transform 160ms ease, box-shadow 160ms ease, filter 160ms ease', cursor: 'pointer',
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Premium Yearly Plan $89.99</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', marginTop: 6 }}>Upgrade</p>
                    </div>

                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="xp-plan-card xp-plan-cyan" onClick={() => setActivePlanPopup('ltd')} style={{
                      background: 'linear-gradient(to right, #22d3ee, #0891b2)',
                      borderRadius: 14, padding: '20px 18px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(6,182,212,0.28)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 90,
                    }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>LTD – Lifetime Deal $99</p>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.68)', marginTop: 6 }}>Upgrade</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ══ LANGUAGE & REGION ═══════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, boxShadow: openLocale ? (isDark ? '0 4px 20px rgba(124,58,237,0.14)' : '0 4px 20px rgba(124,58,237,0.10)') : 'none', transition: 'box-shadow 220ms' }}>

              <button className="xp-sec-btn" onClick={() => setOpenLocale(v => !v)}>
                <SectionIcon emoji="🌐" />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Language &amp; Region</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Language and time zone preferences</p>
                </div>
                <span style={{ color: chevronColor }}><Chevron open={openLocale} /></span>
              </button>

              {openLocale && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '18px 20px 22px 36px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                    <div>
                      <p style={{ fontSize: 11.5, fontWeight: 600, color: subtitleColor, marginBottom: 9 }}>Language</p>
                      <SelectMenu
                        value={language}
                        onChange={setLanguage}
                        options={LANGUAGES}
                        isDark={isDark}
                      />
                    </div>

                    <div>
                      <p style={{ fontSize: 11.5, fontWeight: 600, color: subtitleColor, marginBottom: 9 }}>Time Zone</p>
                      <SelectMenu
                        value={timezone}
                        onChange={setTimezone}
                        options={TIMEZONES}
                        isDark={isDark}
                      />
                    </div>

                  </div>
                </div>
              )}
            </div>

            {/* ══ DATA & BACKUP ════════════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0, marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                <SectionIcon emoji="💾" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Data &amp; Backup</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Export a snapshot of your local XPadite data</p>
                </div>
                <button
                  type="button"
                  onClick={() => exportLocalData()}
                  style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    color: isDark ? 'rgba(255,255,255,0.80)' : '#374151',
                    background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                    border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`,
                    borderRadius: 10, padding: '8px 14px',
                    transition: 'opacity 150ms',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
                  </svg>
                  Export Backup
                </button>
              </div>
            </div>

          </div>
          {/* ── End scrollable body ─────────────────────────────────────────── */}

          {/* ════════════════════════════════════════════════════════════════
              REGION 3 — FIXED FOOTER (never scrolls)
          ════════════════════════════════════════════════════════════════ */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '14px 22px',
              borderTop: `0.5px solid ${dividerColor}`,
              background: footerBg,
            }}
          >
            <button
              className="xp-reset-txt"
              onClick={() => {
                setIsDark(false)
                setProgressColor(DEFAULT_COLOR)
                setLanguage('English (US)')
                setTimezone(getBrowserTimezone())
              }}
              style={{ color: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                <polyline points="1 4 1 10 7 10" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.51 15a9 9 0 1 0 .49-4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Reset to Default
            </button>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="xp-cancel"
                onClick={handleClose}
                style={{
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  color: isDark ? 'rgba(255,255,255,0.55)' : '#4b5563',
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)'}`,
                  borderRadius: 12, padding: '10px 22px',
                  transition: 'opacity 150ms',
                }}
              >
                Cancel
              </button>
              <button
                className="xp-save"
                onClick={handleSaveAndClose}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: 'white',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  border: 'none', borderRadius: 12, padding: '10px 24px',
                  boxShadow: '0 4px 16px rgba(124,58,237,0.44)',
                  transition: 'opacity 150ms',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ width: 13, height: 13 }}>
                  <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Save Changes
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Plan Detail Popup ────────────────────────────────────────────── */}
      {activePlanPopup && (
        <PlanPopup
          planId={activePlanPopup}
          isDark={isDark}
          onClose={() => setActivePlanPopup(null)}
        />
      )}

      {/* ── Unsaved Changes Confirmation Dialog ──────────────────────────── */}
      {showPrompt && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center"
          style={{ background: 'rgba(10,4,24,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={() => setShowPrompt(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 340, borderRadius: 20, overflow: 'hidden',
              background: isDark ? '#1a0e38' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.16)'}`,
              boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.60)' : '0 24px 64px rgba(124,58,237,0.18)',
            }}
          >
            {/* Dialog header */}
            <div style={{
              padding: '20px 22px 16px',
              borderBottom: `0.5px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(124,58,237,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" style={{ width: 15, height: 15 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round"/>
                  </svg>
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.92)' : '#111827' }}>Unsaved Changes</p>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.6, color: isDark ? 'rgba(255,255,255,0.48)' : '#6b7280', paddingLeft: 42 }}>
                You have unsaved changes. Would you like to save them before closing?
              </p>
            </div>

            {/* Dialog actions */}
            <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={handleSaveAndClose}
                style={{
                  width: '100%', padding: '11px 16px', borderRadius: 12, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  border: 'none', color: 'white', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  boxShadow: '0 4px 14px rgba(124,58,237,0.40)',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ width: 13, height: 13 }}>
                  <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Save Changes
              </button>
              <button
                onClick={handleDiscardAndClose}
                style={{
                  width: '100%', padding: '11px 16px', borderRadius: 12, cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
                  color: isDark ? 'rgba(255,255,255,0.60)' : '#6b7280',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                Discard &amp; Close
              </button>
              <button
                onClick={() => setShowPrompt(false)}
                style={{
                  width: '100%', padding: '9px 16px', borderRadius: 12, cursor: 'pointer',
                  background: 'transparent', border: 'none',
                  color: isDark ? 'rgba(255,255,255,0.35)' : '#9ca3af',
                  fontSize: 12.5, fontWeight: 500,
                }}
              >
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
