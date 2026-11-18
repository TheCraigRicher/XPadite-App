'use client'

// v1.349 — the browser side of "Send via Email": opens the user's own mail app with the prepared text (mailto:), or — when the text is too long for a
// mailto: link — puts the FULL text on the clipboard and opens the composer with the subject. Nothing is ever truncated, nothing is stored or marked as
// sent, and the source document is never touched. Shared by the Planner section menu and the Library card menus.
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { planEmail, type EmailContent } from './emailShare'
import { useEscapeLayer } from './escapeLayers'

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/** Starts the copy synchronously (inside the user's click) and resolves to whether it worked. */
function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text))
  } catch { /* fall through */ }
  return Promise.resolve(legacyCopy(text))
}

function openMailto(url: string) {
  const a = document.createElement('a')
  a.href = url; a.style.display = 'none'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function ManualCopyDialog({ email, isDark, onClose }: { email: EmailContent; isDark: boolean; onClose: () => void }) {
  useEscapeLayer(true, () => onClose())
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Copy the text for your email" data-testid="email-copy-dialog" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 420, background: isDark ? '#1e1b2e' : '#fff', color: isDark ? '#f1f5f9' : '#0f172a', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Copy this into your email</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>This is too long to open in an email automatically and your browser blocked copying. Select all, copy, then paste it into a new email.</div>
        <textarea readOnly autoFocus value={email.body} onFocus={e => e.currentTarget.select()}
          style={{ width: '100%', height: 200, fontSize: 12, borderRadius: 8, padding: 8, border: '0.5px solid rgba(124,58,237,0.4)', background: isDark ? 'rgba(255,255,255,0.05)' : '#f8f7ff', color: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        <button type="button" onClick={onClose} style={{ alignSelf: 'flex-end', padding: '7px 16px', borderRadius: 8, border: 'none', background: 'rgba(124,58,237,0.92)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Done</button>
      </div>
    </div>, document.body)
}

export function useEmailShare(setToast: (m: string) => void, isDark: boolean) {
  const [manual, setManual] = useState<EmailContent | null>(null)
  const share = useCallback((e: EmailContent) => {
    if (e.empty) { setToast('This is empty — there is nothing to send.'); return }
    const plan = planEmail(e)
    if (!plan.tooLong) {
      openMailto(plan.mailto)
      setToast(e.skippedMedia ? 'Opening your email app — images and mind maps are not included in the text.' : 'Opening your email app…')
      return
    }
    const copied = copyText(plan.clipboardText)     // started inside the click, before the composer opens
    openMailto(plan.mailto)
    void copied.then(ok => {
      if (ok) setToast('Too long to pre-fill — the full text is on your clipboard. Paste it into the email.')
      else setManual(e)
    })
  }, [setToast])
  const dialog = manual ? <ManualCopyDialog email={manual} isDark={isDark} onClose={() => setManual(null)} /> : null
  return { share, dialog }
}
