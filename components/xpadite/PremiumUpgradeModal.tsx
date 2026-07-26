'use client'

import { useApp } from './AppContext'

export function PremiumUpgradeModal({ onClose }: { onClose: () => void }) {
  const { isDark } = useApp()

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[420px] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: isDark
            ? 'linear-gradient(160deg, #0c0628 0%, #100838 55%, #14094a 100%)'
            : '#ffffff',
          border: isDark
            ? '0.5px solid rgba(167,139,250,0.42)'
            : '0.5px solid rgba(124,58,237,0.22)',
          boxShadow: isDark
            ? '0 32px 80px rgba(0,0,0,0.82), 0 0 0 0.5px rgba(167,139,250,0.18), 0 0 60px rgba(124,58,237,0.14)'
            : '0 24px 60px rgba(0,0,0,0.16)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {isDark && (
          <div style={{
            position: 'absolute', top: -50, left: '50%', transform: 'translateX(-50%)',
            width: 280, height: 180, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.20) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }} />
        )}

        <div className="relative z-10 px-6 pt-7 pb-4 text-center">
          <div style={{
            width: 54, height: 54, borderRadius: 16, margin: '0 auto 14px',
            background: isDark
              ? 'linear-gradient(135deg, rgba(124,58,237,0.32) 0%, rgba(99,102,241,0.28) 100%)'
              : 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(99,102,241,0.08) 100%)',
            border: isDark ? '1px solid rgba(167,139,250,0.42)' : '1px solid rgba(124,58,237,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
            boxShadow: isDark ? '0 0 28px rgba(124,58,237,0.32)' : 'none',
          }}>
            🧠
          </div>
          <p className="text-[18px] font-bold mb-1.5" style={{ color: isDark ? '#e2e8f0' : '#1e1e2e' }}>
            Unlock AI Insights
          </p>
          <p className="text-[11.5px] leading-relaxed" style={{ color: isDark ? 'rgba(148,163,184,0.68)' : '#6b7280' }}>
            Get AI-powered analysis of your productivity patterns and personalized recommendations.
          </p>
        </div>

        <div className="relative z-10 px-6 py-2">
          {[
            'Daily performance analysis',
            'Productivity insights tailored to you',
            'Personalized recommendations',
            'Goal tracking & forecasting',
            'Weekly AI coaching summaries',
          ].map(feat => (
            <div key={feat} className="flex items-center gap-3 py-2">
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: '#fff', fontWeight: 800,
              }}>✓</div>
              <span className="text-[12px]" style={{ color: isDark ? 'rgba(203,213,225,0.88)' : '#374151' }}>
                {feat}
              </span>
            </div>
          ))}
        </div>

        <div className="relative z-10 px-6 pb-6 pt-4">
          <button
            className="w-full py-3.5 rounded-2xl text-[14px] font-bold tracking-wide transition-opacity hover:opacity-92"
            style={{
              background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 50%, #a855f7 100%)',
              color: '#ffffff',
              boxShadow: isDark ? '0 6px 24px rgba(124,58,237,0.50)' : '0 4px 14px rgba(124,58,237,0.32)',
              border: '0.5px solid rgba(167,139,250,0.30)',
            }}
          >
            Upgrade to Pro
          </button>
          <button
            onClick={onClose}
            className="w-full mt-2 py-2 text-[11px] transition-opacity hover:opacity-70"
            style={{ color: isDark ? 'rgba(148,163,184,0.50)' : '#9ca3af' }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}
