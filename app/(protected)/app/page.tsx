import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

interface StatCardProps {
  label: string
  value: string
  sub: string
  icon: string
}

function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 p-6 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <span className="text-2xl leading-none">{icon}</span>
      </div>
      <div>
        <p className="text-3xl font-black text-gray-900 tracking-tight">{value}</p>
        <p className="text-xs text-gray-400 mt-1">{sub}</p>
      </div>
    </div>
  )
}

export default async function AppPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const firstName = user.user_metadata?.full_name?.split(' ')[0] ?? user.email?.split('@')[0] ?? 'there'

  return (
    <div className="min-h-screen" style={{ background: '#f7f6f4' }}>

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <XpaditeLogo variant="dark" size={28} />
          <div className="flex items-center gap-5">
            <span className="hidden sm:block text-sm text-gray-400">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors duration-150"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-12">

        {/* Welcome */}
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Welcome back, {firstName} 👋
          </h1>
          <p className="text-sm text-gray-400 mt-1">Here's a snapshot of your productivity journey.</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <StatCard label="Productive Days" value="—" sub="Start logging to track" icon="📅" />
          <StatCard label="Current Streak" value="—" sub="Keep showing up daily" icon="🔥" />
          <StatCard label="Progress This Month" value="—" sub="Activities tracked: 0" icon="📈" />
        </div>

        {/* Coming soon */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-10 text-center">
          <p className="text-3xl mb-4">🚀</p>
          <h2 className="text-base font-semibold text-gray-800 mb-1">Your dashboard is being built</h2>
          <p className="text-sm text-gray-400 max-w-xs mx-auto leading-relaxed">
            Calendar, timers, AI planning, and milestone tracking — coming soon.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-50 border border-violet-100 text-violet-600 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            Early access — you&apos;re in
          </div>
        </div>
      </main>
    </div>
  )
}
