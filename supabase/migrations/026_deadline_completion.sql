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
