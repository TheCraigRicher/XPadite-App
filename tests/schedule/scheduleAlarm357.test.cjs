// v1.357 — Persistent Alarm. The REAL modules are compiled and run with a fake AudioContext and fake timers (node:test mock timers); the database part runs the
// real migration 028 on PGlite (real PostgreSQL engine) when it is installed. NOTHING here is a physical-device test: no real speaker, browser autoplay policy,
// OS notification, battery/doze behaviour or push service is involved. Those are listed for manual testing in the v1.357 report.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-alarm-v1357'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const compile = (src, name) => fs.writeFileSync(path.join(OUT, name + '.js'), ts.transpileModule(read(src), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  .replace(/require\("@\/components\/xpadite\/([A-Za-z]+)"\)/g, 'require("./$1")').replace(/require\("@\/lib\/push\/([A-Za-z]+)"\)/g, 'require("./$1")'))
compile('lib/audio/reminderSound.ts', 'reminderSound'); compile('lib/audio/alarmSound.ts', 'alarmSound'); compile('lib/audio/alarmManager.ts', 'alarmManager')
compile('components/xpadite/scheduleLogic.ts', 'scheduleLogic'); compile('components/xpadite/zdate.ts', 'zdate'); compile('components/xpadite/dueStatus.ts', 'dueStatus')
compile('lib/push/reminderDue.ts', 'reminderDue'); compile('lib/supabase/schedule-data.ts', 'schedule-data')
const SND = require(path.join(OUT, 'reminderSound.js'))
let ALM = require(path.join(OUT, 'alarmSound.js'))
const MGR = require(path.join(OUT, 'alarmManager.js'))
const L = require(path.join(OUT, 'scheduleLogic.js'))
const SD = require(path.join(OUT, 'schedule-data.js'))
const D = require(path.join(OUT, 'reminderDue.js'))

const MIN = 60_000
// ── a fake Web Audio: counts oscillators, remembers which are still sounding ────────────────────────────────────────────────────────────────
function installFakeAudio(initial = 'running', t) {
  ALM.stopAlarmSound()
  for (const n of ['reminderSound', 'alarmSound']) delete require.cache[require.resolve(path.join(OUT, n + '.js'))]
  ALM = require(path.join(OUT, 'alarmSound.js'))
  if (t) t.after(() => { ALM.stopAlarmSound(); delete global.window })
  const ctx = { state: initial, currentTime: 0, oscs: [], gains: [], resumed: 0, destination: { id: 'dest' },
    resume() { this.resumed++; return new Promise(r => { if (this.allow) this.state = 'running'; r() }) },
    createGain() { const g = { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connected: new Set(), connect(n) { this.connected.add(n); return n }, disconnect() { this.connected.clear() } }; ctx.gains.push(g); return g },
    createOscillator() { const o = { type: '', frequency: { setValueAtTime() {} }, started: false, stopped: false, connected: new Set(), onended: null, connect(n) { this.connected.add(n); return n }, disconnect() { this.connected.clear() }, start() { this.started = true }, stop(when) { if (when === undefined) this.stopped = true } }; ctx.oscs.push(o); return o },
    allow: false }
  global.window = { AudioContext: function () { return ctx } }
  return ctx
}
const sounding = ctx => ctx.oscs.filter(o => o.started && !o.stopped).length
// the module keeps one shared AudioContext: each test starts from a clean slate

function fakeAudio() {
  const a = { starts: [], stops: 0, ringing: false, result: 'played', start(until) { a.starts.push(until); return Promise.resolve(a.result).then(r => { if (r === 'played') a.ringing = true; return r }) }, stop() { a.stops++; a.ringing = false }, isSounding() { return a.ringing } }
  return a
}
const input = (o = {}) => ({ key: 'e1|1000', eventId: 'e1', occurrenceAt: 1000 + 5 * MIN, fireAt: 1000, eventStartAt: 1000 + 5 * MIN, reminderMins: 5, recurrence: 'none', ...o })

// ═══ the alarm sound ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('alarm sound: repeats a three-beep pattern every cycle, from ONE stream, until stopped', async t => {
  const ctx = installFakeAudio('running', t); t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 })
  assert.equal(await ALM.startAlarmSound(1_000_000 + 5 * MIN), 'played')
  assert.equal(ctx.oscs.length, 3, 'first cycle plays immediately')
  t.mock.timers.tick(ALM.ALARM_CYCLE_MS); assert.equal(ctx.oscs.length, 6, 'it repeats')
  t.mock.timers.tick(ALM.ALARM_CYCLE_MS * 3); assert.equal(ctx.oscs.length, 15)
  assert.equal(await ALM.startAlarmSound(1_000_000 + 5 * MIN), 'played')    // a second start does NOT create a second stream
  t.mock.timers.tick(ALM.ALARM_CYCLE_MS); assert.equal(ctx.oscs.length, 18, 'still exactly three beeps per cycle')
  assert.equal(ctx.gains.length, 1 + 18, 'one master gain (+ one per beep)')
  ALM.stopAlarmSound()
})
test('Stop silences immediately: every live beep is stopped, the graph disconnected, the timer cleared, and nothing restarts', async t => {
  const ctx = installFakeAudio('running', t); t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 })
  await ALM.startAlarmSound(1_000_000 + 5 * MIN)
  assert.equal(sounding(ctx), 3); assert.equal(ALM.isAlarmSounding(), true)
  ALM.stopAlarmSound()
  assert.equal(sounding(ctx), 0, 'all oscillators stopped at once'); assert.equal(ALM.isAlarmSounding(), false)
  assert.ok(ctx.oscs.every(o => o.connected.size === 0), 'all disconnected (resources released)')
  assert.ok(ctx.gains[0].connected.size === 0, 'the master gain is detached from the speakers')
  const n = ctx.oscs.length; t.mock.timers.tick(ALM.ALARM_CYCLE_MS * 10); assert.equal(ctx.oscs.length, n, 'no further beeps after stop')
  ALM.stopAlarmSound(); ALM.stopAlarmSound()                                // idempotent
})
test('the sound cannot overrun its deadline even if the timer is late: the next cycle past the deadline stops it', async t => {
  const ctx = installFakeAudio('running', t); t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 })
  await ALM.startAlarmSound(1_000_000 + 10_000)
  t.mock.timers.tick(ALM.ALARM_CYCLE_MS * 8)                                // 14.4 s passes
  assert.equal(ALM.isAlarmSounding(), false); assert.equal(sounding(ctx), 0)
})
test('autoplay refused: the browser context stays suspended → "blocked" (never a silent success); unsupported browsers are reported too', async t => {
  const ctx = installFakeAudio('suspended', t); t.mock.timers.enable({ apis: ['setInterval', 'Date', 'setTimeout'], now: 1_000_000 })
  const p = ALM.startAlarmSound(1_000_000 + MIN); t.mock.timers.tick(600)
  assert.equal(await p, 'blocked'); assert.equal(ctx.oscs.length, 0); assert.equal(ALM.isAlarmSounding(), false)
})

// ═══ the lifecycle manager (fake timers + fake audio) ═══════════════════════════════════════════════════════════════════════════════════════
const mk = (t, o = {}, enable = true) => { if (enable) t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 }); const audio = fakeAudio(); const ends = [], changes = []; const m = MGR.createAlarmManager({ audio, onEnd: (k, r) => ends.push([k, r]), onChange: l => changes.push(l.map(x => x.key)), ...o }); return { audio, ends, changes, m } }
test('rings until Stop; Stop is immediate and releases the audio and the timer', async t => {
  const { audio, ends, m } = mk(t)
  assert.equal(await m.start(input()), 'started'); assert.equal(audio.ringing, true); assert.equal(m.active().length, 1)
  t.mock.timers.tick(60_000); assert.equal(audio.ringing, true, 'still ringing a minute later')
  m.stop('e1|1000'); assert.equal(audio.ringing, false); assert.equal(m.active().length, 0); assert.deepEqual(ends, [['e1|1000', 'stopped']])
  t.mock.timers.tick(10 * 60_000); assert.equal(audio.starts.length, 1, 'never restarts'); assert.equal(audio.ringing, false)
})
test('automatic cutoff: stops at 5 minutes after it came due (±1 s tick), once, with no restart afterwards', async t => {
  const { audio, ends, m } = mk(t)
  await m.start(input())
  t.mock.timers.tick(5 * MIN - 2000); assert.equal(audio.ringing, true, 'still ringing just before 5 minutes')
  t.mock.timers.tick(2000); assert.equal(audio.ringing, false, 'silent at 5 minutes'); assert.deepEqual(ends, [['e1|1000', 'timeout']])
  assert.equal(m.active().length, 0)
  t.mock.timers.tick(30 * 60_000); assert.equal(audio.starts.length, 1); assert.equal(ends.length, 1, 'no second ring cycle, no second end')
  assert.equal(await m.start(input()), 'expired', 'even if asked again for that occurrence, the five minutes are over')
})
test('the five minutes run from when the reminder came due: reopened 2 min late → rings 3 min; reopened 6 min late → silent', async t => {
  const { audio, ends, m } = mk(t)
  t.mock.timers.tick(2 * MIN)                                                // now = fireAt + 2 min
  assert.equal(await m.start(input()), 'started'); t.mock.timers.tick(3 * MIN - 1500); assert.equal(audio.ringing, true)
  t.mock.timers.tick(1500); assert.equal(audio.ringing, false); assert.deepEqual(ends, [['e1|1000', 'timeout']])
  t.mock.timers.tick(10 * MIN)                                               // now ≈ fireAt + 15 min
  const startsBefore = audio.starts.length
  assert.equal(await m.start(input({ key: 'old|1', fireAt: 1000 })), 'expired'); assert.equal(audio.starts.length, startsBefore, 'an expired alarm never touches the audio'); assert.equal(audio.ringing, false)
})
test('several alarms due together: one audio stream, each cut off on its own schedule, sound ends with the LAST', async t => {
  const { audio, ends, m } = mk(t)
  await m.start(input({ key: 'a|1', eventId: 'a', fireAt: 1000 })); await m.start(input({ key: 'c|1', eventId: 'c', fireAt: 1000 }))
  t.mock.timers.tick(MIN); await m.start(input({ key: 'b|1', eventId: 'b', fireAt: 1000 + MIN }))        // b comes due a minute later
  assert.equal(m.active().length, 3); assert.equal(audio.ringing, true); assert.equal(audio.stops, 0)
  m.stop('c|1'); assert.equal(audio.ringing, true, 'others still ring'); assert.equal(m.active().length, 2)
  t.mock.timers.tick(4 * MIN); assert.deepEqual(ends.map(e => e[0]), ['c|1', 'a|1'], 'a timed out at +5, b still has 1 minute'); assert.equal(audio.ringing, true)
  t.mock.timers.tick(MIN); assert.equal(audio.ringing, false); assert.equal(m.active().length, 0)
  const m2 = mk(t, {}, false); await m2.m.start(input({ key: 'x|1' })); await m2.m.start(input({ key: 'y|1', eventId: 'y' })); m2.m.stopAll(); assert.equal(m2.audio.ringing, false); assert.equal(m2.m.active().length, 0)
})
test('duplicate triggers (repeated push, second raise, scheduler retry) never start a second alarm', async t => {
  const { audio, m } = mk(t)
  assert.equal(await m.start(input()), 'started'); assert.equal(await m.start(input()), 'duplicate'); assert.equal(await m.start(input()), 'duplicate')
  assert.equal(m.active().length, 1); assert.equal(audio.starts.length, 1)
})
test('browser blocks sound: the alarm stays visible and flagged, and starts ringing by itself once audio is allowed (within its 5 minutes)', async t => {
  const { audio, m, changes } = mk(t); audio.result = 'blocked'
  await m.start(input()); assert.equal(m.active()[0].blocked, true, 'flagged for the UI'); assert.equal(audio.ringing, false)
  t.mock.timers.tick(3000); await Promise.resolve(); assert.equal(m.active()[0].blocked, true, 'still blocked, retried quietly')
  audio.result = 'played'; t.mock.timers.tick(1000); await new Promise(r => setImmediate(r)); await Promise.resolve()
  assert.equal(audio.ringing, true); assert.equal(m.active()[0].blocked, false); assert.ok(changes.length >= 2)
})
test('stopped while the browser was still deciding: the sound that then begins is released at once', async t => {
  const { audio, m } = mk(t)
  let release; audio.start = () => new Promise(r => { release = () => { audio.ringing = true; r('played') } })
  const p = m.start(input()); m.stop('e1|1000'); release(); await p
  assert.equal(audio.ringing, false, 'nothing is left ringing')
})
test('event deleted / cancelled / switched to Standard / re-timed / reminder changed → its alarm stops; an untouched event keeps ringing', async t => {
  const same = { startAt: 1000 + 5 * MIN, reminderMins: 5, recurrence: 'none', reminderAlarm: true }
  const cases = [['deleted', () => null, true], ['cancelled', () => ({ ...same, isCancelled: true }), true], ['standard', () => ({ ...same, reminderAlarm: false }), true], ['moved', () => ({ ...same, startAt: same.startAt + MIN }), true],
    ['reminder changed', () => ({ ...same, reminderMins: 10 }), true], ['repeat changed', () => ({ ...same, recurrence: 'daily' }), true], ['untouched', () => same, false]]
  let first = true
  for (const [name, cur, stops] of cases) {
    const { audio, ends, m } = mk(t, {}, first); first = false; await m.start(input()); m.reconcile(() => cur())
    assert.equal(audio.ringing, !stops, name); assert.deepEqual(ends.map(e => e[1]), stops ? ['changed'] : [], name)
  }
})
test('unmount / dispose releases the sound and the timer; nothing keeps ticking', async t => {
  const { audio, m } = mk(t); await m.start(input()); await m.start(input({ key: 'z|1', eventId: 'z' }))
  m.dispose(); assert.equal(audio.ringing, false); assert.equal(m.active().length, 0)
  const n = audio.starts.length; t.mock.timers.tick(10 * MIN); assert.equal(audio.starts.length, n)
})

// ═══ persistence: form ↔ event ↔ database row (backward compatible) ═════════════════════════════════════════════════════════════════════════
const base = { title: 'Lecture', date: '2026-11-20', endDate: '2026-11-20', start: '10:00', end: '11:00', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: 5, recurrence: 'none' }
test('Reminder Type round-trips: form → event → row → event → form; default is Standard', () => {
  const alarm = L.formToEventFields({ ...base, reminderAlarm: true }); assert.equal(alarm.reminderAlarm, true)
  assert.equal(L.formToEventFields({ ...base }).reminderAlarm, undefined, 'untouched = Standard'); assert.equal(L.formToEventFields({ ...base, reminderAlarm: false }).reminderAlarm, undefined)
  const row = SD.eventToRow('u1', { id: 'e1', ...alarm }); assert.equal(row.reminder_alarm, true); assert.equal(row.reminder_mins, 5)
  const back = SD.rowToEvent({ ...row, rev: 1 }); assert.equal(back.reminderAlarm, true); assert.equal(L.eventToForm(back).reminderAlarm, true)
  assert.equal(L.eventToForm({ id: 'x', title: 't', category: 'meeting', startAt: 1, endAt: 2, reminderMins: 5 }).reminderAlarm, false)
})
test('no reminder ⇒ never an alarm (form, row and read paths all agree)', () => {
  assert.equal(L.formToEventFields({ ...base, reminderMins: null, reminderAlarm: true }).reminderAlarm, undefined)
  assert.equal(SD.eventToRow('u1', { id: 'e', title: 't', category: 'meeting', startAt: 1, endAt: 2, reminderMins: null, reminderAlarm: true }).reminder_alarm, false)
  assert.equal(SD.rowToEvent({ event_id: 'e', title: 't', category: 'meeting', start_at: new Date(1).toISOString(), end_at: new Date(2).toISOString(), reminder_mins: null, reminder_alarm: true, recurrence: 'none', is_deadline: false, task_date_key: null }).reminderAlarm, undefined)
})
test('backward compatibility: rows from before v1.357 (no reminder_alarm column / value) read as Standard Reminders', () => {
  const old = { event_id: 'e', title: 't', category: 'meeting', start_at: new Date(1).toISOString(), end_at: new Date(2).toISOString(), reminder_mins: 15, recurrence: 'weekly', is_deadline: false, task_date_key: null }
  assert.equal(SD.rowToEvent(old).reminderAlarm, undefined); assert.equal(SD.rowToEvent({ ...old, reminder_alarm: false }).reminderAlarm, undefined); assert.equal(SD.rowToEvent({ ...old, reminder_alarm: null }).reminderAlarm, undefined)
  assert.equal(SD.rowToEvent({ ...old, reminder_alarm: true }).reminderAlarm, true)
})
test('recurring events keep their type on every occurrence (the type is a property of the event, never of the repeat)', () => {
  for (const rec of ['daily', 'weekly', 'monthly']) {
    const e = { id: 'r', ...L.formToEventFields({ ...base, recurrence: rec, reminderAlarm: true }) }
    const back = SD.rowToEvent({ ...SD.eventToRow('u', e), rev: 1 }); assert.equal(back.reminderAlarm, true); assert.equal(back.recurrence, rec)
    const due = D.dueReminders([{ eventId: 'r', title: 't', startAt: e.startAt, reminderMins: 5, recurrence: rec }], e.startAt + 2 * 86400e3 * (rec === 'monthly' ? 15 : 1) - 5 * MIN + 1000, 'UTC', 5 * MIN)
    assert.ok(Array.isArray(due))                                            // the reminder maths itself is the unchanged v1.356 function
  }
})
test('loading an event list from a database WITHOUT the new column falls back column by column and still returns every event', async () => {
  const calls = []
  const mkSb = failing => ({ from: () => ({ select: cols => ({ eq: () => ({ order: async () => { calls.push(cols); const miss = failing.find(c => cols.includes(c)); return miss ? { data: null, error: { code: '42703', message: `column "${miss}" does not exist` } } : { data: [{ event_id: 'e', title: 't', category: 'meeting', start_at: new Date(1).toISOString(), end_at: new Date(2).toISOString(), reminder_mins: 5, recurrence: 'none', is_deadline: false, task_date_key: null }], error: null } } }) }) }) })
  const a = await SD.fetchScheduleEvents(mkSb(['reminder_alarm']), 'u'); assert.equal(a.length, 1); assert.equal(calls.length, 2)
  calls.length = 0; const b = await SD.fetchScheduleEvents(mkSb(['reminder_alarm', 'completed_at']), 'u'); assert.equal(b.length, 1); assert.equal(calls.length, 3)
  calls.length = 0; const c = await SD.fetchScheduleEvents(mkSb([]), 'u'); assert.equal(c.length, 1); assert.equal(calls.length, 1)
})

// ═══ structural pins: Standard Reminder and the delivery pipeline are untouched ════════════════════════════════════════════════════════════════
test('Standard Reminder path is unchanged (single chime, 4 s gap, dedupe) and the Persistent Alarm path never chimes', () => {
  const a = read('components/xpadite/ScheduleReminderAlerts.tsx')
  assert.match(a, /if \(now - lastChimeAt < CHIME_GAP_MS\) return/); assert.match(a, /void playReminderChime\(\)/); assert.match(a, /if \(seenRef\.current\[key\]\) return/)
  assert.match(a, /const IN_APP_WINDOW_MS = 5 \* 60_000/); assert.match(a, /HIDDEN_TAB_DELAY_MS = 20_000/)
  assert.match(a, /if \(isAlarm && ev\) \{[\s\S]*?return\n    \}/, 'alarm branch returns before the chime code')
  assert.match(a, /an alarm is ringing: never layer a chime over it/)
  assert.match(a, /m\.dispose\(\); alarmsRef\.current = null/, 'unmount releases the alarm')
  assert.match(a, /data-testid="alarm-stop"/); assert.match(a, /Stop Alarm/); assert.match(a, /data-testid="alarm-stop-all"/)
  assert.equal(SND.CHIME_NOTES.length, 3)
})
test('the server delivery pipeline, service worker and push payload are untouched by v1.357 (closed-app behaviour = v1.356)', () => {
  for (const f of ['lib/push/processor.ts', 'lib/push/payload.ts', 'lib/push/send.ts', 'lib/push/reminderDue.ts', 'public/sw.js', 'supabase/migrations/027_schedule_reminders_push.sql', 'app/api/schedule-reminders/run/route.ts']) {
    const src = read(f); assert.doesNotMatch(src, /reminder_alarm|reminderAlarm|alarmManager|alarmSound/, f)
  }
  assert.doesNotMatch(read('lib/push/payload.ts'), /repeat.*alarm/i)
})
test('the form shows Reminder Type only while a reminder is chosen, keeps Reminder and Repeat as they were, and is a compact one-line control', () => {
  const s = read('components/xpadite/ScheduleParts.tsx')
  assert.match(s, /\{v\.reminderMins !== null && \(\n\s+<div data-testid="reminder-type"/)
  assert.match(s, /label="Reminder \(optional\)"/); assert.match(s, /label="Repeat \(optional\)"/); assert.match(s, /id="sch-repeat" value=\{v\.recurrence\}/)
  assert.match(s, /set\('reminderAlarm', val\)/); assert.match(s, /Persistent Alarm/); assert.match(s, /flex items-center gap-x-2 gap-y-1 flex-wrap -mt-1/)
})
test('migration 027 is untouched; migration 028 is additive (one column, default false) and does not touch the scheduler tables', () => {
  const m = read('supabase/migrations/028_reminder_alarm.sql')
  assert.match(m, /add column if not exists reminder_alarm boolean not null default false/)
  assert.doesNotMatch(m.replace(/--.*$/gm, ''), /push_subscriptions|reminder_deliveries|schedule_reminder_candidates|cron\.|vault\./)
  assert.doesNotMatch(m.replace(/--.*$/gm, ''), /\bdrop (table|column)|truncate/i)
})

// ═══ migration 028 on a real PostgreSQL engine ═══════════════════════════════════════════════════════════════════════════════════════════════
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) { if (!p) continue; try { PGlite = require(p).PGlite; break } catch {} }
const SKIP = PGlite ? false : 'PGlite not installed (npm i --no-save @electric-sql/pglite) — SQL tests skipped, NOT passed'
const mig = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')
const A = '11111111-1111-1111-1111-111111111111'
const j = o => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`
const evj = (o = {}) => ({ event_id: 'e1', title: 'Lecture', category: 'meeting', start_at: '2026-11-20T20:00:00Z', end_at: '2026-11-20T21:00:00Z', reminder_mins: 5, recurrence: 'none', ...o })
test('028 on real Postgres: applies twice; existing rows become Standard; a v1.356-style save keeps the stored value; v1.357 saves set it; no reminder ⇒ false', { skip: SKIP }, async () => {
  const d = new PGlite()
  await d.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; insert into auth.users values ('${A}');
    grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
  await d.exec(/create or replace function public\.handle_updated_at\(\)[\s\S]*?\$\$;/.exec(mig('002_reminders.sql'))[0])
  for (const f of ['004_core_data_tables.sql', '022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql', '026_deadline_completion.sql']) await d.exec(mig(f))
  // a pre-existing (v1.356-era) event, saved through the 026 function
  await d.exec(`set request.jwt.claim.sub = '${A}'; set role authenticated`)
  await d.query(`select public.schedule_apply(${j(evj({ event_id: 'old', reminder_mins: 15 }))}, null, null, null)`)
  await d.exec('reset role')
  await d.exec(mig('027_schedule_reminders_push.sql')); await d.exec(mig('028_reminder_alarm.sql')); await d.exec(mig('028_reminder_alarm.sql'))
  const get = async id => (await d.query(`select reminder_mins, reminder_alarm from public.schedule_events where event_id='${id}'`)).rows[0]
  assert.deepEqual(await get('old'), { reminder_mins: 15, reminder_alarm: false }, 'existing event = Standard')
  const apply = async (o, expected = null) => { await d.exec(`set request.jwt.claim.sub = '${A}'; set role authenticated`); try { return (await d.query(`select public.schedule_apply(${j(o)}, null, ${expected}, null) r`)).rows[0].r } finally { await d.exec('reset role') } }
  const r1 = await apply(evj({ event_id: 'a1', reminder_alarm: true })); assert.deepEqual(await get('a1'), { reminder_mins: 5, reminder_alarm: true }, 'new alarm event')
  await apply(evj({ event_id: 'a1', title: 'Renamed (old app: no reminder_alarm key)' }), r1.rev); assert.deepEqual(await get('a1'), { reminder_mins: 5, reminder_alarm: true }, 'an older app version cannot silently reset it')
  await apply(evj({ event_id: 'a1', reminder_alarm: false }), r1.rev + 1); assert.deepEqual(await get('a1'), { reminder_mins: 5, reminder_alarm: false }, 'switched back to Standard')
  await apply(evj({ event_id: 'a1', reminder_alarm: true }), r1.rev + 2); assert.equal((await get('a1')).reminder_alarm, true)
  await apply(evj({ event_id: 'a1', reminder_mins: null, reminder_alarm: true }), r1.rev + 3); assert.deepEqual(await get('a1'), { reminder_mins: null, reminder_alarm: false }, 'no reminder ⇒ never an alarm')
  await apply(evj({ event_id: 'a2', reminder_mins: null, reminder_alarm: true })); assert.equal((await get('a2')).reminder_alarm, false)
  await apply(evj({ event_id: 'a3', recurrence: 'weekly', reminder_alarm: true })); assert.deepEqual(await get('a3'), { reminder_mins: 5, reminder_alarm: true }, 'recurring')
  // the scheduler's candidate function and the privileges are unchanged
  const cols = (await d.query(`select pg_get_function_result(p.oid) r from pg_proc p where proname='schedule_reminder_candidates'`)).rows[0].r
  assert.match(cols, /user_id uuid, event_id text, title text, start_at timestamp with time zone, reminder_mins integer, recurrence text/); assert.doesNotMatch(cols, /alarm/)
  const priv = (await d.query(`select has_function_privilege('authenticated','public.schedule_apply(jsonb,text,integer,jsonb)','execute') a, has_function_privilege('anon','public.schedule_apply(jsonb,text,integer,jsonb)','execute') b, has_function_privilege('authenticated','public.schedule_reminder_candidates(timestamptz,timestamptz)','execute') c`)).rows[0]
  assert.deepEqual(priv, { a: true, b: false, c: false })
  await d.close()
})

// ═══ due time and cutoff for every lead time, one-off and recurring (v1.357 verification) ═════════════════════════════════════════════════════
test('Persistent Alarm: due time = occurrence − lead and the 5 minutes run from THAT time, for 0/5/10/15/60/1440/2895-minute leads and one-off, daily, weekly, monthly events (incl. across a DST change)', async t => {
  const TZ = 'America/New_York'
  const startOf = (y, m, d, h) => Date.UTC(y, m - 1, d, h)                   // 2026-03-07 is just before the US spring-forward on 03-08
  const cases = []
  for (const rec of ['none', 'daily', 'weekly', 'monthly']) for (const mins of [0, 5, 10, 15, 60, 1440, 2895]) cases.push([rec, mins])
  const src = read('components/xpadite/ScheduleReminderAlerts.tsx')
  assert.match(src, /fireAt: occurrenceAt - minsBefore \* 60_000/, 'the component derives the alarm due time from the occurrence and the lead, exactly as the reminder maths does')
  for (const [rec, mins] of cases) {
    const e = { eventId: 'e', title: 't', startAt: rec === 'none' ? startOf(2026, 3, 9, 15) : startOf(2026, 3, 1, 15), reminderMins: mins, recurrence: rec }
    // look for the first occurrence on/after 2026-03-07 and ask the real reminder function when it is due
    const probeFrom = startOf(2026, 3, 6, 0)
    let found = null
    for (let h = 0; h < 24 * 70 && !found; h++) {
      const now = probeFrom + h * 3600_000
      const due = D.dueReminders([e], now, TZ, 3600_000).filter(d => d.occurrenceAt >= probeFrom)
      if (due.length) found = due[0]
    }
    assert.ok(found, `${rec}/${mins}: a due reminder is found`)
    assert.equal(found.fireAt, found.occurrenceAt - mins * MIN, `${rec}/${mins}: fireAt = occurrence − lead`)
    assert.equal(found.minsBefore, mins)
    // the manager, started a little after it came due, ends exactly 5 minutes after fireAt
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: found.fireAt + 90_000 })
    const audio = fakeAudio(), ends = []; const m = MGR.createAlarmManager({ audio, onEnd: (k, r) => ends.push([k, r, Date.now()]) })
    await m.start({ key: `e|${found.occurrenceAt}`, eventId: 'e', occurrenceAt: found.occurrenceAt, fireAt: found.occurrenceAt - found.minsBefore * 60_000, eventStartAt: e.startAt, reminderMins: mins, recurrence: rec })
    assert.equal(m.active()[0].endsAt, found.fireAt + 5 * MIN, `${rec}/${mins}: ends 5 min after the DUE time, not after the event or the alert`)
    t.mock.timers.tick(5 * MIN - 90_000 - 1000); assert.equal(audio.ringing, true, `${rec}/${mins}: still ringing 1 s before the cutoff`)
    t.mock.timers.tick(1000); assert.equal(audio.ringing, false, `${rec}/${mins}: silent at the cutoff`)
    assert.equal(ends.length, 1); assert.equal(ends[0][1], 'timeout')
    m.dispose(); t.mock.timers.reset()
  }
})
