// REAL-POSTGRES tests of migrations 022 + 023 (tables, RLS, the atomic schedule_apply function, two-user isolation).
//
// IMPORTANT — what this is and is not: these run the actual migration SQL on a genuine Postgres engine (PGlite, PostgreSQL in
// WebAssembly) with Row Level Security enforced and two simulated signed-in users. It is NOT Supabase: PostgREST, GoTrue,
// real JWTs and the hosted project's own configuration are not involved (auth.uid() is stubbed to read a session setting).
// The Supabase-side checks are in supabase/validation/023_schedule_validation.md.
//
// PGlite is NOT a project dependency. To run these:  npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder
// whose node_modules contains it). Without it every test here is skipped (reported as skipped, never as passed).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) {
  if (!p) continue
  try { PGlite = require(p).PGlite; break } catch {}
}
const SKIP = PGlite ? false : 'PGlite not installed (npm i --no-save @electric-sql/pglite) — SQL tests skipped, NOT passed'
const mig = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let db
async function boot() {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${A}'), ('${B}');
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;   -- Supabase's default; 023 must revoke what it needs to
  `)
  const fn = /create or replace function public\.handle_updated_at\(\)[\s\S]*?\$\$;/.exec(mig('002_reminders.sql'))[0]
  await d.exec(fn)
  for (const f of ['004_core_data_tables.sql', '022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql']) await d.exec(mig(f))
  return d
}
const as = async (uid, fn) => {                       // run `fn` as a signed-in user (RLS on), then drop back to superuser
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`) }
}
const q = (sql, params) => db.query(sql, params)
const ev = (id, over = {}) => ({ event_id: id, title: 'Report', category: 'assignment', start_at: '2026-11-24T21:00:00Z', end_at: '2026-11-25T00:00:00Z', location: null, meeting_url: null, notes: null, reminder_mins: null, recurrence: 'none', is_deadline: true, task_date_key: '2026-11-24', ...over })
const task = (id, over = {}) => ({ id, text: 'Report', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], sourceEventId: id.slice(3), ...over })
const up = (eid, key, text = 'Report') => ({ kind: 'upsert', date_key: key, task_id: 'dl-' + eid, event_id: eid, task: task('dl-' + eid, { text }) })
const apply = (event, del, rev, ops) => q('select public.schedule_apply($1::jsonb, $2, $3, $4::jsonb) as r', [event && JSON.stringify(event), del, rev, JSON.stringify(ops)]).then(r => r.rows[0].r)
const day = async (uid, key) => (await q('select day_data from calendar_days where user_id = $1 and date_key = $2', [uid, key])).rows[0]?.day_data
const setDay = (uid, key, doc) => q('insert into calendar_days (user_id, date_key, day_data) values ($1, $2, $3::jsonb) on conflict (user_id, date_key) do update set day_data = excluded.day_data', [uid, key, JSON.stringify(doc)])
const fails = async (p, re) => { try { await p } catch (e) { assert.match(String(e.message) + ' ' + (e.code || ''), re); return } assert.fail('expected an error matching ' + re) }
const reset = async () => { await db.exec('reset role; truncate schedule_events, calendar_days, user_preferences') }

test('migrations apply in order on a fresh database, and re-applying 022 and 023 is harmless', { skip: SKIP }, async () => {
  db = await boot()
  for (const f of ['022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql']) await db.exec(mig(f))
  const t = (await q("select count(*)::int c from information_schema.columns where table_name = 'schedule_events' and column_name in ('rev','task_link','is_deadline','task_date_key')")).rows[0].c
  assert.equal(t, 4)
})

test('RLS is on and owner-only; the functions are SECURITY INVOKER and not callable by anon/PUBLIC', { skip: SKIP }, async () => {
  assert.equal((await q("select relrowsecurity from pg_class where relname = 'schedule_events'")).rows[0].relrowsecurity, true)
  const pols = (await q("select cmd, qual, with_check from pg_policies where tablename = 'schedule_events'")).rows
  assert.deepEqual(pols.map(p => p.cmd).sort(), ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  for (const p of pols) assert.match(`${p.qual ?? ''}${p.with_check ?? ''}`, /auth\.uid\(\)\s*=\s*user_id/)
  const f = (await q("select proname, prosecdef, has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') authed, has_function_privilege('public', oid, 'execute') pub from pg_proc where proname like 'schedule\\_%' and pronamespace = 'public'::regnamespace")).rows
  assert.equal(f.length, 4)    // schedule_apply, schedule_set_task_link, schedule_task_has_progress (023) + schedule_set_sync (024)
  for (const r of f) { assert.equal(r.prosecdef, false, r.proname + ' must not be SECURITY DEFINER'); assert.equal(r.anon, false, r.proname + ' anon'); assert.equal(r.pub, false, r.proname + ' public'); assert.equal(r.authed, true, r.proname + ' authenticated') }
})

test('table privileges: anon has NOTHING on schedule_events; authenticated has exactly the four row operations; service_role has all', { skip: SKIP }, async () => {
  const p = async (role, priv) => (await q(`select has_table_privilege('${role}', 'public.schedule_events', '${priv}') as ok`)).rows[0].ok
  for (const priv of ['select', 'insert', 'update', 'delete']) { assert.equal(await p('anon', priv), false, 'anon ' + priv); assert.equal(await p('authenticated', priv), true, 'authenticated ' + priv); assert.equal(await p('service_role', priv), true, 'service_role ' + priv) }
  assert.equal(await p('authenticated', 'truncate'), false); assert.equal(await p('authenticated', 'references'), false)
  await db.exec('set role anon')
  try { await fails(q('select * from schedule_events'), /permission denied/) } finally { await db.exec('reset role') }
})

test('paywall (when migration 016 exists): an unpaid/expired user can not create or edit events, can still read and delete their own; paid users unaffected', { skip: SKIP }, async () => {
  await reset()
  // stand-in for 016's billing_has_access(): the caller's access is looked up in a tiny table
  await db.exec(`create table if not exists paid_users (id uuid primary key); delete from paid_users;
    create or replace function public.billing_has_access(p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from paid_users where id = p_user) $$;
    grant all on paid_users to authenticated; grant execute on function public.billing_has_access(uuid) to authenticated`)
  try {
  await db.exec(mig('024_schedule_task_sync.sql'))                                              // re-run the LATEST migration: it now sees billing_has_access and adds the policies
  assert.equal((await q("select count(*)::int c from pg_policies where tablename = 'schedule_events' and policyname like 'billing_paywall%'")).rows[0].c, 2)
  await db.exec(`insert into paid_users values ('${A}')`)
  await as(A, async () => { await apply(ev('p1'), null, null, []) })                               // paid: fine
  await as(B, async () => { await fails(apply(ev('p2'), null, null, []), /row-level security|policy/) })                       // unpaid: refused
  await db.exec(`delete from paid_users`)                                                          // A's plan ends
  await as(A, async () => {
    await fails(apply(ev('p1', { title: 'edit after expiry' }), null, null, []), /row-level security|policy/)
    assert.equal((await q('select count(*)::int c from schedule_events')).rows[0].c, 1, 'can still READ own data')
    await apply(null, 'p1', null, [])                                                              // …and delete it
    assert.equal((await q('select count(*)::int c from schedule_events')).rows[0].c, 0)
  })
  } finally {                                                                                      // never leave the stand-in or its policies behind for the other tests
    await db.exec('reset role')
    await db.exec("drop policy if exists billing_paywall_insert on public.schedule_events; drop policy if exists billing_paywall_update on public.schedule_events; drop function if exists public.billing_has_access(uuid); drop table if exists paid_users")
  }
})

test('no signed-in user → refused; anon role → permission denied', { skip: SKIP }, async () => {
  await fails(apply(ev('x'), null, null, []), /not_authenticated|28000/)
  await db.exec('set role anon')
  try { await fails(apply(ev('x'), null, null, []), /permission denied/) } finally { await db.exec('reset role') }
})

test('two accounts: B can not read, change, delete or take over A\'s events, days or preferences', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => { await apply(ev('e1'), null, null, [up('e1', '2026-11-24')]) })
  await as(A, async () => { await q("insert into user_preferences (user_id, saved_locations) values ($1, '[\"Room 1\"]')", [A]) })
  await as(B, async () => {
    assert.equal((await q('select * from schedule_events')).rows.length, 0, 'B sees none of A\'s events')
    assert.equal((await q('select * from calendar_days')).rows.length, 0, 'B sees none of A\'s days')
    assert.equal((await q('select * from user_preferences')).rows.length, 0, 'B sees none of A\'s preferences')
    assert.equal((await q("update schedule_events set title = 'hacked' returning 1")).rows.length, 0)
    assert.equal((await q('delete from schedule_events returning 1')).rows.length, 0)
    assert.equal((await q("update calendar_days set day_data = '{}' returning 1")).rows.length, 0)
    await fails(q("insert into schedule_events (user_id, event_id, title, start_at, end_at) values ($1, 'evil', 't', now(), now() + interval '1 hour')", [A]), /row-level security/)
    await fails(q("insert into calendar_days (user_id, date_key, day_data) values ($1, '2026-12-01', '{}')", [A]), /row-level security/)
    assert.equal((await q("select public.schedule_set_task_link('e1', 'detached') as r")).rows[0].r, null, 'B cannot flip A\'s link choice')
    // B using A's event id through the function only ever creates/edits B's OWN row
    await apply(ev('e1', { title: 'B copy' }), null, null, [up('e1', '2026-11-24', 'B copy')])
  })
  const rows = (await q("select user_id, title, rev, task_link from schedule_events order by user_id")).rows
  assert.deepEqual(rows.map(r => [r.user_id, r.title, r.rev, r.task_link]), [[A, 'Report', 1, 'linked'], [B, 'B copy', 1, 'linked']])
  assert.equal((await day(A, '2026-11-24')).tasks[0].text, 'Report', 'A\'s task untouched by B')
  assert.equal((await day(B, '2026-11-24')).tasks[0].text, 'B copy')
  await as(B, async () => { await apply(null, 'e1', null, []) })       // B deletes "e1" → only B's own
  assert.equal((await q("select count(*)::int c from schedule_events where user_id = $1", [A])).rows[0].c, 1)
})

test('JSON null arguments (what an HTTP client sends for "none") behave exactly like SQL NULL — delete-only and ops-only calls work', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    await apply(ev('en'), null, null, [up('en', '2026-11-24')])
    const r = (await q("select public.schedule_apply('null'::jsonb, 'en', null, 'null'::jsonb) as r")).rows[0].r     // delete the event, no ops
    assert.equal(r.rev, null)
    assert.equal((await q("select count(*)::int c from schedule_events")).rows[0].c, 0)
    await apply(ev('en2'), null, null, [up('en2', '2026-11-25')])
    await q("select public.schedule_apply('null'::jsonb, null, null, $1::jsonb)", [JSON.stringify([{ kind: 'remove', date_key: '2026-11-25', task_id: 'dl-en2' }])])   // ops only
    assert.equal((await day(A, '2026-11-25')).tasks.length, 0)
  })
})

test('atomic: a failing task operation rolls the event back too (nothing half-saved)', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    await fails(apply(ev('e2'), null, null, [up('e2', '2026-11-24'), { kind: 'upsert', date_key: 'not-a-date', task_id: 'dl-e2', event_id: 'e2', task: task('dl-e2') }]), /bad_op|22023/)
    assert.equal((await q('select count(*)::int c from schedule_events')).rows[0].c, 0, 'event not created')
    assert.equal((await q('select count(*)::int c from calendar_days')).rows[0].c, 0, 'first op rolled back')
  })
})

test('the function can only touch deadline-linked tasks (ids starting dl-)', { skip: SKIP }, async () => {
  await reset(); await setDay(A, '2026-11-24', { tasks: [task('t-user', { sourceEventId: undefined })] })
  await as(A, async () => {
    await fails(apply(null, null, null, [{ kind: 'remove', date_key: '2026-11-24', task_id: 't-user' }]), /bad_op|22023/)
    await fails(apply(null, null, null, Array.from({ length: 7 }, () => up('e', '2026-11-24'))), /bad_ops|22023/)
  })
  assert.equal((await day(A, '2026-11-24')).tasks.length, 1)
})

test('merge safety: other tasks and every other field of the day survive; no duplicates; order kept', { skip: SKIP }, async () => {
  await reset()
  const x = { id: 'tx', text: 'mine', done: true, journal: 'notes', sessions: [{ id: 's' }] }, y = { id: 'ty', text: 'other' }
  await setDay(A, '2026-11-24', { productive: true, hyper: false, milestone: true, notes: 'day notes', journal: 'jj', attachments: [{ id: 'a' }], tasks: [x, y] })
  await as(A, async () => {
    await apply(ev('e3'), null, null, [up('e3', '2026-11-24')])
    await apply(ev('e3'), null, null, [up('e3', '2026-11-24')])                     // repeated / retried
    await apply(ev('e3', { title: 'Renamed' }), null, 2, [up('e3', '2026-11-24', 'Renamed')])
  })
  const d = await day(A, '2026-11-24')
  assert.deepEqual(d.tasks.filter(t => t.id !== 'dl-e3'), [x, y], 'unrelated tasks byte-identical')
  assert.equal(d.tasks.filter(t => t.id === 'dl-e3').length, 1); assert.equal(d.tasks.find(t => t.id === 'dl-e3').text, 'Renamed')
  assert.deepEqual([d.productive, d.milestone, d.notes, d.journal, d.attachments], [true, true, 'day notes', 'jj', [{ id: 'a' }]], 'day fields untouched')
})

test('concurrency: a change made on another device between the client\'s read and the call is NOT lost', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => { await apply(ev('e4'), null, null, [up('e4', '2026-11-24')]) })
  // "device 2" adds a task and completes the linked one while "device 1" still holds its old copy
  const cur = await day(A, '2026-11-24')
  cur.tasks = cur.tasks.map(t => (t.id === 'dl-e4' ? { ...t, done: true, journal: 'device 2 notes' } : t)).concat([{ id: 'new-on-device-2', text: 'added elsewhere' }])
  await setDay(A, '2026-11-24', cur)
  // device 1 (stale) renames the event: its ops carry only the title, not a copy of the task
  await as(A, async () => { await apply(ev('e4', { title: 'Renamed on 1' }), null, 1, [up('e4', '2026-11-24', 'Renamed on 1')]) })
  const d = await day(A, '2026-11-24'), l = d.tasks.find(t => t.id === 'dl-e4')
  assert.equal(l.text, 'Renamed on 1'); assert.equal(l.done, true); assert.equal(l.journal, 'device 2 notes')
  assert.ok(d.tasks.some(t => t.id === 'new-on-device-2'))
})

test('remove: untouched task deleted; a task with work (done / sessions / notes / timer / attachments / sub-task) is kept and unlinked', { skip: SKIP }, async () => {
  const cases = [[{}, 'removed'], [{ done: true }, 'kept'], [{ sessions: [{ id: 's' }] }, 'kept'], [{ journal: ' hi ' }, 'kept'], [{ noteDone: true }, 'kept'], [{ timerStart: 5 }, 'kept'], [{ attachments: [{ id: 'a' }] }, 'kept']]
  for (const [over, expect] of cases) {
    await reset(); await setDay(A, '2026-11-24', { tasks: [task('dl-e5', over)] })
    await as(A, async () => { await apply(null, null, null, [{ kind: 'remove', date_key: '2026-11-24', task_id: 'dl-e5' }]) })
    const t = (await day(A, '2026-11-24')).tasks
    if (expect === 'removed') assert.equal(t.length, 0, JSON.stringify(over)); else { assert.equal(t.length, 1, JSON.stringify(over)); assert.equal(t[0].sourceEventId, undefined, 'unlinked') }
  }
  await reset(); await setDay(A, '2026-11-24', { tasks: [task('dl-e5'), { id: 'kid', parentTaskId: 'dl-e5', text: 's' }] })
  await as(A, async () => { await apply(null, null, null, [{ kind: 'remove', date_key: '2026-11-24', task_id: 'dl-e5' }]) })
  assert.equal((await day(A, '2026-11-24')).tasks.length, 2, 'parent of a sub-task is kept')
  await reset()
  await as(A, async () => { assert.deepEqual((await apply(null, null, null, [{ kind: 'remove', date_key: '2030-01-01', task_id: 'dl-zz' }])).days, {}) })
  assert.equal((await q('select count(*)::int c from calendar_days')).rows[0].c, 0, 'remove on a missing day creates no junk row')
})

test('move between days is one transaction: destination written, origin cleared, same task (work kept)', { skip: SKIP }, async () => {
  await reset(); await setDay(A, '2026-11-24', { tasks: [task('dl-e6', { done: true, journal: 'kept' })] })
  await as(A, async () => { await apply(ev('e6', { task_date_key: '2026-11-26' }), null, null, [
    { kind: 'move', date_key: '2026-11-26', from_key: '2026-11-24', task_id: 'dl-e6', event_id: 'e6', task: { text: 'New title' } }]) })
  const to = (await day(A, '2026-11-26')).tasks, from = (await day(A, '2026-11-24')).tasks
  assert.equal(to.length, 1); assert.equal(from.length, 0, 'origin cleared — never two copies')
  assert.deepEqual([to[0].done, to[0].journal, to[0].text], [true, 'kept', 'New title'], 'work travels with the task')
  // failed move rolls back everything; a move whose origin is missing creates the task at the destination
  await as(A, async () => { await fails(apply(ev('e6'), null, null, [{ kind: 'move', date_key: '2026-11-27', from_key: '2026-11-27', task_id: 'dl-e6', event_id: 'e6', task: { text: 'x' } }]), /bad_op|22023/) })
  await as(A, async () => { await apply(null, null, null, [{ kind: 'move', date_key: '2026-12-01', from_key: '2026-11-30', task_id: 'dl-new', event_id: 'new', task: task('dl-new', { text: 'fresh' }) }]) })
  assert.equal((await day(A, '2026-12-01')).tasks[0].text, 'fresh')
  // duplicate already on the destination: the one holding work survives, only one remains
  await setDay(A, '2026-12-05', { tasks: [task('dl-e6')] }); await setDay(A, '2026-12-04', { tasks: [task('dl-e6', { done: true, journal: 'w' })] })
  await as(A, async () => { await apply(null, null, null, [{ kind: 'move', date_key: '2026-12-05', from_key: '2026-12-04', task_id: 'dl-e6', event_id: 'e6', task: { text: 't' } }]) })
  const dd = (await day(A, '2026-12-05')).tasks; assert.equal(dd.length, 1); assert.equal(dd[0].journal, 'w')
})

test('optimistic concurrency: stale rev refused; matching rev accepted; retry with no rev is idempotent; rev only grows', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    assert.equal((await apply(ev('e7'), null, null, [])).rev, 1)
    assert.equal((await apply(ev('e7'), null, null, [])).rev, 2, 'a retried create just updates (idempotent)')
    assert.equal((await apply(ev('e7', { title: 'v3' }), null, 2, [])).rev, 3)
    await fails(apply(ev('e7', { title: 'stale tab' }), null, 2, []), /schedule_conflict|XS409/)
    assert.equal((await q("select title from schedule_events where event_id = 'e7'")).rows[0].title, 'v3', 'stale write changed nothing')
  })
})

test('task_link: a stale save can not undo "removed from Task Manager"; set_task_link records the choice; bad values refused', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    await apply(ev('e8'), null, null, [])
    assert.ok((await q("select public.schedule_set_task_link('e8', 'detached') as r")).rows[0].r >= 2)
    await apply(ev('e8', { title: 'edited' }), null, null, [])                       // no task_link key → unchanged
    let r = (await q("select task_link, task_date_key from schedule_events where event_id = 'e8'")).rows[0]
    assert.deepEqual([r.task_link, r.task_date_key], ['detached', null])
    await apply(ev('e8', { task_link: 'linked' }), null, null, [])                   // explicit restore
    assert.equal((await q("select task_link from schedule_events where event_id = 'e8'")).rows[0].task_link, 'linked')
    await fails(q("select public.schedule_set_task_link('e8', 'whatever')"), /bad_link|22023/)
  })
  await fails(db.exec("update schedule_events set task_link = 'x'"), /check constraint/)
})

test('constraints: end after start, text limits, date-key shape; instants are timezone-independent', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    await fails(apply(ev('e9', { end_at: '2026-11-24T21:00:00Z' }), null, null, []), /schedule_events_end_after_start|check constraint/)
    await fails(apply(ev('e9', { title: '' }), null, null, []), /schedule_events_title_len|check constraint/)
    await fails(apply(ev('e9', { location: 'x'.repeat(201) }), null, null, []), /schedule_events_text_len|check constraint/)
    await fails(apply(ev('e9', { task_date_key: '24/11/2026' }), null, null, []), /schedule_events_text_len|check constraint/)
    await apply(ev('e9'), null, null, [])
  })
  const base = (await q("select extract(epoch from start_at) s from schedule_events where event_id = 'e9'")).rows[0].s
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
    await db.exec(`set time zone '${tz}'`)
    assert.equal((await q("select extract(epoch from start_at) s from schedule_events where event_id = 'e9'")).rows[0].s, base, tz)
  }
  await db.exec("set time zone 'UTC'")
})

test('preferences isolation: saved locations / categories are per user (RLS) and default to empty arrays', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => { await q("insert into user_preferences (user_id) values ($1)", [A]) })
  assert.deepEqual((await q('select saved_locations, schedule_categories from user_preferences')).rows[0], { saved_locations: [], schedule_categories: [] })
  await as(B, async () => { assert.equal((await q("update user_preferences set saved_locations = '[\"x\"]' returning 1")).rows.length, 0); await fails(q("insert into user_preferences (user_id) values ($1)", [A]), /row-level security/) })
})

// (the shipped Supabase validation script is now covered by tests/schedule/scheduleValidationScripts.test.cjs, on a production-equivalent database)

test('deleting an account removes its events (cascade) and nothing else', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => { await apply(ev('ea'), null, null, []) }); await as(B, async () => { await apply(ev('eb'), null, null, []) })
  await db.exec(`delete from auth.users where id = '${A}'`)
  assert.deepEqual((await q('select user_id from schedule_events')).rows.map(r => r.user_id), [B])
})

// ── Parity: the TypeScript reference (applyOpsLocal) must behave exactly like the REAL SQL function ───────────────────
test('parity: applyOpsLocal (TS) and schedule_apply (real Postgres) produce identical days for ~100 generated scenarios', { skip: SKIP }, async () => {
  await db.exec(`insert into auth.users values ('${A}') on conflict do nothing`)      // the previous test deleted account A
  const ts = require('typescript')
  const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-sql-parity'); fs.mkdirSync(OUT, { recursive: true })
  for (const [f, o] of [['scheduleLogic', 'scheduleLogic'], ['deadlineLink', 'deadlineLink']])
    fs.writeFileSync(path.join(OUT, o + '.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, `components/xpadite/${f}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
  const D = require(path.join(OUT, 'deadlineLink.js'))
  const at = (d, h = 12) => new Date(2026, 10, d, h).getTime()
  const variants = [{}, { done: true }, { journal: 'j' }, { sessions: [{ id: 's' }] }, { attachments: [{ id: 'a' }] }, { timerStart: 9 }, { noteDone: true }]
  const eventsFor = [
    ['same', { title: 'Report', endAt: at(24), isDeadline: true }], ['rename', { title: 'Renamed', endAt: at(24), isDeadline: true }],
    ['move', { title: 'Report', endAt: at(27), isDeadline: true }], ['unflag', { title: 'Report', endAt: at(24), isDeadline: false }], ['delete', null],
  ]
  const layouts = [
    ['none', () => ({})],
    ['on due day', v => ({ '2026-11-24': { productive: true, tasks: [{ id: 'keep', text: 'k' }, task('dl-p', { ...v, sourceEventId: 'p' })] } })],
    ['on another day', v => ({ '2026-11-25': { notes: 'n', tasks: [task('dl-p', { ...v, sourceEventId: 'p' }), { id: 'kid', parentTaskId: 'dl-x' }] } })],
    ['duplicated', v => ({ '2026-11-24': { tasks: [task('dl-p', { sourceEventId: 'p' })] }, '2026-11-26': { tasks: [task('dl-p', { ...v, sourceEventId: 'p' })] } })],
    ['with sub-task', v => ({ '2026-11-24': { tasks: [task('dl-p', { ...v, sourceEventId: 'p' }), { id: 'c', parentTaskId: 'dl-p', text: 's' }] } })],
  ]
  let n = 0
  for (const [lname, mk] of layouts) for (const v of variants.slice(0, lname === 'none' ? 1 : 7)) for (const [ename, e] of eventsFor) {
    const cal = JSON.parse(JSON.stringify(mk(v)))
    for (const k of Object.keys(cal)) cal[k] = { productive: false, hyper: false, notes: '', journal: '', ...cal[k] }
    const plan = D.planDeadlineSync(cal, 'p', e, null, 'a')
    const ops = JSON.parse(JSON.stringify(plan.ops))
    const want = JSON.parse(JSON.stringify(D.applyOpsLocal(cal, ops)))
    await reset()
    for (const [k, doc] of Object.entries(cal)) await setDay(A, k, doc)
    const got = await as(A, async () => (await apply(null, null, null, ops)).days)
    assert.deepEqual(JSON.parse(JSON.stringify(got)), want, `${lname} / ${JSON.stringify(v)} / ${ename}`)
    n++
  }
  assert.ok(n >= 100, `${n} scenarios`)
})


// ═════ Migration 024: stale-write protection (compare-and-swap), sync preference, ordinary-event tasks ═════════════════════
const save = (key, doc, rev) => q('select public.calendar_day_save($1, $2::jsonb, $3) as r', [key, JSON.stringify(doc), rev]).then(r => r.rows[0].r)
const revOf = async (uid, key) => (await q('select rev from calendar_days where user_id = $1 and date_key = $2', [uid, key])).rows[0]?.rev
const D1 = (tasks = [], o = {}) => ({ productive: false, hyper: false, notes: '', journal: '', tasks, ...o })
const T1 = (id, o = {}) => ({ id, text: id, done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a', sessions: [], ...o })

test('024 re-applies cleanly; calendar_days.rev starts at 1 for existing rows (additive default)', { skip: SKIP }, async () => {
  await reset()
  await db.exec("insert into calendar_days (user_id, date_key, day_data) values ('" + A + "', '2026-01-01', '{}')")
  assert.equal(await revOf(A, '2026-01-01'), 1)
  await db.exec(mig('024_schedule_task_sync.sql'))
  assert.equal(await revOf(A, '2026-01-01'), 1, 're-running changes nothing')
})

test('revision trigger: every real change advances rev (even a legacy plain upsert); a no-op does not; a client can not forge it', { skip: SKIP }, async () => {
  await reset(); await setDay(A, '2026-02-01', D1([T1('x')]))
  assert.equal(await revOf(A, '2026-02-01'), 1)
  await setDay(A, '2026-02-01', D1([T1('x'), T1('y')]))
  assert.equal(await revOf(A, '2026-02-01'), 2, 'a legacy (revision-less) write advanced the revision, so protected writers notice')
  await setDay(A, '2026-02-01', D1([T1('x'), T1('y')]))
  assert.equal(await revOf(A, '2026-02-01'), 2, 'identical content: no bump')
  await as(A, async () => { await q(`update calendar_days set rev = 999, day_data = day_data || '{"notes":"n"}'::jsonb where date_key = '2026-02-01'`) })
  assert.equal(await revOf(A, '2026-02-01'), 3, 'a forged rev value is ignored; the server advances it by one')
})

test('calendar_day_save (CAS): fresh insert, matching write, stale write refused with the current doc, no-row vs expected, lost-response retry', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => {
    let r = await save('2026-03-01', D1([T1('a')]), null); assert.deepEqual([r.ok, r.rev], [true, 1], 'insert')
    r = await save('2026-03-01', D1([T1('a'), T1('b')]), 1); assert.deepEqual([r.ok, r.rev], [true, 2], 'matching revision')
    r = await save('2026-03-01', D1([T1('stale')]), 1)
    assert.equal(r.ok, false); assert.equal(r.rev, 2); assert.deepEqual(r.doc.tasks.map(t => t.id), ['a', 'b'], 'stale write refused, nothing overwritten, current doc returned')
    r = await save('2026-03-01', D1([T1('a'), T1('b')]), 2); assert.deepEqual([r.ok, r.rev], [true, 2], 'identical content = same revision (a lost-response retry is harmless)')
    r = await save('2026-03-02', D1(), 5); assert.deepEqual([r.ok, r.rev, r.doc], [false, 0, null], 'caller thought a row existed')
    r = await save('2026-03-01', D1([T1('z')]), null); assert.equal(r.ok, false, 'caller unaware the row exists')
    await fails(save('bad', D1(), null), /bad_key|22023/); await fails(q("select public.calendar_day_save('2026-03-03', '[]'::jsonb, null)"), /bad_doc|22023/)
  })
  assert.deepEqual((await day(A, '2026-03-01')).tasks.map(t => t.id), ['a', 'b'])
})

test('CAS vs schedule_apply: a protected write based on an old revision is refused after schedule_apply changed the day', { skip: SKIP }, async () => {
  await reset(); await setDay(A, '2026-04-01', D1([T1('mine')]))
  const base = await revOf(A, '2026-04-01')
  await as(A, async () => { await apply(ev('e1', { task_date_key: '2026-04-01' }), null, null, [up('e1', '2026-04-01')]) })
  assert.ok(await revOf(A, '2026-04-01') > base)
  await as(A, async () => { const r = await save('2026-04-01', D1([T1('mine'), T1('local-edit')]), base); assert.equal(r.ok, false); assert.ok(r.doc.tasks.some(t => t.id === 'dl-e1'), 'the stale tab learns about the new linked task instead of erasing it') })
})

test('CAS: user B can not write, read or probe the days of user A', { skip: SKIP }, async () => {
  await reset(); await setDay(A, '2026-05-01', D1([T1('secret')]))
  await as(B, async () => { const r = await save('2026-05-01', D1([T1('evil')]), null); assert.equal(r.ok, true, 'B only creates B own day (separate row per user)'); assert.equal(r.rev, 1) })
  assert.deepEqual((await day(A, '2026-05-01')).tasks.map(t => t.id), ['secret'], 'A untouched'); assert.deepEqual((await day(B, '2026-05-01')).tasks.map(t => t.id), ['evil'])
  await db.exec('set role anon'); try { await fails(q("select public.calendar_day_save('2026-05-01', '{}'::jsonb, null)"), /permission denied/) } finally { await db.exec('reset role') }
  await fails(q("select public.calendar_day_save('2026-05-01', '{}'::jsonb, null)"), /not_authenticated|28000/)
})

test('schedule_set_sync: per-user preference, default OFF, RLS-isolated, anon refused', { skip: SKIP }, async () => {
  await reset()
  await as(A, async () => { await q('insert into user_preferences (user_id) values ($1)', [A]) })
  assert.equal((await q('select schedule_task_sync s from user_preferences')).rows[0].s, false, 'existing users default to OFF')
  await as(A, async () => { assert.equal((await q('select public.schedule_set_sync(true) as r')).rows[0].r, true) })
  await as(B, async () => { assert.equal((await q('select schedule_task_sync from user_preferences')).rows.length, 0, 'B can not see the setting of A'); assert.equal((await q('select public.schedule_set_sync(false) as r')).rows[0].r, false, 'B writes B own row') })
  assert.equal((await q(`select schedule_task_sync s from user_preferences where user_id = '${A}'`)).rows[0].s, true, 'A unchanged by B')
  await as(A, async () => { await fails(q('select public.schedule_set_sync(null)'), /bad_value|22023/) })
  await db.exec('set role anon'); try { await fails(q('select public.schedule_set_sync(true)'), /permission denied/) } finally { await db.exec('reset role') }
})

test('ordinary-event tasks (ev-): create, move with sub-tasks carried and re-parented, convert ordinary and deadline both ways keeping every piece of work', { skip: SKIP }, async () => {
  await reset(); const evt = id => ({ kind: 'upsert', date_key: '2026-06-01', task_id: id, event_id: 'e9', task: T1(id, { text: 'Class' }) })
  await as(A, async () => { await apply(ev('e9', { is_deadline: false }), null, null, [evt('ev-e9')]) })
  let d = await day(A, '2026-06-01'); assert.deepEqual(d.tasks.map(t => [t.id, t.sourceEventId]), [['ev-e9', 'e9']])
  d.tasks = [{ ...d.tasks[0], done: true, journal: 'notes', sessions: [{ id: 's', startTs: 1, endTs: 2 }] }, T1('kid', { parentTaskId: 'ev-e9' }), T1('other')]; await setDay(A, '2026-06-01', d)
  await as(A, async () => {
    const r = await apply(ev('e9', { is_deadline: true }), null, null, [{ kind: 'move', date_key: '2026-06-03', from_key: '2026-06-01', from_task_id: 'ev-e9', task_id: 'dl-e9', event_id: 'e9', task: { text: 'Class' } }])
    assert.deepEqual(Object.keys(r.revs).sort(), ['2026-06-01', '2026-06-03'], 'revisions reported for every changed day')
  })
  const from = await day(A, '2026-06-01'), to = await day(A, '2026-06-03')
  assert.deepEqual(from.tasks.map(t => t.id), ['other'], 'origin keeps only unrelated tasks (the sub-task travelled too)')
  const dl = to.tasks.find(t => t.id === 'dl-e9'), kid = to.tasks.find(t => t.id === 'kid')
  assert.ok(dl && dl.done === true && dl.journal === 'notes' && dl.sessions.length === 1 && dl.sourceEventId === 'e9', 'all work kept under the new id')
  assert.equal(kid.parentTaskId, 'dl-e9', 'sub-task re-parented to the re-keyed task'); assert.equal(to.tasks.filter(t => /^(dl|ev)-e9$/.test(t.id)).length, 1, 'never both an ordinary and a deadline task')
  await as(A, async () => { await apply(null, null, null, [{ kind: 'move', date_key: '2026-06-03', from_key: '2026-06-03', from_task_id: 'dl-e9', task_id: 'ev-e9', event_id: 'e9', task: { text: 'Class' } }]) })
  const back = await day(A, '2026-06-03'); assert.deepEqual(back.tasks.map(t => [t.id, t.parentTaskId ?? null]).sort(), [['ev-e9', null], ['kid', 'ev-e9']])
  assert.equal(back.tasks.find(t => t.id === 'ev-e9').done, true, 'same-day re-key keeps the work')
  await as(A, async () => { await fails(apply(null, null, null, [{ kind: 'move', date_key: '2026-06-03', from_key: '2026-06-03', task_id: 'ev-e9', event_id: 'e9', task: { text: 'x' } }]), /bad_op|22023/) })
  await as(A, async () => { await fails(apply(null, null, null, [{ kind: 'remove', date_key: '2026-06-03', task_id: 'x-e9' }]), /bad_op|22023/) })
})

test('024 privileges: the new functions are SECURITY INVOKER and executable by authenticated only; the rev trigger function is not callable', { skip: SKIP }, async () => {
  const f = (await q("select proname, prosecdef, has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') authed, has_function_privilege('public', oid, 'execute') pub from pg_proc where pronamespace = 'public'::regnamespace and proname in ('calendar_day_save', 'schedule_set_sync', 'schedule_apply')")).rows
  assert.equal(f.length, 3); for (const r of f) { assert.equal(r.prosecdef, false, r.proname); assert.equal(r.anon, false, r.proname); assert.equal(r.pub, false, r.proname); assert.equal(r.authed, true, r.proname) }
  assert.equal((await q("select has_function_privilege('authenticated', 'public.calendar_days_bump_rev()', 'execute') as x")).rows[0].x, false)
})


test('parity 2: ordinary-event tasks, conversions, sub-tasks and the sync switch — TypeScript reference vs REAL Postgres, identical days for every generated scenario', { skip: SKIP }, async () => {
  await db.exec(`insert into auth.users values ('${A}') on conflict do nothing`)
  const OUT2 = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-sql-parity'); fs.mkdirSync(OUT2, { recursive: true })
  fs.writeFileSync(path.join(OUT2, 'deadlineLink.js'), require('typescript').transpileModule(fs.readFileSync(path.join(ROOT, 'components/xpadite/deadlineLink.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)
  const D = require(path.join(OUT2, 'deadlineLink.js'))
  const at = (d, h) => new Date(2026, 10, d, h).getTime()
  const works = [{}, { done: true }, { journal: 'j' }, { sessions: [{ id: 's' }] }]
  const events = [
    ['same', { title: 'Class', startAt: at(9, 9), endAt: at(9, 10), isDeadline: false }],
    ['rename', { title: 'Renamed', startAt: at(9, 9), endAt: at(9, 10), isDeadline: false }],
    ['move start', { title: 'Class', startAt: at(12, 9), endAt: at(12, 10), isDeadline: false }],
    ['to deadline', { title: 'Class', startAt: at(9, 9), endAt: at(11, 17), isDeadline: true }],
    ['deadline same-day', { title: 'Class', startAt: at(9, 9), endAt: at(9, 17), isDeadline: true }],
    ['deleted', null],
  ]
  const layouts = [
    ['none', () => ({})],
    ['ev task on start day', w => ({ '2026-11-09': { tasks: [T1('other'), T1('ev-p', { ...w, sourceEventId: 'p' })] } })],
    ['dl task on end day', w => ({ '2026-11-11': { tasks: [T1('dl-p', { ...w, sourceEventId: 'p' })] } })],
    ['ev task + sub-task', w => ({ '2026-11-09': { tasks: [T1('ev-p', { ...w, sourceEventId: 'p' }), T1('kid', { parentTaskId: 'ev-p' }), T1('other')] } })],
    ['both kinds (stale duplicate)', w => ({ '2026-11-09': { tasks: [T1('ev-p', { sourceEventId: 'p' })] }, '2026-11-11': { tasks: [T1('dl-p', { ...w, sourceEventId: 'p' })] } })],
  ]
  let n = 0
  for (const sync of [true, false]) for (const link of ['linked', 'detached']) for (const [lname, mk] of layouts) for (const w of works.slice(0, lname === 'none' ? 1 : 4)) for (const [ename, e] of events) {
    const cal = JSON.parse(JSON.stringify(mk(w)))
    for (const k of Object.keys(cal)) cal[k] = { productive: false, hyper: false, notes: '', journal: '', ...cal[k] }
    const plan = D.planDeadlineSync(cal, 'p', e, null, 'a', undefined, link, sync)
    const ops = JSON.parse(JSON.stringify(plan.ops))
    const want = JSON.parse(JSON.stringify(D.applyOpsLocal(cal, ops)))
    await reset()
    for (const [k, doc] of Object.entries(cal)) await setDay(A, k, doc)
    const got = await as(A, async () => (await apply(null, null, null, ops)).days)
    assert.deepEqual(JSON.parse(JSON.stringify(got)), want, `sync=${sync} link=${link} / ${lname} / ${JSON.stringify(w)} / ${ename}`)
    n++
  }
  assert.ok(n >= 300, `${n} scenarios`)
})


// ═════ The client write protocol (CAS → refused → three-way merge → retry) driven against the REAL engine ═══════════════
test('stale-write protocol on real Postgres: racing devices all keep their changes; a clash stops and writes nothing; retries and legacy writers are safe', { skip: SKIP }, async () => {
  const ts = require('typescript')
  const OUT3 = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-proto'); fs.mkdirSync(OUT3, { recursive: true })
  fs.writeFileSync(path.join(OUT3, 'dayMerge.js'), ts.transpileModule(fs.readFileSync(path.join(ROOT, 'components/xpadite/dayMerge.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)
  const M = require(path.join(OUT3, 'dayMerge.js'))
  await db.exec(`insert into auth.users values ('${A}') on conflict do nothing`)
  /** what AppContext.writeDay does, minus the UI */
  const write = async (device, key) => {
    let mine = device.mine
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await save(key, mine, device.base?.rev ?? null)
      if (res.ok) { device.base = { rev: res.rev, doc: mine }; device.mine = mine; return { ok: true, rev: res.rev, tries: attempt + 1 } }
      if (res.doc === null) { device.base = null; continue }
      const m = M.mergeDay(device.base?.doc ?? null, mine, res.doc)
      if (m.conflicts.length) return { ok: false, conflicts: m.conflicts, theirs: res.doc, rev: res.rev }
      device.base = { rev: res.rev, doc: res.doc }; mine = m.doc
    }
    return { ok: false, gaveUp: true }
  }
  const KEYP = '2026-08-01'
  const start = D1([T1('t1'), T1('t2'), T1('t3')])
  const deviceFrom = async () => ({ base: { rev: await revOf(A, KEYP), doc: (await day(A, KEYP)) }, mine: null })
  const edit = (dev, fn) => { dev.mine = fn(JSON.parse(JSON.stringify(dev.base.doc))) }

  await reset(); await setDay(A, KEYP, start)
  const d1 = await deviceFrom(), d2 = await deviceFrom(), d3 = await deviceFrom()          // three devices, all based on revision 1
  edit(d1, d => { d.tasks[0].done = true; return d }); edit(d2, d => { d.tasks[1].journal = 'notes from device 2'; return d }); edit(d3, d => { d.tasks.push(T1('from-3')); d.notes = 'day note'; return d })
  await as(A, async () => {
    const r1 = await write(d1, KEYP), r2 = await write(d2, KEYP), r3 = await write(d3, KEYP)
    assert.deepEqual([r1.ok, r2.ok, r3.ok], [true, true, true]); assert.equal(r1.tries, 1); assert.equal(r2.tries, 2, 'device 2 was refused once, merged, then succeeded'); assert.equal(r3.tries, 2)
  })
  const merged = await day(A, KEYP)
  assert.deepEqual([merged.tasks[0].done, merged.tasks[1].journal, merged.tasks.some(t => t.id === 'from-3'), merged.notes], [true, 'notes from device 2', true, 'day note'], 'all three devices\' changes survived')
  assert.equal(merged.tasks.length, 4); assert.equal(await revOf(A, KEYP), 4)

  // a genuine clash: both change the same field of the same task
  await reset(); await setDay(A, KEYP, start)
  const c1 = await deviceFrom(), c2 = await deviceFrom(); edit(c1, d => { d.tasks[0].text = 'First'; return d }); edit(c2, d => { d.tasks[0].text = 'Second'; return d })
  await as(A, async () => {
    assert.equal((await write(c1, KEYP)).ok, true)
    const r = await write(c2, KEYP)
    assert.equal(r.ok, false); assert.equal(r.conflicts[0].field, 'text'); assert.equal(r.theirs.tasks[0].text, 'First')
  })
  assert.equal((await day(A, KEYP)).tasks[0].text, 'First', 'the clash wrote NOTHING — the first device\'s value is intact'); assert.equal(await revOf(A, KEYP), 2)

  // lost response: the same write is simply sent again
  await reset(); await setDay(A, KEYP, start)
  const l1 = await deviceFrom(); edit(l1, d => { d.tasks[2].done = true; d.tasks[2].sessions.push({ id: 's-1', startTs: 1, endTs: 2, note: '', tags: [] }); return d })
  await as(A, async () => {
    const first = await save(KEYP, l1.mine, l1.base.rev); assert.equal(first.ok, true)             // committed, but pretend the answer was lost…
    const retry = await write(l1, KEYP)                                                             // …so the device retries with its OLD base
    assert.equal(retry.ok, true)
  })
  const once = await day(A, KEYP); assert.equal(once.tasks[2].sessions.length, 1, 'no duplicated session'); assert.equal(await revOf(A, KEYP), 2, 'revision advanced exactly once')

  // an OLD client (plain upsert, no revision) overwrites the day: it can not be stopped, but the revision moves so every protected device notices and merges instead of overwriting it
  await reset(); await setDay(A, KEYP, start)
  const p1 = await deviceFrom(); edit(p1, d => { d.tasks[0].done = true; return d })
  await setDay(A, KEYP, D1([T1('t1'), T1('t2'), T1('t3'), T1('added-by-old-client')]))              // legacy writer
  await as(A, async () => { const r = await write(p1, KEYP); assert.equal(r.ok, true) })
  const after = await day(A, KEYP); assert.ok(after.tasks.some(t => t.id === 'added-by-old-client') && after.tasks[0].done === true, 'the protected device merged ON TOP of the legacy writer\'s data')
})

// (the shipped Supabase validation script is now covered by tests/schedule/scheduleValidationScripts.test.cjs, on a production-equivalent database)
