'use client'

import { useEffect } from 'react'

// Registers the (online-first, near-empty) service worker. Production only: in development a service worker just
// gets in the way of hot reloading. `updateViaCache: 'none'` makes the browser re-check /sw.js on every visit so a
// new release is picked up promptly.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    const register = () => { navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}) }
    if (document.readyState === 'complete') register()
    else { window.addEventListener('load', register, { once: true }); return () => window.removeEventListener('load', register) }
  }, [])

  return null
}
