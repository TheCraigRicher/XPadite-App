'use client'

import { useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { formatBytes } from './attachmentUtils'
import { SUPPORT_EMAIL, PROBLEM_CATEGORIES, FEEDBACK_CATEGORIES, XPADITE_REVIEW_URL } from '@/lib/config/support'
import { createClient } from '@/lib/supabase/client'
import { REVIEW_LIMITS, fetchMyReview, isEligibleUser, submitReview, validateReview, type MyReview } from '@/lib/reviews/client'

interface HelpFeedbackModalProps {
  onClose: () => void
}

// 'help' submissions still exist historically (see lib/config/support.ts) but
// the UI no longer offers a way to create one. Report Problem and Feedback use the
// support form; Rate Us is the in-app review form (shared reviews system, see lib/reviews/client.ts).
type FormTab = 'problem' | 'feedback'
type TabKey = FormTab | 'rate'

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'problem', icon: '🐞', label: 'Report Problem' },
  { key: 'feedback', icon: '💡', label: 'Feedback' },
  { key: 'rate', icon: '✨', label: 'Rate Us' },
]

const QUICK_TIPS = [
  'Check XPadite Tutorials for walkthroughs of key features.',
  'Include a screenshot when reporting a problem — it helps us fix it faster.',
  'Feature requests help shape what we build next.',
  'For account or sync issues, tell us your device type for faster help.',
]

const TAB_COPY: Record<FormTab, { heading: string; subtitle?: string; subjectLabel: string; bodyLabel: string; bodyPlaceholder: string; cta: string; success: string }> = {
  problem: {
    heading: 'Report a Problem',
    subjectLabel: 'Subject',
    bodyLabel: 'Description',
    bodyPlaceholder: 'Tell us more…',
    cta: 'Report Problem',
    success: 'Problem reported — thanks for flagging it ✓',
  },
  feedback: {
    heading: 'Share Feedback',
    subjectLabel: 'Subject',
    bodyLabel: 'Feedback',
    bodyPlaceholder: 'Tell us more…',
    cta: 'Send Feedback',
    success: 'Feedback sent — thank you ✓',
  },
}

const COMPLIMENT_COPY = {
  heading: 'Share some love ✨',
  subtitle: 'Enjoying XPadite? We\'d love to hear what you\'re loving about it.',
  subjectLabel: 'Subject',
  bodyLabel: 'Feedback',
  bodyPlaceholder: 'Tell us what you\'re loving about XPadite…',
  cta: 'Send Compliment ✨',
  success: 'Thanks for the kind words ✨ Your compliment has been sent.',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  background: 'var(--xp-bg3)',
  border: '0.5px solid var(--xp-bdr2)',
  color: 'var(--xp-txt)',
  fontSize: 13,
  outline: 'none',
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt2)' }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </span>
      {children}
    </label>
  )
}

export function HelpFeedbackModal({ onClose }: HelpFeedbackModalProps) {
  const { setToast } = useApp()
  const [tab, setTab] = useState<TabKey>('problem')
  const [category, setCategory] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rate Us (in-app review) state
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [reviewTitle, setReviewTitle] = useState('')
  const [profession, setProfession] = useState('')
  const [reviewBody, setReviewBody] = useState('')
  const [showPhoto, setShowPhoto] = useState(true) // new reviews default to ON (clearly disclosed); an existing review loads its saved choice
  const [eligibility, setEligibility] = useState<'loading' | 'ok' | 'signed_out' | 'unverified'>('loading')
  const [myReview, setMyReview] = useState<MyReview | null>(null)
  const [reviewMsg, setReviewMsg] = useState<{ kind: 'error' | 'success' | 'held'; text: string } | null>(null)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const loadedRateRef = useRef(false)

  useLockBodyScroll()

  function selectTab(key: TabKey) {
    setTab(key)
    setCategory('')
  }

  // First time Rate Us opens: confirm the account is eligible (signed in + verified email — the database enforces this
  // again on submit) and load the user's existing review so it can be edited instead of duplicated.
  useEffect(() => {
    if (tab !== 'rate' || loadedRateRef.current) return
    loadedRateRef.current = true
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        const state = isEligibleUser(data.user)
        setEligibility(state)
        if (state !== 'ok') return
        const mine = await fetchMyReview(supabase)
        if (!mine) return
        setMyReview(mine)
        setRating(mine.rating)
        setReviewTitle(mine.title ?? '')
        setProfession(mine.profession ?? '')
        setReviewBody(mine.body)
        if (typeof mine.show_profile_photo === 'boolean') setShowPhoto(mine.show_profile_photo)
      } catch {
        setEligibility('ok') // let the server be the judge; it will report a precise error
      }
    })()
  }, [tab])

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (reviewSubmitting) return
    const invalid = validateReview({ rating, title: reviewTitle, profession, body: reviewBody })
    if (invalid) { setReviewMsg({ kind: 'error', text: invalid }); return }
    setReviewSubmitting(true)
    setReviewMsg(null)
    try {
      const res = await submitReview(createClient(), { rating, title: reviewTitle, profession, showPhoto, body: reviewBody })
      if (!res.ok) { setReviewMsg({ kind: 'error', text: res.message }); return }
      const wasUpdate = !!myReview
      setMyReview(res.review)
      // Never report full success when the photo step failed: the review is saved, the photo is not.
      if (res.photoSynced === false) {
        setReviewMsg({
          kind: 'error',
          text: (res.held ? 'Your review was saved and is being checked before it appears publicly, but' : 'Your review was saved, but') +
            ' your profile photo could not be updated. Please press the button again to retry.',
        })
        setToast('Review saved — photo not updated')
        return
      }
      const noPhotoNote = showPhoto && res.photoReason === 'no_avatar'
        ? ' You have no profile photo yet — add one in Profile, then save again to show it.' : ''
      if (res.held) {
        setReviewMsg({ kind: 'held', text: 'Thanks! Your review was saved and is being checked before it appears publicly.' + noPhotoNote })
        setToast('Review received — thank you ✓')
      } else {
        setReviewMsg({ kind: noPhotoNote ? 'held' : 'success', text: (wasUpdate ? 'Your review was updated ✓' : 'Thank you! Your review is now live on the XPadite website ✓') + noPhotoNote })
        setToast('Review published — thank you ✓')
      }
    } catch {
      setReviewMsg({ kind: 'error', text: 'Could not submit your review. Please try again.' })
    } finally {
      setReviewSubmitting(false)
    }
  }

  function clearForm() {
    setSubject('')
    setBody('')
    setCategory('')
    setAttachment(null)
    setAttachmentPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setToast('Attachments must be an image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast('Attachment is too large. Please use an image under 5MB.')
      return
    }
    setAttachment(file)
    const reader = new FileReader()
    reader.onload = ev => setAttachmentPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function removeAttachment() {
    setAttachment(null)
    setAttachmentPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const formTab: FormTab = tab === 'rate' ? 'problem' : tab
  const isCompliment = tab === 'feedback' && category === 'Compliment'
  const copy = isCompliment ? COMPLIMENT_COPY : TAB_COPY[formTab]
  const categories = formTab === 'problem' ? PROBLEM_CATEGORIES : FEEDBACK_CATEGORIES

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!subject.trim() || !body.trim()) {
      setToast('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('requestType', formTab)
      form.set('category', category)
      form.set('subject', subject.trim())
      form.set('message', body.trim())
      form.set('currentPath', window.location.pathname)
      if (attachment) form.set('attachment', attachment)

      const res = await fetch('/api/support/submit', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({ ok: false }))

      if (!res.ok || !data.ok) {
        setToast('Could not submit your request. Please try again.')
        return
      }

      setToast(copy.success)
      clearForm()
    } catch {
      setToast('Could not submit your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const formNode = (
    <form onSubmit={handleSubmit}>
      <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>{copy.heading}</h3>
      {copy.subtitle && (
        <p className="text-[12px] mb-4" style={{ color: 'var(--xp-txt3)' }}>{copy.subtitle}</p>
      )}
      {!copy.subtitle && <div className="mb-4" />}

      <Field label="Category" required>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          required
          style={inputStyle}
        >
          <option value="" disabled>Select a category…</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>

      <Field label={copy.subjectLabel} required>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          required
          maxLength={300}
          placeholder="Brief summary…"
          style={inputStyle}
        />
      </Field>

      <Field label={copy.bodyLabel} required>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          required
          rows={5}
          maxLength={5000}
          placeholder={copy.bodyPlaceholder}
          className="resize-none"
          style={inputStyle}
        />
      </Field>

      <Field label="Screenshot / Attachment (optional)">
        {attachment ? (
          <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
            {attachmentPreview && (
              <img src={attachmentPreview} alt="Attachment preview" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium truncate" style={{ color: 'var(--xp-txt)' }}>{attachment.name}</p>
              <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>{formatBytes(attachment.size)}</p>
            </div>
            <button
              type="button"
              onClick={removeAttachment}
              aria-label="Remove attachment"
              style={{ width: 26, height: 26, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(239,68,68,0.65)', fontSize: 16, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        ) : (
          <label
            className="flex items-center justify-center gap-2 cursor-pointer"
            style={{ ...inputStyle, borderStyle: 'dashed', textAlign: 'center', color: 'var(--xp-txt3)', padding: '14px 12px' }}
          >
            📎 Click to add a screenshot
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        )}
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="w-full text-white font-semibold transition-opacity"
        style={{
          padding: '11px 16px',
          borderRadius: 10,
          fontSize: 13.5,
          background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
          border: 'none',
          cursor: submitting ? 'default' : 'pointer',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Sending…' : copy.cta}
      </button>
    </form>
  )

  const shownStars = hoverRating || rating
  const reviewBlocked = eligibility === 'signed_out' || eligibility === 'unverified'
  const rateNode = (
    <form onSubmit={handleReviewSubmit}>
      <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>Rate XPadite ✨</h3>
      <p className="text-[12px] mb-4" style={{ color: 'var(--xp-txt3)' }}>
        Tell others what you think. Your review is shown publicly on the XPadite website with your first name and last initial.
      </p>

      {eligibility === 'loading' && <p className="text-[12px] mb-3" style={{ color: 'var(--xp-txt3)' }}>Checking your account…</p>}
      {eligibility === 'signed_out' && (
        <p className="text-[12px] mb-3 p-3 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
          Please sign in to leave a review.
        </p>
      )}
      {eligibility === 'unverified' && (
        <p className="text-[12px] mb-3 p-3 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
          Reviews come from verified accounts. Please confirm your email address (check your inbox for the confirmation link), then come back.
        </p>
      )}

      {myReview && (
        <p className="text-[11.5px] mb-3" style={{ color: 'var(--xp-txt3)' }}>
          You already reviewed XPadite — saving again updates your review.
          {myReview.status === 'pending' && ' It is currently being checked before it appears publicly.'}
          {myReview.status === 'rejected' && ' It is not currently shown publicly.'}
        </p>
      )}

      <Field label="Your rating" required>
        <div role="radiogroup" aria-label="Star rating" className="flex items-center gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onFocus={() => setHoverRating(n)}
              onBlur={() => setHoverRating(0)}
              style={{ fontSize: 30, lineHeight: 1, padding: '2px 3px', background: 'none', border: 'none', cursor: 'pointer', color: n <= shownStars ? '#f59e0b' : 'var(--xp-bdr2)', transition: 'color 120ms ease, transform 120ms ease', transform: n <= shownStars ? 'scale(1.06)' : 'none' }}
            >
              ★
            </button>
          ))}
          <span className="text-[11.5px] ml-2" style={{ color: 'var(--xp-txt3)' }}>{rating ? `${rating} / 5` : 'Select a rating'}</span>
        </div>
      </Field>

      <Field label="Title (optional)">
        <input type="text" value={reviewTitle} onChange={e => setReviewTitle(e.target.value)} maxLength={REVIEW_LIMITS.titleMax} placeholder="Sum it up in a few words…" style={inputStyle} />
      </Field>

      <Field label="Profession (optional)">
        <input type="text" value={profession} onChange={e => setProfession(e.target.value)} maxLength={REVIEW_LIMITS.professionMax} placeholder="e.g. Student, Freelancer" style={inputStyle} />
      </Field>

      <label className="flex items-start gap-2.5 mb-3.5 cursor-pointer" htmlFor="xp-review-show-photo">
        <input
          id="xp-review-show-photo"
          type="checkbox"
          checked={showPhoto}
          onChange={e => setShowPhoto(e.target.checked)}
          className="mt-0.5 flex-shrink-0"
          style={{ width: 16, height: 16, accentColor: '#7c3aed' }}
        />
        <span>
          <span className="block text-[12px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>Display my profile photo with my review</span>
          <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--xp-txt3)' }}>
            Your XPadite profile photo will appear publicly alongside your review. Uncheck to keep it private.
          </span>
        </span>
      </label>

      <Field label="Your review" required>
        <textarea
          value={reviewBody}
          onChange={e => setReviewBody(e.target.value)}
          rows={5}
          maxLength={REVIEW_LIMITS.bodyMax}
          placeholder="What do you like? What could be better? (at least 10 characters)"
          className="resize-none"
          style={inputStyle}
        />
        <span className="block text-right text-[10.5px] mt-1" style={{ color: 'var(--xp-txt3)' }}>{reviewBody.trim().length} / {REVIEW_LIMITS.bodyMax}</span>
      </Field>

      {reviewMsg && (
        <p
          role={reviewMsg.kind === 'error' ? 'alert' : 'status'}
          className="text-[12px] mb-3 p-3 rounded-xl"
          style={{
            background: 'var(--xp-bg3)',
            border: `0.5px solid ${reviewMsg.kind === 'error' ? 'rgba(239,68,68,0.55)' : reviewMsg.kind === 'held' ? 'rgba(245,158,11,0.55)' : 'rgba(34,197,94,0.55)'}`,
            color: reviewMsg.kind === 'error' ? '#ef4444' : 'var(--xp-txt)',
          }}
        >
          {reviewMsg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={reviewSubmitting || reviewBlocked}
        className="w-full text-white font-semibold transition-opacity"
        style={{
          padding: '11px 16px',
          borderRadius: 10,
          fontSize: 13.5,
          background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
          border: 'none',
          cursor: reviewSubmitting ? 'default' : 'pointer',
          opacity: reviewSubmitting || reviewBlocked ? 0.6 : 1,
        }}
      >
        {reviewSubmitting ? 'Submitting…' : myReview ? 'Update Review' : 'Submit Review'}
      </button>

      {XPADITE_REVIEW_URL && (
        <p className="text-[12px] mt-3 text-center">
          <a href={XPADITE_REVIEW_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed', fontWeight: 500 }}>
            Read published reviews on the website ↗
          </a>
        </p>
      )}
    </form>
  )

  const contactAndTips = (
    <div className="flex flex-col gap-4">
      <div className="p-4 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
        <p className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt)' }}>Contact Us Directly</p>
        <p className="text-[11.5px] mb-2" style={{ color: 'var(--xp-txt3)' }}>Prefer email? Reach us any time.</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[12.5px] font-medium" style={{ color: '#7c3aed' }}>{SUPPORT_EMAIL}</a>
      </div>
      <div className="p-4 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
        <p className="text-[12.5px] font-semibold mb-2" style={{ color: 'var(--xp-txt)' }}>Quick Tips</p>
        <ul className="flex flex-col gap-1.5">
          {QUICK_TIPS.map((tip, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--xp-txt3)' }}>
              <span aria-hidden="true">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      // Clicking outside must NOT dismiss (draft feedback/reviews would be lost); the click is also kept from reaching parents.
      onClick={e => e.stopPropagation()}
    >
      <style>{`
        @keyframes xpHelpHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-help-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpHelpHdrFlow 14s ease infinite;
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xp-help-title"
        className="w-full sm:max-w-[880px] h-full sm:h-[86vh] sm:max-h-[86vh] rounded-none sm:rounded-2xl max-sm:border-0! overflow-hidden flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="xp-help-hdr flex items-center justify-between flex-shrink-0"
          style={{ padding: '14px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.12)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.32)' }}>
              <span style={{ fontSize: 17 }} aria-hidden="true">❓</span>
            </div>
            <div className="min-w-0">
              <h2 id="xp-help-title" style={{ fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.01em', lineHeight: 1.2 }}>Help & Feedback</h2>
              <p className="truncate" style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>We&apos;re here to help and always love to hear from you.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.88)', border: '0.5px solid rgba(255,255,255,0.25)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Tabs (Report Problem · Feedback · Rate Us). The modal closes ONLY via the × button, never on an outside click. */}
        <div className="flex items-center gap-1 flex-wrap flex-shrink-0" style={{ padding: '12px 16px 0' }}>
          <div className="flex items-center gap-1 flex-wrap" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)' }}>
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => selectTab(t.key)}
                className="text-[12px] whitespace-nowrap"
                style={{
                  padding: '7px 13px',
                  borderRadius: 7,
                  fontWeight: tab === t.key ? 700 : 500,
                  background: tab === t.key ? '#7c3aed' : 'transparent',
                  color: tab === t.key ? '#ffffff' : 'var(--xp-txt2)',
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex flex-col lg:flex-row gap-6 p-5">
            <div className="flex-1 min-w-0 lg:max-w-[480px]">{tab === 'rate' ? rateNode : formNode}</div>
            <div className="lg:w-[260px] flex-shrink-0">{contactAndTips}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
