'use client'

// ── My Schedule — Manage Categories + Schedule Preferences dialogs ──────────
// Both sit inside the My Schedule modal (same layer pattern as the Add/Edit form). Everything they change is held in memory
// for this preview and is labelled as not saved. The rules (naming, colours, protected built-ins, replacement on delete)
// are in scheduleEngine.ts; these components only collect input and show the result.

import { useState } from 'react'
import { DURATION_CHOICES } from './scheduleLogic'
import type { ScheduleCategory, ScheduleEvent, SchedulePrefs } from './scheduleLogic'
import { CATEGORY_NAME_MAX, CATEGORY_SWATCHES, categoryUsage, isHexColor } from './scheduleEngine'
import { LAYER_ATTR, iconBtn, useLayerEscape } from './ScheduleParts'

const field: React.CSSProperties = {
  width: '100%', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 10,
  padding: '9px 11px', color: 'var(--xp-txt)', outline: 'none', fontSize: 16,
}

function CloseX() {
  return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
}

function Shell({ title, onClose, children, footer, label }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; label?: string }) {
  return (
    <div {...{ [LAYER_ATTR]: '' }} className="absolute inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label ?? title} className="xp-sch-sheet w-full sm:max-w-[480px] flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 18, maxHeight: '94%', boxShadow: '0 24px 60px rgba(0,0,0,0.38)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--xp-txt)' }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...iconBtn, width: 28, height: 28 }}><CloseX /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3" style={{ overscrollBehavior: 'contain' }}>{children}</div>
        {footer && <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>{footer}</div>}
      </div>
    </div>
  )
}

function Swatch({ hex, on, taken, onPick }: { hex: string; on: boolean; taken: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={`Colour ${hex}${taken ? ' (already used)' : ''}`} disabled={taken && !on} onClick={onPick}
      style={{ width: 26, height: 26, borderRadius: '50%', background: hex, border: on ? '3px solid var(--xp-txt)' : '2px solid transparent', boxShadow: on ? '0 0 0 1.5px var(--xp-card) inset' : 'none', opacity: taken && !on ? 0.28 : 1, cursor: taken && !on ? 'not-allowed' : 'pointer' }} />
  )
}

function ColorPicker({ value, onChange, categories, selfId }: { value: string; onChange: (hex: string) => void; categories: ScheduleCategory[]; selfId?: string }) {
  const used = new Set(categories.filter(c => c.id !== selfId).map(c => c.edge.toLowerCase()))
  return (
    <div role="radiogroup" aria-label="Category colour" className="flex flex-wrap items-center gap-1.5">
      {CATEGORY_SWATCHES.map(hex => <Swatch key={hex} hex={hex} on={value.toLowerCase() === hex} taken={used.has(hex)} onPick={() => onChange(hex)} />)}
      <label className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--xp-txt3)' }}>
        <input type="color" value={isHexColor(value) ? value : '#7c3aed'} onChange={e => onChange(e.target.value)} aria-label="Custom colour" style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'transparent' }} />
        Custom
      </label>
    </div>
  )
}

// ── Manage Categories ───────────────────────────────────────────────────────

export interface ManageCategoriesProps {
  categories: ScheduleCategory[]
  events: ScheduleEvent[]
  /** Each returns an error message, or null on success. */
  onAdd: (name: string, hex: string) => string | null
  onRename: (id: string, name: string) => string | null
  onRecolor: (id: string, hex: string) => string | null
  onDelete: (id: string, replacementId?: string) => string | null
  onClose: () => void
}

export function ManageCategoriesDialog({ categories, events, onAdd, onRename, onRecolor, onDelete, onClose }: ManageCategoriesProps) {
  const firstFree = CATEGORY_SWATCHES.find(h => !categories.some(c => c.edge.toLowerCase() === h)) ?? CATEGORY_SWATCHES[0]
  const [name, setName] = useState('')
  const [color, setColor] = useState(firstFree)
  const [addError, setAddError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [colorId, setColorId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null)
  const [deleting, setDeleting] = useState<ScheduleCategory | null>(null)
  const [replacement, setReplacement] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useLayerEscape(() => { if (deleting) setDeleting(null); else if (editId) setEditId(null); else onClose() })

  const custom = categories.filter(c => !c.builtIn)
  const builtIn = categories.filter(c => c.builtIn)

  function add(e: React.FormEvent) {
    e.preventDefault()
    const err = onAdd(name, color)
    setAddError(err)
    if (!err) {
      setName('')
      // pick the next unused colour for the following category
      const nextFree = CATEGORY_SWATCHES.find(h => h !== color.toLowerCase() && !categories.some(c => c.edge.toLowerCase() === h))
      setColor(nextFree ?? color)
    }
  }

  function saveRename(id: string) {
    const err = onRename(id, editName)
    setRowError(err ? { id, msg: err } : null)
    if (!err) setEditId(null)
  }

  function recolor(id: string, hex: string) {
    const err = onRecolor(id, hex)
    setRowError(err ? { id, msg: err } : null)
  }

  function startDelete(c: ScheduleCategory) {
    setDeleting(c); setDeleteError(null)
    setReplacement(categories.find(x => x.id !== c.id && x.id === 'other')?.id ?? categories.find(x => x.id !== c.id)?.id ?? '')
  }

  function confirmDelete() {
    if (!deleting) return
    const used = categoryUsage(events, deleting.id)
    const err = onDelete(deleting.id, used > 0 ? replacement : undefined)
    if (err) setDeleteError(err); else setDeleting(null)
  }

  const usedCount = deleting ? categoryUsage(events, deleting.id) : 0

  return (
    <Shell title="Manage Categories" onClose={onClose}
      footer={<div className="flex items-center justify-between gap-3"><p className="text-[11px] leading-snug" style={{ color: 'var(--xp-txt3)' }}>Preview — custom categories last only while My Schedule is open; they aren’t saved yet.</p><button type="button" onClick={onClose} className="text-[13px] font-semibold text-white flex-shrink-0" style={{ padding: '9px 16px', borderRadius: 10, background: '#7c3aed' }}>Done</button></div>}>
      <form onSubmit={add} className="flex flex-col gap-2" aria-label="Add a category" style={{ padding: 10, borderRadius: 12, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <label htmlFor="sch-cat-name" className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>New category</label>
        <div className="flex gap-2">
          <input id="sch-cat-name" value={name} maxLength={CATEGORY_NAME_MAX + 10} onChange={e => { setName(e.target.value); setAddError(null) }} placeholder="e.g. Gym, Clients, Club" style={{ ...field, background: 'var(--xp-card)' }} />
          <button type="submit" className="text-[13px] font-semibold text-white flex-shrink-0" style={{ padding: '0 14px', borderRadius: 10, background: '#7c3aed' }}>Add</button>
        </div>
        <ColorPicker value={color} onChange={c => { setColor(c); setAddError(null) }} categories={categories} />
        {addError && <p role="alert" className="text-[11.5px]" style={{ color: '#dc2626' }}>{addError}</p>}
      </form>

      <section aria-label="Your categories">
        <h4 className="text-[11px] font-bold uppercase mb-1.5" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Your categories ({custom.length})</h4>
        {custom.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--xp-txt3)' }}>No custom categories yet — add one above.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {custom.map(c => (
              <li key={c.id} data-testid="custom-category" style={{ padding: '7px 9px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setColorId(colorId === c.id ? null : c.id)} aria-label={`Change colour of ${c.label}`} aria-expanded={colorId === c.id}
                    style={{ width: 22, height: 22, borderRadius: 6, background: c.bg, border: `2px solid ${c.edge}`, flexShrink: 0 }} />
                  {editId === c.id ? (
                    <form className="flex flex-1 min-w-0 gap-1.5" onSubmit={e => { e.preventDefault(); saveRename(c.id) }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} aria-label={`Rename ${c.label}`} autoFocus style={{ ...field, padding: '5px 8px', background: 'var(--xp-card)' }} />
                      <button type="submit" className="text-[12px] font-semibold" style={{ color: '#7c3aed' }}>Save</button>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate text-[13px] font-medium" style={{ color: 'var(--xp-txt)' }}>{c.label}</span>
                      <span className="text-[10.5px] flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>{categoryUsage(events, c.id)} event{categoryUsage(events, c.id) === 1 ? '' : 's'}</span>
                      <button type="button" onClick={() => { setEditId(c.id); setEditName(c.label); setRowError(null) }} aria-label={`Rename ${c.label}`} title="Rename" style={{ ...iconBtn, width: 26, height: 26, color: '#7c3aed' }}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" /></svg>
                      </button>
                      <button type="button" onClick={() => startDelete(c)} aria-label={`Delete ${c.label}`} title="Delete" style={{ ...iconBtn, width: 26, height: 26, color: '#dc2626' }}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </>
                  )}
                </div>
                {colorId === c.id && <div className="mt-2"><ColorPicker value={c.edge} onChange={hex => recolor(c.id, hex)} categories={categories} selfId={c.id} /></div>}
                {rowError?.id === c.id && <p role="alert" className="text-[11.5px] mt-1" style={{ color: '#dc2626' }}>{rowError.msg}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Built-in categories">
        <h4 className="text-[11px] font-bold uppercase mb-1.5" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Built-in (protected)</h4>
        <ul className="flex flex-col gap-1">
          {builtIn.map(c => (
            <li key={c.id} className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--xp-txt2)', padding: '3px 4px' }}>
              <span aria-hidden="true" style={{ width: 20, height: 12, borderRadius: 6, background: c.bg, border: `1px solid ${c.edge}` }} />
              <span className="flex-1">{c.label}</span>
              <span aria-label="Protected" title="Built-in categories can’t be changed or deleted" style={{ fontSize: 11 }}>🔒</span>
            </li>
          ))}
        </ul>
      </section>

      {deleting && (
        <div {...{ [LAYER_ATTR]: '' }} className="absolute inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setDeleting(null)}>
          <div role="alertdialog" aria-modal="true" aria-label="Delete category" className="w-full max-w-[340px]" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 16, padding: '18px 16px', boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--xp-txt)' }}>Delete “{deleting.label}”?</p>
            {usedCount > 0 ? (
              <>
                <p className="text-[12.5px] mb-2" style={{ color: 'var(--xp-txt2)' }}>{usedCount} event{usedCount === 1 ? ' uses' : 's use'} this category. Choose the category they should move to.</p>
                <label htmlFor="sch-cat-repl" className="sr-only">Replacement category</label>
                <select id="sch-cat-repl" value={replacement} onChange={e => { setReplacement(e.target.value); setDeleteError(null) }} style={field}>
                  {categories.filter(c => c.id !== deleting.id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </>
            ) : (
              <p className="text-[12.5px] mb-2" style={{ color: 'var(--xp-txt2)' }}>No events use this category. It will be removed from this preview.</p>
            )}
            {deleteError && <p role="alert" className="text-[11.5px] mt-1" style={{ color: '#dc2626' }}>{deleteError}</p>}
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => setDeleting(null)} className="flex-1 text-[13px] font-medium" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Cancel</button>
              <button type="button" onClick={confirmDelete} className="flex-1 text-[13px] font-semibold text-white" style={{ padding: '10px 12px', borderRadius: 10, background: '#dc2626' }}>{usedCount > 0 ? 'Move & delete' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

// ── Schedule Preferences ────────────────────────────────────────────────────

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)', width: 'fit-content' }}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className="text-[12.5px] whitespace-nowrap" style={{ padding: '6px 13px', borderRadius: 7, fontWeight: value === o.value ? 700 : 500, background: value === o.value ? '#7c3aed' : 'transparent', color: value === o.value ? '#fff' : 'var(--xp-txt2)' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PreferencesDialog({ prefs, onChange, onClose }: { prefs: SchedulePrefs; onChange: (patch: Partial<SchedulePrefs>) => void; onClose: () => void }) {
  useLayerEscape(onClose)
  return (
    <Shell title="Schedule Preferences" onClose={onClose}
      footer={<div className="flex items-center justify-between gap-3"><p className="text-[11px] leading-snug" style={{ color: 'var(--xp-txt3)' }}>Preview — these apply right away but only while My Schedule is open; they aren’t saved yet.</p><button type="button" onClick={onClose} className="text-[13px] font-semibold text-white flex-shrink-0" style={{ padding: '9px 16px', borderRadius: 10, background: '#7c3aed' }}>Done</button></div>}>
      <div className="flex flex-col gap-1">
        <label htmlFor="sch-pref-dur" className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>Default event duration</label>
        <select id="sch-pref-dur" value={prefs.defaultDurationMins} onChange={e => onChange({ defaultDurationMins: Number(e.target.value) })} style={field}>
          {DURATION_CHOICES.map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)} hr ${m % 60} min`}</option>)}
        </select>
        <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>Used when you add an event, including from an empty time slot.</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>Week starts on</span>
        <Segmented label="Week starts on" value={prefs.weekStart} options={[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }]} onChange={weekStart => onChange({ weekStart })} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt2)' }}>Time format</span>
        <Segmented label="Time format" value={prefs.timeFormat} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} onChange={timeFormat => onChange({ timeFormat })} />
        <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>Applies to the calendar, agenda and event details. Time pickers in forms follow your device’s own setting.</p>
      </div>
    </Shell>
  )
}
