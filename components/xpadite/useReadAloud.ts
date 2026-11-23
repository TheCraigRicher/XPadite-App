'use client'

/**
 * v1.359 — React wrapper around the Read Aloud engine (readAloudEngine.ts). One engine per Planner editor, created on the client only.
 *  • The chosen speed is remembered on this device (localStorage, one small key); anything unreadable falls back to 1×.
 *  • A hidden tab PAUSES playback; returning to the tab never resumes it by itself.
 *  • pagehide and unmount stop playback (and cancel the browser's speech only if it is actually speaking).
 *  • Unsupported browsers get a short message instead of an error.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createReadAloud, IDLE_STATE, type ReadAloudEngine, type ReadMode, type ReadState, type UtteranceLike } from './readAloudEngine'
import { isValidRate, type SpeakSection } from './readAloud'

export const READ_RATE_KEY = 'xp-readaloud-rate-v1'

export function useReadAloud(notify: (message: string) => void) {
  const [state, setState] = useState<ReadState>(IDLE_STATE)
  const engRef = useRef<ReadAloudEngine | null>(null)
  const notifyRef = useRef(notify)
  useEffect(() => { notifyRef.current = notify }, [notify])

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
    const eng = createReadAloud({
      synth: ok ? (window.speechSynthesis as unknown as Parameters<typeof createReadAloud>[0]['synth']) : null,
      makeUtterance: t => new SpeechSynthesisUtterance(t) as unknown as UtteranceLike,
      notify: m => notifyRef.current(m),
      onState: setState,
      navLang: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    })
    engRef.current = eng
    try { const r = Number(localStorage.getItem(READ_RATE_KEY)); if (isValidRate(r)) eng.setRate(r) } catch { /* storage unavailable: 1× */ }
    const onVis = () => { if (document.visibilityState === 'hidden') eng.pause('hidden') }   // never auto-resumes on return
    const onHide = () => eng.stop()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      eng.dispose(); engRef.current = null
    }
  }, [])

  const start = useCallback((queue: SpeakSection[], mode: ReadMode) => engRef.current?.start(queue, mode), [])
  const pause = useCallback(() => engRef.current?.pause('user'), [])
  const resume = useCallback(() => engRef.current?.resume(), [])
  const stop = useCallback(() => engRef.current?.stop(), [])
  const setRate = useCallback((r: number) => {
    if (!isValidRate(r)) return
    engRef.current?.setRate(r)
    try { localStorage.setItem(READ_RATE_KEY, String(r)) } catch { /* not remembered */ }
  }, [])

  return { state, start, pause, resume, stop, setRate }
}
