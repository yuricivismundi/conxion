begin;

alter table public.profiles
  add column if not exists username text;

create or replace function public.cx_normalize_profile_username(raw_value text)
returns text
language sql
immutable
as $$
  select nullif(
    left(
      trim(both '._' from regexp_replace(lower(coalesce(raw_value, '')), '[^a-z0-9._]+', '.', 'g')),
      30
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
      'about', 'account', 'account-settings', 'admin', 'api', 'app', 'auth', 'blog', 'careers',
      'connections', 'contact', 'dashboard', 'discover', 'edit', 'events', 'explore', 'feed',
      'help', 'home', 'inbox', 'login', 'me', 'messages', 'network', 'notifications', 'onboarding',
      'pricing', 'privacy', 'profile', 'references', 'register', 'search', 'settings', 'signin',
      'signup', 'support', 'terms', 'travel', 'trips', 'u', 'users'
    ]::text[]
  );
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
  v_fallback_suffix text := left(replace(p_user_id::text, '-', ''), 6);
begin
  v_base := public.cx_normalize_profile_username(coalesce(nullif(trim(p_requested_username), ''), p_display_name, 'member'));

  if v_base is null or char_length(v_base) < 3 then
    v_base := 'member';
  end if;

  loop
    if v_suffix = 0 then
      v_candidate := v_base;
    else
      v_candidate := left(v_base, greatest(3, 30 - char_length(v_suffix::text) - 1)) || '.' || v_suffix::text;
    end if;

    if char_length(v_candidate) < 3 then
      v_candidate := left('member.' || v_fallback_suffix, 30);
    end if;

    exit when public.cx_is_reserved_profile_username(v_candidate) is not true
      and not exists (
        select 1
        from public.profiles p
        where p.user_id <> p_user_id
          and lower(coalesce(p.username, '')) = lower(v_candidate)
      );

    v_suffix := v_suffix + 1;

    if v_suffix > 9999 then
      v_candidate := left('member.' || v_fallback_suffix, 30);
      exit when public.cx_is_reserved_profile_username(v_candidate) is not true
        and not exists (
          select 1
          from public.profiles p
          where p.user_id <> p_user_id
            and lower(coalesce(p.username, '')) = lower(v_candidate)
        );
    end if;
  end loop;

  return v_candidate;
end;
$$;

create or replace function public.cx_profiles_apply_username()
returns trigger
language plpgsql
as $$
begin
  if new.username is null or btrim(new.username) = '' then
    if tg_op = 'INSERT' or old.display_name is distinct from new.display_name or old.username is distinct from new.username then
      new.username := public.cx_resolve_profile_username(new.user_id, new.display_name, null);
    end if;
    return new;
  end if;

  new.username := public.cx_normalize_profile_username(new.username);

  if new.username is null or char_length(new.username) < 3 then
    raise exception using errcode = '22023', message = 'Username must be at least 3 characters.';
  end if;

  if new.username !~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$' then
    raise exception using errcode = '22023', message = 'Username may only include letters, numbers, dots, and underscores.';
  end if;

  if public.cx_is_reserved_profile_username(new.username) then
    raise exception using errcode = '22023', message = 'That username is reserved.';
  end if;

  return new;
end;
$$;

drop trigger if exists cx_profiles_apply_username on public.profiles;

create trigger cx_profiles_apply_username
before insert or update of username, display_name
on public.profiles
for each row
execute function public.cx_profiles_apply_username();

update public.profiles
set username = null
where username is not null
  and (
    public.cx_normalize_profile_username(username) is null
    or char_length(public.cx_normalize_profile_username(username)) < 3
    or public.cx_is_reserved_profile_username(username)
    or username <> public.cx_normalize_profile_username(username)
  );

update public.profiles
set username = public.cx_resolve_profile_username(user_id, display_name, null)
where username is null
   or btrim(username) = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_chk'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_chk
      check (username ~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_reserved_chk'
  ) then
    alter table public.profiles
      add constraint profiles_username_reserved_chk
      check (public.cx_is_reserved_profile_username(username) is not true);
  end if;
end $$;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username));

commit;

notify pgrst, 'reload schema';

select count(*) as total_profiles_with_username
from public.profiles
where username is not null;
