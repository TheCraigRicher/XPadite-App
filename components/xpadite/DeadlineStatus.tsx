'use client'

// ── Shared deadline UI pieces (v1.345): the status chip and the Mark Complete / Completed control ───────────────────────────────────
// Used by the Task Manager popup + Due Date modal and by My Schedule (editor and event details), so wording and look never differ.
// Only TWO completion states exist in the UI — "Mark Complete" and "Completed". Clicking "Completed" asks first, then reopens (no separate "incomplete" button).

import { useState } from 'react'
import { dayKeyInTz, formatDayKey, formatDueDate, formatDueTime, type DueInfo } from './dueStatus'

const TONES = {
  upcoming: { fg: '#1d4ed8', bg: 'rgba(59,130,246,0.13)', bd: 'rgba(59,130,246,0.4)' },
  today:    { fg: '#b45309', bg: 'rgba(245,158,11,0.16)', bd: 'rgba(245,158,11,0.5)' },
  overdue:  { fg: '#b91c1c', bg: 'rgba(239,68,68,0.14)', bd: 'rgba(239,68,68,0.45)' },
  completed:{ fg: '#15803d', bg: 'rgba(22,163,74,0.14)', bd: 'rgba(22,163,74,0.45)' },
}

// lighter text for the charcoal Deadlines panel (v1.361) — same tints and borders, so each status is still recognisable at a glance
const TONES_DARK = {
  upcoming: { ...TONES.upcoming, fg: '#93c5fd' }, today: { ...TONES.today, fg: '#fcd34d' }, overdue: { ...TONES.overdue, fg: '#fca5a5' }, completed: { ...TONES.completed, fg: '#86efac' },
}

export function DueChip({ info, testId = 'due-chip', onDark = false }: { info: DueInfo; testId?: string; onDark?: boolean }) {
  const T = onDark ? TONES_DARK : TONES
  const t = info.state === 'overdue' ? T.overdue : info.state === 'completed' ? T.completed : info.dueToday ? T.today : T.upcoming
  return (
    <span data-testid={testId} data-state={info.state} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: t.fg, background: t.bg, border: `0.5px solid ${t.bd}`, whiteSpace: 'nowrap' }}>{info.label}</span>
  )
}

/** "Mark Complete" when open; "Completed" once done. Clicking "Completed" asks for confirmation before reopening. */
export function CompleteControl({ done, busy, onMark, onReopen, size = 'md' }: { done: boolean; busy?: boolean; onMark: () => void; onReopen: () => void; size?: 'sm' | 'md' }) {
  const [asking, setAsking] = useState(false)
  const pad = size === 'sm' ? '4px 11px' : '6px 14px'
  const fs = size === 'sm' ? 11.5 : 12.5
  if (asking) {
    return (
      <span data-testid="reopen-confirm" role="group" aria-label="Reopen this deadline?" className="inline-flex flex-wrap items-center gap-2" style={{ fontSize: fs, color: 'var(--xp-txt2)' }}>
        <span>Mark as not completed?</span>
        <button type="button" data-testid="reopen-yes" onClick={() => { setAsking(false); onReopen() }} style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, background: 'rgba(124,58,237,0.12)', border: '0.5px solid rgba(124,58,237,0.4)', color: '#6d28d9', cursor: 'pointer' }}>Yes</button>
        <button type="button" data-testid="reopen-no" onClick={() => setAsking(false)} style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 600, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)', cursor: 'pointer' }}>Cancel</button>
      </span>
    )
  }
  return done ? (
    <button type="button" data-testid="completed-btn" disabled={busy} onClick={() => setAsking(true)} aria-label="Completed — tap to reopen"
      className="inline-flex items-center gap-1.5 font-semibold" style={{ padding: pad, fontSize: fs, borderRadius: 999, background: '#16a34a', color: '#fff', border: '1px solid #15803d', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="7.5 12.5 10.5 15.5 16.5 9" /></svg>
      Completed
    </button>
  ) : (
    <button type="button" data-testid="mark-complete-btn" disabled={busy} onClick={onMark}
      className="inline-flex items-center gap-1.5 font-semibold" style={{ padding: pad, fontSize: fs, borderRadius: 999, background: 'rgba(124,58,237,0.10)', color: '#6d28d9', border: '1px solid rgba(124,58,237,0.45)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /><polyline points="8.5 15 11 17.5 15.5 12.5" /></svg>
      Mark Complete
    </button>
  )
}

/**
 * Shown ONLY for a legacy deadline whose assigned calendar date (where its task and marker sit) differs from the day its deadline time falls on in the
 * account timezone: both are stated plainly, nothing is silently re-dated.
 */
export function AssignedDateNote({ assignedKey, dueAt, tz, hour12 }: { assignedKey: string; dueAt: number; tz: string; hour12: boolean }) {
  if (dayKeyInTz(dueAt, tz) === assignedKey) return null
  return (
    <span data-testid="assigned-date-note" style={{ display: 'block', fontSize: 11, lineHeight: 1.4, color: 'var(--xp-txt3)' }}>
      Assigned to {formatDayKey(assignedKey)} &middot; the deadline time is {formatDueDate(dueAt, tz)}, {formatDueTime(dueAt, tz, hour12)} in your time zone
    </span>
  )
}
