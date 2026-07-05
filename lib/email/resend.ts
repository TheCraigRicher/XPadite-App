/**
 * Resend email delivery service.
 * Server-only — never import this in client components.
 *
 * Required env var:
 *   RESEND_API_KEY  — obtain from https://resend.com/api-keys
 */

const RESEND_API_URL = 'https://api.resend.com/emails'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailPayload {
  to: string
  from: string
  subject: string
  html: string
  text: string
}

export interface EmailResult {
  success: boolean
  /** Resend message ID on success */
  id?: string
  /** Error description on failure */
  error?: string
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.error('[Resend] RESEND_API_KEY is not set')
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  let responseBody: unknown
  let status = 0

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    payload.from,
        to:      [payload.to],
        subject: payload.subject,
        html:    payload.html,
        text:    payload.text,
      }),
    })

    status = res.status
    responseBody = await res.json().catch(() => ({}))

    if (!res.ok) {
      const errBody = responseBody as { message?: string; name?: string }
      const message = errBody.message ?? errBody.name ?? `HTTP ${status}`
      console.error(`[Resend] Delivery failed (${status}):`, message)
      return { success: false, error: message }
    }

    const successBody = responseBody as { id?: string }
    return { success: true, id: successBody.id }

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[Resend] Request failed:', message)
    return { success: false, error: message }
  }
}
