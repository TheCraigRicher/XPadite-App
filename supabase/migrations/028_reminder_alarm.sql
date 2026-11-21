-- v1.357 — Persistent Alarm reminder type for My Schedule.
--
-- ADDITIVE and idempotent. It does NOT touch migration 027, the reminder scheduler, push_subscriptions, reminder_deliveries or
-- schedule_reminder_candidates: the server push job neither reads nor needs this flag (a closed app always gets the ordinary notification).
--
--  1. schedule_events.reminder_alarm boolean NOT NULL DEFAULT false — false = Standard Reminder (every existing event, unchanged).
--  2. schedule_apply is re-stated IDENTICAL to migration 026 except for the reminder_alarm lines:
--       • an app version that sends no reminder_alarm key keeps the stored value on update (so an old browser tab cannot silently reset it);
--       • an event with no reminder is always stored as false.
--     Privileges are unchanged (re-stated below).
--
-- Apply this BEFORE deploying the v1.357 app. The deployed v1.356 app keeps working with it (it never sends or reads the column).

alter table public.schedule_events add column if not exists reminder_alarm boolean not null default false;

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
        -- v1.357: an older app version sends no reminder_alarm key: keep what is stored. A reminder-less event can never be an alarm.
        reminder_alarm = case when (p_event->>'reminder_mins') is null then false
                              when p_event ? 'reminder_alarm' then coalesce((p_event->>'reminder_alarm')::boolean, false)
                              else reminder_alarm end,
        recurrence    = coalesce(p_event->>'recurrence', recurrence),
        is_deadline   = coalesce((p_event->>'is_deadline')::boolean, false),
        task_date_key = p_event->>'task_date_key',      -- v1.345: the CLIENT decides (a detached deadline keeps its assigned date while its end is unchanged); other callers send null as before
        task_link     = new_link,
        rev           = cur_rev + 1
      where user_id = uid and event_id = eid
      returning rev into new_rev;
    else
      insert into schedule_events (user_id, event_id, title, category, start_at, end_at, location, meeting_url, notes,
                                   reminder_mins, reminder_alarm, recurrence, is_deadline, task_date_key, task_link, rev)
      values (uid, eid, p_event->>'title', coalesce(p_event->>'category', 'meeting'), (p_event->>'start_at')::timestamptz,
              (p_event->>'end_at')::timestamptz, p_event->>'location', p_event->>'meeting_url', p_event->>'notes',
              (p_event->>'reminder_mins')::integer,
              ((p_event->>'reminder_mins') is not null and coalesce((p_event->>'reminder_alarm')::boolean, false)), coalesce(p_event->>'recurrence', 'none'),
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
