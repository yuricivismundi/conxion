-- Sync group members to their group's thread_participants automatically

begin;

-- ── 1. Update cx_ensure_group_thread to add ALL existing members ─────────────
create or replace function public.cx_ensure_group_thread(
  p_group_id uuid,
  p_actor    uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_owner     uuid;
begin
  if p_group_id is null then
    raise exception 'group_required';
  end if;

  select host_user_id into v_owner from public.groups where id = p_group_id limit 1;
  if v_owner is null then
    raise exception 'group_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext('cx_group:' || p_group_id::text)::bigint);

  select id into v_thread_id
  from public.threads
  where thread_type = 'group' and group_id = p_group_id
  order by created_at asc
  limit 1;

  if v_thread_id is null then
    insert into public.threads (thread_type, group_id, created_by, last_message_at)
    values ('group', p_group_id, coalesce(p_actor, v_owner), now())
    returning id into v_thread_id;
  end if;

  -- Add ALL current group members as participants
  insert into public.thread_participants (thread_id, user_id, role)
  select
    v_thread_id,
    gm.user_id,
    case when gm.user_id = v_owner then 'owner' else 'member' end
  from public.group_members gm
  where gm.group_id = p_group_id
  on conflict (thread_id, user_id) do nothing;

  return v_thread_id;
end;
$function$;

grant execute on function public.cx_ensure_group_thread(uuid, uuid) to authenticated;

-- ── 2. Trigger: add member to thread_participants when they join a group ──────
create or replace function public.trg_group_member_add_to_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_thread_id uuid;
  v_owner     uuid;
begin
  select id into v_thread_id
  from public.threads
  where thread_type = 'group' and group_id = new.group_id
  limit 1;

  if v_thread_id is null then
    return new;
  end if;

  select host_user_id into v_owner from public.groups where id = new.group_id limit 1;

  insert into public.thread_participants (thread_id, user_id, role)
  values (
    v_thread_id,
    new.user_id,
    case when new.user_id = v_owner then 'owner' else 'member' end
  )
  on conflict (thread_id, user_id) do nothing;

  return new;
end;
$function$;

drop trigger if exists trg_group_member_add_to_thread on public.group_members;
create trigger trg_group_member_add_to_thread
  after insert on public.group_members
  for each row execute function public.trg_group_member_add_to_thread();

-- ── 3. Backfill: add all existing group members to their thread_participants ──
do $$
declare
  v_thread_id uuid;
  v_owner     uuid;
  r record;
begin
  for r in
    select g.id as group_id, g.host_user_id, t.id as thread_id
    from public.groups g
    join public.threads t on t.group_id = g.id and t.thread_type = 'group'
  loop
    insert into public.thread_participants (thread_id, user_id, role)
    select
      r.thread_id,
      gm.user_id,
      case when gm.user_id = r.host_user_id then 'owner' else 'member' end
    from public.group_members gm
    where gm.group_id = r.group_id
    on conflict (thread_id, user_id) do nothing;
  end loop;
end;
$$;

-- ── 4. Ensure every group that has members has a thread ──────────────────────
do $$
declare
  r record;
begin
  for r in
    select distinct gm.group_id
    from public.group_members gm
    where not exists (
      select 1 from public.threads t
      where t.group_id = gm.group_id and t.thread_type = 'group'
    )
  loop
    perform public.cx_ensure_group_thread(r.group_id, (
      select host_user_id from public.groups where id = r.group_id limit 1
    ));
  end loop;
end;
$$;

commit;
