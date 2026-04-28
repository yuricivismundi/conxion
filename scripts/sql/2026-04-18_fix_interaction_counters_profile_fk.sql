-- Prevent interaction counter refreshes from inserting counters for deleted/sample users.
-- The counter tables reference profiles(user_id), so every aggregate row must be
-- filtered through profiles before insert.

create or replace function public.cx_refresh_member_interaction_counters(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if p_user_id is null then
    delete from public.member_interaction_counters;
    delete from public.pair_interaction_counters;
  else
    delete from public.member_interaction_counters where user_id = p_user_id;
    delete from public.pair_interaction_counters where user_a_id = p_user_id or user_b_id = p_user_id;
  end if;

  drop table if exists pg_temp.cx_counter_interactions;

  create temporary table cx_counter_interactions on commit drop as
  select *
  from (
    select a.requester_id as user_id,
           a.recipient_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select a.recipient_id as user_id,
           a.requester_id as peer_user_id,
           case lower(trim(coalesce(a.activity_type, 'collaborate')))
             when 'practice' then 'practice_count'
             when 'social_dance' then 'social_dance_count'
             when 'event_festival' then 'event_festival_count'
             when 'travelling' then 'travelling_count'
             when 'request_hosting' then 'request_hosting_count'
             when 'offer_hosting' then 'offer_hosting_count'
             when 'private_class' then 'classes_count'
             else 'collaborate_count'
           end as counter_type
    from public.activities a
    where a.status = 'completed'
      and (p_user_id is null or a.requester_id = p_user_id or a.recipient_id = p_user_id)

    union all

    select s.requester_id as user_id,
           s.recipient_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select s.recipient_id as user_id,
           s.requester_id as peer_user_id,
           case lower(trim(coalesce(s.sync_type, 'training')))
             when 'social_dancing' then 'social_dance_count'
             when 'private_class' then 'classes_count'
             when 'workshop' then 'classes_count'
             else 'practice_count'
           end as counter_type
    from public.connection_syncs s
    where s.status = 'completed'
      and (p_user_id is null or s.requester_id = p_user_id or s.recipient_id = p_user_id)

    union all

    select tr.requester_id as user_id,
           t.user_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select t.user_id as user_id,
           tr.requester_id as peer_user_id,
           'travelling_count' as counter_type
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (p_user_id is null or tr.requester_id = p_user_id or t.user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as peer_user_id,
           'offer_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select case
             when hr.request_type = 'request_hosting' then hr.sender_user_id
             when hr.request_type = 'offer_to_host' then hr.recipient_user_id
             else hr.sender_user_id
           end as user_id,
           case
             when hr.request_type = 'request_hosting' then hr.recipient_user_id
             when hr.request_type = 'offer_to_host' then hr.sender_user_id
             else hr.recipient_user_id
           end as peer_user_id,
           'request_hosting_count' as counter_type
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (p_user_id is null or hr.sender_user_id = p_user_id or hr.recipient_user_id = p_user_id)

    union all

    select em.user_id as user_id,
           e.host_user_id as peer_user_id,
           'event_festival_count' as counter_type
    from public.event_members em
    join public.events e on e.id = em.event_id
    where em.status in ('host', 'going', 'waitlist')
      and e.ends_at is not null
      and e.ends_at <= now()
      and (p_user_id is null or em.user_id = p_user_id or e.host_user_id = p_user_id)
  ) all_interactions
  where user_id is not null;

  with member_counts as (
    select i.user_id, i.counter_type, count(*)::int as count
    from pg_temp.cx_counter_interactions i
    join public.profiles p on p.user_id = i.user_id
    group by i.user_id, i.counter_type
  )
  insert into public.member_interaction_counters (user_id, counter_type, count, updated_at)
  select user_id, counter_type, count, v_now
  from member_counts
  on conflict (user_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  with pair_counts as (
    select
      least(i.user_id, i.peer_user_id) as user_a_id,
      greatest(i.user_id, i.peer_user_id) as user_b_id,
      case
        when i.counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else i.counter_type
      end as counter_type,
      count(*)::int as count
    from pg_temp.cx_counter_interactions i
    join public.profiles p_user on p_user.user_id = i.user_id
    join public.profiles p_peer on p_peer.user_id = i.peer_user_id
    where i.peer_user_id is not null
      and i.user_id <> i.peer_user_id
    group by least(i.user_id, i.peer_user_id), greatest(i.user_id, i.peer_user_id),
      case
        when i.counter_type in ('request_hosting_count', 'offer_hosting_count') then 'hosting_count'
        else i.counter_type
      end
  )
  insert into public.pair_interaction_counters (user_a_id, user_b_id, counter_type, count, updated_at)
  select user_a_id, user_b_id, counter_type, count, v_now
  from pair_counts
  on conflict (user_a_id, user_b_id, counter_type)
  do update set count = excluded.count, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$function$;

grant execute on function public.cx_refresh_member_interaction_counters(uuid) to authenticated;

select public.cx_refresh_member_interaction_counters(null);
