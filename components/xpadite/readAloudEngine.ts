/**
 * v1.359 — Planner Read Aloud: the playback engine (no React). It drives the browser's own speechSynthesis one SHORT chunk at a time and keeps the
 * session state. Read-only by construction: it never touches a document, an editor, history or a save path.
 *
 *  • ONE session at a time. start() replaces whatever is running; every utterance carries a generation number and is ignored if it is stale, so a
 *    late `end` / `error` from an old utterance can never skip text, restart playback or start a second stream.
 *  • speechSynthesis.cancel() is called ONLY when something is actually speaking or queued, and only to stop / pause / re-time / replace it — never
 *    when speech has simply finished or when nothing is playing.
 *  • Pause is "stop here, remember where": native pause()/resume() is unreliable (Android Chrome treats pause as cancel, some voices never resume), so
 *    pausing cancels the running utterance and remembers the position. Resume / a speed change continues at the last WORD boundary the browser reported
 *    (Chrome desktop, Safari, Firefox report them), else replays only the current short chunk (≤ 180 characters).
 *  • Missing `end` events (a known iOS Safari / some Android voice problem) are covered by a watchdog that NEVER skips text while the browser still
 *    reports speaking or while words are still progressing: it moves on only when the browser says it is idle, no event has arrived for at least the
 *    estimated duration of the chunk, and that was confirmed twice. A genuinely stuck "speaking" state gets one retry, then a clear message.
 *  • A hidden tab pauses (pause('hidden')); coming back does NOT resume by itself — the person presses Resume.
 */
import { DEFAULT_RATE, isValidRate, pickVoice, resumeIndex, type SpeakSection } from './readAloud'

export type ReadStatus = 'idle' | 'playing' | 'paused'
export type PausedBy = 'user' | 'hidden' | 'interrupted' | 'blocked' | null
export type ReadMode = 'section' | 'all'
export interface ReadState { status: ReadStatus; mode: ReadMode | null; sectionIndex: number; sectionCount: number; title: string; rate: number; pausedBy: PausedBy }
export const IDLE_STATE: ReadState = { status: 'idle', mode: null, sectionIndex: 0, sectionCount: 0, title: '', rate: DEFAULT_RATE, pausedBy: null }

/** The parts of SpeechSynthesisUtterance this engine uses (so tests can fake it). */
export interface UtteranceLike {
  text: string; rate: number; voice: unknown; lang: string
  onstart: ((e?: unknown) => void) | null
  onend: ((e?: unknown) => void) | null
  onerror: ((e?: { error?: string }) => void) | null
  onboundary: ((e?: { charIndex?: number; name?: string }) => void) | null
}
export interface SynthLike { speak(u: UtteranceLike): void; cancel(): void; getVoices(): Array<{ lang: string; default?: boolean; localService?: boolean }>; speaking: boolean; pending: boolean }

export interface EngineDeps {
  synth: SynthLike | null
  makeUtterance: (text: string) => UtteranceLike
  notify: (message: string) => void
  onState: (s: ReadState) => void
  navLang?: string
}

/** Pause between a cancel() and the speak() that follows it — Chrome can swallow a speak() issued in the same tick as a cancel(). */
const AFTER_CANCEL_MS = 60

export interface ReadAloudEngine {
  start(queue: SpeakSection[], mode: ReadMode): 'started' | 'empty' | 'unsupported'
  pause(by?: 'user' | 'hidden'): void
  resume(): void
  stop(): void
  setRate(r: number): void
  dispose(): void
  getState(): ReadState
}

export function createReadAloud(deps: EngineDeps): ReadAloudEngine {
  const synth = deps.synth
  let queue: SpeakSection[] = []
  let si = 0, ci = 0
  let mode: ReadMode | null = null
  let status: ReadStatus = 'idle'
  let pausedBy: PausedBy = null
  let rate = DEFAULT_RATE
  let gen = 0                              // bumped by every start / pause / resume / stop / re-time / skip: older utterances become inert
  let cur: UtteranceLike | null = null     // the utterance currently handed to the browser
  let base = 0                             // characters of the current chunk that precede the running utterance's text
  let boundaryAt: number | null = null     // last word boundary reported for the running utterance (absolute index within the chunk)
  let resumeFrom = 0                       // where the current chunk restarts after pause / interruption
  let lastEventAt = 0
  let retried = false
  let quiet = 0
  let wd: ReturnType<typeof setTimeout> | null = null
  let soon: ReturnType<typeof setTimeout> | null = null

  const state = (): ReadState => ({ status, mode, sectionIndex: si, sectionCount: queue.length, title: queue[si]?.title ?? '', rate, pausedBy })
  const emit = () => deps.onState(state())
  const chunk = () => queue[si]?.chunks[ci] ?? ''
  const clearTimers = () => { if (wd) { clearTimeout(wd); wd = null } if (soon) { clearTimeout(soon); soon = null } }
  const busy = () => !!cur || (!!synth && (synth.speaking || synth.pending))
  /** The ONLY place cancel() is called: and only if something is really speaking / queued. Returns whether it cancelled. */
  function cancelIfBusy(): boolean {
    const b = busy()
    cur = null
    if (b && synth) { try { synth.cancel() } catch { /* nothing to cancel */ } }
    return b
  }
  const here = () => resumeIndex(chunk(), base, boundaryAt)

  function reset() { queue = []; si = 0; ci = 0; mode = null; status = 'idle'; pausedBy = null; cur = null; base = 0; boundaryAt = null; resumeFrom = 0; retried = false; quiet = 0 }
  function finish() { clearTimers(); reset(); emit() }

  function suspend(by: PausedBy) {          // the browser stopped us (another tab spoke, autoplay policy): stay put, let the person resume
    if (status !== 'playing') return
    resumeFrom = here(); clearTimers(); status = 'paused'; pausedBy = by; emit()
  }

  function speakSoon(from: number, afterCancel: boolean) {
    const g = gen
    if (!afterCancel) { speakFrom(from); return }
    soon = setTimeout(() => { soon = null; if (g === gen && status === 'playing') speakFrom(from) }, AFTER_CANCEL_MS)
  }

  function skipForward() { gen++; cur = null; advance() }

  function advance() {
    clearTimers(); retried = false; quiet = 0
    ci++
    if (ci >= (queue[si]?.chunks.length ?? 0)) { si++; ci = 0; if (si >= queue.length) { finish(); return } }
    emit()
    speakFrom(0)
  }

  function speakFrom(from: number) {
    if (!synth) { finish(); return }
    const g = gen
    const text = chunk().slice(from)
    if (!text.trim()) { advance(); return }
    base = from; boundaryAt = null; lastEventAt = Date.now(); quiet = 0
    const u = deps.makeUtterance(text)
    u.rate = rate
    const voice = pickVoice(synth.getVoices(), deps.navLang)
    if (voice) { u.voice = voice; u.lang = voice.lang }
    const live = () => g === gen && cur === u
    u.onstart = () => { if (live()) lastEventAt = Date.now() }
    u.onboundary = e => {
      if (!live()) return
      lastEventAt = Date.now()
      if (e && typeof e.charIndex === 'number' && (e.name === undefined || e.name === 'word')) boundaryAt = base + e.charIndex
    }
    u.onend = () => { if (!live()) return; cur = null; advance() }
    u.onerror = e => {
      if (!live()) return
      cur = null
      const code = e?.error
      if (code === 'canceled') return
      if (code === 'interrupted') { suspend('interrupted'); return }
      if (code === 'not-allowed') { deps.notify('Your browser blocked speech. Press Resume to start Read Aloud.'); suspend('blocked'); return }
      deps.notify('Read Aloud stopped: the browser could not speak this text.')
      stop()
    }
    cur = u
    try { synth.speak(u) } catch { cur = null; deps.notify('Read Aloud stopped: the browser could not speak this text.'); stop(); return }
    armWatchdog(g, text.length)
  }

  // ── missing-`end` safety net ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function armWatchdog(g: number, len: number) {
    if (wd) clearTimeout(wd)
    const est = Math.max(2500, (len / (11 * rate)) * 1000)             // generous: ~11 characters a second at 1×
    wd = setTimeout(() => check(g, est), est * 1.6 + 4000)
  }
  function check(g: number, est: number) {
    wd = null
    if (g !== gen || status !== 'playing') return
    const quietFor = Date.now() - lastEventAt
    const speaking = !!synth && (synth.speaking || synth.pending)
    if (speaking) {                                                       // the browser is still speaking: never skip
      quiet = 0
      if (quietFor > Math.max(30000, est * 3)) {                          // …but claims to speak while nothing has happened for far too long
        if (!retried) { retried = true; resumeFrom = here(); gen++; clearTimers(); const c = cancelIfBusy(); speakSoon(resumeFrom, c); return }
        deps.notify('Read Aloud stopped: the browser stopped responding.'); stop(); return
      }
      wd = setTimeout(() => check(g, est), 2000); return
    }
    if (quietFor >= est && ++quiet >= 2) { skipForward(); return }       // idle, no end event, long enough, confirmed twice
    wd = setTimeout(() => check(g, est), 1500)
  }

  // ── public API ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function start(q: SpeakSection[], m: ReadMode) {
    if (!synth) { deps.notify('Read Aloud is not available in this browser.'); return 'unsupported' as const }
    if (q.length === 0) return 'empty' as const
    const replacing = status !== 'idle' || busy()
    gen++; clearTimers()
    const c = replacing ? cancelIfBusy() : false
    queue = q; si = 0; ci = 0; mode = m; status = 'playing'; pausedBy = null; retried = false; quiet = 0; base = 0; boundaryAt = null; resumeFrom = 0
    emit()
    speakSoon(0, c)
    return 'started' as const
  }

  function pause(by: 'user' | 'hidden' = 'user') {
    if (status !== 'playing') return
    resumeFrom = here()
    gen++; clearTimers(); cancelIfBusy()
    status = 'paused'; pausedBy = by; emit()
  }

  function resume() {
    if (status !== 'paused') return
    status = 'playing'; pausedBy = null; gen++
    emit()
    speakFrom(resumeFrom)
  }

  function stop() {
    if (status === 'idle') return                                          // nothing running: nothing to cancel
    gen++; clearTimers()
    cancelIfBusy()
    reset(); emit()
  }

  function setRate(r: number) {
    if (!isValidRate(r) || r === rate) return
    rate = r
    if (status === 'playing') {
      resumeFrom = here()
      gen++; clearTimers()
      const c = cancelIfBusy()
      emit()
      speakSoon(resumeFrom, c)
    } else emit()
  }

  return { start, pause, resume, stop, setRate, dispose: stop, getState: state }
}
