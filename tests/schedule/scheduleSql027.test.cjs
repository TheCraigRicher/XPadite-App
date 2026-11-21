// REAL-POSTGRES tests of migration 027 (push_subscriptions, reminder_deliveries, schedule_reminder_candidates).
//
// What this is and is not: the actual migration SQL runs on a genuine Postgres engine (PGlite = PostgreSQL in WebAssembly) on top of migrations
// 004 / 022 / 023 / 024, with Supabase's default privileges simulated (anon / authenticated / service_role) and auth.uid() stubbed. It is NOT
// Supabase: PostgREST, GoTrue, real JWTs, pg_cron, pg_net, Vault and the hosted project's configuration are not involved. The Supabase-side
// read-only checks are in docs/SCHEDULE_REMINDERS_SETUP.md.
//
// PGlite is NOT a project dependency:  npm i --no-save @electric-sql/pglite   (without it every test here is skipped — reported as skipped, never passed).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) { if (!p) continue; try { PGlite = require(p).PGlite; break } catch {} }
const SKIP = PGlite ? false : 'PGlite not installed (npm i --no-save @electric-sql/pglite) — SQL tests skipped, NOT passed'
const mig = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const EP = n => `https://fcm.googleapis.com/fcm/send/${String(n).padStart(12, 'x')}abcdefghij`
const K = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }
let db
async function boot() {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${A}'), ('${B}');
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    -- Supabase's defaults for objects created in public: everything is granted to the API roles; 027 must revoke what it needs to
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `)
  await d.exec(/create or replace function public\.handle_updated_at\(\)[\s\S]*?\$\$;/.exec(mig('002_reminders.sql'))[0])
  for (const f of ['004_core_data_tables.sql', '022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql']) await d.exec(mig(f))
  await d.exec(mig('027_schedule_reminders_push.sql'))
  return d
}
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
const denied = async (role, sql) => asRole(role, async () => { try { await db.query(sql); return false } catch (e) { return /permission denied|row-level security/i.test(e.message) } })
const rejects = async (sql, re) => { try { await db.query(sql); return false } catch (e) { return re.test(e.message) } }
const ev = (id, user, startIso, mins, rec = 'none') => db.query(`insert into public.schedule_events (user_id, event_id, title, start_at, end_at, reminder_mins, recurrence) values ('${user}', '${id}', '${id}', '${startIso}', '${new Date(Date.parse(startIso) + 3600e3).toISOString()}', ${mins === null ? 'null' : mins}, '${rec}')`)
const sub = async (user, n) => (await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${user}', '${EP(n)}', '${K.p256dh}', '${K.auth}') returning id`)).rows[0].id

test('027 applies cleanly on top of the real schema, twice (idempotent)', { skip: SKIP }, async () => {
  db = await boot()
  await db.exec(mig('027_schedule_reminders_push.sql'))                                   // second run
  const t = (await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name in ('push_subscriptions','reminder_deliveries') order by 1`)).rows.map(r => r.table_name)
  assert.deepEqual(t, ['push_subscriptions', 'reminder_deliveries'])
  const fn = (await db.query(`select p.prosecdef, p.provolatile, pg_get_function_result(p.oid) r, p.proconfig from pg_proc p where proname='schedule_reminder_candidates'`)).rows[0]
  assert.equal(fn.prosecdef, true); assert.equal(fn.provolatile, 's'); assert.ok(fn.proconfig.some(c => /search_path=public/.test(c)))
  assert.match(fn.r, /user_id uuid, event_id text, title text, start_at timestamp with time zone, reminder_mins integer, recurrence text/)
})
test('row security is ON, no policy exists, and the browser roles have no table or function privileges at all', { skip: SKIP }, async () => {
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname in ('push_subscriptions','reminder_deliveries') order by 1`)).rows
  assert.deepEqual(rls.map(r => r.relrowsecurity), [true, true])
  assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename in ('push_subscriptions','reminder_deliveries')`)).rows[0].n, 0)
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from public.push_subscriptions', 'select * from public.reminder_deliveries', `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}', '${EP(1)}', '${K.p256dh}', '${K.auth}')`, `update public.push_subscriptions set user_agent='x'`, 'delete from public.push_subscriptions', `select * from public.schedule_reminder_candidates(now() - interval '30 minutes', now())`]) {
      assert.ok(await denied(role, sql), `${role}: ${sql.slice(0, 60)}`)
    }
  }
  // the service role (the server) can use all of it
  await asRole('service_role', async () => { await db.query('select * from public.push_subscriptions'); await db.query(`select * from public.schedule_reminder_candidates(now() - interval '30 minutes', now())`) })
})
test('constraints: endpoint / key sizes, unique endpoint (one owner at a time), status and attempts checks, unique delivery key', { skip: SKIP }, async () => {
  assert.ok(await rejects(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}', 'https://short', '${K.p256dh}', '${K.auth}')`, /endpoint_len/))
  assert.ok(await rejects(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}', '${EP(2)}', 'short', '${K.auth}')`, /keys_len/))
  assert.ok(await rejects(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-000000000000', '${EP(3)}', '${K.p256dh}', '${K.auth}')`, /foreign key/))
  const s1 = await sub(A, 10)
  assert.ok(await rejects(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${B}', '${EP(10)}', '${K.p256dh}', '${K.auth}')`, /duplicate key|endpoint_key/))
  // ownership transfer (the server's upsert on endpoint re-claims it for the signed-in account)
  await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${B}', '${EP(10)}', '${K.p256dh}', '${K.auth}') on conflict (endpoint) do update set user_id = excluded.user_id`)
  assert.equal((await db.query(`select user_id from public.push_subscriptions where id='${s1}'`)).rows[0].user_id, B)
  await ev('e1', A, '2026-11-20T20:00:00Z', 5)
  const s2 = await sub(A, 11)
  const ins = (st = 'pending', at = 1, occ = '2026-11-20T20:00:00Z') => db.query(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id, status, attempts) values ('${A}', 'e1', '${occ}', '${s2}', '${st}', ${at})`)
  assert.ok(await rejects(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id, status) values ('${A}', 'e1', '2026-11-20T20:00:00Z', '${s2}', 'weird')`, /status_check/))
  assert.ok(await rejects(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id, attempts) values ('${A}', 'e1', '2026-11-20T20:00:00Z', '${s2}', 0)`, /attempts_check/))
  await ins('pending'); await ins('failed', 1, '2026-11-21T20:00:00Z'); await ins('expired', 1, '2026-11-22T20:00:00Z')      // all five status values are accepted (below), duplicates are not
  assert.ok(await rejects(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id) values ('${A}', 'e1', '2026-11-20T20:00:00Z', '${s2}')`, /duplicate key/))
  for (const st of ['sent', 'gone']) await ins(st, 1, st === 'sent' ? '2026-11-23T20:00:00Z' : '2026-11-24T20:00:00Z')
})
test('foreign keys: deleting a subscription, an event or a user removes the dependent delivery rows; a delivery for a non-existent event is refused', { skip: SKIP }, async () => {
  const count = async (w = 'true') => (await db.query(`select count(*)::int n from public.reminder_deliveries where ${w}`)).rows[0].n
  assert.ok(await rejects(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id) select '${A}', 'ghost', now(), id from public.push_subscriptions where user_id='${A}' limit 1`, /foreign key/))
  const before = await count(`user_id='${A}'`); assert.ok(before >= 5)
  await db.query(`delete from public.push_subscriptions where user_id='${A}'`); assert.equal(await count(`user_id='${A}'`), 0)         // subscription → deliveries
  const sA = await sub(A, 20)
  await ev('e2', A, '2026-12-01T10:00:00Z', 5)
  await db.query(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id) values ('${A}', 'e2', '2026-12-01T10:00:00Z', '${sA}')`)
  await db.query(`delete from public.schedule_events where user_id='${A}' and event_id='e2'`); assert.equal(await count(`event_id='e2'`), 0)            // event → deliveries
  await ev('e3', B, '2026-12-01T10:00:00Z', 5); const sB = await sub(B, 21)
  await db.query(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id) values ('${B}', 'e3', '2026-12-01T10:00:00Z', '${sB}')`)
  await db.query(`delete from auth.users where id='${B}'`)                                                                                         // user → everything
  assert.equal((await db.query(`select count(*)::int n from public.push_subscriptions where user_id='${B}'`)).rows[0].n, 0); assert.equal(await count(`user_id='${B}'`), 0)
  // the same event_id belonging to a different user is a different event (composite key): no cross-user delivery row can exist
  await db.query(`insert into auth.users values ('${B}')`); await ev('shared', A, '2026-12-02T10:00:00Z', 5)
  const sB2 = await sub(B, 22)
  assert.ok(await rejects(`insert into public.reminder_deliveries (user_id, event_id, occurrence_at, subscription_id) values ('${B}', 'shared', '2026-12-02T10:00:00Z', '${sB2}')`, /foreign key/))
})
test('schedule_reminder_candidates: exactly the events that could be due in the window — one-offs by (start − reminder), every started repeating event, nothing else', { skip: SKIP }, async () => {
  await db.exec(`delete from public.schedule_events`)
  const now = '2026-11-20T19:55:00Z', lo = '2026-11-20T19:25:00Z'
  await ev('due5', A, '2026-11-20T20:00:00Z', 5)                       // fires 19:55 → in window
  await ev('lateok', A, '2026-11-20T20:20:00Z', 40)                    // fires 19:40 → in window
  await ev('early', A, '2026-11-20T20:20:00Z', 5)                      // fires 20:15 → not yet
  await ev('old', A, '2026-11-20T19:00:00Z', 5)                        // fires 18:55 → older than the window
  await ev('none', A, '2026-11-20T20:00:00Z', null)                    // no reminder
  await ev('big', B, '2026-11-24T10:00:00Z', 100000)                   // 69 days before: fires far in the past → no
  await ev('big2', B, '2027-01-29T06:35:00Z', 100000)                  // 100000 min = 69 d 10 h 40 min: fires 2026-11-20T19:55 exactly → yes
  await ev('weekly', A, '2026-10-01T15:00:00Z', 10, 'weekly')          // repeating, started → returned (the job expands it)
  await ev('futureweekly', A, '2027-06-01T15:00:00Z', 10, 'weekly')    // series not started and not within reminder reach → no
  await ev('startsoon', A, '2026-11-20T20:05:00Z', 15, 'daily')        // repeating, first occurrence reachable (fires 19:50)
  const r = (await asRole('service_role', () => db.query(`select event_id from public.schedule_reminder_candidates('${lo}', '${now}') order by 1`))).rows.map(x => x.event_id)
  assert.deepEqual(r, ['big2', 'due5', 'lateok', 'startsoon', 'weekly'])
  const row = (await asRole('service_role', () => db.query(`select * from public.schedule_reminder_candidates('${lo}', '${now}') where event_id='due5'`))).rows[0]
  assert.equal(row.user_id, A); assert.equal(row.reminder_mins, 5); assert.equal(row.recurrence, 'none'); assert.equal(new Date(row.start_at).toISOString(), '2026-11-20T20:00:00.000Z')
})
test('indexes exist as designed (unique endpoint; partial indexes for reminders and unfinished deliveries)', { skip: SKIP }, async () => {
  const idx = (await db.query(`select indexname, indexdef from pg_indexes where schemaname='public' and indexname in ('push_subscriptions_endpoint_key','push_subscriptions_user_idx','reminder_deliveries_created_idx','reminder_deliveries_unfinished_idx','schedule_events_reminder_idx')`)).rows
  const by = Object.fromEntries(idx.map(i => [i.indexname, i.indexdef]))
  assert.equal(idx.length, 5)
  assert.match(by.push_subscriptions_endpoint_key, /UNIQUE INDEX/)
  assert.match(by.reminder_deliveries_unfinished_idx, /WHERE .*status.*pending.*failed/i)
  assert.match(by.schedule_events_reminder_idx, /WHERE \(reminder_mins IS NOT NULL\)/)
})
test('027 changes nothing that already existed: no policy, column, constraint or privilege on the existing tables is altered', { skip: SKIP }, async () => {
  const fresh = new PGlite()
  await fresh.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role; alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
  await fresh.exec(/create or replace function public\.handle_updated_at\(\)[\s\S]*?\$\$;/.exec(mig('002_reminders.sql'))[0])
  for (const f of ['004_core_data_tables.sql', '022_schedule_events.sql', '023_schedule_sync.sql', '024_schedule_task_sync.sql']) await fresh.exec(mig(f))
  const snap = async d => JSON.stringify([
    (await d.query(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename not in ('push_subscriptions','reminder_deliveries') order by 1,2`)).rows,
    (await d.query(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name not in ('push_subscriptions','reminder_deliveries') order by 1,2`)).rows,
    (await d.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in ('push_subscriptions','reminder_deliveries') order by 1,2`)).rows,
    (await d.query(`select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name not in ('push_subscriptions','reminder_deliveries') order by 1,2,3`)).rows,
  ])
  const before = await snap(fresh); await fresh.exec(mig('027_schedule_reminders_push.sql')); const after = await snap(fresh)
  assert.equal(after, before)
})
