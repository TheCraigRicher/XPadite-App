// ── Day sync queue ──────────────────────────────────────────────────────────
//
// Durable, ordered, failure-aware persistence for calendar_days rows.
//
// The previous design (a 1s debounce around a fire-and-forget upsert) had four
// ways to silently lose history:
//   1. a failed upsert was only console.error'd and its data was already
//      dropped from the pending map, so nothing ever retried it;
//   2. on the next load "Supabase wins per date" replaced the (correct) local
//      copy with the stale server row, permanently erasing the unsaved edits;
//   3. a move writes two independent rows (origin, destination); if the origin
//      write landed and the destination write did not, the task existed on
//      neither day;
//   4. a late realtime echo / hydration response could overwrite a newer local
//      state once the debounce timer had been deleted but the write was still
//      in flight.
//
// This queue fixes all four:
//   - an entry stays "unsynced" from the first edit until the server CONFIRMS
//     the version that was written (in flight and failed writes included), and
//     callers use hasUnsynced(key) to refuse to overwrite such a day;
//   - failures keep the data, back off and retry (and retryNow() on reconnect);
//   - schedule(key, data, { after }) holds the origin-day write until the
//     destination-day write is confirmed, so a move can duplicate on a partial
//     failure but can never lose the task;
//   - versions: a confirmation only clears the entry if no newer edit arrived
//     while the write was in flight.

export interface DaySyncOptions<T> {
  write: (key: string, data: T) => Promise<void>
  debounceMs?: number
  retryDelaysMs?: number[]
  /** First failure of an outage (not every retry). */
  onError?: (key: string, err: unknown) => void
  /** All unsynced entries confirmed after at least one failure. */
  onRecovered?: () => void
  /** The set of unsynced keys changed (persist it so a refresh can resume). */
  onUnsyncedChange?: (keys: string[]) => void
}

interface Entry<T> {
  data: T
  version: number
  timer: ReturnType<typeof setTimeout> | null
  flight: Promise<boolean> | null
  failures: number
  after: Map<string, number>   // dependency key → version that must be confirmed first
}

export class DaySyncQueue<T = unknown> {
  private entries = new Map<string, Entry<T>>()
  private confirmed = new Map<string, number>()
  private counter = 0
  private outage = false
  private opts: Required<Pick<DaySyncOptions<T>, 'write' | 'debounceMs' | 'retryDelaysMs'>> & DaySyncOptions<T>

  constructor(opts: DaySyncOptions<T>) {
    this.opts = { debounceMs: 1000, retryDelaysMs: [2000, 5000, 15000, 30000], ...opts }
  }

  hasUnsynced(key: string): boolean { return this.entries.has(key) }
  unsyncedKeys(): string[] { return Array.from(this.entries.keys()) }
  get inOutage(): boolean { return this.outage }

  /** Record the latest value for a day and (re)start its debounce. */
  schedule(key: string, data: T, o?: { after?: string[] }): void {
    const e = this.entries.get(key) ?? { data, version: 0, timer: null, flight: null, failures: 0, after: new Map<string, number>() }
    const isNew = !this.entries.has(key)
    e.data = data
    e.version = ++this.counter
    for (const dep of o?.after ?? []) {
      if (dep === key) continue
      const d = this.entries.get(dep)
      if (d) {
        d.after.delete(key)                 // never create a dependency cycle
        e.after.set(dep, d.version)
      }
    }
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => { void this.writeKey(key) }, this.opts.debounceMs)
    this.entries.set(key, e)
    if (isNew) this.opts.onUnsyncedChange?.(this.unsyncedKeys())
  }

  /** Write one day now. Resolves true only when the server confirmed everything scheduled so far for it. */
  flush(key: string): Promise<boolean> { return this.writeKey(key) }

  /** Write every unsynced day now (page hide, Save, reconnect). */
  async flushAll(): Promise<boolean> {
    const results = await Promise.all(this.unsyncedKeys().map(k => this.writeKey(k)))
    return results.every(Boolean)
  }

  retryNow(): void { void this.flushAll() }

  private confirmedAtLeast(key: string, v: number): boolean { return (this.confirmed.get(key) ?? 0) >= v }

  private async writeKey(key: string): Promise<boolean> {
    for (let guard = 0; guard < 6; guard++) {
      const e = this.entries.get(key)
      if (!e) return true
      if (e.flight) { await e.flight; continue }

      for (const [dep, v] of e.after) {
        if (this.confirmedAtLeast(dep, v)) { e.after.delete(dep); continue }
        const ok = await this.writeKey(dep)
        if (!ok || !this.confirmedAtLeast(dep, v)) return false
        e.after.delete(dep)
      }
      if (this.entries.get(key) !== e) continue

      if (e.timer) { clearTimeout(e.timer); e.timer = null }
      const v = e.version, data = e.data
      e.flight = (async () => {
        try {
          await this.opts.write(key, data)
          this.confirmed.set(key, Math.max(this.confirmed.get(key) ?? 0, v))
          e.failures = 0
          return true
        } catch (err) {
          e.failures++
          if (!this.outage) { this.outage = true; this.opts.onError?.(key, err) }
          return false
        }
      })()
      const ok = await e.flight
      e.flight = null
      if (!ok) {
        if (e.timer) clearTimeout(e.timer)
        const delays = this.opts.retryDelaysMs
        e.timer = setTimeout(() => { void this.writeKey(key) }, delays[Math.min(e.failures - 1, delays.length - 1)])
        return false
      }
      if (e.version === v) {
        this.entries.delete(key)
        this.opts.onUnsyncedChange?.(this.unsyncedKeys())
        if (this.outage && this.entries.size === 0) { this.outage = false; this.opts.onRecovered?.() }
        return true
      }
      // A newer edit arrived while this write was in flight: loop and write it too.
    }
    return false
  }

  /** Test/teardown helper: cancel all timers (does not drop data). */
  dispose(): void { for (const e of this.entries.values()) if (e.timer) { clearTimeout(e.timer); e.timer = null } }
}
