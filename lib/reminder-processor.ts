/**
 * Reminder processor.
 * Server-only — runs inside the /api/reminders/process Vercel Cron endpoint.
 *
 * Responsibilities:
 *   1. Query Supabase for active, email-enabled reminders that are due.
 *   2. Build and send a branded email via Resend.
 *   3. Advance nextRunAt (repeating) or deactivate (once) after a successful send.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildReminderEmail } from '@/lib/email/template'
import { sendEmail }          from '@/lib/email/resend'
import { computeNextRunAt }   from '@/lib/scheduling'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a row returned from the reminders table. */
interface ReminderRow {
  id: string
  user_id: string
  task_text: string
  reminder_time: string
  repeat_frequency: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  email_address: string
  next_run_at: number
  last_sent_at: number | null
  timezone: string | null
}

export interface ProcessResult {
  /** Total reminders examined */
  processed: number
  /** Emails successfully sent */
  sent: number
  /** Send failures */
  errors: number
  /** Reminders skipped (no email address, already sent, etc.) */
  skipped: number
}

// ─── App URL ──────────────────────────────────────────────────────────────────

/**
 * Resolve the public app URL from environment variables.
 * Priority: NEXT_PUBLIC_APP_URL → VERCEL_URL (auto-injected) → fallback.
 */
function resolveAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL)          return `https://${process.env.VERCEL_URL}`
  return 'https://xpadite.app'
}

// ─── Core processor ───────────────────────────────────────────────────────────

/**
 * Process all due email reminders.
 * Called once per cron invocation with a service-role Supabase client.
 */
export async function processReminders(supabase: SupabaseClient): Promise<ProcessResult> {
  const now       = Date.now()
  const fromEmail = process.env.REMINDER_FROM_EMAIL ?? 'Xpadite <reminders@xpadite.app>'
  const appUrl    = resolveAppUrl()

  const result: ProcessResult = { processed: 0, sent: 0, errors: 0, skipped: 0 }

  // ── Diagnostic: inspect all active+email reminders regardless of next_run_at ──
  // This query deliberately omits the lte filter so we can log every candidate
  // and see exactly why any are not being processed.
  const { data: diagRows, error: diagError } = await supabase
    .from('reminders')
    .select('id, is_active, email_enabled, next_run_at, email_address')

  if (diagError) {
    console.error('[Processor] Diagnostic query failed:', diagError.message)
  } else {
    const allCount   = (diagRows ?? []).length
    const activeEmail = (diagRows ?? []).filter(r => r.is_active && r.email_enabled)
    console.log(`[Processor] now=${now} (${new Date(now).toISOString()})`)
    console.log(`[Processor] Total rows in reminders table: ${allCount}`)
    console.log(`[Processor] Rows with is_active=true AND email_enabled=true: ${activeEmail.length}`)
    for (const r of activeEmail) {
      const nra  = Number(r.next_run_at)
      const diff = now - nra
      const due  = diff >= 0
      console.log(
        `[Processor] id=${r.id}` +
        ` next_run_at=${nra} (${new Date(nra).toISOString()})` +
        ` diff=${diff}ms` +
        ` due=${due}` +
        ` email="${r.email_address ?? ''}"`,
      )
    }
    // Log rows excluded for other reasons
    for (const r of (diagRows ?? [])) {
      if (!r.is_active)    console.log(`[Processor] id=${r.id} excluded: is_active=false`)
      if (!r.email_enabled) console.log(`[Processor] id=${r.id} excluded: email_enabled=false`)
    }
  }

  // ── 1. Fetch due email reminders ──────────────────────────────────────────
  // next_run_at is stored as BIGINT (Unix milliseconds); now is Date.now() (ms).
  // The lte filter passes now as a numeric literal — no timestamptz involved.

  const { data, error: fetchError } = await supabase
    .from('reminders')
    .select('id, user_id, task_text, reminder_time, repeat_frequency, email_address, next_run_at, last_sent_at, timezone')
    .eq('is_active', true)
    .eq('email_enabled', true)
    .lte('next_run_at', now)

  if (fetchError) {
    // Re-throw so the route can return a 500 with context
    throw new Error(`Supabase query failed: ${fetchError.message}`)
  }

  const rows = (data ?? []) as ReminderRow[]
  console.log(`[Processor] Due reminders fetched (next_run_at <= ${now}): ${rows.length}`)

  // ── 2a. Batch-fetch display names from profiles ───────────────────────────
  // Keyed by user_id → full_name (or null). Used for personalised greetings.
  const profileMap = new Map<string, string | null>()
  if (rows.length > 0) {
    const userIds = [...new Set(rows.map(r => r.user_id))]
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileMap.set(p.id as string, (p.full_name as string | null) ?? null)
    }
  }

  // ── 3. Process each due reminder ──────────────────────────────────────────

  for (const row of rows) {
    result.processed++

    // Skip rows with no email address
    if (!row.email_address?.trim()) {
      console.log(`[Processor] Skipping id=${row.id}: email_address is empty`)
      result.skipped++
      continue
    }

    // ── 3a. Build and send the email ────────────────────────────────────────

    const displayName = profileMap.get(row.user_id) ?? undefined
    const timezone    = row.timezone ?? undefined

    const { subject, html, text } = buildReminderEmail({
      taskText:        row.task_text,
      recipientEmail:  row.email_address,
      appUrl,
      reminderTime:    row.reminder_time,
      repeatFrequency: row.repeat_frequency,
      displayName,
      timezone,
    })

    const sendResult = await sendEmail({
      to:      row.email_address,
      from:    fromEmail,
      subject,
      html,
      text,
    })

    if (!sendResult.success) {
      console.error(`[Processor] Email failed for reminder ${row.id}:`, sendResult.error)
      result.errors++
      continue  // Do NOT advance the schedule on failure — retry next cron run
    }

    result.sent++

    // ── 3b. Advance or deactivate ────────────────────────────────────────────

    const isOnce = row.repeat_frequency === 'once'
    const nextRunAt = isOnce
      ? row.next_run_at  // unchanged — row will be deactivated
      : computeNextRunAt(row.reminder_time, row.repeat_frequency, now, row.timezone ?? undefined)

    const { error: updateError } = await supabase
      .from('reminders')
      .update({
        is_active:    !isOnce,
        last_sent_at: now,
        next_run_at:  nextRunAt,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', row.id)

    if (updateError) {
      // Log but don't abort — the email was already sent
      console.error(`[Processor] DB update failed for reminder ${row.id}:`, updateError.message)
    }
  }

  return result
}
