-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- v1.329 — live validation of migration 024 (stale-write protection, "Sync with Task Manager" preference, ordinary-event tasks).
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
  r jsonb; n integer; rv integer; t jsonb;
  doc0 constant jsonb := '{"productive":false,"hyper":false,"notes":"","journal":"","tasks":[{"id":"a","text":"A","done":false,"sessions":[]}]}'::jsonb;
  doc1 constant jsonb := '{"productive":false,"hyper":false,"notes":"","journal":"","tasks":[{"id":"a","text":"A","done":true,"sessions":[]}]}'::jsonb;
  doc2 constant jsonb := '{"productive":false,"hyper":false,"notes":"","journal":"","tasks":[{"id":"a","text":"A","done":false,"sessions":[]},{"id":"b","text":"B","done":false,"sessions":[]}]}'::jsonb;
  op_ev constant jsonb := '[{"kind":"upsert","date_key":"2099-03-01","task_id":"ev-zz-val-2","event_id":"zz-val-2","task":{"id":"ev-zz-val-2","text":"Class","done":false,"journal":"","timerStart":null,"timerEnd":null,"actId":"a","sessions":[]}}]'::jsonb;
  op_conv constant jsonb := '[{"kind":"move","date_key":"2099-03-03","from_key":"2099-03-01","from_task_id":"ev-zz-val-2","task_id":"dl-zz-val-2","event_id":"zz-val-2","task":{"text":"Class"}}]'::jsonb;
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

  -- ── 1. structure ──
  if not exists (select 1 from information_schema.columns where table_name = 'calendar_days' and column_name = 'rev') then raise exception 'CHECK 1a FAILED: calendar_days.rev missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'calendar_days_bump_rev' and not tgisinternal) then raise exception 'CHECK 1b FAILED: the revision trigger is missing'; end if;
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('calendar_day_save', 'schedule_set_sync', 'schedule_apply') and not prosecdef;
  if n <> 3 then raise exception 'CHECK 1c FAILED: calendar_day_save / schedule_set_sync / schedule_apply must exist and be SECURITY INVOKER (found %)', n; end if;
  if has_function_privilege('anon', 'public.calendar_day_save(text,jsonb,integer)', 'execute') then raise exception 'CHECK 1d FAILED: anon can execute calendar_day_save'; end if;
  if has_function_privilege('anon', 'public.schedule_set_sync(boolean)', 'execute') then raise exception 'CHECK 1e FAILED: anon can execute schedule_set_sync'; end if;
  if (select column_default from information_schema.columns where table_name = 'user_preferences' and column_name = 'schedule_task_sync') <> 'false' then raise exception 'CHECK 1f FAILED: schedule_task_sync must default to false (OFF)'; end if;
  lg := lg || '1 ok; '; raise notice 'CHECK 1 ok: structure, invoker functions, no anon access, preference defaults to OFF';

  -- ── 2. account A: compare-and-swap ──
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.calendar_day_save('2099-02-01', doc0, null);
  if not (r->>'ok')::boolean or (r->>'rev')::int <> 1 then raise exception 'CHECK 2a FAILED: first write should succeed at revision 1, got %', r; end if;
  r := public.calendar_day_save('2099-02-01', doc1, 1);
  if not (r->>'ok')::boolean or (r->>'rev')::int <> 2 then raise exception 'CHECK 2b FAILED: a write on the current revision should succeed at revision 2, got %', r; end if;
  r := public.calendar_day_save('2099-02-01', doc2, 1);
  if (r->>'ok')::boolean then raise exception 'CHECK 2c FAILED: a STALE write (revision 1) was accepted'; end if;
  if (r->'doc'->'tasks'->0->>'done')::boolean is not true or (r->>'rev')::int <> 2 then raise exception 'CHECK 2d FAILED: the refusal must return the current document and revision, got %', r; end if;
  select day_data into t from calendar_days where date_key = '2099-02-01';
  if t <> doc1 then raise exception 'CHECK 2e FAILED: the refused write changed the stored day'; end if;
  r := public.calendar_day_save('2099-02-01', doc1, 2);
  if not (r->>'ok')::boolean or (r->>'rev')::int <> 2 then raise exception 'CHECK 2f FAILED: re-sending identical content (lost-response retry) must be harmless, got %', r; end if;
  lg := lg || '2 ok; '; raise notice 'CHECK 2 ok: stale write refused with the current document; nothing overwritten; identical retry harmless';

  -- ── 3. the revision is server-owned (trigger) and advances for ANY writer ──
  update calendar_days set day_data = doc2, rev = 999 where date_key = '2099-02-01';
  select rev into rv from calendar_days where date_key = '2099-02-01';
  if rv <> 3 then raise exception 'CHECK 3a FAILED: a plain (legacy) update must advance the revision by exactly one and ignore a forged value, got %', rv; end if;
  r := public.calendar_day_save('2099-02-01', doc1, 2);
  if (r->>'ok')::boolean then raise exception 'CHECK 3b FAILED: a protected writer based on revision 2 must now be refused (a legacy write moved the day on)'; end if;
  lg := lg || '3 ok; '; raise notice 'CHECK 3 ok: revision is advanced by the server for every writer; protected writers notice legacy writes';

  -- ── 4. account B can not touch A's days or preferences ──
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', ub::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from calendar_days where date_key = '2099-02-01';
  if n <> 0 then raise exception 'CHECK 4a FAILED: B can read the day of A'; end if;
  r := public.calendar_day_save('2099-02-01', '{"tasks":[]}'::jsonb, 3);
  if (r->>'ok')::boolean then raise exception 'CHECK 4b FAILED: B wrote using the revision of A'; end if;
  update calendar_days set day_data = '{}' where date_key = '2099-02-01';
  get diagnostics n = row_count; if n <> 0 then raise exception 'CHECK 4c FAILED: B updated the day of A'; end if;
  perform public.schedule_set_sync(true);
  execute 'reset role';
  if (select schedule_task_sync from user_preferences where user_id = ua) is true then raise exception 'CHECK 4d FAILED: B changed the sync preference of A'; end if;
  if (select schedule_task_sync from user_preferences where user_id = ub) is not true then raise exception 'CHECK 4e FAILED: B could not save their own preference'; end if;
  select day_data into t from calendar_days where user_id = ua and date_key = '2099-02-01';
  if t <> doc2 then raise exception 'CHECK 4f FAILED: the day of A was altered by B'; end if;
  lg := lg || '4 ok; '; raise notice 'CHECK 4 ok: B can not read, write or take over the days / preference of A; B saves their own preference';

  -- ── 5. ordinary-event task + conversion to a deadline task (A) ──
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.schedule_apply(null, null, null, op_ev);
  update calendar_days set day_data = jsonb_set(day_data, '{tasks,0,done}', 'true') where date_key = '2099-03-01';       -- the user completes it
  r := public.schedule_apply(null, null, null, op_conv);
  select day_data into t from calendar_days where date_key = '2099-03-03';
  if t->'tasks'->0->>'id' <> 'dl-zz-val-2' or (t->'tasks'->0->>'done')::boolean is not true then raise exception 'CHECK 5a FAILED: the ordinary task did not convert to the deadline task with its work kept: %', t; end if;
  select jsonb_array_length(day_data->'tasks') into n from calendar_days where date_key = '2099-03-01';
  if n <> 0 then raise exception 'CHECK 5b FAILED: the old copy was left behind (two tasks for one event)'; end if;
  begin
    perform public.schedule_apply(null, null, null, '[{"kind":"remove","date_key":"2099-03-03","task_id":"my-own-task"}]'::jsonb);
    raise exception 'CHECK 5c FAILED: schedule_apply accepted a task id that is not dl-/ev-';
  exception when sqlstate '22023' then null; end;
  execute 'reset role';
  lg := lg || '5 ok; '; raise notice 'CHECK 5 ok: ordinary → deadline conversion keeps the work; only dl-/ev- ids can be touched';

  -- ── 6. anon ──
  execute 'set local role anon';
  begin perform public.calendar_day_save('2099-02-01', doc0, null); raise exception 'CHECK 6a FAILED: anon executed calendar_day_save'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  lg := lg || '6 ok; '; raise notice 'CHECK 6 ok: anon refused';

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
