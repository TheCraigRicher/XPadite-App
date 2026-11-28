'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { COMING_SOON_ENTRIES, WHATS_NEW_ENTRIES, WHATS_NEW_LAST_UPDATED, formatLastUpdated } from './whatsNewData'
import type { ComingSoonEntry, WhatsNewEntry } from './whatsNewData'

// Content lives in whatsNewData.ts (one centralized file; newest entry first, numbered automatically).

type Tab = 'new' | 'coming-soon'

// ─── What's New row: number badge · bold title · description aligned with the title ──────────────────────────

function ReleaseRow({ entry, n, first, isDark }: { entry: WhatsNewEntry; n: number; first: boolean; isDark: boolean }) {
  return (
    <li data-testid="wn-entry" style={{
      display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', columnGap: 12, padding: '13px 0',
      borderTop: first ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(124,58,237,0.12)'}`,
    }}>
      <span data-testid="wn-number" aria-hidden="true" style={{
        width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isDark ? 'rgba(124,58,237,0.26)' : 'rgba(124,58,237,0.12)', color: isDark ? '#c4b5fd' : '#6d28d9', fontSize: 11.5, fontWeight: 700,
      }}>{n}</span>
      <div style={{ minWidth: 0 }}>
        <p data-testid="wn-title" style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, color: isDark ? 'rgba(255,255,255,0.92)' : '#2a1f4d', overflowWrap: 'anywhere' }}>{entry.title}</p>
        <p data-testid="wn-desc" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3, color: isDark ? 'rgba(255,255,255,0.58)' : '#5b5472', overflowWrap: 'anywhere' }}>{entry.description}</p>
      </div>
    </li>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" /><line x1="3.5" y1="10" x2="20.5" y2="10" /><line x1="3.5" y1="15" x2="20.5" y2="15" /><line x1="10" y1="10" x2="10" y2="20" />
    </svg>
  )
}

function ComingSoonCard({ entry, isDark }: { entry: ComingSoonEntry; isDark: boolean }) {
  return (
    <div data-testid="cs-entry" className="xp-wn-update-card" style={{
      display: 'flex', alignItems: 'flex-start', gap: 13, padding: '15px 16px', borderRadius: 16,
      background: isDark ? 'rgba(255,255,255,0.044)' : '#f8f7fc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.085)' : 'rgba(0,0,0,0.075)'}`,
    }}>
      <div className="xp-wn-icon-box" style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        background: isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.10)', color: isDark ? '#c4b5fd' : '#7c3aed',
      }}>{entry.icon === 'table' ? <FileIcon /> : entry.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, color: isDark ? 'rgba(255,255,255,0.92)' : '#2a1f4d', overflowWrap: 'anywhere' }}>{entry.title}</p>
        <p style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 4, color: isDark ? 'rgba(255,255,255,0.58)' : '#5b5472', overflowWrap: 'anywhere' }}>{entry.description}</p>
        {entry.note && <p data-testid="cs-note" style={{ fontSize: 11.5, fontWeight: 600, marginTop: 8, color: isDark ? '#c4b5fd' : '#7c3aed' }}>{entry.note}</p>}
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
            gridTemplateRows: 'auto auto minmax(0, 1fr)',
            height: 'min(720px, calc(100dvh - 32px))',
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
            {tab === 'new' && WHATS_NEW_ENTRIES.length > 0 && (
              <p data-testid="wn-updated" style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '13px 2px 0', paddingBottom: 11, fontSize: 12, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.6)' : '#6b6485', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(124,58,237,0.14)'}` }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><line x1="3.5" y1="10" x2="20.5" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>
                Last updated: {formatLastUpdated(WHATS_NEW_LAST_UPDATED)}
              </p>
            )}
          </div>

          {/* Scrollable body — key={tab} replays the content fade/slide on switch */}
          <div
            className="xp-wn-body"
            style={{
              minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
              padding: '6px 20px 24px',
            }}
          >
            <div key={tab} className="xp-wn-tab-content">
              {tab === 'new' ? (
                WHATS_NEW_ENTRIES.length === 0 ? <EmptyState isDark={isDark} /> : (
                  <ol data-testid="wn-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {WHATS_NEW_ENTRIES.map((e, i) => <ReleaseRow key={e.id} entry={e} n={i + 1} first={i === 0} isDark={isDark} />)}
                  </ol>
                )
              ) : COMING_SOON_ENTRIES.length === 0 ? <EmptyState isDark={isDark} /> : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
                    {COMING_SOON_ENTRIES.map(e => <ComingSoonCard key={e.id} entry={e} isDark={isDark} />)}
                  </div>
                  <p style={{ textAlign: 'center', fontSize: 11.5, color: isDark ? 'rgba(255,255,255,0.32)' : '#9ca3af', marginTop: 18 }}>
                    More updates are on the way.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
