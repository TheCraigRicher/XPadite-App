'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from './AppContext'
import { createClient } from '@/lib/supabase/client'
import { useLockBodyScroll } from './useLockBodyScroll'
import { PLAN_CONFIGS } from './SettingsModal'

// The same fixed brand-purple gradient the Task Manager (DayModal) header
// already uses — the established XPadite premium-header treatment, reused
// verbatim here rather than inventing a new one.
const PREMIUM_HEADER_GRADIENT = 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)'

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 10,
  border: '0.5px solid var(--xp-bdr2)',
  background: 'var(--xp-bg3)',
  color: 'var(--xp-txt)',
  fontSize: 13,
  outline: 'none',
}

// Every user-owned localStorage key XPadite writes — mirrors the wipe list
// AppSidebar's Sign Out already uses (plus xp-language/xp-timezone/
// xp-custom-colors/xp9jl/xp9jf/xp-stats-collapsed, which that list predates)
// so the next account on this device never inherits a deleted user's data.
const USER_LOCAL_STORAGE_KEYS = [
  'xp9d', 'xp9s', 'xp9a', 'xp9r', 'xp9g', 'xp9jl', 'xp9jf',
  'xp9-active-session', 'xp9-active-task-timer', 'xp9-task-clipboard',
  'xp9-profile', 'xp9-aic', 'xp9-journal', 'xp9-notifications', 'xp9_connections',
  'xp-theme', 'xp-progress-color', 'xp-custom-colors', 'xp-language', 'xp-timezone',
  'xp-stats-collapsed',
]

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 7l-10 7L2 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <rect x="3" y="11" width="18" height="11" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
    <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const WarningIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round" />
    <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
    <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="w-4 h-4">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="w-4 h-4">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ── Shared XPadite premium modal header (Task Manager header treatment) ───────

function PremiumModalHeader({ title, subtitle, onClose, icon }: {
  title: string; subtitle?: string; onClose: () => void; icon?: React.ReactNode
}) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4 flex-shrink-0"
      style={{ background: PREMIUM_HEADER_GRADIENT, borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
    >
      {/* Close-button hover/active feel reused verbatim from the Task Manager
          header's own .xp-dm-close-btn (background response + press scale)
          combined with Settings' .xp-set-close hover brighten — the two
          existing XPadite close-button interaction references. */}
      <style>{`
        .xp-pm-close { transition: background 150ms ease, transform 90ms ease; }
        .xp-pm-close:hover { background: rgba(255,255,255,0.24) !important; }
        .xp-pm-close:active { transform: scale(0.90); transition-duration: 60ms; }
      `}</style>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.16)', color: 'white' }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
          {subtitle && <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>{subtitle}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        className="xp-pm-close w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.20)', color: 'white' }}
      >
        ✕
      </button>
    </div>
  )
}

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
  onOpenSettings?: () => void
}

export function ProfileModal({ onClose, onOpenSettings }: ProfileModalProps) {
  const { userEmail } = useApp()
  const router = useRouter()
  useLockBodyScroll()
  const [data, setData] = useState<ProfileData>(loadProfile)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeSecurityModal, setActiveSecurityModal] = useState<'email' | 'password' | 'delete' | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planInfoTarget, setPlanInfoTarget] = useState<string | null>(null)

  // Backdrop click never closes Profile — it only gives a brief, subtle
  // "still open" pulse. Toggling false→true on the next frame (rather than
  // just setting true) reliably restarts the CSS animation even on rapid
  // repeated clicks, since the class is genuinely removed and re-added.
  const [attentionPulsing, setAttentionPulsing] = useState(false)
  function triggerAttentionPulse() {
    setAttentionPulsing(false)
    requestAnimationFrame(() => setAttentionPulsing(true))
  }

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
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (planInfoTarget) setPlanInfoTarget(null)
      else if (activeSecurityModal) setActiveSecurityModal(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, activeSecurityModal, planInfoTarget])

  async function handleAccountDeleted() {
    const sb = createClient()
    await sb.auth.signOut()
    try { USER_LOCAL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k)) } catch {}
    router.push('/login')
  }

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
    setPendingFile(file)
    setAvatarLoading(true)  // cleared by img.onLoad once the staged preview is decoded

    // FileReader → data: URI, not URL.createObjectURL — blob: URLs have shown
    // mobile-webview-specific staged-preview failures (broken-image icon)
    // even though the file itself is valid (Save Changes' persistence path,
    // which never touches this preview, works fine). data: URIs are the same
    // format avatarSrc already treats as a legitimate value (see the legacy
    // data: URI branch below) and render reliably everywhere.
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setPendingPreview(reader.result)
    }
    reader.onerror = () => setAvatarError('Could not read the selected image.')
    reader.readAsDataURL(file)
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
  const inputStyle = FIELD_STYLE

  // Rendered in two places (desktop/tablet inline in the scrolling body, mobile
  // in the sticky footer row) — same element, same behavior, just shown/hidden
  // per breakpoint via CSS so there is exactly one Save Changes implementation.
  const saveButtonNode = (
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
  )

  return (
    <>
    <style>{`
      @keyframes xp-avatar-spin { to { transform: rotate(360deg) } }
      @keyframes xp-pm-attention { 0%, 100% { transform: scale(1) } 40% { transform: scale(1.015) } }
      .xp-pm-attention { animation: xp-pm-attention 220ms ease; }
    `}</style>
    {/* Mobile: inset bottom-14 keeps the fixed 5-slot bottom nav visible/tappable
        beneath the backdrop, same pattern already used by ActivityManagerModal
        and other Burger Menu modals. Desktop/tablet (sm+): full-viewport overlay.
        Backdrop click never closes Profile — it only triggers the attention pulse
        on the card below (unsaved edits shouldn't vanish from a stray tap). */}
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={triggerAttentionPulse}
    >
      <div
        className={`w-full h-full sm:h-auto sm:max-h-[88vh] sm:max-w-[640px] lg:max-w-[720px] sm:rounded-2xl overflow-hidden ${attentionPulsing ? 'xp-pm-attention' : ''}`}
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
        }}
        onClick={e => e.stopPropagation()}
        onAnimationEnd={() => setAttentionPulsing(false)}
      >
        <PremiumModalHeader title="Profile" subtitle="Manage your account details" onClose={onClose} />

        {/* Body — only this region scrolls when content exceeds the modal's max height.
            overscrollBehavior: 'contain' is the same fix already applied to every other
            XPadite modal's scrollable body (GalleryModal, MeetingsModal, NotificationsModal,
            SyncModal, AppSidebar) — Profile was simply missing it, which is what let a
            swipe at the scroll boundary chain into/rubber-band the outer shell. */}
        <div className="px-5 py-5 space-y-4" style={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
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

          {/* Account & Security — side-by-side on tablet/desktop, stacked on mobile */}
          <div>
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--xp-txt3)' }}>Account &amp; Security</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <SecurityRow
                icon={<MailIcon />}
                title="Change Email"
                subtitle="Update your account email address."
                onClick={() => setActiveSecurityModal('email')}
              />
              <SecurityRow
                icon={<LockIcon />}
                title="Change Password"
                subtitle="Update your account password."
                onClick={() => setActiveSecurityModal('password')}
              />
            </div>
          </div>

          {/* Current Plan — compact overview; upgrades happen in Settings, not here */}
          <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(124,58,237,0.18)' }}>
            <button
              onClick={() => setPlanOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 transition-opacity hover:opacity-90"
              style={{ background: 'rgba(124,58,237,0.07)' }}
            >
              <div className="text-left">
                <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Current Plan</p>
                <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>XPadite Free</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}
                >
                  Free
                </span>
                <span
                  style={{ color: 'var(--xp-txt3)', transition: 'transform 200ms', transform: planOpen ? 'rotate(180deg)' : 'none' }}
                >
                  <ChevronDownIcon />
                </span>
              </div>
            </button>
            {planOpen && (
              <div className="px-3 py-3 space-y-2.5" style={{ borderTop: '0.5px solid rgba(124,58,237,0.14)', background: 'var(--xp-bg3)' }}>
                <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
                  Other available XPadite plans — manage upgrades from Settings.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Same PLAN_CONFIGS entries/order Settings uses, except the
                      Lifetime Deal is always pushed to the end here — ordering
                      only, no plan data/pricing/colors changed. */}
                  {Object.entries(PLAN_CONFIGS)
                    .sort(([a], [b]) => (a === 'ltd' ? 1 : b === 'ltd' ? -1 : 0))
                    .map(([id, cfg]) => (
                      <PlanPreviewCard key={id} cfg={cfg} onClick={() => setPlanInfoTarget(id)} />
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Delete Account — destructive, kept separate from Account & Security */}
          <button
            onClick={() => setActiveSecurityModal('delete')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-opacity hover:opacity-85"
            style={{ background: 'rgba(239,68,68,0.08)', border: '0.5px solid rgba(239,68,68,0.22)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444' }}
            >
              <TrashIcon />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold" style={{ color: '#ef4444' }}>Delete Account</p>
              <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
                Permanently delete your account and associated XPadite data.
              </p>
            </div>
            <span style={{ color: '#ef4444' }}><ChevronRightIcon /></span>
          </button>

          {/* Save — desktop/tablet only here; reached by scrolling, unchanged.
              Mobile shows the sticky instance below instead (see saveButtonNode). */}
          <div className="hidden sm:block">{saveButtonNode}</div>
        </div>

        {/* Mobile-only sticky Save Changes — sits directly above the locked
            5-slot bottom nav (the modal's own bottom-14 backdrop inset already
            stops right there). Desktop/tablet: this row renders nothing
            (sm:hidden), so it takes no space and Save stays in the body,
            full width, exactly as before. The bar itself uses the same
            neutral gray token (--xp-bg3) already used throughout Profile's
            own inputs/rows — full width for clean separation from the 5-slot
            nav — while the button inside is narrowed/centered to ~60% width,
            just for this mobile instance; the desktop button above is
            untouched (still saveButtonNode's own full-width className). */}
        <div
          className="sm:hidden px-5 py-3 flex-shrink-0 flex justify-center"
          style={{ borderTop: '0.5px solid var(--xp-bdr)', background: 'var(--xp-bg3)' }}
        >
          <div className="w-[60%] min-w-[200px]">{saveButtonNode}</div>
        </div>
      </div>
    </div>

    {activeSecurityModal === 'email' && (
      <ChangeEmailModal currentEmail={userEmail} onClose={() => setActiveSecurityModal(null)} />
    )}
    {activeSecurityModal === 'password' && (
      <ChangePasswordModal currentEmail={userEmail} onClose={() => setActiveSecurityModal(null)} />
    )}
    {activeSecurityModal === 'delete' && (
      <DeleteAccountModal
        onClose={() => setActiveSecurityModal(null)}
        onDeleted={handleAccountDeleted}
      />
    )}
    {planInfoTarget && PLAN_CONFIGS[planInfoTarget] && (
      <PlanRedirectModal
        planTitle={PLAN_CONFIGS[planInfoTarget].title}
        onClose={() => setPlanInfoTarget(null)}
        onGoToSettings={() => {
          setPlanInfoTarget(null)
          onOpenSettings?.()
          onClose()
        }}
      />
    )}
    </>
  )
}

// ── Account & Security row ────────────────────────────────────────────────────

// Hover/focus treatment mirrors SettingsModal's Language/Timezone SelectMenu
// trigger exactly (border → #7c3aed, soft glow ring, smooth transition) so
// Account & Security feels like the same established XPadite control.
function SecurityRow({ icon, title, subtitle, onClick }: {
  icon: React.ReactNode; title: string; subtitle: string; onClick: () => void
}) {
  const [active, setActive] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left outline-none"
      style={{
        background: active ? 'rgba(124,58,237,0.06)' : 'var(--xp-bg3)',
        border: active ? '1.5px solid #7c3aed' : '1px solid var(--xp-bdr2)',
        boxShadow: active ? '0 0 0 3px rgba(124,58,237,0.12)' : 'none',
        transform: active ? 'translateY(-1px)' : 'none',
        transition: 'background 150ms, border 150ms, box-shadow 150ms, transform 150ms',
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: active ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.12)',
          color: '#7c3aed',
          transition: 'background 150ms',
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{title}</p>
        <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{subtitle}</p>
      </div>
      <span
        style={{
          color: active ? '#7c3aed' : 'var(--xp-txt3)',
          transform: active ? 'translateX(2px)' : 'none',
          transition: 'transform 150ms, color 150ms',
        }}
      >
        <ChevronRightIcon />
      </span>
    </button>
  )
}

// ── Shared show/hide password field ───────────────────────────────────────────

function PasswordField({ label, value, onChange, show, onToggleShow, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void
  show: boolean; onToggleShow: () => void; autoComplete: string
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          style={{ ...FIELD_STYLE, paddingRight: 38 }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 transition-opacity hover:opacity-70"
          style={{ color: 'var(--xp-txt3)' }}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  )
}

// ── Change Email ───────────────────────────────────────────────────────────────

function ChangeEmailModal({ currentEmail, onClose }: { currentEmail: string; onClose: () => void }) {
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError('')
    const trimmed = newEmail.trim()
    if (!trimmed) { setError('Enter a new email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Enter a valid email address.'); return }
    if (trimmed.toLowerCase() === currentEmail.toLowerCase()) { setError('That is already your current email address.'); return }

    setLoading(true)
    const sb = createClient()
    const { error: updateError } = await sb.auth.updateUser({ email: trimmed })
    setLoading(false)
    if (updateError) { setError(updateError.message); return }
    setSuccess(true)
  }

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: 'calc(100dvh - 32px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PremiumModalHeader title="Change Email" subtitle="Update your account email address" onClose={onClose} />
        <div className="px-5 py-5" style={{ minHeight: 0, overflowY: 'auto' }}>
          {success ? (
            <div className="space-y-4">
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--xp-txt2)' }}>
                We&apos;ve sent confirmation messages to both your current email and <strong>{newEmail.trim()}</strong>.
                Confirm the request from <strong>both</strong> to finish updating your email — your account still
                uses your current email until both are confirmed.
              </p>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Current Email</label>
                <div style={{ ...FIELD_STYLE, opacity: 0.6, cursor: 'not-allowed' }}>{currentEmail || '—'}</div>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>New Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  style={FIELD_STYLE}
                />
              </div>
              {error && <p className="text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
                >
                  {loading ? 'Sending…' : 'Change Email'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Change Password ─────────────────────────────────────────────────────────

function ChangePasswordModal({ currentEmail, onClose }: { currentEmail: string; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew]         = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError('')
    if (!currentPassword || !newPassword || !confirmPassword) { setError('Fill in all fields.'); return }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return }

    setLoading(true)
    const sb = createClient()
    // Verify the current password by re-authenticating with it — Supabase's
    // updateUser() has no separate "current password" check of its own.
    const { error: verifyError } = await sb.auth.signInWithPassword({ email: currentEmail, password: currentPassword })
    if (verifyError) { setLoading(false); setError('Current password is incorrect.'); return }

    const { error: updateError } = await sb.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (updateError) { setError(updateError.message); return }
    setSuccess(true)
  }

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: 'calc(100dvh - 32px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PremiumModalHeader title="Change Password" subtitle="Update your account password" onClose={onClose} />
        <div className="px-5 py-5" style={{ minHeight: 0, overflowY: 'auto' }}>
          {success ? (
            <div className="space-y-4">
              <p className="text-[13px]" style={{ color: 'var(--xp-txt2)' }}>Your password has been updated.</p>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordField
                label="Current Password" value={currentPassword} onChange={setCurrentPassword}
                show={showCurrent} onToggleShow={() => setShowCurrent(s => !s)} autoComplete="current-password"
              />
              <PasswordField
                label="New Password" value={newPassword} onChange={setNewPassword}
                show={showNew} onToggleShow={() => setShowNew(s => !s)} autoComplete="new-password"
              />
              <PasswordField
                label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword}
                show={showConfirm} onToggleShow={() => setShowConfirm(s => !s)} autoComplete="new-password"
              />
              {error && <p className="text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
                >
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Delete Account ─────────────────────────────────────────────────────────────

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const canDelete = confirmText === 'DELETE'

  async function handleDelete() {
    if (!canDelete || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' })
      const body = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        setError(body.error || 'Failed to delete account. Please try again.')
        setLoading(false)
        return
      }
      onDeleted()
    } catch {
      setError('Network error — could not reach the server. Your account was not deleted.')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={loading ? undefined : onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)', border: '0.5px solid rgba(239,68,68,0.3)', boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          maxHeight: 'calc(100dvh - 32px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PremiumModalHeader title="Delete Account" subtitle="This action is permanent" onClose={loading ? () => {} : onClose} icon={<WarningIcon />} />
        <div className="px-5 py-5 space-y-4" style={{ minHeight: 0, overflowY: 'auto' }}>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--xp-txt2)' }}>
            This will permanently delete your XPadite account and all associated data — tasks,
            calendar history, journal entries, activities, and photos. <strong>This cannot be undone.</strong>
          </p>
          <div>
            <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--xp-txt3)' }}>
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              disabled={loading}
              style={FIELD_STYLE}
            />
          </div>
          {error && <p className="text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || loading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45"
              style={{ background: '#dc2626' }}
            >
              {loading ? 'Deleting…' : 'Permanently Delete Account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Current Plan — compact preview card for a plan Profile doesn't manage ──────

function PlanPreviewCard({ cfg, onClick }: { cfg: (typeof PLAN_CONFIGS)[string]; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="text-left rounded-lg px-2.5 py-2 transition-all duration-150"
      style={{
        background: cfg.headerGradient,
        transform: hovered ? 'translateY(-1px) scale(1.01)' : 'none',
        boxShadow: hovered ? '0 4px 14px rgba(0,0,0,0.20)' : '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <p className="text-[11px] font-bold text-white truncate">{cfg.title}</p>
      <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {cfg.price} {cfg.priceLabel}
      </p>
    </button>
  )
}

// ── "Manage plans in Settings" redirect dialog ──────────────────────────────────

function PlanRedirectModal({ planTitle, onClose, onGoToSettings }: {
  planTitle: string; onClose: () => void; onGoToSettings: () => void
}) {
  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.30)',
          maxHeight: 'calc(100dvh - 32px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <PremiumModalHeader title={planTitle} onClose={onClose} />
        <div className="px-5 py-5 space-y-4" style={{ minHeight: 0, overflowY: 'auto' }}>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--xp-txt2)' }}>
            Plan upgrades and billing are managed from Settings. Please head to Settings to view or change
            your XPadite plan.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
            >
              Cancel
            </button>
            <button
              onClick={onGoToSettings}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
