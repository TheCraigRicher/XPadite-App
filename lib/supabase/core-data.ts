import { createClient } from '@/lib/supabase/client'
import type { CalendarData, DayData, WorkSession, Activity, JournalLabel, JournalFolder } from '@/components/xpadite/types'

type Supabase = ReturnType<typeof createClient>

// ── User Preferences ─────────────────────────────────────────────────────────

export interface UserPreferences {
  isDark: boolean
  progressColor: string
  customColors: string[]
}

export async function fetchUserPreferences(
  supabase: Supabase,
  userId: string,
): Promise<UserPreferences | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('is_dark, progress_color, custom_colors')
    .eq('user_id', userId)
    .single()
  if (error || !data) return null
  return {
    isDark: data.is_dark as boolean,
    progressColor: data.progress_color as string,
    customColors: (data.custom_colors as string[] | null) ?? [],
  }
}

export async function upsertUserPreferences(
  supabase: Supabase,
  userId: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId }
  if (prefs.isDark !== undefined) row.is_dark = prefs.isDark
  if (prefs.progressColor !== undefined) row.progress_color = prefs.progressColor
  if (prefs.customColors !== undefined) row.custom_colors = prefs.customColors
  const { error } = await supabase
    .from('user_preferences')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

// ── Calendar Days ─────────────────────────────────────────────────────────────

export async function fetchCalendarDays(
  supabase: Supabase,
  userId: string,
): Promise<CalendarData> {
  const { data, error } = await supabase
    .from('calendar_days')
    .select('date_key, day_data')
    .eq('user_id', userId)
  if (error || !data || data.length === 0) return {}
  const result: CalendarData = {}
  for (const row of data) {
    result[row.date_key as string] = row.day_data as DayData
  }
  return result
}

// Narrow single-row lookup for active-session reconciliation (focus/visibility/
// online) — deliberately separate from fetchCalendarDays above, which returns
// the ENTIRE table and must stay reserved for the one-time initial-load hydration.
// Reconciliation only ever needs to check a specific day's row for a running
// task timer, never the whole history.
export async function fetchCalendarDay(
  supabase: Supabase,
  userId: string,
  dateKey: string,
): Promise<DayData | null> {
  const { data, error } = await supabase
    .from('calendar_days')
    .select('day_data')
    .eq('user_id', userId)
    .eq('date_key', dateKey)
    .maybeSingle()
  if (error || !data) return null
  return data.day_data as DayData
}

export async function upsertDayData(
  supabase: Supabase,
  userId: string,
  dateKey: string,
  dayData: DayData,
): Promise<void> {
  const { error } = await supabase
    .from('calendar_days')
    .upsert(
      { user_id: userId, date_key: dateKey, day_data: dayData },
      { onConflict: 'user_id,date_key' },
    )
  if (error) throw error
}

// ── Work Sessions ────────────────────────────────────────────────────────────

export async function fetchWorkSessions(
  supabase: Supabase,
  userId: string,
): Promise<WorkSession[]> {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('session_id, act_id, act_name, act_color, start_ts, end_ts, date_key')
    .eq('user_id', userId)
    .order('start_ts', { ascending: true })
  if (error || !data || data.length === 0) return []
  return data.map(row => ({
    id: row.session_id as string,
    actId: row.act_id as string,
    actName: row.act_name as string,
    actColor: row.act_color as string,
    startTs: row.start_ts as number,
    endTs: row.end_ts as number | null,
    dateKey: row.date_key as string,
  }))
}

export async function upsertWorkSession(
  supabase: Supabase,
  userId: string,
  session: WorkSession,
): Promise<void> {
  const { error } = await supabase
    .from('work_sessions')
    .upsert(
      {
        user_id: userId,
        session_id: session.id,
        act_id: session.actId,
        act_name: session.actName,
        act_color: session.actColor,
        start_ts: session.startTs,
        end_ts: session.endTs,
        date_key: session.dateKey,
      },
      { onConflict: 'user_id,session_id' },
    )
  if (error) throw error
}

// Narrow lookup for active-session reconciliation — only currently-open
// sessions (end_ts IS NULL), and only the columns needed to reconstruct one.
// fetchWorkSessions above (full history, every column) stays reserved for the
// one-time initial-load hydration.
export async function fetchOpenWorkSessions(
  supabase: Supabase,
  userId: string,
): Promise<WorkSession[]> {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('session_id, act_id, act_name, act_color, start_ts, date_key')
    .eq('user_id', userId)
    .is('end_ts', null)
  if (error || !data || data.length === 0) return []
  return data.map(row => ({
    id: row.session_id as string,
    actId: row.act_id as string,
    actName: row.act_name as string,
    actColor: row.act_color as string,
    startTs: row.start_ts as number,
    endTs: null,
    dateKey: row.date_key as string,
  }))
}

// ── User Activities ──────────────────────────────────────────────────────────

export async function fetchUserActivities(
  supabase: Supabase,
  userId: string,
): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('user_activities')
    .select('activity_id, name, color, emoji, counts_toward_productivity, sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  if (error || !data || data.length === 0) return []
  return data.map(row => ({
    id: row.activity_id as string,
    name: row.name as string,
    color: row.color as string,
    emoji: (row.emoji as string | null) ?? undefined,
    countsTowardProductivity: (row.counts_toward_productivity as boolean | null) ?? undefined,
  }))
}

export async function upsertAllActivities(
  supabase: Supabase,
  userId: string,
  activities: Activity[],
): Promise<void> {
  if (activities.length === 0) return
  const rows = activities.map((a, idx) => ({
    user_id: userId,
    activity_id: a.id,
    name: a.name,
    color: a.color,
    emoji: a.emoji ?? null,
    counts_toward_productivity: a.countsTowardProductivity ?? null,
    sort_order: idx,
  }))
  const { error } = await supabase
    .from('user_activities')
    .upsert(rows, { onConflict: 'user_id,activity_id' })
  if (error) throw error
}

export async function deleteUserActivity(
  supabase: Supabase,
  userId: string,
  activityId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_activities')
    .delete()
    .eq('user_id', userId)
    .eq('activity_id', activityId)
  if (error) throw error
}

// ── Journal Labels (Library custom categories) ──────────────────────────────

export async function fetchJournalLabels(
  supabase: Supabase,
  userId: string,
): Promise<JournalLabel[]> {
  const { data, error } = await supabase
    .from('journal_labels')
    .select('label_id, name, color')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error || !data || data.length === 0) return []
  return data.map(row => ({
    id: row.label_id as string,
    name: row.name as string,
    color: row.color as string,
  }))
}

export async function upsertAllJournalLabels(
  supabase: Supabase,
  userId: string,
  labels: JournalLabel[],
): Promise<void> {
  if (labels.length === 0) return
  const rows = labels.map(l => ({
    user_id: userId,
    label_id: l.id,
    name: l.name,
    color: l.color,
  }))
  const { error } = await supabase
    .from('journal_labels')
    .upsert(rows, { onConflict: 'user_id,label_id' })
  if (error) throw error
}

export async function deleteJournalLabel(
  supabase: Supabase,
  userId: string,
  labelId: string,
): Promise<void> {
  const { error } = await supabase
    .from('journal_labels')
    .delete()
    .eq('user_id', userId)
    .eq('label_id', labelId)
  if (error) throw error
}

// ── Journal Folders (Library organization) ──────────────────────────────────

export async function fetchJournalFolders(
  supabase: Supabase,
  userId: string,
): Promise<JournalFolder[]> {
  const { data, error } = await supabase
    .from('journal_folders')
    .select('folder_id, name, color')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error || !data || data.length === 0) return []
  return data.map(row => ({
    id: row.folder_id as string,
    name: row.name as string,
    color: (row.color as string | null) ?? undefined,
  }))
}

export async function upsertAllJournalFolders(
  supabase: Supabase,
  userId: string,
  folders: JournalFolder[],
): Promise<void> {
  if (folders.length === 0) return
  const rows = folders.map(f => ({
    user_id: userId,
    folder_id: f.id,
    name: f.name,
    color: f.color ?? null,
  }))
  const { error } = await supabase
    .from('journal_folders')
    .upsert(rows, { onConflict: 'user_id,folder_id' })
  if (error) throw error
}

export async function deleteJournalFolder(
  supabase: Supabase,
  userId: string,
  folderId: string,
): Promise<void> {
  const { error } = await supabase
    .from('journal_folders')
    .delete()
    .eq('user_id', userId)
    .eq('folder_id', folderId)
  if (error) throw error
}
