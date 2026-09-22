'use client'

import { useEffect } from 'react'

/**
 * Freezes the page behind a modal on desktop/tablet so wheel and trackpad
 * scrolling never reaches the background, and scroll-chaining past the
 * modal's own scroll edges never leaks out. `overflow:hidden` on body alone
 * doesn't reliably stop this in every browser — this reuses the same
 * position:fixed + scrollY-restore freeze already proven for the burger-menu
 * drawer (see AppSidebar.tsx).
 *
 * Mobile keeps the simple overflow:hidden lock unchanged — it already works
 * there and this hook must not touch that.
 */
export function useLockBodyScroll(): void {
  useEffect(() => {
    if (window.innerWidth < 640) {
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prevOverflow }
    }

    const scrollY = window.scrollY
    const prevOverflow = document.body.style.overflow
    const prevPosition = document.body.style.position
    const prevTop = document.body.style.top
    const prevWidth = document.body.style.width

    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.position = prevPosition
      document.body.style.top = prevTop
      document.body.style.width = prevWidth
      window.scrollTo(0, scrollY)
    }
  }, [])
}
