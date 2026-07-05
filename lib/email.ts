// Email delivery via Resend (https://resend.com)
// Required env vars in .env.local:
//   RESEND_API_KEY=re_xxxx
//   REMINDER_FROM_EMAIL=Xpadite <reminders@yourdomain.com>

export async function sendReminderEmail(to: string, taskText: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.REMINDER_FROM_EMAIL ?? 'Xpadite <reminders@xpadite.app>'

  if (!apiKey) {
    console.error('[Reminders] RESEND_API_KEY not set')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Xpadite Reminder: ${taskText}`,
        html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9fafb">
  <div style="background:white;border-radius:16px;padding:28px;border:1px solid #e5e7eb">
    <h2 style="color:#7c3aed;margin:0 0 12px;font-size:18px">🔔 Xpadite Reminder</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 16px">Time for your task:</p>
    <div style="background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px;padding:12px 16px;margin-bottom:24px">
      <p style="color:#1e1b4b;font-weight:600;font-size:15px;margin:0">${taskText}</p>
    </div>
    <p style="color:#9ca3af;font-size:11px;margin:0">Sent by Xpadite · Your productivity companion</p>
  </div>
</div>`,
      }),
    })
    return res.ok
  } catch (err) {
    console.error('[Reminders] Email failed:', err)
    return false
  }
}
