'use client'

import { useEffect } from 'react'

/** iPhone / iPad / iPod (including iPadOS, which reports itself as a Mac but has a touch screen). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Full freeze of the page behind a modal: position:fixed pinned to the left edge, with the scroll position restored on
 * release. Returns the release function. A no-op if the page is already frozen (a modal opened over another one), so
 * nested modals never shift the page or restore the wrong position.
 */
function freezeBody(): () => void {
  if (document.body.style.position === 'fixed') return () => {}
  const scrollY = window.scrollY
  const prev = {
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    width: document.body.style.width,
  }
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.top = `-${scrollY}px`
  document.body.style.left = '0'
  document.body.style.width = '100%'
  return () => {
    document.body.style.overflow = prev.overflow
    document.body.style.position = prev.position
    document.body.style.top = prev.top
    document.body.style.left = prev.left
    document.body.style.width = prev.width
    window.scrollTo(0, scrollY)
  }
}

/**
 * iOS Safari / installed iOS PWA only: freezes the page for a modal on narrow screens too. `overflow:hidden` on <body>
 * does not stop iOS from panning/sliding the page under (and so apparently moving) a fixed modal, so the position:fixed
 * freeze is used there. Returns the release function, or null on every other platform (nothing is changed).
 */
export function freezeBodyOnIOS(): (() => void) | null {
  return isIOS() ? freezeBody() : null
}

/**
 * Freezes the page behind a modal on desktop/tablet so wheel and trackpad
 * scrolling never reaches the background, and scroll-chaining past the
 * modal's own scroll edges never leaks out. `overflow:hidden` on body alone
 * doesn't reliably stop this in every browser — this reuses the same
 * position:fixed + scrollY-restore freeze already proven for the burger-menu
 * drawer (see AppSidebar.tsx).
 *
 * Narrow (phone) screens keep the simple overflow:hidden lock unchanged — it
 * already works there — EXCEPT on iOS, which gets the full freeze (see
 * freezeBodyOnIOS). Android and desktop behave exactly as before.
 */
export function useLockBodyScroll(): void {
  useEffect(() => {
    if (window.innerWidth < 640) {
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const releaseIOS = freezeBodyOnIOS()
      return () => {
        if (releaseIOS) releaseIOS()
        document.body.style.overflow = prevOverflow
      }
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
