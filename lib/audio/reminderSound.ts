/**
 * v1.356 — the in-app reminder sound (client only). A short, recognisable three-note XPadite chime synthesised with the Web Audio API
 * (no audio file, no recurring cost, nothing to download).
 *
 * Browsers only let a page make sound after the person has interacted with it (autoplay policy). So one shared AudioContext is created / resumed
 * on the FIRST tap, click or key press anywhere in XPadite (installAudioUnlock); after that a reminder can chime without a new gesture.
 * playReminderChime() never fails silently: it returns 'played', 'blocked' (the browser still refuses — tap the page or use Test Reminder Sound)
 * or 'unsupported', so the caller can show a visible fallback and guidance.
 */

export type SoundResult = 'played' | 'blocked' | 'unsupported'

let ctx: AudioContext | null = null

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null
}

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx
  const C = audioCtor()
  if (!C) return null
  try { ctx = new C() } catch { ctx = null }
  return ctx
}

/** Call from a user gesture (or let installAudioUnlock do it): creates and resumes the shared context. */
export function unlockAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume().catch(() => { /* still blocked: reported by playReminderChime */ })
}

/** Is sound currently allowed (the shared context is running)? */
export function isAudioUnlocked(): boolean { return !!ctx && ctx.state === 'running' }

/** Unlock on the first interaction. Returns a cleanup function. */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {}
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchend', 'keydown']
  const handler = () => { unlockAudio(); if (isAudioUnlocked()) remove() }
  const remove = () => events.forEach(e => window.removeEventListener(e, handler, true))
  events.forEach(e => window.addEventListener(e, handler, true))
  return remove
}

/** Pitches (Hz) of the chime: an ascending E–A–C♯ figure, played twice — distinct from the plain task-reminder beeps. */
export const CHIME_NOTES = [659.25, 880, 1108.73] as const

export async function playReminderChime(): Promise<SoundResult> {
  const c = getCtx()
  if (!c) return 'unsupported'
  try {
    if (c.state === 'suspended') await Promise.race([c.resume(), new Promise<void>(r => setTimeout(r, 500))])
  } catch { /* fall through to the state check */ }
  if (c.state !== 'running') return 'blocked'
  const t0 = c.currentTime + 0.02
  const note = (freq: number, at: number, len: number, peak: number) => {
    const osc = c.createOscillator(), gain = c.createGain()
    osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t0 + at)
    gain.gain.setValueAtTime(0.0001, t0 + at)
    gain.gain.linearRampToValueAtTime(peak, t0 + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
    osc.connect(gain); gain.connect(c.destination)
    osc.start(t0 + at); osc.stop(t0 + at + len + 0.02)
  }
  CHIME_NOTES.forEach((f, i) => { note(f, i * 0.16, 0.5, 0.28); note(f * 2, i * 0.16, 0.35, 0.06) })   // bright partial on each note
  CHIME_NOTES.forEach((f, i) => note(f, 0.9 + i * 0.16, 0.6, 0.22))                                       // the figure again, softer
  return 'played'
}
