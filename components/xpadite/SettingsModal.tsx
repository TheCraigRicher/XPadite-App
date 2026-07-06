'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'
import { hexToRgba } from './utils'

const PROGRESS_COLORS = [
  { name: 'Green',  value: '#16a34a' },
  { name: 'Blue',   value: '#2563eb' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Pink',   value: '#db2777' },
  { name: 'Gold',   value: '#d97706' },
  { name: 'Red',    value: '#dc2626' },
  { name: 'Teal',   value: '#0d9488' },
]

const DEFAULT_COLOR = '#16a34a'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { isDark, progressColor, setProgressColor } = useApp()
  const [hoverClose, setHoverClose] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <style>{`
        @keyframes xp-settings-backdrop { from { opacity: 0 } to { opacity: 1 } }
        @keyframes xp-settings-card { from { opacity: 0; transform: scale(0.95) translateY(8px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{
          background: isDark ? 'rgba(10,4,24,0.65)' : 'rgba(30,10,60,0.32)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'xp-settings-backdrop 200ms ease forwards',
        }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-[400px]"
          style={{
            background: isDark ? '#15102a' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(124,58,237,0.40)' : 'rgba(124,58,237,0.22)'}`,
            borderRadius: 20,
            boxShadow: isDark
              ? '0 0 0 4px rgba(124,58,237,0.10), 0 32px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(124,58,237,0.18)'
              : '0 0 0 4px rgba(124,58,237,0.07), 0 24px 64px rgba(124,58,237,0.14), 0 6px 20px rgba(0,0,0,0.10)',
            animation: 'xp-settings-card 220ms cubic-bezier(0.34,1.06,0.64,1) forwards',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-7 py-5"
            style={{ borderBottom: `0.5px solid ${isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.12)'}` }}
          >
            <div className="flex items-center gap-3">
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(124,58,237,0.45)',
                flexShrink: 0,
              }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ width: 16, height: 16 }}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: '#7c3aed' }}>Settings</h2>
                <p className="text-[10px] mt-0.5" style={{ color: isDark ? 'rgba(255,255,255,0.38)' : '#9ca3af' }}>
                  Personalize your experience
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              onMouseEnter={() => setHoverClose(true)}
              onMouseLeave={() => setHoverClose(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150"
              style={{
                background: hoverClose ? 'rgba(124,58,237,0.12)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                color: isDark ? 'rgba(255,255,255,0.45)' : '#6b7280',
                border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="px-7 py-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : '#111827' }}>
                  Progress Color
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: isDark ? 'rgba(255,255,255,0.38)' : '#9ca3af' }}>
                  Productive day circles &amp; streak lines
                </p>
              </div>
              {progressColor !== DEFAULT_COLOR && (
                <button
                  onClick={() => setProgressColor(DEFAULT_COLOR)}
                  className="text-[10px] transition-opacity hover:opacity-70"
                  style={{ color: '#7c3aed', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Color swatches */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {PROGRESS_COLORS.map(({ name, value }) => {
                const active = progressColor === value
                return (
                  <button
                    key={value}
                    onClick={() => setProgressColor(value)}
                    title={name}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: value,
                      border: 'none',
                      cursor: 'pointer',
                      position: 'relative',
                      outline: active ? `2.5px solid ${value}` : '2.5px solid transparent',
                      outlineOffset: active ? 2 : 0,
                      boxShadow: active
                        ? `0 0 0 4px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}, 0 4px 12px rgba(0,0,0,0.25)`
                        : '0 2px 6px rgba(0,0,0,0.18)',
                      transform: active ? 'scale(1.10)' : 'scale(1)',
                      transition: 'transform 150ms ease, outline-offset 150ms ease, box-shadow 150ms ease',
                      flexShrink: 0,
                    }}
                  >
                    {active && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '7px' }}
                      >
                        <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Live preview */}
            <div
              className="flex items-center gap-3 mt-5 px-4 py-3 rounded-xl"
              style={{
                background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              }}
            >
              {/* Productive day circle */}
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: progressColor,
                  boxShadow: `0 0 0 2px ${isDark ? '#15102a' : '#ffffff'}, 0 0 0 4.5px ${hexToRgba(progressColor, 0.65)}`,
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: 'white',
                }}
              >
                12
              </div>
              {/* Streak chain */}
              <div className="flex items-center" style={{ flexShrink: 0 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center">
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: progressColor,
                      boxShadow: `0 0 0 1.5px ${hexToRgba(progressColor, 0.35)}`,
                      flexShrink: 0,
                    }} />
                    {i < 2 && <div style={{ width: 14, height: 2, background: progressColor, flexShrink: 0 }} />}
                  </div>
                ))}
              </div>
              <p className="text-[10px]" style={{ color: isDark ? 'rgba(255,255,255,0.35)' : '#9ca3af' }}>
                Live preview
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
