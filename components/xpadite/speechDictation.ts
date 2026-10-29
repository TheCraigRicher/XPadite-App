// ── Planner speech-to-text session control ──────────────────────────────────
//
// Why the Planner microphone repeated words ("Just just want just want to …"):
//   1. Recognition mode. Android and iOS browsers deliver a CUMULATIVE stream in `continuous` mode: every update of
//      the same utterance arrives as a new result already flagged final ("just", "just want", "just want to" …).
//      Inserting each final result — correct on desktop Chrome — inserted every cumulative step. Those engines are
//      therefore run in single-utterance mode (one final result per utterance, then the session restarts), which
//      never produces cumulative results, so no text comparison or de-duplication of words is needed.
//   2. Session identity. The restart-after-end timer was not tied to a session: stopping the mic and starting it again
//      within the 200ms delay let the OLD recognizer restart while the NEW one ran, so two recognizers fed the editor
//      and every phrase went in twice. Every cycle here belongs to one session; a new start closes anything left over.
//   3. Result tracking. Results are committed by their index per recognition cycle (once each), not by relying on
//      the event's resultIndex, so a re-delivered final result is never inserted a second time.
//
// Only FINAL results are ever inserted — interim results are provisional and are only used as a sign of activity.
// Intentionally repeated words are untouched: nothing here compares or filters text.

export interface SpeechResultLike { isFinal: boolean; 0?: { transcript?: string } }
export interface SpeechEventLike { results: ArrayLike<SpeechResultLike>; resultIndex?: number }
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export interface DictationOptions {
  createRecognition: () => SpeechRecognitionLike
  lang: string
  /** false = one utterance per cycle (mobile engines); true = one long cycle (desktop engines). */
  continuous: boolean
  /** A finalized, trimmed piece of speech. Called once per final result. */
  onText: (text: string) => void
  /** Any recognition activity (interim or final) while the session is live. */
  onActivity?: () => void
  /** A fatal error ('not-allowed', 'network', 'restart-failed', …). The caller should stop the session. */
  onFatal: (code: string) => void
  /** The last cycle of a stopped session has fully closed (including its drain). */
  onSettled?: () => void
  restartDelayMs?: number
  drainMs?: number
}

export interface Dictation {
  /** Starts a session. Returns false if the engine refused to start. Any leftover cycle is closed first. */
  start(): boolean
  /** Stops the session. drain: let the utterance in progress finalize (bounded), then close. */
  stop(o?: { drain?: boolean }): void
  readonly active: boolean
}

/**
 * Engines that duplicate in continuous mode: Android and iOS/iPadOS browsers (phones and tablets).
 * Desktop Chrome/Edge keep continuous mode.
 */
export function prefersSingleUtterance(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined): boolean {
  if (!nav) return false
  const ua = nav.userAgent ?? ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1   // iPadOS reports itself as a Mac
}

interface Cycle {
  rec: SpeechRecognitionLike
  epoch: number
  committed: Set<number>
  closed: boolean
  draining: boolean
  drainTimer: ReturnType<typeof setTimeout> | null
}

export function createDictation(o: DictationOptions): Dictation {
  const restartDelay = o.restartDelayMs ?? 200
  const drainMs = o.drainMs ?? 1500
  let epoch = 0                       // changes at every start(): results/timers of older sessions are ignored
  let running = false
  let cur: Cycle | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  function clearRestart() { if (restartTimer) { clearTimeout(restartTimer); restartTimer = null } }

  function closeCycle(c: Cycle, abort: boolean) {
    if (c.closed) return
    c.closed = true
    if (c.drainTimer) { clearTimeout(c.drainTimer); c.drainTimer = null }
    c.rec.onresult = null; c.rec.onerror = null; c.rec.onend = null     // nothing a closed cycle emits can reach the editor
    if (abort) { try { c.rec.abort() } catch {} }
    if (cur === c) cur = null
    if (!running && !cur) o.onSettled?.()
  }

  function startCycle(ep: number): boolean {
    let rec: SpeechRecognitionLike
    try { rec = o.createRecognition() } catch { return false }
    rec.continuous = o.continuous
    rec.interimResults = true
    rec.lang = o.lang
    const c: Cycle = { rec, epoch: ep, committed: new Set(), closed: false, draining: false, drainTimer: null }

    rec.onresult = e => {
      if (c.closed || c.epoch !== epoch) return
      if (!running && !c.draining) return
      if (running) o.onActivity?.()
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (!r.isFinal || c.committed.has(i)) continue     // interim = provisional; a final index is committed once
        c.committed.add(i)
        const text = (r[0]?.transcript ?? '').trim()
        if (text) o.onText(text)
      }
    }
    rec.onerror = e => {
      if (c.closed || c.epoch !== epoch) return
      const code = e.error ?? 'unknown'
      if (code === 'no-speech' || code === 'aborted') return   // ordinary pause / our own stop — never ends the session
      o.onFatal(code)
    }
    rec.onend = () => {
      if (c.closed) return
      closeCycle(c, false)
      if (running && c.epoch === epoch) {
        clearRestart()
        restartTimer = setTimeout(() => {
          restartTimer = null
          if (!running || c.epoch !== epoch) return
          if (!startCycle(c.epoch)) { running = false; o.onFatal('restart-failed') }
        }, restartDelay)
      }
    }

    cur = c
    try { rec.start() } catch { cur = null; c.closed = true; rec.onresult = rec.onerror = rec.onend = null; return false }
    return true
  }

  return {
    get active() { return running },
    start() {
      if (running) return true
      clearRestart()
      if (cur) closeCycle(cur, true)          // a previous session's draining cycle must not overlap this one
      epoch++
      running = true
      if (startCycle(epoch)) return true
      running = false
      return false
    },
    stop(opts) {
      if (!running) return
      running = false
      clearRestart()
      const c = cur
      if (!c) { o.onSettled?.(); return }
      if (opts?.drain) {
        c.draining = true
        c.drainTimer = setTimeout(() => closeCycle(c, true), drainMs)
        try { c.rec.stop() } catch { closeCycle(c, true) }          // the engine finalizes what was said, then ends
      } else {
        closeCycle(c, true)
      }
    },
  }
}
