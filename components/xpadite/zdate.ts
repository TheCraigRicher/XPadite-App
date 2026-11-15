// ── Account-timezone dates for My Schedule and deadlines (v1.345) ─────────────────────────────────────────────────────────────────────
// A user has ONE XPadite timezone (the account's, synced through user_preferences.timezone). Every wall-clock reading of a schedule instant — the hour a
// block sits at, the day a deadline falls on, the 5 PM typed into the editor — must use it, or the same deadline would read differently on a phone in one
// zone and a laptop in another.
//
// `ZDate` is a drop-in subclass of Date: its CALENDAR FIELDS (getHours, getDate, getDay, toLocaleDateString, …) and its WALL-CLOCK CONSTRUCTORS
// (new ZDate(y, m, d, h, mi)) are read and built in the schedule timezone instead of the device's. Instants (getTime, comparison, ISO strings) are
// untouched, so storage never changes. With no timezone set it uses the device timezone and behaves exactly like Date.
//
// The schedule timezone is module state set once by AppProvider (setScheduleTz); only the schedule/deadline modules construct ZDate.

import { offsetAt } from './dueStatus'

// '' = this runtime reports no IANA zone name (some non-browser runtimes): fall back to the runtime's own local-time rules (exactly like Date).
const deviceTz = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } }
const validTz = (tz: string): boolean => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }

let scheduleTz: string = deviceTz()
export function setScheduleTz(tz: string | null | undefined): void { scheduleTz = tz && validTz(tz) ? tz : deviceTz() }
export function getScheduleTz(): string { return scheduleTz }

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number }
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsAt(ms: number, tz: string): Parts {
  if (!tz) { const n = new Date(ms); return { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes(), s: n.getSeconds(), dow: n.getDay() } }
  let f = fmtCache.get(tz)
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); fmtCache.set(tz, f) }
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday)
  return { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow }
}

/** The instant at which the wall clock in `tz` reads the given fields (JS Date rules: months/days/hours overflow into the next unit). */
export function wallToInstant(tz: string, y: number, mo: number, d = 1, h = 0, mi = 0, s = 0, ms = 0): number {
  if (!tz) return new Date(y, mo, d, h, mi, s, ms).getTime()
  const wall = Date.UTC(y, mo, d, h, mi, s, ms)
  const t1 = wall - offsetAt(wall, tz)
  return wall - offsetAt(t1, tz)
}

export class ZDate extends Date {
  private _pt = NaN
  private _pz = ''
  private _p: Parts | null = null

  constructor(...a: unknown[]) {
    super(ZDate.resolve(a))
  }
  private static resolve(a: unknown[]): number {
    if (a.length === 0) return Date.now()
    if (a.length === 1) { const v = a[0]; return v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v as string).getTime() }
    const n = a.map(x => Number(x))
    return wallToInstant(scheduleTz, n[0], n[1], n[2] ?? 1, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, n[6] ?? 0)
  }
  private p(): Parts {
    const t = this.getTime()
    if (!this._p || this._pt !== t || this._pz !== scheduleTz) { this._p = partsAt(t, scheduleTz); this._pt = t; this._pz = scheduleTz }
    return this._p
  }
  private set(f: (p: Parts) => number[]): number {
    const t = this.getTime(); if (Number.isNaN(t)) return NaN
    const v = f(this.p()); const ms = ((t % 1000) + 1000) % 1000
    return this.setTime(wallToInstant(scheduleTz, v[0], v[1], v[2], v[3], v[4], v[5], v[6] ?? ms))
  }

  getFullYear() { return this.p().y }
  getMonth() { return this.p().mo }
  getDate() { return this.p().d }
  getDay() { return this.p().dow }
  getHours() { return this.p().h }
  getMinutes() { return this.p().mi }
  getSeconds() { return this.p().s }
  getTimezoneOffset() { return scheduleTz ? -offsetAt(this.getTime(), scheduleTz) / 60000 : super.getTimezoneOffset() }

  setFullYear(y: number, mo?: number, d?: number) { return this.set(p => [y, mo ?? p.mo, d ?? p.d, p.h, p.mi, p.s]) }
  setMonth(mo: number, d?: number) { return this.set(p => [p.y, mo, d ?? p.d, p.h, p.mi, p.s]) }
  setDate(d: number) { return this.set(p => [p.y, p.mo, d, p.h, p.mi, p.s]) }
  setHours(h: number, mi?: number, s?: number, ms?: number) { return this.set(p => [p.y, p.mo, p.d, h, mi ?? p.mi, s ?? p.s, ms ?? (((this.getTime() % 1000) + 1000) % 1000)]) }
  setMinutes(mi: number, s?: number, ms?: number) { return this.set(p => [p.y, p.mo, p.d, p.h, mi, s ?? p.s, ms ?? (((this.getTime() % 1000) + 1000) % 1000)]) }
  setSeconds(s: number, ms?: number) { return this.set(p => [p.y, p.mo, p.d, p.h, p.mi, s, ms ?? (((this.getTime() % 1000) + 1000) % 1000)]) }

  toLocaleDateString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return super.toLocaleDateString(locales, scheduleTz ? { timeZone: scheduleTz, ...options } : options) }
  toLocaleTimeString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return super.toLocaleTimeString(locales, scheduleTz ? { timeZone: scheduleTz, ...options } : options) }
  toLocaleString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { return super.toLocaleString(locales, scheduleTz ? { timeZone: scheduleTz, ...options } : options) }
}
