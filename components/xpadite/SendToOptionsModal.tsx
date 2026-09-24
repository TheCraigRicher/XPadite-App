'use client'

// ── "Send to…" — a self-contained wizard modal ───────────────────────────────
// Consolidates every send destination (Task Manager selected/all, AI Coach
// selected/all) behind one entry point, and stays open across actions so the
// user can send to more than one destination in a row — only the explicit
// Close button exits the whole workflow. All Task Manager selection and
// duplicate-resolution UI lives here, INSIDE the modal; the Planner document
// itself is never touched to build this UI (see JournalEditorContent.tsx,
// which only ever hands this component a plain, already-extracted task tree).
//
// Reuses established XPadite patterns rather than inventing new ones:
// useLockBodyScroll (same freeze already used by the burger-menu drawer and
// other modals), and the same mini-calendar shape used by
// TransferSectionModal/TransferTaskModal for date selection.

import { useMemo, useState } from 'react'
import { useLockBodyScroll } from './useLockBodyScroll'
import { dateKey as buildDateKey, isToday, todayKey, MONTHS, DAY_HEADERS } from './utils'
import {
  type PlannerTaskNode,
  filterSelectedTaskTree, filterFreshTaskTree, flattenTaskTreeToTwoLevels,
  countPlannerTaskTree, countSentInTaskTree,
} from './plannerTaskBridge'

type SendContext = 'section' | 'image'
type View = 'main' | 'select' | 'dup'

interface SendToOptionsModalProps {
  isDark: boolean
  context: SendContext
  taskTree: PlannerTaskNode[]
  onClose: () => void
  /** Performs the actual Task Manager write; returns the created task count. */
  onCreateTasks: (nodes: PlannerTaskNode[], destDateKey: string) => number
  onAICoachComingSoon: () => void
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtLongDate(key: string): string {
  const d = parseDateKey(key)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// Same solid-triangle glyphs as the main Planner header's day-nav arrows, for
// visual consistency between the two date-navigation controls.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)

export function SendToOptionsModal({
  isDark, context, taskTree, onClose, onCreateTasks, onAICoachComingSoon,
}: SendToOptionsModalProps) {
  useLockBodyScroll()

  const [view, setView]               = useState<View>('main')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dupInfo, setDupInfo]         = useState<{ nodes: PlannerTaskNode[]; total: number; sentCount: number } | null>(null)
  const [openTip, setOpenTip]         = useState<string | null>(null)

  const [tmDateKey, setTmDateKey]     = useState(() => todayKey())
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [monthCursor, setMonthCursor] = useState(() => { const t = parseDateKey(todayKey()); return new Date(t.getFullYear(), t.getMonth(), 1) })

  const isImage = context === 'image'
  const eligibleCount = countPlannerTaskTree(taskTree)

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function goBack() {
    setDupInfo(null)
    setView('main')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (view === 'main') onClose(); else goBack()
  }

  function proceedToSend(nodes: PlannerTaskNode[]) {
    const total = countPlannerTaskTree(nodes)
    if (total === 0) return
    const sentCount = countSentInTaskTree(nodes)
    if (sentCount > 0) { setDupInfo({ nodes, total, sentCount }); setView('dup') }
    else finalizeSend(nodes)
  }

  function finalizeSend(nodes: PlannerTaskNode[]) {
    onCreateTasks(nodes, tmDateKey)
    setDupInfo(null)
    setSelectedIds(new Set())
    setView('main') // stays open — the user may send to another destination
  }

  function confirmSendSelected() {
    if (selectedIds.size === 0) return
    const filtered = filterSelectedTaskTree(taskTree, selectedIds)
    proceedToSend(flattenTaskTreeToTwoLevels(filtered))
  }

  function sendAll() {
    proceedToSend(flattenTaskTreeToTwoLevels(taskTree))
  }

  function resolveDup(sendAllAgain: boolean) {
    if (!dupInfo) return
    const nodes = sendAllAgain ? dupInfo.nodes : filterFreshTaskTree(dupInfo.nodes)
    if (countPlannerTaskTree(nodes) === 0) { setDupInfo(null); setView('main'); return }
    finalizeSend(nodes)
  }

  const weeks = useMemo(() => {
    const year = monthCursor.getFullYear(), month = monthCursor.getMonth()
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

  function renderTaskList(nodes: PlannerTaskNode[], depth: number): React.ReactNode[] {
    return nodes.flatMap(n => [
      <label key={n.id} style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px',
        paddingLeft: depth * 18, fontSize: 12.5, cursor: 'pointer',
        color: isDark ? '#e2e8f0' : '#1e293b',
      }}>
        <input type="checkbox" checked={selectedIds.has(n.id)} onChange={() => toggleSelected(n.id)} style={{ accentColor: '#7c3aed', width: 14, height: 14, flexShrink: 0 }} />
        <span style={{ textDecoration: n.checked ? 'line-through' : 'none', opacity: n.checked ? 0.55 : 1 }}>
          {n.text || '(untitled)'}
        </span>
        {n.sentTaskId && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
            background: isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)',
            color: isDark ? '#c4b5fd' : '#7c3aed',
          }}>Sent</span>
        )}
      </label>,
      ...renderTaskList(n.children, depth + 1),
    ])
  }

  // ── Main-screen option definitions ──────────────────────────────────────────
  // Always the same four options, for consistency — image/Mind Map context just
  // disables the three that don't apply to a single image (no Task Manager
  // tasks, no partial "selection" of one image) rather than swapping in a
  // different modal shape.
  type Option = { id: string; icon: string; label: string; tooltip: string; premium?: boolean; disabled?: boolean; onSelect: () => void }
  const options: Option[] = [
    {
      id: 'tm-selected', icon: '✅', label: 'Send Selected to Task Manager', disabled: isImage || eligibleCount === 0,
      tooltip: 'Choose specific tasks from this section and send them to Task Manager for scheduling, tracking and completion.',
      onSelect: () => { setSelectedIds(new Set()); setView('select') },
    },
    {
      id: 'tm-all', icon: '✅', label: 'Send All to Task Manager', disabled: isImage || eligibleCount === 0,
      tooltip: 'Send all eligible tasks from this section to Task Manager at once.',
      onSelect: sendAll,
    },
    {
      id: 'ai-selected', icon: '🧠', label: 'Send Selected to AI Coach', premium: true, disabled: isImage,
      tooltip: 'Choose specific content from this section to send to XPadite AI Coach for personalized assistance.',
      onSelect: onAICoachComingSoon,
    },
    {
      id: 'ai-all', icon: '🧠', label: 'Send All to AI Coach', premium: true,
      tooltip: isImage
        ? 'Send this image or Mind Map to XPadite AI Coach for analysis and personalized assistance.'
        : 'Send the complete eligible section content to XPadite AI Coach for personalized assistance.',
      onSelect: onAICoachComingSoon,
    },
  ]

  const headerTitle =
    view === 'select' ? 'Select Tasks' :
    view === 'dup'    ? (dupInfo && dupInfo.sentCount === dupInfo.total ? 'Already Sent' : 'Some Already Sent') :
    'Send to…'
  const headerSubtitle =
    view === 'select' ? 'Choose which tasks to send to Task Manager.' :
    view === 'dup'    ? undefined :
    (isImage ? 'Choose a destination for this image.' : 'Choose a destination for this section.')

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .xp-sendto-btn { transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
        }
        @media (prefers-reduced-motion: reduce) {
          .xp-sendto-btn { transition: background 80ms linear; }
        }
        .xp-sendto-btn:not(:disabled):hover {
          border-color: rgba(124,58,237,0.45) !important;
          background: ${isDark ? 'rgba(124,58,237,0.14)' : 'rgba(124,58,237,0.07)'} !important;
          transform: translateY(-1px);
        }
        .xp-sendto-btn:not(:disabled):active {
          background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
          border-color: rgba(124,58,237,0.65) !important;
          transform: translateY(0) scale(0.98);
          box-shadow: 0 4px 14px rgba(124,58,237,0.35) !important;
        }
        .xp-sendto-btn:not(:disabled):active .xp-sendto-label,
        .xp-sendto-btn:not(:disabled):active .xp-sendto-icon { color: #ffffff !important; }
        .xp-sendto-btn:not(:disabled):active .xp-sendto-badge {
          background: rgba(255,255,255,0.22) !important; color: #ffffff !important;
        }
        .xp-sendto-btn:disabled { cursor: default; opacity: 0.45; }
        /* vh alone measures the tallest possible viewport (address bar hidden) —
           on mobile, with the address bar showing, that overshoots the actually
           visible area and the card can run off-screen. dvh tracks the real,
           current viewport instead; used as a progressive enhancement since vh
           is still the correct/only option on browsers without dvh support. */
        .xp-sendto-card { max-height: 88vh; }
        @supports (height: 88dvh) {
          .xp-sendto-card { max-height: 88dvh; }
        }
      `}</style>

      <div
        className="xp-sendto-card w-full max-w-[380px] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 px-4 py-3.5 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}
        >
          <div className="min-w-0 flex items-start gap-2">
            {view !== 'main' && (
              <button
                onClick={goBack}
                aria-label="Back"
                className="flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
                style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 13, marginTop: 1, border: 'none', cursor: 'pointer' }}
              >
                ‹
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold" style={{ color: '#ffffff' }}>{headerTitle}</h3>
              {headerSubtitle && <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>{headerSubtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Send to workflow"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-75"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Body — internal scroll only; the page behind stays frozen via useLockBodyScroll */}
        <div className="px-3.5 py-3.5 overflow-y-auto" style={{ minHeight: 0 }}>

          {view === 'main' && (
            <>
              <div className="flex flex-col gap-2">
                {options.map(opt => (
                  <div key={opt.id}>
                    <button
                      onClick={opt.onSelect}
                      disabled={opt.disabled}
                      className="xp-sendto-btn w-full flex items-center gap-2.5 rounded-xl text-left"
                      style={{ padding: '10px 10px 10px 11px', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}
                    >
                      <span className="xp-sendto-icon" style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{opt.icon}</span>
                      <span className="xp-sendto-label flex-1 min-w-0 text-[12.5px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{opt.label}</span>
                      {opt.premium && (
                        <span className="xp-sendto-badge" style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.02em', padding: '2px 6px', borderRadius: 8, flexShrink: 0,
                          background: isDark ? 'rgba(167,139,250,0.20)' : 'rgba(124,58,237,0.12)',
                          color: isDark ? '#c4b5fd' : '#7c3aed',
                        }}>
                          V2
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); setOpenTip(t => t === opt.id ? null : opt.id) }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setOpenTip(t => t === opt.id ? null : opt.id) } }}
                        aria-label={`About "${opt.label}"`}
                        aria-expanded={openTip === opt.id}
                        title={opt.tooltip}
                        className="flex items-center justify-center flex-shrink-0"
                        style={{
                          width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
                          background: openTip === opt.id ? (isDark ? 'rgba(167,139,250,0.24)' : 'rgba(124,58,237,0.14)') : 'transparent',
                          color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.36)',
                          fontSize: 10.5, fontWeight: 700, lineHeight: 1,
                        }}
                      >
                        ⓘ
                      </span>
                    </button>
                    {openTip === opt.id && (
                      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--xp-txt3)', padding: '6px 4px 2px 12px' }}>
                        {opt.tooltip}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {!isImage && eligibleCount === 0 && (
                <p className="text-[11px] mt-2.5" style={{ color: 'var(--xp-txt3)' }}>
                  No checklist items in this section yet.
                </p>
              )}

              {/* Task Manager destination date — applies only to the two TM actions above */}
              {!isImage && eligibleCount > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: `0.5px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
                  <button
                    onClick={() => setCalendarOpen(o => !o)}
                    className="w-full flex items-center justify-between rounded-xl transition-opacity hover:opacity-85"
                    style={{ padding: '8px 10px', background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)', cursor: 'pointer' }}
                  >
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt3)' }}>
                      Task Manager Date
                    </span>
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--xp-txt)' }}>
                      {tmDateKey === todayKey() ? 'Today' : fmtLongDate(tmDateKey)}
                      <span style={{ fontSize: 9, transform: calendarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms', color: 'var(--xp-txt3)' }}>▾</span>
                    </span>
                  </button>

                  {calendarOpen && (
                    <div className="mt-2">
                      <div className="flex items-center justify-center gap-2.5 mb-2">
                        <button
                          onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                          aria-label="Previous month"
                          className="flex items-center justify-center flex-shrink-0"
                          style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: 'none', cursor: 'pointer' }}
                        >
                          <PrevTriangle />
                        </button>
                        <span className="text-[11.5px] font-semibold" style={{ color: 'var(--xp-txt)', minWidth: 110, textAlign: 'center' }}>
                          {MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
                        </span>
                        <button
                          onClick={() => setMonthCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                          aria-label="Next month"
                          className="flex items-center justify-center flex-shrink-0"
                          style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: 'none', cursor: 'pointer' }}
                        >
                          <NextTriangle />
                        </button>
                      </div>
                      <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {DAY_HEADERS.map(d => (
                          <div key={d} className="text-center text-[9px] font-semibold py-0.5" style={{ color: 'var(--xp-txt3)' }}>{d}</div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {weeks.map((row, ri) => (
                          <div key={ri} className="grid grid-cols-7 gap-0.5">
                            {row.map((d, ci) => {
                              if (!d) return <div key={ci} />
                              const key = buildDateKey(d.getFullYear(), d.getMonth(), d.getDate())
                              const selected = key === tmDateKey
                              const isTodayCell = isToday(d.getFullYear(), d.getMonth(), d.getDate())
                              return (
                                <button
                                  key={ci}
                                  onClick={() => setTmDateKey(key)}
                                  className="aspect-square flex items-center justify-center text-[10.5px]"
                                  style={{
                                    borderRadius: 7, border: !selected && isTodayCell ? '1.5px solid #7c3aed' : '1.5px solid transparent', cursor: 'pointer',
                                    fontWeight: selected ? 700 : isTodayCell ? 600 : 500,
                                    background: selected ? '#7c3aed' : 'transparent',
                                    color: selected ? '#ffffff' : isTodayCell ? '#7c3aed' : 'var(--xp-txt)',
                                  }}
                                >
                                  {d.getDate()}
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {view === 'select' && (
            <>
              <div className="flex flex-col mb-3" style={{ maxHeight: '46vh', overflowY: 'auto' }}>
                {renderTaskList(taskTree, 0)}
              </div>
              <button
                onClick={confirmSendSelected}
                disabled={selectedIds.size === 0}
                className="w-full text-[12.5px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ padding: '10px 0', borderRadius: 10, border: 'none', cursor: selectedIds.size === 0 ? 'default' : 'pointer', color: '#fff', background: '#7c3aed' }}
              >
                Send to Task Manager{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
            </>
          )}

          {view === 'dup' && dupInfo && (
            <>
              <p className="text-[11.5px] leading-relaxed mb-3.5" style={{ color: 'var(--xp-txt3)' }}>
                {dupInfo.sentCount === dupInfo.total
                  ? (dupInfo.total === 1
                      ? 'This task was previously sent to Task Manager.'
                      : `All ${dupInfo.total} selected tasks were previously sent to Task Manager.`)
                  : `${dupInfo.sentCount} of ${dupInfo.total} selected tasks were already sent to Task Manager.`}
              </p>
              <div className="flex flex-col gap-2">
                {dupInfo.sentCount < dupInfo.total && (
                  <button
                    onClick={() => resolveDup(false)}
                    className="text-[12.5px] font-semibold transition-opacity hover:opacity-90"
                    style={{ padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer', color: '#fff', background: '#7c3aed' }}
                  >
                    Send New Items Only ({dupInfo.total - dupInfo.sentCount})
                  </button>
                )}
                <button
                  onClick={() => resolveDup(true)}
                  className="text-[12.5px] font-semibold transition-opacity hover:opacity-90"
                  style={{
                    padding: '9px 0', borderRadius: 10, cursor: 'pointer',
                    border: dupInfo.sentCount < dupInfo.total ? '0.5px solid var(--xp-bdr2)' : 'none',
                    color: dupInfo.sentCount < dupInfo.total ? 'var(--xp-txt)' : '#fff',
                    background: dupInfo.sentCount < dupInfo.total ? 'var(--xp-bg3)' : '#7c3aed',
                  }}
                >
                  Send Another Copy of All ({dupInfo.total})
                </button>
                <button
                  onClick={goBack}
                  className="text-[12.5px] font-semibold transition-opacity hover:opacity-80"
                  style={{ padding: '9px 0', borderRadius: 10, background: 'var(--xp-bg3)', color: 'var(--xp-txt)', border: '0.5px solid var(--xp-bdr2)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
