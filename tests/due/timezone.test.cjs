// Cross-device timezone architecture (v1.345): ONE account timezone (user_preferences.timezone), claimed once, never overwritten; My Schedule and deadlines read
// wall-clock times in it (zdate.ts); a deadline's assigned date is ANCHORED (never re-derived per device, never relocated by reconciliation).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-tz'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const js = f => ts.transpileModule(read(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
for (const m of ['zdate', 'dueStatus', 'deadlineLink', 'deadlineIndex', 'scheduleLogic']) fs.writeFileSync(path.join(OUT, m + '.js'), js(`components/xpadite/${m}.ts`))
fs.writeFileSync(path.join(OUT, 'core-data.js'), js('lib/supabase/core-data.ts'))
const Z = require(path.join(OUT, 'zdate.js')), D = require(path.join(OUT, 'dueStatus.js')), L = require(path.join(OUT, 'deadlineLink.js')), X = require(path.join(OUT, 'deadlineIndex.js')), S = require(path.join(OUT, 'scheduleLogic.js'))
const CD = require(path.join(OUT, 'core-data.js'))

const VAN = 'America/Vancouver', NY = 'America/New_York', TOK = 'Asia/Tokyo'
const withTz = (tz, fn) => { Z.setScheduleTz(tz); try { return fn() } finally { Z.setScheduleTz(null) } }

// ── ZDate: calendar fields and wall-clock construction in the schedule timezone ───────────────────────────────────────────────────
test('ZDate reads fields and builds wall-clock times in the schedule timezone; instants never change', () => {
  const inst = Date.UTC(2026, 10, 13, 3, 30)        // Nov 13 03:30 UTC
  const view = tz => withTz(tz, () => { const d = new Z.ZDate(inst); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getDay(), d.getTime()] })
  assert.deepEqual(view('UTC'), [2026, 10, 13, 3, 30, 5, inst])
  assert.deepEqual(view(NY), [2026, 10, 12, 22, 30, 4, inst])       // 22:30 on Thu Nov 12
  assert.deepEqual(view(TOK), [2026, 10, 13, 12, 30, 5, inst])
  // typing 5:00 PM on Nov 13 means a DIFFERENT instant per timezone, and reads back as 5:00 PM in that zone
  const at = tz => withTz(tz, () => new Z.ZDate(2026, 10, 13, 17, 0).getTime())
  assert.equal(at(NY), Date.UTC(2026, 10, 13, 22, 0)); assert.equal(at(TOK), Date.UTC(2026, 10, 13, 8, 0))
  for (const tz of [NY, TOK, VAN]) { const inst2 = at(tz); withTz(tz, () => { const d = new Z.ZDate(inst2); assert.deepEqual([d.getDate(), d.getHours(), d.getMinutes()], [13, 17, 0]) }) }
})

test('ZDate follows Date rules: overflow, setters, month ends, and DST days (25 h autumn / 23 h spring)', () => {
  withTz(NY, () => {
    assert.equal(new Z.ZDate(2026, 0, 32).getDate(), 1); assert.equal(new Z.ZDate(2026, 0, 32).getMonth(), 1)
    assert.equal(new Z.ZDate(2026, 11, 31, 25, 0).getDate(), 1)
    const d = new Z.ZDate(2026, 10, 1, 9, 0); d.setDate(d.getDate() + 1); assert.deepEqual([d.getDate(), d.getHours()], [2, 9]); d.setHours(0, 0, 0, 0); assert.equal(d.getHours(), 0)
    const day = (y, m, dd) => new Z.ZDate(y, m, dd).getTime()
    assert.equal(day(2026, 10, 2) - day(2026, 10, 1), 25 * 3600000)    // fall back (Nov 1 2026)
    assert.equal(day(2026, 2, 9) - day(2026, 2, 8), 23 * 3600000)      // spring forward (Mar 8 2026)
    assert.equal(new Z.ZDate(2026, 2, 9, 8, 0).getHours(), 8)
  })
})

test('ZDate text output uses the schedule timezone; with no zone set it is the device (the default)', () => {
  const inst = Date.UTC(2026, 10, 13, 3, 30)
  const label = tz => withTz(tz, () => new Z.ZDate(inst).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))
  assert.equal(label(NY), 'Thu, Nov 12, 2026'); assert.equal(label(TOK), 'Fri, Nov 13, 2026')
  assert.equal(withTz(NY, () => S.clockLabel(inst, '12h')), '10:30 PM'); assert.equal(withTz(TOK, () => S.clockLabel(inst, '12h')), '12:30 PM'); assert.equal(withTz(TOK, () => S.clockLabel(inst, '24h')), '12:30')
  assert.equal(new Z.ZDate(inst).getTime(), new Date(inst).getTime())
  Z.setScheduleTz('Not/AZone'); assert.notEqual(Z.getScheduleTz(), 'Not/AZone'); Z.setScheduleTz(null)
})

test('the My Schedule form round-trips in the account timezone: 5:00 PM typed on ANY device means 5:00 PM in the account zone', () => {
  const values = { title: 'Report', date: '2026-11-13', endDate: '2026-11-13', start: '16:00', end: '17:00', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none', isDeadline: true }
  const inNy = withTz(NY, () => ({ id: 'e1', ...S.formToEventFields(values) }))
  assert.equal(inNy.endAt, Date.UTC(2026, 10, 13, 22, 0))
  const back = withTz(NY, () => S.eventToForm(inNy)); assert.deepEqual([back.date, back.end, back.start], ['2026-11-13', '17:00', '16:00'])
  // the same stored instant, opened from a device in another zone but the SAME account timezone, reads identically
  const again = withTz(NY, () => S.eventToForm({ ...inNy })); assert.deepEqual(again, back)
})

// ── deadlines: anchored date, one meaning on every device ──────────────────────────────────────────────────────────────────────────
const task = (id, extra = {}) => ({ id, text: id, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...extra })
const day = tasks => ({ productive: false, hyper: false, notes: '', journal: '', tasks })
const ev = (id, endAt, extra = {}) => ({ id, title: id, category: 'meeting', startAt: endAt - 3600000, endAt, isDeadline: true, ...extra })
const NOW = Date.UTC(2026, 10, 14, 18, 0)

test('SAME deadline, SAME account timezone => identical day, status and label no matter which device (device zone is irrelevant once the account zone is known)', () => {
  const e = ev('e1', Date.UTC(2026, 10, 13, 22, 0), { taskDateKey: '2026-11-13' })      // 5 PM New York
  const cal = { '2026-11-13': day([task('dl-e1', { sourceEventId: 'e1' })]) }
  const seen = [VAN, NY, TOK].map(device => {      // three devices; each reads the account zone (NY) from Supabase
    Z.setScheduleTz(NY)
    const it = X.buildDeadlineItems([e], cal, NY, NOW)['2026-11-13'][0]
    return [it.dayKey, it.info.label, it.dueDay, it.dateMismatch, device && it.tz]
  })
  Z.setScheduleTz(null)
  assert.deepEqual(seen[0].slice(0, 4), seen[1].slice(0, 4)); assert.deepEqual(seen[1].slice(0, 4), seen[2].slice(0, 4))
  assert.deepEqual(seen[0].slice(0, 4), ['2026-11-13', 'Overdue · 1 day', '2026-11-13', false])
})

test('ANCHORED placement: a stored assigned date wins over the day the instant implies (nothing is re-dated), and the mismatch is reported, not hidden', () => {
  // end instant = Nov 13 03:00 UTC = Nov 12 22:00 in New York, but the task was assigned to Nov 13 by a device in another zone
  const e = ev('e2', Date.UTC(2026, 10, 13, 3, 0), { taskDateKey: '2026-11-13' })
  const cal = { '2026-11-13': day([task('dl-e2', { sourceEventId: 'e2' })]) }
  Z.setScheduleTz(NY)
  const idx = X.buildDeadlineItems([e], cal, NY, NOW)
  Z.setScheduleTz(null)
  assert.deepEqual(Object.keys(idx), ['2026-11-13'])
  const it = idx['2026-11-13'][0]
  assert.deepEqual([it.dayKey, it.dueDay, it.dateMismatch], ['2026-11-13', '2026-11-12', true])
  // a deadline with no stored date uses the account-timezone day of its end
  Z.setScheduleTz(NY); const fresh = X.buildDeadlineItems([ev('e3', Date.UTC(2026, 10, 13, 3, 0))], {}, NY, NOW); Z.setScheduleTz(null)
  assert.deepEqual(Object.keys(fresh), ['2026-11-12'])
})

test('reconciliation never relocates a task; only a user edit of the deadline recomputes its day (in the account timezone)', () => {
  const cal = { '2026-11-13': day([task('dl-e4', { text: 'e4', sourceEventId: 'e4', journal: 'work', done: true, sessions: [{ id: 's', startTs: 1, endTs: 2, note: '', tags: [] }] })]) }
  const e = ev('e4', Date.UTC(2026, 10, 13, 3, 0), { taskDateKey: '2026-11-13' })      // implies Nov 12 in New York
  Z.setScheduleTz(NY)
  assert.deepEqual(L.reconcileDeadlines(cal, [e], 'a'), [], 'reconcile: nothing to do — the task stays where it is')
  const unchanged = L.planDeadlineSync(cal, 'e4', e, '2026-11-13', 'a', undefined, 'linked', false, true, true)
  assert.equal(unchanged.taskDateKey, '2026-11-13'); assert.ok(!unchanged.ops.some(o => o.kind === 'move'))
  const edited = L.planDeadlineSync(cal, 'e4', e, '2026-11-13', 'a', undefined, 'linked', false, true, false)      // the user changed the end
  Z.setScheduleTz(null)
  assert.equal(edited.taskDateKey, '2026-11-12'); assert.deepEqual(edited.ops.map(o => [o.kind, o.date_key, o.from_key]), [['move', '2026-11-12', '2026-11-13']])
})

test('a task that is missing is recreated on the day the event row records (not re-derived)', () => {
  const e = ev('e5', Date.UTC(2026, 10, 13, 3, 0), { taskDateKey: '2026-11-13' })
  Z.setScheduleTz(NY); const items = L.reconcileDeadlines({}, [e], 'a'); Z.setScheduleTz(null)
  assert.deepEqual(items[0].ops.map(o => [o.kind, o.date_key]), [['upsert', '2026-11-13']])
})

test('standalone task deadlines keep their plain date and date-only meaning (the date is what the user chose; its end-of-day is read in the account zone)', () => {
  const cal = { '2026-11-10': day([task('t1', { due: { date: '2026-11-13', time: null, dateOnly: true } })]) }
  const at = (tz, now) => X.buildDeadlineItems([], cal, tz, now)['2026-11-13'][0]
  assert.equal(at(NY, Date.UTC(2026, 10, 14, 4, 0)).info.state, 'upcoming')       // Nov 13 23:00 NY: still the 13th
  assert.equal(at(NY, Date.UTC(2026, 10, 14, 6, 0)).info.state, 'overdue')         // Nov 14 01:00 NY
  assert.equal(at(NY, NOW).dayKey, '2026-11-13'); assert.equal(at(TOK, NOW).dayKey, '2026-11-13')
})

// ── account timezone: claimed once, never overwritten ─────────────────────────────────────────────────────────────────────────────
function fakeDb(initial) {
  const state = { row: initial }          // undefined = no row; {timezone: null|string}
  const log = []
  const api = {
    from(table) {
      assert.equal(table, 'user_preferences')
      return {
        upsert: (row, opts) => { log.push(['upsert', row, opts]); if (!state.row) state.row = { timezone: row.timezone }; return Promise.resolve({ error: null }) },
        update: vals => ({ eq: () => ({ is: (col, v) => { log.push(['update', vals, col, v]); if (state.row && state.row.timezone === null) state.row.timezone = vals.timezone; return Promise.resolve({ error: null }) } }) }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.row ? { timezone: state.row.timezone } : null, error: null }) }) }),
      }
    },
  }
  return { api, state, log }
}
test('claimAccountTimezone: no row -> the first device claims; row with null -> claims; an existing zone is NEVER overwritten', async () => {
  let db = fakeDb(undefined)
  assert.equal(await CD.claimAccountTimezone(db.api, 'u1', NY), NY)
  assert.deepEqual(db.log[0].slice(1), [{ user_id: 'u1', timezone: NY }, { onConflict: 'user_id', ignoreDuplicates: true }], 'insert that ignores duplicates')
  db = fakeDb({ timezone: null }); assert.equal(await CD.claimAccountTimezone(db.api, 'u1', TOK), TOK)
  assert.deepEqual(db.log[1].slice(2), ['timezone', null], 'the update only matches rows whose timezone IS NULL')
  db = fakeDb({ timezone: VAN }); assert.equal(await CD.claimAccountTimezone(db.api, 'u1', TOK), VAN); assert.equal(db.state.row.timezone, VAN)
})

test('two devices claiming at once: exactly one wins and both end up with the same zone', async () => {
  const db = fakeDb({ timezone: null })
  const [a, b] = await Promise.all([CD.claimAccountTimezone(db.api, 'u1', TOK), CD.claimAccountTimezone(db.api, 'u1', NY)])
  assert.equal(a, b); assert.ok([TOK, NY].includes(a)); assert.equal(db.state.row.timezone, a)
})

test('a failed write surfaces as an error (the caller ignores it: nothing is claimed, nothing is overwritten)', async () => {
  const bad = { from: () => ({ upsert: () => Promise.resolve({ error: new Error('boom') }) }) }
  await assert.rejects(CD.claimAccountTimezone(bad, 'u1', NY), /boom/)
})

// ── wiring pins ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('AppContext: the claim runs after startup settles, only when the account has no zone, with a zone this device really reports; the account zone feeds zdate; focus re-reads it', () => {
  const a = read('components/xpadite/AppContext.tsx')
  assert.match(a, /setScheduleTz\(effectiveTimezone\)/)
  const settle = a.indexOf('settleStartup()     // everything that guards'), claim = a.indexOf('if (!sbPrefs?.timezone) {')
  assert.ok(settle > 0 && claim > settle, 'after the data gate opened — never part of it')
  assert.match(a, /localStorage\.getItem\('xp-timezone'\) \|\| Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone \|\| null/)
  assert.match(a, /claimAccountTimezone\(supabase, userId, mine\)/)
  assert.match(a, /document\.addEventListener\('visibilitychange', onVisible\)/)
  assert.match(a, /Date\.now\(\) - last < 60_000/)
  assert.match(a, /!!prev && prev\.endAt === ev\.endAt\)/, 'a save (and "Add back") is anchored unless the deadline END changed')
  assert.match(read('lib/supabase/core-data.ts'), /\.is\('timezone', null\)/)
})

test('Settings: "this device" sets the ACCOUNT zone explicitly (never a per-device null); reset does the same', () => {
  const s = read('components/xpadite/SettingsModal.tsx')
  assert.match(s, /setTimezone\(v === AUTO_TIMEZONE \? detectedTz : v\)/)
  assert.match(s, /setTimezone\(detectedTz\)/)
  assert.ok(!/setTimezone\(null\)/.test(s))
})

test('every schedule / deadline module builds its dates through ZDate (account timezone); no stray device-local Date construction', () => {
  for (const f of ['scheduleLogic.ts', 'scheduleEngine.ts', 'MyScheduleView.tsx', 'scheduleMonth.ts', 'MeetingsModal.tsx', 'deadlineLink.ts', 'ScheduleMiniCalendar.tsx']) {
    const src = read('components/xpadite/' + f)
    assert.ok(!/new Date\(/.test(src), `${f} still uses new Date(`)
    assert.match(src, /import \{ ZDate \} from '\.\/zdate'/, f)
  }
  assert.match(read('components/xpadite/XpaditeApp.tsx'), /const today = new ZDate\(\)/)
})

test('the removal safeguard, anchored placement and legacy-date note are all wired; migration 026 stays due-date-only', () => {
  assert.match(read('components/xpadite/DeadlineStatus.tsx'), /export function AssignedDateNote/)
  assert.match(read('components/xpadite/DayModal.tsx'), /it\.dateMismatch && <AssignedDateNote/)
  assert.match(read('components/xpadite/ScheduleParts.tsx'), /<AssignedDateRow eventId=\{ev\.id\} \/>/)
  const sql = read('supabase/migrations/026_deadline_completion.sql')
  assert.ok(!new RegExp('holi' + 'day|timezone|user_preferences', 'i').test(sql.replace(/--[^\n]*/g, '')), 'no regional-calendar / timezone / preferences change in the migration')
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(n => /^027_/.test(n)), 'no migration 027')
})

// ── regression: detaching a LEGACY-MISMATCH deadline must not change its assigned date ─────────────────────────────────────────────
test('REGRESSION detach: the assigned date survives removing the task (marker stays put) and "Add back" returns the task to that same date', () => {
  // end instant = Nov 13 03:00 UTC = Nov 12 in New York; the deadline was ASSIGNED to Nov 13 (legacy, created in another zone)
  const detached = ev('e7', Date.UTC(2026, 10, 13, 3, 0), { taskLink: 'detached', taskDateKey: '2026-11-13', completedAt: Date.UTC(2026, 10, 11, 15, 0) })
  Z.setScheduleTz(NY)
  const idx = X.buildDeadlineItems([detached], {}, NY, NOW)
  assert.deepEqual(Object.keys(idx), ['2026-11-13'], 'the marker stays on the assigned date after detaching')
  assert.equal(idx['2026-11-13'][0].dateMismatch, true)
  // had the anchor been cleared (the old behaviour) the marker would have jumped to the account-timezone day
  const cleared = X.buildDeadlineItems([{ ...detached, taskDateKey: null }], {}, NY, NOW)
  assert.deepEqual(Object.keys(cleared), ['2026-11-12'])
  // "Add back": same end => anchored => the task comes back on the recorded date, with its completion
  const back = L.planDeadlineSync({}, 'e7', { ...detached, taskLink: 'linked' }, '2026-11-13', 'a', undefined, 'linked', false, true, true)
  Z.setScheduleTz(null)
  assert.deepEqual(back.ops.map(o => [o.kind, o.date_key, o.task_id]), [['upsert', '2026-11-13', 'dl-e7']])
  assert.equal(back.taskDateKey, '2026-11-13')
})

test('REGRESSION detach: the detach keeps task_date_key through the 026 function (owner-scoped, additive); before 026 it falls back to the old behaviour', () => {
  const a = read('components/xpadite/AppContext.tsx')
  const fn = a.slice(a.indexOf('const detachDeadlineTask'), a.indexOf('const setDeadlineCompleted'))
  assert.match(fn, /const anchor = scheduleEventsRef\.current\.find\(e => e\.id === eventId\)\?\.taskDateKey \?\? null/)
  assert.match(fn, /rev = await detachScheduleTask\(client, eventId\)/)
  assert.match(fn, /if \(!\(e instanceof ScheduleSetupError\)\) throw e; rev = await setScheduleTaskLink\(client, eventId, 'detached'\); kept = null/, 'function not installed yet: the original behaviour, never a failure')
  assert.match(fn, /taskLink: 'detached', taskDateKey: kept/, 'local state keeps the date too')
  assert.match(read('lib/supabase/schedule-data.ts'), /rpc\('schedule_detach_task', \{ p_event_id: eventId \}\)/)
  const sql = read('supabase/migrations/026_deadline_completion.sql')
  const f0 = sql.slice(sql.indexOf('create or replace function public.schedule_detach_task')); const f = f0.slice(0, f0.indexOf('$$;') + 3)   // schedule_detach_task only
  assert.match(f, /set task_link = 'detached',\s+rev = rev \+ 1\s+where user_id = uid and event_id = p_event_id/)
  assert.ok(!/task_date_key/.test(f.replace(/--[^\n]*/g, '')), 'it never touches task_date_key')
  assert.match(f, /security invoker/); assert.match(sql, /revoke all on function public\.schedule_detach_task\(text\) from public, anon;/); assert.match(sql, /grant execute on function public\.schedule_detach_task\(text\) to authenticated;/)
  assert.ok(!/\b(drop|delete|truncate)\b/i.test(f.replace(/--[^\n]*/g, '')), 'schedule_detach_task stays additive')
})

// ── regression: editing a DETACHED legacy deadline ─────────────────────────────────────────────────────────────────────────────────
test('REGRESSION edit-detached (SQL): 026 re-creates schedule_apply identical to 024 except ONE line — the assigned date is no longer forced to NULL for detached events', () => {
  const fnOf = t => { const i = t.indexOf('create or replace function public.schedule_apply'); return t.slice(i, t.indexOf('$$;', i) + 3).split('\n') }
  const a = fnOf(read('supabase/migrations/024_schedule_task_sync.sql')), b = fnOf(read('supabase/migrations/026_deadline_completion.sql'))
  assert.equal(a.length, b.length, 'same function, line for line')
  const diff = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y)
  assert.equal(diff.length, 1)
  assert.match(diff[0][0], /task_date_key = case when new_link = 'detached' then null else p_event->>'task_date_key' end,/)
  assert.match(diff[0][1], /^\s+task_date_key = p_event->>'task_date_key',/)
  const sql = read('supabase/migrations/026_deadline_completion.sql')
  assert.match(sql, /grant execute on function public\.schedule_apply\(jsonb, text, integer, jsonb\) to authenticated;/)
  assert.ok(!/\b(drop|truncate)\b|\balter\s+column\b/i.test(sql.replace(/--[^\n]*/g, '')), '026 stays additive (create or replace only; no drop / truncate / column changes)')
})

test('REGRESSION edit-detached (client): end unchanged -> the stored date is sent back; end changed -> recomputed in the account timezone; non-deadlines send null', () => {
  const a = read('components/xpadite/AppContext.tsx')
  const save = a.slice(a.indexOf('const saveInner'), a.indexOf('const saveScheduleEvent'))
  assert.match(save, /const detachedKey = link === 'detached' && ev\.isDeadline \? \(prev && prev\.endAt === ev\.endAt \? \(prev\.taskDateKey \?\? null\) : dateKeyOf\(ev\.endAt\)\) : null/)
  assert.match(save, /taskDateKey: link === 'detached' \? detachedKey : plan\.taskDateKey/)
  assert.match(a, /import \{ planDeadlineSync, linkedTaskId, dateKeyOf,/)
})
