-- Native profile showcase media: photos in Supabase storage, videos in Cloudflare Stream.

create extension if not exists pgcrypto;

create table if not exists public.profile_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null,
  provider text not null,
  status text not null default 'processing',
  position integer not null default 0,
  is_primary boolean not null default false,
  stream_uid text null,
  playback_url text null,
  thumbnail_url text null,
  duration_sec integer null,
  storage_path text null,
  public_url text null,
  width integer null,
  height integer null,
  blurhash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_kind_chk'
  ) then
    alter table public.profile_media
      add constraint profile_media_kind_chk
      check (kind in ('video', 'photo'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_provider_chk'
  ) then
    alter table public.profile_media
      add constraint profile_media_provider_chk
      check (provider in ('cloudflare_stream', 'storage'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_status_chk'
  ) then
    alter table public.profile_media
      add constraint profile_media_status_chk
      check (status in ('processing', 'ready', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_position_chk'
  ) then
    alter table public.profile_media
      add constraint profile_media_position_chk
      check (position >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_media_provider_matches_kind_chk'
  ) then
    alter table public.profile_media
      add constraint profile_media_provider_matches_kind_chk
      check (
        (kind = 'video' and provider = 'cloudflare_stream')
        or (kind = 'photo' and provider = 'storage')
      );
  end if;
end $$;

create index if not exists profile_media_user_status_idx
  on public.profile_media(user_id, status);

create index if not exists profile_media_user_position_idx
  on public.profile_media(user_id, position);

create unique index if not exists profile_media_primary_per_user_idx
  on public.profile_media(user_id)
  where is_primary = true;

create unique index if not exists profile_media_stream_uid_uidx
  on public.profile_media(stream_uid)
  where stream_uid is not null;

create unique index if not exists profile_media_storage_path_uidx
  on public.profile_media(storage_path)
  where storage_path is not null;

create or replace function public.set_profile_media_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.profile_media_enforce_limits()
returns trigger
language plpgsql
as $$
declare
  existing_total integer := 0;
  existing_videos integer := 0;
  existing_photos integer := 0;
  excluded_id uuid := coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  select
    count(*)::integer,
    count(*) filter (where kind = 'video')::integer,
    count(*) filter (where kind = 'photo')::integer
  into existing_total, existing_videos, existing_photos
  from public.profile_media
  where user_id = new.user_id
    and id <> excluded_id;

  if existing_total >= 5 then
    raise exception 'You can store at most 5 showcase media items per profile.';
  end if;

  if new.kind = 'video' and existing_videos >= 2 then
    raise exception 'You can store at most 2 showcase videos per profile.';
  end if;

  if new.kind = 'photo' and existing_photos >= 3 then
    raise exception 'You can store at most 3 showcase photos per profile.';
  end if;

  if new.is_primary and exists (
    select 1
    from public.profile_media
    where user_id = new.user_id
      and is_primary = true
      and id <> excluded_id
  ) then
    raise exception 'Only one primary showcase item is allowed per profile.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profile_media_set_updated_at on public.profile_media;
create trigger trg_profile_media_set_updated_at
before update on public.profile_media
for each row execute function public.set_profile_media_updated_at();

drop trigger if exists trg_profile_media_enforce_limits on public.profile_media;
create trigger trg_profile_media_enforce_limits
before insert or update on public.profile_media
for each row execute function public.profile_media_enforce_limits();

alter table public.profile_media enable row level security;

drop policy if exists profile_media_select_ready on public.profile_media;
create policy profile_media_select_ready
  on public.profile_media
  for select
  using (status = 'ready');

drop policy if exists profile_media_select_own on public.profile_media;
create policy profile_media_select_own
  on public.profile_media
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists profile_media_insert_own on public.profile_media;
create policy profile_media_insert_own
  on public.profile_media
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists profile_media_update_own on public.profile_media;
create policy profile_media_update_own
  on public.profile_media
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists profile_media_delete_own on public.profile_media;
create policy profile_media_delete_own
  on public.profile_media
  for delete
  to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
