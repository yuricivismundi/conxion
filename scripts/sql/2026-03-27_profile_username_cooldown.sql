begin;

alter table public.profiles
  add column if not exists username_changed_at timestamptz;

create or replace function public.cx_profiles_apply_username()
returns trigger
language plpgsql
as $$
declare
  v_previous_username text;
  v_cooldown_until timestamptz;
begin
  v_previous_username :=
    case
      when tg_op = 'UPDATE' then public.cx_normalize_profile_username(old.username)
      else null
    end;

  if new.username is null or btrim(new.username) = '' then
    if tg_op = 'INSERT' or old.display_name is distinct from new.display_name or old.username is distinct from new.username then
      new.username := public.cx_resolve_profile_username(new.user_id, new.display_name, null);
    end if;
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

  if tg_op = 'INSERT' then
    new.username_changed_at := null;
    return new;
  end if;

  if v_previous_username is distinct from new.username then
    v_cooldown_until := old.username_changed_at + interval '90 days';
    if old.username_changed_at is not null and v_cooldown_until > now() then
      raise exception using errcode = '22023', message = format(
        'Username can be changed every 90 days. Next change available on %s.',
        to_char(v_cooldown_until at time zone 'UTC', 'Mon DD, YYYY')
      );
    end if;

    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists cx_profiles_apply_username on public.profiles;

create trigger cx_profiles_apply_username
before insert or update of username, display_name, username_changed_at
on public.profiles
for each row
execute function public.cx_profiles_apply_username();

commit;

notify pgrst, 'reload schema';
