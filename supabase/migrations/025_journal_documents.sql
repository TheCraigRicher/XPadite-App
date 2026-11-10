-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 025_journal_documents
-- v1.330 — Library Notes & Folders: extra Planner documents (several per day) and independent single-section Notes.
--
-- HOW TO APPLY (NOT applied automatically — review first)
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run. Development / Preview project FIRST.
-- Idempotent: safe to run more than once.
--
-- ADDITIVE ONLY. No existing table, column, row, policy or function is changed or dropped:
--   • NEW table    public.journal_documents      extra same-day documents + Notes (calendar_days is NOT touched)
--   • NEW table    public.journal_library_state  the once-per-account "starter notes were created" marker
--   • NEW function public.journal_doc_save       compare-and-swap write of one document
--   • NEW function public.journal_seed_starter_notes  atomic, idempotent creation of the three starter notes
-- Existing Planner documents stay exactly where they are (calendar_days.day_data.notes). Folder membership and labels live INSIDE a
-- document's own JSON (folderId / labelIds), so moving a document into a folder never copies or rewrites its content blocks.
-- Until this is applied the app keeps working: Notes / Folders show a notice and every existing feature is unchanged.
--
-- SECURITY: RLS on both tables (own rows only). SECURITY INVOKER functions (RLS still applies), owner is always auth.uid(),
-- EXECUTE for `authenticated` only. The marker table has NO update/delete policy, so a client can never reset it.
-- TABLE PRIVILEGES are granted explicitly (section 5b) — this project's defaults can not be relied on.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. journal_documents ────────────────────────────────────────────────────
-- doc_id   client-generated stable id (text, like the other Library tables)
-- kind     'doc'  = an additional regular Planner document on date_key (the day's primary document stays in calendar_days)
--          'note' = an independent single-section Note (date_key = the day it was created)
-- content  the serialized JournalDoc (same JSON the Planner editor reads/writes: title, blocks, labelIds, folderId …)
-- rev      advanced by the SERVER on every content change (trigger) — the compare-and-swap token
create table if not exists public.journal_documents (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  doc_id     text        not null,
  kind       text        not null default 'doc',
  date_key   text        not null,
  content    text        not null default '',
  rev        integer     not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, doc_id),
  constraint journal_documents_kind_chk     check (kind in ('doc', 'note')),
  constraint journal_documents_date_key_chk check (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint journal_documents_doc_id_chk   check (length(doc_id) between 1 and 80)
);

create index if not exists journal_documents_user_idx on public.journal_documents (user_id, date_key desc);
create index if not exists journal_documents_user_kind_idx on public.journal_documents (user_id, kind);

alter table public.journal_documents enable row level security;

drop policy if exists "users_select_own_journal_documents" on public.journal_documents;
drop policy if exists "users_insert_own_journal_documents" on public.journal_documents;
drop policy if exists "users_update_own_journal_documents" on public.journal_documents;
drop policy if exists "users_delete_own_journal_documents" on public.journal_documents;

create policy "users_select_own_journal_documents" on public.journal_documents for select using (auth.uid() = user_id);
create policy "users_insert_own_journal_documents" on public.journal_documents for insert with check (auth.uid() = user_id);
create policy "users_update_own_journal_documents" on public.journal_documents for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users_delete_own_journal_documents" on public.journal_documents for delete using (auth.uid() = user_id);

create or replace function public.journal_documents_bump_rev()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- only the server decides the revision; a client-supplied value is ignored. An update that changes nothing keeps it.
  if new.content is distinct from old.content or new.kind is distinct from old.kind then
    new.rev := old.rev + 1;
    new.updated_at := now();
  else
    new.rev := old.rev;
  end if;
  -- identity columns can never be rewritten
  new.user_id := old.user_id; new.doc_id := old.doc_id; new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists journal_documents_bump_rev on public.journal_documents;
create trigger journal_documents_bump_rev
  before update on public.journal_documents
  for each row execute function public.journal_documents_bump_rev();

revoke all on function public.journal_documents_bump_rev() from public, anon, authenticated;

-- ─── 2. journal_library_state (the once-per-account marker) ──────────────────
create table if not exists public.journal_library_state (
  user_id                 uuid        not null references auth.users(id) on delete cascade primary key,
  starter_notes_seeded_at timestamptz not null default now()
);

alter table public.journal_library_state enable row level security;

drop policy if exists "users_select_own_journal_library_state" on public.journal_library_state;
drop policy if exists "users_insert_own_journal_library_state" on public.journal_library_state;
create policy "users_select_own_journal_library_state" on public.journal_library_state for select using (auth.uid() = user_id);
create policy "users_insert_own_journal_library_state" on public.journal_library_state for insert with check (auth.uid() = user_id);
-- (deliberately no update / delete policy: the marker can never be cleared from a client, so a starter note can never come back)

-- ─── 3. journal_doc_save: compare-and-swap write of one document ─────────────
-- Returns {"ok":true,"rev":N}                      — written; N is the new revision
--      or {"ok":false,"rev":N,"content":"…"|null}  — NOT written: the document is at revision N (content = its current text, null = no row).
-- p_expected_rev = the revision the caller's copy was based on (null/0 = "no row yet").
create or replace function public.journal_doc_save(p_doc_id text, p_kind text, p_date_key text, p_content text, p_expected_rev integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  cur_rev integer;
  cur_txt text;
  new_rev integer;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_doc_id is null or length(p_doc_id) not between 1 and 80 then raise exception 'bad_id' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('doc', 'note') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if p_date_key is null or p_date_key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_key' using errcode = '22023'; end if;
  if p_content is null then raise exception 'bad_doc' using errcode = '22023'; end if;

  select rev, content into cur_rev, cur_txt from journal_documents where user_id = uid and doc_id = p_doc_id for update;
  if not found then
    if coalesce(p_expected_rev, 0) > 0 then
      return jsonb_build_object('ok', false, 'rev', 0, 'content', null);     -- the caller believed a row existed; it does not (deleted elsewhere)
    end if;
    begin
      insert into journal_documents (user_id, doc_id, kind, date_key, content) values (uid, p_doc_id, p_kind, p_date_key, p_content)
        returning rev into new_rev;
    exception when unique_violation then
      select rev, content into cur_rev, cur_txt from journal_documents where user_id = uid and doc_id = p_doc_id;
      return jsonb_build_object('ok', false, 'rev', cur_rev, 'content', cur_txt);
    end;
    return jsonb_build_object('ok', true, 'rev', new_rev);
  end if;

  if p_expected_rev is null or p_expected_rev <> cur_rev then
    return jsonb_build_object('ok', false, 'rev', cur_rev, 'content', cur_txt);
  end if;
  update journal_documents set content = p_content, kind = p_kind where user_id = uid and doc_id = p_doc_id returning rev into new_rev;
  if new_rev is null then
    -- defensive: if a row-level policy ever hid the row from this UPDATE, PostgreSQL would change 0 rows WITHOUT an error. Never report that as saved.
    -- (For an expired plan the paywall already hides the row from the `select … for update` above, so the caller gets {ok:false,content:null}, tries to
    --  re-create it, and the INSERT policy refuses loudly — the app then keeps the edit on the device and retries.)
    raise exception 'save_refused' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'rev', new_rev);
end;
$$;

-- ─── 4. journal_seed_starter_notes: atomic, idempotent ───────────────────────
-- p_docs = jsonb array of {"doc_id":"…","content":"…"} (at most 3), p_date_key = today for the creation date.
-- The marker row is inserted FIRST: its primary key serialises two devices that race, and `on conflict do nothing` means exactly one of
-- them creates the notes. Marker + notes are one transaction (all or nothing). After the marker exists this function never inserts again —
-- so a renamed or deleted starter note is never recreated, on any device, at any later login.
-- Returns {"seeded":true} when this call created the notes, {"seeded":false} otherwise.
create or replace function public.journal_seed_starter_notes(p_docs jsonb, p_date_key text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  n    integer;
  item jsonb;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_docs is null or jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) > 3 then raise exception 'bad_docs' using errcode = '22023'; end if;
  if p_date_key is null or p_date_key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_key' using errcode = '22023'; end if;

  insert into journal_library_state (user_id) values (uid) on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('seeded', false); end if;

  for item in select * from jsonb_array_elements(p_docs) loop
    insert into journal_documents (user_id, doc_id, kind, date_key, content)
    values (uid, item->>'doc_id', 'note', p_date_key, coalesce(item->>'content', ''))
    on conflict (user_id, doc_id) do nothing;
  end loop;
  return jsonb_build_object('seeded', true);
end;
$$;

-- ─── 5. privileges ───────────────────────────────────────────────────────────
revoke all on function public.journal_doc_save(text, text, text, text, integer) from public, anon;
revoke all on function public.journal_seed_starter_notes(jsonb, text) from public, anon;
grant execute on function public.journal_doc_save(text, text, text, text, integer) to authenticated;
grant execute on function public.journal_seed_starter_notes(jsonb, text) to authenticated;

-- ─── 5b. TABLE PRIVILEGES — explicit, least privilege ─────────────────────────
-- Newer Supabase projects do NOT auto-grant privileges on new tables to `authenticated` (older ones granted ALL). Without these grants every
-- signed-in request fails with "permission denied for table …" no matter what the RLS policies say. They are set explicitly (as in 015 / 019),
-- and anything broader that a project's defaults may have granted (TRUNCATE, REFERENCES, TRIGGER, any `anon` access) is removed first.
revoke all on public.journal_documents     from anon, authenticated;
revoke all on public.journal_library_state from anon, authenticated;
grant select, insert, update, delete on public.journal_documents     to authenticated;
grant select, insert                 on public.journal_library_state to authenticated;     -- no update / delete: the marker can never be cleared from a client
grant all on public.journal_documents     to service_role;
grant all on public.journal_library_state to service_role;

-- ─── 6. paywall policies (re-runnable) — same restrictive write policies migration 016 puts on the other data tables ──────────────────────
do $$
begin
  if to_regprocedure('public.billing_has_access(uuid)') is not null then
    drop policy if exists billing_paywall_insert on public.journal_documents;
    drop policy if exists billing_paywall_update on public.journal_documents;
    create policy billing_paywall_insert on public.journal_documents as restrictive for insert to authenticated
      with check ((select public.billing_has_access()));
    create policy billing_paywall_update on public.journal_documents as restrictive for update to authenticated
      using ((select public.billing_has_access())) with check ((select public.billing_has_access()));
  end if;
end
$$;

-- ─── ROLLBACK (manual, only if ever needed — the app tolerates the objects being absent) ──────────────────────────────────────────────────
--   drop function if exists public.journal_seed_starter_notes(jsonb, text);
--   drop function if exists public.journal_doc_save(text, text, text, text, integer);
--   drop table if exists public.journal_library_state;
--   drop table if exists public.journal_documents;   -- WARNING: deletes every extra document and Note
