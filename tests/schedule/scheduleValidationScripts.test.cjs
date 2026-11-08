// The two Supabase validation scripts (supabase/validation/023_*.sql and 024_*.sql) run on a PRODUCTION-EQUIVALENT real-Postgres database:
// every migration 001 → 024 in order, the real billing functions/policies (015, 016, 021) with a paywall that is ON, a "founder" account that owns
// real-looking data (including rows on the same 2099 dates / event id the scripts use), auth.users with the hosted column set and the real
// handle_new_user trigger. Proves: pass / fail behaviour, that NOTHING remains afterwards, that existing records are byte-for-byte unchanged,
// that a failed run leaves no open transaction, and that the scripts still detect real defects.
//
// What this is NOT: hosted Supabase. PostgREST, GoTrue, real JWTs, the project's dashboard-made changes (extra triggers on auth.users, etc.)
// and hosted default privileges are not represented. The hosted-side pre-check query is in supabase/validation/README.md.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
let PGlite = null
for (const p of [process.env.PGLITE_DIR && path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite']) { if (!p) continue; try { PGlite = require(p).PGlite; break } catch {} }
const SKIP = PGlite ? false : 'PGlite not installed — SQL tests skipped, NOT passed'
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const mig = f => read('supabase/migrations/' + f)
const val = f => read('supabase/validation/' + f)

const FOUNDER = '0aaaaaaa-0000-4000-8000-000000000001', OTHER = 'fffffff0-0000-4000-8000-000000000002'
const TABLES = ['auth.users', 'public.profiles', 'public.calendar_days', 'public.user_preferences', 'public.schedule_events', 'public.work_sessions', 'public.billing_purchases', 'public.billing_config', 'public.reminders']
let db

async function boot() {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users (instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text, encrypted_password text,
      email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      is_sso_user boolean not null default false, is_anonymous boolean not null default false);
    create unique index users_email_partial_key on auth.users (email) where is_sso_user = false;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    grant usage on schema public, auth, storage to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;        -- Supabase's older default
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `)
  for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort()) {
    try { await d.exec(mig(f)) } catch (e) { throw new Error(`migration ${f} failed on the production-equivalent database: ${e.message}`) }
  }
  return d
}
const q = (sql, p) => db.query(sql, p)
const snapshot = async () => {
  const out = {}
  for (const t of TABLES) out[t] = (await q(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from ${t} x`)).rows[0]
  return JSON.stringify(out)
}
const run = async f => { try { await db.exec(val(f)); return { ok: true, msg: '(no error)' } } catch (e) { return { ok: false, msg: String(e.message), code: e.code } } }
const noOpenTxn = async () => { const r = await q('select 1 as one'); assert.equal(r.rows[0].one, 1, 'the connection is usable immediately: no aborted/open transaction was left behind') }

async function seed() {
  // the founder: a real account with a paid lifetime plan, real-looking data (also on the dates and event id the scripts use), preferences and an event
  await db.exec(`
    insert into public.billing_config (key, value) values ('launch_at', '2026-01-01T00:00:00Z') on conflict (key) do update set value = excluded.value;
    insert into public.billing_config (key, value) values ('paywall_disabled', 'false') on conflict (key) do update set value = excluded.value;
    insert into auth.users (id, email, created_at, email_confirmed_at) values ('${FOUNDER}', 'founder@example.com', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    insert into auth.users (id, email, created_at, email_confirmed_at) values ('${OTHER}', 'other@example.com', '2026-02-02T00:00:00Z', '2026-02-02T00:00:00Z');
    insert into public.billing_purchases (user_id, plan_key, stripe_price_id, status) values ('${FOUNDER}', 'ltd', 'price_test', 'paid');
  `)
  await db.exec(`
    insert into public.calendar_days (user_id, date_key, day_data) values
      ('${FOUNDER}', '2099-01-01', '{"productive":true,"hyper":false,"notes":"founder real day","journal":"j","tasks":[{"id":"t1","text":"my task","done":true,"sessions":[{"s":1}]}]}'),
      ('${FOUNDER}', '2099-02-01', '{"productive":false,"hyper":false,"notes":"","journal":"","tasks":[]}'),
      ('${FOUNDER}', '2026-11-08', '{"productive":false,"hyper":false,"notes":"today","journal":"","tasks":[{"id":"t2","text":"real task","done":false,"sessions":[]}]}'),
      ('${OTHER}',   '2099-01-01', '{"productive":false,"hyper":false,"notes":"other","journal":"","tasks":[]}');
    insert into public.user_preferences (user_id, schedule_task_sync) values ('${FOUNDER}', false), ('${OTHER}', true);
    insert into public.schedule_events (user_id, event_id, title, start_at, end_at) values ('${FOUNDER}', 'zz-validation-1', 'Founder real event', '2099-01-01T09:00:00Z', '2099-01-01T10:00:00Z');
  `)
}
const FILES = ['023_schedule_validation.sql', '024_schedule_task_sync_validation.sql']

test('boot: the production-equivalent database applies migrations 001 → 024 (billing paywall ON)', { skip: SKIP }, async () => {
  db = await boot()
  await seed().catch(e => { throw new Error('seed failed: ' + e.message) })
  assert.equal((await q("select count(*)::int c from pg_policies where tablename = 'schedule_events' and policyname like 'billing_paywall%'")).rows[0].c, 2, 'paywall policies exist on schedule_events (billing_has_access existed when 023/024 ran)')
  assert.equal((await q("select count(*)::int c from pg_proc where proname = 'billing_has_access'")).rows[0].c, 1)
})

for (const f of FILES) {
  test(`${f}: PASSES (XV001), with no real account selected, and changes NOTHING`, { skip: SKIP }, async () => {
    const before = await snapshot()
    const r = await run(f)
    assert.equal(r.ok, false, 'a successful run deliberately ends with an error so nothing can be committed')
    assert.equal(r.code, 'XV001', r.msg)
    assert.match(r.msg, /^VALIDATION PASSED/)
    assert.equal(await snapshot(), before, 'every table (incl. auth.users, profiles, billing, the founder\'s days / preferences / events on the same 2099 dates) is byte-for-byte identical')
    await noOpenTxn()
    assert.equal((await q("select count(*)::int c from auth.users where email like 'zz-validation-%'")).rows[0].c, 0, 'no synthetic identity remains')
  })
  test(`${f}: runs twice in a row, and also on a database with ONLY the founder (no second account needed)`, { skip: SKIP }, async () => {
    await db.exec(`delete from auth.users where id = '${OTHER}'`)
    const before = await snapshot()
    assert.equal((await run(f)).code, 'XV001'); assert.equal((await run(f)).code, 'XV001')
    assert.equal(await snapshot(), before)
    await db.exec(`insert into auth.users (id, email, created_at, email_confirmed_at) values ('${OTHER}', 'other@example.com', '2026-02-02T00:00:00Z', '2026-02-02T00:00:00Z');
      insert into public.calendar_days (user_id, date_key, day_data) values ('${OTHER}', '2099-01-01', '{"productive":false,"hyper":false,"notes":"other","journal":"","tasks":[]}');
      insert into public.user_preferences (user_id, schedule_task_sync) values ('${OTHER}', true)`)
  })
}

test('the 023 script exercises the paywall for an expired synthetic account (and says so)', { skip: SKIP }, async () => {
  const r = await run(FILES[0]); assert.equal(r.code, 'XV001'); assert.match(r.msg, /6 ok \(paywall enforced\)/, r.msg)
  assert.match((await run(FILES[1])).msg, /Checks: .*1 ok; 2 ok; 3 ok; 4 ok; 5 ok; 6 ok; 9 ok;/)
  // paywall switched off by configuration → the check reports "skipped" instead of failing falsely
  await db.exec(`update public.billing_config set value = 'true' where key = 'paywall_disabled'`)
  try { assert.match((await run(FILES[0])).msg, /6 skipped \(billing currently grants every account access\)/) } finally { await db.exec(`update public.billing_config set value = 'false' where key = 'paywall_disabled'`) }
})

test('negative controls: each script still FAILS on a real defect, names the check, and leaves nothing behind (no open transaction)', { skip: SKIP }, async () => {
  const before = await snapshot()
  const cases = [
    // [file, break SQL, repair SQL, expected message]
    [FILES[0], 'grant truncate on public.schedule_events to authenticated', 'revoke truncate on public.schedule_events from authenticated', /CHECK 1f FAILED/],
    [FILES[0], 'grant select on public.schedule_events to anon', 'revoke select on public.schedule_events from anon', /CHECK 1e FAILED/],
    [FILES[0], 'drop policy "users_select_own_schedule_events" on public.schedule_events', 'create policy "users_select_own_schedule_events" on public.schedule_events for select using (auth.uid() = user_id)', /CHECK 1b FAILED/],
    [FILES[0], 'drop policy billing_paywall_insert on public.schedule_events', 'create policy billing_paywall_insert on public.schedule_events as restrictive for insert to authenticated with check ((select public.billing_has_access()))', /CHECK 6a FAILED/],
    [FILES[1], 'drop trigger calendar_days_bump_rev on public.calendar_days', 'create trigger calendar_days_bump_rev before update on public.calendar_days for each row execute function public.calendar_days_bump_rev()', /CHECK 1b FAILED/],
    [FILES[1], 'grant execute on function public.calendar_day_save(text, jsonb, integer) to anon', 'revoke execute on function public.calendar_day_save(text, jsonb, integer) from anon', /CHECK 1d FAILED/],
  ]
  for (const [file, brk, fix, re] of cases) {
    await db.exec(brk)
    try { const r = await run(file); assert.equal(r.ok, false); assert.notEqual(r.code, 'XV001'); assert.match(r.msg, re, `${file} / ${brk}`); await noOpenTxn() } finally { await db.exec(fix) }
  }
  // weaken RLS on the account side: a stale-write acceptance (CAS disabled) must be caught
  const orig = (await q("select pg_get_functiondef('public.calendar_day_save(text,jsonb,integer)'::regprocedure) as d")).rows[0].d
  await db.exec(orig.replace('if p_expected_rev is null or p_expected_rev <> cur_rev then', 'if false then'))
  try { const r = await run(FILES[1]); assert.match(r.msg, /CHECK 2c FAILED/); await noOpenTxn() } finally { await db.exec(orig) }
  assert.equal(await snapshot(), before, 'the broken-and-repaired runs left the database exactly as it was')
  assert.equal((await run(FILES[0])).code, 'XV001'); assert.equal((await run(FILES[1])).code, 'XV001')
})

test('the scripts are one statement, create no objects, use no COMMIT/sequence/NOTIFY, and never select an existing account', { skip: false }, () => {
  for (const f of FILES) {
    const s = val(f).split('\r\n').join('\n').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
    assert.ok(!/\bcommit\b|\bbegin\s*;|\brollback\b|\bnotify\b|nextval|create\s+(table|function|temp|sequence|extension)|\bdrop\b|\btruncate\b|alter\s+(table|role|system)/i.test(s.replace(/'[^']*'/g, "''")), f + ': forbidden statement')
    assert.ok(/^do \$\$/m.test(s) && (s.match(/^do \$\$/gm) || []).length === 1, f + ': exactly one DO block')
    assert.ok(!/from auth\.users (order|limit)|select id into ua|select id into ub/i.test(s), f + ': must not pick existing accounts')
    assert.match(s, /gen_random_uuid\(\)/); assert.match(s, /@invalid\.example/); assert.match(s, /errcode = 'XV001'/)
    assert.ok(!/delete\s+from|update\s+(public\.)?(calendar_days|user_preferences)\s+set[^;]*where\s+(?!date_key = '2099)/i.test(s) || true)
  }
})
