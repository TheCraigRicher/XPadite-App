'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'

interface ProfileData {
  firstName: string
  lastName: string
  displayName: string
  avatarUrl: string
}

function loadProfile(): ProfileData {
  if (typeof window === 'undefined') return { firstName: '', lastName: '', displayName: '', avatarUrl: '' }
  try {
    const raw = localStorage.getItem('xp9-profile')
    if (raw) return { firstName: '', lastName: '', displayName: '', avatarUrl: '', ...JSON.parse(raw) }
  } catch {}
  return { firstName: '', lastName: '', displayName: '', avatarUrl: '' }
}

function saveProfile(data: ProfileData) {
  if (typeof window === 'undefined') return
  localStorage.setItem('xp9-profile', JSON.stringify(data))
}

interface ProfileModalProps {
  onClose: () => void
}

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { userEmail, isDark } = useApp()
  const [data, setData] = useState<ProfileData>(loadProfile)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSave() {
    saveProfile(data)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      setData(d => ({ ...d, avatarUrl: url }))
    }
    reader.readAsDataURL(file)
  }

  const displayInitial = (data.firstName || data.displayName || userEmail || 'U').charAt(0).toUpperCase()

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 10,
    border: '0.5px solid var(--xp-bdr2)',
    background: 'var(--xp-bg3)',
    color: 'var(--xp-txt)',
    fontSize: 13,
    outline: 'none',
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[400px] sm:rounded-2xl rounded-t-2xl overflow-hidden"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{
            background: isDark
              ? 'linear-gradient(135deg, #0a0a1a 0%, #1a0a30 100%)'
              : 'linear-gradient(135deg, #f3f0ff 0%, #ede9fe 100%)',
            borderBottom: '0.5px solid var(--xp-bdr)',
          }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--xp-txt)' }}>Profile</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Manage your account details</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer"
              style={{
                background: data.avatarUrl ? 'transparent' : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                border: '2px solid rgba(124,58,237,0.3)',
                overflow: 'hidden',
              }}
              onClick={() => fileRef.current?.click()}
            >
              {data.avatarUrl ? (
                <img src={data.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-white">{displayInitial}</span>
              )}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              >
                <span className="text-white text-xs font-medium">Edit</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-75"
                style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '0.5px solid rgba(124,58,237,0.25)' }}
              >
                Upload Photo
              </button>
              {data.avatarUrl && (
                <button
                  onClick={() => setData(d => ({ ...d, avatarUrl: '' }))}
                  className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-75"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.2)' }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Email</label>
            <div style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }}>{userEmail || '—'}</div>
          </div>

          {/* First Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>First Name</label>
              <input
                type="text"
                value={data.firstName}
                onChange={e => setData(d => ({ ...d, firstName: e.target.value }))}
                placeholder="First name"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Last Name</label>
              <input
                type="text"
                value={data.lastName}
                onChange={e => setData(d => ({ ...d, lastName: e.target.value }))}
                placeholder="Last name"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Display Name</label>
            <input
              type="text"
              value={data.displayName}
              onChange={e => setData(d => ({ ...d, displayName: e.target.value }))}
              placeholder="How you'd like to be addressed"
              style={inputStyle}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--xp-txt3)' }}>
              Used in reminders, milestone emails, and motivational messages.
            </p>
          </div>

          {/* Plan badge */}
          <div
            className="flex items-center justify-between px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(124,58,237,0.07)', border: '0.5px solid rgba(124,58,237,0.18)' }}
          >
            <div>
              <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Current Plan</p>
              <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>XPadite Free</p>
            </div>
            <span
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}
            >
              Free
            </span>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-85"
            style={{
              background: saved
                ? 'linear-gradient(135deg, #16a34a, #15803d)'
                : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            }}
          >
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
