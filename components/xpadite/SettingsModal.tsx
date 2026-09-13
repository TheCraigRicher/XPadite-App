'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'
import { hexToRgba, resolveProgressColor } from './utils'

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
  { value: 'Pacific/Auckland',    label: 'New Zealand — Auckland'           },
  { value: 'Australia/Sydney',    label: 'Australia — Sydney'               },
  { value: 'Asia/Tokyo',          label: 'Japan — Tokyo'                    },
  { value: 'Asia/Singapore',      label: 'Singapore'                        },
  { value: 'Asia/Kolkata',        label: 'India — Kolkata'                  },
  { value: 'Europe/Berlin',       label: 'Germany — Berlin'                 },
  { value: 'Europe/Paris',        label: 'France — Paris'                   },
  { value: 'Europe/London',       label: 'United Kingdom — London'          },
  { value: 'UTC',                 label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York',    label: 'USA — New York (Eastern)'         },
  { value: 'America/Chicago',     label: 'USA — Chicago (Central)'          },
  { value: 'America/Denver',      label: 'USA — Denver (Mountain)'          },
  { value: 'America/Los_Angeles', label: 'USA — Los Angeles (Pacific)'      },
  { value: 'America/Vancouver',   label: 'Canada — Vancouver'               },
  { value: 'America/Toronto',     label: 'Canada — Toronto'                 },
]

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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { isDark, setIsDark, progressColor, setProgressColor } = useApp()
  const pc = resolveProgressColor(progressColor, isDark)

  const [openTheme,  setOpenTheme]  = useState(true)
  const [openColor,  setOpenColor]  = useState(true)
  const [openPlan,   setOpenPlan]   = useState(true)
  const [openLocale, setOpenLocale] = useState(true)

  const [language, setLanguage] = useState('English (US)')
  const [timezone, setTimezone] = useState('America/Vancouver')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Design tokens ──────────────────────────────────────────────────────────
  const modalBg       = isDark ? '#15102a'                  : '#f0ecff'
  const cardBg        = isDark ? 'rgba(255,255,255,0.044)'  : '#ffffff'
  const cardBorder    = isDark ? 'rgba(255,255,255,0.085)'  : 'rgba(0,0,0,0.075)'
  const dividerColor  = isDark ? 'rgba(255,255,255,0.07)'   : 'rgba(0,0,0,0.07)'
  const titleColor    = isDark ? 'rgba(255,255,255,0.92)'   : '#111827'
  const subtitleColor = isDark ? 'rgba(255,255,255,0.42)'   : '#6b7280'
  const chevronColor  = isDark ? 'rgba(255,255,255,0.32)'   : '#9ca3af'
  const footerBg      = isDark ? 'rgba(0,0,0,0.15)'         : 'rgba(255,255,255,0.70)'

  const selectStyle: React.CSSProperties = {
    width: '100%',
    appearance: 'none',
    WebkitAppearance: 'none',
    padding: '11px 36px 11px 14px',
    borderRadius: 12,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.13)' : 'rgba(124,58,237,0.22)'}`,
    background: isDark ? 'rgba(255,255,255,0.07)' : '#f5f0ff',
    color: isDark ? 'rgba(255,255,255,0.85)' : '#111827',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', outline: 'none',
  }

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
        .xp-swatch { transition: transform 150ms ease, outline-offset 150ms ease, box-shadow 150ms ease }
        .xp-cancel:hover { opacity: 0.75 }
        .xp-save:hover { opacity: 0.88 }
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
        onClick={onClose}
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
              onClick={onClose}
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
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0 }}>

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
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '20px 22px 24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

                    {/* Light */}
                    <button
                      onClick={() => setIsDark(false)}
                      style={{
                        borderRadius: 14, padding: '20px 16px', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', flexDirection: 'column', gap: 14, transition: 'all 180ms',
                        background: !isDark ? 'rgba(124,58,237,0.08)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                        border: !isDark ? '1.5px solid #7c3aed' : `1px solid ${cardBorder}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 26 }}>☀️</span>
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${!isDark ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {!isDark && <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#7c3aed' }} />}
                        </div>
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 5, color: !isDark ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.50)' : '#374151' }}>Light</p>
                        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: isDark ? 'rgba(255,255,255,0.28)' : '#9ca3af' }}>Clean, bright and focused</p>
                      </div>
                    </button>

                    {/* Dark */}
                    <button
                      onClick={() => setIsDark(true)}
                      style={{
                        borderRadius: 14, padding: '20px 16px', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', flexDirection: 'column', gap: 14, transition: 'all 180ms',
                        background: isDark ? 'linear-gradient(135deg, #1e0a3c 0%, #2d1060 100%)' : 'rgba(0,0,0,0.035)',
                        border: isDark ? '1.5px solid rgba(124,58,237,0.58)' : `1px solid ${cardBorder}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 26 }}>🌙</span>
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                          background: isDark ? '#7c3aed' : 'transparent',
                          border: `2px solid ${isDark ? '#a78bfa' : 'rgba(0,0,0,0.18)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isDark && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" style={{ width: 11, height: 11 }}>
                              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 5, color: isDark ? 'white' : '#374151' }}>Dark</p>
                        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: isDark ? 'rgba(255,255,255,0.48)' : '#9ca3af' }}>Easy on the eyes</p>
                      </div>
                    </button>

                  </div>
                </div>
              )}
            </div>

            {/* ══ THEME COLOR ═════════════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0 }}>

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
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '20px 24px 26px' }}>

                  {/* Color swatches */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {PROGRESS_COLORS.map(({ name, value, darkCheck }) => {
                      const active      = progressColor === value
                      const isBW        = value === 'bw'
                      const swatchBg    = isBW ? 'linear-gradient(to right, #000000 50%, #ffffff 50%)' : value
                      const ringColor   = isBW ? '#7c3aed' : value
                      const checkStroke = isBW ? '#7c3aed' : darkCheck ? '#1a1a1a' : 'white'
                      return (
                        <button
                          key={value}
                          className="xp-swatch"
                          onClick={() => setProgressColor(value)}
                          title={name}
                          style={{
                            width: 42, height: 42, borderRadius: '50%', cursor: 'pointer',
                            background: swatchBg, flexShrink: 0, position: 'relative', overflow: 'hidden',
                            border: isBW ? `0.5px solid ${isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.15)'}` : 'none',
                            outline: active ? `2.5px solid ${ringColor}` : '2.5px solid transparent',
                            outlineOffset: active ? 3 : 0,
                            boxShadow: active
                              ? `0 0 0 5px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}, 0 4px 12px rgba(0,0,0,0.25)`
                              : '0 2px 6px rgba(0,0,0,0.18)',
                            transform: active ? 'scale(1.12)' : 'scale(1)',
                          }}
                        >
                          {active && (
                            <svg viewBox="0 0 24 24" fill="none" stroke={checkStroke} strokeWidth="3"
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '9px' }}>
                              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {/* Live preview */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 14, marginTop: 22,
                    padding: '14px 18px', borderRadius: 13,
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: pc, flexShrink: 0,
                      boxShadow: `0 0 0 2.5px ${isDark ? '#15102a' : '#f0ecff'}, 0 0 0 5px ${hexToRgba(pc, 0.60)}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9.5, fontWeight: 700, color: pc === '#ffffff' ? '#000000' : 'white',
                    }}>12</div>
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{ width: 13, height: 13, borderRadius: '50%', background: pc, boxShadow: `0 0 0 1.5px ${hexToRgba(pc, 0.35)}`, flexShrink: 0 }} />
                          {i < 2 && <div style={{ width: 18, height: 2.5, background: pc, flexShrink: 0 }} />}
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 11.5, color: isDark ? 'rgba(255,255,255,0.38)' : '#9ca3af' }}>Live preview</p>
                  </div>

                </div>
              )}
            </div>

            {/* ══ SUBSCRIPTION PLAN ═══════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0 }}>

              <button className="xp-sec-btn" onClick={() => setOpenPlan(v => !v)}>
                <SectionIcon emoji="💎" />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Your Subscription Plan</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Manage your current plan</p>
                </div>
                <span style={{ color: chevronColor }}><Chevron open={openPlan} /></span>
              </button>

              {openPlan && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '20px 22px 24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

                    <div className="xp-plan-card xp-plan-purple" style={{
                      background: 'linear-gradient(to right, #7c3aed, #6d28d9)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(124,58,237,0.32)',
                    }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', margin: '0 auto 12px',
                        background: 'rgba(255,255,255,0.22)', border: '1.5px solid rgba(255,255,255,0.58)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" style={{ width: 12, height: 12 }}>
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Pro Monthly Plan $7</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.62)', marginTop: 6 }}>Current Plan</p>
                    </div>

                    <div className="xp-plan-card xp-plan-purple" style={{
                      background: 'linear-gradient(to right, #7c3aed, #4c1d95)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(124,58,237,0.22)',
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Pro Yearly Plan $59.99</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.58)', marginTop: 6 }}>Upgrade</p>
                    </div>

                    <div className="xp-plan-card xp-plan-green" style={{
                      background: 'linear-gradient(to right, #22c55e, #16a34a)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(22,163,74,0.24)',
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Premium Monthly Plan $10</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>Upgrade</p>
                    </div>

                    <div className="xp-plan-card xp-plan-orange" style={{
                      background: 'linear-gradient(to right, #f97316, #d97706)',
                      borderRadius: 14, padding: '20px 16px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(234,88,12,0.24)',
                    }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>Premium Yearly Plan $89.99</p>
                      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.68)', marginTop: 6 }}>Upgrade</p>
                    </div>

                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="xp-plan-card xp-plan-cyan" style={{
                      background: 'linear-gradient(to right, #22d3ee, #0891b2)',
                      borderRadius: 14, padding: '20px 18px', textAlign: 'center',
                      boxShadow: '0 4px 18px rgba(6,182,212,0.28)',
                    }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>LTD – Life Time Deal $99</p>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.68)', marginTop: 6 }}>Upgrade</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ══ LANGUAGE & REGION ═══════════════════════════════════════════ */}
            <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 18, overflow: 'hidden', flexShrink: 0 }}>

              <button className="xp-sec-btn" onClick={() => setOpenLocale(v => !v)}>
                <SectionIcon emoji="🌐" />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: titleColor, lineHeight: 1.3 }}>Language &amp; Region</p>
                  <p style={{ fontSize: 11.5, color: subtitleColor, marginTop: 2 }}>Language and time zone preferences</p>
                </div>
                <span style={{ color: chevronColor }}><Chevron open={openLocale} /></span>
              </button>

              {openLocale && (
                <div style={{ borderTop: `1px solid ${dividerColor}`, padding: '20px 22px 24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

                    <div>
                      <p style={{ fontSize: 11.5, fontWeight: 600, color: subtitleColor, marginBottom: 9 }}>Language</p>
                      <div style={{ position: 'relative' }}>
                        <select value={language} onChange={e => setLanguage(e.target.value)} style={selectStyle}>
                          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        <span style={{
                          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                          pointerEvents: 'none', display: 'flex',
                          color: isDark ? 'rgba(255,255,255,0.45)' : '#9ca3af',
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>
                    </div>

                    <div>
                      <p style={{ fontSize: 11.5, fontWeight: 600, color: subtitleColor, marginBottom: 9 }}>Time Zone</p>
                      <div style={{ position: 'relative' }}>
                        <select value={timezone} onChange={e => setTimezone(e.target.value)} style={selectStyle}>
                          {TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <span style={{
                          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                          pointerEvents: 'none', display: 'flex',
                          color: isDark ? 'rgba(255,255,255,0.45)' : '#9ca3af',
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 14, height: 14 }}>
                            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>
                    </div>

                  </div>
                </div>
              )}
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
                onClick={onClose}
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
                onClick={onClose}
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
    </>
  )
}
