// ── Startup readiness ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// XPadite paints from this device's saved copy at once, while the account's data is fetched in the background. Until that fetch has
// answered, "nothing here" on screen can mean two very different things — "the account is empty" or "we have not loaded it yet". The
// rule that protects the user's data: NOT LOADED IS NEVER TREATED AS EMPTY. Nothing may be edited, and nothing may be written to the
// server, until the account's data has genuinely been read (or this device holds a verified copy and the network is down).
//
// This file is the pure part: the stages that make up "loaded", their weights (the loader's percentage), and the status rules.

export type StageId = 'local' | 'auth' | 'calendar' | 'sessions' | 'activities' | 'preferences' | 'reminders' | 'labels' | 'folders' | 'notes' | 'schedule'

/** What each stage is worth in the percentage. The calendar (every day + every task) is the heaviest read, so it moves the ring most. */
export const STAGE_WEIGHTS: Record<StageId, number> = {
  local: 5,        // this device's saved copy restored
  auth: 8,         // the signed-in account identified
  calendar: 34,    // calendar days + Task Manager tasks
  sessions: 14,    // work-session history (analytics)
  activities: 6,
  preferences: 6,
  reminders: 5,
  labels: 4,
  folders: 4,
  notes: 8,        // Planner / Notes documents
  schedule: 6,     // My Schedule events
}
export const STAGE_IDS = Object.keys(STAGE_WEIGHTS) as StageId[]

/** A stage whose failure leaves the app unsafe to edit (its data is what an edit would overwrite or be merged into). */
export const REQUIRED_STAGES: StageId[] = ['auth', 'calendar', 'sessions', 'activities', 'preferences', 'reminders', 'labels']

export type StageState = 'pending' | 'done' | 'failed'
export type StageMap = Record<StageId, StageState>

/**
 * loading  — the account's data has not been read yet (never treated as empty)
 * ready    — read successfully (the account may genuinely be empty — that is a valid, safe state)
 * offline  — the read failed because there is no network, but this device holds a copy verified by an earlier successful read: safe to work
 * failed   — the read failed and this device has no verified copy: editing stays blocked until Retry succeeds
 */
export type StartupStatus = 'loading' | 'ready' | 'offline' | 'failed'

export const freshStages = (): StageMap => Object.fromEntries(STAGE_IDS.map(s => [s, 'pending'])) as StageMap

const TOTAL = STAGE_IDS.reduce((n, s) => n + STAGE_WEIGHTS[s], 0)

/** 0..1 — the weighted share of stages that have really completed. A failed stage does not count as done. */
export function stageProgress(stages: StageMap): number {
  let done = 0
  for (const s of STAGE_IDS) if (stages[s] === 'done') done += STAGE_WEIGHTS[s]
  return done / TOTAL
}

/** True when every stage that guards the user's data has read successfully. */
export function requiredStagesDone(stages: StageMap): boolean {
  return REQUIRED_STAGES.every(s => stages[s] === 'done')
}

/** Anything still outstanding, optional or required (the loader shows 100% only when this is empty). */
export function allStagesSettled(stages: StageMap): boolean {
  return STAGE_IDS.every(s => stages[s] !== 'pending')
}

export function anyRequiredFailed(stages: StageMap): boolean {
  return REQUIRED_STAGES.some(s => stages[s] === 'failed')
}

/** The verified-copy marker: written only after a complete, successful read for this exact account. */
export const VERIFIED_KEY = 'xp-startup-verified'
export function parseVerified(raw: string | null): { uid: string; at: number } | null {
  try {
    const v = JSON.parse(raw ?? 'null') as { uid?: unknown; at?: unknown } | null
    return v && typeof v.uid === 'string' && v.uid && typeof v.at === 'number' ? { uid: v.uid, at: v.at } : null
  } catch { return null }
}

/**
 * Decide the status once the read has finished (or failed).
 *  - every required stage done                    → ready
 *  - a required stage failed, device copy verified → offline  (only when the browser reports no connection or the request never reached the server)
 *  - otherwise                                     → failed
 */
export function decideStatus(input: { stages: StageMap; verifiedForUser: boolean; networkDown: boolean }): StartupStatus {
  const { stages, verifiedForUser, networkDown } = input
  if (requiredStagesDone(stages)) return 'ready'
  if (!anyRequiredFailed(stages)) return 'loading'
  return verifiedForUser && networkDown ? 'offline' : 'failed'
}

/** Is the data layer allowed to accept edits and write them to the server? */
export const isDataReady = (s: StartupStatus): boolean => s === 'ready' || s === 'offline'

/** Fetch errors that mean "no connection" rather than "the server answered with a problem". */
export function looksLikeNetworkError(err: unknown): boolean {
  const e = err as { message?: string; name?: string; code?: string; status?: number } | null
  if (!e) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|abort/.test(m)
}

/**
 * Smooth the DISPLAYED percentage toward the real one. It only ever moves toward `target` (never beyond it, so it can not claim
 * unfinished data has loaded), at a limited speed so a jump looks fluid. `dtMs` = time since the previous frame.
 */
export function stepDisplayed(current: number, target: number, dtMs: number): number {
  if (target <= current || !(dtMs > 0)) return current
  const gap = target - current
  const step = Math.max(gap * (1 - Math.exp(-dtMs / 140)), dtMs * 0.00012)      // ease out, with a floor so it always arrives
  return Math.min(target, current + step)
}
