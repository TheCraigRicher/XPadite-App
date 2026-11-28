// ── Deadline acknowledgment (v1.361) ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE logic for the "Did you meet the deadline … ?" question in the Task Manager's Deadlines panel.
//
// WHAT IS STORED (no database migration): one small record per answered deadline, inside the day document that already holds the deadline's marker
// (calendar_days.day_data → deadlineAcks[itemId]), so it is saved, merged, synced across devices and restored exactly like every other day field:
//     { dueAt, outcome: 'met' | 'missed', at }
//   dueAt   the deadline instant the answer is ABOUT. An answer only counts while the deadline still has that exact instant — rescheduling a deadline
//           (or pasting / duplicating one, which is a new event with a new id) never inherits an old answer.
//   outcome what the user explicitly said. 'met' = "I met it", 'missed' = "I did not".
//   at      when the answer was given — a separate fact from the task's own completedAt, and never used as a fabricated completion time.
//
// A 'met' answer only matters while the deadline is done (a reopened deadline is simply open again and is asked about again); a 'missed' answer
// silences the question while the deadline is open and is otherwise ignored once it is completed (completing it later is plain "Completed late").
import type { DeadlineAck, DayData } from './types'
import { dayDiff, dayKeyInTz, formatDueTime, formatDayKey } from './dueStatus'

export type { DeadlineAck }
export type AckOutcome = DeadlineAck['outcome']

/** The outcome that currently applies to a deadline, or null. */
export function validAck(ack: DeadlineAck | undefined | null, dueAt: number, done: boolean): AckOutcome | null {
  if (!ack || typeof ack !== 'object') return null
  if (ack.outcome !== 'met' && ack.outcome !== 'missed') return null
  if (ack.dueAt !== dueAt) return null                      // the deadline was moved: this answer was about a different deadline
  if (ack.outcome === 'met' && !done) return null           // reopened after "met": open again, ask again
  return ack.outcome
}

/** Should the question be shown right now? Only for an OPEN deadline whose time has been reached and which has no applicable answer. */
export function needsAck(done: boolean, dueAt: number, now: number, outcome: AckOutcome | null): boolean {
  return !done && Number.isFinite(dueAt) && now >= dueAt && outcome === null
}

function longDay(key: string, withYear: boolean): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : null) }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * "Did you meet the deadline today at 2:00 PM?" / "…yesterday at 2:00 PM?" / "…on November 25 at 2:00 PM?" (+ the year when it is not this year).
 * The time is the deadline's own time in the account timezone, in the user's 12 / 24-hour choice. A date-only deadline has no time to quote.
 */
export function ackQuestion(dueAt: number, dateOnly: boolean, now: number, tz: string, hour12: boolean): string {
  const dueDay = dayKeyInTz(dueAt, tz), today = dayKeyInTz(now, tz)
  const diff = dayDiff(dueDay, today)
  const when = diff === 0 ? 'today' : diff === 1 ? 'yesterday' : `on ${longDay(dueDay, dueDay.slice(0, 4) !== today.slice(0, 4))}`
  return `Did you meet the deadline ${when}${dateOnly ? '' : ` at ${formatDueTime(dueAt, tz, hour12)}`}?`
}

/** The day document with one answer recorded (never mutates; other days, tasks and answers are untouched). */
export function withAck(day: DayData, id: string, ack: DeadlineAck): DayData {
  return { ...day, deadlineAcks: { ...(day.deadlineAcks ?? {}), [id]: ack } }
}

export { formatDayKey }
