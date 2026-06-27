'use client'

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

const MENU_ITEMS = [
  { icon: '📊', label: 'Analytics' },
  { icon: '📅', label: 'Sync Google Calendar' },
  { icon: '🎯', label: 'Goal Setting with AI' },
  { icon: '👥', label: 'Meetings' },
  { icon: '🔔', label: 'Reminders' },
  { icon: '🖼️', label: 'Gallery' },
  { icon: '⚙️', label: 'Settings' },
  { icon: '❓', label: 'Help & Feedback' },
]

export function AppSidebar() {
  const { sidebarOpen, setSidebarOpen } = useApp()
  const router = useRouter()

  async function handleSignOut() {
    setSidebarOpen(false)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    router.push('/login')
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
        className="fixed top-0 left-0 bottom-0 z-50 w-60 flex flex-col transition-transform duration-300 ease-out"
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
            <button
              key={item.label}
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-150 hover:bg-white/7"
              style={{
                color: '#cbd5e1',
                borderBottom: '0.5px solid rgba(255,255,255,0.04)',
              }}
            >
              <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
              {item.label}
            </button>
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
