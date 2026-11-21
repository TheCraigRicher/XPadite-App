/**
 * v1.356 — what a reminder notification says. Pure (no network); used by the server job and the test notification.
 * Contains only what the user would see anyway (event title, time) — never tokens, keys or other people's data.
 */
import { repeatText, safeTz, type DueReminder } from './reminderDue'

export interface PushPayload {
  title: string
  body: string
  /** One tag per event occurrence: a second delivery of the same reminder REPLACES the first instead of stacking. */
  tag: string
  /** Where tapping the notification goes */
  url: string
  eventId?: string
  occurrenceAt?: number
  /** 'reminder' | 'test' */
  kind: 'reminder' | 'test'
}

/** "in 5 minutes", "in 2 hours", "in 11 hours 30 minutes", "in 1 day 2 hours", "now" */
export function leadText(mins: number): string {
  if (mins <= 0) return 'now'
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60
  const bits: string[] = []
  if (d) bits.push(`${d} ${d === 1 ? 'day' : 'days'}`)
  if (h) bits.push(`${h} ${h === 1 ? 'hour' : 'hours'}`)
  if (m) bits.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
  return `in ${bits.join(' ')}`
}

/** "Fri, Nov 20 · 3:00 PM" in the account timezone */
export function whenText(ms: number, tz: string | null | undefined): string {
  const z = safeTz(tz)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: z, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms))
  const time = new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  return `${day} · ${time}`
}

const hash32 = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }

export function buildReminderPayload(due: DueReminder, tz: string | null | undefined): PushPayload {
  const title = (due.title || 'Event').slice(0, 120)
  const key = hash32(`${due.eventId}|${due.occurrenceAt}`)
  return {
    kind: 'reminder',
    title: `🔔 ${title}`,
    body: `${due.minsBefore <= 0 ? 'Starting now' : `Starts ${leadText(due.minsBefore)}`} · ${whenText(due.occurrenceAt, tz)}${due.recurrence !== 'none' ? ` · ↻ ${repeatText(due.recurrence)}` : ''}`,
    tag: `xp-ev-${key}`,
    url: `/app?remind=${encodeURIComponent(due.eventId)}&at=${due.occurrenceAt}`,
    eventId: due.eventId,
    occurrenceAt: due.occurrenceAt,
  }
}

export function buildTestPayload(): PushPayload {
  return { kind: 'test', title: 'XPadite test notification', body: 'Reminders are working on this device. This was only a test.', tag: 'xp-test', url: '/app' }
}

/** The Web Push `topic` header (≤32 URL-safe chars): a newer message with the same topic replaces one still waiting at the push service. */
export const topicOf = (p: PushPayload): string => p.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
