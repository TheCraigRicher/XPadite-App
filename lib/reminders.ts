import { createClient } from '@/lib/supabase/client'
import type { Reminder } from '@/components/xpadite/types'
import { computeNextRunAt } from '@/lib/scheduling'

// Re-export so existing callers (AppContext, ReminderModal) don't need import changes.
export { computeNextRunAt }

// ─── DB row → Reminder ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToReminder(row: Record<string, any>): Reminder {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    dateKey: row.date_key as string,
    taskText: row.task_text as string,
    reminderTime: row.reminder_time as string,
    repeatFrequency: row.repeat_frequency as Reminder['repeatFrequency'],
    soundEnabled: row.sound_enabled as boolean,
    browserNotificationEnabled: row.browser_notification_enabled as boolean,
    emailEnabled: row.email_enabled as boolean,
    emailAddress: row.email_address as string,
    isActive: row.is_active as boolean,
    nextRunAt: Number(row.next_run_at),
    lastSentAt: row.last_sent_at != null ? Number(row.last_sent_at) : null,
    localFiredAt: null,                  // local-only, never stored in Supabase
    timezone: row.timezone ?? undefined, // nullable in DB; undefined triggers fallback
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function fetchReminders(): Promise<Reminder[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('reminders')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  return (data ?? []).map(rowToReminder)
}

export async function upsertReminder(
  reminder: (Omit<Reminder, 'id'> & { id?: string }),
  userId: string,
): Promise<Reminder | null> {
  const supabase = createClient()
  const row = {
    ...(reminder.id ? { id: reminder.id } : {}),
    user_id: userId,
    task_id: reminder.taskId,
    date_key: reminder.dateKey,
    task_text: reminder.taskText,
    reminder_time: reminder.reminderTime,
    repeat_frequency: reminder.repeatFrequency,
    sound_enabled: reminder.soundEnabled,
    browser_notification_enabled: reminder.browserNotificationEnabled,
    email_enabled: reminder.emailEnabled,
    email_address: reminder.emailAddress,
    is_active: reminder.isActive,
    next_run_at: reminder.nextRunAt,
    last_sent_at: reminder.lastSentAt,
    timezone: reminder.timezone ?? null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('reminders')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()
  if (error) {
    console.error('[Reminders] upsertReminder error:', error.message, '| code:', error.code, '| details:', error.details)
    return null
  }
  if (!data) {
    console.error('[Reminders] upsertReminder: no data returned from Supabase')
    return null
  }
  return rowToReminder(data)
}

export async function deleteReminder(id: string): Promise<void> {
  const supabase = createClient()
  await supabase.from('reminders').delete().eq('id', id)
}

export async function patchReminder(
  id: string,
  patch: Partial<{ isActive: boolean; nextRunAt: number; lastSentAt: number }>,
): Promise<void> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() }
  if (patch.isActive !== undefined)   row.is_active    = patch.isActive
  if (patch.nextRunAt !== undefined)  row.next_run_at  = patch.nextRunAt
  if (patch.lastSentAt !== undefined) row.last_sent_at = patch.lastSentAt
  await supabase.from('reminders').update(row).eq('id', id)
}
