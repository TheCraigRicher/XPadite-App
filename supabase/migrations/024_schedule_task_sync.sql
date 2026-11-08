-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 024_schedule_task_sync
-- v1.328 final pass — (1) stale whole-day overwrite protection, (2) "Sync with Task Manager" preference + ordinary-event tasks.
-- DEPENDS ON 022 and 023. Idempotent; ADDITIVE ONLY (create or replace of 023's own, never-yet-applied functions is the only "replace").
--
-- HOW TO APPLY (NOT applied automatically — review first): SQL Editor → paste → Run, development/Preview project first.
--
-- 1. calendar_days.rev — a revision the SERVER advances on every change to a day's document (a trigger, so it can not be forgotten
--    or forged by a client). A write that names the revision it was based on (calendar_day_save) is refused if the day has moved on:
--    the caller gets the current document back and merges. So a stale tab / device can never silently overwrite newer data.
--    Writers that do NOT use calendar_day_save (an old cached app version, a manual SQL edit) still advance rev, so every protected
--    writer will notice their change; they themselves are not blocked (see "enforcement" at the end).
-- 2. user_preferences.schedule_task_sync — the per-user "Sync with Task Manager" switch (default OFF).
-- 3. schedule_apply v2 — also manages ORDINARY-event tasks (id prefix 'ev-', on the event's start date) next to deadline tasks
--    ('dl-', on the end date); can convert one into the other (deadline flag toggled) keeping every piece of user work; carries a
--    task's sub-tasks along when it moves; reports each changed day's new revision.
-- SECURITY: SECURITY INVOKER everywhere (RLS + the paywall policies still apply), owner always auth.uid(), EXECUTE for `authenticated` only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. calendar_days.rev ────────────────────────────────────────────────────
alter table public.calendar_days add column if not exists rev integer not null default 1;

create or replace function public.calendar_days_bump_rev()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- only the server decides the revision; a client-supplied value is ignored. An update that changes nothing keeps it.
  if new.day_data is distinct from old.day_data then new.rev := old.rev + 1; else new.rev := old.rev; end if;
  return new;
end;
$$;

drop trigger if exists calendar_days_bump_rev on public.calendar_days;
create trigger calendar_days_bump_rev
  before update on public.calendar_days
  for each row execute function public.calendar_days_bump_rev();

revoke all on function public.calendar_days_bump_rev() from public, anon, authenticated;

-- ─── 2. the per-user preference ──────────────────────────────────────────────
alter table public.user_preferences add column if not exists schedule_task_sync boolean not null default false;

create or replace function public.schedule_set_sync(p_enabled boolean)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_enabled is null then raise exception 'bad_value' using errcode = '22023'; end if;
  insert into user_preferences (user_id, schedule_task_sync) values (uid, p_enabled)
  on conflict (user_id) do update set schedule_task_sync = excluded.schedule_task_sync
  returning schedule_task_sync into r;
  return r;
end;
$$;

-- ─── 3. calendar_day_save: compare-and-swap write of one day document ────────
-- Returns {"ok":true,"rev":N}                      — written; N is the new revision
--      or {"ok":false,"rev":N,"doc":{...}|null}    — NOT written: the day is at revision N (doc = its current content, null = no row).
-- p_expected_rev = the revision the caller's copy was based on (null/0 = "there is no row yet").
create or replace function public.calendar_day_save(p_date_key text, p_doc jsonb, p_expected_rev integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  cur_rev integer;
  cur_doc jsonb;
  new_rev integer;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_date_key is null or p_date_key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_key' using errcode = '22023'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'bad_doc' using errcode = '22023'; end if;

  select rev, day_data into cur_rev, cur_doc from calendar_days where user_id = uid and date_key = p_date_key for update;
  if not found then
    if coalesce(p_expected_rev, 0) > 0 then
      return jsonb_build_object('ok', false, 'rev', 0, 'doc', null);       -- the caller believed a row existed; it does not (deleted elsewhere)
    end if;
    begin
      insert into calendar_days (user_id, date_key, day_data) values (uid, p_date_key, p_doc) returning rev into new_rev;
    exception when unique_violation then                                      -- someone created it a moment ago
      select rev, day_data into cur_rev, cur_doc from calendar_days where user_id = uid and date_key = p_date_key;
      return jsonb_build_object('ok', false, 'rev', cur_rev, 'doc', cur_doc);
    end;
    return jsonb_build_object('ok', true, 'rev', new_rev);
  end if;

  if p_expected_rev is null or p_expected_rev <> cur_rev then
    return jsonb_build_object('ok', false, 'rev', cur_rev, 'doc', cur_doc);
  end if;
  update calendar_days set day_data = p_doc where user_id = uid and date_key = p_date_key returning rev into new_rev;
  return jsonb_build_object('ok', true, 'rev', new_rev);
end;
$$;

-- ─── 4. schedule_apply v2 ────────────────────────────────────────────────────
-- Ops (max 6), applied in order, each BY TASK ID on the CURRENT server copy of the day, under a row lock:
--   upsert  {date_key, task_id, event_id, task{text,...}}   create if absent, else set text + sourceEventId (nothing else changes)
--   remove  {date_key, task_id}                              delete if untouched, else keep and unlink (user work is never destroyed)
--   unlink  {date_key, task_id}                              drop sourceEventId
--   move    {date_key, from_key, task_id, [from_task_id], event_id, task{text}}
--           carries the WHOLE task (sessions, notes, completion…) AND its sub-tasks from from_key to date_key; if from_task_id differs
--           from task_id the task is re-keyed on the way (ordinary ↔ deadline conversion); same-day re-key is allowed.
-- Task ids must start 'dl-' (deadline) or 'ev-' (ordinary synced event); nothing else can be touched.
-- Returns {"rev": <event rev or null>, "days": {key: doc}, "revs": {key: revision}}.
create or replace function public.schedule_apply(p_event jsonb, p_delete_event_id text, p_expected_rev integer, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  eid        text;
  cur_rev    integer;
  cur_link   text;
  new_link   text;
  new_rev    integer := null;
  op         jsonb;
  kind       text;
  dkey       text;
  tid        text;
  fid        text;
  fkey       text;
  doc        jsonb;
  tasks      jsonb;
  elem       jsonb;
  merged     jsonb;
  out_tasks  jsonb;
  seen       boolean;
  moved      jsonb;
  kids       jsonb;
  base_t     jsonb;
  drev       integer;
  days_out   jsonb := '{}'::jsonb;
  revs_out   jsonb := '{}'::jsonb;
  empty_day  constant jsonb := '{"productive":false,"hyper":false,"notes":"","tasks":[],"journal":""}'::jsonb;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_event is not null and jsonb_typeof(p_event) = 'null' then p_event := null; end if;
  if p_ops is not null and jsonb_typeof(p_ops) = 'null' then p_ops := null; end if;
  if p_ops is not null and (jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 6) then raise exception 'bad_ops' using errcode = '22023'; end if;

  -- ── event ──
  if p_event is not null then
    eid := p_event->>'event_id';
    if eid is null or eid = '' then raise exception 'bad_event' using errcode = '22023'; end if;
    select rev, task_link into cur_rev, cur_link from schedule_events where user_id = uid and event_id = eid for update;
    if found then
      new_link := case when p_event ? 'task_link' then p_event->>'task_link' else cur_link end;
      if p_expected_rev is not null and cur_rev <> p_expected_rev then
        raise exception 'schedule_conflict' using errcode = 'XS409', detail = cur_rev::text;
      end if;
      update schedule_events set
        title         = p_event->>'title',
        category      = coalesce(p_event->>'category', category),
        start_at      = (p_event->>'start_at')::timestamptz,
        end_at        = (p_event->>'end_at')::timestamptz,
        location      = p_event->>'location',
        meeting_url   = p_event->>'meeting_url',
        notes         = p_event->>'notes',
        reminder_mins = (p_event->>'reminder_mins')::integer,
        recurrence    = coalesce(p_event->>'recurrence', recurrence),
        is_deadline   = coalesce((p_event->>'is_deadline')::boolean, false),
        task_date_key = case when new_link = 'detached' then null else p_event->>'task_date_key' end,
        task_link     = new_link,
        rev           = cur_rev + 1
      where user_id = uid and event_id = eid
      returning rev into new_rev;
    else
      insert into schedule_events (user_id, event_id, title, category, start_at, end_at, location, meeting_url, notes,
                                   reminder_mins, recurrence, is_deadline, task_date_key, task_link, rev)
      values (uid, eid, p_event->>'title', coalesce(p_event->>'category', 'meeting'), (p_event->>'start_at')::timestamptz,
              (p_event->>'end_at')::timestamptz, p_event->>'location', p_event->>'meeting_url', p_event->>'notes',
              (p_event->>'reminder_mins')::integer, coalesce(p_event->>'recurrence', 'none'),
              coalesce((p_event->>'is_deadline')::boolean, false), p_event->>'task_date_key',
              coalesce(p_event->>'task_link', 'linked'), 1)
      returning rev into new_rev;
    end if;
  end if;

  if p_delete_event_id is not null then
    delete from schedule_events where user_id = uid and event_id = p_delete_event_id;
  end if;

  -- ── linked-task operations ──
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    kind := op->>'kind';
    dkey := op->>'date_key';
    tid  := op->>'task_id';
    fid  := coalesce(op->>'from_task_id', tid);
    if kind not in ('upsert', 'remove', 'unlink', 'move') or dkey !~ '^\d{4}-\d{2}-\d{2}$'
       or tid is null or (tid not like 'dl-%' and tid not like 'ev-%')
       or (fid not like 'dl-%' and fid not like 'ev-%') then
      raise exception 'bad_op' using errcode = '22023';
    end if;

    if kind = 'move' then
      fkey := op->>'from_key';
      if fkey is null or fkey !~ '^\d{4}-\d{2}-\d{2}$' or (fkey = dkey and fid = tid) then raise exception 'bad_op' using errcode = '22023'; end if;
      insert into calendar_days (user_id, date_key, day_data) values (uid, dkey, empty_day) on conflict (user_id, date_key) do nothing;
      perform 1 from calendar_days where user_id = uid and date_key in (dkey, fkey) order by date_key for update;   -- fixed lock order
      moved := null; kids := '[]'::jsonb;
      select day_data into doc from calendar_days where user_id = uid and date_key = fkey;
      if found then
        tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
        out_tasks := '[]'::jsonb;
        for elem in select * from jsonb_array_elements(tasks) loop
          if elem->>'id' = fid then
            if moved is null then moved := elem; end if;
          elsif elem->>'parentTaskId' = fid then
            kids := kids || jsonb_build_array(elem);                                     -- sub-tasks travel with their parent
          else
            out_tasks := out_tasks || jsonb_build_array(elem);
          end if;
        end loop;
        doc := jsonb_set(doc, '{tasks}', out_tasks);
        update calendar_days set day_data = doc where user_id = uid and date_key = fkey returning rev into drev;
        days_out := days_out || jsonb_build_object(fkey, doc); revs_out := revs_out || jsonb_build_object(fkey, drev);
      end if;
      select day_data into doc from calendar_days where user_id = uid and date_key = dkey;
      tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
      out_tasks := '[]'::jsonb; seen := false; base_t := null;
      for elem in select * from jsonb_array_elements(tasks) loop
        if elem->>'id' = tid then
          if not seen then
            base_t := case when moved is not null and not public.schedule_task_has_progress(elem, tasks) and public.schedule_task_has_progress(moved, tasks || kids) then moved else elem end;
            out_tasks := out_tasks || jsonb_build_array(base_t || jsonb_build_object('id', tid, 'text', op->'task'->>'text', 'sourceEventId', op->>'event_id'));
            seen := true;
          end if;
        elsif not exists (select 1 from jsonb_array_elements(kids) k where k->>'id' = elem->>'id') then
          out_tasks := out_tasks || jsonb_build_array(elem);
        end if;
      end loop;
      if not seen then
        base_t := coalesce(moved, (op->'task') || jsonb_build_object('id', tid));
        out_tasks := out_tasks || jsonb_build_array(base_t || jsonb_build_object('id', tid, 'text', op->'task'->>'text', 'sourceEventId', op->>'event_id'));
      end if;
      -- the carried sub-tasks, re-parented to the (possibly re-keyed) task
      for elem in select * from jsonb_array_elements(kids) loop
        out_tasks := out_tasks || jsonb_build_array(elem || jsonb_build_object('parentTaskId', tid));
      end loop;
      doc := jsonb_set(doc, '{tasks}', out_tasks);
      update calendar_days set day_data = doc where user_id = uid and date_key = dkey returning rev into drev;
      days_out := days_out || jsonb_build_object(dkey, doc); revs_out := revs_out || jsonb_build_object(dkey, drev);
      continue;
    end if;

    if kind = 'upsert' then
      insert into calendar_days (user_id, date_key, day_data) values (uid, dkey, empty_day) on conflict (user_id, date_key) do nothing;
    end if;
    select day_data into doc from calendar_days where user_id = uid and date_key = dkey for update;
    if not found then continue; end if;

    tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
    out_tasks := '[]'::jsonb;
    seen := false;

    for elem in select * from jsonb_array_elements(tasks) loop
      if elem->>'id' is distinct from tid then
        out_tasks := out_tasks || jsonb_build_array(elem);
        continue;
      end if;
      if kind = 'upsert' then
        if not seen then
          merged := elem || jsonb_build_object('text', op->'task'->>'text', 'sourceEventId', op->>'event_id');
          out_tasks := out_tasks || jsonb_build_array(merged);
          seen := true;
        end if;
      elsif kind = 'unlink' then
        out_tasks := out_tasks || jsonb_build_array(elem - 'sourceEventId');
      else
        if public.schedule_task_has_progress(elem, tasks) then
          out_tasks := out_tasks || jsonb_build_array(elem - 'sourceEventId');
        end if;
      end if;
    end loop;

    if kind = 'upsert' and not seen then
      out_tasks := out_tasks || jsonb_build_array((op->'task') || jsonb_build_object('id', tid, 'sourceEventId', op->>'event_id'));
    end if;

    doc := jsonb_set(doc, '{tasks}', out_tasks);
    update calendar_days set day_data = doc where user_id = uid and date_key = dkey returning rev into drev;
    days_out := days_out || jsonb_build_object(dkey, doc); revs_out := revs_out || jsonb_build_object(dkey, drev);
  end loop;

  return jsonb_build_object('rev', new_rev, 'days', days_out, 'revs', revs_out);
end;
$$;

-- ─── 5. privileges ───────────────────────────────────────────────────────────
revoke all on function public.schedule_set_sync(boolean) from public, anon;
revoke all on function public.calendar_day_save(text, jsonb, integer) from public, anon;
revoke all on function public.schedule_apply(jsonb, text, integer, jsonb) from public, anon;
grant execute on function public.schedule_set_sync(boolean) to authenticated;
grant execute on function public.calendar_day_save(text, jsonb, integer) to authenticated;
grant execute on function public.schedule_apply(jsonb, text, integer, jsonb) to authenticated;

-- ─── 6. paywall policies for schedule_events (re-runnable) ───────────────────
-- Same restrictive write policies migration 016 puts on the other data tables. If billing 016 is applied AFTER this migration, re-run THIS file
-- (never 023: 023 holds the OLDER versions of the functions above and re-running it would replace them) so these policies get created.
do $$
begin
  if to_regprocedure('public.billing_has_access(uuid)') is not null then
    drop policy if exists billing_paywall_insert on public.schedule_events;
    drop policy if exists billing_paywall_update on public.schedule_events;
    create policy billing_paywall_insert on public.schedule_events as restrictive for insert to authenticated
      with check ((select public.billing_has_access()));
    create policy billing_paywall_update on public.schedule_events as restrictive for update to authenticated
      using ((select public.billing_has_access())) with check ((select public.billing_has_access()));
  end if;
end
$$;

-- ─── ENFORCEMENT (deliberately NOT done here) ────────────────────────────────
-- Older app versions (and any browser tab still running one) write days with a plain upsert that carries no revision, so they
-- are NOT protected by calendar_day_save, although their writes do advance rev (so protected writers notice and merge).
-- Once every device runs the new version, the gap can be closed with a follow-up migration such as:
--     revoke insert, update on public.calendar_days from authenticated;
-- That would also stop the SECURITY INVOKER functions above, so real enforcement means re-creating calendar_day_save / schedule_apply as
-- SECURITY DEFINER with strict auth.uid() scoping — a separate, deliberate security review. Doing any of it now would lock out every device
-- that has not updated, so it is intentionally left for you to schedule.
