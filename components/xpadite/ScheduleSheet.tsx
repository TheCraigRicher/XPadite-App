'use client'

// ── My Schedule — shared sheet / popup foundation ───────────────────────────
// One implementation of the phone presentation for every My Schedule overlay (Filter, Manage Categories, Schedule Preferences,
// Add/Edit Event): a bottom sheet (rounded top, dimmed backdrop, swipe-down) or a full-screen panel, both sliding up from the
// bottom and back down on close. Tablets and desktops (≥ 640px) keep their existing centred dialogs — SheetFrame renders those
// unchanged when `phone` is false. Also the positioning helper used by the time and category dropdowns.
// Frontend only; nothing here stores anything.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Marker so the modal's Escape handler lets an open My Schedule layer close first. */
export const LAYER_ATTR = 'data-xp-sched-layer'

/** The phone breakpoint: below Tailwind's `sm` (640px). Tablets in portrait (≥ 640px) are NOT phones. */
export const PHONE_QUERY = '(max-width: 639px)'

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false)
}

/** Desktop: 1024px and up (the only size where My Schedule can be maximised). */
export const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => false)
}

export const SHEET_MS = 280

/**
 * Presence for an overlay that animates in and out. `mounted` keeps it in the tree until the exit animation has finished;
 * `visible` flips one frame after mounting (so the slide-in transitions from its off-screen start) and back on close.
 * Without `animate` (tablet/desktop) both simply follow `open`, exactly as before.
 */
export function useSheetPhase(open: boolean, animate: boolean) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  if (open && !mounted) setMounted(true)
  if (!open && visible) setVisible(false)
  useEffect(() => {
    if (open) {
      let b = 0
      const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setVisible(true)) })
      return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
    }
    const t = window.setTimeout(() => setMounted(false), animate ? SHEET_MS + 40 : 0)
    return () => window.clearTimeout(t)
  }, [open, animate])
  return animate ? { mounted, visible } : { mounted: open, visible: open }
}

/**
 * The overlay + panel. Phones: `variant="sheet"` (bottom sheet with a grab handle; drag it down, tap the backdrop or Close to
 * dismiss) or `variant="full"` (full-screen). Everything else: the original centred dialog. `as="form"` makes the panel a <form>.
 */
export function SheetFrame({ phone, visible, variant, label, onClose, children, as = 'div', onSubmit, desktopClass = 'sm:max-w-[480px]', zClass = 'z-40', backdropDismiss = true }: {
  phone: boolean
  visible: boolean
  variant: 'sheet' | 'full'
  label: string
  onClose: () => void
  children: React.ReactNode
  as?: 'div' | 'form'
  onSubmit?: (e: React.FormEvent) => void
  /** Desktop/tablet panel width class (default 480px). */
  desktopClass?: string
  zClass?: string
  /**
   * v1.331: false = a click/tap on the dimmed backdrop does NOT close the dialog (Add/Edit Event, Manage Categories, Preferences, Sync: a stray tap, or a
   * text-selection drag that ends outside the panel, used to discard what the user was typing). Explicit Close / Cancel / Save, Esc and the sheet's
   * swipe-down handle still work. Default true keeps every other overlay exactly as before.
   */
  backdropDismiss?: boolean
}) {
  const [dragY, setDragY] = useState<number | null>(null)
  const startY = useRef<number | null>(null)
  const Tag = as as unknown as React.ElementType
  const common = { role: 'dialog', 'aria-modal': true, 'aria-label': label, onClick: (e: React.MouseEvent) => e.stopPropagation() } as const
  const formProps = as === 'form' ? { onSubmit, noValidate: true } : {}

  if (!phone) {
    // Tablet / desktop: unchanged centred dialog.
    return (
      <div {...{ [LAYER_ATTR]: '' }} className={`absolute inset-0 ${zClass} flex items-end sm:items-center justify-center sm:p-4`} style={{ background: 'rgba(0,0,0,0.5)' }} onClick={backdropDismiss ? onClose : undefined}>
        <Tag {...common} {...formProps} className={`xp-sch-sheet w-full ${desktopClass} flex flex-col`}
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 18, maxHeight: '94%', boxShadow: '0 24px 60px rgba(0,0,0,0.38)' }}>
          {children}
        </Tag>
      </div>
    )
  }

  const full = variant === 'full'
  const dragging = dragY !== null
  return (
    <div {...(visible ? { [LAYER_ATTR]: '' } : {})} className={`absolute inset-0 ${zClass} flex items-end`} style={{ pointerEvents: visible ? 'auto' : 'none' }}>
      <div aria-hidden="true" onClick={backdropDismiss ? onClose : undefined} data-testid="sheet-backdrop" data-dismiss={backdropDismiss ? 'true' : 'false'} className="absolute inset-0 xp-sheet-fade"
        style={{ background: 'rgba(15,10,30,0.5)', opacity: visible ? Math.max(0, 1 - (dragY ?? 0) / 600) : 0, transition: dragging ? 'none' : undefined }} />
      <Tag {...common} {...formProps} data-testid="sheet-panel" data-visible={visible ? 'true' : 'false'}
        className="xp-sheet-panel relative w-full flex flex-col"
        style={{
          background: 'var(--xp-card)', overflow: 'hidden',
          borderTopLeftRadius: full ? 0 : 22, borderTopRightRadius: full ? 0 : 22,
          height: full ? '100%' : undefined, maxHeight: full ? '100%' : '88%',
          boxShadow: full ? 'none' : '0 -10px 40px rgba(0,0,0,0.28)',
          // `none` (not translateY(0)) once open: a leftover transform would make position:fixed popups inside it misplace.
          transform: dragY !== null ? `translateY(${dragY}px)` : visible ? 'none' : 'translateY(100%)',
          transition: dragging ? 'none' : undefined,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
        {!full && (
          <div data-testid="sheet-handle" className="flex-shrink-0 flex justify-center" style={{ padding: '8px 0 2px', touchAction: 'none', cursor: 'grab' }}
            onPointerDown={e => { startY.current = e.clientY; setDragY(0); e.currentTarget.setPointerCapture(e.pointerId) }}
            onPointerMove={e => { if (startY.current !== null) setDragY(Math.max(0, e.clientY - startY.current)) }}
            onPointerUp={() => { const d = dragY ?? 0; startY.current = null; setDragY(null); if (d > 90) onClose() }}
            onPointerCancel={() => { startY.current = null; setDragY(null) }}>
            <span aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--xp-bdr2)' }} />
          </div>
        )}
        {children}
      </Tag>
    </div>
  )
}

/** Escape closes the overlay (only while it is on screen). */
export function useSheetEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])
}

// ── Dropdown positioning (time + category pickers) ──────────────────────────

export interface PopupBox { top: number; left: number; width: number; maxHeight: number }

/** Where a list under/over `anchor` fits inside the visible viewport (keyboard-aware via visualViewport); position: fixed. */
export function measurePopup(anchor: HTMLElement, wanted = 260, minWidth = 150): PopupBox {
  const r = anchor.getBoundingClientRect()
  const vv = window.visualViewport
  const vTop = vv?.offsetTop ?? 0, vH = vv?.height ?? window.innerHeight
  const vLeft = vv?.offsetLeft ?? 0, vW = vv?.width ?? window.innerWidth
  const below = vTop + vH - r.bottom - 8, above = r.top - vTop - 8
  const placeBelow = below >= Math.min(wanted, 190) || below >= above
  const maxHeight = Math.max(110, Math.min(wanted, placeBelow ? below : above))
  const width = Math.min(Math.max(r.width, minWidth), vW - 16)
  const left = Math.min(Math.max(r.left, vLeft + 8), vLeft + vW - width - 8)
  return { top: placeBelow ? r.bottom + 4 : r.top - maxHeight - 4, left, width, maxHeight }
}

/** Keeps a popup's box current while it is open (scrolling the form, resizing, the keyboard appearing). */
export function usePopupBox(open: boolean, anchorRef: React.RefObject<HTMLElement | null>, wanted = 260) {
  const [box, setBox] = useState<PopupBox | null>(null)
  useEffect(() => {
    if (!open) return
    // Root cause of the old jitter: this listener is capture-phase, so it also heard the popup LIST scrolling, re-measured, published a brand-new box
    // object every time, and the list's "centre the highlighted row" effect (which depended on that object) snapped the list back under the user's finger.
    // Now: scrolling inside a listbox is ignored, and an unchanged box is never re-published.
    const measure = (ev?: Event) => {
      const t = ev?.target
      if (t instanceof Element && t.closest('[role="listbox"]')) return
      if (!anchorRef.current) return
      const next = measurePopup(anchorRef.current, wanted)
      setBox(prev => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.maxHeight === next.maxHeight ? prev : next))
    }
    const raf = requestAnimationFrame(() => measure())
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true)
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure)
    }
  }, [open, anchorRef, wanted])
  return open ? box : null
}

/**
 * Keeps the highlighted row of a popup list in view: centred when the list opens and whenever the highlight itself moves (arrow keys, typing),
 * but NEVER pulled back once the user has scrolled or pressed the list. A keyboard appearing or a window resize only re-centres a list the user
 * has not touched yet. Spread `userScroll` on the <ul> and attach `listRef`.
 */
export function useCenteredList(open: boolean, shown: boolean, height: number | undefined, active: number) {
  const listRef = useRef<HTMLUListElement>(null)
  const touched = useRef(false)
  const lastActive = useRef(-1)
  useEffect(() => { if (!open) { touched.current = false; lastActive.current = -1 } }, [open])
  useEffect(() => {
    if (!open || !shown) return
    const ul = listRef.current, el = ul?.children[active] as HTMLElement | undefined
    if (!ul || !el) return
    const moved = lastActive.current !== active
    if (touched.current && !moved) return              // layout changed, but the user is browsing: leave the list where they put it
    lastActive.current = active
    if (moved) touched.current = false
    ul.scrollTop = el.offsetTop - ul.clientHeight / 2 + el.offsetHeight / 2
  }, [open, shown, height, active])
  const markTouched = useCallback(() => { touched.current = true }, [])
  return { listRef, userScroll: { onWheel: markTouched, onTouchStart: markTouched, onPointerDown: markTouched } }
}
