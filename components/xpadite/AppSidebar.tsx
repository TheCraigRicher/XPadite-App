'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from './AppContext'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@/lib/supabase/client'
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
  | 'tasks'
  | 'analytics'
  | 'activities'
  | 'sync-calendar'
  | 'ai-coach'
  | 'meetings'
  | 'gallery'
  | 'settings'
  | 'motivate'
  | 'qotd'
  | 'journal-notes'
  | 'notifications'
  | 'tutorials'
  | 'help'

interface MenuItem {
  icon: string
  label: string
  action: MenuAction
  dividerBefore?: boolean
  href?: string
}

const MENU_ITEMS: MenuItem[] = [
  { icon: '👤', label: 'Profile',               action: 'profile'                                                                    },
  { icon: '✅', label: 'Task Manager',          action: 'tasks'                                                                      },
  { icon: '📊', label: 'Analytics',             action: 'analytics',     dividerBefore: true                                         },
  { icon: '🎯', label: 'Activity Manager',       action: 'activities'                                                                 },
  { icon: '📅', label: 'Sync Google Calendar',  action: 'sync-calendar', dividerBefore: true                                         },
  { icon: '🤖', label: 'XPadite AI Coach',      action: 'ai-coach'                                                                   },
  { icon: '👥', label: 'Meetings',              action: 'meetings'                                                                   },
  { icon: '🖼️', label: 'Gallery',              action: 'gallery'                                                                     },
  { icon: '🔥', label: 'Motivate Me',           action: 'motivate',      dividerBefore: true                                         },
  { icon: '💬', label: 'Quote of the Day | QOTD', action: 'qotd'                                                                     },
  { icon: '📝', label: 'Planner/Journal',        action: 'journal-notes'                                                              },
  { icon: '🔔', label: 'Notifications',         action: 'notifications'                                                              },
  { icon: '🎓', label: 'XPadite Tutorials',     action: 'tutorials',     dividerBefore: true, href: 'https://www.youtube.com/@Xpadite' },
  { icon: '⚙️', label: 'Settings',             action: 'settings'                                                                    },
  { icon: '❓', label: 'Help & Feedback',       action: 'help'                                                                       },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  onGallery?: () => void
  onSettings?: () => void
  onAnalytics?: () => void
  onMotivate?: () => void
  onQotd?: () => void
  onProfile?: () => void
  onActivities?: () => void
  onAICoach?: () => void
  onJournalNotes?: () => void
  onNotifications?: () => void
  onTasks?: () => void
}

export function AppSidebar({
  onGallery,
  onSettings,
  onAnalytics,
  onMotivate,
  onQotd,
  onProfile,
  onActivities,
  onAICoach,
  onJournalNotes,
  onNotifications,
  onTasks,
}: AppSidebarProps) {
  const { sidebarOpen, setSidebarOpen } = useApp()
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarInitial, setAvatarInitial] = useState('')
  const [loadingMotivate, setLoadingMotivate] = useState(false)

  const loadAvatar = useCallback(async () => {
    try {
      const raw = localStorage.getItem('xp9-profile')

      if (raw) {
        // localStorage present — derive initial + resolve any storage path
        let parsed: { firstName?: string; displayName?: string; avatarUrl?: string } = {}
        try { parsed = JSON.parse(raw) } catch {}
        const initial = (parsed.firstName || parsed.displayName || '').charAt(0).toUpperCase()
        setAvatarInitial(initial)
        const path: string = parsed.avatarUrl || ''
        if (!path) { setAvatarUrl(''); return }
        if (path.startsWith('data:')) { setAvatarUrl(path); return }
        const sb = createClient()
        const { data: signed, error } = await sb.storage.from('avatars').createSignedUrl(path, 3600)
        if (error) { console.error('Sidebar avatar error:', error); setAvatarUrl(''); return }
        setAvatarUrl(signed?.signedUrl ?? '')
      } else {
        // No cached profile — bootstrap directly from Supabase on auth init
        const sb = createClient()
        const { data: authData } = await sb.auth.getUser()
        if (!authData.user) { setAvatarUrl(''); setAvatarInitial(''); return }

        const { data: profile } = await sb
          .from('profiles')
          .select('full_name, avatar_url')
          .eq('id', authData.user.id)
          .single()

        const row = profile as { full_name?: string; avatar_url?: string } | null
        const fullName = row?.full_name ?? ''
        const avatarPath = row?.avatar_url ?? ''

        const spaceIdx = fullName.indexOf(' ')
        const firstName = fullName ? (spaceIdx === -1 ? fullName : fullName.slice(0, spaceIdx)) : ''
        const lastName  = spaceIdx === -1 ? '' : fullName.slice(spaceIdx + 1)

        // Fallback priority: first name → email initial
        const email = authData.user.email ?? ''
        const initial = (firstName || email).charAt(0).toUpperCase()
        setAvatarInitial(initial)

        // Seed localStorage so ProfileModal finds consistent data without another Supabase call
        if (fullName || avatarPath) {
          try {
            localStorage.setItem('xp9-profile', JSON.stringify({
              firstName,
              lastName,
              displayName: firstName,
              avatarUrl: avatarPath,
            }))
          } catch {}
        }

        if (!avatarPath) { setAvatarUrl(''); return }
        if (avatarPath.startsWith('data:')) { setAvatarUrl(avatarPath); return }

        const { data: signed, error } = await sb.storage.from('avatars').createSignedUrl(avatarPath, 3600)
        if (error) { console.error('Sidebar avatar error:', error); setAvatarUrl(''); return }
        setAvatarUrl(signed?.signedUrl ?? '')
      }
    } catch {
      setAvatarUrl('')
      setAvatarInitial('')
    }
  }, [])

  // Reload signed URL whenever sidebar opens
  useEffect(() => { loadAvatar() }, [sidebarOpen, loadAvatar])

  // Reload signed URL when ProfileModal saves/removes an avatar
  useEffect(() => {
    window.addEventListener('xp9-avatar-changed', loadAvatar)
    return () => window.removeEventListener('xp9-avatar-changed', loadAvatar)
  }, [loadAvatar])

  /*
   * Robust mobile scroll lock: saves window.scrollY before locking, then
   * applies position:fixed + top:-scrollY so the page is visually frozen
   * at exactly the right position. On close, restores all styles and
   * scrolls back to the saved offset — no jump, no shift.
   *
   * overflow:hidden alone does NOT work on iOS/Android mobile browsers;
   * the fixed-position trick is the standard cross-browser solution.
   */
  useEffect(() => {
    if (!sidebarOpen) return

    const scrollY    = window.scrollY
    const prevOv     = document.body.style.overflow
    const prevPos    = document.body.style.position
    const prevTop    = document.body.style.top
    const prevWidth  = document.body.style.width

    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top      = `-${scrollY}px`
    document.body.style.width    = '100%'

    return () => {
      document.body.style.overflow = prevOv
      document.body.style.position = prevPos
      document.body.style.top      = prevTop
      document.body.style.width    = prevWidth
      window.scrollTo(0, scrollY)
    }
  }, [sidebarOpen])

  async function handleSignOut() {
    setSidebarOpen(false)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    // Wipe all user-owned localStorage so the next account that logs in on
    // this device never inherits the previous user's tasks, sessions, or preferences.
    const USER_LS_KEYS = [
      'xp9d', 'xp9s', 'xp9a', 'xp9r', 'xp9g',
      'xp9-active-session', 'xp9-active-task-timer',
      'xp9-task-clipboard', 'xp9-profile', 'xp9-aic',
      'xp9-journal', 'xp9-notifications', 'xp9_connections',
      'xp-theme', 'xp-progress-color',
    ]
    try { USER_LS_KEYS.forEach(k => localStorage.removeItem(k)) } catch {}
    router.push('/login')
  }

  function handleAction(action: MenuAction) {
    if (action === 'motivate') {
      setLoadingMotivate(true)
      setTimeout(() => setLoadingMotivate(false), 350)
    }
    setSidebarOpen(false)
    switch (action) {
      case 'profile':        onProfile?.(); break
      case 'tasks':          onTasks?.(); break
      case 'analytics':      onAnalytics?.(); break
      case 'activities':     onActivities?.(); break
      case 'gallery':        onGallery?.(); break
      case 'settings':       onSettings?.(); break
      case 'motivate':       onMotivate?.(); break
      case 'qotd':           onQotd?.(); break
      case 'ai-coach':       onAICoach?.(); break
      case 'journal-notes':  onJournalNotes?.(); break
      case 'notifications':  onNotifications?.(); break
      // Stubs — close sidebar only
      case 'sync-calendar':
      case 'meetings':
      case 'tutorials':
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
        className="fixed top-0 left-0 bottom-14 sm:bottom-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-out"
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

        {/* Nav items — Sign Out is the final normal scrollable item */}
        <nav className="flex-1 py-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          {MENU_ITEMS.map(item => (
            <div key={item.label}>
              {item.dividerBefore && (
                <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
              )}
              {item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSidebarOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-150 hover:bg-white/7"
                  style={{ color: '#cbd5e1', textDecoration: 'none', display: 'flex' }}
                >
                  <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                  {item.label}
                </a>
              ) : (
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
                  ) : item.action === 'profile' && avatarInitial ? (
                    <span
                      className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold"
                      style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', fontSize: 9 }}
                    >
                      {avatarInitial}
                    </span>
                  ) : (
                    <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                  )}
                  {item.label}
                </button>
              )}
            </div>
          ))}

          {/* Sign Out — last item in the normal scroll flow, NOT pinned/fixed */}
          <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-150 hover:bg-red-500/10"
            style={{ color: '#f87171' }}
          >
            <span className="flex-shrink-0"><LogoutIcon /></span>
            Sign Out
          </button>

          {/* Bottom padding so Sign Out clears the fixed bottom nav on mobile */}
          <div className="h-4" />
        </nav>
      </div>
    </>
  )
}
