-- Fix send_event_invitation to always insert inviter_user_id + recipient_user_id (the actual NOT NULL columns).
create or replace function public.send_event_invitation(
  p_event_id uuid,
  p_recipient_id uuid,
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
  v_invitation_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_event_id is null then
    raise exception 'event_not_found';
  end if;

  if p_recipient_id is null then
    raise exception 'recipient_required';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_invite_self';
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

  if coalesce(v_event.hidden_by_admin, false) then
    raise exception 'event_hidden';
  end if;

  -- Non-hosts must be an active member (going or waitlist) to invite
  if v_event.host_user_id <> v_me then
    if not exists (
      select 1
      from public.event_members em
      where em.event_id = p_event_id
        and em.user_id = v_me
        and em.status in ('host', 'going', 'waitlist')
    ) then
      raise exception 'invite_requires_event_membership';
    end if;
  end if;

  if not exists (
    select 1
    from public.connections c
    where (
      (c.requester_id = v_me and c.target_id = p_recipient_id)
      or (c.requester_id = p_recipient_id and c.target_id = v_me)
    )
      and c.status = 'accepted'
      and c.blocked_by is null
  ) then
    raise exception 'invite_requires_connection';
  end if;

  if exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id
      and em.user_id = p_recipient_id
      and em.status in ('host', 'going', 'waitlist')
  ) then
    raise exception 'already_joined_or_waitlisted';
  end if;

  v_invitation_id := gen_random_uuid();

  insert into public.event_invitations
    (id, event_id, inviter_user_id, recipient_user_id, note, created_at, updated_at)
  values
    (v_invitation_id, p_event_id, v_me, p_recipient_id, p_note, now(), now())
  on conflict (event_id, recipient_user_id) do update
    set inviter_user_id = excluded.inviter_user_id,
        note            = excluded.note,
        updated_at      = now()
  returning id into v_invitation_id;

  return v_invitation_id;
end;
$function$;

grant execute on function public.send_event_invitation(uuid, uuid, text) to authenticated;
