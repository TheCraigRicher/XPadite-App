-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 019_reviews   (XPadite App + XPadite Website — ONE shared reviews system)
--
-- CONSOLIDATED, FINAL-STATE version of the Website's 015_reviews.sql + 016_review_profession.sql, plus a security
-- hardening. Safe to run from ANY starting state, any number of times:
--   • database with no reviews objects yet                     → creates everything
--   • database that already ran 015_reviews.sql only            → upgrades it (adds profession, hardening)
--   • database that already ran 015 + 016                       → only applies the hardening / refreshes functions
-- It NEVER deletes, truncates or rewrites existing review rows (no DELETE/UPDATE/DROP TABLE on data).
--
-- Why the hardening: Supabase grants ALL privileges on every new table AND VIEW in `public` to anon/authenticated by
-- default. 015 revoked that on the base tables but not on the two views, and a simple view over a table is
-- auto-updatable, so with the public anon key anyone could UPDATE or DELETE published reviews through
-- public.public_reviews. This file revokes everything on the views except SELECT.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run. (Not applied automatically; needs owner approval.)
-- ROLLBACK: nothing to roll back for data. To undo the hardening only:
--   grant insert, update, delete on public.public_reviews to anon, authenticated;   -- NOT recommended
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.reviews (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null unique references auth.users(id) on delete cascade,
  rating            smallint    not null check (rating between 1 and 5),
  title             text        check (title is null or char_length(title) <= 100),
  body              text        not null check (char_length(body) between 10 and 2000),
  display_name      text        not null check (char_length(display_name) between 1 and 60),
  status            text        not null default 'pending'
                                check (status in ('published', 'pending', 'rejected')),
  moderation_reason text,
  moderated_by      uuid        references auth.users(id) on delete set null,
  moderated_at      timestamptz,
  source            text        not null default 'website' check (source in ('website', 'app')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);

create index if not exists reviews_published_idx
  on public.reviews (published_at desc) where status = 'published';
create index if not exists reviews_status_idx
  on public.reviews (status, created_at desc);

create table if not exists public.review_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.reviews       enable row level security;
alter table public.review_admins enable row level security;   -- no policies: not reachable via the API


-- ─── 2. Privileges / RLS ─────────────────────────────────────────────────────

revoke all on public.reviews       from anon, authenticated;
revoke all on public.review_admins from anon, authenticated;

grant select on public.reviews to authenticated;               -- still row-filtered by the policy below

create or replace function public.is_review_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.review_admins where user_id = auth.uid()) $$;

drop policy if exists "reviews_select_own_or_admin" on public.reviews;
create policy "reviews_select_own_or_admin"
  on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.is_review_admin());

-- Deliberately NO insert / update / delete policies: clients cannot write directly.

-- Added in 016; harmless when it already exists.
alter table public.reviews
  add column if not exists profession text
  check (profession is null or char_length(profession) <= 60);

-- ─── 3. Public, privacy-safe read access ─────────────────────────────────────
-- Views run with the owner's rights (bypass RLS) but only expose published rows
-- and safe columns: never user_id, email, status or moderation details.
-- `profession` is last because a view may only gain columns at the END (keeps 015/016 databases compatible).

create or replace view public.public_reviews as
  select id, rating, title, body, display_name, source, created_at, updated_at, published_at, profession
  from public.reviews
  where status = 'published';

create or replace view public.public_review_stats as
  select count(*)::int                                   as review_count,
         coalesce(round(avg(rating)::numeric, 2), 0)     as average_rating
  from public.reviews
  where status = 'published';

-- HARDENING: strip Supabase's default ALL grants first, then grant read-only access.
revoke all on public.public_reviews      from anon, authenticated;
revoke all on public.public_review_stats from anon, authenticated;
grant select on public.public_reviews      to anon, authenticated;
grant select on public.public_review_stats to anon, authenticated;


-- ─── 4. Helpers (internal) ───────────────────────────────────────────────────

-- "Alex Kim" -> "Alex K."; single names kept; anything email-like is hidden.
create or replace function public.review_public_name(p_name text)
returns text
language plpgsql immutable
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_parts text[];
begin
  if v_name = '' or position('@' in v_name) > 0 then
    return 'XPadite user';
  end if;
  v_parts := regexp_split_to_array(v_name, '\s+');
  if array_length(v_parts, 1) >= 2 then
    return left(v_parts[1], 30) || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;
  return left(v_name, 40);
end;
$$;

-- Conservative spam / abuse screen. Returns a reason when the review should be
-- HELD FOR MANUAL REVIEW (status = pending), or NULL when it looks fine.
-- It never looks at sentiment: ordinary negative reviews are NOT flagged.
create or replace function public.review_flag_reason(p_title text, p_body text)
returns text
language plpgsql immutable
as $$
declare
  t text := lower(coalesce(p_title, '') || ' ' || coalesce(p_body, ''));
begin
  if (select count(*) from regexp_matches(t, '(https?://|www\.)', 'g')) >= 2 then
    return 'multiple links';
  end if;
  if t ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return 'contains an email address';
  end if;
  if t ~ '(\+?\d[\s().-]*){10,}' then
    return 'contains a phone number';
  end if;
  if t ~ '(.)\1{11,}' then
    return 'repeated characters';
  end if;
  if t ~ '\m(viagra|cialis|casino|porn|crypto giveaway|bitcoin doubler|forex signals?|buy followers|click here|make money fast|work from home|seo services?|backlinks?|telegram|whatsapp me)\M' then
    return 'promotional content';
  end if;
  if t ~ '\m(kill yourself|i will find you|i will hurt you)\M' then
    return 'abusive content';
  end if;
  return null;
end;
$$;

revoke all on function public.review_public_name(text)        from public, anon, authenticated;
revoke all on function public.review_flag_reason(text, text)  from public, anon, authenticated;


-- ─── 5. submit_review — create or edit the caller's own review ───────────────
-- (final 5-argument version; the 4-argument overload from 015 is dropped so named-argument calls are never ambiguous)
-- Errors: 28000 not_authenticated · 42501 email_not_verified · 22023 invalid_* · 54000 rate_limited

drop function if exists public.submit_review(int, text, text, text);

create or replace function public.submit_review(
  p_rating     int,
  p_title      text,
  p_body       text,
  p_source     text default 'website',
  p_profession text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_user     auth.users%rowtype;
  v_title    text;
  v_body     text;
  v_prof     text;
  v_name     text;
  v_flag     text;
  v_status   text;
  v_source   text := case when p_source = 'app' then 'app' else 'website' end;
  v_existing public.reviews%rowtype;
  v_found    boolean;
  v_row      public.reviews%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found or v_user.email_confirmed_at is null then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  v_body  := btrim(coalesce(p_body, ''));
  v_prof  := nullif(btrim(regexp_replace(coalesce(p_profession, ''), '\s+', ' ', 'g')), '');
  if v_title is not null and char_length(v_title) > 100 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if v_prof is not null and char_length(v_prof) > 60 then
    raise exception 'invalid_profession' using errcode = '22023';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(pr.display_name), ''), nullif(btrim(pr.full_name), ''))
    into v_name
    from public.profiles pr where pr.id = v_uid;
  v_name := public.review_public_name(coalesce(
    v_name,
    nullif(btrim(v_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(v_user.raw_user_meta_data ->> 'name'), '')
  ));

  select * into v_existing from public.reviews where user_id = v_uid;
  v_found := found;

  if v_found and v_existing.updated_at > now() - interval '10 seconds' then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- the profession is user text shown publicly, so it goes through the same screen as the title
  v_flag := public.review_flag_reason(concat_ws(' ', v_title, v_prof), v_body);
  if v_flag is null and exists (
    select 1 from public.reviews r
    where lower(r.body) = lower(v_body) and r.user_id <> v_uid
  ) then
    v_flag := 'text duplicates another review';
  end if;

  v_status := case
    when v_flag is not null then 'pending'
    when v_found and v_existing.moderated_by is not null and v_existing.status <> 'published' then 'pending'
    else 'published'
  end;

  if v_found then
    update public.reviews set
      rating            = p_rating,
      title             = v_title,
      body              = v_body,
      profession        = v_prof,
      display_name      = v_name,
      status            = v_status,
      moderation_reason = v_flag,
      updated_at        = now(),
      published_at      = case when v_status = 'published' then coalesce(v_existing.published_at, now()) else null end
    where user_id = v_uid
    returning * into v_row;
  else
    insert into public.reviews
      (user_id, rating, title, body, profession, display_name, status, moderation_reason, source, published_at)
    values
      (v_uid, p_rating, v_title, v_body, v_prof, v_name, v_status, v_flag, v_source,
       case when v_status = 'published' then now() else null end)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id',           v_row.id,
    'rating',       v_row.rating,
    'title',        v_row.title,
    'body',         v_row.body,
    'profession',   v_row.profession,
    'display_name', v_row.display_name,
    'status',       v_row.status,
    'created_at',   v_row.created_at,
    'updated_at',   v_row.updated_at,
    'published_at', v_row.published_at
  );
end;
$$;

revoke all on function public.submit_review(int, text, text, text, text) from public, anon;
grant execute on function public.submit_review(int, text, text, text, text) to authenticated;

-- ─── 6. Moderation (administrators only) ─────────────────────────────────────

create or replace function public.admin_set_review_status(
  p_review_id uuid,
  p_status    text,
  p_reason    text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.reviews%rowtype;
begin
  if not public.is_review_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('published', 'pending', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update public.reviews set
    status            = p_status,
    moderation_reason = p_reason,
    moderated_by      = auth.uid(),
    moderated_at      = now(),
    published_at      = case when p_status = 'published' then coalesce(published_at, now()) else null end
  where id = p_review_id
  returning * into v_row;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function public.admin_set_review_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_review_status(uuid, text, text) to authenticated;


-- ─── Administrators ──────────────────────────────────────────────────────────
-- Add yourself in the SQL editor (never through the API):
--   insert into public.review_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
--
-- Typical moderation (as an admin, or in the SQL editor):
--   select id, rating, display_name, status, moderation_reason, left(body, 80)
--     from public.reviews where status = 'pending' order by created_at;
--   -- via SQL editor (runs as postgres, bypasses the admin check):
--   update public.reviews set status = 'published', published_at = now(),
--          moderated_at = now() where id = '<review id>';


