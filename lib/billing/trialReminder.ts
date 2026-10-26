// Day 3 / 4 / 5 trial reminders — pure logic. There is NO second trial clock: everything derives from the server's
// authoritative `trialEndsAt` (BillingStatus), corrected for the device clock using the server's own time.

import { TRIAL_DAYS } from './plans'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type ReminderStage = 3 | 4 | 5

export interface TrialReminder {
  stage: ReminderStage
  remainingMs: number
}

/**
 * Trial day N covers [start + (N-1) days, start + N days), where start = trialEndsAt - 5 days (the server defines the
 * start as max(email verification, billing launch), so existing accounts start at launch). Days 1–2, an ended trial and a
 * missing/invalid end time give no reminder.
 */
export function trialReminderStage(trialEndsAtIso: string | null | undefined, nowMs: number): TrialReminder | null {
  const end = trialEndsAtIso ? Date.parse(trialEndsAtIso) : NaN
  if (!Number.isFinite(end)) return null
  const remainingMs = end - nowMs
  if (remainingMs <= 0) return null                         // ended: the existing expired-trial paywall takes over
  const elapsed = TRIAL_DAYS * DAY - remainingMs
  if (elapsed < 0) return null                              // trial has not started yet
  const day = Math.floor(elapsed / DAY) + 1
  return day >= 3 && day <= 5 ? { stage: day as ReminderStage, remainingMs } : null
}

/** Honest remaining time: whole days only when that many full days really remain, otherwise hours. */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs >= 2 * DAY) return 'about 2 days'
  if (remainingMs >= DAY) return 'about 1 day'
  const hours = Math.ceil(remainingMs / HOUR)
  if (hours > 2) return `about ${hours} hours`
  return remainingMs > HOUR ? 'about 2 hours' : 'less than an hour'
}

export function reminderCopy(r: TrialReminder): { title: string; body: string } {
  const left = formatRemaining(r.remainingMs)
  if (r.stage === 3) return { title: 'Enjoying XPadite?', body: `You have ${left} left in your free trial. Upgrade any time to keep everything.` }
  if (r.stage === 4) return { title: 'Your trial is almost over', body: `You have ${left} left in your free trial. Choose a plan to keep your planner, tasks and journals.` }
  return { title: 'Last day of your free trial', body: `Your trial ends in ${left}. Upgrade now so your access continues without interruption.` }
}

/** Per-account, per-stage markers. localStorage = instant/offline; user_metadata = shared across devices. */
export const reminderMetaKey = (stage: ReminderStage) => `trial_reminder_d${stage}`
export const reminderLocalKey = (userId: string, stage: ReminderStage) => `xp-trial-reminder:${userId}:${stage}`

/** The reminder due for this billing status right now, or null. Paid, expired and not-enforced users never get one. */
export function reminderFor(
  status: { state: 'paid' | 'trial' | 'expired'; trialEndsAt: string | null; enforcementActive: boolean } | null | undefined,
  serverNowMs: number,
): TrialReminder | null {
  if (!status || status.state !== 'trial' || !status.enforcementActive || !status.trialEndsAt) return null
  return trialReminderStage(status.trialEndsAt, serverNowMs)
}

/**
 * Decides whether this account has already been shown the stage (this device's marker OR the account's user_metadata,
 * which follows the account to every device). If not, records the local marker and returns true — i.e. "show it now,
 * once". The caller also writes the user_metadata marker.
 */
export function claimReminder(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null,
  stage: ReminderStage,
  nowIso: string,
): boolean {
  let local: string | null = null
  try { local = storage ? storage.getItem(reminderLocalKey(userId, stage)) : null } catch { /* unavailable */ }
  if (local || metadata?.[reminderMetaKey(stage)]) return false
  try { storage?.setItem(reminderLocalKey(userId, stage), nowIso) } catch { /* private mode */ }
  return true
}

// ─── First-time welcome ──────────────────────────────────────────────────────────

/** The welcome is for a trial that has JUST begun: it started within this window (server time). */
export const WELCOME_WINDOW_MS = 24 * HOUR

export const welcomeMetaKey = 'trial_welcome_shown'
export const welcomeLocalKey = (userId: string) => `xp-trial-welcome:${userId}`

/**
 * True for an account in its free trial whose trial began within the last 24 hours (new sign-ups; pre-launch accounts on
 * the day their trial starts at launch). Existing accounts whose trial began earlier, paid and expired accounts, and
 * unenforced/unknown trials never qualify. The start is derived from the server's trialEndsAt (end − 5 days).
 */
export function welcomeEligible(
  status: { state: 'paid' | 'trial' | 'expired'; trialEndsAt: string | null; enforcementActive: boolean } | null | undefined,
  serverNowMs: number,
): boolean {
  if (!status || status.state !== 'trial' || !status.enforcementActive || !status.trialEndsAt) return false
  const end = Date.parse(status.trialEndsAt)
  if (!Number.isFinite(end)) return false
  const sinceStart = serverNowMs - (end - TRIAL_DAYS * DAY)
  return sinceStart >= -60_000 && sinceStart < WELCOME_WINDOW_MS
}

/** Once per account: this device's marker OR the account's user_metadata (all devices). Records the local marker. */
export function claimWelcome(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null,
  nowIso: string,
): boolean {
  let local: string | null = null
  try { local = storage ? storage.getItem(welcomeLocalKey(userId)) : null } catch { /* unavailable */ }
  if (local || metadata?.[welcomeMetaKey]) return false
  try { storage?.setItem(welcomeLocalKey(userId), nowIso) } catch { /* private mode */ }
  return true
}

/** "Monday, November 2 at 8:00 AM PST" in the user's own timezone (server instant, device-independent). */
export function formatTrialEnd(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const make = (tz?: string) => new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}),
  }).formatToParts(d)
  let parts
  try { parts = make(timeZone) } catch { parts = make() }
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('weekday')}, ${get('month')} ${get('day')} at ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`.replace(/\s+/g, ' ').trim()
}
