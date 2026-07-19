import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const RESEND_API_URL = 'https://api.resend.com/emails'

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function buildHtml(name: string, dateLabel: string, stats: { totalMs: number; completedTasks: number; totalTasks: number; score: number } | null): string {
  const greeting = name ? `Hey ${name}` : 'Hey there'
  const worked   = stats ? fmtMs(stats.totalMs) : '—'
  const tasks    = stats ? `${stats.completedTasks}/${stats.totalTasks}` : '—'
  const score    = stats ? `${stats.score}/100` : '—'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Your XPadite Dashboard — ${dateLabel}</title>
</head>
<body style="margin:0;padding:0;background:#0d0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d14;padding:32px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#1a0a3a,#0f1535);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
        <div style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:10px;padding:8px 14px;margin-bottom:12px;">
          <span style="color:#fff;font-size:14px;font-weight:700;letter-spacing:1.5px;">XPADITE</span>
        </div>
        <h1 style="margin:0;color:#e2e8f0;font-size:20px;font-weight:700;">Your Progress Snapshot</h1>
        <p style="margin:6px 0 0;color:rgba(167,139,250,0.75);font-size:13px;">${dateLabel}</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#12103a;padding:28px 32px;">
        <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;">${greeting} 👋,</p>
        <p style="margin:0 0 24px;color:#94a3b8;font-size:13px;line-height:1.6;">
          Here's a snapshot of your productivity dashboard. Your full dashboard image is attached below.
        </p>

        <!-- KPI strip -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td width="33%" style="background:rgba(124,58,237,0.12);border:0.5px solid rgba(124,58,237,0.28);border-radius:10px;padding:14px 10px;text-align:center;">
              <div style="color:#a78bfa;font-size:18px;font-weight:800;">${worked}</div>
              <div style="color:rgba(148,163,184,0.65);font-size:10px;margin-top:3px;">Time Worked</div>
            </td>
            <td width="4%"></td>
            <td width="29%" style="background:rgba(34,197,94,0.08);border:0.5px solid rgba(34,197,94,0.22);border-radius:10px;padding:14px 10px;text-align:center;">
              <div style="color:#4ade80;font-size:18px;font-weight:800;">${tasks}</div>
              <div style="color:rgba(148,163,184,0.65);font-size:10px;margin-top:3px;">Tasks Done</div>
            </td>
            <td width="4%"></td>
            <td width="30%" style="background:rgba(249,115,22,0.08);border:0.5px solid rgba(249,115,22,0.22);border-radius:10px;padding:14px 10px;text-align:center;">
              <div style="color:#fb923c;font-size:18px;font-weight:800;">${score}</div>
              <div style="color:rgba(148,163,184,0.65);font-size:10px;margin-top:3px;">PA Score</div>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 6px;color:rgba(148,163,184,0.45);font-size:10px;line-height:1.5;">
          Full dashboard image is attached to this email as a PNG file.
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#0a0a12;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center;border-top:0.5px solid rgba(255,255,255,0.06);">
        <p style="margin:0;color:rgba(148,163,184,0.35);font-size:10px;line-height:1.5;">
          You requested this snapshot from XPadite. Your data stays on your device and is never stored on our servers.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey     = process.env.RESEND_API_KEY
  const fromEmail  = process.env.REMINDER_FROM_EMAIL ?? 'XPadite <noreply@xpadite.app>'

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Email service not configured' }, { status: 500 })
  }

  // Authenticate via Supabase session cookie
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user?.email) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { imageBase64?: string; dateLabel?: string; stats?: { totalMs: number; completedTasks: number; totalTasks: number; score: number } | null }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const { imageBase64, dateLabel = 'Today', stats = null } = body

  if (!imageBase64) {
    return NextResponse.json({ ok: false, error: 'Missing image data' }, { status: 400 })
  }

  const name = user.user_metadata?.first_name as string | undefined
         ?? user.user_metadata?.full_name?.split(' ')[0] as string | undefined
         ?? ''

  const html = buildHtml(name, dateLabel, stats ?? null)
  const text = `Your XPadite dashboard for ${dateLabel} is attached.`

  let resendStatus = 0
  let resendBody: unknown
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [user.email],
        subject: `Your XPadite Dashboard — ${dateLabel}`,
        html,
        text,
        attachments: [
          {
            filename: `xpadite-dashboard-${dateLabel.replace(/[^a-zA-Z0-9-]/g, '-')}.png`,
            content:  imageBase64,
          },
        ],
      }),
    })
    resendStatus = res.status
    resendBody   = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = resendBody as { message?: string }
      console.error(`[DashboardExport] Resend error (${resendStatus}):`, err.message)
      return NextResponse.json({ ok: false, error: err.message ?? `Resend HTTP ${resendStatus}` }, { status: 502 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error'
    console.error('[DashboardExport] fetch failed:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
