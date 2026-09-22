'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'
import { createClient } from '@/lib/supabase/client'
import { useLockBodyScroll } from './useLockBodyScroll'

interface ProfileData {
  firstName: string
  lastName: string
  displayName: string
  avatarUrl: string  // storage path (e.g. "<uuid>/avatar.webp") or "" or legacy data: URI
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

function isStoragePath(url: string): boolean {
  // A storage path looks like "<uuid>/avatar.ext" — not a data: URI and not http(s)
  return !!url && !url.startsWith('data:') && !url.startsWith('http')
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

interface ProfileModalProps {
  onClose: () => void
}

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { userEmail, isDark } = useApp()
  useLockBodyScroll()
  const [data, setData] = useState<ProfileData>(loadProfile)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Avatar display & upload state
  const [signedAvatarUrl, setSignedAvatarUrl] = useState('')   // signed URL for display
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState('')      // blob URL for local preview
  const [avatarError, setAvatarError] = useState('')
  // true while fetching signed URL OR while browser is downloading/decoding the image.
  // Initialised from localStorage so we never show the empty circle first then snap to a spinner.
  const [avatarLoading, setAvatarLoading] = useState(() => {
    if (typeof window === 'undefined') return false
    const raw = localStorage.getItem('xp9-profile')
    if (!raw) return true  // bootstrap effect will check Supabase
    try { return isStoragePath(JSON.parse(raw).avatarUrl || '') }
    catch { return false }
  })

  // Delayed spinner — only becomes visible if avatarLoading stays true for >180ms
  const [spinnerVisible, setSpinnerVisible] = useState(false)
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (avatarLoading) {
      spinnerTimerRef.current = setTimeout(() => {
        spinnerTimerRef.current = null
        setSpinnerVisible(true)
      }, 180)
    } else {
      if (spinnerTimerRef.current !== null) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = null
      }
      setSpinnerVisible(false)
    }
    return () => {
      if (spinnerTimerRef.current !== null) clearTimeout(spinnerTimerRef.current)
    }
  }, [avatarLoading])

  const fileRef = useRef<HTMLInputElement>(null)

  // Revoke blob preview URL when it changes or on unmount
  useEffect(() => {
    return () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview) }
  }, [pendingPreview])

  // On mount: generate signed URL from existing storage path
  useEffect(() => {
    const raw = localStorage.getItem('xp9-profile')
    if (!raw) return  // bootstrap effect owns the loading state for new users
    let path = ''
    try { path = JSON.parse(raw).avatarUrl || '' } catch {}
    if (!isStoragePath(path)) { setAvatarLoading(false); return }
    // storage path found — keep loading until img.onLoad fires
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) { setAvatarLoading(false); return }
      const { data: signed, error } = await sb.storage.from('avatars').createSignedUrl(path, 3600)
      if (error) { console.error('AVATAR SIGNED URL ERROR:', error); setAvatarLoading(false); return }
      if (signed?.signedUrl) setSignedAvatarUrl(signed.signedUrl)
      else setAvatarLoading(false)
    }).catch(() => { setAvatarLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bootstrap from Supabase if xp9-profile was never saved locally
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('xp9-profile')) return
    const sb = createClient()
    sb.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) { setAvatarLoading(false); return }
      const { data: profile } = await sb
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', authData.user.id)
        .single()
      const row = profile as { full_name?: string; avatar_url?: string } | null
      const fullName = row?.full_name ?? ''
      if (fullName) {
        const spaceIdx = fullName.indexOf(' ')
        const firstName = spaceIdx === -1 ? fullName : fullName.slice(0, spaceIdx)
        const lastName  = spaceIdx === -1 ? '' : fullName.slice(spaceIdx + 1)
        setData(d => ({ ...d, firstName, lastName, displayName: d.displayName || firstName }))
      }
      const avatarPath = row?.avatar_url ?? ''
      if (isStoragePath(avatarPath)) {
        setData(d => ({ ...d, avatarUrl: avatarPath }))
        const { data: signed, error: signErr } = await sb.storage.from('avatars').createSignedUrl(avatarPath, 3600)
        if (signErr || !signed?.signedUrl) { setAvatarLoading(false); return }
        setSignedAvatarUrl(signed.signedUrl)
        // avatarLoading stays true — cleared by img.onLoad
      } else {
        setAvatarLoading(false)  // confirmed no avatar
      }
    }).catch(() => { setAvatarLoading(false) })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // reset so re-selecting same file fires onChange
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      setAvatarError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setAvatarError('Image must be 5 MB or smaller.')
      return
    }
    setAvatarError('')
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    setAvatarLoading(true)  // cleared by img.onLoad once the blob is decoded
  }

  async function handleRemove() {
    setAvatarError('')
    const currentPath = data.avatarUrl

    // Optimistic UI update immediately
    setSignedAvatarUrl('')
    setPendingFile(null)
    setPendingPreview('')
    setAvatarLoading(false)  // no image to wait for
    setData(d => ({ ...d, avatarUrl: '' }))
    saveProfile({ ...data, avatarUrl: '' })
    window.dispatchEvent(new CustomEvent('xp9-avatar-changed'))

    if (!isStoragePath(currentPath)) return  // nothing to clean up in storage

    const sb = createClient()
    const { data: { user }, error: userError } = await sb.auth.getUser()
    if (userError || !user) { console.error('AVATAR REMOVE: auth error', userError); return }

    const { error: delError } = await sb.storage.from('avatars').remove([currentPath])
    if (delError) console.error('AVATAR DELETE ERROR:', delError)

    const { error: dbError } = await sb
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (dbError) console.error('AVATAR DB CLEAR ERROR:', dbError)
  }

  async function handleSave() {
    setSaving(true)
    setAvatarError('')

    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setSaving(false); return }

    let storagePath = data.avatarUrl   // may be updated by upload below

    // ── Upload pending avatar ───────────────────────────────────────────────
    if (pendingFile) {
      const newExt = extFromMime(pendingFile.type)
      const newPath = `${user.id}/avatar.${newExt}`

      // Delete old file first to avoid orphans when the extension changes
      if (isStoragePath(storagePath) && storagePath !== newPath) {
        const { error: delErr } = await sb.storage.from('avatars').remove([storagePath])
        if (delErr) console.error('AVATAR OLD DELETE ERROR:', delErr)
      }

      const { error: uploadError } = await sb.storage
        .from('avatars')
        .upload(newPath, pendingFile, { upsert: true, contentType: pendingFile.type })
      if (uploadError) {
        console.error('AVATAR UPLOAD ERROR:', uploadError)
        setAvatarError(`Upload failed: ${uploadError.message}`)
        setSaving(false)
        return
      }

      storagePath = newPath

      // Generate signed URL for immediate display
      const { data: signed, error: signErr } = await sb.storage
        .from('avatars')
        .createSignedUrl(newPath, 3600)
      if (signErr) console.error('AVATAR SIGNED URL ERROR:', signErr)
      if (signed?.signedUrl) {
        setAvatarLoading(true)  // spinner until replacement img.onLoad fires
        setSignedAvatarUrl(signed.signedUrl)
      }

      URL.revokeObjectURL(pendingPreview)
      setPendingPreview('')
      setPendingFile(null)
    }

    // ── Write profiles row (full_name + avatar_url in one call) ────────────
    const fullName = [data.firstName.trim(), data.lastName.trim()].filter(Boolean).join(' ')
    const profilePatch: Record<string, unknown> = {
      full_name: fullName || null,
      updated_at: new Date().toISOString(),
    }
    if (storagePath !== data.avatarUrl) profilePatch.avatar_url = storagePath || null

    const { error: saveError } = await sb
      .from('profiles')
      .update(profilePatch)
      .eq('id', user.id)
    if (saveError) console.error('Profile save failed:', saveError)

    // ── Persist to localStorage and notify sidebar ──────────────────────────
    const newData = { ...data, avatarUrl: storagePath }
    setData(newData)
    saveProfile(newData)
    window.dispatchEvent(new CustomEvent('xp9-avatar-changed'))

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const displayInitial = (data.firstName || data.displayName || userEmail || 'U').charAt(0).toUpperCase()

  // Priority: local preview > signed storage URL > legacy data: URI > nothing
  const avatarSrc = pendingPreview || signedAvatarUrl || (data.avatarUrl.startsWith('data:') ? data.avatarUrl : '')
  const hasAvatar = !!avatarSrc

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
    <>
    <style>{`@keyframes xp-avatar-spin { to { transform: rotate(360deg) } }`}</style>
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
                background: (!avatarLoading && hasAvatar) ? 'transparent' : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                border: '2px solid rgba(124,58,237,0.3)',
                overflow: 'hidden',
              }}
              onClick={() => fileRef.current?.click()}
            >
              {/* Image — always rendered when src is ready so the browser downloads it;
                  kept invisible while loading so there's no flash before onLoad */}
              {avatarSrc && (
                <img
                  src={avatarSrc}
                  alt="avatar"
                  className="w-full h-full object-cover"
                  style={{ opacity: avatarLoading ? 0 : 1, transition: 'opacity 0.15s' }}
                  onLoad={() => setAvatarLoading(false)}
                  onError={() => { setAvatarLoading(false); setSignedAvatarUrl('') }}
                />
              )}

              {/* Spinner — only shown after 180ms delay to avoid a flash on fast loads */}
              {spinnerVisible && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    border: '2.5px solid rgba(167,139,250,0.25)',
                    borderTopColor: '#a78bfa',
                    animation: 'xp-avatar-spin 0.7s linear infinite',
                  }} />
                </div>
              )}

              {/* Default initials — only shown once we know there is no avatar */}
              {!avatarLoading && !hasAvatar && (
                <span className="text-2xl font-bold text-white">{displayInitial}</span>
              )}

              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              >
                <span className="text-white text-xs font-medium">Edit</span>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarFile}
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-75"
                style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '0.5px solid rgba(124,58,237,0.25)' }}
              >
                Upload Photo
              </button>
              {(hasAvatar || isStoragePath(data.avatarUrl)) && (
                <button
                  onClick={handleRemove}
                  className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-opacity hover:opacity-75"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.2)' }}
                >
                  Remove
                </button>
              )}
            </div>
            {avatarError && (
              <p className="text-[11px] text-center" style={{ color: '#ef4444' }}>{avatarError}</p>
            )}
            {pendingFile && (
              <p className="text-[10px] text-center" style={{ color: 'var(--xp-txt3)' }}>
                Photo staged — click Save Changes to upload
              </p>
            )}
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
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-85 disabled:opacity-60"
            style={{
              background: saved
                ? 'linear-gradient(135deg, #16a34a, #15803d)'
                : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
