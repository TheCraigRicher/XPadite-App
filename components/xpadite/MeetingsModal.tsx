'use client'

// ── XPadite My Schedule (formerly Meetings) — Phase 1 (front-end only, mock data) ──
// Tabs: My Schedule (weekly scheduler, MyScheduleView) · Today (dark mini calendar + agenda + details). The Upcoming and Past
// tabs are gone from the UI, but all meeting data is kept (upcoming events live in the weekly view's sidebar). The Task
// Manager auto-add setting is unchanged — only its banners were removed from view.
// No Supabase, no Google/Microsoft OAuth, no real Task Manager writes here.
// `meetingsMockData.ts` is the seam: Phase 2 swaps MOCK_MEETINGS for a real
// fetch without this file needing a rewrite. See the mock-data file for the
// full field-level rationale (provider vs calendarSource vs meetingProvider).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { useLockBodyScroll } from './useLockBodyScroll'
import { MOCK_MEETINGS } from './meetingsMockData'
import { MyScheduleView } from './MyScheduleView'
import { ScheduleMiniCalendar } from './ScheduleMiniCalendar'
import { ConfirmDelete, EventDetails, EventForm, FilterSelect, LAYER_ATTR } from './ScheduleParts'
import { ScheduleMenu } from './ScheduleMenu'
import { useIsPhone } from './ScheduleMobile'
import { ManageCategoriesDialog, PreferencesDialog } from './ScheduleDialogs'
import { ScheduleContext, useSchedule } from './scheduleContext'
import { buildSampleScheduleEvents } from './scheduleMockData'
import {
  SCHEDULE_CATEGORIES, blankForm, blankFormAt, clockLabel, daySlice, durationLabel, eventToForm, eventsOnDay, filterScheduleEvents,
  formToEventFields, isSameLocalDay, meetingToScheduleEvent, sanitizePrefs, splitFilter, startOfDay, startOfMonth, timeRangeLabel,
  DEFAULT_PREFS,
} from './scheduleLogic'
import type { CombinedFilter, ScheduleCategory, ScheduleCategoryId, ScheduleEvent, ScheduleFormValues, SchedulePrefs } from './scheduleLogic'
import {
  addCategory, canDuplicate, conflictMessage, deleteCategory, dragBlockReason, duplicateFormValues, findConflicts, formConflict,
  recolorCategory, renameCategory,
} from './scheduleEngine'
import type { FilterState } from './scheduleEngine'
import type { XpaditeMeeting, MeetingProviderId, MeetingPlatform } from './meetingsMockData'

type TabKey = 'schedule' | 'today'
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

function fmtDuration(startAt: number, endAt: number): string {
  const mins = Math.round((endAt - startAt) / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
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
  { key: 'schedule', label: () => 'My Schedule' },
  { key: 'today',    label: n => `Today (${n})` },
]

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
  const { fmt } = useSchedule()
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
          <DetailRow label="Time" value={`${timeRangeLabel(meeting.startAt, meeting.endAt, fmt)} (${fmtDuration(meeting.startAt, meeting.endAt)})`} />
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
      <p className="text-[13px] font-medium">Select an event to view its details</p>
    </div>
  )
}

// ── Today agenda item (dark panel) ──────────────────────────────────────────

function AgendaItem({ ev, meeting, now, selected, onSelect }: { ev: ScheduleEvent; meeting: XpaditeMeeting | null; now: number; selected: boolean; onSelect: () => void }) {
  const { meta, fmt } = useSchedule()
  const cat = meta(ev.category)
  const phase = meeting ? getPhase(meeting, now) : null
  const faded = phase === 'past' || phase === 'cancelled' || (!!ev.isCancelled)
  const source = meeting ? SOURCE_META[meeting.provider] : null
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="w-full text-left flex items-start gap-3 transition-colors"
      style={{
        padding: '10px 12px', borderRadius: 12, background: '#232640', color: '#f3f4f6',
        border: `1.5px solid ${selected ? '#8b5cf6' : 'transparent'}`,
        boxShadow: selected ? '0 0 0 3px rgba(139,92,246,0.22)' : 'none',
        opacity: faded ? 0.62 : 1,
      }}
    >
      <span aria-hidden="true" className="flex-shrink-0" style={{ width: 11, height: 11, borderRadius: '50%', background: cat.edge, marginTop: 5 }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold leading-snug truncate" style={{ textDecoration: ev.isCancelled ? 'line-through' : 'none' }}>{ev.title}</p>
          {meeting?.addedToTaskManager && <span className="flex-shrink-0" style={{ fontSize: 9, fontWeight: 700, color: '#4ade80' }} title="Added to Task Manager">✓</span>}
        </div>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: '#9ca3af' }}>{clockLabel(ev.startAt, fmt)} – {clockLabel(ev.endAt, fmt)} · {fmtDuration(ev.startAt, ev.endAt)}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1" style={{ fontSize: 10, color: '#9ca3af' }}>
            {source ? <><source.Icon /> {source.label}</> : <>XPadite</>}
          </span>
          {meeting && phase && <PhasePill phase={phase} startAt={meeting.startAt} now={now} />}
        </div>
      </div>
    </button>
  )
}

// ── Root modal ────────────────────────────────────────────────────────────

interface MeetingsModalProps {
  onClose: () => void
}

type FormState =
  | { mode: 'add'; initial: ScheduleFormValues; heading?: string; hint?: string }
  | { mode: 'edit'; id: string; initial: ScheduleFormValues; original: { startAt: number; endAt: number } }
  | null
type DialogKey = 'categories' | 'prefs' | null

export function MeetingsModal({ onClose }: MeetingsModalProps) {
  const { setToast } = useApp()
  const [meetings, setMeetings] = useState<XpaditeMeeting[]>(() => MOCK_MEETINGS)
  const [tab, setTab] = useState<TabKey>('schedule')
  // The single combined filter (All · categories · Google Calendar · Outlook) and the legend's hidden categories.
  const [filter, setFilter] = useState<CombinedFilter>('all')
  const [hidden, setHidden] = useState<ScheduleCategoryId[]>([])
  const [hiddenSources, setHiddenSources] = useState<string[]>([])   // calendars unticked in the phone Filter sheet
  const [todaySelId, setTodaySelId] = useState<string | null>(null)
  // Phones show either the agenda or the details; Back returns to the agenda WITHOUT clearing the selected event.
  const [detailOpen, setDetailOpen] = useState(false)
  // Task Manager auto-add stays ON (its toggle banner was removed from the UI; the behaviour in MeetingDetail is unchanged).
  const [autoAdd] = useState(true)
  // Sample schedule events — in-memory preview only, separate from `meetings`; nothing here is saved.
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>(() => buildSampleScheduleEvents(new Date()))
  const [now, setNow] = useState(() => Date.now())
  // Today tab: the date whose agenda is shown, the month browsed in the mini calendar, and its collapse state.
  const [todayDate, setTodayDate] = useState(() => startOfDay(new Date()))
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [calExpanded, setCalExpanded] = useState(true)
  // Add/Edit/Delete dialogs (shared by both tabs) and the "jump to this event" signal for the weekly view.
  const [activeDay, setActiveDay] = useState(() => startOfDay(new Date()))
  const [form, setForm] = useState<FormState>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ id: string; at: number; nonce: number; quiet?: boolean } | null>(null)
  // Custom categories + preferences: in-memory for this preview (nothing is saved). The built-in six always come first.
  const [customCategories, setCustomCategories] = useState<ScheduleCategory[]>([])
  const [prefs, setPrefs] = useState<SchedulePrefs>(DEFAULT_PREFS)
  const [dialog, setDialog] = useState<DialogKey>(null)
  // Overlays keep rendering after they close (open={false}) so phones can play the slide-down exit; each unmounts itself afterwards.
  const [lastForm, setLastForm] = useState<{ data: NonNullable<FormState>; id: number } | null>(null)
  if (form && form !== lastForm?.data) setLastForm({ data: form, id: (lastForm?.id ?? 0) + 1 })
  const [lastDialog, setLastDialog] = useState<NonNullable<DialogKey> | null>(null)
  if (dialog && dialog !== lastDialog) setLastDialog(dialog)
  // The event selected in the My Schedule tab (the Today tab keeps its own `todaySelId`) — the menu's Duplicate needs it.
  const [weekSelId, setWeekSelId] = useState<string | null>(null)
  // Search text (shared by the phone slide-down bar and the tablet/desktop field) and the phone's slide-down panel (one at a time).
  const phone = useIsPhone()
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<{ kind: 'search' | 'filter' | null; nonce: number }>({ kind: null, nonce: 0 })

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // an open My Schedule dialog (add/edit, delete confirm, details sheet) handles Escape first
      if (document.querySelector(`[${LAYER_ATTR}]`)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useLockBodyScroll()

  // Everything on the calendar: XPadite events + read-only synced meetings. `filtered` applies the combined dropdown
  // (category or connected calendar) — used by Today's agenda and its count; the weekly view applies the same filter itself.
  const allEvents = useMemo(() => [...scheduleEvents, ...meetings.map(meetingToScheduleEvent)], [scheduleEvents, meetings])
  const categories = useMemo(() => [...SCHEDULE_CATEGORIES, ...customCategories], [customCategories])
  const ctx = useMemo(() => ({ categories, prefs }), [categories, prefs])
  const fmt = prefs.timeFormat
  const parts = splitFilter(filter)
  const filtered = useMemo(
    () => filterScheduleEvents(allEvents, { query: '', category: parts.category, source: parts.source, hidden: [], categories }),
    [allEvents, parts.category, parts.source, categories],
  )
  const dayEvents = useMemo(() => eventsOnDay(filtered, todayDate), [filtered, todayDate])
  const todayCount = useMemo(() => eventsOnDay(filtered, new Date(now)).length, [filtered, now])
  const hasEventsOn = (d: Date) => filtered.some(e => daySlice(e, d) !== null)

  const selMeeting = todaySelId?.startsWith('meeting:') ? (meetings.find(m => `meeting:${m.id}` === todaySelId) ?? null) : null
  const selNative = todaySelId && !selMeeting ? (scheduleEvents.find(e => e.id === todaySelId) ?? null) : null
  const hasSelection = !!(selMeeting || selNative)
  const showDetailMobile = detailOpen && hasSelection
  const confirming = scheduleEvents.find(e => e.id === confirmId) ?? null
  // Duplicate Event is available only for a selected XPadite event; otherwise the menu says why not.
  const menuSelId = tab === 'today' ? todaySelId : weekSelId
  const menuSel = scheduleEvents.find(e => e.id === menuSelId) ?? null
  const duplicateHint = canDuplicate(menuSel) ? null : menuSelId ? 'Synced calendar events can\u2019t be duplicated.' : 'Select one of your events first.'

  function updateMeeting(id: string, patch: Partial<XpaditeMeeting>) {
    setMeetings(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  function handleJoin() {
    setToast('This is a mock meeting link — real joining connects once calendar sync is live.')
  }

  function handleRemove(id: string) {
    setMeetings(prev => prev.filter(m => m.id !== id))
    if (todaySelId === `meeting:${id}`) setTodaySelId(null)
  }

  // Opening one slide-down panel replaces the other; a changing nonce re-initialises the filter draft / refocuses the search input.
  function changePanel(kind: 'search' | 'filter' | null) {
    setPanel(p => (kind === null ? { ...p, kind: null } : { kind, nonce: p.nonce + 1 }))
  }
  function applyFilter(st: FilterState) { setFilter(st.filter); setHidden(st.hidden); setHiddenSources(st.hiddenSources) }

  function toggleCategory(id: ScheduleCategoryId) {
    setHidden(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]))
  }

  function selectTodayDate(d: Date) {
    const day = startOfDay(d)
    if (!isSameLocalDay(day, todayDate)) { setTodaySelId(null); setDetailOpen(false) }      // a different day → the old selection is no longer on screen
    setTodayDate(day)
    setViewMonth(startOfMonth(day))
  }

  function toggleCalendar() {
    if (calExpanded) setViewMonth(startOfMonth(todayDate))        // collapsing → the week's month; the selected date is untouched
    setCalExpanded(v => !v)
  }

  // ── Add / Edit / Duplicate / Move / Delete (shared by both tabs; in-memory preview) ──
  function openAdd() {
    setForm({ mode: 'add', initial: blankForm(tab === 'today' ? todayDate : activeDay, 9, prefs.defaultDurationMins) })
  }

  // Empty calendar slot: the same Add form, prefilled with that date/time and the default duration.
  function openAddAt(day: Date, startMin: number) {
    setForm({ mode: 'add', initial: blankFormAt(day, startMin, prefs.defaultDurationMins) })
  }

  function openEdit(ev: ScheduleEvent) {
    if (ev.readOnly) return
    setForm({ mode: 'edit', id: ev.id, initial: eventToForm(ev), original: { startAt: ev.startAt, endAt: ev.endAt } })
  }

  function openDuplicate(ev: ScheduleEvent) {
    if (!canDuplicate(ev)) return
    setForm({
      mode: 'add', initial: duplicateFormValues(ev, allEvents), heading: 'Duplicate Event',
      hint: `Pick the new date and start time \u2014 the end follows from the original length (${durationLabel(ev.startAt, ev.endAt)}). The original event isn\u2019t changed.`,
    })
  }

  function formConflictFor(v: ScheduleFormValues): string | null {
    if (!form) return null
    return form.mode === 'edit'
      ? formConflict(v, allEvents, { excludeId: form.id, original: form.original, fmt })
      : formConflict(v, allEvents, { fmt })
  }

  function submitForm(v: ScheduleFormValues) {
    const conflict = formConflictFor(v)
    if (conflict) { setToast(conflict); return }          // the form already shows it and keeps the inputs; this is the backstop
    const fields = formToEventFields(v)
    let id: string
    if (form?.mode === 'edit') {
      id = form.id
      setScheduleEvents(prev => prev.map(e => (e.id === id ? { ...e, ...fields } : e)))
      setToast('Event updated in this preview \u2014 not saved yet')
    } else {
      id = `user-sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      setScheduleEvents(prev => [...prev, { id, ...fields }])
      setToast('Event added to this preview \u2014 not saved yet')
    }
    setFocus({ id, at: fields.startAt, nonce: Date.now() })
    setTodayDate(startOfDay(new Date(fields.startAt)))
    setViewMonth(startOfMonth(new Date(fields.startAt)))
    setTodaySelId(id)
    setDetailOpen(true)
    setForm(null)
  }

  // Drag-and-drop drop: re-validated here (the grid already showed the user the result) before anything changes.
  function moveEvent(ev: ScheduleEvent, startAt: number) {
    const cur = scheduleEvents.find(e => e.id === ev.id)
    if (!cur) return
    const blocked = dragBlockReason(cur)
    if (blocked) { setToast(blocked.message); return }
    const endAt = startAt + (cur.endAt - cur.startAt)                 // the exact original duration
    const conflicts = findConflicts({ startAt, endAt, excludeId: cur.id }, allEvents)
    if (conflicts.length > 0) { setToast(conflictMessage(conflicts, startAt, fmt) ?? 'That time is taken.'); return }
    setScheduleEvents(prev => prev.map(e => (e.id === cur.id ? { ...e, startAt, endAt } : e)))
    setFocus({ id: cur.id, at: startAt, nonce: Date.now(), quiet: true })   // keep it selected, but don't pop the details sheet over the result
    setTodayDate(startOfDay(new Date(startAt)))
    setViewMonth(startOfMonth(new Date(startAt)))
    setToast('Event moved in this preview \u2014 not saved yet')
  }

  // ── Categories (custom ones are in memory only) ──
  function newCategoryId() { return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
  const customOnly = (list: ScheduleCategory[]) => list.filter(c => !c.builtIn)

  function handleAddCategory(name: string, hex: string): string | null {
    const r = addCategory(categories, name, hex, newCategoryId())
    if (!r.ok) return r.error
    setCustomCategories(customOnly(r.categories))
    return null
  }
  function handleRenameCategory(id: string, name: string): string | null {
    const r = renameCategory(categories, id, name)
    if (!r.ok) return r.error
    setCustomCategories(customOnly(r.categories))
    return null
  }
  function handleRecolorCategory(id: string, hex: string): string | null {
    const r = recolorCategory(categories, id, hex)
    if (!r.ok) return r.error
    setCustomCategories(customOnly(r.categories))
    return null
  }
  function handleDeleteCategory(id: string, replacementId?: string): string | null {
    const r = deleteCategory(categories, scheduleEvents, id, replacementId)
    if (!r.ok) return r.error
    setCustomCategories(customOnly(r.categories))
    setScheduleEvents(r.events)
    setHidden(h => h.filter(x => x !== id))
    setFilter(f => (f === id ? 'all' : f))
    setToast(r.reassigned > 0 ? `Category deleted \u2014 ${r.reassigned} event${r.reassigned === 1 ? '' : 's'} moved` : 'Category deleted')
    return null
  }

  function confirmDelete() {
    if (!confirming) return
    const id = confirming.id
    setScheduleEvents(prev => prev.filter(e => e.id !== id))
    if (todaySelId === id) setTodaySelId(null)
    setConfirmId(null)
    setToast('Event deleted from this preview')
  }

  const tabCount = (k: TabKey) => (k === 'today' ? todayCount : 0)
  const isTodayDate = isSameLocalDay(todayDate, new Date(now))
  const agendaLabel = isTodayDate ? 'Today' : todayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  // Phones: the modal covers the whole screen (above the bottom bar). Larger screens: Analytics' sizing — same padding,
  // sm:640 / lg:1296 max widths (md:900 on tablets so the seven-day grid keeps its room), height = viewport minus padding.
  return (
    <ScheduleContext.Provider value={ctx}>
    <div
      className="fixed inset-0 z-[70] flex flex-col sm:flex-row sm:items-start sm:justify-center sm:p-3 sm:pt-4"
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
        @keyframes xp-meet-overlay-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
        .xp-meet-overlay { animation: xp-meet-overlay-in 160ms ease-out; }
        /* phone sheets (Filter, Manage Categories, Preferences, Add/Edit): one easing + duration for all of them */
        .xp-sheet-fade { transition: opacity 260ms ease; }
        .xp-sheet-panel { transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1); }
        @media (prefers-reduced-motion: reduce) { .xp-sheet-fade, .xp-sheet-panel { transition: none !important; } .xp-meet-overlay { animation: none; } }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xp-meet-title"
        className="relative w-full h-full sm:h-[calc(100dvh-28px)] sm:max-w-[640px] md:max-w-[900px] lg:max-w-[1296px] rounded-none sm:rounded-2xl max-sm:border-0! overflow-hidden flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="xp-meet-hdr flex items-center justify-between flex-shrink-0"
          style={{ padding: '14px 20px', paddingTop: 'max(14px, env(safe-area-inset-top, 0px))', borderBottom: '0.5px solid rgba(255,255,255,0.12)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.32)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" /></svg>
            </div>
            <div className="min-w-0">
              <h2 id="xp-meet-title" style={{ fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.01em', lineHeight: 1.2 }}>My Schedule</h2>
              <p className="truncate" style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>Schedule your day, all in one place.</p>
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

        {/* Tabs + the one Add Event button (shared by both tabs) */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 pt-3 pb-2.5 flex-shrink-0">
          <div className="flex items-center gap-0.5 sm:gap-1" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)', width: 'fit-content' }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setWeekSelId(null); setPanel(p => ({ ...p, kind: null })) }}
                className="text-[11.5px] sm:text-[12px] whitespace-nowrap px-2 min-[361px]:px-2.5 sm:px-3"
                style={{
                  paddingTop: 6, paddingBottom: 6, borderRadius: 7,
                  fontWeight: tab === t.key ? 700 : 500,
                  background: tab === t.key ? '#7c3aed' : 'transparent',
                  color: tab === t.key ? '#ffffff' : 'var(--xp-txt2)',
                }}
              >
                {t.label(tabCount(t.key))}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <button type="button" onClick={openAdd} aria-label="Add Event" className="flex items-center gap-1 text-[12px] min-[361px]:text-[12.5px] font-semibold text-white flex-shrink-0 px-2.5 min-[361px]:px-[13px]" style={{ paddingTop: 7, paddingBottom: 7, borderRadius: 10, background: '#7c3aed' }}>
              <span aria-hidden="true" className="text-[15px] leading-none">+</span> Add Event
            </button>
            <ScheduleMenu
              onManageCategories={() => setDialog('categories')}
              onDuplicate={() => { if (menuSel) openDuplicate(menuSel) }}
              onPreferences={() => setDialog('prefs')}
              duplicateHint={duplicateHint}
              onSearch={phone && tab === 'schedule' ? () => changePanel('search') : undefined}
              onFilter={phone && tab === 'schedule' ? () => changePanel('filter') : undefined}
            />
          </div>
        </div>

        {/* Body */}
        {tab === 'schedule' ? (
          <MyScheduleView
            events={allEvents}
            filter={filter}
            onFilterChange={setFilter}
            hidden={hidden}
            onToggleCategory={toggleCategory}
            now={now}
            focus={focus}
            onEdit={openEdit}
            onDelete={ev => setConfirmId(ev.id)}
            onDuplicate={openDuplicate}
            onActiveDayChange={setActiveDay}
            onSelectionChange={setWeekSelId}
            onAddAt={openAddAt}
            onMove={moveEvent}
            onNotice={setToast}
            query={query}
            onQueryChange={setQuery}
            panel={panel}
            onPanelChange={changePanel}
            hiddenSources={hiddenSources}
            onApplyFilter={applyFilter}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* Left: dark mini calendar + chronological agenda */}
            <div
              className={`${showDetailMobile ? 'hidden md:flex' : 'flex'} md:w-[340px] flex-1 md:flex-none flex-col min-h-0 gap-3 p-3`}
              style={{ background: '#12141f', borderRight: '0.5px solid var(--xp-bdr)' }}
            >
              <ScheduleMiniCalendar
                viewMonth={viewMonth}
                onViewMonthChange={setViewMonth}
                selected={todayDate}
                onSelect={selectTodayDate}
                today={new Date(now)}
                hasEvents={hasEventsOn}
                expanded={calExpanded}
                onToggle={toggleCalendar}
                weekStart={prefs.weekStart}
                onToday={() => selectTodayDate(new Date())}
              />
              <div className="flex items-center justify-between gap-2 flex-shrink-0 px-1">
                <p className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: '#9ca3af', letterSpacing: '0.06em' }}>
                  {agendaLabel} · {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                </p>
                <FilterSelect value={filter} onChange={setFilter} className="w-[128px]" style={{ fontSize: 12, padding: '4px 6px', borderRadius: 8, background: '#232640', color: '#e5e7eb', border: '0.5px solid rgba(139,92,246,0.3)' }} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2" style={{ overscrollBehavior: 'contain' }} data-testid="today-agenda">
                {dayEvents.length === 0 ? (
                  <p className="text-center text-[13px] font-medium px-6 py-10" style={{ color: '#9ca3af' }}>
                    {filter === 'all' ? 'No events on this day.' : 'No events on this day match this filter.'}
                  </p>
                ) : (
                  dayEvents.map(ev => (
                    <AgendaItem
                      key={ev.id}
                      ev={ev}
                      meeting={ev.id.startsWith('meeting:') ? (meetings.find(m => `meeting:${m.id}` === ev.id) ?? null) : null}
                      now={now}
                      selected={todaySelId === ev.id}
                      onSelect={() => { setTodaySelId(ev.id); setDetailOpen(true) }}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Right: selected event details */}
            <div className={`${showDetailMobile ? 'flex xp-meet-overlay' : 'hidden md:flex'} flex-1 min-h-0 flex-col`}>
              {selMeeting ? (
                <MeetingDetail
                  meeting={selMeeting}
                  now={now}
                  autoAdd={autoAdd}
                  onJoin={handleJoin}
                  onAddToTaskManager={() => updateMeeting(selMeeting.id, { addedToTaskManager: true, linkedTaskId: `mock-task-${selMeeting.id}` })}
                  onRemove={() => handleRemove(selMeeting.id)}
                  onNotesChange={text => updateMeeting(selMeeting.id, { notes: text })}
                  onClose={() => setDetailOpen(false)}
                  showClose={true}
                />
              ) : selNative ? (
                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" style={{ overscrollBehavior: 'contain' }}>
                  <button
                    type="button" onClick={() => setDetailOpen(false)} aria-label="Back"
                    className="md:hidden flex items-center gap-1 text-[12px] font-medium mb-3"
                    style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Back
                  </button>
                  <EventDetails ev={selNative} onEdit={() => openEdit(selNative)} onDelete={() => setConfirmId(selNative.id)} onDuplicate={() => openDuplicate(selNative)} />
                  <p className="text-[11px] mt-4" style={{ color: 'var(--xp-txt3)' }}>Preview — events you add aren’t saved or synced yet.</p>
                </div>
              ) : (
                <EmptyDetailState />
              )}
            </div>
          </div>
        )}

        {/* Dialogs (cover the whole modal) */}
        {lastForm && (
          <EventForm key={lastForm.id} open={!!form} mode={lastForm.data.mode} initial={lastForm.data.initial}
            heading={lastForm.data.mode === 'add' ? lastForm.data.heading : undefined} hint={lastForm.data.mode === 'add' ? lastForm.data.hint : undefined}
            getConflict={formConflictFor} onCancel={() => setForm(null)} onSubmit={submitForm} />
        )}
        {lastDialog === 'categories' && (
          <ManageCategoriesDialog open={dialog === 'categories'} categories={categories} events={scheduleEvents} onAdd={handleAddCategory} onRename={handleRenameCategory} onRecolor={handleRecolorCategory} onDelete={handleDeleteCategory} onClose={() => setDialog(null)} />
        )}
        {lastDialog === 'prefs' && <PreferencesDialog open={dialog === 'prefs'} prefs={prefs} onApply={next => { setPrefs(sanitizePrefs(next)); setDialog(null) }} onClose={() => setDialog(null)} />}
        {confirming && <ConfirmDelete ev={confirming} onCancel={() => setConfirmId(null)} onConfirm={confirmDelete} />}
      </div>
    </div>
    </ScheduleContext.Provider>
  )
}
