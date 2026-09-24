'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'

// ─── Update data ────────────────────────────────────────────────────────────
// Data-driven so future updates are just new entries here — no UI changes
// needed. Move an item from 'coming-soon' to 'new' once it ships; the two
// tabs below just filter this one array by status, they don't have separate
// hardcoded content.

interface WhatsNewUpdate {
  id: string
  title: string
  description: string
  icon: string
  status: 'new' | 'coming-soon'
  date?: string // optional future field (e.g. a version or ship date), unused for now
}

const WHATS_NEW_UPDATES: WhatsNewUpdate[] = [
  {
    id: 'xpadite-v2',
    title: 'XPadite V2',
    description: 'More powerful XPadite features and improvements are coming in V2.',
    icon: '🚀',
    status: 'coming-soon',
  },
  {
    id: 'mobile-apps',
    title: 'iOS & Android Apps',
    description: 'Native XPadite apps for iOS and Android are coming in the future.',
    icon: '📱',
    status: 'coming-soon',
  },
]

type Tab = 'new' | 'coming-soon'

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status, isDark }: { status: WhatsNewUpdate['status']; isDark: boolean }) {
  const isNew = status === 'new'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', flexShrink: 0,
      padding: '2.5px 9px', borderRadius: 20,
      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      background: isNew
        ? (isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.12)')
        : (isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)'),
      color: isNew
        ? (isDark ? '#c4b5fd' : '#7c3aed')
        : (isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)'),
      whiteSpace: 'nowrap',
    }}>
      {isNew ? 'New' : 'Coming Soon'}
    </span>
  )
}

// ─── Update card ──────────────────────────────────────────────────────────────

function UpdateCard({ update, isDark, index }: { update: WhatsNewUpdate; isDark: boolean; index: number }) {
  return (
    <div
      className="xp-wn-update-card"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 13,
        padding: '15px 16px', borderRadius: 16,
        background: isDark ? 'rgba(255,255,255,0.044)' : '#f8f7fc',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.085)' : 'rgba(0,0,0,0.075)'}`,
        animationDelay: `${index * 45}ms`,
      }}
    >
      <div
        className="xp-wn-icon-box"
        style={{
          width: 38, height: 38, borderRadius: 12, flexShrink: 0,
          background: isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
          animationDelay: `${index * 45 + 80}ms`,
        }}
      >
        {update.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.92)' : '#111827', lineHeight: 1.3 }}>
            {update.title}
          </span>
          <StatusPill status={update.status} isDark={isDark} />
        </div>
        <p style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.50)' : '#6b7280', lineHeight: 1.5, marginTop: 4 }}>
          {update.description}
        </p>
      </div>
    </div>
  )
}

// ─── Empty state (What's New tab, until real releases exist) ──────────────────

function EmptyState({ isDark }: { isDark: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '36px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: isDark ? 'rgba(124,58,237,0.14)' : 'rgba(124,58,237,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
      }}>
        ✨
      </div>
      <p style={{ fontSize: 12.5, color: isDark ? 'rgba(255,255,255,0.45)' : '#6b7280', lineHeight: 1.5, maxWidth: 220 }}>
        New XPadite updates will appear here.
      </p>
    </div>
  )
}

// ─── Segmented tabs ─────────────────────────────────────────────────────────

function TabBar({ tab, onChange, isDark }: { tab: Tab; onChange: (t: Tab) => void; isDark: boolean }) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    position: 'relative', zIndex: 1, flex: 1, padding: '8px 6px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 12.5, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap',
    color: active ? '#ffffff' : (isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)'),
  })
  return (
    <div style={{
      position: 'relative', display: 'flex', padding: 4, borderRadius: 12,
      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)',
    }}>
      <div
        className="xp-wn-tab-indicator"
        style={{
          position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
          borderRadius: 9, background: '#7c3aed',
          transform: tab === 'coming-soon' ? 'translateX(100%)' : 'translateX(0%)',
        }}
      />
      <button className="xp-wn-tab-btn" style={btnStyle(tab === 'new')} onClick={() => onChange('new')}>
        ✨ What&apos;s New
      </button>
      <button className="xp-wn-tab-btn" style={btnStyle(tab === 'coming-soon')} onClick={() => onChange('coming-soon')}>
        🚀 Coming Soon
      </button>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const { isDark } = useApp()
  useLockBodyScroll()

  const [tab, setTab] = useState<Tab>('new')
  const [closing, setClosing] = useState(false)

  function handleClose() {
    const prefersReduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) { onClose(); return }
    setClosing(true)
    setTimeout(onClose, 170)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const newItems        = WHATS_NEW_UPDATES.filter(u => u.status === 'new')
  const comingSoonItems = WHATS_NEW_UPDATES.filter(u => u.status === 'coming-soon')
  const activeItems     = tab === 'new' ? newItems : comingSoonItems

  const modalBg = isDark ? '#15102a' : '#f0ecff'

  return (
    <>
      <style>{`
        @keyframes xp-wn-backdrop-in  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes xp-wn-backdrop-out { from { opacity: 1 } to { opacity: 0 } }
        /* Quick, smooth deceleration with no overshoot — no bounce, no spring */
        @keyframes xp-wn-card-in  { from { opacity: 0; transform: scale(0.975) translateY(8px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes xp-wn-card-out { from { opacity: 1; transform: scale(1) translateY(0) } to { opacity: 0; transform: scale(0.975) translateY(6px) } }
        @keyframes xp-wn-tab-content-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes xp-wn-update-card-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes xp-wn-icon-in { from { opacity: 0.5; transform: scale(0.9) } to { opacity: 1; transform: scale(1) } }
        @keyframes xpWnHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-wn-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpWnHdrFlow 14s ease infinite;
        }
        .xp-wn-body::-webkit-scrollbar { width: 5px }
        .xp-wn-body::-webkit-scrollbar-track { background: transparent }
        .xp-wn-body::-webkit-scrollbar-thumb { background: rgba(124,58,237,0.38); border-radius: 10px }
        .xp-wn-body::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,0.58) }
        .xp-wn-body { scrollbar-width: thin; scrollbar-color: rgba(124,58,237,0.38) transparent }
        @media (max-width: 640px) {
          .xp-wn-modal { max-height: 100% !important; max-width: 100% !important; border-radius: 0 !important; height: 100%; }
        }
        .xp-wn-close:hover { background: rgba(255,255,255,0.22) !important }

        /* All motion is opt-in under prefers-reduced-motion: no-preference.
           With reduced motion on, elements simply render in their resting
           state and interactions apply instantly — no movement/scaling. */
        @media (prefers-reduced-motion: no-preference) {
          .xp-wn-backdrop { animation: xp-wn-backdrop-in 200ms ease forwards; }
          .xp-wn-backdrop.xp-wn-closing { animation: xp-wn-backdrop-out 170ms ease forwards; }
          .xp-wn-modal { animation: xp-wn-card-in 200ms cubic-bezier(0.16,1,0.3,1) forwards; }
          .xp-wn-closing .xp-wn-modal { animation: xp-wn-card-out 170ms ease-in forwards; }
          .xp-wn-tab-indicator { transition: transform 260ms cubic-bezier(0.4,0,0.2,1); }
          .xp-wn-tab-btn { transition: color 200ms ease; }
          .xp-wn-tab-content { animation: xp-wn-tab-content-in 220ms ease both; }
          .xp-wn-update-card { animation: xp-wn-update-card-in 260ms ease both; transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
          .xp-wn-icon-box { animation: xp-wn-icon-in 300ms cubic-bezier(0.34,1.2,0.64,1) both; }
        }
        @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
          .xp-wn-update-card:hover {
            transform: translateY(-2px);
            box-shadow: ${isDark ? '0 8px 24px rgba(0,0,0,0.35)' : '0 8px 20px rgba(124,58,237,0.14)'};
            border-color: rgba(124,58,237,0.35);
          }
        }
      `}</style>

      {/* Backdrop — stops above the fixed bottom nav on mobile, same as other XPadite modals */}
      <div
        className={`xp-wn-backdrop fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[60] flex items-stretch sm:items-center justify-center p-0 sm:p-4${closing ? ' xp-wn-closing' : ''}`}
        style={{
          background: isDark ? 'rgba(10,4,24,0.65)' : 'rgba(30,10,60,0.32)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={handleClose}
      >
        {/* Modal shell — fixed header + tabs, scrollable body */}
        <div
          className="w-full max-w-[520px] xp-wn-modal"
          style={{
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr',
            maxHeight: 'calc(85vh - 32px)',
            background: modalBg,
            border: `1px solid ${isDark ? 'rgba(124,58,237,0.36)' : 'rgba(124,58,237,0.18)'}`,
            borderRadius: 24,
            boxShadow: isDark
              ? '0 0 0 4px rgba(124,58,237,0.10), 0 32px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(124,58,237,0.18)'
              : '0 0 0 4px rgba(124,58,237,0.06), 0 24px 64px rgba(124,58,237,0.16), 0 6px 20px rgba(0,0,0,0.10)',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header — unchanged */}
          <div
            className="xp-wn-hdr"
            style={{
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
                fontSize: 20,
              }}>
                ✨
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                What&apos;s New
              </h2>
            </div>
            <button
              className="xp-wn-close"
              onClick={handleClose}
              aria-label="Close"
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

          {/* Tabs */}
          <div style={{ padding: '14px 20px 0' }}>
            <TabBar tab={tab} onChange={setTab} isDark={isDark} />
          </div>

          {/* Scrollable body — key={tab} replays the content fade/slide on switch */}
          <div
            className="xp-wn-body"
            style={{
              minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
              padding: '16px 20px 24px',
            }}
          >
            <div key={tab} className="xp-wn-tab-content">
              {activeItems.length === 0 ? (
                <EmptyState isDark={isDark} />
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeItems.map((u, i) => <UpdateCard key={u.id} update={u} isDark={isDark} index={i} />)}
                  </div>
                  {tab === 'coming-soon' && (
                    <p style={{ textAlign: 'center', fontSize: 11.5, color: isDark ? 'rgba(255,255,255,0.32)' : '#9ca3af', marginTop: 18 }}>
                      More updates are on the way.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
