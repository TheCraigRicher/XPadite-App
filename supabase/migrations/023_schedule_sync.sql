-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 023_schedule_sync
-- v1.328 hardening — atomic "event + linked task" writes, optimistic concurrency, task-link choice.
-- DEPENDS ON 022_schedule_events.sql (apply 022 first). Idempotent; ADDITIVE ONLY.
--
-- HOW TO APPLY (NOT applied automatically — review first)
-- Supabase Dashboard → SQL Editor → paste → Run (development/Preview project first).
--
-- WHY
-- Tasks live inside calendar_days.day_data (one JSON document per user per day), and the app writes that
-- document whole. Writing an event and its linked task as two separate requests can leave them out of step,
-- and a plain read-modify-write of the day document can lose another device's edits. So the linked-task change
-- is done HERE, in one transaction, under a row lock:
--   * the event row and the task change commit together or not at all;
--   * the task is found and changed BY ITS ID inside the CURRENT server document — every other task,
--     and every other field of the day, is carried through untouched;
--   * the function may only ever touch tasks whose id starts with 'dl-' (deadline-linked tasks).
-- SECURITY: SECURITY INVOKER (never DEFINER) → table RLS still applies to every statement; the owner is always
-- auth.uid() (the caller can not name another user); EXECUTE is granted to `authenticated` only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. schedule_events: revision counter + task-link choice ─────────────────
-- rev        bumped by every confirmed save; a client that saves with a stale rev is refused (two tabs/devices).
-- task_link  'linked'   = keep a Task Manager task for this deadline (default);
--            'detached' = the user deleted the Task Manager task on purpose: the deadline stays in
--                         My Schedule / Calendar and reconciliation must NOT recreate the task.

alter table public.schedule_events add column if not exists rev integer not null default 1;
alter table public.schedule_events add column if not exists task_link text not null default 'linked';

alter table public.schedule_events drop constraint if exists schedule_events_task_link_ok;
alter table public.schedule_events add constraint schedule_events_task_link_ok check (task_link in ('linked', 'detached'));

-- mirror the form's own limits so a bad client can't store unbounded text
alter table public.schedule_events drop constraint if exists schedule_events_text_len;
alter table public.schedule_events add constraint schedule_events_text_len check (
  char_length(category) <= 100
  and (location is null or char_length(location) <= 200)
  and (meeting_url is null or char_length(meeting_url) <= 500)
  and (notes is null or char_length(notes) <= 2000)
  and (task_date_key is null or task_date_key ~ '^\d{4}-\d{2}-\d{2}$')
  and (reminder_mins is null or reminder_mins between 0 and 100000)
);


-- ─── 2. helper: does a task hold user work? (mirrors deadlineLink.ts taskHasProgress) ────────

create or replace function public.schedule_task_has_progress(t jsonb, all_tasks jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((t->>'done')::boolean, false)
      or jsonb_array_length(case when jsonb_typeof(t->'sessions') = 'array' then t->'sessions' else '[]'::jsonb end) > 0
      or btrim(coalesce(t->>'journal', '')) <> ''
      or coalesce((t->>'noteDone')::boolean, false)
      or (t ? 'timerStart' and jsonb_typeof(t->'timerStart') not in ('null'))
      or jsonb_array_length(case when jsonb_typeof(t->'attachments') = 'array' then t->'attachments' else '[]'::jsonb end) > 0
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(all_tasks) = 'array' then all_tasks else '[]'::jsonb end) o
                 where o->>'parentTaskId' = t->>'id');
$$;


-- ─── 3. schedule_apply: the atomic write ─────────────────────────────────────
-- p_event            event fields to upsert (jsonb) or NULL
-- p_delete_event_id  event to delete, or NULL
-- p_expected_rev     the rev the client last saw (NULL = create / idempotent retry); mismatch → error XS409
-- p_ops              ordered task operations (max 6), each:
--                      {"kind":"upsert","date_key":"2026-11-24","task_id":"dl-abc","task":{...full task...},"event_id":"abc"}
--                      {"kind":"remove","date_key":..., "task_id":"dl-abc"}   (kept + unlinked if it holds user work)
--                      {"kind":"unlink","date_key":..., "task_id":"dl-abc"}
--                      {"kind":"move","date_key":<to>,"from_key":<from>,"task_id":..,"event_id":..,"task":{"text":..}}
--                         carries the WHOLE task (sessions, notes, completion…) from one day to the other, atomically
-- returns            {"rev": <new rev or null>, "days": {"YYYY-MM-DD": <resulting day document>, ...}}

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
  doc        jsonb;
  tasks      jsonb;
  elem       jsonb;
  merged     jsonb;
  fkey       text;
  moved      jsonb;
  base_t     jsonb;
  out_tasks  jsonb;
  seen       boolean;
  days_out   jsonb := '{}'::jsonb;
  empty_day  constant jsonb := '{"productive":false,"hyper":false,"notes":"","tasks":[],"journal":""}'::jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- a JSON null (what an HTTP client sends for "no value") arrives as the jsonb VALUE 'null', not SQL NULL: treat both as absent
  if p_event is not null and jsonb_typeof(p_event) = 'null' then p_event := null; end if;
  if p_ops is not null and jsonb_typeof(p_ops) = 'null' then p_ops := null; end if;
  if p_ops is not null and (jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 6) then
    raise exception 'bad_ops' using errcode = '22023';
  end if;

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
        -- a detached deadline has no task, so no task day
        task_date_key = case when new_link = 'detached' then null else p_event->>'task_date_key' end,
        -- only changed when the client says so (a stale tab can not silently undo a "removed from Task Manager" choice)
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

  -- ── linked-task operations, in the order given ──
  for op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    kind := op->>'kind';
    dkey := op->>'date_key';
    tid  := op->>'task_id';
    if kind not in ('upsert', 'remove', 'unlink', 'move') or dkey !~ '^\d{4}-\d{2}-\d{2}$' or tid is null or tid not like 'dl-%' then
      raise exception 'bad_op' using errcode = '22023';
    end if;

    if kind = 'move' then
      fkey := op->>'from_key';
      if fkey is null or fkey !~ '^\d{4}-\d{2}-\d{2}$' or fkey = dkey then raise exception 'bad_op' using errcode = '22023'; end if;
      insert into calendar_days (user_id, date_key, day_data) values (uid, dkey, empty_day) on conflict (user_id, date_key) do nothing;
      perform 1 from calendar_days where user_id = uid and date_key in (dkey, fkey) order by date_key for update;   -- fixed lock order
      moved := null;
      select day_data into doc from calendar_days where user_id = uid and date_key = fkey;
      if found then
        out_tasks := '[]'::jsonb;
        for elem in select * from jsonb_array_elements(case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end) loop
          if elem->>'id' = tid then
            if moved is null then moved := elem; end if;
          else
            out_tasks := out_tasks || jsonb_build_array(elem);
          end if;
        end loop;
        doc := jsonb_set(doc, '{tasks}', out_tasks);
        update calendar_days set day_data = doc where user_id = uid and date_key = fkey;
        days_out := days_out || jsonb_build_object(fkey, doc);
      end if;
      select day_data into doc from calendar_days where user_id = uid and date_key = dkey;
      tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
      out_tasks := '[]'::jsonb; seen := false; base_t := null;
      for elem in select * from jsonb_array_elements(tasks) loop
        if elem->>'id' = tid then
          if not seen then
            -- a copy already on the destination day wins unless it is empty and the moved one holds work
            base_t := case when moved is not null and not public.schedule_task_has_progress(elem, tasks) and public.schedule_task_has_progress(moved, tasks) then moved else elem end;
            out_tasks := out_tasks || jsonb_build_array(base_t || jsonb_build_object('text', op->'task'->>'text', 'sourceEventId', op->>'event_id'));
            seen := true;
          end if;
        else
          out_tasks := out_tasks || jsonb_build_array(elem);
        end if;
      end loop;
      if not seen then
        base_t := coalesce(moved, (op->'task') || jsonb_build_object('id', tid));
        out_tasks := out_tasks || jsonb_build_array(base_t || jsonb_build_object('text', op->'task'->>'text', 'sourceEventId', op->>'event_id'));
      end if;
      doc := jsonb_set(doc, '{tasks}', out_tasks);
      update calendar_days set day_data = doc where user_id = uid and date_key = dkey;
      days_out := days_out || jsonb_build_object(dkey, doc);
      continue;
    end if;

    if kind = 'upsert' then
      insert into calendar_days (user_id, date_key, day_data) values (uid, dkey, empty_day) on conflict (user_id, date_key) do nothing;
    end if;
    select day_data into doc from calendar_days where user_id = uid and date_key = dkey for update;
    if not found then continue; end if;          -- remove/unlink on a day that does not exist: nothing to do

    tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
    out_tasks := '[]'::jsonb;
    seen := false;

    for elem in select * from jsonb_array_elements(tasks) loop
      if elem->>'id' is distinct from tid then
        out_tasks := out_tasks || jsonb_build_array(elem);
        continue;
      end if;
      -- elem is (a copy of) the linked task
      if kind = 'upsert' then
        if not seen then
          merged := elem || jsonb_build_object('text', op->'task'->>'text', 'sourceEventId', op->>'event_id');
          out_tasks := out_tasks || jsonb_build_array(merged);
          seen := true;
        end if;                                   -- a second copy with the same id is dropped (never two)
      elsif kind = 'unlink' then
        out_tasks := out_tasks || jsonb_build_array(elem - 'sourceEventId');
      else  -- remove
        if public.schedule_task_has_progress(elem, tasks) then
          out_tasks := out_tasks || jsonb_build_array(elem - 'sourceEventId');   -- user work is never destroyed
        end if;
      end if;
    end loop;

    if kind = 'upsert' and not seen then
      out_tasks := out_tasks || jsonb_build_array((op->'task') || jsonb_build_object('id', tid, 'sourceEventId', op->>'event_id'));
    end if;

    doc := jsonb_set(doc, '{tasks}', out_tasks);
    update calendar_days set day_data = doc where user_id = uid and date_key = dkey;
    days_out := days_out || jsonb_build_object(dkey, doc);
  end loop;

  return jsonb_build_object('rev', new_rev, 'days', days_out);
end;
$$;


-- ─── 4. schedule_set_task_link: "remove from Task Manager" / "restore" ───────
-- Records the user's choice on the event (it survives reloads and devices). Never touches tasks itself.

create or replace function public.schedule_set_task_link(p_event_id text, p_link text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   integer;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_link not in ('linked', 'detached') then raise exception 'bad_link' using errcode = '22023'; end if;
  update schedule_events
     set task_link = p_link,
         task_date_key = case when p_link = 'detached' then null else task_date_key end,
         rev = rev + 1
   where user_id = uid and event_id = p_event_id
  returning rev into r;
  return r;                                      -- NULL when the event does not exist (or is not yours)
end;
$$;


-- ─── 5. privileges: signed-in users only (no anon, no PUBLIC) ────────────────
revoke all on function public.schedule_task_has_progress(jsonb, jsonb) from public, anon;
revoke all on function public.schedule_apply(jsonb, text, integer, jsonb) from public, anon;
revoke all on function public.schedule_set_task_link(text, text) from public, anon;
grant execute on function public.schedule_task_has_progress(jsonb, jsonb) to authenticated;
grant execute on function public.schedule_apply(jsonb, text, integer, jsonb) to authenticated;
grant execute on function public.schedule_set_task_link(text, text) to authenticated;


-- ─── 6. table privileges (project convention, as in 015: set explicitly, least privilege) ───────────────────
-- On a project with "Automatic table exposure" OFF a new table is unreachable until granted; on an older project the default
-- privileges also hand `anon` everything. Either way: nothing for anon/PUBLIC, only the four row operations for signed-in
-- users (RLS still limits every row to its owner), full access for the server's service role.
-- "revoke all" first (as 015 does): Supabase's default privileges also give signed-in users TRUNCATE / TRIGGER / REFERENCES, and TRUNCATE ignores RLS.
revoke all on public.schedule_events from public, anon, authenticated;
grant select, insert, update, delete on public.schedule_events to authenticated;
grant all on public.schedule_events to service_role;


-- ─── 7. paywall: same restrictive write policies migration 016 puts on the other data tables ─────────────────
-- 016 (billing) may not be applied yet on every project, and its policy loop only covers the tables it knew about, so this is
-- done here, conditionally. If 016 is applied AFTER these migrations, re-run 024 (which carries the same block) — NOT this file: 024 holds the
-- newer versions of the functions defined above, and re-running 023 would put the older ones back. A user whose trial/plan has ended can no longer create or edit schedule events; they can still read
-- and delete their own data (same as every other table).
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
