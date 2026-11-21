/**
 * v1.357 — the Persistent Alarm sound (client only). One repeating pattern on the SAME shared AudioContext the v1.356 chime uses
 * (no new dependency, no audio file). There is only ever ONE alarm audio stream: startAlarmSound() while already ringing just extends the
 * deadline; stopAlarmSound() silences and disconnects everything immediately.
 *
 * Safety: the pattern is scheduled one cycle at a time (never far ahead), every cycle re-checks the deadline, and stop() halts every live
 * oscillator — so even if a throttled background tab delays the timers, the sound cannot run on past its end.
 * Browsers decide whether sound is allowed (autoplay policy): a blocked start returns 'blocked' and is never hidden.
 */
import { acquireRunningContext, type SoundResult } from './reminderSound'

export interface AlarmAudio { start(untilMs: number): Promise<SoundResult>; stop(): void; isSounding(): boolean }

/** One cycle: three quick high beeps then a pause — clearly an alarm, clearly not the soft v1.356 chime. */
export const ALARM_BEEP_HZ = 1046.5
export const ALARM_BEEP_OFFSETS_S = [0, 0.28, 0.56] as const
export const ALARM_CYCLE_MS = 1800

let master: GainNode | null = null
let timer: ReturnType<typeof setInterval> | null = null
let until = 0
const live = new Set<OscillatorNode>()

export function isAlarmSounding(): boolean { return timer !== null }

function cycle(c: AudioContext): void {
  if (Date.now() >= until) { stopAlarmSound(); return }
  if (c.state !== 'running' || !master) return
  const t0 = c.currentTime + 0.02
  for (const off of ALARM_BEEP_OFFSETS_S) {
    const osc = c.createOscillator(), g = c.createGain()
    osc.type = 'square'; osc.frequency.setValueAtTime(ALARM_BEEP_HZ, t0 + off)
    g.gain.setValueAtTime(0.0001, t0 + off)
    g.gain.linearRampToValueAtTime(0.16, t0 + off + 0.01)
    g.gain.setValueAtTime(0.16, t0 + off + 0.14)
    g.gain.linearRampToValueAtTime(0.0001, t0 + off + 0.18)
    osc.connect(g); g.connect(master)
    live.add(osc)
    osc.onended = () => { live.delete(osc); try { osc.disconnect(); g.disconnect() } catch { /* already gone */ } }
    osc.start(t0 + off); osc.stop(t0 + off + 0.2)
  }
}

export async function startAlarmSound(untilMs: number): Promise<SoundResult> {
  if (timer !== null) { until = Math.max(until, untilMs); return 'played' }       // already ringing: one stream only
  const got = await acquireRunningContext()
  if (!('ctx' in got)) return got.result
  if (timer !== null) { until = Math.max(until, untilMs); return 'played' }       // another start finished first while we awaited
  const c = got.ctx
  until = untilMs
  master = c.createGain(); master.gain.value = 1; master.connect(c.destination)
  timer = setInterval(() => cycle(c), ALARM_CYCLE_MS)
  cycle(c)
  return 'played'
}

/** Silence NOW: stops every live beep, disconnects the alarm graph and clears the timer. Safe to call any time, any number of times. */
export function stopAlarmSound(): void {
  if (timer !== null) { clearInterval(timer); timer = null }
  until = 0
  for (const o of live) { try { o.onended = null; o.stop() } catch { /* not started / already stopped */ } try { o.disconnect() } catch { /* ok */ } }
  live.clear()
  if (master) { try { master.disconnect() } catch { /* ok */ } master = null }
}

export const alarmAudio: AlarmAudio = { start: startAlarmSound, stop: stopAlarmSound, isSounding: isAlarmSounding }
