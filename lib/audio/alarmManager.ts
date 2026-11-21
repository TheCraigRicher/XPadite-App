/**
 * v1.357 — Persistent Alarm lifecycle (no React, no DOM): which alarms are ringing, when each one must stop, and the ONE audio stream behind them.
 *
 *  • An alarm rings from when it is raised until the person stops it, or until ALARM_MAX_MS after the reminder came due (its fire time) — whichever
 *    is first. Measuring from the fire time means an app opened 2 minutes late rings for the remaining 3, and one opened 6 minutes late never rings.
 *  • Each (event, occurrence) is started at most once here; the caller's seen-key store (localStorage) guarantees it is not raised again after a
 *    reload, a second tab, a repeated push or a scheduler retry. A stopped or timed-out alarm is never restarted by this manager.
 *  • Any number of alarms share ONE audio stream. The sound stops the moment the last alarm ends; stop()/stopAll()/dispose() silence immediately.
 *  • A single 1 s timer exists only while at least one alarm is active. If the browser refused sound, the same timer retries once the person has
 *    tapped the page (audio unlocked) — the alert itself is always visible.
 */
import type { AlarmAudio } from './alarmSound'

export const ALARM_MAX_MS = 5 * 60_000
export const ALARM_TICK_MS = 1000

export interface AlarmInput {
  key: string
  eventId: string
  occurrenceAt: number
  /** when the reminder came due (ms): occurrence start − reminder lead */
  fireAt: number
  /** the event as it was when the alarm was raised — used to drop the alarm if the event is later edited or deleted */
  eventStartAt: number
  reminderMins: number
  recurrence: string
}
export type AlarmEndReason = 'stopped' | 'timeout' | 'changed' | 'disposed'
export interface AlarmState { key: string; blocked: boolean; endsAt: number }

/** What the app currently knows about an event (null = deleted / unknown). */
export type CurrentEvent = { startAt: number; reminderMins?: number | null; recurrence?: string; reminderAlarm?: boolean; isCancelled?: boolean } | null

export interface AlarmManager {
  /** 'started' | 'expired' (past its 5 minutes: silent, nothing starts) | 'duplicate' (already tracked) */
  start(a: AlarmInput): Promise<'started' | 'expired' | 'duplicate'>
  stop(key: string): void
  stopAll(): void
  /** Drop alarms whose event was deleted, cancelled, turned back to Standard, or whose time / reminder / repeat changed. */
  reconcile(lookup: (eventId: string) => CurrentEvent): void
  active(): AlarmState[]
  dispose(): void
}

export function createAlarmManager(opts: {
  audio: AlarmAudio
  now?: () => number
  onChange?: (active: AlarmState[]) => void
  onEnd?: (key: string, reason: AlarmEndReason) => void
}): AlarmManager {
  const { audio } = opts
  const now = opts.now ?? Date.now
  const alarms = new Map<string, AlarmInput & { endsAt: number; blocked: boolean }>()
  let timer: ReturnType<typeof setInterval> | null = null

  const snapshot = (): AlarmState[] => [...alarms.values()].map(a => ({ key: a.key, blocked: a.blocked, endsAt: a.endsAt }))
  const changed = () => opts.onChange?.(snapshot())
  const latestEnd = () => { let m = 0; for (const a of alarms.values()) m = Math.max(m, a.endsAt); return m }

  function settle(): void {                                   // keep the timer and the sound in step with the alarm list
    if (alarms.size === 0) {
      if (timer !== null) { clearInterval(timer); timer = null }
      audio.stop()
    } else if (timer === null) {
      timer = setInterval(tick, ALARM_TICK_MS)
    }
  }
  function end(key: string, reason: AlarmEndReason): void {
    if (!alarms.delete(key)) return
    opts.onEnd?.(key, reason)
    settle(); changed()
  }
  function tick(): void {
    const t = now()
    let touched = false
    for (const a of [...alarms.values()]) if (t >= a.endsAt) { alarms.delete(a.key); opts.onEnd?.(a.key, 'timeout'); touched = true }
    if (alarms.size === 0) { settle(); changed(); return }
    if (touched) changed()
    // sound refused earlier? try again (it only succeeds once the person has interacted with the page)
    if ([...alarms.values()].some(a => a.blocked)) {
      void audio.start(latestEnd()).then(r => {
        if (r !== 'played' || alarms.size === 0) return
        let any = false
        for (const a of alarms.values()) if (a.blocked) { a.blocked = false; any = true }
        if (any) changed()
      })
    }
  }

  return {
    async start(a) {
      if (alarms.has(a.key)) return 'duplicate'
      const t = now()
      const endsAt = Math.min(a.fireAt + ALARM_MAX_MS, t + ALARM_MAX_MS)
      if (endsAt <= t) return 'expired'
      const rec = { ...a, endsAt, blocked: false }
      alarms.set(a.key, rec)
      settle(); changed()
      const r = await audio.start(latestEnd())
      if (alarms.size === 0) audio.stop()                      // everything ended while the browser was deciding: release anything that just began
      if (alarms.get(a.key) !== rec) return 'started'
      if (r !== 'played') { rec.blocked = true; changed() }
      return 'started'
    },
    stop(key) { end(key, 'stopped') },
    stopAll() { for (const k of [...alarms.keys()]) { alarms.delete(k); opts.onEnd?.(k, 'stopped') } settle(); changed() },
    reconcile(lookup) {
      for (const a of [...alarms.values()]) {
        const e = lookup(a.eventId)
        const same = !!e && !e.isCancelled && e.reminderAlarm === true && e.reminderMins === a.reminderMins && e.startAt === a.eventStartAt && (e.recurrence ?? 'none') === a.recurrence
        if (!same) end(a.key, 'changed')
      }
    },
    active: snapshot,
    dispose() { for (const k of [...alarms.keys()]) { alarms.delete(k); opts.onEnd?.(k, 'disposed') } settle() },
  }
}
