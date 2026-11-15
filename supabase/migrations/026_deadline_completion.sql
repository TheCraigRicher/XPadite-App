-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 026 — Deadline completion (v1.345). ADDITIVE and backward compatible: one nullable column + one small function. Nothing is dropped,
-- rewritten or back-filled, and the app keeps working (reads without the column, completion falls back to the linked task) until this is applied.
--
-- WHERE COMPLETION LIVES
--   • A deadline that has a linked Task Manager task ('dl-<eventId>') is completed by that TASK (day_data.tasks[].done + completedAt, in calendar_days).
--     schedule_apply already preserves those fields on every event save (its upsert merges `elem || {text, sourceEventId}` and its move carries the task),
--     so no change to schedule_apply is needed.
--   • A deadline whose task the user removed ('detached') has no task to carry it: its completion instant is kept here, on the event row.
--
-- completed_at = epoch MILLISECONDS (same unit as the app's Date.now()); NULL = not completed; -1 = completed but the moment was never recorded (a task
-- finished before v1.345, then removed from the Task Manager). Existing rows stay NULL — no timestamp is invented.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

alter table public.schedule_events add column if not exists completed_at bigint;

-- Same shape as schedule_set_task_link (023): signed-in users only, own rows only, bumps the revision so other devices notice.
create or replace function public.schedule_set_completed(p_event_id text, p_completed_at bigint)
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
  if p_completed_at is not null and p_completed_at <> -1 and p_completed_at <= 0 then raise exception 'bad_completed_at' using errcode = '22023'; end if;
  update schedule_events
     set completed_at = p_completed_at,
         rev = rev + 1
   where user_id = uid and event_id = p_event_id
  returning rev into r;
  return r;                                      -- NULL when the event does not exist (or is not yours)
end;
$$;

revoke all on function public.schedule_set_completed(text, bigint) from public, anon;
grant execute on function public.schedule_set_completed(text, bigint) to authenticated;

-- ─── schedule_detach_task: "remove from Task Manager" WITHOUT losing the deadline's assigned date ──────────────────────────────────────
-- schedule_set_task_link('detached') (023) clears task_date_key. For a deadline that carries a legacy assigned date (set under another timezone) that would
-- let the date be re-derived. This variant records the same 'detached' choice and bumps the revision, but KEEPS task_date_key. Same owner-scoped shape as
-- schedule_set_task_link; schedule_apply is untouched.
create or replace function public.schedule_detach_task(p_event_id text)
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
  update schedule_events
     set task_link = 'detached',
         rev = rev + 1
   where user_id = uid and event_id = p_event_id
  returning rev into r;
  return r;                                      -- NULL when the event does not exist (or is not yours)
end;
$$;

revoke all on function public.schedule_detach_task(text) from public, anon;
grant execute on function public.schedule_detach_task(text) to authenticated;

-- ─── schedule_apply: editing a DETACHED deadline no longer clears its assigned date ────────────────────────────────────────────────────
-- Identical to the 024 function except ONE line: task_date_key is stored as the client sends it instead of being forced to NULL for 'detached' events.
-- The client sends the recorded date while the deadline's end is unchanged, and the date recomputed in the account timezone when the user changes the end.
-- Older app versions send NULL for detached events, exactly the old result. Privileges are unchanged (create or replace keeps them); re-stated for clarity.
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
        task_date_key = p_event->>'task_date_key',      -- v1.345: the CLIENT decides (a detached deadline keeps its assigned date while its end is unchanged); other callers send null as before
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

revoke all on function public.schedule_apply(jsonb, text, integer, jsonb) from public, anon;
grant execute on function public.schedule_apply(jsonb, text, integer, jsonb) to authenticated;
