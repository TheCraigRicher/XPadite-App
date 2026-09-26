'use client'

// ── Transfer Section (Move / Copy to another date) ──────────────────────────
//
// Visual/interaction design deliberately mirrors TransferTaskModal.tsx (the
// established Task Manager Transfer modal) as closely as possible — same
// header gradient, mode-selector cards, mini month calendar, and action row.
// Sections have no logged-history/active-timer concept the way tasks do, so
// the completed-task move restriction and its explanatory dialog don't apply
// here: both Move and Copy are always available except when the destination
// date is the same as the origin (same disabled-confirm rule Task Manager
// already uses for that case).
//
// This component only handles the UI (mode + destination-date selection); the
// actual block move/copy — which needs JournalEditorContent's live block
// state (blocksRef/contentMapRef) — happens in the onConfirm callback.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { dateKey as buildDateKey, isToday, MONTHS, DAY_HEADERS } from './utils'

type TransferMode = 'move' | 'copy'

interface TransferSectionModalProps {
  dateKey: string
  sectionLabel: string
  onClose: () => void
  onConfirm: (mode: TransferMode, destDateKey: string) => void
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtShort(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function TransferSectionModal({ dateKey, sectionLabel, onClose, onConfirm }: TransferSectionModalProps) {
  const { effectiveTimezone } = useApp()
  const originDate = useMemo(() => parseDateKey(dateKey), [dateKey])
  const [monthCursor, setMonthCursor] = useState(() => new Date(originDate.getFullYear(), originDate.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [mode, setMode] = useState<TransferMode>('move')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedKey = selectedDate ? buildDateKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : null
  const isSameAsOrigin = selectedKey === dateKey
  const canConfirm = !!selectedDate && !isSameAsOrigin

  // ── Mini month calendar ────────────────────────────────────────────────────
  const weeks = useMemo(() => {
    const year = monthCursor.getFullYear()
    const month = monthCursor.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDow = new Date(year, month, 1).getDay()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: (Date | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [monthCursor])

  function handleConfirm() {
    if (!canConfirm || !selectedKey) return
    onConfirm(mode, selectedKey)
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { e.stopPropagation(); onClose() }}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl overflow-hidden"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}
        >
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold" style={{ color: '#ffffff' }}>Transfer Section</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>Move or copy this section to another date.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff' }}
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3.5">
          {/* Section name */}
          <p
            className="text-[12.5px] font-medium mb-3 truncate"
            style={{ color: 'var(--xp-txt)', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', borderRadius: 9, padding: '7px 10px' }}
            title={sectionLabel}
          >
            {sectionLabel || '(untitled section)'}
          </p>

          {/* Mode selector — purple = selected, white = available */}
          <div className="flex flex-col gap-2 mb-3.5">
            <button
              onClick={() => setMode('copy')}
              className="text-left transition-colors duration-150"
              style={{
                borderRadius: 10, padding: '9px 11px',
                border: `1.5px solid ${mode === 'copy' ? '#7c3aed' : 'var(--xp-bdr2)'}`,
                background: mode === 'copy' ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'var(--xp-card)',
              }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: mode === 'copy' ? '#ffffff' : 'var(--xp-txt)' }}>📋 Copy to Date</span>
              <p className="text-[10.5px] mt-0.5" style={{ color: mode === 'copy' ? 'rgba(255,255,255,0.80)' : 'var(--xp-txt3)' }}>
                Creates a copy on another date. The original section stays here.
              </p>
            </button>

            <button
              onClick={() => setMode('move')}
              className="text-left transition-colors duration-150"
              style={{
                borderRadius: 10, padding: '9px 11px',
                border: `1.5px solid ${mode === 'move' ? '#7c3aed' : 'var(--xp-bdr2)'}`,
                background: mode === 'move' ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'var(--xp-card)',
              }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: mode === 'move' ? '#ffffff' : 'var(--xp-txt)' }}>➡️ Move to Date</span>
              <p className="text-[10.5px] mt-0.5" style={{ color: mode === 'move' ? 'rgba(255,255,255,0.80)' : 'var(--xp-txt3)' }}>
                Moves this section to another date. The original section is removed from this day&apos;s Planner.
              </p>
            </button>
          </div>

          {/* Mini month calendar */}
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >
              ‹
            </button>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--xp-txt)', minWidth: 120, textAlign: 'center' }}>
              {MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
            </span>
            <button
              onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              aria-label="Next month"
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)' }}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-[9.5px] font-semibold py-1" style={{ color: 'var(--xp-txt3)' }}>{d}</div>
            ))}
          </div>
          <div className="flex flex-col gap-0.5 mb-3.5">
            {weeks.map((row, ri) => (
              <div key={ri} className="grid grid-cols-7 gap-0.5">
                {row.map((d, ci) => {
                  if (!d) return <div key={ci} />
                  const key = buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())
                  const selected = key === selectedKey
                  const today = isToday(d.getFullYear(), d.getMonth(), d.getDate(), effectiveTimezone)
                  const isOriginDate = key === dateKey
                  return (
                    <button
                      key={ci}
                      onClick={() => setSelectedDate(d)}
                      className="aspect-square flex items-center justify-center text-[11px] relative"
                      style={{
                        borderRadius: 8,
                        fontWeight: selected ? 700 : today ? 600 : 500,
                        background: selected ? '#7c3aed' : 'transparent',
                        color: selected ? '#ffffff' : today ? '#7c3aed' : 'var(--xp-txt)',
                        border: !selected && today ? '1.5px solid #7c3aed' : '1.5px solid transparent',
                      }}
                      title={isOriginDate ? "Section's current date" : undefined}
                    >
                      {d.getDate()}
                      {isOriginDate && !selected && (
                        <span style={{ position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: '50%', background: '#7c3aed' }} />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {isSameAsOrigin && (
            <p className="text-[11px] mb-3" style={{ color: 'var(--xp-txt3)' }}>
              This is already the section&apos;s current date — pick another date to transfer it.
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="flex-1 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
              style={{ padding: '9px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex-1 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
              style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed' }}
            >
              {selectedDate ? `${mode === 'copy' ? 'Copy' : 'Move'} to ${fmtShort(selectedDate)}` : (mode === 'copy' ? 'Copy' : 'Move')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
