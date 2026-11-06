'use client'

// ── My Schedule — shared UI pieces ──────────────────────────────────────────
// Used by the weekly view (MyScheduleView) and by the modal itself (Add/Edit form, delete confirmation, Today details),
// so there is exactly one implementation of each. Frontend only; nothing here persists anything.

import { useEffect, useRef, useState } from 'react'
import {
  REMINDER_OPTIONS, RECURRENCE_OPTIONS, filterOptions, formatTimeValue, parseTimeText, timeOptions,
  durationLabel, longDateLabel, meetingLinkLabel, recurrenceLabel, reminderLabel, safeHttpUrl,
  timeRangeLabel, validateScheduleForm,
} from './scheduleLogic'
import type { CombinedFilter, ScheduleCategoryId, ScheduleEvent, ScheduleFormErrors, ScheduleFormValues } from './scheduleLogic'
import { withDateChange, withStartChange } from './scheduleEngine'
import { useSchedule } from './scheduleContext'
import { LAYER_ATTR, SheetFrame, useIsPhone, usePopupBox, useSheetPhase } from './ScheduleSheet'

export { LAYER_ATTR } from './ScheduleSheet'

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
  const { meta } = useSchedule()
  const c = meta(id)
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

export function EventDetails({ ev, onEdit, onDelete, onDuplicate }: { ev: ScheduleEvent; onEdit: () => void; onDelete: () => void; onDuplicate?: () => void }) {
  const { meta, fmt } = useSchedule()
  const cat = meta(ev.category)
  const link = safeHttpUrl(ev.meetingUrl)
  const reminder = reminderLabel(ev.reminderMins)
  const repeat = recurrenceLabel(ev.recurrence)
  return (
    <div className="flex flex-col gap-3" style={{ borderLeft: `3.5px solid ${cat.edge}`, paddingLeft: 11 }}>
      {ev.readOnly && (
        <span data-testid="readonly-badge" className="self-start inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ padding: '3px 9px', borderRadius: 999, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" /></svg>
          {ev.sourceLabel ?? 'Synced calendar'} · read-only
        </span>
      )}
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
        <DetailRow label="Time">{timeRangeLabel(ev.startAt, ev.endAt, fmt)} <span style={{ color: 'var(--xp-txt3)' }}>({durationLabel(ev.startAt, ev.endAt)})</span></DetailRow>
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
      {!ev.readOnly && onDuplicate && (
        <button type="button" onClick={onDuplicate} className="self-start inline-flex items-center gap-1.5 text-[12px] font-semibold"
          style={{ padding: '6px 11px', borderRadius: 9, background: 'rgba(124,58,237,0.10)', border: '0.5px solid rgba(124,58,237,0.28)', color: '#7c3aed' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" strokeLinecap="round" /></svg>
          Duplicate
        </button>
      )}
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

export function EventSheet({ ev, onClose, onEdit, onDelete, onDuplicate }: { ev: ScheduleEvent; onClose: () => void; onEdit: () => void; onDelete: () => void; onDuplicate?: () => void }) {
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
        <EventDetails ev={ev} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
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

const TIME_STEP_MIN = 15

const popupStyle = (box: { top: number; left: number; width: number; maxHeight: number }): React.CSSProperties => ({
  position: 'fixed', top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight, overflowY: 'auto', overscrollBehavior: 'contain',
  zIndex: 60, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 12, padding: 4, boxShadow: '0 14px 36px rgba(0,0,0,0.3)',
})

function ChevronDown() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

/**
 * Time entry that follows the Schedule Preferences format (the browser's own <input type="time"> always follows the device locale).
 * Click/tap the field or its arrow for a scrollable list of every 15 minutes of the day (current time highlighted and scrolled to);
 * or type "2:30 pm", "14:30", "1430", "9"; or use the arrow keys. The form keeps its value as 24-hour "HH:MM", so changing the
 * display format never changes a stored time.
 */
function TimeField({ id, value, fmt, onChange }: { id: string; value: string; fmt: '12h' | '24h'; onChange: (hhmm: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const options = timeOptions(TIME_STEP_MIN)
  const shown = draft ?? formatTimeValue(value, fmt)
  const box = usePopupBox(open, wrapRef)

  // keep the highlighted row centred in the list (on open, and as the arrow keys move it)
  useEffect(() => {
    if (!open || !box) return
    const ul = listRef.current, el = ul?.children[active] as HTMLElement | undefined
    if (ul && el) ul.scrollTop = el.offsetTop - ul.clientHeight / 2 + el.offsetHeight / 2
  }, [open, box, active])

  const nearest = (hhmm: string) => /^\d\d:\d\d$/.test(hhmm) ? Math.min(options.length - 1, Math.round((+hhmm.slice(0, 2) * 60 + +hhmm.slice(3)) / TIME_STEP_MIN)) : 36
  function openList() { setActive(nearest(parseTimeText(draft ?? '') ?? value)); setOpen(true) }
  function commit(text: string) {
    const parsed = parseTimeText(text)
    if (parsed) { onChange(parsed); setDraft(null) } else onChange('')       // leave what was typed on screen; validation explains
  }
  function choose(i: number) { onChange(options[i]); setDraft(null); setOpen(false) }
  function step(delta: number) {
    const cur = parseTimeText(draft ?? '') ?? (value || '09:00')
    const mins = Math.min(Math.max(+cur.slice(0, 2) * 60 + +cur.slice(3) + delta, 0), 24 * 60 - 1)
    onChange(`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`)
    setDraft(null)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef} id={id} type="text" inputMode="text" autoComplete="off" spellCheck={false} value={shown}
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        placeholder={fmt === '24h' ? '14:30' : '2:30 PM'}
        onClick={() => { if (!open) openList() }}
        onChange={e => {
          const t = e.target.value
          setDraft(t)
          const parsed = parseTimeText(t)
          if (open && parsed) setActive(nearest(parsed))
          if (options.some(o => formatTimeValue(o, fmt).toLowerCase() === t.trim().toLowerCase())) commit(t)   // a full listed time was typed
        }}
        onBlur={() => { setOpen(false); if (draft !== null) commit(draft) }}
        onKeyDown={e => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.min(options.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1)))); return }
            if (e.key === 'Enter') { e.preventDefault(); if (draft !== null && parseTimeText(draft)) { commit(draft); setOpen(false) } else choose(active); return }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return }
            return
          }
          if (e.key === 'Enter' && draft !== null) { e.preventDefault(); commit(draft); return }
          if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') { e.preventDefault(); openList(); return }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? TIME_STEP_MIN : -TIME_STEP_MIN) }
        }}
        style={{ ...fieldStyle, paddingRight: 34 }}
      />
      <button type="button" tabIndex={-1} aria-label="Show times" data-testid={`${id}-arrow`}
        onMouseDown={e => e.preventDefault()}
        onClick={() => { inputRef.current?.focus(); if (open) setOpen(false); else openList() }}
        className="absolute top-0 bottom-0 right-0 flex items-center justify-center" style={{ width: 34, color: 'var(--xp-txt3)' }}>
        <ChevronDown />
      </button>
      {open && box && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Times" data-testid="time-list" style={popupStyle(box)}>
          {options.map((o, i) => {
            const sel = o === value
            return (
              <li key={o} id={`${id}-opt-${i}`} role="option" aria-selected={sel} onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}
                style={{ padding: '10px 12px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: sel ? 700 : 500, color: sel ? '#7c3aed' : 'var(--xp-txt)', background: sel ? 'rgba(124,58,237,0.16)' : i === active ? 'var(--xp-bg3)' : 'transparent' }}>
                {formatTimeValue(o, fmt)}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Phones: a compact dropdown (colour dot + name) in place of the row of category pills. Lists every built-in and custom category. */
function CategorySelect({ id, value, onChange }: { id: string; value: ScheduleCategoryId; onChange: (id: ScheduleCategoryId) => void }) {
  const { categories, meta } = useSchedule()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const box = usePopupBox(open, btnRef as React.RefObject<HTMLElement>, 280)
  const cur = meta(value)
  useEffect(() => {
    if (!open || !box) return
    const ul = listRef.current, el = ul?.children[active] as HTMLElement | undefined
    if (ul && el) ul.scrollTop = el.offsetTop - ul.clientHeight / 2 + el.offsetHeight / 2
  }, [open, box, active])
  function openList() { setActive(Math.max(0, categories.findIndex(c => c.id === value))); setOpen(true) }
  function choose(i: number) { onChange(categories[i].id); setOpen(false); btnRef.current?.focus() }
  return (
    <div className="relative">
      <button ref={btnRef} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={`Category: ${cur.label}`} data-testid="category-select"
        onClick={() => (open ? setOpen(false) : openList())}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (!open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList() } return }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.min(categories.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1)))) }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        }}
        className="w-full flex items-center gap-2 text-left" style={{ ...fieldStyle, background: cur.bg, borderColor: cur.edge, color: cur.text, fontWeight: 700 }}>
        <CategoryDot id={value} size={12} />
        <span className="flex-1 min-w-0 truncate">{cur.label}</span>
        <ChevronDown />
      </button>
      {open && box && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label="Categories" data-testid="category-list" style={popupStyle(box)}>
          {categories.map((c, i) => {
            const sel = c.id === value
            return (
              <li key={c.id} role="option" aria-selected={sel} onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}
                className="flex items-center gap-2" style={{ padding: '10px 12px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: sel ? 700 : 500, color: 'var(--xp-txt)', background: sel ? c.bg : i === active ? 'var(--xp-bg3)' : 'transparent' }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 4, background: c.bg, border: `2px solid ${c.edge}`, flexShrink: 0 }} />
                <span className="flex-1 min-w-0 truncate">{c.label}</span>
                {sel && <span aria-hidden="true" style={{ color: '#7c3aed', fontWeight: 800 }}>✓</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface EventFormProps {
  mode: 'add' | 'edit'
  initial: ScheduleFormValues
  onCancel: () => void
  onSubmit: (v: ScheduleFormValues) => void
  /** Returns a "Scheduling Conflict" message when the chosen date/time overlaps another event (the form then refuses to save, keeping every input). */
  getConflict?: (v: ScheduleFormValues) => string | null
  heading?: string
  hint?: string
  /** Keep rendering with open={false} so the phone exit animation can play; the form unmounts (and resets) afterwards. */
  open?: boolean
}

/** Phones: a full-screen panel that slides up and back down. Tablet/desktop: the original centred dialog. */
export function EventForm(props: EventFormProps) {
  const phone = useIsPhone()
  const { mounted, visible } = useSheetPhase(props.open ?? true, phone)
  if (!mounted) return null
  return <EventFormInner {...props} phone={phone} visible={visible} />
}

function EventFormInner({ mode, initial, onCancel, onSubmit, getConflict, heading, hint, phone, visible }: EventFormProps & { phone: boolean; visible: boolean }) {
  const { categories, fmt } = useSchedule()
  const [showEndDate, setShowEndDate] = useState(() => !!initial.endDate && initial.endDate !== initial.date)
  const [v, setV] = useState<ScheduleFormValues>(initial)
  const [errors, setErrors] = useState<ScheduleFormErrors>({})
  const [tried, setTried] = useState(false)
  useLayerEscape(onCancel)
  const conflict = getConflict ? getConflict(v) : null

  function set<K extends keyof ScheduleFormValues>(k: K, val: ScheduleFormValues[K]) {
    // Add / Duplicate: moving the date or start carries the end along (the length stays); Edit leaves the end alone.
    const next = mode === 'add' && (k === 'start' || k === 'date') ? withStartChange(v, { [k]: val } as Partial<Pick<ScheduleFormValues, 'date' | 'start'>>)
      : k === 'date' ? withDateChange(v, val as string)
      : { ...v, [k]: val }
    setV(next)
    if (tried) setErrors(validateScheduleForm(next))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    const errs = validateScheduleForm(v)
    setErrors(errs)
    if (Object.keys(errs).length === 0 && !conflict) onSubmit(v)
  }

  return (
    <SheetFrame phone={phone} visible={visible} variant="full" as="form" onSubmit={submit} label={heading ?? (mode === 'add' ? 'Add event' : 'Edit event')} onClose={onCancel}>
      <div className="contents" onFocusCapture={e => {
        // keep the field being typed in clear of the on-screen keyboard
        const t = e.target as HTMLElement
        if (phone && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) window.setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320)
      }}>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)', paddingTop: phone ? 'max(14px, env(safe-area-inset-top, 0px))' : undefined }}>
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--xp-txt)' }}>{heading ?? (mode === 'add' ? 'Add Event' : 'Edit Event')}</h3>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ ...iconBtn, width: 28, height: 28 }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3" style={{ overscrollBehavior: 'contain' }}>
          {hint && <p className="text-[11.5px] leading-snug" style={{ color: 'var(--xp-txt2)', padding: '8px 10px', borderRadius: 9, background: 'rgba(124,58,237,0.08)', border: '0.5px solid rgba(124,58,237,0.22)' }}>{hint}</p>}
          <Field label="Title *" htmlFor="sch-title" error={errors.title}>
            <input id="sch-title" value={v.title} maxLength={120} onChange={e => set('title', e.target.value)} placeholder="e.g. Study session" style={fieldStyle} autoFocus />
          </Field>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
            <Field label="Date *" htmlFor="sch-date" error={errors.date}>
              <input id="sch-date" type="date" value={v.date} onChange={e => set('date', e.target.value)} style={fieldStyle} />
            </Field>
            <Field label="Start *" htmlFor="sch-start" error={errors.start}>
              <TimeField id="sch-start" value={v.start} fmt={fmt} onChange={t => set('start', t)} />
            </Field>
            <Field label="End *" htmlFor="sch-end" error={errors.end}>
              <TimeField id="sch-end" value={v.end} fmt={fmt} onChange={t => set('end', t)} />
            </Field>
          </div>
          {showEndDate || (v.endDate && v.endDate !== v.date) ? (
            <Field label="End date *" htmlFor="sch-end-date" error={errors.endDate}>
              <input id="sch-end-date" type="date" value={v.endDate || v.date} min={v.date} onChange={e => set('endDate', e.target.value)} style={fieldStyle} />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowEndDate(true)} className="self-start text-[12px] font-semibold" style={{ color: '#7c3aed' }}>
              + Ends on a different day
            </button>
          )}
          <Field label="Category" htmlFor="sch-category">
            {phone ? <CategorySelect id="sch-category" value={v.category} onChange={c => set('category', c)} /> : (
            <div id="sch-category" role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
              {categories.map(c => {
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
            )}
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

        {conflict && (
          <div role="alert" data-testid="schedule-conflict" className="mx-4 mb-1 flex-shrink-0" style={{ padding: '9px 11px', borderRadius: 10, background: 'rgba(220,38,38,0.09)', border: '0.5px solid rgba(220,38,38,0.4)' }}>
            <p className="text-[12px] font-bold" style={{ color: '#dc2626' }}>Scheduling Conflict</p>
            <p className="text-[11.5px] leading-snug mt-0.5" style={{ color: 'var(--xp-txt)' }}>{conflict}</p>
          </div>
        )}
        <div className="flex gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <button type="button" onClick={onCancel} className="flex-1 text-[13px] font-medium" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Cancel</button>
          <button type="submit" aria-disabled={!!conflict} className="flex-1 text-[13px] font-semibold text-white" style={{ padding: '10px 12px', borderRadius: 10, background: '#7c3aed', opacity: conflict ? 0.55 : 1 }}>{mode === 'add' ? 'Add Event' : 'Save Changes'}</button>
        </div>
      </div>
    </SheetFrame>
  )
}


// ── The single combined filter (categories, then Google Calendar / Outlook at the bottom) ──

export function FilterSelect({ value, onChange, className, style }: { value: CombinedFilter; onChange: (v: CombinedFilter) => void; className?: string; style?: React.CSSProperties }) {
  const { categories } = useSchedule()
  return (
    <label className="flex-shrink-0">
      <span className="sr-only">Filter by category or calendar</span>
      <select
        value={value} onChange={e => onChange(e.target.value as CombinedFilter)} aria-label="Filter by category or calendar" className={className}
        style={{ padding: '7px 6px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', fontSize: 16, maxWidth: 170, ...style }}
      >
        {filterOptions(categories).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

