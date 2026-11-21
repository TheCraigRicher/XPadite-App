/**
 * v1.356 — which My Schedule reminders are due. PURE: no network, no React, no storage — the server job and the in-app alert use this same code.
 *
 * A reminder fires at  occurrenceStart − reminder_mins  (an absolute UTC instant; reminder_mins counts real minutes, so a reminder that crosses
 * midnight or a daylight-saving change is exactly that many minutes earlier). One-off events have one occurrence. A repeating event
 * (daily / weekly / monthly) has an occurrence at the SAME LOCAL WALL-CLOCK TIME on each repeat day in the account timezone, so "3 PM every
 * week" stays 3 PM across a DST change. Monthly repeats use the same day of the month, clamped to the length of the month (the 31st → the 30th).
 *
 * "Due" = the fire time lies in [now − window, now]. The window is the bounded catch-up: a scheduler that was delayed a few minutes still delivers,
 * and an outage never replays more than `window` of history (so repeating events can't flood anyone). The caller de-duplicates with the
 * (event, occurrence) key, so asking again for the same window is always safe.
 */

export type ReminderRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface ReminderEvent {
  eventId: string
  title: string
  /** First occurrence, UTC epoch ms */
  startAt: number
  /** Minutes before the occurrence; null = no reminder */
  reminderMins: number | null
  recurrence: ReminderRecurrence
}

export interface DueReminder {
  eventId: string
  title: string
  /** Start of the occurrence being reminded about, UTC epoch ms */
  occurrenceAt: number
  fireAt: number
  minsBefore: number
  /** How the event repeats — so a notification can say "Repeats weekly" and the person can tell WHICH occurrence it is for. */
  recurrence: ReminderRecurrence
}

export const MINUTE_MS = 60_000
export const DAY_MS = 24 * 60 * MINUTE_MS
export const REMINDER_MAX_MINUTES = 100000
/** Default catch-up window for the server job. */
export const CATCHUP_MS = 30 * MINUTE_MS

/** The identity of one reminder: the same event occurrence is never delivered twice to the same device. */
export const reminderKey = (eventId: string, occurrenceAt: number): string => `${eventId}|${occurrenceAt}`

// ── Timezone math (self-contained: the server job must not import UI modules) ────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function validTz(tz: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }

export function safeTz(tz: string | null | undefined): string { return tz && validTz(tz) ? tz : 'UTC' }

interface Parts { y: number; mo: number; d: number; h: number; mi: number }

/** The wall-clock fields of an instant in `tz` (mo is 0-based). */
export function zonedParts(ms: number, tz: string): Parts {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    fmtCache.set(tz, f)
  }
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value
  return { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute }
}

function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz)
  return Date.UTC(p.y, p.mo, p.d, p.h, p.mi) - Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/** The instant at which the wall clock in `tz` reads the given fields (months / days overflow into the next unit, as in Date). */
export function wallToInstant(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, mo, d, h, mi)
  const t1 = wall - offsetAt(wall, tz)
  return wall - offsetAt(t1, tz)
}

const daysInMonth = (y: number, mo: number): number => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()

/** Start of occurrence number `n` (0 = the event's own start) of a repeating event, at the same local wall-clock time. */
export function occurrenceStart(ev: Pick<ReminderEvent, 'startAt' | 'recurrence'>, n: number, tz: string): number {
  if (n <= 0 || ev.recurrence === 'none') return ev.startAt
  const p = zonedParts(ev.startAt, tz)
  if (ev.recurrence === 'daily') return wallToInstant(tz, p.y, p.mo, p.d + n, p.h, p.mi)
  if (ev.recurrence === 'weekly') return wallToInstant(tz, p.y, p.mo, p.d + 7 * n, p.h, p.mi)
  // monthly: same day of month, clamped (31st → 30th / 28th / 29th)
  const mo = p.mo + n
  const y = p.y + Math.floor(mo / 12)
  const m = ((mo % 12) + 12) % 12
  return wallToInstant(tz, y, m, Math.min(p.d, daysInMonth(y, m)), p.h, p.mi)
}

/** Reminders whose fire time lies in [now − windowMs, now]. */
export function dueReminders(events: ReminderEvent[], now: number, tzIn: string | null | undefined, windowMs = CATCHUP_MS): DueReminder[] {
  const tz = safeTz(tzIn)
  const lo = now - windowMs
  const out: DueReminder[] = []
  for (const ev of events) {
    const mins = ev.reminderMins
    if (mins === null || mins === undefined || !Number.isInteger(mins) || mins < 0 || mins > REMINDER_MAX_MINUTES) continue
    if (!Number.isFinite(ev.startAt)) continue
    const lead = mins * MINUTE_MS
    // occurrences whose start lies in [lo + lead, now + lead]
    const occLo = lo + lead, occHi = now + lead
    if (ev.recurrence === 'none') {
      if (ev.startAt >= occLo && ev.startAt <= occHi) out.push({ eventId: ev.eventId, title: ev.title, occurrenceAt: ev.startAt, fireAt: ev.startAt - lead, minsBefore: mins, recurrence: ev.recurrence })
      continue
    }
    if (occHi < ev.startAt) continue                                     // the series has not begun yet
    let first: number, last: number
    if (ev.recurrence === 'monthly') {
      const s = zonedParts(ev.startAt, tz), a = zonedParts(Math.max(occLo, ev.startAt), tz), b = zonedParts(occHi, tz)
      first = (a.y - s.y) * 12 + (a.mo - s.mo) - 1
      last = (b.y - s.y) * 12 + (b.mo - s.mo) + 1
    } else {
      const step = ev.recurrence === 'daily' ? DAY_MS : 7 * DAY_MS
      first = Math.floor((Math.max(occLo, ev.startAt) - ev.startAt) / step) - 1
      last = Math.floor((occHi - ev.startAt) / step) + 1
    }
    for (let n = Math.max(0, first); n <= last && n <= Math.max(0, first) + 6; n++) {
      const occ = occurrenceStart(ev, n, tz)
      if (occ >= occLo && occ <= occHi) out.push({ eventId: ev.eventId, title: ev.title, occurrenceAt: occ, fireAt: occ - lead, minsBefore: mins, recurrence: ev.recurrence })
    }
  }
  return out
}

/** The next occurrence at or after `now` (for a repeating event), or null for a one-off / an event that has no later occurrence. Bounded: at most ~400 steps. */
export function nextOccurrence(ev: Pick<ReminderEvent, 'startAt' | 'recurrence'>, now: number, tzIn: string | null | undefined): number | null {
  if (ev.recurrence === 'none' || !Number.isFinite(ev.startAt)) return null
  const tz = safeTz(tzIn)
  if (now <= ev.startAt) return ev.startAt
  let n: number
  if (ev.recurrence === 'monthly') {
    const s = zonedParts(ev.startAt, tz), c = zonedParts(now, tz)
    n = Math.max(0, (c.y - s.y) * 12 + (c.mo - s.mo) - 1)
  } else {
    const step = ev.recurrence === 'daily' ? DAY_MS : 7 * DAY_MS
    n = Math.max(0, Math.floor((now - ev.startAt) / step) - 1)
  }
  for (let i = 0; i < 6; i++, n++) { const occ = occurrenceStart(ev, n, tz); if (occ >= now) return occ }
  return null
}

export const repeatText = (r: ReminderRecurrence): string => (r === 'daily' ? 'Repeats daily' : r === 'weekly' ? 'Repeats weekly' : r === 'monthly' ? 'Repeats monthly' : '')
