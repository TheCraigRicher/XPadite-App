'use client'

// ── My Schedule — shared UI pieces ──────────────────────────────────────────
// Used by the weekly view (MyScheduleView) and by the modal itself (Add/Edit form, delete confirmation, Today details),
// so there is exactly one implementation of each. Frontend only; nothing here persists anything.

import { useEffect, useState } from 'react'
import {
  SCHEDULE_CATEGORIES, REMINDER_OPTIONS, RECURRENCE_OPTIONS, FILTER_OPTIONS,
  categoryMeta, durationLabel, longDateLabel, meetingLinkLabel, recurrenceLabel, reminderLabel, safeHttpUrl,
  timeRangeLabel, validateScheduleForm,
} from './scheduleLogic'
import type { CombinedFilter, ScheduleCategoryId, ScheduleEvent, ScheduleFormErrors, ScheduleFormValues } from './scheduleLogic'

/** Marker so the modal's Escape handler lets an open sub-dialog close first (see MeetingsModal). */
export const LAYER_ATTR = 'data-xp-sched-layer'

export const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
}

export function Chevron({ dir }: { dir: 'left' | 'right' | 'up' | 'down' }) {
  const pts = { left: '15 18 9 12 15 6', right: '9 18 15 12 9 6', up: '18 15 12 9 6 15', down: '6 9 12 15 18 9' }[dir]
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12" aria-hidden="true"><polyline points={pts} strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function CategoryDot({ id, size = 10 }: { id: ScheduleCategoryId; size?: number }) {
  const c = categoryMeta(id)
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 3, background: c.bg, border: `1.5px solid ${c.edge}`, display: 'inline-block', flexShrink: 0 }} />
}

// ── Event details (sidebar + bottom sheet) ──────────────────────────────────

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-[78px] flex-shrink-0 text-[11px] font-semibold uppercase" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.04em', paddingTop: 1 }}>{label}</dt>
      <dd className="min-w-0 text-[12.5px] leading-snug break-words" style={{ color: 'var(--xp-txt)' }}>{children}</dd>
    </div>
  )
}

export function EventDetails({ ev, onEdit, onDelete }: { ev: ScheduleEvent; onEdit: () => void; onDelete: () => void }) {
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

export function EmptyDetails() {
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

export function useLayerEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

export function EventSheet({ ev, onClose, onEdit, onDelete }: { ev: ScheduleEvent; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
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

export function ConfirmDelete({ ev, onCancel, onConfirm }: { ev: ScheduleEvent; onCancel: () => void; onConfirm: () => void }) {
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

export function EventForm({ mode, initial, onCancel, onSubmit }: { mode: 'add' | 'edit'; initial: ScheduleFormValues; onCancel: () => void; onSubmit: (v: ScheduleFormValues) => void }) {
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


// ── The single combined filter (categories, then Google Calendar / Outlook at the bottom) ──

export function FilterSelect({ value, onChange, className, style }: { value: CombinedFilter; onChange: (v: CombinedFilter) => void; className?: string; style?: React.CSSProperties }) {
  return (
    <label className="flex-shrink-0">
      <span className="sr-only">Filter by category or calendar</span>
      <select
        value={value} onChange={e => onChange(e.target.value as CombinedFilter)} aria-label="Filter by category or calendar" className={className}
        style={{ padding: '7px 6px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', fontSize: 16, maxWidth: 170, ...style }}
      >
        {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

