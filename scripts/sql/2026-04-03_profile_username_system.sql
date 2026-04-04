begin;

alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  add column if not exists username_changed_at timestamptz;

alter table public.profiles
  add column if not exists username_updated_at timestamptz;

create table if not exists public.profile_username_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  username text not null,
  active_from timestamptz not null default now(),
  active_until timestamptz null,
  created_at timestamptz not null default now()
);

create or replace function public.cx_normalize_profile_username(raw_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(raw_value, ''))), '');
$$;

create or replace function public.cx_username_base_from_text(raw_value text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      both '._' from left(
        trim(both '._' from regexp_replace(regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9]+', '.', 'g'), '\.{2,}', '.', 'g')),
        20
      )
    ),
    ''
  );
$$;

create or replace function public.cx_is_reserved_profile_username(raw_value text)
returns boolean
language sql
immutable
as $$
  select public.cx_normalize_profile_username(raw_value) = any (
    array[
      'about', 'account', 'account-settings', 'admin', 'api', 'app', 'auth', 'billing',
      'blog', 'careers', 'complete', 'connections', 'console', 'conxion', 'conxionapp',
      'control-center', 'cookie-settings', 'dashboard', 'discover', 'edit', 'event',
      'events', 'explore', 'feed', 'help', 'host', 'hosting', 'inbox', 'login', 'logout',
      'me', 'member', 'members', 'message', 'messages', 'network', 'notifications',
      'official', 'onboarding', 'photo-guide', 'pricing', 'privacy', 'profile', 'profiles',
      'references', 'requests', 'root', 'safety', 'safety-center', 'search', 'settings',
      'shop', 'signin', 'signup', 'subscribe', 'subscription', 'subscriptions', 'support',
      'system', 'team', 'teacher', 'teachers', 'terms', 'travel', 'trips', 'u', 'users',
      'verification', 'verify'
    ]::text[]
  );
$$;

create or replace function public.cx_can_use_profile_username(
  p_user_id uuid,
  p_username text
)
returns boolean
language plpgsql
as $$
declare
  v_username text := public.cx_normalize_profile_username(p_username);
begin
  if v_username is null then
    return false;
  end if;

  if p_user_id is not null and exists (
    select 1
    from public.profiles p
    where p.user_id = p_user_id
      and lower(coalesce(p.username, '')) = v_username
  ) then
    return true;
  end if;

  return not exists (
      select 1
      from public.profiles p
      where lower(coalesce(p.username, '')) = v_username
        and (p_user_id is null or p.user_id <> p_user_id)
    )
    and not exists (
      select 1
      from public.profile_username_history h
      where lower(h.username) = v_username
    );
end;
$$;

create or replace function public.cx_resolve_profile_username(
  p_user_id uuid,
  p_display_name text,
  p_requested_username text default null
)
returns text
language plpgsql
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
  v_fallback_suffix text := left(replace(coalesce(p_user_id::text, gen_random_uuid()::text), '-', ''), 6);
begin
  v_base := public.cx_username_base_from_text(coalesce(nullif(btrim(p_requested_username), ''), p_display_name, 'member'));

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'member';
  end if;

  loop
    if v_suffix = 0 then
      v_candidate := v_base;
    else
      v_candidate := left(v_base, greatest(3, 20 - char_length(v_suffix::text))) || v_suffix::text;
    end if;

    if char_length(v_candidate) < 3 then
      v_candidate := left('member' || v_fallback_suffix, 20);
    end if;

    exit when public.cx_is_reserved_profile_username(v_candidate) is not true
      and public.cx_can_use_profile_username(p_user_id, v_candidate);

    v_suffix := v_suffix + 1;
  end loop;

  return v_candidate;
end;
$$;

do $$
declare
  v_collisions text;
begin
  select string_agg(conflict_value, ', ' order by conflict_value)
  into v_collisions
  from (
    select lower(public.cx_normalize_profile_username(username)) as conflict_value
    from public.profiles
    where username is not null
      and btrim(username) <> ''
    group by 1
    having count(*) > 1
  ) collisions;

  if v_collisions is not null then
    raise exception using errcode = '23505', message = 'Manual review required for username collisions: ' || v_collisions;
  end if;
end $$;

drop trigger if exists cx_profiles_apply_username on public.profiles;
drop trigger if exists cx_profiles_sync_username_history on public.profiles;

do $$
declare
  rec record;
begin
  for rec in
    select user_id, display_name, username
    from public.profiles
    where username is null
       or btrim(username) = ''
       or public.cx_normalize_profile_username(username) <> username
       or char_length(public.cx_normalize_profile_username(username)) < 3
       or char_length(public.cx_normalize_profile_username(username)) > 20
       or public.cx_normalize_profile_username(username) !~ '^[a-z0-9._]{3,20}$'
       or public.cx_normalize_profile_username(username) ~ '(^[._]|[._]$|\.\.)'
       or public.cx_is_reserved_profile_username(username)
    order by created_at nulls first, user_id
  loop
    update public.profiles
    set username = public.cx_resolve_profile_username(rec.user_id, rec.display_name, rec.username)
    where user_id = rec.user_id;
  end loop;
end $$;

update public.profiles
set username_updated_at = coalesce(username_updated_at, username_changed_at, created_at, now()),
    username_changed_at = coalesce(username_changed_at, username_updated_at, created_at, now())
where username is not null
  and btrim(username) <> '';

insert into public.profile_username_history (user_id, username, active_from, active_until)
select
  p.user_id,
  p.username,
  coalesce(p.username_updated_at, p.created_at, now()),
  null
from public.profiles p
where p.username is not null
  and btrim(p.username) <> ''
  and not exists (
    select 1
    from public.profile_username_history h
    where lower(h.username) = lower(p.username)
  );

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username));

create unique index if not exists profile_username_history_username_unique_idx
  on public.profile_username_history (lower(username));

create index if not exists profile_username_history_user_id_idx
  on public.profile_username_history (user_id);

alter table public.profiles
  drop constraint if exists profiles_username_format_chk;

alter table public.profiles
  add constraint profiles_username_format_chk
  check (
    username ~ '^[a-z0-9._]{3,20}$'
    and username !~ '(^[._]|[._]$|\.\.)'
  );

alter table public.profiles
  drop constraint if exists profiles_username_reserved_chk;

alter table public.profiles
  add constraint profiles_username_reserved_chk
  check (public.cx_is_reserved_profile_username(username) is not true);

alter table public.profiles
  alter column username set not null;

create or replace function public.cx_profiles_apply_username()
returns trigger
language plpgsql
as $$
declare
  v_previous_username text :=
    case
      when tg_op = 'UPDATE' then public.cx_normalize_profile_username(old.username)
      else null
    end;
  v_next_change_at timestamptz;
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := public.cx_resolve_profile_username(new.user_id, new.display_name, null);
  else
    new.username := public.cx_normalize_profile_username(new.username);
  end if;

  if new.username is null or char_length(new.username) < 3 or char_length(new.username) > 20 then
    raise exception using errcode = '22023', message = 'Username must be between 3 and 20 characters.';
  end if;

  if new.username !~ '^[a-z0-9._]{3,20}$' or new.username ~ '(^[._]|[._]$|\.\.)' then
    raise exception using errcode = '22023', message = 'Use only letters, numbers, dots, or underscores.';
  end if;

  if public.cx_is_reserved_profile_username(new.username) then
    raise exception using errcode = '22023', message = 'This username is reserved.';
  end if;

  if tg_op = 'UPDATE' and v_previous_username is distinct from new.username then
    v_next_change_at := coalesce(old.username_updated_at, old.username_changed_at) + interval '30 days';
    if coalesce(old.username_updated_at, old.username_changed_at) is not null and v_next_change_at > now() then
      raise exception using errcode = '22023', message = 'You can change your username once every 30 days.';
    end if;
  end if;

  if not public.cx_can_use_profile_username(new.user_id, new.username) then
    raise exception using errcode = '23505', message = 'This username is already taken.';
  end if;

  if tg_op = 'INSERT' then
    new.username_updated_at := coalesce(new.username_updated_at, now());
    new.username_changed_at := coalesce(new.username_changed_at, new.username_updated_at, now());
    return new;
  end if;

  if v_previous_username is distinct from new.username then
    new.username_updated_at := now();
    new.username_changed_at := new.username_updated_at;
  else
    new.username_updated_at := coalesce(old.username_updated_at, old.username_changed_at, new.username_updated_at, now());
    new.username_changed_at := coalesce(old.username_changed_at, old.username_updated_at, new.username_updated_at);
  end if;

  return new;
end;
$$;

create or replace function public.cx_profiles_sync_username_history()
returns trigger
language plpgsql
as $$
declare
  v_now timestamptz := coalesce(new.username_updated_at, now());
begin
  if tg_op = 'INSERT' then
    insert into public.profile_username_history (user_id, username, active_from, active_until)
    select new.user_id, new.username, v_now, null
    where not exists (
      select 1
      from public.profile_username_history h
      where lower(h.username) = lower(new.username)
    );
    return null;
  end if;

  if lower(coalesce(old.username, '')) is distinct from lower(coalesce(new.username, '')) then
    update public.profile_username_history
    set active_until = coalesce(active_until, v_now)
    where user_id = new.user_id
      and active_until is null;

    insert into public.profile_username_history (user_id, username, active_from, active_until)
    values (new.user_id, new.username, v_now, null);
  end if;

  return null;
end;
$$;

drop trigger if exists cx_profiles_apply_username on public.profiles;

create trigger cx_profiles_apply_username
before insert or update of username, display_name, username_updated_at
on public.profiles
for each row
execute function public.cx_profiles_apply_username();

drop trigger if exists cx_profiles_sync_username_history on public.profiles;

create trigger cx_profiles_sync_username_history
after insert or update of username on public.profiles
for each row
execute function public.cx_profiles_sync_username_history();

commit;

notify pgrst, 'reload schema';
