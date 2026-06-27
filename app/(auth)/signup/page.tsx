'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { MarketingPanel } from '@/components/auth/MarketingPanel'
import { AuthInput } from '@/components/auth/AuthInput'
import { GradientButton } from '@/components/auth/GradientButton'
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons'

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
    <circle cx="12" cy="8" r="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

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

const containerStyle = {
  borderRadius: 32,
  boxShadow: '0 40px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)',
}

export default function SignUpPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()

    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    if (!agreeTerms) {
      setError('You must agree to the Terms and Conditions.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      setSuccess(true)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — could not reach authentication server.')
      setLoading(false)
    }
  }

  const pageStyle = {
    background: '#f7f6f4',
  }

  const containerShadow = {
    borderRadius: 32,
    boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)',
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 lg:p-10" style={pageStyle}>
        <div className="w-full max-w-[1300px] flex overflow-hidden" style={containerShadow}>
          <div className="flex-1" style={{ background: 'linear-gradient(140deg, #1e0548 0%, #3b1282 50%, #5421b0 100%)' }}>
            <MarketingPanel />
          </div>
          <div className="flex-1 lg:flex-none lg:w-[560px] xl:w-[600px] flex items-center justify-center py-12 px-8 lg:px-12"
            style={{ background: '#f3effe' }}>
            <div className="w-full max-w-[420px] text-center" style={{ animation: 'auth-fade-in 0.55s cubic-bezier(0.4,0,0.2,1) both' }}>
              <div className="flex justify-center mb-6">
                <XpaditeLogo variant="dark" size={38} />
              </div>
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Check your email</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                We sent a confirmation link to{' '}
                <span className="font-semibold text-gray-700">{email}</span>.
                <br />Click it to activate your account.
              </p>
              <div className="mt-8">
                <GradientButton>
                  <Link href="/login" className="w-full h-full flex items-center justify-center gap-1.5">
                    ← Back to sign in
                  </Link>
                </GradientButton>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 lg:p-10"
      style={pageStyle}
    >
      {/* Centered composed container */}
      <div className="w-full max-w-[1300px] flex overflow-hidden" style={containerShadow}>

        {/* Left marketing panel */}
        <div className="flex-1" style={{ background: 'linear-gradient(140deg, #1e0548 0%, #3b1282 50%, #5421b0 100%)' }}>
          <MarketingPanel />
        </div>

        {/* Right auth panel */}
        <div
          className="flex-1 lg:flex-none lg:w-[560px] xl:w-[600px] flex items-center justify-center py-10 px-8 lg:px-12"
          style={{ background: '#f3effe' }}
        >
          <div
            className="w-full max-w-[420px]"
            style={{ animation: 'auth-fade-in 0.55s cubic-bezier(0.4,0,0.2,1) both' }}
          >
            {/* Logo */}
            <div className="flex justify-center mb-6">
              <XpaditeLogo variant="dark" size={38} />
            </div>

            {/* Heading */}
            <div className="text-center mb-6">
              <h1 className="text-[1.625rem] font-bold text-gray-900 leading-tight tracking-tight">
                Create Your Account
              </h1>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                Start your productivity journey today.
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
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <AuthInput
                id="fullName" label="Name" type="text"
                value={fullName} onChange={setFullName}
                placeholder="Tony Nguyen"
                icon={<PersonIcon />}
                autoComplete="name" required
              />

              <AuthInput
                id="email" label="Email Address" type="email"
                value={email} onChange={setEmail}
                placeholder="Example@gmail.com"
                icon={<EmailIcon />}
                autoComplete="email" required
              />

              <AuthInput
                id="password" label="Password" type="password"
                value={password} onChange={setPassword}
                placeholder="••••••••"
                icon={<LockIcon />}
                autoComplete="new-password" required minLength={6}
              />

              <AuthInput
                id="confirmPassword" label="Confirm Password" type="password"
                value={confirmPassword} onChange={setConfirmPassword}
                placeholder="••••••••"
                icon={<LockIcon />}
                autoComplete="new-password" required
              />

              {/* Terms checkbox */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={e => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-violet-700 cursor-pointer flex-shrink-0"
                />
                <span className="text-sm text-gray-600">
                  I agree to{' '}
                  <Link href="/terms" className="text-violet-700 hover:text-violet-900 font-medium transition-colors duration-150">
                    Terms and condition
                  </Link>
                </span>
              </label>

              <div className="pt-1">
                <GradientButton type="submit" loading={loading} disabled={loading}>
                  Sign Up ↑
                </GradientButton>
              </div>
            </form>

            {/* Social */}
            <div className="mt-5">
              <SocialLoginButtons />
            </div>

            {/* Login link */}
            <p className="mt-5 text-center text-sm text-gray-500">
              Already have an Account?{' '}
              <Link href="/login"
                className="text-violet-700 hover:text-violet-900 font-semibold transition-colors duration-150">
                Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
