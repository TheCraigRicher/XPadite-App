'use client'

// ── v1.356 — in-app My Schedule reminders: a visible alert card + the XPadite chime, while XPadite is open ─────────────────────────────────────
// Runs app-wide (mounted once in XpaditeApp), so a reminder fires whichever screen is open — not only inside My Schedule.
//  • due times come from the SAME pure function the server job uses (lib/push/reminderDue.ts), so the app and a push can never disagree;
//  • each (event, occurrence) alerts ONCE — remembered in localStorage, so a reload or a second tab does not repeat it, and a push that arrives for
//    the same reminder is shown only once;
//  • the chime plays once per alert; if the browser still blocks sound the card says so (the visual alert is never lost);
//  • alerts never take focus and never touch any document or event — they are display only.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { getScheduleTz } from './zdate'
import { dueReminders, reminderKey, repeatText, type ReminderEvent, type ReminderRecurrence } from '@/lib/push/reminderDue'
import { leadText, whenText } from '@/lib/push/payload'
import { installAudioUnlock, playReminderChime } from '@/lib/audio/reminderSound'

const SEEN_KEY = 'xp-sched-alerts-v1'
const SEEN_KEEP_MS = 3 * 86_400_000
/** In the open app a reminder is shown if it came due in the last few minutes (a push covers anything older while the app was closed). */
const IN_APP_WINDOW_MS = 5 * 60_000
const TICK_MS = 15_000
/** A tab that is NOT visible waits this long before alerting, so the tab the person is actually looking at (which checks every 15 s) wins and the others stay quiet. */
const HIDDEN_TAB_DELAY_MS = 20_000
/** Two reminders due together chime ONCE: a second chime within this many ms is skipped (both alerts still appear). */
const CHIME_GAP_MS = 4000
let lastChimeAt = 0

interface Alert { key: string; eventId: string; occurrenceAt: number; title: string; body: string; soundBlocked: boolean }

function loadSeen(): Record<string, number> {
  try { const o = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
function saveSeen(m: Record<string, number>): void {
  try {
    const cut = Date.now() - SEEN_KEEP_MS
    for (const k of Object.keys(m)) if (m[k] < cut) delete m[k]
    localStorage.setItem(SEEN_KEY, JSON.stringify(m))
  } catch { /* storage unavailable: alerts may repeat after a reload, never be lost */ }
}

export function ScheduleReminderAlerts() {
  const { scheduleEvents, requestScheduleEvent } = useApp()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const eventsRef = useRef(scheduleEvents)
  useEffect(() => { eventsRef.current = scheduleEvents }, [scheduleEvents])
  const seenRef = useRef<Record<string, number> | null>(null)
  const requestRef = useRef(requestScheduleEvent)
  useEffect(() => { requestRef.current = requestScheduleEvent }, [requestScheduleEvent])

  // first interaction unlocks sound for later reminders (browser autoplay policy)
  useEffect(() => installAudioUnlock(), [])

  const raise = useCallback((eventId: string, occurrenceAt: number, minsBefore: number, fallbackTitle?: string, recurrence?: ReminderRecurrence) => {
    // re-read what other tabs have already alerted, so one reminder is announced once per device — not once per open tab
    seenRef.current = { ...loadSeen(), ...(seenRef.current ?? {}) }
    const key = reminderKey(eventId, occurrenceAt)
    if (seenRef.current[key]) return
    seenRef.current[key] = Date.now()
    saveSeen(seenRef.current)
    const ev = eventsRef.current.find(e => e.id === eventId)
    const title = ev?.title ?? fallbackTitle ?? 'Event'
    const tz = getScheduleTz()
    const rec = recurrence ?? ev?.recurrence ?? 'none'
    const body = `${minsBefore <= 0 ? 'Starting now' : `Starts ${leadText(minsBefore)}`} · ${whenText(occurrenceAt, tz)}${rec !== 'none' ? ` · ↻ ${repeatText(rec)}` : ''}`
    const alert: Alert = { key, eventId, occurrenceAt, title, body, soundBlocked: false }
    setAlerts(a => [...a.filter(x => x.key !== key), alert].slice(-4))
    const now = Date.now()
    if (now - lastChimeAt < CHIME_GAP_MS) return                      // a chime just played for another reminder: no overlapping sounds
    lastChimeAt = now
    void playReminderChime().then(r => { if (r !== 'played') setAlerts(a => a.map(x => (x.key === key ? { ...x, soundBlocked: true } : x))) })
  }, [])

  // due check: right away whenever the events change (they load a moment after start-up), then every 15 s, and the moment the tab becomes visible / focused again
  useEffect(() => {
    function check() {
      const evs: ReminderEvent[] = eventsRef.current
        .filter(e => !e.isCancelled && e.reminderMins !== null && e.reminderMins !== undefined)
        .map(e => ({ eventId: e.id, title: e.title, startAt: e.startAt, reminderMins: e.reminderMins ?? null, recurrence: e.recurrence ?? 'none' }))
      if (evs.length === 0) return
      const now = Date.now(), hidden = document.visibilityState === 'hidden'
      for (const d of dueReminders(evs, now, getScheduleTz(), IN_APP_WINDOW_MS)) {
        if (hidden && now - d.fireAt < HIDDEN_TAB_DELAY_MS) continue         // let the visible tab announce it first
        raise(d.eventId, d.occurrenceAt, d.minsBefore, d.title, d.recurrence)
      }
    }
    check()
    const id = window.setInterval(check, TICK_MS)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', check) }
  }, [raise, scheduleEvents])

  // messages from the service worker: a push arrived (show it in-app once) / a notification was tapped (open that event)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { type?: string; payload?: { eventId?: string; occurrenceAt?: number; title?: string; kind?: string }; eventId?: string } | null
      if (!m || typeof m !== 'object') return
      if (m.type === 'xp-reminder' && m.payload?.kind === 'reminder' && m.payload.eventId && typeof m.payload.occurrenceAt === 'number') {
        const ev = eventsRef.current.find(x => x.id === m.payload!.eventId)
        const id = m.payload.eventId, at = m.payload.occurrenceAt, title = m.payload.title
        const go = () => raise(id, at, ev?.reminderMins ?? 0, title, ev?.recurrence)
        if (document.visibilityState === 'visible') go(); else window.setTimeout(go, HIDDEN_TAB_DELAY_MS)
      } else if (m.type === 'xp-open-reminder' && typeof m.eventId === 'string') {
        requestRef.current(m.eventId)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [raise])

  // opened from a notification while the app was closed: /app?remind=<eventId>&at=<ms> → open My Schedule on that event once events have loaded
  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current || typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const id = p.get('remind')
    if (!id) { openedRef.current = true; return }
    if (!scheduleEvents.some(e => e.id === id)) return
    openedRef.current = true
    p.delete('remind'); p.delete('at')
    const q = p.toString()
    window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''))
    requestScheduleEvent(id)
  }, [scheduleEvents, requestScheduleEvent])

  if (alerts.length === 0) return null
  return (
    <div data-testid="reminder-alerts" aria-live="polite" style={{ position: 'fixed', right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)', zIndex: 9990, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(340px, calc(100vw - 24px))', pointerEvents: 'none' }}>
      {alerts.map(a => (
        <div key={a.key} role="alert" data-testid="reminder-alert" style={{ pointerEvents: 'auto', background: '#1e1b2e', color: '#f1f5f9', border: '1px solid rgba(167,139,250,0.55)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.45)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.2 }}>🔔</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, overflowWrap: 'anywhere' }}>{a.title}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{a.body}</div>
            </div>
            <button type="button" aria-label="Dismiss reminder" data-testid="reminder-dismiss" onClick={() => setAlerts(x => x.filter(y => y.key !== a.key))} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
          {a.soundBlocked && (
            <div data-testid="reminder-sound-blocked" style={{ fontSize: 11, color: '#fcd34d' }}>Sound is blocked by your browser. Tap anywhere in XPadite once to allow it, or use My Schedule → ⋮ → Reminders &amp; sound → Test Reminder Sound.</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" data-testid="reminder-open" onClick={() => { requestScheduleEvent(a.eventId); setAlerts(x => x.filter(y => y.key !== a.key)) }} style={{ minHeight: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Open event</button>
          </div>
        </div>
      ))}
    </div>
  )
}
