'use client'

import { useEffect } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'

// ── Connection architecture ───────────────────────────────────────────────────
// UI + state contract only. No OAuth or backend lives here. A future integration
// layer supplies `connections` and handles `onConnect` / `onManage`:
//   disconnected → connect → (provider consent) → connecting → connected | error
// Google Calendar and Google Drive stay separate cards (different scopes) but share
// `provider: 'google'`, so one Google account (`accountEmail`) can back both.
// Calendar integrations are data sources for the Meetings feature, not Meetings itself.

export type IntegrationId = 'google-calendar' | 'google-drive' | 'outlook-calendar'
export type IntegrationProvider = 'google' | 'microsoft'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface IntegrationConnection {
  status: ConnectionStatus
  accountEmail?: string
  lastSyncedAt?: number
  errorMessage?: string
}

export type IntegrationConnections = Partial<Record<IntegrationId, IntegrationConnection>>

interface IntegrationConfig {
  id: IntegrationId
  provider: IntegrationProvider
  name: string
  description: string
  capabilities: string[]
  Logo: () => React.JSX.Element
}

// ── Service logos ─────────────────────────────────────────────────────────────

const GoogleCalendarLogo = () => (
  <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
    <rect x="6" y="6" width="36" height="36" rx="5" fill="#ffffff" />
    <path d="M11 6h26a5 5 0 0 1 5 5v5H6v-5a5 5 0 0 1 5-5z" fill="#4285f4" />
    <path d="M6 32h6v10H11a5 5 0 0 1-5-5z" fill="#34a853" />
    <path d="M36 42V32h6v5a5 5 0 0 1-5 5z" fill="#ea4335" />
    <path d="M36 32h6v-9h-6z" fill="#fbbc04" />
    <text x="24" y="34" textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="Arial, sans-serif" fill="#4285f4">31</text>
  </svg>
)

const GoogleDriveLogo = () => (
  <svg viewBox="0 0 87.3 78" width="40" height="36" aria-hidden="true">
    <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
    <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47" />
    <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
    <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
    <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
    <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
  </svg>
)

const OutlookLogo = () => (
  <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
    <rect x="16" y="8" width="28" height="32" rx="4" fill="#28a8ea" />
    <rect x="16" y="8" width="28" height="12" rx="4" fill="#50d9ff" />
    <rect x="4" y="12" width="26" height="26" rx="4" fill="#0364b8" />
    <ellipse cx="17" cy="25" rx="6.5" ry="7.5" fill="none" stroke="#ffffff" strokeWidth="3.4" />
  </svg>
)

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'google-calendar',
    provider: 'google',
    name: 'Google Calendar',
    description: 'Sync your calendar events and meetings with XPadite.',
    capabilities: ['Calendar events', 'Meetings', 'Reminders (where applicable)'],
    Logo: GoogleCalendarLogo,
  },
  {
    id: 'google-drive',
    provider: 'google',
    name: 'Google Drive',
    description: 'Work with your Google Drive files from XPadite.',
    capabilities: ['Access and attach supported Drive files', 'Save supported XPadite content to Drive (where applicable)'],
    Logo: GoogleDriveLogo,
  },
  {
    id: 'outlook-calendar',
    provider: 'microsoft',
    name: 'Outlook Calendar',
    description: 'Sync your Outlook events and meetings with XPadite.',
    capabilities: ['Calendar events', 'Meetings', 'Reminders (where applicable)'],
    Logo: OutlookLogo,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSynced(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

const DEFAULT_CONNECTION: IntegrationConnection = { status: 'disconnected' }

function StatusPill({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; color: string; bg: string; border: string }> = {
    disconnected: { label: 'Not connected',     color: 'var(--xp-txt3)', bg: 'var(--xp-bg3)',           border: 'var(--xp-bdr)' },
    connecting:   { label: 'Connecting…',       color: '#7c3aed',        bg: 'rgba(124,58,237,0.10)',   border: 'rgba(124,58,237,0.28)' },
    connected:    { label: 'Connected',         color: '#16a34a',        bg: 'rgba(22,163,74,0.12)',    border: 'rgba(22,163,74,0.30)' },
    error:        { label: 'Connection failed', color: '#dc2626',        bg: 'rgba(220,38,38,0.10)',    border: 'rgba(220,38,38,0.28)' },
  }
  const s = map[status]
  return (
    <span
      className="inline-flex items-center gap-1 flex-shrink-0 whitespace-nowrap"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        border: `0.5px solid ${s.border}`,
        borderRadius: 999,
        padding: '3px 9px',
      }}
    >
      {status === 'connected' && <span aria-hidden="true">✓</span>}
      {status === 'connecting' && (
        <span
          aria-hidden="true"
          className="animate-spin"
          style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid currentColor', borderTopColor: 'transparent', display: 'inline-block' }}
        />
      )}
      {s.label}
    </span>
  )
}

// ── Integration card ──────────────────────────────────────────────────────────

function IntegrationCard({
  config,
  connection,
  onConnect,
  onManage,
}: {
  config: IntegrationConfig
  connection: IntegrationConnection
  onConnect: () => void
  onManage: () => void
}) {
  const { status } = connection
  const { Logo } = config

  const detail =
    status === 'connected'
      ? [
          connection.accountEmail ? `Connected as ${connection.accountEmail}` : null,
          connection.lastSyncedAt ? `Last synced ${fmtSynced(connection.lastSyncedAt)}` : null,
        ].filter(Boolean).join(' · ')
      : status === 'error'
        ? connection.errorMessage ?? 'Something went wrong. Please try again.'
        : ''

  const primary = status === 'connected'
    ? { label: 'Manage', onClick: onManage, filled: false }
    : { label: status === 'error' ? 'Try again' : status === 'connecting' ? 'Connecting…' : 'Connect', onClick: onConnect, filled: true }

  return (
    <div
      style={{
        background: 'var(--xp-bg3)',
        border: '0.5px solid var(--xp-bdr2)',
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44 }}>
          <Logo />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--xp-txt)' }}>
              {config.name}
            </h3>
            <StatusPill status={status} />
          </div>
          <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--xp-txt2)' }}>
            {config.description}
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5" style={{ paddingLeft: 56 }}>
        {config.capabilities.map(cap => (
          <li key={cap} className="flex items-start gap-2 text-[12px] leading-snug" style={{ color: 'var(--xp-txt2)' }}>
            <span
              aria-hidden="true"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 14, height: 14, marginTop: 1, borderRadius: '50%', background: 'rgba(124,58,237,0.16)', color: '#7c3aed', fontSize: 9, fontWeight: 700 }}
            >
              ✓
            </span>
            {cap}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3" style={{ paddingLeft: 56 }}>
        <p
          className="text-[11px] leading-snug min-w-0"
          style={{ color: status === 'error' ? '#dc2626' : 'var(--xp-txt3)' }}
        >
          {detail}
        </p>
        <button
          onClick={primary.onClick}
          disabled={status === 'connecting'}
          className="flex-shrink-0 text-[12px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-60 disabled:cursor-default"
          style={{
            padding: '7px 16px',
            borderRadius: 9,
            cursor: 'pointer',
            background: primary.filled ? '#7c3aed' : 'transparent',
            color: primary.filled ? '#ffffff' : 'var(--xp-txt)',
            border: primary.filled ? '0.5px solid #7c3aed' : '0.5px solid var(--xp-bdr2)',
            marginLeft: 'auto',
          }}
        >
          {primary.label}
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface SyncModalProps {
  onClose: () => void
  connections?: IntegrationConnections
  onConnect?: (id: IntegrationId) => void
  onManage?: (id: IntegrationId) => void
}

export function SyncModal({ onClose, connections = {}, onConnect, onManage }: SyncModalProps) {
  const { setToast } = useApp()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useLockBodyScroll()

  function handleConnect(config: IntegrationConfig) {
    if (onConnect) { onConnect(config.id); return }
    setToast(`${config.name} connection is coming soon`)
  }

  function handleManage(config: IntegrationConfig) {
    onManage?.(config.id)
  }

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes xpSyncHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-sync-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpSyncHdrFlow 14s ease infinite;
        }
        @keyframes xp-sync-orbit-a { from { transform: rotate(-110deg); } to { transform: rotate(0deg); } }
        @keyframes xp-sync-orbit-b { from { transform: rotate(-80deg); }  to { transform: rotate(0deg); } }
        .xp-sync-arrow-a, .xp-sync-arrow-b { transform-origin: 12px 12px; transform-box: view-box; }
        .xp-sync-arrow-a { animation: xp-sync-orbit-a 1000ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
        .xp-sync-arrow-b { animation: xp-sync-orbit-b 1000ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .xp-sync-arrow-a, .xp-sync-arrow-b { animation: none; }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xp-sync-title"
        className="w-full sm:max-w-[560px] h-full sm:h-auto sm:max-h-[86vh] rounded-none sm:rounded-2xl max-sm:border-0! overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed, animated premium purple (same treatment as Settings) */}
        <div
          className="xp-sync-hdr"
          style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '0.5px solid rgba(255,255,255,0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.18)',
              border: '1.5px solid rgba(255,255,255,0.32)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.20)',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" aria-hidden="true" style={{ width: 18, height: 18, overflow: 'visible' }}>
                <g className="xp-sync-arrow-a">
                  <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="3 21 3 16 8 16" strokeLinecap="round" strokeLinejoin="round" />
                </g>
                <g className="xp-sync-arrow-b">
                  <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="21 3 21 8 16 8" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </svg>
            </div>
            <h2 id="xp-sync-title" style={{ fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Sync
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.13)',
              color: 'rgba(255,255,255,0.82)',
              border: '1px solid rgba(255,255,255,0.22)',
              cursor: 'pointer',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body — scrolls internally */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3" style={{ overscrollBehavior: 'contain' }}>
          <p className="text-[12px] leading-snug px-1 pt-4 sm:text-center" style={{ color: 'var(--xp-txt2)' }}>
            Connect your favorite apps to keep everything in sync and supercharge your productivity.
          </p>

          {INTEGRATIONS.map(config => (
            <IntegrationCard
              key={config.id}
              config={config}
              connection={connections[config.id] ?? DEFAULT_CONNECTION}
              onConnect={() => handleConnect(config)}
              onManage={() => handleManage(config)}
            />
          ))}

          <p className="text-[11px] leading-snug px-1 pt-1" style={{ color: 'var(--xp-txt3)' }}>
            Your data stays private and secure. XPadite only accesses the information needed to provide these features.
          </p>
        </div>
      </div>
    </div>
  )
}
