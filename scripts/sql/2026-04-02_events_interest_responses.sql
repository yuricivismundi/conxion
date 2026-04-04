begin;

alter table public.event_members
  drop constraint if exists event_members_status_chk;

alter table public.event_members
  add constraint event_members_status_chk
  check (status in ('host', 'interested', 'going', 'waitlist', 'not_interested', 'left'));

create or replace function public.join_public_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing public.event_members;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.visibility <> 'public' then
    raise exception 'private_event_requires_request';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  select *
    into v_existing
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
  limit 1;

  if v_existing is not null and v_existing.status in ('going', 'host', 'waitlist') then
    return v_existing.status;
  end if;

  if public.event_has_capacity(p_event_id) then
    v_status := 'going';
  else
    v_status := 'waitlist';
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (p_event_id, v_me, 'guest', v_status)
  on conflict (event_id, user_id)
  do update set
    status = excluded.status,
    member_role = 'guest',
    joined_at = now(),
    updated_at = now();

  return v_status;
end;
$function$;

create or replace function public.request_private_event_access(
  p_event_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing_member public.event_members;
  v_req_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.visibility <> 'private' then
    raise exception 'event_is_public';
  end if;

  if v_event.host_user_id = v_me then
    raise exception 'host_cannot_request_own_event';
  end if;

  select *
    into v_existing_member
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('host', 'going', 'waitlist')
  limit 1;

  if v_existing_member is not null then
    raise exception 'already_joined_or_waitlisted';
  end if;

  insert into public.event_requests (event_id, requester_id, note, status)
  values (p_event_id, v_me, nullif(trim(coalesce(p_note, '')), ''), 'pending')
  on conflict (event_id, requester_id)
  do update set
    note = excluded.note,
    status = 'pending',
    decided_by = null,
    decided_at = null,
    updated_at = now()
  returning id into v_req_id;

  return v_req_id;
end;
$function$;

create or replace function public.respond_event_request(
  p_request_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_request public.event_requests;
  v_event public.events;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_member_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_action not in ('accept', 'decline') then
    raise exception 'invalid_action';
  end if;

  select *
    into v_request
  from public.event_requests r
  where r.id = p_request_id
  limit 1;

  if v_request is null then
    raise exception 'request_not_found';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = v_request.event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.host_user_id <> v_me then
    raise exception 'not_authorized';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  if v_action = 'accept' then
    if public.event_has_capacity(v_event.id) then
      v_member_status := 'going';
    else
      v_member_status := 'waitlist';
    end if;

    insert into public.event_members (event_id, user_id, member_role, status)
    values (v_event.id, v_request.requester_id, 'guest', v_member_status)
    on conflict (event_id, user_id)
    do update set
      member_role = 'guest',
      status = excluded.status,
      joined_at = now(),
      updated_at = now();

    update public.event_requests
      set status = 'accepted',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  else
    update public.event_requests
      set status = 'declined',
          decided_by = v_me,
          decided_at = now(),
          updated_at = now()
    where id = p_request_id;
  end if;

  return v_event.id;
end;
$function$;

create or replace function public.leave_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_host uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select e.host_user_id into v_host
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_host is null then
    raise exception 'event_not_found';
  end if;

  if v_host = v_me then
    raise exception 'host_cannot_leave_own_event';
  end if;

  update public.event_members em
    set status = 'left',
        updated_at = now()
  where em.event_id = p_event_id
    and em.user_id = v_me
    and em.status in ('going', 'waitlist');

  if not found then
    raise exception 'membership_not_found';
  end if;
end;
$function$;

create or replace function public.set_event_response(
  p_event_id uuid,
  p_response text
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_event public.events;
  v_existing public.event_members;
  v_response text := lower(trim(coalesce(p_response, '')));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_response not in ('interested', 'not_interested') then
    raise exception 'invalid_response';
  end if;

  select *
    into v_event
  from public.events e
  where e.id = p_event_id
  limit 1;

  if v_event is null then
    raise exception 'event_not_found';
  end if;

  if v_event.status <> 'published' then
    raise exception 'event_not_open';
  end if;

  if v_event.host_user_id = v_me then
    return 'host';
  end if;

  select *
    into v_existing
  from public.event_members em
  where em.event_id = p_event_id
    and em.user_id = v_me
  limit 1;

  if v_existing is not null and v_existing.status = 'host' then
    return 'host';
  end if;

  insert into public.event_members (event_id, user_id, member_role, status)
  values (p_event_id, v_me, 'guest', v_response)
  on conflict (event_id, user_id)
  do update set
    member_role = 'guest',
    status = excluded.status,
    updated_at = now();

  if v_response = 'not_interested' then
    update public.event_requests
      set status = 'cancelled',
          decided_by = null,
          decided_at = null,
          updated_at = now()
    where event_id = p_event_id
      and requester_id = v_me
      and status = 'pending';
  end if;

  return v_response;
end;
$function$;

grant execute on function public.set_event_response(uuid, text) to authenticated;

commit;
