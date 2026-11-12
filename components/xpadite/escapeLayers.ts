'use client'

import { useEffect, useRef } from 'react'

// ── Escape belongs to the top-most layer ─────────────────────────────────────────────────────────────────────────────────────────
// A window like the Task Manager listens for Escape on `window`; so do the dialogs, dropdowns and editors opened above it. One
// keypress used to reach ALL of them, so closing a dropdown or a dialog also closed (or prompted to close) the window underneath.
//
// Every nested layer announces itself with `useEscapeLayer(open, onEscape?)`. The window underneath asks `hasEscapeLayer()` in the
// CAPTURE phase — before any other handler has run and before React has re-rendered — so the answer is always the state at the moment
// the key was pressed, whatever the listeners' registration order. While a layer is open the window underneath ignores Escape and
// lets that layer deal with it. A layer that already handles Escape itself passes no `onEscape`; one that has no handler of its own
// (a menu, a popover) passes the function that closes it.

let openLayers = 0

/** True while any nested dialog / dropdown / editor is open above the window that asks. */
export function hasEscapeLayer(): boolean { return openLayers > 0 }

export function useEscapeLayer(active: boolean, onEscape?: (e: KeyboardEvent) => void): void {
  const handler = useRef(onEscape)
  useEffect(() => { handler.current = onEscape })   // always the latest closure, without writing a ref during render
  useEffect(() => {
    if (!active) return
    openLayers++
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handler.current?.(e) }
    window.addEventListener('keydown', onKey)
    return () => { openLayers--; window.removeEventListener('keydown', onKey) }
  }, [active])
}
