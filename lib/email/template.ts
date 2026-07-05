/**
 * Reminder email template builder.
 * Pure function — no network calls, no env var reads. Safe to import anywhere.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReminderEmailInput {
  taskText: string          // e.g. "💻 Build the login page"
  recipientEmail: string    // used to extract first name as fallback greeting
  appUrl: string            // CTA destination
  reminderTime?: string     // "HH:MM" 24-hour → shown as "6:00 PM PST"
  repeatFrequency?: string  // 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  streakDays?: number       // ≥ 3 renders contextual streak celebration
  displayName?: string      // preferred greeting name (e.g. from user profile)
  timezone?: string         // IANA timezone for displaying TZ abbreviation, e.g. "America/Vancouver"
}

export interface BuiltEmail {
  subject: string
  html: string
  text: string
}

// ─── Content helpers ──────────────────────────────────────────────────────────

const MOTIVATIONAL_QUOTES = [
  'Small wins every day lead to extraordinary results.',
  'Progress compounds. Show up again.',
  'Consistency beats intensity every time.',
  'Excellence is built one session at a time.',
  "Today's effort becomes tomorrow's advantage.",
  'Discipline creates freedom.',
  'Momentum starts with a single action.',
  "Your future self is counting on today's choices.",
  'The session you almost skipped is often the most important.',
  'Habits are built in the quiet moments. This is one of them.',
]

// Words that must never appear as a greeting name
const BLOCKED_NAMES = new Set([
  'xpadite', 'admin', 'test', 'user', 'noreply', 'no', 'donotreply',
  'hello', 'support', 'info', 'contact', 'mail', 'email', 'team',
  'notifications', 'alerts', 'reminders', 'help', 'accounts',
  // Honorifics — must not become a greeting ("Hi Mr,")
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir',
])

function randomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]
}

/**
 * Extracts a capitalised first name from an email local-part.
 * Rejects entries that are too short, contain digits, or match blocked words.
 * "john.doe@example.com" → "John"
 * "craigpr23@gmail.com"  → null  (contains digits)
 * "xpadite@example.com"  → null  (blocked word)
 */
function extractFirstName(email: string): string | null {
  const local   = email.split('@')[0] ?? ''
  const segment = local.split(/[._+\-]/)[0] ?? ''
  if (!/^[a-zA-Z]{2,}$/.test(segment)) return null
  if (BLOCKED_NAMES.has(segment.toLowerCase())) return null
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
}

function buildGreeting(displayName: string | undefined, email: string): string {
  if (displayName?.trim()) {
    // Extract just the first name from a full name like "Craig Richer" → "Craig".
    // Skip leading honorifics ("Mr. Craig Richer" → "Craig").
    const parts = displayName.trim().split(/\s+/)
    for (const part of parts) {
      const clean = part.replace(/\.$/, '') // strip trailing period e.g. "Mr."
      if (
        clean.length >= 2 &&
        /^[a-zA-ZÀ-ɏ]+$/.test(clean) && // letters only (handles accented chars)
        !BLOCKED_NAMES.has(clean.toLowerCase())
      ) {
        return `Hi ${clean},`
      }
    }
  }
  const first = extractFirstName(email)
  if (first) return `Hi ${first},`
  return 'Hello,'
}

function formatTime(hhmm: string, tz?: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h      = parseInt(hStr ?? '0', 10)
  const m      = parseInt(mStr ?? '0', 10)
  const period = h < 12 ? 'AM' : 'PM'
  const h12    = h % 12 || 12
  const base   = `${h12}:${m.toString().padStart(2, '0')} ${period}`

  if (!tz) return base
  try {
    const abbr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value ?? ''
    return abbr ? `${base} ${abbr}` : base
  } catch {
    return base
  }
}

function formatFrequency(freq: string): string {
  const labels: Record<string, string> = {
    once: 'One-time', daily: 'Daily', weekly: 'Weekly',
    monthly: 'Monthly', yearly: 'Yearly',
  }
  return labels[freq] ?? freq.charAt(0).toUpperCase() + freq.slice(1)
}

// ─── Streak celebration ───────────────────────────────────────────────────────

function buildStreakSection(streakDays: number | undefined): string {
  if (!streakDays || streakDays < 3) return ''

  let icon: string, headline: string, body: string

  if (streakDays >= 100) {
    icon     = '👑'
    headline = 'Xpadite Elite'
    body     = `<strong>${streakDays}-Day Streak.</strong> This level of consistency is rare. Keep leading by example.`
  } else if (streakDays >= 30) {
    icon     = '💎'
    headline = 'Elite Discipline'
    body     = `<strong>${streakDays}-Day Streak.</strong> You&rsquo;re building something extraordinary.`
  } else if (streakDays >= 7) {
    icon     = '🏆'
    headline = 'Great Consistency'
    body     = `You&rsquo;re on a <strong>${streakDays}-day streak!</strong> Your habits are becoming your lifestyle.`
  } else {
    icon     = '🔥'
    headline = 'Momentum Building'
    body     = `You&rsquo;re currently on a <strong>${streakDays}-day streak.</strong> Keep showing up.`
  }

  return `
        <!--streak-celebration-->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 28px;">
          <tr>
            <td align="center" style="background:#ffffff;border:1px solid #e8eaee;border-radius:14px;padding:26px 28px 22px;box-shadow:0 1px 8px rgba(0,0,0,0.04);">
              <div style="font-size:28px;line-height:1;margin-bottom:10px;">${icon}</div>
              <div style="font-size:13px;font-weight:700;color:#1a1f2e;letter-spacing:0.01em;margin-bottom:8px;">${headline}</div>
              <div style="font-size:13px;color:#6b7280;line-height:1.75;max-width:300px;margin:0 auto;">${body}</div>
            </td>
          </tr>
        </table>`
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

interface Stat { emoji: string; label: string; value: string }

/**
 * Renders individual mini stat cards side by side.
 * Each card has its own background, border, and shadow.
 * 10px spacer cells provide gutters between cards.
 * On mobile (≤600px) cards stack vertically via CSS display:block.
 */
function buildStatCards(stats: Stat[]): string {
  if (stats.length === 0) return ''

  const cells: string[] = []
  stats.forEach((s, i) => {
    cells.push(
      `<td class="stat-cell" valign="top" align="center"` +
      ` style="background:#f8f9fc;border:1px solid #eaebef;border-radius:12px;` +
      `padding:20px 10px 18px;text-align:center;">` +
      `<div style="font-size:22px;line-height:1;margin-bottom:8px;">${s.emoji}</div>` +
      `<div style="font-size:10px;font-weight:700;color:#a8b0be;text-transform:uppercase;` +
      `letter-spacing:0.09em;margin-bottom:6px;">${s.label}</div>` +
      `<div style="font-size:16px;font-weight:800;color:#0f1117;letter-spacing:-0.01em;">${s.value}</div>` +
      `</td>`,
    )
    if (i < stats.length - 1) {
      cells.push(
        `<td class="stat-spacer" width="10" style="font-size:0;line-height:0;">&nbsp;</td>`,
      )
    }
  })

  return `
        <!--stat-cards-->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 32px;">
          <tr>
            ${cells.join('\n            ')}
          </tr>
        </table>`
}

// ─── Template ─────────────────────────────────────────────────────────────────

export function buildReminderEmail({
  taskText,
  recipientEmail,
  appUrl,
  reminderTime,
  repeatFrequency,
  streakDays,
  displayName,
  timezone,
}: ReminderEmailInput): BuiltEmail {

  const greeting  = buildGreeting(displayName, recipientEmail)
  const quote     = randomQuote()
  const subject   = `Reminder: ${taskText}`
  const logoUrl   = `${appUrl}/logo-icon.png`

  // Build stats — only include slots that have data
  const stats: Stat[] = []
  if (streakDays !== undefined && streakDays > 0) {
    stats.push({ emoji: '🔥', label: 'Current Streak', value: `${streakDays} Days` })
  }
  if (reminderTime) {
    stats.push({ emoji: '⏰', label: 'Scheduled', value: formatTime(reminderTime, timezone) })
  }
  if (repeatFrequency) {
    stats.push({ emoji: '🔔', label: 'Repeat', value: formatFrequency(repeatFrequency) })
  }

  const streakHtml = buildStreakSection(streakDays)
  const statsHtml  = buildStatCards(stats)

  // ── HTML ──────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${subject}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
    body{margin:0;padding:0;width:100%!important}
    /* Hover enhancement — supported by Apple Mail and some desktop clients */
    .cta-btn:hover{background-color:#6d28d9!important;box-shadow:0 8px 28px rgba(109,40,217,0.38)!important}
    /* Mobile */
    @media screen and (max-width:600px){
      .outer-pad{padding:24px 12px 32px!important}
      .card{padding:30px 20px 26px!important}
      .task-name{font-size:24px!important}
      .cta-btn{display:block!important;text-align:center!important;padding:16px 20px!important}
      .stat-cell{display:block!important;width:100%!important;box-sizing:border-box!important;margin-bottom:10px!important}
      .stat-spacer{display:none!important;width:0!important;height:0!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<!--page-wrapper-->
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f5f6f8">
  <tr>
    <td class="outer-pad" align="center" style="padding:52px 16px 44px;">

      <!--content-limiter-->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:560px;">

        <!--====== LOGO + BRAND LABEL ======-->
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <img src="${logoUrl}" alt="Xpadite" width="52" height="52"
                 style="display:block;border-radius:14px;border:1px solid rgba(0,0,0,0.07);margin:0 auto 14px;">
            <span style="font-size:11px;font-weight:600;color:#a8b0be;text-transform:uppercase;letter-spacing:0.14em;">
              Xpadite Reminder
            </span>
          </td>
        </tr>

        <!--====== CARD ======-->
        <tr>
          <td class="card" style="background:#ffffff;border-radius:20px;border:1px solid #e3e5eb;padding:44px 48px 40px;box-shadow:0 2px 20px rgba(0,0,0,0.05);">

            <!--── GREETING ──-->
            <p style="margin:0 0 30px;font-size:16px;font-weight:500;color:#374151;line-height:1.5;">
              ${greeting}
            </p>

            <!--── EYEBROW ──-->
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#a8b0be;letter-spacing:0.11em;text-transform:uppercase;">
              It&rsquo;s time to work on
            </p>

            <!--── TASK NAME ──-->
            <p class="task-name" style="margin:0 0 32px;font-size:30px;font-weight:800;color:#0f1117;line-height:1.2;letter-spacing:-0.02em;">
              ${taskText}
            </p>

            <!--── DIVIDER ──-->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
              <tr>
                <td style="border-top:1px solid #f0f2f5;font-size:0;line-height:0;padding:0;">&nbsp;</td>
              </tr>
            </table>

            <!--── MOTIVATIONAL MESSAGE ──-->
            <p style="margin:24px 0 4px;font-size:15px;font-weight:700;color:#1a1f2e;">
              Stay consistent.
            </p>
            <p style="margin:0 0 ${streakHtml || statsHtml ? '32px' : '36px'};font-size:14px;color:#9ca3af;line-height:1.8;font-style:italic;">
              ${quote}
            </p>

            <!--── STREAK CELEBRATION (conditional — hidden if streak < 3) ──-->
            ${streakHtml}

            <!--── STAT CARDS (conditional — hidden if no data) ──-->
            ${statsHtml}

            <!--── CTA BUTTON ──-->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
              <tr>
                <td align="center">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                    href="${appUrl}"
                    style="height:52px;v-text-anchor:middle;width:196px;"
                    arcsize="50%" stroke="f" fillcolor="#7c3aed">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:700;">Open Xpadite</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a class="cta-btn" href="${appUrl}"
                     style="display:inline-block;background:#7c3aed;color:#ffffff!important;font-size:15px;font-weight:700;letter-spacing:0.03em;text-decoration:none;padding:15px 48px;border-radius:50px;transition:background-color 0.18s ease,box-shadow 0.18s ease;mso-hide:all;">
                    Open Xpadite
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!--====== FOOTER ======-->
        <tr>
          <td align="center" style="padding:32px 24px 0;">

            <p style="margin:0 0 12px;font-size:13px;color:#9ca3af;line-height:1.7;">
              Need to reschedule this reminder?<br>
              <a href="${appUrl}" style="color:#7c3aed;text-decoration:none;font-weight:600;">Manage your reminders inside Xpadite.</a>
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
              <tr>
                <td style="border-top:1px solid #edeef2;font-size:0;line-height:0;padding:0;margin-bottom:14px;">&nbsp;</td>
              </tr>
            </table>

            <p style="margin:12px 0 4px;font-size:12px;color:#c4c8d4;line-height:1.7;">
              You&rsquo;re receiving this email because you created a reminder in Xpadite.
            </p>

            <p style="margin:0 0 4px;font-size:12px;color:#c4c8d4;">
              &copy; 2026 Xpadite
            </p>

            <p style="margin:0;">
              <a href="${appUrl}" style="font-size:12px;color:#c4c8d4;text-decoration:none;">www.xpadite.com</a>
            </p>

          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`

  // ── Plain-text fallback ───────────────────────────────────────────────────
  const statLines = stats.map(s => `${s.emoji} ${s.label}: ${s.value}`)

  let streakLine = ''
  if (streakDays && streakDays >= 3) {
    if (streakDays >= 100) {
      streakLine = `\n👑 Xpadite Elite — ${streakDays}-Day Streak\nThis level of consistency is rare. Keep leading by example.\n`
    } else if (streakDays >= 30) {
      streakLine = `\n💎 Elite Discipline — ${streakDays}-Day Streak\nYou're building something extraordinary.\n`
    } else if (streakDays >= 7) {
      streakLine = `\n🏆 Great Consistency — ${streakDays}-day streak!\nYour habits are becoming your lifestyle.\n`
    } else {
      streakLine = `\n🔥 Momentum Building — ${streakDays}-day streak\nKeep showing up.\n`
    }
  }

  const text = [
    greeting,
    '',
    `It's time to work on: ${taskText}`,
    '',
    'Stay consistent.',
    quote,
    streakLine,
    ...(statLines.length > 0 ? [...statLines, ''] : []),
    `Open Xpadite: ${appUrl}`,
    '',
    '---',
    'Need to reschedule this reminder? Manage your reminders inside Xpadite.',
    appUrl,
    '',
    "You're receiving this email because you created a reminder in Xpadite.",
    `© 2026 Xpadite — www.xpadite.com`,
  ].join('\n')

  return { subject, html, text }
}
