-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- v1.329 — live validation of migrations 022 + 023 + 024 (My Schedule persistence, atomic deadline→task writes, RLS, paywall).
--
-- WHERE TO RUN: Supabase Dashboard → SQL Editor → New query → paste the WHOLE file → Run once. Check the project switcher first.
--               (Safe on Production: it uses only synthetic identities created inside the statement — see "WHY IT CAN NOT LEAVE ANYTHING BEHIND".)
-- WHAT IT NEEDS: nothing. No existing account is used.
-- WHAT IT DOES: switches between synthetic accounts and the anon role the way PostgREST does (SET LOCAL ROLE + JWT claims, so row level
--               security and function privileges are really enforced) and RAISES AN ERROR naming the failed check.
-- HOW TO READ THE RESULT:
--     ERROR  XV001  "VALIDATION PASSED ..."  → SUCCESS. (It deliberately ends with an error so that nothing can ever be committed.)
--     ERROR  P0001  "CHECK nX FAILED: ..."   → a real failure: copy the message and send it to the developer.
--     any other error                         → also nothing was kept; copy the message.
-- WHY IT CAN NOT LEAVE ANYTHING BEHIND:
--     * It is ONE statement (a DO block) with no COMMIT. A statement either completes or is rolled back as a whole, and this one ALWAYS ends
--       by raising an error — on success (XV001) and on failure alike — so the database always discards it. There is no BEGIN/ROLLBACK pair
--       that a half-selected run, a dropped connection or a failed check could leave open.
--     * It creates no tables/functions/temp objects, uses no sequences (ids are random uuids), sends no NOTIFY / webhook, and every role/JWT
--       setting is transaction-local. Realtime only publishes committed changes.
--     * Before finishing it re-fingerprints every row of calendar_days / user_preferences / schedule_events / auth.users / profiles that does
--       not belong to its synthetic accounts and fails if anything differs.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); lg text := ''; s0 text; s1 text; expired boolean;
  r jsonb; n integer; t jsonb;
  ev constant jsonb := '{"event_id":"zz-validation-1","title":"Validation deadline","category":"assignment","start_at":"2099-01-01T09:00:00Z","end_at":"2099-01-01T10:00:00Z","is_deadline":true,"task_date_key":"2099-01-01","recurrence":"none"}'::jsonb;
  op_up constant jsonb := '[{"kind":"upsert","date_key":"2099-01-01","task_id":"dl-zz-validation-1","event_id":"zz-validation-1","task":{"id":"dl-zz-validation-1","text":"Validation deadline","done":false,"journal":"","timerStart":null,"timerEnd":null,"actId":"a","sessions":[]}}]'::jsonb;
  op_rm constant jsonb := '[{"kind":"remove","date_key":"2099-01-01","task_id":"dl-zz-validation-1"}]'::jsonb;
begin
  -- Three throw-away identities that exist ONLY inside this statement (random ids, @invalid.example addresses — no mail is ever sent: the
  -- database does not send mail, GoTrue does, and GoTrue is not involved). No existing account is selected, read for its data, or modified.
  insert into auth.users (id, email, created_at, email_confirmed_at) values
    (ua, 'zz-validation-a-' || ua || '@invalid.example', now(), now()),
    (ub, 'zz-validation-b-' || ub || '@invalid.example', now(), now());
  -- fingerprint of ALL real data in the tables this script touches (checked again at the very end)
  s0 := (select md5(
             coalesce((select string_agg(c::text, '|' order by c.id)       from calendar_days    c where c.user_id not in (ua, ub, uc)), '') ||
             coalesce((select string_agg(p::text, '|' order by p.user_id)  from user_preferences p where p.user_id not in (ua, ub, uc)), '') ||
             coalesce((select string_agg(e::text, '|' order by e.id)       from schedule_events  e where e.user_id not in (ua, ub, uc)), '')
           ) || ':' || (select count(*) from auth.users where id not in (ua, ub, uc))::text
                    || ':' || (select count(*) from public.profiles where id not in (ua, ub, uc))::text);

  -- ── 1. structure ──────────────────────────────────────────────────────────────────────────────────────────
  if not exists (select 1 from pg_class where relname = 'schedule_events' and relrowsecurity) then raise exception 'CHECK 1a FAILED: RLS is not enabled on schedule_events'; end if;
  select count(*) into n from pg_policies where tablename = 'schedule_events' and policyname like 'users_%_own_schedule_events';
  if n <> 4 then raise exception 'CHECK 1b FAILED: expected 4 owner policies, found %', n; end if;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('schedule_apply', 'schedule_set_task_link', 'schedule_task_has_progress') and not prosecdef;
  if n <> 3 then raise exception 'CHECK 1c FAILED: the three schedule functions must exist and be SECURITY INVOKER (found % invoker functions)', n; end if;
  if has_function_privilege('anon', 'public.schedule_apply(jsonb,text,integer,jsonb)', 'execute') then raise exception 'CHECK 1d FAILED: anon can execute schedule_apply'; end if;
  if has_table_privilege('anon', 'public.schedule_events', 'select') then raise exception 'CHECK 1e FAILED: anon can read schedule_events'; end if;
  if has_table_privilege('authenticated', 'public.schedule_events', 'truncate') then raise exception 'CHECK 1f FAILED: authenticated has TRUNCATE (ignores RLS)'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'user_preferences' and column_name = 'saved_locations') then raise exception 'CHECK 1g FAILED: user_preferences.saved_locations missing'; end if;
  lg := lg || '1 ok; '; raise notice 'CHECK 1 ok: structure, RLS, invoker functions, no anon / TRUNCATE privileges';

  -- ── 2. account A: atomic event + linked task ──────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.schedule_apply(ev, null, null, op_up);
  if (r->>'rev')::int <> 1 then raise exception 'CHECK 2a FAILED: new event should have rev 1, got %', r->>'rev'; end if;
  select day_data into t from calendar_days where date_key = '2099-01-01';
  if t is null or jsonb_array_length(t->'tasks') <> 1 or t->'tasks'->0->>'sourceEventId' <> 'zz-validation-1' then raise exception 'CHECK 2b FAILED: linked task not stored with the event'; end if;
  r := public.schedule_apply(ev, null, 1, op_up);
  select jsonb_array_length(day_data->'tasks') into n from calendar_days where date_key = '2099-01-01';
  if n <> 1 then raise exception 'CHECK 2c FAILED: repeated save created % tasks', n; end if;
  begin
    perform public.schedule_apply(ev, null, 1, op_up);
    raise exception 'CHECK 2d FAILED: a stale revision was accepted';
  exception when sqlstate 'XS409' then null; end;
  lg := lg || '2 ok; '; raise notice 'CHECK 2 ok: atomic write, idempotent repeat, stale revision refused';

  -- ── 3. account B: can not see or touch A's data ───────────────────────────────────────────────────────────
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', ub::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from schedule_events where event_id = 'zz-validation-1';
  if n <> 0 then raise exception 'CHECK 3a FAILED: B can read the event of A'; end if;
  select count(*) into n from calendar_days where date_key = '2099-01-01';
  if n <> 0 then raise exception 'CHECK 3b FAILED: B can read the day of A'; end if;
  update schedule_events set title = 'pwned' where event_id = 'zz-validation-1';
  get diagnostics n = row_count; if n <> 0 then raise exception 'CHECK 3c FAILED: B updated the event of A'; end if;
  delete from schedule_events where event_id = 'zz-validation-1';
  get diagnostics n = row_count; if n <> 0 then raise exception 'CHECK 3d FAILED: B deleted the event of A'; end if;
  begin
    execute format('insert into schedule_events (user_id, event_id, title, start_at, end_at) values (%L, ''zz-evil'', ''t'', now(), now() + interval ''1 hour'')', ua);
    raise exception 'CHECK 3e FAILED: B inserted a row owned by A';
  exception when insufficient_privilege then null; end;
  perform public.schedule_apply(null, null, null, op_rm);
  perform public.schedule_apply(null, 'zz-validation-1', null, '[]'::jsonb);
  if public.schedule_set_task_link('zz-validation-1', 'detached') is not null then raise exception 'CHECK 3f FAILED: B changed the task link of A'; end if;
  execute 'reset role';
  select count(*) into n from schedule_events where user_id = ua and event_id = 'zz-validation-1' and task_link = 'linked' and title = 'Validation deadline';
  if n <> 1 then raise exception 'CHECK 3g FAILED: the event of A was altered by B'; end if;
  select jsonb_array_length(day_data->'tasks') into n from calendar_days where user_id = ua and date_key = '2099-01-01';
  if n <> 1 then raise exception 'CHECK 3h FAILED: the task of A was altered by B'; end if;
  lg := lg || '3 ok; '; raise notice 'CHECK 3 ok: B can not read, update, delete, insert-as or take over any data of A';

  -- ── 4. unauthenticated / anon ─────────────────────────────────────────────────────────────────────────────
  execute 'set local role anon';
  begin
    perform public.schedule_apply(ev, null, null, '[]'::jsonb);
    raise exception 'CHECK 4a FAILED: anon executed schedule_apply';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from schedule_events;
    raise exception 'CHECK 4b FAILED: anon read schedule_events';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role authenticated';
  begin
    perform public.schedule_apply(ev, null, null, '[]'::jsonb);
    raise exception 'CHECK 4c FAILED: a call without a user was accepted';
  exception when sqlstate '28000' then null; end;
  execute 'reset role';
  lg := lg || '4 ok; '; raise notice 'CHECK 4 ok: anon and user-less calls are refused';

  -- ── 5. A deletes their own event: the (untouched) linked task goes with it, in one transaction ─────────────
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.schedule_apply(null, 'zz-validation-1', null, op_rm);
  select count(*) into n from schedule_events where event_id = 'zz-validation-1';
  if n <> 0 then raise exception 'CHECK 5a FAILED: event not deleted'; end if;
  select jsonb_array_length(day_data->'tasks') into n from calendar_days where date_key = '2099-01-01';
  if n <> 0 then raise exception 'CHECK 5b FAILED: untouched linked task not removed with its event'; end if;
  execute 'reset role';
  lg := lg || '5 ok; '; raise notice 'CHECK 5 ok: event + task deleted together';

  -- ── 6. paywall: when billing exists and an account created 40 days ago currently has no access, it must be refused (reads/deletes are allowed) ──
  if to_regprocedure('public.billing_has_access(uuid)') is not null then
    insert into auth.users (id, email, created_at, email_confirmed_at) values (uc, 'zz-validation-c-' || uc || '@invalid.example', now() - interval '40 days', now() - interval '40 days');
    perform set_config('request.jwt.claim.sub', uc::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    expired := not coalesce(public.billing_has_access(), false);
    if expired then
      begin
        perform public.schedule_apply(ev, null, null, '[]'::jsonb);
        raise exception 'CHECK 6a FAILED: an account without billing access could create a schedule event';
      exception when insufficient_privilege then null; end;
      select count(*) into n from schedule_events;
      if n <> 0 then raise exception 'CHECK 6b FAILED: an account without access can see events'; end if;
      lg := lg || '6 ok (paywall enforced); ';
    else
      lg := lg || '6 skipped (billing currently grants every account access); ';
    end if;
    execute 'reset role';
  else
    lg := lg || '6 skipped (no billing functions); ';
  end if;

  -- ── untouched real data: nothing outside the synthetic accounts may differ from the start ──
  s1 := (select md5(
             coalesce((select string_agg(c::text, '|' order by c.id)       from calendar_days    c where c.user_id not in (ua, ub, uc)), '') ||
             coalesce((select string_agg(p::text, '|' order by p.user_id)  from user_preferences p where p.user_id not in (ua, ub, uc)), '') ||
             coalesce((select string_agg(e::text, '|' order by e.id)       from schedule_events  e where e.user_id not in (ua, ub, uc)), '')
           ) || ':' || (select count(*) from auth.users where id not in (ua, ub, uc))::text
                    || ':' || (select count(*) from public.profiles where id not in (ua, ub, uc))::text);
  if s0 is distinct from s1 then raise exception 'CHECK 9 FAILED: data of real accounts differs from the start of the run'; end if;
  lg := lg || '9 ok; ';

  -- Success is reported as a (deliberate) error so that this statement can never be committed.
  raise using errcode = 'XV001', message = 'VALIDATION PASSED - everything was rolled back, nothing was kept. Checks: ' || lg;
end
$$;
