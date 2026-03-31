-- ConXion Dashboard saved dancers sample seed
-- Date: 2026-03-03
-- Usage:
--   1) Run scripts/sql/2026-03-03_dashboard_connections.sql first.
--   2) Optional: set v_email to a specific existing auth user email.
--   3) Run in Supabase SQL editor.

begin;

do $$
declare
  v_email text := '';
  v_me uuid;
  v_other uuid;
  v_pair_exists uuid;
  v_count integer := 0;
begin
  if to_regclass('public.connections') is null then
    raise exception 'Missing table public.connections. Run scripts/sql/2026-03-03_dashboard_connections.sql first.';
  end if;

  if length(trim(v_email)) > 0 then
    select u.id
    into v_me
    from auth.users u
    where lower(u.email) = lower(v_email)
    order by u.created_at asc
    limit 1;
  else
    select u.id
    into v_me
    from auth.users u
    where u.email is not null
      and lower(u.email) not like '%@local.test'
    order by u.created_at asc
    limit 1;
  end if;

  if v_me is null then
    if length(trim(v_email)) > 0 then
      raise exception 'No auth user found for email: %', v_email;
    end if;
    raise exception 'No auth user found. Create at least one real user first, or set v_email.';
  end if;

  for v_other in
    select u.id
    from auth.users u
    where u.id <> v_me
      and u.email is not null
      and lower(u.email) not like '%@local.test'
    order by u.created_at asc
    limit 6
  loop
    select c.id
    into v_pair_exists
    from public.connections c
    where (c.requester_id = v_me and c.target_id = v_other)
       or (c.requester_id = v_other and c.target_id = v_me)
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    if v_pair_exists is null then
      insert into public.connections (
        requester_id,
        target_id,
        status,
        blocked_by,
        connect_context,
        connect_reason,
        connect_reason_role,
        trip_id,
        connect_note,
        block_reason,
        created_at,
        updated_at
      )
      values (
        v_me,
        v_other,
        'accepted',
        null,
        'member',
        'dashboard_seed',
        null,
        null,
        'Seeded for Saved Dancers dashboard module',
        null,
        now() - ((v_count + 1) * interval '2 days'),
        now() - ((v_count + 1) * interval '1 day')
      );
    else
      update public.connections
      set status = 'accepted',
          blocked_by = null,
          connect_context = coalesce(connect_context, 'member'),
          updated_at = now() - ((v_count + 1) * interval '1 day')
      where id = v_pair_exists;
    end if;

    v_count := v_count + 1;
  end loop;

  raise notice 'Saved dancers seed complete for user % (email selector: %). Processed pairs: %',
    v_me,
    coalesce(nullif(trim(v_email), ''), 'auto'),
    v_count;
end $$;

commit;

notify pgrst, 'reload schema';
