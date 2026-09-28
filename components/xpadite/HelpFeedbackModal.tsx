'use client'

import { useRef, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { formatBytes } from './attachmentUtils'
import { SUPPORT_EMAIL, PROBLEM_CATEGORIES, FEEDBACK_CATEGORIES, XPADITE_REVIEW_URL } from '@/lib/config/support'

interface HelpFeedbackModalProps {
  onClose: () => void
}

// 'help' submissions still exist historically (see lib/config/support.ts) but
// the UI no longer offers a way to create one — only these two remain as
// selectable internal tabs. Rate Us is a separate external action, not a tab.
type TabKey = 'problem' | 'feedback'

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'problem', icon: '🐞', label: 'Report Problem' },
  { key: 'feedback', icon: '💡', label: 'Feedback' },
]

const QUICK_TIPS = [
  'Check XPadite Tutorials for walkthroughs of key features.',
  'Include a screenshot when reporting a problem — it helps us fix it faster.',
  'Feature requests help shape what we build next.',
  'For account or sync issues, tell us your device type for faster help.',
]

const TAB_COPY: Record<TabKey, { heading: string; subtitle?: string; subjectLabel: string; bodyLabel: string; bodyPlaceholder: string; cta: string; success: string }> = {
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

  useLockBodyScroll()

  function selectTab(key: TabKey) {
    setTab(key)
    setCategory('')
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

  const isCompliment = tab === 'feedback' && category === 'Compliment'
  const copy = isCompliment ? COMPLIMENT_COPY : TAB_COPY[tab]
  const categories = tab === 'problem' ? PROBLEM_CATEGORIES : FEEDBACK_CATEGORIES

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
      form.set('requestType', tab)
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
      onClick={onClose}
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

        {/* Tabs + Rate Us */}
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
            {XPADITE_REVIEW_URL ? (
              <a
                href={XPADITE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[12px] whitespace-nowrap inline-flex items-center gap-1"
                style={{ padding: '7px 13px', borderRadius: 7, fontWeight: 500, color: '#7c3aed' }}
              >
                ✨ Rate Us <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span
                title="Rate Us is coming soon"
                aria-disabled="true"
                className="text-[12px] whitespace-nowrap inline-flex items-center gap-1"
                style={{ padding: '7px 13px', borderRadius: 7, fontWeight: 500, color: 'var(--xp-txt3)', opacity: 0.55, cursor: 'default' }}
              >
                ✨ Rate Us <span aria-hidden="true">↗</span>
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          <div className="flex flex-col lg:flex-row gap-6 p-5">
            <div className="flex-1 min-w-0 lg:max-w-[480px]">{formNode}</div>
            <div className="lg:w-[260px] flex-shrink-0">{contactAndTips}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
