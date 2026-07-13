'use client'

import React from 'react'

export type MobileTab = 'overview' | 'tasks' | 'analytics' | 'ai-coach' | 'more'

// ─── Icons ────────────────────────────────────────────────────────────────────

const OverviewIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} style={{ width: 20, height: 20 }}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
)

const TasksIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} style={{ width: 20, height: 20 }}>
    <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const AnalyticsIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} style={{ width: 20, height: 20 }}>
    <line x1="18" y1="20" x2="18" y2="10" strokeLinecap="round" />
    <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" />
    <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" />
    <line x1="2" y1="20" x2="22" y2="20" strokeLinecap="round" />
  </svg>
)

const AICoachIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} style={{ width: 20, height: 20 }}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
  </svg>
)

const MoreIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
    <circle cx="12" cy="12" r="1.5" fill={active ? '#a78bfa' : 'rgba(255,255,255,0.40)'} />
    <circle cx="6"  cy="12" r="1.5" fill={active ? '#a78bfa' : 'rgba(255,255,255,0.40)'} />
    <circle cx="18" cy="12" r="1.5" fill={active ? '#a78bfa' : 'rgba(255,255,255,0.40)'} />
  </svg>
)

type NavIcon = React.FC<{ active: boolean }>

const NAV_ITEMS: { tab: MobileTab; label: string; Icon: NavIcon }[] = [
  { tab: 'overview',  label: 'Overview',  Icon: OverviewIcon  },
  { tab: 'tasks',     label: 'Tasks',     Icon: TasksIcon     },
  { tab: 'analytics', label: 'Analytics', Icon: AnalyticsIcon },
  { tab: 'ai-coach',  label: 'AI Coach',  Icon: AICoachIcon   },
  { tab: 'more',      label: 'More',      Icon: MoreIcon      },
]

// ─── Component ────────────────────────────────────────────────────────────────

interface MobileBottomNavProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
}

export function MobileBottomNav({ activeTab, onTabChange }: MobileBottomNavProps) {
  return (
    /*
     * xp-mobile-nav: defined in globals.css as display:flex / @media sm+ display:none
     * sm:hidden: Tailwind backup for same breakpoint
     * Both ensure this never shows on desktop.
     */
    <nav
      className="xp-mobile-nav sm:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'stretch',
        background: '#0a0a12',
        borderTop: '0.5px solid rgba(255,255,255,0.10)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.35)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {NAV_ITEMS.map(({ tab, label, Icon }) => {
        const active = activeTab === tab
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingTop: 10,
              paddingBottom: 10,
              minHeight: 56,
              color: active ? '#a78bfa' : 'rgba(255,255,255,0.40)',
              background: 'transparent',
              borderTop: active ? '2px solid #a78bfa' : '2px solid transparent',
              borderRight: 'none',
              borderBottom: 'none',
              borderLeft: 'none',
              cursor: 'pointer',
              transition: 'color 150ms ease, border-color 200ms ease',
            }}
          >
            <Icon active={active} />
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 700 : 500,
                letterSpacing: active ? '0.02em' : 0,
                lineHeight: 1,
              }}
            >
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
