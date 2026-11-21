/**
 * v1.356 — the reminder job. Called about once a minute (Supabase pg_cron → /api/schedule-reminders/run).
 *
 * Safe to run twice at once, late, or repeatedly:
 *  • FIRST PASS — new reminders. Candidates come from one database function (schedule_reminder_candidates) for the window [now − catch-up, now].
 *  • SECOND PASS — retries. A delivery that FAILED (or was abandoned mid-send) is retried even after its catch-up window has passed, but only while it is
 *    still worth sending: the event still exists, its time and reminder setting are unchanged (the occurrence is re-derived from the current event), the
 *    device is still subscribed, the event has not already started (+5 min grace), the reminder is less than RETRY_EXPIRY_MS old and fewer than
 *    MAX_ATTEMPTS were made. Anything else is marked 'expired' and left alone — an old or edited reminder can never arrive late.
 *  • Each (event occurrence × device) is CLAIMED with a unique row in reminder_deliveries before anything is sent, so two overlapping runs cannot both
 *    deliver it. Status: pending (claimed, attempt in flight) → sent (the push service ACCEPTED it) | failed (retried after a short lease) | gone (the
 *    device subscription was removed) | expired (no longer worth sending). A failed attempt never permanently suppresses a reminder.
 *  • "sent" means the push service accepted the message. Whether and when the device shows it is up to the device and OS.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CATCHUP_MS, MINUTE_MS, dueReminders, safeTz, type DueReminder, type ReminderEvent, type ReminderRecurrence } from './reminderDue'
import { buildReminderPayload } from './payload'
import type { PushSender, StoredSubscription } from './send'

export const MAX_ATTEMPTS = 4
/** A claimed-but-unfinished or failed delivery may be retried after this long (ms). */
export const RETRY_LEASE_MS = 90_000
/** A failed reminder is abandoned this long after it first came due (ms). */
export const RETRY_EXPIRY_MS = 2 * 60 * MINUTE_MS
/** A late reminder (catch-up or retry) is still sent if the event started no more than this long ago (ms). */
export const RETRY_AFTER_START_GRACE_MS = 5 * MINUTE_MS
const KEEP_DELIVERIES_DAYS = 7

export interface RunResult { candidates: number; due: number; sent: number; failed: number; skipped: number; removedSubscriptions: number; retried: number; expired: number }

interface CandidateRow { user_id: string; event_id: string; title: string; start_at: string; reminder_mins: number | null; recurrence: string }
type Sub = StoredSubscription & { user_id: string }

const isRecurrence = (r: string): r is ReminderRecurrence => r === 'none' || r === 'daily' || r === 'weekly' || r === 'monthly'
const toEvent = (c: CandidateRow): ReminderEvent => ({ eventId: c.event_id, title: c.title, startAt: Date.parse(c.start_at), reminderMins: c.reminder_mins, recurrence: isRecurrence(c.recurrence) ? c.recurrence : 'none' })

async function loadUserContext(admin: SupabaseClient, userIds: string[]) {
  const [{ data: prefs }, { data: subs }] = await Promise.all([
    admin.from('user_preferences').select('user_id, timezone').in('user_id', userIds),
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds),
  ])
  const tzOf = new Map<string, string>((prefs ?? []).map((p: { user_id: string; timezone: string | null }) => [p.user_id, safeTz(p.timezone)]))
  const subsOf = new Map<string, Sub[]>()
  for (const s of (subs ?? []) as Sub[]) subsOf.set(s.user_id, [...(subsOf.get(s.user_id) ?? []), s])
  return { tzOf, subsOf }
}

export async function runScheduleReminders(opts: { admin: SupabaseClient; send: PushSender; now?: number; windowMs?: number }): Promise<RunResult> {
  const { admin, send } = opts
  const now = opts.now ?? Date.now()
  const windowMs = opts.windowMs ?? CATCHUP_MS
  const result: RunResult = { candidates: 0, due: 0, sent: 0, failed: 0, skipped: 0, removedSubscriptions: 0, retried: 0, expired: 0 }

  // deliver one claimed (event occurrence × device) and record the outcome
  async function attempt(claim: string, dev: Sub, due: DueReminder, tz: string, isRetry: boolean): Promise<void> {
    const r = await send(dev, buildReminderPayload(due, tz))
    if (isRetry) result.retried++
    if (r.ok) {
      await admin.from('reminder_deliveries').update({ status: 'sent', accepted_at: new Date().toISOString(), last_error: null }).eq('id', claim)
      result.sent++
    } else if (r.gone) {
      await admin.from('push_subscriptions').delete().eq('id', dev.id)     // cascades its delivery rows
      result.removedSubscriptions++
    } else {
      await admin.from('reminder_deliveries').update({ status: 'failed', last_error: r.code }).eq('id', claim)
      result.failed++
    }
  }

  // ── FIRST PASS: reminders that just came due ───────────────────────────────────────────────────────────────────────────
  const { data: rows, error } = await admin.rpc('schedule_reminder_candidates', { p_lo: new Date(now - windowMs).toISOString(), p_hi: new Date(now).toISOString() })
  if (error) throw new Error('candidates_failed')
  const cands = (rows ?? []) as CandidateRow[]
  result.candidates = cands.length
  if (cands.length > 0) {
    const userIds = [...new Set(cands.map(c => c.user_id))]
    const { tzOf, subsOf } = await loadUserContext(admin, userIds)
    for (const uid of userIds) {
      const devices = subsOf.get(uid) ?? []
      const tz = tzOf.get(uid) ?? 'UTC'
      // a reminder is only worth delivering until just after its event starts (the same rule the retry pass applies)
      const due = dueReminders(cands.filter(c => c.user_id === uid).map(toEvent), now, tz, windowMs).filter(d => now <= d.occurrenceAt + RETRY_AFTER_START_GRACE_MS)
      result.due += due.length
      if (devices.length === 0) { result.skipped += due.length; continue }      // no device: the in-app alert covers an open app
      for (const d of due) {
        for (const dev of devices) {
          const claim = await claimDelivery(admin, { userId: uid, eventId: d.eventId, occurrenceAt: d.occurrenceAt, subscriptionId: dev.id }, now)
          if (!claim) { result.skipped++; continue }       // already sent, in flight on another run, out of attempts, or not yet retryable
          await attempt(claim, dev, d, tz, false)
        }
      }
    }
  }

  // ── SECOND PASS: retry failed deliveries that are still worth sending ──────────────────────────────────────────────────
  const { data: failedRows } = await admin.from('reminder_deliveries').select('id, user_id, event_id, occurrence_at, subscription_id, attempts')
    .in('status', ['failed', 'pending']).lt('attempts', MAX_ATTEMPTS).gte('created_at', new Date(now - RETRY_EXPIRY_MS).toISOString())
  const stuck = (failedRows ?? []) as Array<{ id: string; user_id: string; event_id: string; occurrence_at: string; subscription_id: string; attempts: number }>
  if (stuck.length > 0) {
    const userIds = [...new Set(stuck.map(s => s.user_id))]
    const { tzOf, subsOf } = await loadUserContext(admin, userIds)
    const { data: evRows } = await admin.from('schedule_events').select('user_id, event_id, title, start_at, reminder_mins, recurrence').in('user_id', userIds).in('event_id', [...new Set(stuck.map(s => s.event_id))])
    const evOf = new Map<string, CandidateRow>(((evRows ?? []) as CandidateRow[]).map(e => [`${e.user_id}|${e.event_id}`, e]))
    const expire = async (id: string) => { await admin.from('reminder_deliveries').update({ status: 'expired' }).eq('id', id); result.expired++ }
    for (const s of stuck) {
      const occ = Date.parse(s.occurrence_at)
      const ev = evOf.get(`${s.user_id}|${s.event_id}`)
      const dev = (subsOf.get(s.user_id) ?? []).find(d => d.id === s.subscription_id)
      if (!dev) continue                                                          // subscription gone: its rows cascade away
      if (!ev) { await expire(s.id); continue }                                   // event deleted
      if (now > occ + RETRY_AFTER_START_GRACE_MS) { await expire(s.id); continue } // the event has already started: too late to be useful
      const tz = tzOf.get(s.user_id) ?? 'UTC'
      const still = dueReminders([toEvent(ev)], now, tz, RETRY_EXPIRY_MS).find(d => d.occurrenceAt === occ)
      if (!still) { await expire(s.id); continue }                                // edited (time / reminder changed) or past its expiry
      const claim = await claimDelivery(admin, { userId: s.user_id, eventId: s.event_id, occurrenceAt: occ, subscriptionId: s.subscription_id }, now)
      if (!claim) continue                                                        // lease not over yet, or another run has it
      await attempt(claim, dev, still, tz, true)
    }
  }

  await prune(admin, now)
  return result
}

/** Returns the delivery row id when THIS run owns the attempt, or null when it must not send. */
export async function claimDelivery(admin: SupabaseClient, k: { userId: string; eventId: string; occurrenceAt: number; subscriptionId: string }, now: number): Promise<string | null> {
  const nowIso = new Date(now).toISOString()
  const row = { user_id: k.userId, event_id: k.eventId, occurrence_at: new Date(k.occurrenceAt).toISOString(), subscription_id: k.subscriptionId, status: 'pending', attempts: 1, claimed_at: nowIso }
  // Fresh claim: the unique key means only ONE concurrent run gets a row back.
  const ins = await admin.from('reminder_deliveries').upsert(row, { onConflict: 'user_id,event_id,occurrence_at,subscription_id', ignoreDuplicates: true }).select('id')
  if (!ins.error && ins.data && ins.data.length > 0) return (ins.data[0] as { id: string }).id

  // Existing row: retry only a failed (or abandoned-in-flight) attempt, after the lease, within the attempt budget — compare-and-set on `attempts`.
  const cur = await admin.from('reminder_deliveries').select('id, status, attempts, claimed_at').eq('user_id', k.userId).eq('event_id', k.eventId)
    .eq('occurrence_at', row.occurrence_at).eq('subscription_id', k.subscriptionId).maybeSingle()
  const c = cur.data as { id: string; status: string; attempts: number; claimed_at: string } | null
  if (!c || c.status === 'sent' || c.status === 'gone' || c.status === 'expired') return null
  if (c.attempts >= MAX_ATTEMPTS) return null
  if (now - Date.parse(c.claimed_at) < RETRY_LEASE_MS) return null
  const upd = await admin.from('reminder_deliveries').update({ status: 'pending', attempts: c.attempts + 1, claimed_at: nowIso })
    .eq('id', c.id).eq('attempts', c.attempts).in('status', ['pending', 'failed']).select('id')
  return !upd.error && upd.data && upd.data.length > 0 ? (upd.data[0] as { id: string }).id : null
}

async function prune(admin: SupabaseClient, now: number): Promise<void> {
  // cheap housekeeping on a quiet minute: forget delivery rows older than a week
  if (new Date(now).getUTCMinutes() % 15 !== 0) return
  await admin.from('reminder_deliveries').delete().lt('created_at', new Date(now - KEEP_DELIVERIES_DAYS * 86_400_000).toISOString())
}
