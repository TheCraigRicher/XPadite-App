/**
 * POST /api/support/submit — Help & Feedback modal submission (V1).
 *
 * Flow: authenticate → validate → (optional) upload attachment → persist to
 * support_requests → best-effort Resend notification. The database write is
 * the critical operation: once the row is safely stored, a Resend failure is
 * logged server-side only and never surfaces to the user or removes the row.
 *
 * Uses the caller's own session-scoped Supabase client throughout (never
 * service-role) — RLS on support_requests and the support-attachments bucket
 * already restricts everything to auth.uid(), which is exactly the scope
 * this endpoint needs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/resend'
import {
  APP_VERSION,
  PROBLEM_CATEGORIES,
  FEEDBACK_CATEGORIES,
  type SupportRequestType,
} from '@/lib/config/support'

const REQUEST_TYPES: SupportRequestType[] = ['help', 'problem', 'feedback']
const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TEXT_LENGTH = 5000
const BUCKET = 'support-attachments'

const REQUEST_TYPE_LABEL: Record<SupportRequestType, string> = {
  help: 'Get Help',
  problem: 'Report Problem',
  feedback: 'Feedback',
}

function parseUserAgent(ua: string): { deviceType: string; browser: string; os: string } {
  const isTablet = /iPad|Tablet/i.test(ua)
  const isMobile = !isTablet && /Mobi|Android|iPhone/i.test(ua)
  const deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop'

  let browser = 'Unknown'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/CriOS\//.test(ua)) browser = 'Chrome (iOS)'
  else if (/FxiOS\//.test(ua)) browser = 'Firefox (iOS)'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari'

  let os = 'Unknown'
  if (/Windows/.test(ua)) os = 'Windows'
  else if (/Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) os = 'macOS'
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Linux/.test(ua)) os = 'Linux'

  return { deviceType, browser, os }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid submission.' }, { status: 400 })
  }

  const requestType = String(form.get('requestType') ?? '') as SupportRequestType
  const category = String(form.get('category') ?? '').trim() || null
  const subject = String(form.get('subject') ?? '').trim()
  const message = String(form.get('message') ?? '').trim()
  const currentPath = String(form.get('currentPath') ?? '').slice(0, 300) || null
  const attachment = form.get('attachment')

  if (!REQUEST_TYPES.includes(requestType)) {
    return NextResponse.json({ ok: false, error: 'Invalid request type.' }, { status: 400 })
  }
  if (!subject || subject.length > 300) {
    return NextResponse.json({ ok: false, error: 'Please enter a subject.' }, { status: 400 })
  }
  if (!message || message.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ ok: false, error: 'Please enter a message.' }, { status: 400 })
  }
  if (requestType === 'problem' && category && !(PROBLEM_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 })
  }
  if (requestType === 'feedback' && category && !(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 })
  }

  // ── Optional attachment upload ────────────────────────────────────────────
  let attachmentPath: string | null = null
  if (attachment instanceof File && attachment.size > 0) {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(attachment.type)) {
      return NextResponse.json({ ok: false, error: 'Attachments must be an image (JPEG, PNG, WEBP, or GIF).' }, { status: 400 })
    }
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ ok: false, error: 'Attachment is too large. Please use an image under 5MB.' }, { status: 400 })
    }
    const ext = attachment.type.split('/')[1] ?? 'jpg'
    const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, attachment, { contentType: attachment.type })
    if (uploadError) {
      console.error('[Support] Attachment upload failed:', uploadError)
      return NextResponse.json({ ok: false, error: 'Could not upload attachment. Please try again.' }, { status: 500 })
    }
    attachmentPath = path
  }

  // ── Automatic technical metadata (never manually entered) ────────────────
  const ua = req.headers.get('user-agent') ?? ''
  const { deviceType, browser, os } = parseUserAgent(ua)

  // ── Persist — the critical operation ──────────────────────────────────────
  const { data: inserted, error: insertError } = await supabase
    .from('support_requests')
    .insert({
      user_id: user.id,
      request_type: requestType,
      category,
      subject,
      message,
      attachment_path: attachmentPath,
      user_email: user.email ?? null,
      app_version: APP_VERSION,
      device_type: deviceType,
      browser,
      os,
      current_path: currentPath,
    })
    .select('id, created_at')
    .single()

  if (insertError || !inserted) {
    console.error('[Support] Insert failed:', insertError)
    if (attachmentPath) {
      await supabase.storage.from(BUCKET).remove([attachmentPath]).catch(() => {})
    }
    return NextResponse.json({ ok: false, error: 'Could not submit your request. Please try again.' }, { status: 500 })
  }

  // ── Best-effort notification — never blocks or undoes the stored request ──
  const notifyTo = process.env.SUPPORT_NOTIFICATION_EMAIL
  const fromEmail = process.env.REMINDER_FROM_EMAIL ?? 'XPadite <noreply@xpadite.app>'
  if (notifyTo) {
    const label = REQUEST_TYPE_LABEL[requestType]
    const submittedAt = new Date(inserted.created_at as string).toLocaleString('en-US')
    const rows: [string, string][] = [
      ['Request Type', label],
      ['Category', category ?? '—'],
      ['Subject', subject],
      ['User Email', user.email ?? '—'],
      ['User ID', user.id],
      ['Submitted', submittedAt],
      ['Device Type', deviceType],
      ['Browser', browser],
      ['OS', os],
      ['Current Route', currentPath ?? '—'],
      ['Attachment', attachmentPath ? 'Yes (see Supabase Storage / support-attachments)' : 'None'],
    ]
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb">
  <div style="background:white;border-radius:16px;padding:28px;border:1px solid #e5e7eb">
    <h2 style="color:#7c3aed;margin:0 0 16px;font-size:18px">[XPADITE SUPPORT] ${escapeHtml(label)} — ${escapeHtml(subject)}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1e1b4b">
      ${rows.map(([k, v]) => `<tr><td style="padding:4px 8px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <div style="background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px;padding:14px 16px;margin-top:18px;white-space:pre-wrap;font-size:13px;color:#1e1b4b">${escapeHtml(message)}</div>
  </div>
</div>`
    const text = `[XPADITE SUPPORT] ${label} — ${subject}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${message}`

    const result = await sendEmail({
      to: notifyTo,
      from: fromEmail,
      subject: `[XPADITE SUPPORT] ${label} — ${subject}`,
      html,
      text,
    })
    if (!result.success) {
      console.error('[Support] Resend notification failed (request already stored):', result.error)
    }
  } else {
    console.error('[Support] SUPPORT_NOTIFICATION_EMAIL not configured — skipping notification')
  }

  return NextResponse.json({ ok: true })
}
