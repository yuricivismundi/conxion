-- ConXion references: one submitted reference per direction + pair + activity type.
-- Date: 2026-03-21
-- Rules:
-- - connection acceptance does not create references
-- - completed activities can create reference prompts
-- - only one pending prompt per user -> peer -> context_tag at a time
-- - only one submitted reference per author -> recipient -> context_tag
-- - if no reference was submitted and prompt expires, a later completed activity may create a new prompt

begin;

-- Normalize older legacy context tags.
update public.references
set context_tag = case
  when context_tag = 'travel' then 'travel_together'
  when context_tag = 'host' then 'hosting'
  when context_tag = 'guest' then 'stay_as_guest'
  else context_tag
end
where context_tag in ('travel', 'host', 'guest');

update public.reference_requests
set context_tag = case
  when context_tag = 'travel' then 'travel_together'
  when context_tag = 'host' then 'hosting'
  when context_tag = 'guest' then 'stay_as_guest'
  else context_tag
end
where context_tag in ('travel', 'host', 'guest');

-- References: first valid submitted reference wins forever for a given pair + type.
with ranked as (
  select
    id,
    row_number() over (
      partition by author_id, recipient_id, context_tag
      order by created_at asc nulls last, id asc
    ) as rn
  from public.references
  where author_id is not null
    and recipient_id is not null
    and context_tag is not null
)
delete from public.references r
using ranked d
where r.id = d.id
  and d.rn > 1;

drop index if exists public.ux_references_pair_context_once;
create unique index if not exists ux_references_pair_context_once
  on public.references(author_id, recipient_id, context_tag)
  where author_id is not null
    and recipient_id is not null
    and context_tag is not null;

-- Reference requests: keep only one open prompt per pair + type.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, peer_user_id, context_tag
      order by
        case status
          when 'pending' then 0
          when 'completed' then 1
          when 'dismissed' then 2
          when 'expired' then 3
          else 4
        end,
        due_at desc nulls last,
        created_at desc nulls last,
        id desc
    ) as rn
  from public.reference_requests
  where user_id is not null
    and peer_user_id is not null
    and context_tag is not null
)
delete from public.reference_requests rr
using ranked d
where rr.id = d.id
  and d.rn > 1;

alter table public.reference_requests drop constraint if exists reference_requests_context_tag_chk;
alter table public.reference_requests
  add constraint reference_requests_context_tag_chk
  check (
    context_tag in (
      'practice',
      'social_dance',
      'event',
      'festival',
      'travel_together',
      'hosting',
      'stay_as_guest',
      'private_class',
      'group_class',
      'workshop',
      'collaboration',
      'content_video',
      'competition'
    )
  ) not valid;

drop index if exists public.ux_reference_requests_unique;
drop index if exists public.ux_reference_requests_pending_pair_context;
create unique index if not exists ux_reference_requests_pending_pair_context
  on public.reference_requests(user_id, peer_user_id, context_tag)
  where status = 'pending';

create or replace function public.cx_sync_reference_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_created int := 0;
  v_completed int := 0;
  v_expired int := 0;
  v_reminded int := 0;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  v_peer_id uuid;
  v_context_tag text;
  v_inserted int := 0;
  v_row record;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- Trip completion prompts (24h after trip end date).
  for v_row in
    select
      tr.id as source_id,
      tr.requester_id,
      t.user_id as owner_id,
      t.end_date
    from public.trip_requests tr
    join public.trips t on t.id = tr.trip_id
    where tr.status = 'accepted'
      and t.end_date is not null
      and t.end_date <= current_date
      and (tr.requester_id = v_me or t.user_id = v_me)
  loop
    v_peer_id := case when v_row.requester_id = v_me then v_row.owner_id else v_row.requester_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    if exists (
      select 1
      from public.references ref
      where ref.author_id = v_me
        and ref.recipient_id = v_peer_id
        and ref.context_tag = 'travel_together'
    ) then
      continue;
    end if;

    v_due_at := (v_row.end_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';
    v_context_tag := 'travel_together';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values (
      v_me,
      v_peer_id,
      v_context_tag,
      'trip_requests',
      v_row.source_id,
      v_conn_id,
      v_due_at,
      v_remind_after,
      v_expires_at,
      'pending'
    )
    on conflict (user_id, peer_user_id, context_tag) where status = 'pending' do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  -- Hosting completion prompts (24h after departure date).
  for v_row in
    select
      hr.id as source_id,
      hr.sender_user_id,
      hr.recipient_user_id,
      hr.request_type,
      hr.departure_date
    from public.hosting_requests hr
    where hr.status = 'accepted'
      and hr.departure_date is not null
      and hr.departure_date <= current_date
      and (hr.sender_user_id = v_me or hr.recipient_user_id = v_me)
  loop
    v_peer_id := case when v_row.sender_user_id = v_me then v_row.recipient_user_id else v_row.sender_user_id end;
    if v_peer_id is null or v_peer_id = v_me then
      continue;
    end if;

    if (v_row.request_type = 'request_hosting' and v_row.recipient_user_id = v_me)
       or (v_row.request_type = 'offer_to_host' and v_row.sender_user_id = v_me) then
      v_context_tag := 'hosting';
    else
      v_context_tag := 'stay_as_guest';
    end if;

    if exists (
      select 1
      from public.references ref
      where ref.author_id = v_me
        and ref.recipient_id = v_peer_id
        and ref.context_tag = v_context_tag
    ) then
      continue;
    end if;

    v_due_at := (v_row.departure_date::timestamptz + interval '24 hours');
    if v_due_at > now() then
      continue;
    end if;

    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = v_me and c.target_id = v_peer_id)
        or (c.requester_id = v_peer_id and c.target_id = v_me)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    values (
      v_me,
      v_peer_id,
      v_context_tag,
      'hosting_requests',
      v_row.source_id,
      v_conn_id,
      v_due_at,
      v_remind_after,
      v_expires_at,
      'pending'
    )
    on conflict (user_id, peer_user_id, context_tag) where status = 'pending' do nothing;

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
  end loop;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where rr.user_id = v_me
    and rr.status = 'pending'
    and ref.author_id = v_me
    and ref.recipient_id = rr.peer_user_id
    and ref.context_tag = rr.context_tag;
  get diagnostics v_completed = row_count;

  update public.reference_requests rr
  set status = 'expired', updated_at = now()
  where rr.user_id = v_me
    and rr.status = 'pending'
    and now() > rr.expires_at;
  get diagnostics v_expired = row_count;

  if to_regclass('public.notifications') is not null then
    for v_row in
      select rr.id, rr.peer_user_id, rr.context_tag, rr.source_table, rr.source_id, rr.reminder_count
      from public.reference_requests rr
      where rr.user_id = v_me
        and rr.status = 'pending'
        and now() >= rr.remind_after
        and now() <= rr.expires_at
        and (rr.last_reminded_at is null or rr.last_reminded_at <= now() - interval '2 days')
    loop
      insert into public.notifications (user_id, actor_id, kind, title, body, link_url, metadata)
      values (
        v_me,
        v_row.peer_user_id,
        'reference_reminder',
        'Reference reminder',
        'Leave a quick reference for your recent interaction.',
        '/references',
        jsonb_build_object(
          'context_tag', v_row.context_tag,
          'source_table', v_row.source_table,
          'source_id', v_row.source_id,
          'prompt_id', v_row.id
        )
      );

      update public.reference_requests
      set
        reminder_count = coalesce(reminder_count, 0) + 1,
        last_reminded_at = now(),
        updated_at = now()
      where id = v_row.id;

      v_reminded := v_reminded + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'completed', v_completed,
    'expired', v_expired,
    'reminded', v_reminded
  );
end;
$function$;

grant execute on function public.cx_sync_reference_requests() to authenticated;

create or replace function public.cx_mark_reference_request_completed(
  p_reference_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_rows int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_reference_id is null then
    return 0;
  end if;

  update public.reference_requests rr
  set
    status = 'completed',
    completed_reference_id = ref.id,
    updated_at = now()
  from public.references ref
  where ref.id = p_reference_id
    and rr.user_id = v_me
    and rr.status = 'pending'
    and ref.author_id = v_me
    and ref.recipient_id = rr.peer_user_id
    and ref.context_tag = rr.context_tag;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

grant execute on function public.cx_mark_reference_request_completed(uuid) to authenticated;

create or replace function public.cx_sync_activities()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_completed_count int := 0;
  v_prompt_count int := 0;
  v_context_tag text;
  v_conn_id uuid;
  v_due_at timestamptz;
  v_remind_after timestamptz;
  v_expires_at timestamptz;
  r record;
  v_inserted int := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  for r in
    update public.activities a
    set status = 'completed',
        completed_at = coalesce(a.completed_at, now()),
        resolved_at = coalesce(a.resolved_at, now()),
        updated_at = now()
    where a.status = 'accepted'
      and (a.requester_id = v_me or a.recipient_id = v_me)
      and (
        case
          when coalesce(a.end_at, a.start_at) is not null then coalesce(a.end_at, a.start_at) + interval '24 hours'
          when a.accepted_at is not null then a.accepted_at + interval '24 hours'
          else null
        end
      ) <= now()
    returning a.*
  loop
    v_completed_count := v_completed_count + 1;

    perform public.cx_upsert_thread_context(
      p_thread_id => r.thread_id,
      p_source_table => 'activities',
      p_source_id => r.id,
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_title => coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type)),
      p_city => null,
      p_start_date => case when r.start_at is null then null else (r.start_at at time zone 'UTC')::date end,
      p_end_date => case when coalesce(r.end_at, r.start_at) is null then null else (coalesce(r.end_at, r.start_at) at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    perform public.cx_emit_thread_event(
      p_thread_id => r.thread_id,
      p_sender_id => r.requester_id,
      p_body => public.cx_activity_type_label(r.activity_type) || ' completed. Leave a reference.',
      p_message_type => 'system',
      p_context_tag => 'activity',
      p_status_tag => 'completed',
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object('activity_type', r.activity_type, 'activity_id', r.id)
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '7 days';

    select c.id
      into v_conn_id
    from public.connections c
    where coalesce(c.status::text, '') = 'accepted'
      and c.blocked_by is null
      and (
        (c.requester_id = r.requester_id and c.target_id = r.recipient_id)
        or (c.requester_id = r.recipient_id and c.target_id = r.requester_id)
      )
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit 1;

    insert into public.reference_requests (
      user_id,
      peer_user_id,
      context_tag,
      source_table,
      source_id,
      connection_id,
      due_at,
      remind_after,
      expires_at,
      status
    )
    select *
    from (
      values
        (r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'),
        (r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending')
    ) as prompts(user_id, peer_user_id, context_tag, source_table, source_id, connection_id, due_at, remind_after, expires_at, status)
    where not exists (
      select 1
      from public.references ref
      where ref.author_id = prompts.user_id
        and ref.recipient_id = prompts.peer_user_id
        and ref.context_tag = prompts.context_tag
    )
    on conflict (user_id, peer_user_id, context_tag) where status = 'pending' do nothing;

    get diagnostics v_inserted = row_count;
    v_prompt_count := v_prompt_count + v_inserted;
  end loop;

  return jsonb_build_object(
    'completed', v_completed_count,
    'reference_prompts_created', v_prompt_count
  );
end;
$function$;

grant execute on function public.cx_sync_activities() to authenticated;

commit;
