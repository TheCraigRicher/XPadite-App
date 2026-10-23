-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 020_review_profile_photo   (XPadite App + XPadite Website — shared reviews system)
-- Run AFTER 019_reviews.sql (already applied in Production). Additive, idempotent, one transaction.
-- Do NOT re-run 019 after this migration: 019's older view definition would try to drop the new view columns and is refused
-- (the transaction rolls back, nothing changes). 019 is only for databases that have not run 020.
--
-- Lets a verified reviewer choose to show their XPadite profile photo next to their PUBLIC review.
--
--   public.reviews.show_profile_photo   boolean NOT NULL DEFAULT false   (the author's consent)
--   public.reviews.profile_photo_path   text    NULL                     (path of the PUBLIC copy, see below)
--   public.public_reviews               gains show_profile_photo + photo_path (photo_path is NULL unless consent is true)
--   public.submit_review(...)           gains p_show_photo boolean DEFAULT NULL (6th, optional)
--   storage bucket review-photos        PUBLIC, 256 KB, image/webp only. No client write policies: only the App's server
--                                       (service role) writes to it, and only 256x256 metadata-free copies of the author's
--                                       own avatar. The private `avatars` bucket stays private and is never exposed.
--
-- PRIVACY GUARANTEES
--   • Existing reviews get show_profile_photo = false: nobody's photo becomes public by migration.
--   • Legacy callers (the Website form sends no p_show_photo) can never switch a photo on; on edit they keep the prior value.
--   • The public view masks photo_path itself whenever consent is false, so un-checking hides the photo immediately,
--     even before the stored copy is deleted by the server.
--   • Only submit_review (auth.uid() only) changes the consent; clients still have no INSERT/UPDATE/DELETE on reviews.
--
-- ROLLBACK (data-safe): nothing needed. To remove the feature: drop the two columns/view columns and bucket manually.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.reviews
  add column if not exists show_profile_photo boolean not null default false;

alter table public.reviews
  add column if not exists profile_photo_path text;

-- Only the exact shape the server writes: <review uuid>/<unix ms>.webp
alter table public.reviews drop constraint if exists reviews_profile_photo_path_check;
alter table public.reviews
  add constraint reviews_profile_photo_path_check
  check (profile_photo_path is null or profile_photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{10,16}\.webp$');

-- ─── Public bucket for the 256x256 review photos (public READ by URL; no listing, no client writes) ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 262144, array['image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 262144, allowed_mime_types = array['image/webp'];

-- ─── Public read contract: new columns go LAST (a view may only gain columns at the end) ───
create or replace view public.public_reviews as
  select id, rating, title, body, display_name, source, created_at, updated_at, published_at, profession,
         show_profile_photo,
         case when show_profile_photo then profile_photo_path else null end as photo_path
  from public.reviews
  where status = 'published';

-- keep the 019 hardening explicit: read-only for the public views
revoke all on public.public_reviews      from anon, authenticated;
revoke all on public.public_review_stats from anon, authenticated;
grant select on public.public_reviews      to anon, authenticated;
grant select on public.public_review_stats to anon, authenticated;

-- ─── submit_review: 6th optional argument. The 5-argument overload is dropped so named-argument calls from older
--     clients (which omit p_show_photo) resolve to this single function through its default. ───
drop function if exists public.submit_review(int, text, text, text, text);

create or replace function public.submit_review(
  p_rating     int,
  p_title      text,
  p_body       text,
  p_source     text default 'website',
  p_profession text default null,
  p_show_photo boolean default null
)
returns jsonb
language plpgsql security definer set search_path = ''
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
  v_show     boolean;
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

  -- Profile-photo consent. NULL (legacy callers such as the Website form, which has no checkbox) never turns the photo on:
  -- a new review defaults to OFF and an edit keeps whatever the author chose before. Only an explicit true/false changes it.
  v_show := coalesce(p_show_photo, case when v_found then v_existing.show_profile_photo else false end);

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
      show_profile_photo = v_show,
      display_name      = v_name,
      status            = v_status,
      moderation_reason = v_flag,
      updated_at        = now(),
      published_at      = case when v_status = 'published' then coalesce(v_existing.published_at, now()) else null end
    where user_id = v_uid
    returning * into v_row;
  else
    insert into public.reviews
      (user_id, rating, title, body, profession, show_profile_photo, display_name, status, moderation_reason, source, published_at)
    values
      (v_uid, p_rating, v_title, v_body, v_prof, v_show, v_name, v_status, v_flag, v_source,
       case when v_status = 'published' then now() else null end)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id',           v_row.id,
    'rating',       v_row.rating,
    'title',        v_row.title,
    'body',         v_row.body,
    'profession',   v_row.profession,
    'show_profile_photo', v_row.show_profile_photo,
    'display_name', v_row.display_name,
    'status',       v_row.status,
    'created_at',   v_row.created_at,
    'updated_at',   v_row.updated_at,
    'published_at', v_row.published_at
  );
end;
$$;

revoke all on function public.submit_review(int, text, text, text, text, boolean) from public, anon;
grant execute on function public.submit_review(int, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
