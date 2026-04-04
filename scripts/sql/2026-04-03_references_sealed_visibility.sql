-- References sealed visibility + 10 day window
-- Date: 2026-04-03
-- Safe to re-run.

begin;

alter table public.references
  add column if not exists public_after_at timestamptz;

alter table public.references
  alter column public_after_at set default (now() + interval '10 days');

do $$
begin
  if to_regclass('public.references') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_guardrails'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references disable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_immutable'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references disable trigger trg_references_immutable';
  end if;
end $$;

update public.references
set public_after_at = coalesce(public_after_at, created_at, now())
where public_after_at is null;

do $$
begin
  if to_regclass('public.references') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_guardrails'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references enable trigger trg_references_guardrails';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_references_immutable'
      and t.tgrelid = 'public.references'::regclass
  ) then
    execute 'alter table public.references enable trigger trg_references_immutable';
  end if;
end $$;

create index if not exists idx_references_public_after_at
  on public.references(public_after_at desc);

create or replace function public.cx_reference_author_id(
  p_author_id uuid,
  p_from_user_id uuid,
  p_source_id uuid
)
returns uuid
language sql
immutable
as $$
  select coalesce(p_author_id, p_from_user_id, p_source_id);
$$;

create or replace function public.cx_reference_recipient_id(
  p_recipient_id uuid,
  p_to_user_id uuid,
  p_target_id uuid
)
returns uuid
language sql
immutable
as $$
  select coalesce(p_recipient_id, p_to_user_id, p_target_id);
$$;

create or replace function public.cx_reference_context_key(
  p_context_tag text,
  p_context text,
  p_entity_type text
)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(nullif(p_context_tag, ''), nullif(p_context, ''), nullif(p_entity_type, ''), 'connection')));
$$;

create or replace function public.cx_references_reveal_mutual()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_author uuid := public.cx_reference_author_id(new.author_id, new.from_user_id, new.source_id);
  v_recipient uuid := public.cx_reference_recipient_id(new.recipient_id, new.to_user_id, new.target_id);
  v_context_key text := public.cx_reference_context_key(new.context_tag, new.context, new.entity_type);
begin
  if v_author is null or v_recipient is null then
    return new;
  end if;

  if exists (
    select 1
    from public.references ref
    where ref.id <> new.id
      and public.cx_reference_author_id(ref.author_id, ref.from_user_id, ref.source_id) = v_recipient
      and public.cx_reference_recipient_id(ref.recipient_id, ref.to_user_id, ref.target_id) = v_author
      and public.cx_reference_context_key(ref.context_tag, ref.context, ref.entity_type) = v_context_key
  ) then
    update public.references ref
    set public_after_at = now()
    where ref.id = new.id
       or (
         public.cx_reference_author_id(ref.author_id, ref.from_user_id, ref.source_id) = v_recipient
         and public.cx_reference_recipient_id(ref.recipient_id, ref.to_user_id, ref.target_id) = v_author
         and public.cx_reference_context_key(ref.context_tag, ref.context, ref.entity_type) = v_context_key
       );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_references_reveal_mutual on public.references;
create trigger trg_references_reveal_mutual
after insert on public.references
for each row execute function public.cx_references_reveal_mutual();

update public.reference_requests
set expires_at = due_at + interval '10 days',
    remind_after = coalesce(remind_after, due_at + interval '2 days'),
    updated_at = now()
where expires_at is distinct from due_at + interval '10 days'
   or remind_after is null;

update public.reference_requests
set status = 'pending',
    expires_at = due_at + interval '10 days',
    updated_at = now()
where status = 'expired'
  and completed_reference_id is null
  and now() <= due_at + interval '10 days';

update public.reference_requests
set status = 'expired',
    updated_at = now()
where status = 'pending'
  and now() > due_at + interval '10 days';

alter table public.references enable row level security;

drop policy if exists references_select_participants on public.references;
create policy references_select_participants
on public.references for select
to authenticated
using (
  public.cx_reference_author_id(author_id, from_user_id, source_id) = auth.uid()
  or public.cx_reference_recipient_id(recipient_id, to_user_id, target_id) = auth.uid()
  or coalesce(public_after_at, created_at, now()) <= now()
);

create or replace function public.create_reference_v2(
  p_connection_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_recipient_id uuid,
  p_sentiment text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_connection record;
  v_sync_ok bool := false;
  v_trip_ok bool := false;
  v_event_ok bool := false;
  v_entity_type text := lower(trim(coalesce(p_entity_type, 'connection')));
  v_entity_id uuid := coalesce(p_entity_id, p_connection_id);
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_recipient_id = v_me then
    raise exception 'cannot_reference_self';
  end if;

  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;

  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  if v_entity_type not in ('connection', 'sync', 'trip', 'event') then
    raise exception 'invalid_entity_type';
  end if;

  select c.*
    into v_connection
  from public.connections c
  where c.id = p_connection_id
    and c.status = 'accepted'
    and c.blocked_by is null
    and (c.requester_id = v_me or c.target_id = v_me)
  limit 1;

  if v_connection is null then
    raise exception 'connection_not_eligible_for_reference';
  end if;

  if not (
    (v_connection.requester_id = v_me and v_connection.target_id = p_recipient_id)
    or
    (v_connection.target_id = v_me and v_connection.requester_id = p_recipient_id)
  ) then
    raise exception 'recipient_not_in_connection';
  end if;

  if v_entity_type = 'connection' then
    select exists (
      select 1
      from public.syncs s
      where s.connection_id = p_connection_id
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'references_require_completed_sync';
    end if;
  elsif v_entity_type = 'sync' then
    select exists (
      select 1
      from public.connection_syncs s
      where s.id = v_entity_id
        and s.connection_id = p_connection_id
        and s.status = 'completed'
        and s.completed_at is not null
        and s.completed_at >= now() - interval '10 days'
        and ((s.requester_id = v_me and s.recipient_id = p_recipient_id) or (s.requester_id = p_recipient_id and s.recipient_id = v_me))
    ) into v_sync_ok;
    if not v_sync_ok then
      raise exception 'sync_reference_not_allowed';
    end if;
  elsif v_entity_type = 'trip' then
    select exists (
      select 1
      from public.trip_requests tr
      join public.trips t on t.id = tr.trip_id
      where tr.id = v_entity_id
        and tr.status = 'accepted'
        and t.end_date::date <= current_date
        and t.end_date::date >= current_date - 10
        and ((t.user_id = v_me and tr.requester_id = p_recipient_id) or (t.user_id = p_recipient_id and tr.requester_id = v_me))
    ) into v_trip_ok;
    if not v_trip_ok then
      raise exception 'trip_reference_not_allowed';
    end if;
  elsif v_entity_type = 'event' then
    select exists (
      select 1
      from public.events e
      join public.event_members em_a on em_a.event_id = e.id and em_a.user_id = v_me and em_a.status in ('host', 'going', 'waitlist')
      join public.event_members em_b on em_b.event_id = e.id and em_b.user_id = p_recipient_id and em_b.status in ('host', 'going', 'waitlist')
      where e.id = v_entity_id
        and e.ends_at <= now()
        and e.ends_at >= now() - interval '10 days'
    ) into v_event_ok;
    if not v_event_ok then
      raise exception 'event_reference_not_allowed';
    end if;
  end if;

  insert into public.references (
    connection_id,
    author_id,
    recipient_id,
    context,
    entity_type,
    entity_id,
    sentiment,
    body,
    public_after_at
  )
  values (
    p_connection_id,
    v_me,
    p_recipient_id,
    v_entity_type,
    v_entity_type,
    v_entity_id,
    p_sentiment,
    trim(p_body),
    now() + interval '10 days'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.create_reference_v2(uuid, text, uuid, uuid, text, text) to authenticated;

create or replace function public.update_reference_author(
  p_reference_id uuid,
  p_sentiment text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'invalid_sentiment';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 8 then
    raise exception 'reference_body_too_short';
  end if;

  update public.references r
  set sentiment = p_sentiment,
      body = trim(p_body),
      edit_count = coalesce(r.edit_count, 0) + 1,
      last_edited_at = now()
  where r.id = p_reference_id
    and r.author_id = v_me
    and coalesce(r.edit_count, 0) < 1
    and r.created_at >= now() - interval '10 days';

  if not found then
    raise exception 'reference_update_not_allowed';
  end if;

  return p_reference_id;
end;
$function$;

grant execute on function public.update_reference_author(uuid, text, text) to authenticated;

create or replace function public.reply_reference_receiver(
  p_reference_id uuid,
  p_reply_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_clean text := trim(coalesce(p_reply_text, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(v_clean) < 2 or char_length(v_clean) > 400 then
    raise exception 'invalid_reply_length';
  end if;

  update public.references r
  set reply_text = v_clean,
      replied_by = v_me,
      replied_at = now()
  where r.id = p_reference_id
    and r.recipient_id = v_me
    and r.reply_text is null
    and r.created_at >= now() - interval '10 days';

  if not found then
    raise exception 'reference_reply_not_allowed';
  end if;

  return p_reference_id;
end;
$function$;

grant execute on function public.reply_reference_receiver(uuid, text) to authenticated;

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
    v_expires_at := v_due_at + interval '10 days';
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
    v_expires_at := v_due_at + interval '10 days';

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
      p_end_date => case when r.end_at is null then null else (r.end_at at time zone 'UTC')::date end,
      p_requester_id => r.requester_id,
      p_recipient_id => r.recipient_id,
      p_metadata => coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_type', r.activity_type,
        'activity_id', r.id,
        'title', coalesce(nullif(trim(coalesce(r.title, '')), ''), public.cx_activity_type_label(r.activity_type))
      )
    );

    v_context_tag := public.cx_activity_reference_context(r.activity_type);
    v_due_at := coalesce(r.completed_at, now());
    v_remind_after := v_due_at + interval '2 days';
    v_expires_at := v_due_at + interval '10 days';

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
    values
      (r.requester_id, r.recipient_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending'),
      (r.recipient_id, r.requester_id, v_context_tag, 'activities', r.id, v_conn_id, v_due_at, v_remind_after, v_expires_at, 'pending')
    on conflict (user_id, source_table, source_id, context_tag) do nothing;

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
