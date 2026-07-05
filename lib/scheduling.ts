/**
 * Timezone-aware reminder scheduling.
 * Pure functions — no Supabase, no browser-only APIs.
 * Safe to import from client components AND server-side cron routes.
 */

import type { RepeatFrequency } from '@/components/xpadite/types'

/**
 * Convert a local "YYYY-MM-DD" date string + hour/minute in a specific IANA
 * timezone to a UTC Unix millisecond timestamp.
 *
 * Algorithm:
 *   1. Build a "naive UTC" timestamp treating the local h:m as if it were UTC.
 *   2. Use Intl to measure what that naive moment renders as in the target TZ.
 *   3. Derive the UTC offset and correct the timestamp.
 * One pass handles all practical DST cases accurately.
 */
function localTimeToUtcMs(dateStr: string, h: number, m: number, tz: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const naiveUtc = Date.UTC(y, mo - 1, d, h, m, 0, 0)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(naiveUtc))

  const get = (type: string) =>
    parseInt(parts.find(p => p.type === type)?.value ?? '0', 10)

  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  )

  // offset = naiveUtc − localAsUtc  →  actualUtc = naiveUtc + offset
  return naiveUtc + (naiveUtc - localAsUtc)
}

/**
 * Compute the next UTC trigger time (Unix ms) for a reminder.
 *
 * @param reminderTime  "HH:MM" in the user's local timezone
 * @param frequency     Repeat frequency
 * @param fromMs        Reference "now" (default: Date.now())
 * @param timezone      IANA timezone string, e.g. "America/Vancouver".
 *                      When omitted, falls back to the JS runtime's local timezone —
 *                      correct in a browser; pass timezone explicitly on the server.
 */
export function computeNextRunAt(
  reminderTime: string,
  frequency: RepeatFrequency,
  fromMs = Date.now(),
  timezone?: string,
): number {
  const [targetH, targetM] = reminderTime.split(':').map(Number)

  if (!timezone) {
    // Legacy / browser path: use the runtime's local timezone.
    const d = new Date(fromMs)
    d.setHours(targetH, targetM, 0, 0)
    if (d.getTime() <= fromMs) {
      switch (frequency) {
        case 'once':
        case 'daily':   d.setDate(d.getDate() + 1);         break
        case 'weekly':  d.setDate(d.getDate() + 7);         break
        case 'monthly': d.setMonth(d.getMonth() + 1);       break
        case 'yearly':  d.setFullYear(d.getFullYear() + 1); break
      }
    }
    return d.getTime()
  }

  // Timezone-aware path — correct on both browser and server.
  // Get the current date in the user's timezone as "YYYY-MM-DD".
  const localToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(fromMs))

  const candidate = localTimeToUtcMs(localToday, targetH, targetM, timezone)
  if (candidate > fromMs) return candidate

  // The target time today is already past — advance by one period.
  const [y, mo, dv] = localToday.split('-').map(Number)
  const next = new Date(Date.UTC(y, mo - 1, dv))
  switch (frequency) {
    case 'once':
    case 'daily':   next.setUTCDate(next.getUTCDate() + 1);         break
    case 'weekly':  next.setUTCDate(next.getUTCDate() + 7);         break
    case 'monthly': next.setUTCMonth(next.getUTCMonth() + 1);       break
    case 'yearly':  next.setUTCFullYear(next.getUTCFullYear() + 1); break
  }

  const nextStr = next.toISOString().slice(0, 10)  // "YYYY-MM-DD"
  return localTimeToUtcMs(nextStr, targetH, targetM, timezone)
}
