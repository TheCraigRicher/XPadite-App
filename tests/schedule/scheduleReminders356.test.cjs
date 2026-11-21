// v1.356 — My Schedule reminders: custom intervals, due-time maths (cross-midnight, DST, repeats, catch-up), the delivery job (idempotency, retries,
// concurrency, invalid devices, user isolation), request guards, and structural pins. The REAL modules are compiled and run; the database and the
// push service are replaced by small in-memory fakes. Nothing here touches production, the network or a real device.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-reminders-v1356'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const compile = (src, name) => fs.writeFileSync(path.join(OUT, name + '.js'), ts.transpileModule(read(src), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
for (const n of ['reminderDue', 'payload', 'guards', 'processor', 'send']) compile(`lib/push/${n}.ts`, n)
compile('components/xpadite/scheduleLogic.ts', 'scheduleLogic'); compile('components/xpadite/zdate.ts', 'zdate'); compile('components/xpadite/dueStatus.ts', 'dueStatus')
const D = require(path.join(OUT, 'reminderDue.js'))
const P = require(path.join(OUT, 'payload.js'))
const G = require(path.join(OUT, 'guards.js'))
const R = require(path.join(OUT, 'processor.js'))
const L = require(path.join(OUT, 'scheduleLogic.js'))

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const utc = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi)
const ev = (o = {}) => ({ eventId: 'e1', title: 'Study group', startAt: utc(2026, 11, 20, 20, 0), reminderMins: 5, recurrence: 'none', ...o })

// ═══ custom reminder UI logic ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('custom reminder: days / hours / minutes become total minutes; the readable summary matches the examples', () => {
  const ok = (d, h, m) => { const r = L.parseCustomReminder(d, h, m); assert.ok(r.ok, JSON.stringify(r)); return r.mins }
  assert.equal(ok('0', '2', '0'), 120)
  assert.equal(ok('0', '5', '0'), 300)
  assert.equal(ok('0', '11', '30'), 690)
  assert.equal(ok('1', '2', '0'), 1560)
  assert.equal(ok('2', '0', '15'), 2895)
  assert.equal(ok('', '', '45'), 45)                                       // blanks count as zero
  assert.equal(L.customReminderLabel(120), '2 hours before')
  assert.equal(L.customReminderLabel(300), '5 hours before')
  assert.equal(L.customReminderLabel(690), '11 hours 30 minutes before')
  assert.equal(L.customReminderLabel(1560), '1 day 2 hours before')
  assert.equal(L.customReminderLabel(2895), '2 days 15 minutes before')
  assert.equal(L.customReminderLabel(1), '1 minute before')
})
test('custom reminder rules: no negatives or decimals, zero is refused (use "At start time"), upper limit 100000, all presets unchanged', () => {
  for (const bad of [['-1', '0', '0'], ['0', '1.5', '0'], ['a', '0', '0'], ['0', '0', '0'], ['', '', ''], ['70', '0', '0']]) assert.equal(L.parseCustomReminder(...bad).ok, false, JSON.stringify(bad))
  assert.equal(L.parseCustomReminder('69', '10', '40').ok, true)            // 99,... ≤ 100000
  assert.equal(L.parseCustomReminder('0', '0', '100000').ok, true)
  assert.equal(L.parseCustomReminder('0', '0', '100001').ok, false)
  assert.deepEqual(L.REMINDER_OPTIONS.map(o => o.value), [null, 0, 5, 10, 15, 30, 60, 1440])
  assert.equal(L.reminderLabel(5), '5 minutes before'); assert.equal(L.reminderLabel(60), '1 hour before'); assert.equal(L.reminderLabel(1440), '1 day before'); assert.equal(L.reminderLabel(0), 'At start time')
  assert.equal(L.reminderLabel(null), null)
  assert.equal(L.reminderLabel(690), '11 hours 30 minutes before')          // saved custom values read back readably
  assert.deepEqual(L.splitReminderMinutes(690), { days: 0, hours: 11, minutes: 30 })
  assert.equal(L.isPresetReminder(30), true); assert.equal(L.isPresetReminder(690), false); assert.equal(L.isPresetReminder(null), true)
})
test('the form validator rejects an out-of-range reminder but accepts every legacy value', () => {
  const base = L.emptyFormValues ? L.emptyFormValues('2026-11-20', '15:00') : null
  const v = { title: 'x', category: 'meeting', date: '2026-11-20', start: '15:00', end: '16:00', endDate: '', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none', isDeadline: false }
  assert.equal(L.validateScheduleForm({ ...v, reminderMins: 690 }).reminder, undefined)
  assert.equal(L.validateScheduleForm({ ...v, reminderMins: 0 }).reminder, undefined)
  assert.ok(L.validateScheduleForm({ ...v, reminderMins: 100001 }).reminder)
  assert.ok(L.validateScheduleForm({ ...v, reminderMins: -5 }).reminder)
  void base
})

// ═══ due-time maths ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a 5-minute reminder for a 3:00 PM event fires at 2:55 PM — not before, and within the window after', () => {
  const start = utc(2026, 11, 20, 20, 0)                                    // 3:00 PM EST = 20:00Z
  const e = ev({ startAt: start, reminderMins: 5 })
  assert.equal(D.dueReminders([e], start - 5 * MIN - 1, 'America/Toronto').length, 0)
  const d = D.dueReminders([e], start - 5 * MIN, 'America/Toronto')
  assert.equal(d.length, 1); assert.equal(d[0].fireAt, start - 5 * MIN); assert.equal(d[0].occurrenceAt, start)
  assert.equal(D.dueReminders([e], start - 5 * MIN + 29 * MIN, 'America/Toronto').length, 1)        // late by 29 min: still delivered (catch-up)
  assert.equal(D.dueReminders([e], start - 5 * MIN + 31 * MIN, 'America/Toronto').length, 0)        // late by 31 min: dropped, never replayed
})
test('custom 2 h, 5 h and 11 h 30 min reminders fire exactly that long before', () => {
  const start = utc(2026, 11, 20, 20, 0)
  for (const mins of [120, 300, 690, 1560]) {
    const e = ev({ startAt: start, reminderMins: mins })
    const fire = start - mins * MIN
    assert.equal(D.dueReminders([e], fire - 1, 'UTC').length, 0, `${mins} early`)
    assert.equal(D.dueReminders([e], fire, 'UTC')[0].fireAt, fire, `${mins} on time`)
  }
})
test('reminders crossing midnight (and a year boundary) are plain minute arithmetic', () => {
  const start = utc(2027, 1, 1, 0, 30)                                      // 12:30 AM New Year's Day UTC
  const e = ev({ startAt: start, reminderMins: 60 })
  assert.equal(D.dueReminders([e], utc(2026, 12, 31, 23, 30), 'UTC').length, 1)
  assert.equal(D.dueReminders([e], utc(2026, 12, 31, 23, 29), 'UTC').length, 0)
})
test('daylight saving: a one-off reminder is exact minutes; a daily repeat keeps its LOCAL time across the change', () => {
  // Toronto: DST starts Sun Mar 8 2026 at 2:00 AM (clocks jump to 3:00). Event 7:00 AM EST Mar 7 = 12:00Z.
  const start = utc(2026, 3, 7, 12, 0)
  const daily = ev({ startAt: start, recurrence: 'daily', reminderMins: 30 })
  assert.equal(D.occurrenceStart(daily, 0, 'America/Toronto'), start)
  assert.equal(D.occurrenceStart(daily, 1, 'America/Toronto'), utc(2026, 3, 8, 11, 0))   // 7:00 AM EDT is 11:00Z — one real hour earlier
  const d = D.dueReminders([daily], utc(2026, 3, 8, 11, 0) - 30 * MIN, 'America/Toronto')
  assert.equal(d.length, 1); assert.equal(d[0].occurrenceAt, utc(2026, 3, 8, 11, 0))
  // fall back: Nov 1 2026 (clocks back at 2:00 AM)
  const w = ev({ startAt: utc(2026, 10, 25, 12, 0), recurrence: 'weekly' })               // 8:00 AM EDT
  assert.equal(D.occurrenceStart(w, 1, 'America/Toronto'), utc(2026, 11, 1, 13, 0))      // 8:00 AM EST = 13:00Z
  // one-off across the spring jump: still exactly N minutes
  const one = ev({ startAt: utc(2026, 3, 8, 7, 30), reminderMins: 120 })
  assert.equal(D.dueReminders([one], utc(2026, 3, 8, 5, 30), 'America/Toronto')[0].fireAt, utc(2026, 3, 8, 5, 30))
})
test('repeating events: daily / weekly / monthly occurrences, month-end clamping, and no reminders before the series starts', () => {
  const m = ev({ startAt: utc(2026, 1, 31, 15, 0), recurrence: 'monthly' })
  assert.equal(D.occurrenceStart(m, 1, 'UTC'), utc(2026, 2, 28, 15, 0))
  assert.equal(D.occurrenceStart(m, 2, 'UTC'), utc(2026, 3, 31, 15, 0))
  assert.equal(D.occurrenceStart(m, 13, 'UTC'), utc(2027, 2, 28, 15, 0))
  const w = ev({ startAt: utc(2026, 11, 20, 20, 0), recurrence: 'weekly', reminderMins: 10 })
  const later = utc(2026, 12, 11, 20, 0) - 10 * MIN                                        // 3 weeks later
  const hit = D.dueReminders([w], later, 'UTC')
  assert.equal(hit.length, 1); assert.equal(hit[0].occurrenceAt, utc(2026, 12, 11, 20, 0))
  assert.equal(D.dueReminders([w], utc(2026, 11, 13, 20, 0) - 10 * MIN, 'UTC').length, 0)   // a week BEFORE the series began
  assert.equal(D.dueReminders([w], utc(2026, 11, 22, 12, 0), 'UTC').length, 0)              // between occurrences
  const mo = D.dueReminders([m], utc(2026, 2, 28, 15, 0) - 5 * MIN, 'UTC')
  assert.equal(mo.length, 1); assert.equal(mo[0].occurrenceAt, utc(2026, 2, 28, 15, 0))        // 5-min reminder fires at 14:55 for the clamped (28th) occurrence
  assert.equal(D.dueReminders([m], utc(2026, 2, 28, 14, 40), 'UTC').length, 0)
})
test('after a long outage a repeating event yields only the occurrences inside the catch-up window (no flood)', () => {
  const d = ev({ startAt: utc(2026, 1, 1, 9, 0), recurrence: 'daily', reminderMins: 15 })
  const now = utc(2026, 11, 20, 9, 0) - 15 * MIN + 10 * MIN                                 // 10 min after today's fire time, 323 days after the first
  const hits = D.dueReminders([d], now, 'UTC')
  assert.equal(hits.length, 1); assert.equal(hits[0].occurrenceAt, utc(2026, 11, 20, 9, 0))
  assert.equal(D.dueReminders([d], now + 2 * HOUR, 'UTC').length, 0)
})
test('no reminder, invalid minutes or a broken start produce nothing', () => {
  assert.equal(D.dueReminders([ev({ reminderMins: null })], utc(2026, 11, 20, 20, 0), 'UTC').length, 0)
  assert.equal(D.dueReminders([ev({ reminderMins: -5 })], utc(2026, 11, 20, 20, 0), 'UTC').length, 0)
  assert.equal(D.dueReminders([ev({ reminderMins: 100001 })], utc(2026, 11, 20, 20, 0), 'UTC').length, 0)
  assert.equal(D.dueReminders([ev({ reminderMins: 5.5 })], utc(2026, 11, 20, 20, 0), 'UTC').length, 0)
  assert.equal(D.dueReminders([ev({ startAt: NaN })], utc(2026, 11, 20, 20, 0), 'UTC').length, 0)
  assert.equal(D.dueReminders([ev({ reminderMins: 0 })], utc(2026, 11, 20, 20, 0), 'UTC').length, 1)   // "At start time" is valid
  assert.equal(D.dueReminders([ev()], utc(2026, 11, 20, 19, 55), 'Not/AZone').length, 1)                // a bad timezone falls back to UTC, never throws
})

// ═══ notification content ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('payload: title, time in the account timezone, stable per-occurrence tag, tap target, nothing sensitive', () => {
  const due = D.dueReminders([ev()], utc(2026, 11, 20, 19, 55), 'America/Toronto')[0]
  const p = P.buildReminderPayload(due, 'America/Toronto')
  assert.match(p.title, /Study group/); assert.match(p.body, /Starts in 5 minutes/); assert.match(p.body, /3:00 PM/); assert.match(p.body, /Fri, Nov 20/)
  assert.equal(p.url, `/app?remind=e1&at=${utc(2026, 11, 20, 20, 0)}`)
  assert.equal(P.buildReminderPayload(due, 'America/Toronto').tag, p.tag)                    // stable → a repeat replaces, never stacks
  const other = P.buildReminderPayload({ ...due, occurrenceAt: due.occurrenceAt + DAY }, 'America/Toronto')
  assert.notEqual(other.tag, p.tag)
  assert.ok(P.topicOf(p).length <= 32 && /^[A-Za-z0-9_-]+$/.test(P.topicOf(p)))
  assert.deepEqual(Object.keys(p).sort(), ['body', 'eventId', 'kind', 'occurrenceAt', 'tag', 'title', 'url'])
  assert.equal(P.leadText(690), 'in 11 hours 30 minutes'); assert.equal(P.leadText(1560), 'in 1 day 2 hours'); assert.equal(P.leadText(0), 'now')
  assert.equal(P.buildReminderPayload({ ...due, minsBefore: 0 }, 'UTC').body.startsWith('Starting now'), true)
})

// ═══ request guards ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('scheduler auth: header only, constant-time, FAILS CLOSED without a configured secret', () => {
  const S = 'x'.repeat(40)
  assert.equal(G.isCronAuthorized(`Bearer ${S}`, S), true)
  assert.equal(G.isCronAuthorized(`Bearer ${S}x`, S), false)
  assert.equal(G.isCronAuthorized(`Bearer wrong`, S), false)
  assert.equal(G.isCronAuthorized(S, S), false)                                              // must be a Bearer header
  assert.equal(G.isCronAuthorized(null, S), false)
  assert.equal(G.isCronAuthorized(`Bearer ${S}`, undefined), false)                          // unset secret: nothing is authorised
  assert.equal(G.isCronAuthorized(`Bearer short`, 'short'), false)                           // too-short secrets are refused too
})
test('push endpoints: only the real browser push services over https; no internal hosts, ports, credentials or junk', () => {
  const ok = ['https://fcm.googleapis.com/fcm/send/abc123def456ghi789', 'https://updates.push.services.mozilla.com/wpush/v2/abcdefghij123456', 'https://web.push.apple.com/QAbcdefghijklmnop12', 'https://wns2-par02p.notify.windows.com/w/?token=abcdefgh', 'https://us.push.apple.com/abcdefghijklmnopq123']
  const bad = ['http://fcm.googleapis.com/fcm/send/abc123def456ghi789', 'https://evil.example.com/push/abcdefghijklmnop', 'https://127.0.0.1/abcdefghijklmnopq', 'https://fcm.googleapis.com.evil.com/abcdefghijklm', 'https://user:pw@fcm.googleapis.com/fcm/send/abcdefghijk', 'https://fcm.googleapis.com:8443/fcm/send/abcdefghij', 'javascript:alert(1)//abcdefghijklmnop', '', 5, null, 'https://fcm.googleapis.com/' + 'a'.repeat(2100)]
  for (const u of ok) assert.equal(G.isAllowedPushEndpoint(u), true, u)
  for (const u of bad) assert.equal(G.isAllowedPushEndpoint(u), false, String(u).slice(0, 60))
})
test('subscription bodies are validated; malformed keys are refused', () => {
  const good = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123def456ghi789', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } }
  assert.deepEqual(G.parseSubscription(good), { endpoint: good.subscription.endpoint, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) })
  for (const b of [null, {}, { subscription: {} }, { subscription: { ...good.subscription, keys: { p256dh: 'short', auth: 'a'.repeat(22) } } }, { subscription: { ...good.subscription, keys: { p256dh: 'B'.repeat(87), auth: '<script>' } } }, { subscription: { ...good.subscription, endpoint: 'https://evil.com/xxxxxxxxxxxxxxxxxxxx' } }]) assert.equal(G.parseSubscription(b), null)
  assert.equal(G.MAX_DEVICES_PER_USER, 10)
})

// ═══ the delivery job (in-memory database) ══════════════════════════════════════════════════════════════════════════════════════════════════
function fakeDb(seed) {
  const t = { reminder_deliveries: [], push_subscriptions: [...seed.subs], user_preferences: [...(seed.prefs ?? [])] }
  let n = 0
  const cand = seed.candidates
  const builder = (table, op) => {
    const st = { table, op, filters: [], patch: null, row: null, opts: null }
    const rows = () => (table === 'schedule_events' ? (seed.events ?? cand({})) : t[table]).filter(r => st.filters.every(f => f(r)))
    const b = {
      select(cols) { st.sel = cols; return b },
      eq(c, v) { st.filters.push(r => r[c] === v); return b },
      in(c, v) { st.filters.push(r => v.includes(r[c])); return b },
      lt(c, v) { st.filters.push(r => r[c] < v); return b },
      gte(c, v) { st.filters.push(r => r[c] >= v); return b },
      async maybeSingle() { const r = rows(); return { data: r[0] ?? null, error: null } },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    function run() {
      if (op === 'select') return { data: rows().map(r => ({ ...r })), error: null }
      if (op === 'delete') { const kill = new Set(rows()); t[table] = t[table].filter(r => !kill.has(r)); if (table === 'push_subscriptions') t.reminder_deliveries = t.reminder_deliveries.filter(d => ![...kill].some(k => k.id === d.subscription_id)); return { error: null } }
      if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, st.patch)); return { data: hit.map(r => ({ id: r.id })), error: null } }
      if (op === 'upsert') {
        const keyCols = st.opts.onConflict.split(',')
        const dup = t[table].find(r => keyCols.every(c => r[c] === st.row[c]))
        if (dup) return { data: [], error: null }
        const row = { id: `d${++n}`, created_at: st.row.claimed_at ?? new Date().toISOString(), ...st.row }; t[table].push(row); return { data: [{ id: row.id }], error: null }
      }
    }
    return { b, st }
  }
  const db = {
    t,
    seed,
    rpc: async (name, args) => (seed.rpcError ? { data: null, error: { message: 'x' } } : { data: cand(args), error: null }),
    from(table) {
      return {
        select(c) { const { b } = builder(table, 'select'); return b.select(c) },
        delete() { const x = builder(table, 'delete'); return x.b },
        update(p) { const x = builder(table, 'update'); x.st.patch = p; return x.b },
        upsert(row, opts) { const x = builder(table, 'upsert'); x.st.row = row; x.st.opts = opts; return x.b },
      }
    },
  }
  return db
}
const sub = (id, user, extra = {}) => ({ id, user_id: user, endpoint: `https://fcm.googleapis.com/fcm/send/${id}xxxxxxxxxxxx`, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22), ...extra })
const row = (user, id, startAt, mins, extra = {}) => ({ user_id: user, event_id: id, title: id, start_at: new Date(startAt).toISOString(), reminder_mins: mins, recurrence: 'none', ...extra })
const NOW = utc(2026, 11, 20, 19, 55)
const START = utc(2026, 11, 20, 20, 0)
const okSend = () => { const calls = []; const f = async (s, p) => { calls.push({ sub: s.id, tag: p.tag }); return { ok: true } }; f.calls = calls; return f }

test('job: a due reminder is delivered once to EACH of the user\'s devices; running again (or twice at once) never repeats it', async () => {
  const db = fakeDb({ subs: [sub('s1', 'A'), sub('s2', 'A')], candidates: () => [row('A', 'e1', START, 5)] })
  const send = okSend()
  const r1 = await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.equal(r1.sent, 2); assert.deepEqual(send.calls.map(c => c.sub).sort(), ['s1', 's2'])
  assert.ok(db.t.reminder_deliveries.every(d => d.status === 'sent' && d.accepted_at))
  const r2 = await R.runScheduleReminders({ admin: db, send, now: NOW + 20_000 })
  assert.equal(r2.sent, 0); assert.equal(send.calls.length, 2)
  // two scheduler runs racing on a fresh database
  const db2 = fakeDb({ subs: [sub('s1', 'A'), sub('s2', 'A')], candidates: () => [row('A', 'e1', START, 5)] })
  const send2 = okSend()
  await Promise.all([R.runScheduleReminders({ admin: db2, send: send2, now: NOW }), R.runScheduleReminders({ admin: db2, send: send2, now: NOW })])
  assert.equal(send2.calls.length, 2, 'each device exactly once')
  assert.equal(db2.t.reminder_deliveries.length, 2)
})
test('job: a failed attempt does NOT suppress the reminder — it is retried after the lease, up to the attempt budget, then left alone', async () => {
  const db = fakeDb({ subs: [sub('s1', 'A')], candidates: () => [row('A', 'e1', START, 5)] })
  let fail = true; const calls = []
  const send = async (s) => { calls.push(1); return fail ? { ok: false, gone: false, status: 503, code: 'server' } : { ok: true } }
  const r1 = await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.equal(r1.failed, 1); assert.equal(db.t.reminder_deliveries[0].status, 'failed'); assert.equal(db.t.reminder_deliveries[0].last_error, 'server')
  const r2 = await R.runScheduleReminders({ admin: db, send, now: NOW + 30_000 })
  assert.equal(calls.length, 1, 'inside the lease: no hammering')
  fail = false
  const r3 = await R.runScheduleReminders({ admin: db, send, now: NOW + R.RETRY_LEASE_MS + 1000 })
  assert.equal(r3.sent, 1); assert.equal(db.t.reminder_deliveries[0].status, 'sent'); assert.equal(db.t.reminder_deliveries[0].attempts, 2)
  void r2
  // always failing: stops after MAX_ATTEMPTS
  const db3 = fakeDb({ subs: [sub('s1', 'A')], candidates: () => [row('A', 'e1', START, 5)] })
  let c3 = 0; const bad = async () => { c3++; return { ok: false, gone: false, status: 500, code: 'server' } }
  for (let i = 0; i < 10; i++) await R.runScheduleReminders({ admin: db3, send: bad, now: NOW + i * (R.RETRY_LEASE_MS + 1000) })
  assert.equal(c3, R.MAX_ATTEMPTS)
})
test('job: an expired device (404/410) is removed with its delivery rows; the user\'s other devices still get the reminder', async () => {
  const db = fakeDb({ subs: [sub('dead', 'A'), sub('live', 'A')], candidates: () => [row('A', 'e1', START, 5)] })
  const send = async (s) => (s.id === 'dead' ? { ok: false, gone: true, status: 410, code: 'gone' } : { ok: true })
  const r = await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.equal(r.removedSubscriptions, 1); assert.equal(r.sent, 1)
  assert.deepEqual(db.t.push_subscriptions.map(s => s.id), ['live'])
  assert.ok(db.t.reminder_deliveries.every(d => d.subscription_id === 'live'))
})
test('job: reminders go ONLY to the owner\'s devices — never to another account', async () => {
  const db = fakeDb({ subs: [sub('a1', 'A'), sub('b1', 'B')], candidates: () => [row('A', 'e1', START, 5)] })
  const send = okSend(); await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.deepEqual(send.calls.map(c => c.sub), ['a1'])
  const db2 = fakeDb({ subs: [sub('b1', 'B')], candidates: () => [row('A', 'e1', START, 5)] })
  const send2 = okSend(); const r = await R.runScheduleReminders({ admin: db2, send: send2, now: NOW })
  assert.equal(send2.calls.length, 0); assert.equal(r.skipped, 1)                                    // A has no device: nothing is sent to B
})
test('job: edited / deleted events — only what the database returns is considered; a re-timed event is a NEW occurrence', async () => {
  let rows = [row('A', 'e1', START, 5)]
  const db = fakeDb({ subs: [sub('s1', 'A')], candidates: () => rows })
  const send = okSend()
  rows = []                                                                                         // event deleted before it was due
  assert.equal((await R.runScheduleReminders({ admin: db, send, now: NOW })).sent, 0)
  rows = [row('A', 'e1', START, 5)]; await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.equal(send.calls.length, 1)
  const moved = START + 2 * HOUR; rows = [row('A', 'e1', moved, 5)]                                  // user moved it two hours later
  await R.runScheduleReminders({ admin: db, send, now: moved - 5 * MIN })
  assert.equal(send.calls.length, 2); assert.notEqual(send.calls[0].tag, send.calls[1].tag)
})
test('job: repeating events are expanded in the account timezone; one delivery per occurrence; an outage never floods', async () => {
  const daily = row('A', 'rep', utc(2026, 11, 1, 14, 0), 10, { recurrence: 'daily' })
  const db = fakeDb({ subs: [sub('s1', 'A')], prefs: [{ user_id: 'A', timezone: 'America/Toronto' }], candidates: () => [daily] })
  const send = okSend()
  const occ = utc(2026, 11, 20, 14, 0)
  await R.runScheduleReminders({ admin: db, send, now: occ - 10 * MIN })
  await R.runScheduleReminders({ admin: db, send, now: occ - 9 * MIN })                              // next minute: same occurrence, not repeated
  assert.equal(send.calls.length, 1)
  await R.runScheduleReminders({ admin: db, send, now: occ + 3 * DAY + 5 * HOUR })                    // back after a 3-day outage: nothing older than the window is replayed
  assert.equal(send.calls.length, 1)
  await R.runScheduleReminders({ admin: db, send, now: occ + DAY - 10 * MIN + 2 * MIN })             // next day's reminder, 2 min late: delivered
  assert.equal(send.calls.length, 2)
})
test('job: no subscribed device skips quietly; a database failure raises a fixed, secret-free error', async () => {
  const db = fakeDb({ subs: [], candidates: () => [row('A', 'e1', START, 5)] })
  const send = okSend(); const r = await R.runScheduleReminders({ admin: db, send, now: NOW })
  assert.equal(r.sent, 0); assert.equal(r.skipped, 1); assert.equal(send.calls.length, 0)
  await assert.rejects(() => R.runScheduleReminders({ admin: fakeDb({ subs: [], rpcError: true, candidates: () => [] }), send, now: NOW }), /^Error: candidates_failed$/)
})
test('sender: push-service answers map to fixed result codes; the private key is never part of a result', async () => {
  const web = require('web-push')
  const keys = web.generateVAPIDKeys()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = 'mailto:test@example.com'
  const S = require(path.join(OUT, 'send.js'))
  const orig = web.sendNotification
  const sender = S.makeSender(); assert.equal(typeof sender, 'function')
  const s = { id: 'x', endpoint: 'https://fcm.googleapis.com/fcm/send/abcdefghij123456', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
  const p = P.buildTestPayload()
  const seen = []
  try {
    web.sendNotification = async (_s, body, opts) => { seen.push(opts); return { statusCode: 201 } }
    assert.deepEqual(await sender(s, p), { ok: true }); assert.equal(seen[0].TTL, S.PUSH_TTL_SECONDS); assert.equal(seen[0].urgency, 'high')
    for (const [status, code, gone] of [[410, 'gone', true], [404, 'gone', true], [429, 'rate_limited', false], [401, 'rejected', false], [503, 'server', false]]) {
      web.sendNotification = async () => { const e = new Error('boom ' + keys.privateKey); e.statusCode = status; throw e }
      const r = await sender(s, p); assert.equal(r.code, code); assert.equal(r.gone, gone); assert.ok(!JSON.stringify(r).includes(keys.privateKey))
    }
    web.sendNotification = async () => { throw new Error('ECONNRESET') }
    assert.equal((await sender(s, p)).code, 'network')
  } finally { web.sendNotification = orig }
  delete process.env.VAPID_PRIVATE_KEY
  assert.equal(S.makeSender(), null)                                                                // not configured → null, never a crash
  process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = 'ftp://nope'
  assert.equal(S.makeSender(), null)
})

// ═══ structural pins ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
test('migration 027 is additive and locked down: RLS on, no client policies, no client grants, service-role-only function', () => {
  const sql = read('supabase/migrations/027_schedule_reminders_push.sql')
  assert.ok(!/drop table|alter table public\.schedule_events|alter table public\.user_preferences/i.test(sql), 'additive only')
  for (const tbl of ['push_subscriptions', 'reminder_deliveries']) {
    assert.match(sql, new RegExp(`alter table public\\.${tbl} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${tbl} from anon, authenticated`))
  }
  assert.ok(!/create policy/i.test(sql), 'the browser gets no policy at all')
  assert.match(sql, /unique \(user_id, event_id, occurrence_at, subscription_id\)/)
  assert.match(sql, /create unique index if not exists push_subscriptions_endpoint_key/)
  assert.match(sql, /security definer\nset search_path = public/)
  assert.match(sql, /revoke all on function public\.schedule_reminder_candidates\(timestamptz, timestamptz\) from public, anon, authenticated;\ngrant execute on function public\.schedule_reminder_candidates\(timestamptz, timestamptz\) to service_role;/)
  assert.match(sql, /status\s+text\s+not null default 'pending' check \(status in \('pending','sent','failed','gone','expired'\)\)/)
})
test('routes: the scheduler route is header-only and fails closed; user routes take the user from the session; no secret is exposed', () => {
  const run = read('app/api/schedule-reminders/run/route.ts')
  assert.match(run, /isCronAuthorized\(req\.headers\.get\('authorization'\), process\.env\.CRON_SECRET\)/)
  assert.ok(!/searchParams|x-cron-secret/.test(run), 'no secret in the URL')
  for (const f of ['app/api/push/subscribe/route.ts', 'app/api/push/test/route.ts']) {
    const s = read(f)
    assert.match(s, /auth\.getUser\(\)/); assert.match(s, /Unauthorized/)
    assert.ok(!/body\.user_?[iI]d|user_id: *body|\.user_id\b.*req/.test(s), 'the user id is never taken from the request')
  }
  const sub = read('app/api/push/subscribe/route.ts')
  assert.match(sub, /parseSubscription\(body\)/); assert.match(sub, /\.eq\('user_id', user\.id\)\.eq\('endpoint', body\.endpoint\)/)
  const all = ['app/api/schedule-reminders/run/route.ts', 'app/api/push/subscribe/route.ts', 'app/api/push/test/route.ts', 'lib/push/send.ts', 'lib/push/client.ts', 'lib/push/processor.ts'].map(read).join('\n')
  assert.ok(!/console\.(log|error)\([^)]*(PRIVATE|privateKey|CRON_SECRET)/.test(all), 'secrets are never logged')
  assert.ok(!/VAPID_PRIVATE_KEY/.test(read('lib/push/client.ts')) && !/VAPID_PRIVATE_KEY/.test(read('components/xpadite/ScheduleReminderAlerts.tsx')), 'the private key never reaches client code')
})
test('no key material is committed anywhere in the repo sources or docs', () => {
  const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', '.next', '.git'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])
  for (const f of [...walk('lib'), ...walk('app'), ...walk('docs'), ...walk('supabase'), 'public/sw.js']) {
    if (!/\.(ts|tsx|md|sql|js)$/.test(f)) continue
    assert.ok(!/VAPID_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{30,}/.test(read(f)), f)
    assert.ok(!/[A-Za-z0-9_-]{43}(?=['"`]?\s*$)/m.test(read(f).split('\n').filter(l => /PRIVATE/i.test(l)).join('\n')), f)
  }
})
test('service worker: push + notification-click handlers added; the online-first cache and offline page behaviour are untouched', () => {
  const sw = read('public/sw.js')
  assert.match(sw, /self\.addEventListener\('push'/); assert.match(sw, /self\.addEventListener\('notificationclick'/)
  assert.match(sw, /silent: false/); assert.match(sw, /tag: typeof data\.tag/); assert.match(sw, /requireInteraction: true/)
  assert.match(sw, /icon: '\/icons\/icon-192\.png'/)
  assert.match(sw, /const CACHE = 'xpadite-pwa-v2'/); assert.match(sw, /if \(req\.mode !== 'navigate' \|\| req\.method !== 'GET'\) return/)
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(sw, /data\.kind !== 'test'/)                                                         // a test push is always shown
  assert.match(sw, /\(CriOS\|FxiOS\|EdgiOS\)/)                                                       // iOS browsers always show a notification
})
test('UI: three equal cards, a visible scrollbar on every card body, Custom reminder option, Reminders & sound menu + Test Reminder Sound, bell indicator', () => {
  const v = read('components/xpadite/MyScheduleView.tsx')
  assert.match(v, /grow=\{1\} minHeight=\{96\} testId="card-upcoming"/); assert.match(v, /grow=\{1\} minHeight=\{96\} testId="card-selected"/); assert.match(v, /grow=\{1\} minHeight=\{96\} testId="card-categories"/)
  assert.ok(!/maxHeight="42%"/.test(v)); assert.match(v, /scrollbarWidth: 'thin', scrollbarColor:/); assert.match(v, /overscrollBehavior: 'contain'/)
  assert.match(v, /<aside className="hidden lg:flex flex-col gap-3 w-\[296px\]/)                      // same sidebar, same gap, same breakpoint
  const p = read('components/xpadite/ScheduleParts.tsx')
  assert.match(p, /<option value="__custom">Custom reminder…<\/option>/); assert.match(p, /data-testid="custom-reminder"/)
  assert.match(read('components/xpadite/ScheduleMenu.tsx'), /Reminders &amp; sound/)
  const d = read('components/xpadite/ScheduleDialogs.tsx')
  assert.match(d, /Test Reminder Sound/); assert.match(d, /Enable reminders/); assert.match(d, /Hearing the chime only proves sound works while XPadite is open/)
  assert.match(d, /onClick=\{\(\) => \{ void onEnable\(\) \}\}/)                                      // permission is asked only from the button's click
  assert.equal((read('components/xpadite/ScheduleMonthGrid.tsx').match(/<ReminderBell/g) || []).length, 1)
  assert.ok(!/requestPermission/.test(read('components/xpadite/ScheduleReminderAlerts.tsx')) && !/requestPermission/.test(read('components/xpadite/XpaditeApp.tsx').slice(read('components/xpadite/XpaditeApp.tsx').indexOf('ScheduleReminderAlerts'))), 'no permission prompt on load')
})
test('sound: one shared context unlocked on the first interaction; failures are reported, never silent', () => {
  const s = read('lib/audio/reminderSound.ts')
  assert.match(s, /export type SoundResult = 'played' \| 'blocked' \| 'unsupported'/)
  assert.match(s, /\['pointerdown', 'touchend', 'keydown'\]/); assert.match(s, /return 'blocked'/)
  const a = read('components/xpadite/ScheduleReminderAlerts.tsx')
  assert.match(a, /seenRef\.current\[key\]\) return/)                                                // an alert (and its chime) happens once per event occurrence
  assert.match(a, /soundBlocked/); assert.match(a, /role="alert"/); assert.ok(!/\.focus\(\)/.test(a), 'never steals focus')
})

// ═══ retry pass, expiry, multi-device, repeats ═══════════════════════════════════════════════════════════════════════════════════════════════
const T0 = utc(2026, 11, 20, 12, 0)
const failing = (code = 'server') => async () => ({ ok: false, gone: false, status: 503, code })
test('retry: a failed delivery is retried AFTER the 30-minute catch-up window while the event is still ahead, and is then marked sent (never sent twice)', async () => {
  const rows = [row('A', 'e1', T0 + 2 * HOUR, 120)]                                              // reminder 2 h before: fire time = T0
  const db = fakeDb({ subs: [sub('s1', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? rows : []), events: rows })
  const r1 = await R.runScheduleReminders({ admin: db, send: failing(), now: T0 })
  assert.equal(r1.failed, 1); assert.equal(db.t.reminder_deliveries[0].status, 'failed')
  const send = okSend()
  const later = T0 + 45 * MIN                                                                    // 45 min after: the first pass no longer returns it
  const r2 = await R.runScheduleReminders({ admin: db, send, now: later })
  assert.equal(r2.candidates, 0); assert.equal(r2.retried, 1); assert.equal(r2.sent, 1); assert.equal(send.calls.length, 1)
  assert.equal(db.t.reminder_deliveries[0].status, 'sent'); assert.equal(db.t.reminder_deliveries[0].attempts, 2)
  await R.runScheduleReminders({ admin: db, send, now: later + 5 * MIN })
  assert.equal(send.calls.length, 1, 'accepted deliveries are never sent again')
})
test('retry expiry: too old (2 h) or the event has already started → marked expired and never sent; a flood of ancient failures is ignored', async () => {
  const early = [row('A', 'e1', T0 + DAY, 1440)]                                                  // fire time T0, event a day away
  const db = fakeDb({ subs: [sub('s1', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? early : []), events: early })
  await R.runScheduleReminders({ admin: db, send: failing(), now: T0 })
  const send = okSend()
  const r = await R.runScheduleReminders({ admin: db, send, now: T0 + R.RETRY_EXPIRY_MS + 3 * MIN })
  assert.equal(send.calls.length, 0); assert.equal(db.t.reminder_deliveries[0].status, 'failed'); assert.equal(r.expired, 0)   // older than 2 h: simply no longer looked at (pruned after a week), never sent
  // the event starts, the reminder was failing the whole time
  const soon = [row('A', 'e2', T0 + 20 * MIN, 20)]
  const db2 = fakeDb({ subs: [sub('s1', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? soon : []), events: soon })
  await R.runScheduleReminders({ admin: db2, send: failing(), now: T0 })
  const send2 = okSend(); await R.runScheduleReminders({ admin: db2, send: send2, now: T0 + 20 * MIN + 6 * MIN })
  assert.equal(send2.calls.length, 0); assert.equal(db2.t.reminder_deliveries[0].status, 'expired')
  // 40 old failed rows from last week produce nothing
  const db3 = fakeDb({ subs: [sub('s1', 'A')], candidates: () => [], events: [] })
  for (let i = 0; i < 40; i++) db3.t.reminder_deliveries.push({ id: 'old' + i, user_id: 'A', event_id: 'e' + i, occurrence_at: new Date(T0 - 7 * DAY).toISOString(), subscription_id: 's1', status: 'failed', attempts: 1, claimed_at: new Date(T0 - 7 * DAY).toISOString(), created_at: new Date(T0 - 7 * DAY).toISOString() })
  const send3 = okSend(); await R.runScheduleReminders({ admin: db3, send: send3, now: T0 })
  assert.equal(send3.calls.length, 0)
})
test('retry: an EDITED event (moved or reminder changed) or a DELETED one never delivers the outdated reminder', async () => {
  const orig = row('A', 'e1', T0 + 2 * HOUR, 120)
  const mk = events => fakeDb({ subs: [sub('s1', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? [orig] : []), events })
  for (const [label, after] of [['moved a day later', [row('A', 'e1', T0 + DAY, 120)]], ['reminder changed to 10 min', [row('A', 'e1', T0 + 2 * HOUR, 10)]], ['reminder removed', [row('A', 'e1', T0 + 2 * HOUR, null)]], ['deleted', []]]) {
    const db = mk([orig]); await R.runScheduleReminders({ admin: db, send: failing(), now: T0 })
    db.seed.events = after
    const send = okSend(); await R.runScheduleReminders({ admin: db, send, now: T0 + 45 * MIN })
    assert.equal(send.calls.length, 0, label); assert.equal(db.t.reminder_deliveries[0].status, 'expired', label)
  }
})
test('retry: each device is independent — one failing device is retried alone, the other is never sent twice; a removed device is simply skipped', async () => {
  const rows = [row('A', 'e1', T0 + 2 * HOUR, 120)]
  const db = fakeDb({ subs: [sub('ok1', 'A'), sub('bad', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? rows : []), events: rows })
  const calls = []; let badFails = true
  const send = async (s) => { calls.push(s.id); return s.id === 'bad' && badFails ? { ok: false, gone: false, status: 500, code: 'server' } : { ok: true } }
  await R.runScheduleReminders({ admin: db, send, now: T0 })
  badFails = false
  await R.runScheduleReminders({ admin: db, send, now: T0 + 45 * MIN })
  assert.deepEqual(calls.filter(c => c === 'ok1'), ['ok1']); assert.deepEqual(calls.filter(c => c === 'bad'), ['bad', 'bad'])
  assert.deepEqual(db.t.reminder_deliveries.map(d => [d.subscription_id, d.status]).sort(), [['bad', 'sent'], ['ok1', 'sent']])
  // device removed between attempts
  const db2 = fakeDb({ subs: [sub('bad', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? rows : []), events: rows })
  await R.runScheduleReminders({ admin: db2, send: failing(), now: T0 })
  db2.t.push_subscriptions = []
  const s2 = okSend(); await R.runScheduleReminders({ admin: db2, send: s2, now: T0 + 45 * MIN })
  assert.equal(s2.calls.length, 0)
})
test('retry: two scheduler runs racing on the same retry send it once', async () => {
  const rows = [row('A', 'e1', T0 + 2 * HOUR, 120)]
  const db = fakeDb({ subs: [sub('s1', 'A')], candidates: ({ p_lo }) => (Date.parse(p_lo) <= T0 ? rows : []), events: rows })
  await R.runScheduleReminders({ admin: db, send: failing(), now: T0 })
  const send = okSend()
  await Promise.all([R.runScheduleReminders({ admin: db, send, now: T0 + 45 * MIN }), R.runScheduleReminders({ admin: db, send, now: T0 + 45 * MIN })])
  assert.equal(send.calls.length, 1)
})
test('repeating events: the notification names the repeat ("↻ Repeats weekly") and the occurrence date; the details can show the next occurrence', () => {
  const weekly = ev({ startAt: utc(2026, 11, 13, 20, 0), recurrence: 'weekly', reminderMins: 5 })
  const due = D.dueReminders([weekly], utc(2026, 11, 27, 19, 55), 'America/Toronto')[0]
  assert.equal(due.recurrence, 'weekly')
  const p = P.buildReminderPayload(due, 'America/Toronto')
  assert.match(p.body, /Fri, Nov 27 · 3:00 PM/); assert.match(p.body, /↻ Repeats weekly/)
  assert.ok(!/Repeats/.test(P.buildReminderPayload(D.dueReminders([ev()], utc(2026, 11, 20, 19, 55), 'UTC')[0], 'UTC').body), 'one-off events say nothing about repeating')
  assert.equal(D.nextOccurrence(weekly, utc(2026, 11, 14, 0, 0), 'America/Toronto'), utc(2026, 11, 20, 20, 0))
  assert.equal(D.nextOccurrence(weekly, utc(2026, 11, 13, 20, 0), 'America/Toronto'), utc(2026, 11, 13, 20, 0))
  assert.equal(D.nextOccurrence(ev(), utc(2027, 1, 1), 'UTC'), null)
  assert.equal(D.nextOccurrence(ev({ recurrence: 'monthly', startAt: utc(2026, 1, 31, 9, 0) }), utc(2026, 2, 1, 0, 0), 'UTC'), utc(2026, 2, 28, 9, 0))
  assert.equal(D.nextOccurrence(ev({ recurrence: 'daily', startAt: utc(2026, 1, 1, 9, 0) }), utc(2026, 11, 20, 9, 1), 'UTC'), utc(2026, 11, 21, 9, 0))
})
test('migration 027 (v1.356 final): expired status, delivery rows follow the event, retry index; client alerts dedupe across tabs and chime once', () => {
  const sql = read('supabase/migrations/027_schedule_reminders_push.sql')
  assert.match(sql, /status in \('pending','sent','failed','gone','expired'\)/)
  assert.match(sql, /foreign key \(user_id, event_id\) references public\.schedule_events \(user_id, event_id\) on delete cascade/)
  assert.match(sql, /reminder_deliveries_unfinished_idx[\s\S]*where status in \('pending','failed'\)/)
  const a = read('components/xpadite/ScheduleReminderAlerts.tsx')
  assert.match(a, /seenRef\.current = \{ \.\.\.loadSeen\(\), \.\.\.\(seenRef\.current \?\? \{\}\) \}/)     // re-reads what other tabs alerted
  assert.match(a, /if \(now - lastChimeAt < CHIME_GAP_MS\) return/)
  assert.match(a, /hidden && now - d\.fireAt < HIDDEN_TAB_DELAY_MS/)
  assert.match(a, /if \(document\.visibilityState === 'visible'\) go\(\); else window\.setTimeout\(go, HIDDEN_TAB_DELAY_MS\)/)
})
test('details: a repeating event shows its next occurrence from the shared recurrence maths (no second recurrence system)', () => {
  const p = read('components/xpadite/ScheduleParts.tsx')
  assert.match(p, /import \{ nextOccurrence \} from '@\/lib\/push\/reminderDue'/)
  assert.match(p, /\{repeat\}\{nextRepeat \? ` · next \$\{nextRepeat\}` : ''\}/)
  assert.ok(!/addRecurrence|expandRecurr|function .*[Rr]ecurrence.*expand/.test(read('components/xpadite/scheduleLogic.ts') + read('components/xpadite/scheduleEngine.ts')), 'the calendar still shows one occurrence — no second expansion engine was added')
})
