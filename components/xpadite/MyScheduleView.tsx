'use client'

// ── My Schedule — weekly scheduler (frontend V1) ────────────────────────────
// Body of the "My Schedule" tab inside MeetingsModal. Renders a seven-column, 24-hour weekly grid plus (desktop/large
// tablet) a right-hand Upcoming / Selected Event / Color Categories sidebar. Smaller screens get the same grid with the
// selected event in a bottom sheet. Sample events + read-only synced meetings only — nothing here is persisted.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { XpaditeMeeting } from './meetingsMockData'
import {
  SCHEDULE_CATEGORIES, REMINDER_OPTIONS, RECURRENCE_OPTIONS,
  addDays, blankForm, categoryMeta, clockLabel, durationLabel, eventToForm, filterScheduleEvents, formToEventFields,
  hourLabel, isSameLocalDay, layoutDayEvents, longDateLabel, meetingLinkLabel, monthYearLabel, recurrenceLabel,
  reminderLabel, safeHttpUrl, shiftMonth, shortDayLabel, startOfDay, timeRangeLabel, validateScheduleForm, weekDays,
  weekRangeLabel, monthYearShort,
} from './scheduleLogic'
import type { ScheduleCategoryId, ScheduleEvent, ScheduleFormErrors, ScheduleFormValues } from './scheduleLogic'

// ── Layout constants ────────────────────────────────────────────────────────

const HOUR_PX = 56
const INITIAL_SCROLL_HOUR = 5
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// The time column is narrower on phones (--xp-sch-tc, see the <style> block) so the seven day columns get the room.
const GRID_COLS = 'var(--xp-sch-tc) repeat(7, minmax(0, 1fr))'

/** Marker so the modal's Escape handler lets an open sub-dialog close first (see MeetingsModal). */
const LAYER_ATTR = 'data-xp-sched-layer'

// Synced meetings appear on the grid as read-only "Meeting" blocks.
function meetingToEvent(m: XpaditeMeeting): ScheduleEvent {
  return {
    id: `meeting:${m.id}`,
    title: m.title,
    category: 'meeting',
    startAt: m.startAt,
    endAt: m.endAt,
    meetingUrl: m.meetingUrl ?? undefined,
    notes: m.notes || undefined,
    readOnly: true,
    sourceLabel: m.calendarSource,
    isCancelled: m.isCancelled,
  }
}

// ── Small shared pieces ─────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

function Chevron({ dir }: { dir: 'left' | 'right' | 'up' | 'down' }) {
  const pts = { left: '15 18 9 12 15 6', right: '9 18 15 12 9 6', up: '18 15 12 9 6 15', down: '6 9 12 15 18 9' }[dir]
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12" aria-hidden="true"><polyline points={pts} strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function NavGroup({ label, shortLabel, onPrev, onNext, prevLabel, nextLabel, minWidth }: { label: string; shortLabel?: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; minWidth: number }) {
  return (
    <div className="flex items-center gap-1 sm:gap-1.5" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
      <button type="button" onClick={onPrev} aria-label={prevLabel} style={{ ...iconBtn, width: 26, height: 26, background: 'var(--xp-card)' }}><Chevron dir="left" /></button>
      <span className="text-[12px] sm:text-[12.5px] font-semibold text-center whitespace-nowrap" style={{ color: 'var(--xp-txt)', minWidth }} aria-live="polite" aria-label={label}>
        {shortLabel ? <><span className="sm:hidden">{shortLabel}</span><span className="hidden sm:inline">{label}</span></> : label}
      </span>
      <button type="button" onClick={onNext} aria-label={nextLabel} style={{ ...iconBtn, width: 26, height: 26, background: 'var(--xp-card)' }}><Chevron dir="right" /></button>
    </div>
  )
}

function CategoryDot({ id, size = 10 }: { id: ScheduleCategoryId; size?: number }) {
  const c = categoryMeta(id)
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 3, background: c.bg, border: `1.5px solid ${c.edge}`, display: 'inline-block', flexShrink: 0 }} />
}

function CategoryChecklist({ hidden, onToggle }: { hidden: ScheduleCategoryId[]; onToggle: (id: ScheduleCategoryId) => void }) {
  return (
    <ul className="flex flex-col gap-2" role="group" aria-label="Show categories">
      {SCHEDULE_CATEGORIES.map(c => {
        const on = !hidden.includes(c.id)
        return (
          <li key={c.id}>
            <label className="flex items-center gap-2.5 cursor-pointer text-[12.5px]" style={{ color: 'var(--xp-txt)' }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} className="sr-only peer" />
              <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0" style={{ width: 17, height: 17, borderRadius: 5, background: on ? '#7c3aed' : 'transparent', border: `1.5px solid ${on ? '#7c3aed' : 'var(--xp-bdr2)'}` }}>
                {on && <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="white" strokeWidth="3.4"><polyline points="5 12.5 10 17.5 19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span aria-hidden="true" style={{ width: 28, height: 12, borderRadius: 6, background: c.bg, border: `1px solid ${c.edge}`, opacity: on ? 1 : 0.45 }} />
              <span style={{ opacity: on ? 1 : 0.6 }}>{c.label}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function Card({ title, right, children, grow }: { title: string; right?: React.ReactNode; children: React.ReactNode; grow?: boolean }) {
  return (
    <section className={grow ? 'flex-1 min-h-0 flex flex-col' : 'flex-shrink-0'} style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 14, padding: '12px 13px' }}>
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-shrink-0">
        <h3 className="text-[13.5px] font-bold" style={{ color: 'var(--xp-txt)' }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

// ── Event details (sidebar + bottom sheet) ──────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-[78px] flex-shrink-0 text-[11px] font-semibold uppercase" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.04em', paddingTop: 1 }}>{label}</dt>
      <dd className="min-w-0 text-[12.5px] leading-snug break-words" style={{ color: 'var(--xp-txt)' }}>{children}</dd>
    </div>
  )
}

function EventDetails({ ev, onEdit, onDelete }: { ev: ScheduleEvent; onEdit: () => void; onDelete: () => void }) {
  const cat = categoryMeta(ev.category)
  const link = safeHttpUrl(ev.meetingUrl)
  const reminder = reminderLabel(ev.reminderMins)
  const repeat = recurrenceLabel(ev.recurrence)
  return (
    <div className="flex flex-col gap-3" style={{ borderLeft: `3.5px solid ${cat.edge}`, paddingLeft: 11 }}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[15px] font-bold leading-snug min-w-0 break-words" style={{ color: 'var(--xp-txt)', textDecoration: ev.isCancelled ? 'line-through' : 'none' }}>{ev.title}</h4>
        {!ev.readOnly && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button type="button" onClick={onEdit} aria-label="Edit event" title="Edit" style={{ ...iconBtn, width: 28, height: 28, color: '#7c3aed' }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" onClick={onDelete} aria-label="Delete event" title="Delete" style={{ ...iconBtn, width: 28, height: 28, color: '#dc2626' }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
      </div>
      <dl className="flex flex-col gap-2">
        <DetailRow label="Date">{longDateLabel(ev.startAt)}</DetailRow>
        <DetailRow label="Time">{timeRangeLabel(ev.startAt, ev.endAt)} <span style={{ color: 'var(--xp-txt3)' }}>({durationLabel(ev.startAt, ev.endAt)})</span></DetailRow>
        <DetailRow label="Category"><span className="inline-flex items-center gap-1.5"><CategoryDot id={ev.category} />{cat.label}</span></DetailRow>
        {ev.location && <DetailRow label="Location">{ev.location}</DetailRow>}
        {ev.meetingUrl && (
          <DetailRow label="Link">
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className="font-semibold underline-offset-2 hover:underline break-all" style={{ color: '#7c3aed' }}>
                {meetingLinkLabel(link)} ↗
              </a>
            ) : <span style={{ color: 'var(--xp-txt3)' }}>{ev.meetingUrl}</span>}
          </DetailRow>
        )}
        {ev.notes && <DetailRow label="Notes"><span className="whitespace-pre-wrap">{ev.notes}</span></DetailRow>}
        {reminder && <DetailRow label="Reminder">{reminder}</DetailRow>}
        {repeat && <DetailRow label="Repeats">{repeat}</DetailRow>}
        {ev.sourceLabel && <DetailRow label="Source">{ev.sourceLabel}</DetailRow>}
      </dl>
      {ev.readOnly && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--xp-txt3)' }}>
          Synced from {ev.sourceLabel ?? 'your calendar'} — read-only here. Change it in {ev.sourceLabel ?? 'the source calendar'}.
        </p>
      )}
    </div>
  )
}

function EmptyDetails() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6" style={{ color: 'var(--xp-txt3)' }}>
      <div className="flex items-center justify-center mb-2" style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" /></svg>
      </div>
      <p className="text-[12.5px] font-medium">No event selected</p>
      <p className="text-[11px] mt-0.5">Tap an event on the calendar to see its details.</p>
    </div>
  )
}

// ── Dialog layers (inside the modal) ────────────────────────────────────────

function useLayerEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function EventSheet({ ev, onClose, onEdit, onDelete }: { ev: ScheduleEvent; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  useLayerEscape(onClose)
  return (
    <div {...{ [LAYER_ATTR]: '' }} className="lg:hidden absolute inset-0 z-30 flex items-end" style={{ background: 'rgba(0,0,0,0.42)' }} onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Event details"
        className="xp-sch-sheet w-full overflow-y-auto"
        style={{ background: 'var(--xp-card)', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '10px 16px 18px', maxHeight: '78%', overscrollBehavior: 'contain', boxShadow: '0 -12px 40px rgba(0,0,0,0.3)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Selected Event</span>
          <button type="button" onClick={onClose} aria-label="Close details" style={{ ...iconBtn, width: 28, height: 28 }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <EventDetails ev={ev} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  )
}

function ConfirmDelete({ ev, onCancel, onConfirm }: { ev: ScheduleEvent; onCancel: () => void; onConfirm: () => void }) {
  useLayerEscape(onCancel)
  return (
    <div {...{ [LAYER_ATTR]: '' }} className="absolute inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-label="Delete event" className="w-full max-w-[340px] text-center" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 16, padding: '20px 18px', boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()}>
        <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--xp-txt)' }}>Delete this event?</p>
        <p className="text-[12.5px] mb-4 break-words" style={{ color: 'var(--xp-txt2)' }}>“{ev.title}” on {longDateLabel(ev.startAt)} will be removed from this preview.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 text-[13px] font-medium" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Cancel</button>
          <button type="button" onClick={onConfirm} className="flex-1 text-[13px] font-semibold text-white" style={{ padding: '10px 12px', borderRadius: 10, background: '#dc2626' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
  padding: '9px 11px', color: 'var(--xp-txt)', outline: 'none', fontSize: 16 /* ≥16px: no iOS focus-zoom */,
}

function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>{label}</label>
      {children}
      {error && <p role="alert" className="text-[11px]" style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  )
}

function EventForm({ mode, initial, onCancel, onSubmit }: { mode: 'add' | 'edit'; initial: ScheduleFormValues; onCancel: () => void; onSubmit: (v: ScheduleFormValues) => void }) {
  const [v, setV] = useState<ScheduleFormValues>(initial)
  const [errors, setErrors] = useState<ScheduleFormErrors>({})
  const [tried, setTried] = useState(false)
  useLayerEscape(onCancel)

  function set<K extends keyof ScheduleFormValues>(k: K, val: ScheduleFormValues[K]) {
    const next = { ...v, [k]: val }
    setV(next)
    if (tried) setErrors(validateScheduleForm(next))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    const errs = validateScheduleForm(v)
    setErrors(errs)
    if (Object.keys(errs).length === 0) onSubmit(v)
  }

  return (
    <div {...{ [LAYER_ATTR]: '' }} className="absolute inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <form
        onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-label={mode === 'add' ? 'Add event' : 'Edit event'}
        className="xp-sch-sheet w-full sm:max-w-[480px] flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 18, maxHeight: '94%', boxShadow: '0 24px 60px rgba(0,0,0,0.38)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--xp-txt)' }}>{mode === 'add' ? 'Add Event' : 'Edit Event'}</h3>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ ...iconBtn, width: 28, height: 28 }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3" style={{ overscrollBehavior: 'contain' }}>
          <Field label="Title *" htmlFor="sch-title" error={errors.title}>
            <input id="sch-title" value={v.title} maxLength={120} onChange={e => set('title', e.target.value)} placeholder="e.g. Study session" style={fieldStyle} autoFocus />
          </Field>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
            <Field label="Date *" htmlFor="sch-date" error={errors.date}>
              <input id="sch-date" type="date" value={v.date} onChange={e => set('date', e.target.value)} style={fieldStyle} />
            </Field>
            <Field label="Start *" htmlFor="sch-start" error={errors.start}>
              <input id="sch-start" type="time" step={900} value={v.start} onChange={e => set('start', e.target.value)} style={fieldStyle} />
            </Field>
            <Field label="End *" htmlFor="sch-end" error={errors.end}>
              <input id="sch-end" type="time" step={900} value={v.end} onChange={e => set('end', e.target.value)} style={fieldStyle} />
            </Field>
          </div>
          <Field label="Category" htmlFor="sch-category">
            <div id="sch-category" role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
              {SCHEDULE_CATEGORIES.map(c => {
                const on = v.category === c.id
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => set('category', c.id)}
                    className="inline-flex items-center gap-1.5 text-[12px]"
                    style={{ padding: '6px 10px', borderRadius: 999, background: on ? c.bg : 'var(--xp-bg3)', border: `1.5px solid ${on ? c.edge : 'var(--xp-bdr2)'}`, color: on ? c.text : 'var(--xp-txt2)', fontWeight: on ? 700 : 500 }}>
                    <CategoryDot id={c.id} size={9} />{c.label}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Location (optional)" htmlFor="sch-location">
            <input id="sch-location" value={v.location} maxLength={120} onChange={e => set('location', e.target.value)} placeholder="Room, classroom or venue" style={fieldStyle} />
          </Field>
          <Field label="Online meeting link (optional)" htmlFor="sch-url" error={errors.meetingUrl}>
            <input id="sch-url" type="url" inputMode="url" value={v.meetingUrl} maxLength={300} onChange={e => set('meetingUrl', e.target.value)} placeholder="Google Meet, Zoom or Teams link" style={fieldStyle} />
          </Field>
          <Field label="Notes (optional)" htmlFor="sch-notes">
            <textarea id="sch-notes" rows={3} value={v.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} placeholder="Anything to remember…" style={{ ...fieldStyle, resize: 'none' }} />
          </Field>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <Field label="Reminder (optional)" htmlFor="sch-reminder">
              <select id="sch-reminder" value={v.reminderMins === null ? '' : String(v.reminderMins)} onChange={e => set('reminderMins', e.target.value === '' ? null : Number(e.target.value))} style={fieldStyle}>
                {REMINDER_OPTIONS.map(o => <option key={String(o.value)} value={o.value === null ? '' : String(o.value)}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Repeat (optional)" htmlFor="sch-repeat">
              <select id="sch-repeat" value={v.recurrence} onChange={e => set('recurrence', e.target.value as ScheduleFormValues['recurrence'])} style={fieldStyle}>
                {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'var(--xp-txt3)' }}>
            Preview only — events you add here aren’t saved or synced yet and disappear when you close My Schedule.
          </p>
        </div>

        <div className="flex gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <button type="button" onClick={onCancel} className="flex-1 text-[13px] font-medium" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Cancel</button>
          <button type="submit" className="flex-1 text-[13px] font-semibold text-white" style={{ padding: '10px 12px', borderRadius: 10, background: '#7c3aed' }}>{mode === 'add' ? 'Add Event' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Weekly grid ─────────────────────────────────────────────────────────────

function EventBlock({ p, selected, onSelect }: { p: ReturnType<typeof layoutDayEvents>[number]; selected: boolean; onSelect: () => void }) {
  const { event: ev } = p
  const cat = categoryMeta(ev.category)
  const heightPx = Math.max(((p.endMin - p.startMin) / 60) * HOUR_PX - 2, 14)
  const showTime = heightPx >= 40 && p.lanes <= 2
  const showPlace = heightPx >= 72 && p.lanes === 1 && !!ev.location
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onSelect() }}
      aria-label={`${ev.title}, ${timeRangeLabel(ev.startAt, ev.endAt)}${ev.isCancelled ? ', cancelled' : ''}`}
      aria-pressed={selected}
      className={`xp-sch-ev${p.lanes > 1 ? ' xp-sch-ev-narrow' : ''} absolute text-left overflow-hidden`}
      style={{
        top: (p.startMin / 60) * HOUR_PX + 1,
        height: heightPx,
        left: `calc(${(p.lane / p.lanes) * 100}% + 1px)`,
        width: `calc(${100 / p.lanes}% - 2px)`,
        background: cat.bg, color: cat.text,
        borderLeft: `3px solid ${cat.edge}`, borderRadius: 6,
        outline: selected ? '2px solid #7c3aed' : 'none', outlineOffset: 0,
        boxShadow: selected ? '0 3px 10px rgba(124,58,237,0.35)' : '0 1px 2px rgba(0,0,0,0.08)',
        zIndex: selected ? 3 : 2,
        opacity: ev.isCancelled ? 0.6 : 1,
      }}
    >
      <span className="xp-sch-ev-title block font-bold" style={{ textDecoration: ev.isCancelled ? 'line-through' : 'none' }}>{ev.title}</span>
      {showTime && <span className="xp-sch-ev-sub block truncate">{timeRangeLabel(ev.startAt, ev.endAt)}</span>}
      {showPlace && <span className="xp-sch-ev-sub hidden sm:block truncate">📍 {ev.location}</span>}
    </button>
  )
}

// ── Root ────────────────────────────────────────────────────────────────────

export interface MyScheduleViewProps {
  /** Meetings after the modal's source filter; shown read-only. */
  meetings: XpaditeMeeting[]
  events: ScheduleEvent[]
  setEvents: Dispatch<SetStateAction<ScheduleEvent[]>>
  now: number
  onViewAllUpcoming: () => void
  onToast: (message: string) => void
}

type FormState = { mode: 'add'; initial: ScheduleFormValues } | { mode: 'edit'; id: string; initial: ScheduleFormValues } | null

export function MyScheduleView({ meetings, events, setEvents, now, onViewAllUpcoming, onToast }: MyScheduleViewProps) {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ScheduleCategoryId | 'all'>('all')
  const [hidden, setHidden] = useState<ScheduleCategoryId[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [form, setForm] = useState<FormState>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [edges, setEdges] = useState({ up: false, down: true })

  const scrollerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const allEvents = useMemo(() => [...events, ...meetings.map(meetingToEvent)], [events, meetings])
  const visible = useMemo(() => filterScheduleEvents(allEvents, { query, category, hidden }), [allEvents, query, category, hidden])
  const layouts = useMemo(() => days.map(d => layoutDayEvents(visible, d)), [days, visible])
  const selected = useMemo(() => allEvents.find(e => e.id === selectedId) ?? null, [allEvents, selectedId])
  const confirming = useMemo(() => events.find(e => e.id === confirmId) ?? null, [events, confirmId])
  const upcoming = useMemo(
    () => visible.filter(e => !e.isCancelled && e.endAt >= now).sort((a, b) => a.startAt - b.startAt),
    [visible, now],
  )
  const today = new Date(now)
  const todayIdx = days.findIndex(d => isSameLocalDay(d, today))
  const nowMin = today.getHours() * 60 + today.getMinutes()

  // Open scrolled to 5 AM (midnight is one scroll up; the rest of the day is below).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX
    updateEdges()
  }, [])

  function updateEdges() {
    const el = scrollerRef.current
    if (!el) return
    const up = el.scrollTop > 6
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 6
    setEdges(prev => (prev.up === up && prev.down === down ? prev : { up, down }))
  }

  useEffect(() => {
    if (!filterOpen) return
    function onDown(e: MouseEvent) { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [filterOpen])

  function goToDate(d: Date) { setAnchor(startOfDay(d)) }

  function selectEvent(ev: ScheduleEvent) {
    setSelectedId(ev.id)
    setSelectedDay(startOfDay(new Date(ev.startAt)))
  }

  function toggleCategory(id: ScheduleCategoryId) {
    setHidden(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]))
  }

  // Add Event defaults to the day the user tapped, else today if it's in view, else the first day shown.
  function defaultAddDay(): Date {
    if (selectedDay && days.some(d => isSameLocalDay(d, selectedDay))) return selectedDay
    return days.find(d => isSameLocalDay(d, today)) ?? days[0]
  }

  function openAdd() { setForm({ mode: 'add', initial: blankForm(defaultAddDay()) }) }

  function openEdit(ev: ScheduleEvent) {
    if (ev.readOnly) return
    setForm({ mode: 'edit', id: ev.id, initial: eventToForm(ev) })
  }

  function submitForm(v: ScheduleFormValues) {
    const fields = formToEventFields(v)
    if (form?.mode === 'edit') {
      const id = form.id
      setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...fields } : e)))
      setSelectedId(id)
      onToast('Event updated in this preview — not saved yet')
    } else {
      const id = `user-sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      setEvents(prev => [...prev, { id, ...fields }])
      setSelectedId(id)
      onToast('Event added to this preview — not saved yet')
    }
    goToDate(new Date(fields.startAt))
    setSelectedDay(startOfDay(new Date(fields.startAt)))
    setForm(null)
  }

  function confirmDelete() {
    if (!confirming) return
    const id = confirming.id
    setEvents(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
    setConfirmId(null)
    onToast('Event deleted from this preview')
  }

  const hiddenCount = hidden.length + (category !== 'all' ? 1 : 0)

  return (
    <>
      <style>{`
        .xp-sch-root { --xp-sch-tc: 36px; }
        .xp-sch-ev { padding: 2px 3px; line-height: 1.12; cursor: pointer; }
        .xp-sch-ev-title { font-size: 9px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow-wrap: break-word; }
        .xp-sch-ev-sub { font-size: 8px; opacity: .82; margin-top: 1px; }
        @media (min-width: 640px) {
          .xp-sch-root { --xp-sch-tc: 46px; }
          .xp-sch-ev { padding: 4px 6px; }
          .xp-sch-ev-title { font-size: 11.5px; -webkit-line-clamp: 3; }
          .xp-sch-ev-sub { font-size: 10px; }
          .xp-sch-ev-narrow { padding: 3px 4px; }
          .xp-sch-ev-narrow .xp-sch-ev-title { font-size: 10.5px; }
        }
        @keyframes xp-sch-sheet-in { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .xp-sch-sheet { animation: xp-sch-sheet-in 170ms ease-out; }
        .xp-sch-day:focus-visible, .xp-sch-ev:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
      `}</style>

      <div className="xp-sch-root flex-1 min-h-0 flex overflow-hidden">
        {/* ── Main column ── */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col px-2 sm:px-4 pb-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pb-2.5 flex-shrink-0">
            <NavGroup label={monthYearLabel(anchor)} shortLabel={monthYearShort(anchor)} minWidth={64} prevLabel="Previous month" nextLabel="Next month"
              onPrev={() => setAnchor(a => shiftMonth(a, -1))} onNext={() => setAnchor(a => shiftMonth(a, 1))} />
            <NavGroup label={weekRangeLabel(anchor)} minWidth={92} prevLabel="Previous week" nextLabel="Next week"
              onPrev={() => setAnchor(a => addDays(a, -7))} onNext={() => setAnchor(a => addDays(a, 7))} />
            <button type="button" onClick={() => { goToDate(new Date()); setSelectedDay(startOfDay(new Date())) }}
              className="text-[12px] font-semibold" style={{ padding: '6px 9px', borderRadius: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.10)', border: '0.5px solid rgba(124,58,237,0.28)' }}>
              Today
            </button>

            <div className="flex items-center gap-2 flex-1 min-w-[340px]">
              <label className="relative flex-1 min-w-0">
                <span className="sr-only">Search events</span>
                <input
                  type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events, classes, meetings…"
                  className="w-full text-[12.5px]"
                  style={{ padding: '7px 30px 7px 11px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', outline: 'none', fontSize: 16 }}
                />
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--xp-txt3)" strokeWidth="2" className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
              </label>

              <label className="flex-shrink-0">
                <span className="sr-only">Filter by category</span>
                <select value={category} onChange={e => setCategory(e.target.value as ScheduleCategoryId | 'all')} aria-label="Filter by category"
                  className="w-[68px] sm:w-[104px]"
                  style={{ padding: '7px 6px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', fontSize: 16, maxWidth: 150 }}>
                  <option value="all">All</option>
                  {SCHEDULE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>

              {/* Compact filter control (below lg the legend sidebar is hidden) */}
              <div ref={filterRef} className="relative lg:hidden flex-shrink-0">
                <button type="button" onClick={() => setFilterOpen(o => !o)} aria-label="Show or hide categories" aria-expanded={filterOpen} style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: hidden.length ? '#7c3aed' : 'var(--xp-txt2)' }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5Z" /></svg>
                  {hidden.length > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 text-[9px] font-bold text-white flex items-center justify-center" style={{ width: 15, height: 15, borderRadius: '50%', background: '#7c3aed' }}>{hiddenCount}</span>}
                </button>
                {filterOpen && (
                  <div className="absolute right-0 z-20" style={{ top: 'calc(100% + 6px)', width: 232, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 12, padding: 12, boxShadow: '0 14px 36px rgba(0,0,0,0.25)' }}>
                    <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Show categories</p>
                    <CategoryChecklist hidden={hidden} onToggle={toggleCategory} />
                  </div>
                )}
              </div>

              <button type="button" onClick={openAdd} className="flex items-center gap-1 text-[12.5px] font-semibold text-white flex-shrink-0" style={{ padding: '7px 12px', borderRadius: 10, background: '#7c3aed' }}>
                <span aria-hidden="true" className="text-[15px] leading-none">+</span>
                <span className="hidden xl:inline">Add Event</span>
                <span className="xl:hidden">Add</span>
              </button>
            </div>
          </div>

          {/* Grid */}
          <div className="relative flex-1 min-h-0" style={{ border: '1px solid rgba(124,58,237,0.45)', borderRadius: 14, background: 'var(--xp-card)', overflow: 'hidden' }}>
            <div ref={scrollerRef} onScroll={updateEdges} className="h-full overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} data-testid="schedule-scroller">
              {/* Sticky weekday header — same column template as the body, so columns line up exactly */}
              <div className="sticky top-0 z-10" style={{ display: 'grid', gridTemplateColumns: GRID_COLS, background: 'var(--xp-card)', borderBottom: '1px solid var(--xp-bdr2)' }}>
                <div className="flex items-end justify-center pb-1.5 text-[10px] sm:text-[11px] font-semibold" style={{ color: 'var(--xp-txt3)' }}>Time</div>
                {days.map((d, i) => {
                  const isToday = i === todayIdx
                  const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                  return (
                    <button key={d.getTime()} type="button" onClick={() => setSelectedDay(startOfDay(d))} aria-pressed={isSel}
                      aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`}
                      className="xp-sch-day flex flex-col items-center min-w-0 py-1.5"
                      style={{ borderLeft: '1px solid var(--xp-bdr)', background: isToday ? 'rgba(124,58,237,0.10)' : 'transparent' }}>
                      <span className="text-[11px] sm:text-[13px] font-bold" style={{ color: isToday ? '#7c3aed' : 'var(--xp-txt)' }}>{DAY_NAMES[d.getDay()]}</span>
                      <span className="text-[9px] sm:text-[10.5px] font-semibold whitespace-nowrap mt-0.5"
                        style={{ padding: '1px 5px', borderRadius: 6, background: isToday ? '#7c3aed' : isSel ? 'rgba(124,58,237,0.18)' : 'var(--xp-bg3)', color: isToday ? '#fff' : isSel ? '#7c3aed' : 'var(--xp-txt3)' }}>
                        {shortDayLabel(d)}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* 24-hour body */}
              <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, height: 24 * HOUR_PX, position: 'relative' }}>
                <div className="relative" aria-hidden="true">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="absolute right-1.5 text-[9.5px] sm:text-[11px] whitespace-nowrap" style={{ top: h * HOUR_PX + 4, color: 'var(--xp-txt3)' }}>{hourLabel(h)}</span>
                  ))}
                </div>
                {days.map((d, i) => {
                  const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                  return (
                    <div key={d.getTime()} className="relative min-w-0" data-day={d.getDay()}
                      style={{
                        borderLeft: '1px solid var(--xp-bdr)',
                        background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX}px), ${i === todayIdx ? 'rgba(124,58,237,0.05)' : isSel ? 'rgba(124,58,237,0.03)' : 'transparent'}`,
                      }}>
                      {layouts[i].map(p => (
                        <EventBlock key={`${p.event.id}-${d.getDate()}`} p={p} selected={p.event.id === selectedId} onSelect={() => selectEvent(p.event)} />
                      ))}
                      {i === todayIdx && (
                        <div aria-hidden="true" className="absolute left-0 right-0 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX, height: 0, borderTop: '2px solid #ef4444', zIndex: 4 }}>
                          <span style={{ position: 'absolute', left: -4, top: -5, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Subtle "more hours" hints — never intercept touches */}
            {edges.up && (
              <div aria-hidden="true" className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ top: 46, height: 22, background: 'linear-gradient(to bottom, var(--xp-card), transparent)', color: '#7c3aed', zIndex: 11 }}>
                <Chevron dir="up" />
              </div>
            )}
            {edges.down && (
              <div aria-hidden="true" className="absolute left-0 right-0 bottom-0 flex items-end justify-center pointer-events-none" style={{ height: 24, background: 'linear-gradient(to top, var(--xp-card), transparent)', color: '#7c3aed', zIndex: 11 }}>
                <Chevron dir="down" />
              </div>
            )}
          </div>

          {visible.length === 0 && (
            <p className="text-center text-[11.5px] pt-2 flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>No events match your search or filters.</p>
          )}
          <p className="text-[10.5px] pt-1.5 flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>Preview — sample events; anything you add isn’t saved yet.</p>
        </div>

        {/* ── Sidebar (large screens) ── */}
        <aside className="hidden lg:flex flex-col gap-3 w-[296px] flex-shrink-0 min-h-0 overflow-y-auto pr-4 pb-3" style={{ overscrollBehavior: 'contain' }} aria-label="Schedule details">
          <Card title={`Upcoming (${upcoming.length})`} right={<button type="button" onClick={onViewAllUpcoming} className="text-[11.5px] font-semibold" style={{ color: '#7c3aed' }}>View All</button>}>
            {upcoming.length === 0 ? (
              <p className="text-[12px] py-2" style={{ color: 'var(--xp-txt3)' }}>Nothing coming up.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {upcoming.slice(0, 3).map(ev => {
                  const cat = categoryMeta(ev.category)
                  return (
                    <li key={ev.id}>
                      <button type="button" onClick={() => { selectEvent(ev); goToDate(new Date(ev.startAt)) }} className="w-full text-left"
                        style={{ padding: '7px 9px', borderRadius: 9, background: 'var(--xp-bg3)', borderLeft: `3px solid ${cat.edge}` }}>
                        <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--xp-txt)' }}>{ev.title}</p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--xp-txt3)' }}>{new Date(ev.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {clockLabel(ev.startAt)}</p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card title="Selected Event">
            {selected ? <EventDetails ev={selected} onEdit={() => openEdit(selected)} onDelete={() => setConfirmId(selected.id)} /> : <EmptyDetails />}
          </Card>

          <Card title="Color Categories">
            <CategoryChecklist hidden={hidden} onToggle={toggleCategory} />
          </Card>
        </aside>
      </div>

      {/* Layers (cover the whole modal) */}
      {selected && !form && !confirming && (
        <EventSheet ev={selected} onClose={() => setSelectedId(null)} onEdit={() => openEdit(selected)} onDelete={() => setConfirmId(selected.id)} />
      )}
      {form && <EventForm mode={form.mode} initial={form.initial} onCancel={() => setForm(null)} onSubmit={submitForm} />}
      {confirming && <ConfirmDelete ev={confirming} onCancel={() => setConfirmId(null)} onConfirm={confirmDelete} />}
    </>
  )
}
