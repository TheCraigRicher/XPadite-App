'use client'

import { useState, useEffect } from 'react'
import { useApp } from './AppContext'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
    <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
  </svg>
)

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
  </svg>
)

// ─── Menu structure ───────────────────────────────────────────────────────────

type MenuAction =
  | 'profile'
  | 'analytics'
  | 'activities'
  | 'sync-calendar'
  | 'ai-coach'
  | 'meetings'
  | 'gallery'
  | 'settings'
  | 'motivate'
  | 'journal-notes'
  | 'notifications'
  | 'help'

interface MenuItem {
  icon: string
  label: string
  action: MenuAction
  dividerBefore?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  { icon: '👤', label: 'Profile',               action: 'profile'          },
  { icon: '📊', label: 'Analytics',             action: 'analytics',        dividerBefore: true },
  { icon: '🎯', label: 'Activities',            action: 'activities'        },
  { icon: '📅', label: 'Sync Google Calendar',  action: 'sync-calendar',    dividerBefore: true },
  { icon: '🤖', label: 'XPadite AI Coach',      action: 'ai-coach'          },
  { icon: '👥', label: 'Meetings',              action: 'meetings'          },
  { icon: '🖼️', label: 'Gallery',              action: 'gallery'            },
  { icon: '⚙️', label: 'Settings',             action: 'settings'           },
  { icon: '🔥', label: 'Motivate Me',           action: 'motivate',          dividerBefore: true },
  { icon: '📝', label: 'Journal Notes',         action: 'journal-notes'     },
  { icon: '🔔', label: 'Notifications',         action: 'notifications'     },
  { icon: '❓', label: 'Help & Feedback',       action: 'help',              dividerBefore: true },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  onGallery?: () => void
  onSettings?: () => void
  onAnalytics?: () => void
  onMotivate?: () => void
  onProfile?: () => void
  onActivities?: () => void
  onAICoach?: () => void
  onJournalNotes?: () => void
  onNotifications?: () => void
}

export function AppSidebar({
  onGallery,
  onSettings,
  onAnalytics,
  onMotivate,
  onProfile,
  onActivities,
  onAICoach,
  onJournalNotes,
  onNotifications,
}: AppSidebarProps) {
  const { sidebarOpen, setSidebarOpen } = useApp()
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('xp9-profile')
      if (raw) setAvatarUrl(JSON.parse(raw).avatarUrl || '')
    } catch {}
  }, [sidebarOpen])

  async function handleSignOut() {
    setSidebarOpen(false)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleAction(action: MenuAction) {
    setSidebarOpen(false)
    switch (action) {
      case 'profile':        onProfile?.(); break
      case 'analytics':      onAnalytics?.(); break
      case 'activities':     onActivities?.(); break
      case 'gallery':        onGallery?.(); break
      case 'settings':       onSettings?.(); break
      case 'motivate':       onMotivate?.(); break
      case 'ai-coach':       onAICoach?.(); break
      case 'journal-notes':  onJournalNotes?.(); break
      case 'notifications':  onNotifications?.(); break
      // Stubs — close sidebar only
      case 'sync-calendar':
      case 'meetings':
      case 'help':
      default: break
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 left-0 bottom-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-out"
        style={{
          background: '#0f172a',
          borderRight: '0.5px solid rgba(255,255,255,0.08)',
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-3.5 flex-shrink-0"
          style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
        >
          <XpaditeLogo variant="light" size={24} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: '#94a3b8' }}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-1 overflow-y-auto">
          {MENU_ITEMS.map(item => (
            <div key={item.label}>
              {item.dividerBefore && (
                <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
              )}
              <button
                onClick={() => handleAction(item.action)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-150 hover:bg-white/7"
                style={{ color: '#cbd5e1' }}
              >
                {item.action === 'profile' && avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                )}
                {item.label}
              </button>
            </div>
          ))}
        </nav>

        {/* Sign out at the very bottom */}
        <div
          className="flex-shrink-0 p-3"
          style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}
        >
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-left transition-colors duration-150 hover:bg-red-500/10"
            style={{ color: '#f87171' }}
          >
            <LogoutIcon />
            Sign Out
          </button>
        </div>
      </div>
    </>
  )
}
