'use client'

// ── XPadite Meetings — Phase 1 (front-end only, mock data) ──────────────────
// No Supabase, no Google/Microsoft OAuth, no real Task Manager writes here.
// `meetingsMockData.ts` is the seam: Phase 2 swaps MOCK_MEETINGS for a real
// fetch without this file needing a rewrite. See the mock-data file for the
// full field-level rationale (provider vs calendarSource vs meetingProvider).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { MOCK_MEETINGS } from './meetingsMockData'
import type { XpaditeMeeting, MeetingProviderId, MeetingPlatform } from './meetingsMockData'

type TabKey = 'upcoming' | 'today' | 'past' | 'monthly'
type SourceFilter = 'all' | MeetingProviderId
type MeetingPhase = 'cancelled' | 'live' | 'starting-soon' | 'upcoming' | 'past'

// ── Small brand marks — source (calendar account) vs platform (call link) ──
// Kept intentionally distinct so the UI never conflates "which calendar this
// came from" with "which app the video call opens in."

function GoogleSourceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 8.94 10H12v-3.6h8.9c.1.5.1 1 .1 1.6a9 9 0 1 1-2.7-6.4l-2.55 2.47A5.4 5.4 0 1 0 12 17.4a5.5 5.5 0 0 0 5.7-4.6H12z" fill="#4285f4" />
    </svg>
  )
}

function OutlookSourceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="1" y="5" width="14" height="14" rx="2.5" fill="#0364b8" />
      <ellipse cx="8" cy="12" rx="3.6" ry="4.2" fill="none" stroke="#ffffff" strokeWidth="1.7" />
      <rect x="12" y="4" width="11" height="13" rx="2" fill="#28a8ea" />
    </svg>
  )
}

const SOURCE_META: Record<MeetingProviderId, { label: string; Icon: () => React.JSX.Element }> = {
  google:    { label: 'Google Calendar', Icon: GoogleSourceIcon },
  microsoft: { label: 'Outlook',         Icon: OutlookSourceIcon },
}

function PlatformIcon({ platform }: { platform: MeetingPlatform }) {
  const meta = PLATFORM_META[platform]
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: 18, height: 18, borderRadius: 5, background: meta.color }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" width="11" height="11">
        <rect x="2" y="6" width="14" height="12" rx="2.5" />
        <path d="m16 10.5 6-3.5v10l-6-3.5" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const PLATFORM_META: Record<MeetingPlatform, { label: string; color: string }> = {
  'google-meet': { label: 'Google Meet',     color: '#16a766' },
  zoom:          { label: 'Zoom',            color: '#2d8cff' },
  teams:         { label: 'Microsoft Teams', color: '#5059c9' },
}

// ── Date/time helpers ───────────────────────────────────────────────────────

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtTimeRange(startAt: number, endAt: number): string {
  return `${fmtClock(startAt)} – ${fmtClock(endAt)}`
}

function fmtDuration(startAt: number, endAt: number): string {
  const mins = Math.round((endAt - startAt) / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function fmtDayHeader(ts: number, now: number): string {
  const d = new Date(ts)
  const today = new Date(now)
  if (isSameLocalDay(d, today)) return 'Today'
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameLocalDay(d, tomorrow)) return 'Tomorrow'
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (isSameLocalDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

function getPhase(m: XpaditeMeeting, now: number): MeetingPhase {
  if (m.isCancelled) return 'cancelled'
  if (now >= m.startAt && now < m.endAt) return 'live'
  if (m.startAt > now && m.startAt - now <= 45 * 60_000) return 'starting-soon'
  if (m.startAt > now) return 'upcoming'
  return 'past'
}

function fmtStartsIn(startAt: number, now: number): string {
  const mins = Math.max(1, Math.round((startAt - now) / 60_000))
  return mins < 60 ? `Starts in ${mins} min` : `Starts in ${Math.round(mins / 60)} hr`
}

// ── Status pill ───────────────────────────────────────────────────────────

function PhasePill({ phase, startAt, now }: { phase: MeetingPhase; startAt: number; now: number }) {
  if (phase === 'cancelled') {
    return <Pill color="#dc2626" bg="rgba(220,38,38,0.12)" border="rgba(220,38,38,0.28)" label="Cancelled" />
  }
  if (phase === 'live') {
    return <Pill color="#16a34a" bg="rgba(22,163,74,0.14)" border="rgba(22,163,74,0.32)" label="Live now" pulse />
  }
  if (phase === 'starting-soon') {
    return <Pill color="#16a34a" bg="rgba(22,163,74,0.12)" border="rgba(22,163,74,0.28)" label={fmtStartsIn(startAt, now)} />
  }
  return null
}

function Pill({ color, bg, border, label, pulse }: { color: string; bg: string; border: string; label: string; pulse?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap"
      style={{ fontSize: 10.5, fontWeight: 700, color, background: bg, border: `0.5px solid ${border}`, borderRadius: 999, padding: '3px 9px' }}
    >
      {pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'xp-blink 1.4s ease-in-out infinite' }} />}
      {label}
    </span>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: (n: number) => string }[] = [
  { key: 'upcoming', label: n => `Upcoming (${n})` },
  { key: 'today',    label: n => `Today (${n})` },
  { key: 'past',     label: n => `Past (${n})` },
  { key: 'monthly',  label: () => 'Monthly Meetings' },
]

// ── Source filter dropdown ──────────────────────────────────────────────────

function SourceFilterDropdown({ value, onChange }: { value: SourceFilter; onChange: (v: SourceFilter) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const options: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: 'All Sources' },
    { key: 'google', label: 'Google Calendar' },
    { key: 'microsoft', label: 'Outlook' },
  ]
  const current = options.find(o => o.key === value)!

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium"
        style={{
          padding: '6px 10px', borderRadius: 8,
          background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {current.label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
          <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="xp-meet-dd-in"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, minWidth: 168,
            background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden', padding: 4,
          }}
        >
          {options.map(o => (
            <button
              key={o.key}
              onClick={() => { onChange(o.key); setOpen(false) }}
              className="w-full text-left text-[12px]"
              style={{
                padding: '7px 10px', borderRadius: 7,
                color: o.key === value ? '#7c3aed' : 'var(--xp-txt)',
                fontWeight: o.key === value ? 600 : 500,
                background: o.key === value ? 'rgba(124,58,237,0.10)' : 'transparent',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Meeting card (list item) ────────────────────────────────────────────────

function MeetingCard({ meeting, now, selected, onSelect }: { meeting: XpaditeMeeting; now: number; selected: boolean; onSelect: () => void }) {
  const phase = getPhase(meeting, now)
  const faded = phase === 'past' || phase === 'cancelled'
  const SourceIcon = SOURCE_META[meeting.provider].Icon

  return (
    <button
      onClick={onSelect}
      className="w-full text-left flex items-start gap-3 transition-colors"
      style={{
        padding: '11px 14px',
        borderRadius: 12,
        background: selected ? 'rgba(124,58,237,0.10)' : 'transparent',
        border: `0.5px solid ${selected ? 'rgba(124,58,237,0.30)' : 'transparent'}`,
        opacity: faded ? 0.62 : 1,
      }}
    >
      {meeting.meetingProvider ? <PlatformIcon platform={meeting.meetingProvider} /> : (
        <span className="inline-flex items-center justify-center flex-shrink-0" style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-[13px] font-semibold leading-snug truncate"
            style={{ color: 'var(--xp-txt)', textDecoration: phase === 'cancelled' ? 'line-through' : 'none' }}
          >
            {meeting.title}
          </p>
          {meeting.addedToTaskManager && (
            <span className="flex-shrink-0" style={{ fontSize: 9, fontWeight: 700, color: '#16a34a' }} title="Added to Task Manager">✓</span>
          )}
        </div>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--xp-txt3)' }}>
          {fmtClock(meeting.startAt)} · {fmtDuration(meeting.startAt, meeting.endAt)}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="inline-flex items-center gap-1" style={{ fontSize: 10, color: 'var(--xp-txt3)' }}>
            <SourceIcon /> {SOURCE_META[meeting.provider].label}
          </span>
          <PhasePill phase={phase} startAt={meeting.startAt} now={now} />
        </div>
      </div>
    </button>
  )
}

// ── Meeting detail ──────────────────────────────────────────────────────────

function MeetingDetail({
  meeting, now, autoAdd, onJoin, onAddToTaskManager, onRemove, onNotesChange, onClose, showClose,
}: {
  meeting: XpaditeMeeting
  now: number
  autoAdd: boolean
  onJoin: () => void
  onAddToTaskManager: () => void
  onRemove: () => void
  onNotesChange: (text: string) => void
  onClose?: () => void
  showClose: boolean
}) {
  const phase = getPhase(meeting, now)
  const source = SOURCE_META[meeting.provider]
  const SourceIcon = source.Icon
  const canJoin = !meeting.isCancelled && phase !== 'past' && !!meeting.meetingUrl

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {meeting.meetingProvider && <PlatformIcon platform={meeting.meetingProvider} />}
            <h3 className="text-[16px] font-semibold leading-snug" style={{ color: 'var(--xp-txt)', textDecoration: phase === 'cancelled' ? 'line-through' : 'none' }}>
              {meeting.title}
            </h3>
          </div>
          <div className="mt-2"><PhasePill phase={phase} startAt={meeting.startAt} now={now} /></div>
        </div>
        {showClose && (
          <button
            onClick={onClose}
            aria-label="Back"
            className="flex items-center gap-1 flex-shrink-0 text-[12px] font-medium"
            style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Back
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" style={{ overscrollBehavior: 'contain' }}>
        <dl className="flex flex-col gap-2.5 text-[12.5px]">
          <DetailRow label="Date" value={new Date(meeting.startAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
          <DetailRow label="Time" value={`${fmtTimeRange(meeting.startAt, meeting.endAt)} (${fmtDuration(meeting.startAt, meeting.endAt)})`} />
          {meeting.meetingUrl ? (
            <DetailRow label="Meeting Link" value={meeting.meetingUrl} link />
          ) : (
            <DetailRow label="Meeting Link" value="No call link for this meeting" muted />
          )}
          <DetailRow
            label="Source"
            value={<span className="inline-flex items-center gap-1.5"><SourceIcon /> {source.label} (Read-only)</span>}
          />
        </dl>

        <div className="flex items-center gap-2 mt-4">
          {canJoin && (
            <button
              onClick={onJoin}
              className="flex items-center gap-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-85"
              style={{ padding: '9px 16px', borderRadius: 10, background: '#7c3aed' }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="2" y="6" width="14" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m16 10.5 6-3.5v10l-6-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              Join Meeting
            </button>
          )}

          {!autoAdd && !meeting.isCancelled && (
            meeting.addedToTaskManager ? (
              <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ padding: '9px 14px', borderRadius: 10, background: 'rgba(22,163,74,0.10)', border: '0.5px solid rgba(22,163,74,0.28)', color: '#16a34a' }}>
                ✓ Added to Task Manager
              </span>
            ) : (
              <button
                onClick={onAddToTaskManager}
                className="flex items-center gap-1.5 text-[12px] font-medium transition-opacity hover:opacity-75"
                style={{ padding: '9px 14px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}
              >
                + Add to Task Manager
              </button>
            )
          )}
          {autoAdd && !meeting.isCancelled && (
            <span className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>Auto-added to Task Manager</span>
          )}
        </div>

        {/* XPadite Notes */}
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>
            XPadite Notes
          </p>
          <textarea
            value={meeting.notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="Questions, talking points, follow-ups…"
            rows={4}
            maxLength={1000}
            className="w-full text-[12.5px] leading-relaxed resize-none"
            style={{
              background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
              padding: '10px 12px', color: 'var(--xp-txt)', outline: 'none',
            }}
          />
          <p className="text-right text-[10px] mt-1" style={{ color: 'var(--xp-txt3)' }}>{meeting.notes.length}/1000</p>
        </div>

        <div className="flex items-start gap-2 mt-3 text-[11px] leading-snug" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', color: 'var(--xp-txt3)' }}>
          <span aria-hidden="true">ⓘ</span>
          <span>
            This meeting is synced from {source.label} and is read-only in XPadite. You can join it, take your own notes, and add it to your Task Manager, but its details can only be changed from {source.label}.
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 mt-3">
          <button onClick={onRemove} className="text-[11.5px] font-medium" style={{ color: '#dc2626' }}>
            Remove from XPadite
          </button>
          <p className="text-[10.5px] text-right" style={{ color: 'var(--xp-txt3)' }}>
            Only removes it from XPadite. Your {source.label} event is unaffected.
          </p>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value, link, muted }: { label: string; value: React.ReactNode; link?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-[92px] flex-shrink-0 font-semibold" style={{ color: 'var(--xp-txt3)' }}>{label}</dt>
      {link && typeof value === 'string' ? (
        <dd className="min-w-0 truncate" style={{ color: '#7c3aed' }}>{value}</dd>
      ) : (
        <dd className="min-w-0" style={{ color: muted ? 'var(--xp-txt3)' : 'var(--xp-txt)' }}>{value}</dd>
      )}
    </div>
  )
}

function EmptyDetailState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8" style={{ color: 'var(--xp-txt3)' }}>
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" /></svg>
      </div>
      <p className="text-[13px] font-medium">Select a meeting to view its details</p>
    </div>
  )
}

// ── Monthly Meetings view ───────────────────────────────────────────────────

interface MonthDay { date: Date | null; meetings: XpaditeMeeting[] }
interface MonthWeek { weekNum: number; days: MonthDay[] }

function getMonthWeeks(monthCursor: Date, meetings: XpaditeMeeting[]): MonthWeek[] {
  const year = monthCursor.getFullYear()
  const month = monthCursor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDow = new Date(year, month, 1).getDay()

  const weeks: MonthWeek[] = []
  let dayCounter = 1 - startDow
  let weekNum = 1
  while (dayCounter <= daysInMonth) {
    const days: MonthDay[] = []
    for (let dow = 0; dow < 7; dow++, dayCounter++) {
      if (dayCounter < 1 || dayCounter > daysInMonth) {
        days.push({ date: null, meetings: [] })
      } else {
        const date = new Date(year, month, dayCounter)
        const dayMeetings = meetings
          .filter(m => isSameLocalDay(new Date(m.startAt), date))
          .sort((a, b) => a.startAt - b.startAt)
        days.push({ date, meetings: dayMeetings })
      }
    }
    weeks.push({ weekNum, days })
    weekNum++
  }
  return weeks
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function MonthlyMeetingsView({
  monthCursor, onPrevMonth, onNextMonth, meetings, now, selectedId, onSelectMeeting,
}: {
  monthCursor: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  meetings: XpaditeMeeting[]
  now: number
  selectedId: string | null
  onSelectMeeting: (id: string) => void
}) {
  const weeks = useMemo(() => getMonthWeeks(monthCursor, meetings), [monthCursor, meetings])
  const monthLabel = monthCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ overscrollBehavior: 'contain' }}>
      <div className="flex items-center justify-center gap-3 mb-4">
        <button onClick={onPrevMonth} aria-label="Previous month" className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="text-[14px] font-semibold" style={{ color: 'var(--xp-txt)', minWidth: 150, textAlign: 'center' }}>{monthLabel}</span>
        <button onClick={onNextMonth} aria-label="Next month" className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {weeks.map(week => (
          <div key={week.weekNum}>
            <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--xp-txt3)' }}>Week {week.weekNum}</p>
            <div className="overflow-x-auto">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7, minmax(84px, 1fr))', minWidth: 588 }}>
                {week.days.map((day, i) => (
                  <div key={i}>
                    {week.weekNum === 1 && (
                      <p className="text-[10px] font-semibold text-center mb-1" style={{ color: 'var(--xp-txt3)' }}>{DOW_LABELS[i]}</p>
                    )}
                    <div
                      className="flex flex-col gap-1 min-h-[64px]"
                      style={{
                        padding: 6, borderRadius: 8,
                        background: day.date ? 'var(--xp-bg3)' : 'transparent',
                        border: day.date ? '0.5px solid var(--xp-bdr)' : 'none',
                      }}
                    >
                      {day.date && (
                        <span className="text-[10px]" style={{ color: isSameLocalDay(day.date, new Date(now)) ? '#7c3aed' : 'var(--xp-txt3)', fontWeight: isSameLocalDay(day.date, new Date(now)) ? 700 : 500 }}>
                          {day.date.getDate()}
                        </span>
                      )}
                      {day.meetings.slice(0, 3).map(m => (
                        <button
                          key={m.id}
                          onClick={() => onSelectMeeting(m.id)}
                          className="text-left w-full"
                          style={{
                            borderLeft: `2.5px solid ${m.meetingProvider ? PLATFORM_META[m.meetingProvider].color : 'var(--xp-bdr2)'}`,
                            background: selectedId === m.id ? 'rgba(124,58,237,0.14)' : 'var(--xp-card)',
                            borderRadius: 4, padding: '3px 5px',
                            opacity: m.isCancelled ? 0.55 : 1,
                          }}
                        >
                          <p className="text-[9.5px] leading-tight truncate" style={{ color: 'var(--xp-txt3)' }}>{fmtClock(m.startAt)}</p>
                          <p className="text-[10.5px] leading-tight truncate font-medium" style={{ color: 'var(--xp-txt)', textDecoration: m.isCancelled ? 'line-through' : 'none' }}>{m.title}</p>
                        </button>
                      ))}
                      {day.meetings.length > 3 && (
                        <p className="text-[9.5px]" style={{ color: 'var(--xp-txt3)' }}>+{day.meetings.length - 3} more</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Root modal ────────────────────────────────────────────────────────────

interface MeetingsModalProps {
  onClose: () => void
}

export function MeetingsModal({ onClose }: MeetingsModalProps) {
  const { setToast } = useApp()
  const [meetings, setMeetings] = useState<XpaditeMeeting[]>(() => MOCK_MEETINGS)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [autoAdd, setAutoAdd] = useState(true)
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useLockBodyScroll()

  const bySource = useMemo(
    () => meetings.filter(m => sourceFilter === 'all' || m.provider === sourceFilter),
    [meetings, sourceFilter],
  )

  const todayList = useMemo(
    () => bySource.filter(m => isSameLocalDay(new Date(m.startAt), new Date(now))).sort((a, b) => a.startAt - b.startAt),
    [bySource, now],
  )
  const upcomingList = useMemo(
    () => bySource.filter(m => m.endAt >= now).sort((a, b) => a.startAt - b.startAt),
    [bySource, now],
  )
  const pastList = useMemo(
    () => bySource.filter(m => m.endAt < now).sort((a, b) => b.startAt - a.startAt),
    [bySource, now],
  )

  const activeList = tab === 'today' ? todayList : tab === 'past' ? pastList : upcomingList

  const grouped = useMemo(() => {
    const groups: { label: string; items: XpaditeMeeting[] }[] = []
    for (const m of activeList) {
      const label = fmtDayHeader(m.startAt, now)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(m)
      else groups.push({ label, items: [m] })
    }
    return groups
  }, [activeList, now])

  const selectedMeeting = meetings.find(m => m.id === selectedId) ?? null

  function updateMeeting(id: string, patch: Partial<XpaditeMeeting>) {
    setMeetings(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  function handleJoin() {
    setToast('This is a mock meeting link — real joining connects once calendar sync is live.')
  }

  function handleRemove(id: string) {
    setMeetings(prev => prev.filter(m => m.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function selectTab(key: TabKey) {
    setTab(key)
    setSelectedId(null)
  }

  const emptyMessage = tab === 'today' ? 'No meetings scheduled for today.' : tab === 'past' ? 'No past meetings yet.' : 'No upcoming meetings.'

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <style>{`
        @keyframes xpMeetHdrFlow {
          0%   { background-position: 0% 50% }
          50%  { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        .xp-meet-hdr {
          background: linear-gradient(135deg, #5b21b6 0%, #6d28d9 22%, #7c3aed 46%, #8b5cf6 65%, #7c3aed 82%, #6d28d9 100%);
          background-size: 320% 320%;
          animation: xpMeetHdrFlow 14s ease infinite;
        }
        @keyframes xp-meet-dd-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .xp-meet-dd-in { animation: xp-meet-dd-in 130ms ease-out; }
        @keyframes xp-meet-overlay-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
        .xp-meet-overlay { animation: xp-meet-overlay-in 160ms ease-out; }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xp-meet-title"
        className="w-full sm:max-w-[980px] h-full sm:h-[86vh] sm:max-h-[86vh] rounded-none sm:rounded-2xl max-sm:border-0! overflow-hidden flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="xp-meet-hdr flex items-center justify-between flex-shrink-0"
          style={{ padding: '14px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.12)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.32)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" /></svg>
            </div>
            <div className="min-w-0">
              <h2 id="xp-meet-title" style={{ fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.01em', lineHeight: 1.2 }}>Meetings</h2>
              <p className="truncate" style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>Your scheduled meetings, all in one place.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.88)', border: '0.5px solid rgba(255,255,255,0.25)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Auto-add + read-only info row */}
        <div className="flex flex-col sm:flex-row gap-2.5 px-4 pt-3.5 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 flex-1" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)' }}>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Automatically add meetings to Task Manager</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>When enabled, synced meetings automatically appear in your Task Manager.</p>
            </div>
            <button
              onClick={() => setAutoAdd(v => !v)}
              aria-label="Toggle auto-add to Task Manager"
              className="flex items-center flex-shrink-0"
            >
              <div className="relative rounded-full transition-colors duration-300" style={{ width: 40, height: 20, background: autoAdd ? '#7c3aed' : 'var(--xp-bdr2)' }}>
                <div className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300" style={{ transform: autoAdd ? 'translateX(21px)' : 'translateX(2px)' }} />
              </div>
            </button>
          </div>
          <div className="hidden sm:flex items-start gap-2 flex-1 text-[11px] leading-snug" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt3)' }}>
            <span aria-hidden="true">ⓘ</span>
            <span>Meetings from Google Calendar and Outlook are read-only. You can view them, join them, add notes, and include them in your Task Manager.</span>
          </div>
        </div>

        {/* Tabs + source filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pb-3 flex-shrink-0">
          <div className="flex items-center gap-1 flex-wrap" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)', width: 'fit-content' }}>
            {TABS.map(t => {
              const count = t.key === 'upcoming' ? upcomingList.length : t.key === 'today' ? todayList.length : t.key === 'past' ? pastList.length : 0
              return (
                <button
                  key={t.key}
                  onClick={() => selectTab(t.key)}
                  className="text-[12px] whitespace-nowrap"
                  style={{
                    padding: '6px 12px', borderRadius: 7,
                    fontWeight: tab === t.key ? 700 : 500,
                    background: tab === t.key ? '#7c3aed' : 'transparent',
                    color: tab === t.key ? '#ffffff' : 'var(--xp-txt2)',
                  }}
                >
                  {t.label(count)}
                </button>
              )
            })}
          </div>
          <SourceFilterDropdown value={sourceFilter} onChange={setSourceFilter} />
        </div>

        {/* Body */}
        {tab === 'monthly' ? (
          selectedMeeting ? (
            <div className="xp-meet-overlay flex-1 min-h-0">
              <MeetingDetail
                meeting={selectedMeeting}
                now={now}
                autoAdd={autoAdd}
                onJoin={handleJoin}
                onAddToTaskManager={() => updateMeeting(selectedMeeting.id, { addedToTaskManager: true, linkedTaskId: `mock-task-${selectedMeeting.id}` })}
                onRemove={() => handleRemove(selectedMeeting.id)}
                onNotesChange={text => updateMeeting(selectedMeeting.id, { notes: text })}
                onClose={() => setSelectedId(null)}
                showClose
              />
            </div>
          ) : (
            <MonthlyMeetingsView
              monthCursor={monthCursor}
              onPrevMonth={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              onNextMonth={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              meetings={bySource}
              now={now}
              selectedId={selectedId}
              onSelectMeeting={setSelectedId}
            />
          )
        ) : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* List column */}
            <div
              className={`${selectedId ? 'hidden lg:flex' : 'flex'} lg:w-[340px] flex-1 lg:flex-none flex-col min-h-0`}
              style={{ borderRight: '0.5px solid var(--xp-bdr)' }}
            >
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2" style={{ overscrollBehavior: 'contain' }}>
                {grouped.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center px-6 py-14" style={{ color: 'var(--xp-txt3)' }}>
                    <p className="text-[13px] font-medium">{emptyMessage}</p>
                  </div>
                ) : (
                  grouped.map(group => (
                    <div key={group.label} className="mb-1">
                      <p className="text-[10.5px] font-bold uppercase tracking-wide px-3 pt-2.5 pb-1" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>
                        {group.label} · {group.items.length} meeting{group.items.length !== 1 ? 's' : ''}
                      </p>
                      {group.items.map(m => (
                        <MeetingCard key={m.id} meeting={m} now={now} selected={selectedId === m.id} onSelect={() => setSelectedId(m.id)} />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Detail column */}
            <div className={`${selectedId ? 'flex xp-meet-overlay' : 'hidden lg:flex'} flex-1 min-h-0 flex-col`}>
              {selectedMeeting ? (
                <MeetingDetail
                  meeting={selectedMeeting}
                  now={now}
                  autoAdd={autoAdd}
                  onJoin={handleJoin}
                  onAddToTaskManager={() => updateMeeting(selectedMeeting.id, { addedToTaskManager: true, linkedTaskId: `mock-task-${selectedMeeting.id}` })}
                  onRemove={() => handleRemove(selectedMeeting.id)}
                  onNotesChange={text => updateMeeting(selectedMeeting.id, { notes: text })}
                  onClose={() => setSelectedId(null)}
                  showClose={true}
                />
              ) : (
                <EmptyDetailState />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
