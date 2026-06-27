'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { MarketingPanel } from '@/components/auth/MarketingPanel'
import { AuthInput } from '@/components/auth/AuthInput'
import { GradientButton } from '@/components/auth/GradientButton'
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons'

const EmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
    <rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 7l-10 7L2 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
    <rect x="3" y="11" width="18" height="11" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      router.push('/app')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — could not reach authentication server.')
      setLoading(false)
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 lg:p-10"
      style={{ background: '#f7f6f4' }}
    >
      {/* Centered composed container */}
      <div
        className="w-full max-w-[1300px] flex overflow-hidden"
        style={{
          borderRadius: 32,
          boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)',
        }}
      >
        {/* Left marketing panel — has its own gradient */}
        <div
          className="flex-1"
          style={{ background: 'linear-gradient(140deg, #1e0548 0%, #3b1282 50%, #5421b0 100%)' }}
        >
          <MarketingPanel />
        </div>

        {/* Right auth panel */}
        <div
          className="flex-1 lg:flex-none lg:w-[560px] xl:w-[600px] flex items-center justify-center py-12 px-8 lg:px-12"
          style={{ background: '#f3effe' }}
        >
          <div
            className="w-full max-w-[420px]"
            style={{ animation: 'auth-fade-in 0.55s cubic-bezier(0.4,0,0.2,1) both' }}
          >
            {/* Logo */}
            <div className="flex justify-center mb-7">
              <XpaditeLogo variant="dark" size={38} />
            </div>

            {/* Heading */}
            <div className="text-center mb-7">
              <h1 className="text-[1.625rem] font-bold text-gray-900 leading-tight tracking-tight">
                Welcome back 👋
              </h1>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                Log in to continue your journey
              </p>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <AuthInput
                id="email" label="Email" type="email"
                value={email} onChange={setEmail}
                placeholder="you@example.com"
                icon={<EmailIcon />}
                autoComplete="email" required
              />

              <AuthInput
                id="password" label="Password" type="password"
                value={password} onChange={setPassword}
                placeholder="Enter your password"
                icon={<LockIcon />}
                autoComplete="current-password" required
              />

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded accent-violet-700 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600">Remember me</span>
                </label>
                <Link href="/forgot-password"
                  className="text-sm text-violet-700 hover:text-violet-900 font-medium transition-colors duration-150">
                  Forgot password?
                </Link>
              </div>

              <div className="pt-1">
                <GradientButton type="submit" loading={loading} disabled={loading}>
                  Sign in ↑
                </GradientButton>
              </div>
            </form>

            {/* Social */}
            <div className="mt-6">
              <SocialLoginButtons />
            </div>

            {/* Sign up link */}
            <p className="mt-6 text-center text-sm text-gray-500">
              Don&apos;t have an account?{' '}
              <Link href="/signup"
                className="text-violet-700 hover:text-violet-900 font-semibold transition-colors duration-150">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
