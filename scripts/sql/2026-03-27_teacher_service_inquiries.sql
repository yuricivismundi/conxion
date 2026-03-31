begin;

create extension if not exists pgcrypto;

create table if not exists public.teacher_info_profiles (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  headline text,
  intro_text text,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_info_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null,
  title text not null,
  short_summary text,
  content_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_info_blocks_kind_chk check (kind in ('private_class', 'group_class', 'workshop', 'show', 'organizer_collab', 'other')),
  constraint teacher_info_blocks_title_chk check (length(btrim(title)) > 0),
  constraint teacher_info_blocks_content_json_chk check (jsonb_typeof(content_json) = 'object')
);

create index if not exists idx_teacher_info_blocks_user_position
  on public.teacher_info_blocks(user_id, position, created_at);
create index if not exists idx_teacher_info_blocks_user_active
  on public.teacher_info_blocks(user_id, is_active, position);

drop trigger if exists trg_teacher_info_profiles_set_updated_at on public.teacher_info_profiles;
create trigger trg_teacher_info_profiles_set_updated_at
before update on public.teacher_info_profiles
for each row execute function public.set_updated_at_ts();

drop trigger if exists trg_teacher_info_blocks_set_updated_at on public.teacher_info_blocks;
create trigger trg_teacher_info_blocks_set_updated_at
before update on public.teacher_info_blocks
for each row execute function public.set_updated_at_ts();

alter table public.teacher_info_profiles enable row level security;
alter table public.teacher_info_blocks enable row level security;

drop policy if exists teacher_info_profiles_select_owner on public.teacher_info_profiles;
create policy teacher_info_profiles_select_owner
on public.teacher_info_profiles for select
using (auth.uid() = user_id);

drop policy if exists teacher_info_profiles_insert_owner on public.teacher_info_profiles;
create policy teacher_info_profiles_insert_owner
on public.teacher_info_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_info_profiles_update_owner on public.teacher_info_profiles;
create policy teacher_info_profiles_update_owner
on public.teacher_info_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_info_profiles_delete_owner on public.teacher_info_profiles;
create policy teacher_info_profiles_delete_owner
on public.teacher_info_profiles for delete
using (auth.uid() = user_id);

drop policy if exists teacher_info_blocks_select_owner on public.teacher_info_blocks;
create policy teacher_info_blocks_select_owner
on public.teacher_info_blocks for select
using (auth.uid() = user_id);

drop policy if exists teacher_info_blocks_insert_owner on public.teacher_info_blocks;
create policy teacher_info_blocks_insert_owner
on public.teacher_info_blocks for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_info_blocks_update_owner on public.teacher_info_blocks;
create policy teacher_info_blocks_update_owner
on public.teacher_info_blocks for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_info_blocks_delete_owner on public.teacher_info_blocks;
create policy teacher_info_blocks_delete_owner
on public.teacher_info_blocks for delete
using (auth.uid() = user_id);

create table if not exists public.service_inquiries (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  inquiry_kind text not null,
  requester_type text,
  requester_message text,
  city text,
  requested_dates_text text,
  status text not null default 'pending',
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_inquiries_kind_chk check (inquiry_kind in ('private_class', 'group_class', 'workshop', 'show', 'organizer_collab', 'other')),
  constraint service_inquiries_requester_type_chk check (requester_type is null or requester_type in ('individual', 'organizer')),
  constraint service_inquiries_status_chk check (status in ('pending', 'accepted', 'declined', 'expired')),
  constraint service_inquiries_message_length_chk check (requester_message is null or char_length(requester_message) <= 220),
  constraint service_inquiries_message_trim_chk check (requester_message is null or requester_message = btrim(requester_message)),
  constraint service_inquiries_kind_nonempty_chk check (length(btrim(inquiry_kind)) > 0),
  constraint service_inquiries_distinct_users_chk check (requester_id <> recipient_id)
);

create index if not exists idx_service_inquiries_requester_created
  on public.service_inquiries(requester_id, created_at desc);
create index if not exists idx_service_inquiries_recipient_status_created
  on public.service_inquiries(recipient_id, status, created_at desc);

drop trigger if exists trg_service_inquiries_set_updated_at on public.service_inquiries;
create trigger trg_service_inquiries_set_updated_at
before update on public.service_inquiries
for each row execute function public.set_updated_at_ts();

alter table public.service_inquiries enable row level security;

drop policy if exists service_inquiries_select_requester on public.service_inquiries;
create policy service_inquiries_select_requester
on public.service_inquiries for select
using (auth.uid() = requester_id);

drop policy if exists service_inquiries_select_recipient on public.service_inquiries;
create policy service_inquiries_select_recipient
on public.service_inquiries for select
using (auth.uid() = recipient_id);

drop policy if exists service_inquiries_insert_requester on public.service_inquiries;
create policy service_inquiries_insert_requester
on public.service_inquiries for insert
with check (auth.uid() = requester_id);

drop policy if exists service_inquiries_update_recipient on public.service_inquiries;
create policy service_inquiries_update_recipient
on public.service_inquiries for update
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

create table if not exists public.service_inquiry_threads (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.service_inquiries(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  shared_block_ids jsonb not null default '[]'::jsonb,
  requester_followup_used boolean not null default false,
  teacher_intro_note text,
  created_at timestamptz not null default now(),
  constraint service_inquiry_threads_inquiry_unique unique (inquiry_id),
  constraint service_inquiry_threads_shared_blocks_chk check (jsonb_typeof(shared_block_ids) = 'array'),
  constraint service_inquiry_threads_intro_length_chk check (teacher_intro_note is null or char_length(teacher_intro_note) <= 220),
  constraint service_inquiry_threads_intro_trim_chk check (teacher_intro_note is null or teacher_intro_note = btrim(teacher_intro_note))
);

create index if not exists idx_service_inquiry_threads_thread on public.service_inquiry_threads(thread_id);

alter table public.service_inquiry_threads enable row level security;

drop policy if exists service_inquiry_threads_select_participants on public.service_inquiry_threads;
create policy service_inquiry_threads_select_participants
on public.service_inquiry_threads for select
using (
  exists (
    select 1
    from public.service_inquiries si
    where si.id = service_inquiry_threads.inquiry_id
      and (si.requester_id = auth.uid() or si.recipient_id = auth.uid())
  )
);

alter table public.thread_contexts drop constraint if exists thread_contexts_context_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_context_tag_chk
  check (context_tag in ('connection_request', 'hosting_request', 'trip_join_request', 'event_chat', 'regular_chat', 'activity', 'service_inquiry')) not valid;

alter table public.thread_contexts drop constraint if exists thread_contexts_status_tag_chk;
alter table public.thread_contexts
  add constraint thread_contexts_status_tag_chk
  check (status_tag in ('pending', 'accepted', 'declined', 'cancelled', 'active', 'completed', 'expired', 'info_shared', 'inquiry_followup_pending')) not valid;

create or replace function public.cx_count_user_active_threads(p_user_id uuid)
returns integer
language sql
stable
as $function$
  select count(*)::integer
  from public.thread_participants tp
  where tp.user_id = p_user_id
    and coalesce(tp.messaging_state, 'inactive') = 'active'
    and tp.archived_at is null
    and not exists (
      select 1
      from public.service_inquiry_threads sit
      join public.service_inquiries si on si.id = sit.inquiry_id
      where sit.thread_id = tp.thread_id
        and si.recipient_id = p_user_id
    )
$function$;

grant execute on function public.cx_count_user_active_threads(uuid) to authenticated;

create or replace function public.cx_thread_message_unlocked(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $function$
  with participant as (
    select exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.user_id = p_user_id
    ) as ok
  ),
  service_inquiry_state as (
    select
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
      ) as has_service_inquiry,
      exists (
        select 1
        from public.thread_contexts tc
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'active'
      ) as service_active,
      exists (
        select 1
        from public.thread_contexts tc
        join public.service_inquiry_threads sit
          on sit.thread_id = tc.thread_id
         and tc.source_table = 'service_inquiries'
         and tc.source_id = sit.inquiry_id
        join public.service_inquiries si on si.id = sit.inquiry_id
        where tc.thread_id = p_thread_id
          and tc.context_tag = 'service_inquiry'
          and tc.status_tag = 'info_shared'
          and si.requester_id = p_user_id
          and sit.requester_followup_used = false
      ) as requester_free_followup
  )
  select
    (select ok from participant)
    and case
      when (select has_service_inquiry from service_inquiry_state) then (
        (select service_active from service_inquiry_state)
        or (select requester_free_followup from service_inquiry_state)
      )
      else (
        exists (
          select 1
          from public.thread_contexts tc
          where tc.thread_id = p_thread_id
            and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity', 'service_inquiry')
            and tc.status_tag in ('accepted', 'active', 'completed')
        )
        or exists (
          select 1
          from public.threads t
          join public.connections c on c.id = t.connection_id
          where t.id = p_thread_id
            and (c.requester_id = p_user_id or c.target_id = p_user_id)
            and c.status = 'accepted'
            and c.blocked_by is null
        )
        or exists (
          select 1
          from public.thread_messages tm
          where tm.thread_id = p_thread_id
            and coalesce(tm.message_type, 'text') = 'text'
        )
      )
    end
$function$;

grant execute on function public.cx_thread_message_unlocked(uuid, uuid) to authenticated;

create or replace function public.cx_thread_chat_unlocked(
  p_thread_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_participant boolean := false;
  v_has_blocked_connection boolean := false;
  v_has_accepted_context boolean := false;
  v_has_text_history boolean := false;
  v_has_service_inquiry boolean := false;
  v_service_inquiry_active boolean := false;
  v_requester_free_followup boolean := false;
begin
  if p_thread_id is null or p_user_id is null then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  ) into v_participant;

  if not v_participant then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_contexts tc
    join public.connections c
      on tc.source_table = 'connections'
     and tc.source_id = c.id
    where tc.thread_id = p_thread_id
      and (c.status = 'blocked' or c.blocked_by is not null)
  ) into v_has_blocked_connection;

  if v_has_blocked_connection then
    return false;
  end if;

  select exists (
    select 1
    from public.thread_contexts tc
    where tc.thread_id = p_thread_id
      and tc.context_tag = 'service_inquiry'
  ) into v_has_service_inquiry;

  if v_has_service_inquiry then
    select exists (
      select 1
      from public.thread_contexts tc
      where tc.thread_id = p_thread_id
        and tc.context_tag = 'service_inquiry'
        and tc.status_tag = 'active'
    ) into v_service_inquiry_active;

    if v_service_inquiry_active then
      return true;
    end if;

    select exists (
      select 1
      from public.thread_contexts tc
      join public.service_inquiry_threads sit
        on sit.thread_id = tc.thread_id
       and tc.source_table = 'service_inquiries'
       and tc.source_id = sit.inquiry_id
      join public.service_inquiries si on si.id = sit.inquiry_id
      where tc.thread_id = p_thread_id
        and tc.context_tag = 'service_inquiry'
        and tc.status_tag = 'info_shared'
        and si.requester_id = p_user_id
        and sit.requester_followup_used = false
    ) into v_requester_free_followup;

    return v_requester_free_followup;
  end if;

  select exists (
    select 1
    from public.thread_contexts tc
    where tc.thread_id = p_thread_id
      and tc.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'service_inquiry')
      and tc.status_tag in ('accepted', 'active')
  ) into v_has_accepted_context;

  if v_has_accepted_context then
    return true;
  end if;

  select exists (
    select 1
    from public.thread_messages tm
    where tm.thread_id = p_thread_id
      and coalesce(tm.message_type, 'text') = 'text'
    limit 1
  ) into v_has_text_history;

  return v_has_text_history;
end;
$function$;

grant execute on function public.cx_thread_chat_unlocked(uuid, uuid) to authenticated;

create or replace function public.cx_run_messaging_housekeeping(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_expired_count integer := 0;
  v_archived_count integer := 0;
  v_now timestamptz := now();
  v_row record;
  v_context_row record;
  v_participant_id uuid;
begin
  for v_row in
    update public.service_inquiries si
       set status = 'expired',
           updated_at = v_now
     where si.status = 'pending'
       and coalesce(si.created_at, si.updated_at, v_now) <= v_now - interval '14 days'
       and (
         p_user_id is null
         or si.requester_id = p_user_id
         or si.recipient_id = p_user_id
       )
    returning si.id, si.requester_id, si.recipient_id
  loop
    for v_context_row in
      update public.thread_contexts tc
         set status_tag = 'expired',
             is_pinned = false,
             resolved_at = v_now,
             updated_at = v_now,
             metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_build_object('expired_at', v_now)
       where tc.source_table = 'service_inquiries'
         and tc.source_id = v_row.id
         and tc.status_tag = 'pending'
      returning tc.thread_id, tc.id, tc.context_tag
    loop
      v_expired_count := v_expired_count + 1;

      for v_participant_id in
        select distinct u.participant_id
        from (
          select v_row.requester_id as participant_id
          union all
          select v_row.recipient_id as participant_id
        ) as u
        where u.participant_id is not null
      loop
        perform public.cx_log_thread_status(
          p_thread_id => v_context_row.thread_id,
          p_participant_user_id => v_participant_id,
          p_actor_user_id => null,
          p_context_type => v_context_row.context_tag,
          p_event_type => 'request_expired',
          p_from_status => 'pending',
          p_to_status => 'expired',
          p_metadata => jsonb_build_object('thread_context_id', v_context_row.id)
        );
      end loop;
    end loop;
  end loop;

  for v_row in
    update public.thread_contexts tc
       set status_tag = 'expired',
           is_pinned = false,
           resolved_at = v_now,
           updated_at = v_now,
           metadata = coalesce(tc.metadata, '{}'::jsonb) || jsonb_build_object('expired_at', v_now)
     where tc.status_tag = 'pending'
       and coalesce(tc.source_table, '') <> 'service_inquiries'
       and coalesce(tc.created_at, tc.updated_at, v_now) <= v_now - interval '14 days'
       and (
         p_user_id is null
         or tc.requester_id = p_user_id
         or tc.recipient_id = p_user_id
       )
    returning tc.thread_id, tc.id, tc.context_tag, tc.requester_id, tc.recipient_id
  loop
    v_expired_count := v_expired_count + 1;

    for v_participant_id in
      select distinct u.participant_id
      from (
        select v_row.requester_id as participant_id
        union all
        select v_row.recipient_id as participant_id
      ) as u
      where u.participant_id is not null
    loop
      perform public.cx_log_thread_status(
        p_thread_id => v_row.thread_id,
        p_participant_user_id => v_participant_id,
        p_actor_user_id => null,
        p_context_type => v_row.context_tag,
        p_event_type => 'request_expired',
        p_from_status => 'pending',
        p_to_status => 'expired',
        p_metadata => jsonb_build_object('thread_context_id', v_row.id)
      );
    end loop;
  end loop;

  for v_row in
    update public.thread_participants tp
       set messaging_state = 'archived',
           archived_at = coalesce(tp.archived_at, v_now),
           state_changed_at = v_now
      from public.threads t
     where tp.thread_id = t.id
       and coalesce(tp.messaging_state, 'inactive') = 'active'
       and coalesce(t.last_message_at, t.updated_at, t.created_at, v_now) <= v_now - interval '45 days'
       and (p_user_id is null or tp.user_id = p_user_id)
    returning tp.thread_id, tp.user_id
  loop
    v_archived_count := v_archived_count + 1;
    perform public.cx_log_thread_status(
      p_thread_id => v_row.thread_id,
      p_participant_user_id => v_row.user_id,
      p_actor_user_id => null,
      p_context_type => 'messaging',
      p_event_type => 'auto_archived',
      p_from_status => 'active',
      p_to_status => 'archived',
      p_metadata => jsonb_build_object('reason', '45_days_inactive')
    );
  end loop;

  return jsonb_build_object(
    'expiredPending', v_expired_count,
    'archivedThreads', v_archived_count
  );
end;
$function$;

grant execute on function public.cx_run_messaging_housekeeping(uuid) to authenticated;

create or replace function public.cx_sync_user_messaging_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_cycle public.user_messaging_cycles%rowtype;
  v_active_count integer := 0;
  v_pending_count integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  perform public.cx_run_messaging_housekeeping(v_user);
  v_cycle := public.cx_ensure_user_messaging_cycle(v_user, now());
  v_active_count := public.cx_count_user_active_threads(v_user);

  select count(*)::integer
    into v_pending_count
  from (
    select distinct tc.thread_id
    from public.thread_contexts tc
    where (tc.requester_id = v_user or tc.recipient_id = v_user)
      and tc.status_tag = 'pending'
      and not exists (
        select 1
        from public.thread_contexts tc2
        where tc2.thread_id = tc.thread_id
          and tc2.context_tag in ('connection_request', 'trip_join_request', 'hosting_request', 'event_chat', 'activity', 'service_inquiry')
          and tc2.status_tag in ('accepted', 'active', 'completed')
      )
  ) q;

  return jsonb_build_object(
    'plan', v_cycle.plan,
    'cycleStart', v_cycle.cycle_start,
    'cycleEnd', v_cycle.cycle_end,
    'monthlyLimit', v_cycle.monthly_activation_limit,
    'monthlyUsed', v_cycle.monthly_activations_used,
    'activeLimit', v_cycle.concurrent_active_limit,
    'activeCount', v_active_count,
    'pendingCount', v_pending_count
  );
end;
$function$;

grant execute on function public.cx_sync_user_messaging_state() to authenticated;

create or replace function public.cx_send_service_inquiry_followup(
  p_inquiry_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_clean_body text := regexp_replace(trim(coalesce(p_body, '')), '[\r\n]+', ' ', 'g');
  v_inquiry public.service_inquiries%rowtype;
  v_thread public.service_inquiry_threads%rowtype;
  v_message_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_inquiry_id is null then
    raise exception 'inquiry_required';
  end if;
  if length(v_clean_body) < 1 or length(v_clean_body) > 220 then
    raise exception 'followup_length_invalid';
  end if;

  select *
    into v_inquiry
  from public.service_inquiries
  where id = p_inquiry_id
  limit 1;

  if not found then
    raise exception 'inquiry_not_found';
  end if;
  if v_inquiry.requester_id <> v_user then
    raise exception 'no_permission_for_inquiry';
  end if;
  if coalesce(v_inquiry.status, 'pending') <> 'accepted' then
    raise exception 'inquiry_not_ready_for_followup';
  end if;

  select *
    into v_thread
  from public.service_inquiry_threads
  where inquiry_id = p_inquiry_id
  limit 1;

  if not found then
    raise exception 'inquiry_thread_missing';
  end if;
  if coalesce(v_thread.requester_followup_used, false) then
    raise exception 'followup_already_used';
  end if;
  if not exists (
    select 1
    from public.thread_contexts tc
    where tc.thread_id = v_thread.thread_id
      and tc.source_table = 'service_inquiries'
      and tc.source_id = p_inquiry_id
      and tc.context_tag = 'service_inquiry'
      and tc.status_tag = 'info_shared'
  ) then
    raise exception 'inquiry_not_ready_for_followup';
  end if;

  insert into public.thread_messages (
    thread_id,
    sender_id,
    body,
    message_type,
    context_tag,
    status_tag,
    metadata
  )
  values (
    v_thread.thread_id,
    v_user,
    v_clean_body,
    'text',
    'service_inquiry',
    'inquiry_followup_pending',
    jsonb_build_object(
      'service_inquiry_id', p_inquiry_id,
      'free_followup', true
    )
  )
  returning id into v_message_id;

  update public.service_inquiry_threads
     set requester_followup_used = true,
         shared_block_ids = coalesce(shared_block_ids, '[]'::jsonb)
   where inquiry_id = p_inquiry_id;

  update public.thread_contexts
     set status_tag = 'inquiry_followup_pending',
         is_pinned = false,
         resolved_at = now(),
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'requester_followup_used', true,
           'followup_sent_at', now()
         )
   where source_table = 'service_inquiries'
     and source_id = p_inquiry_id;

  perform public.cx_log_thread_status(
    p_thread_id => v_thread.thread_id,
    p_participant_user_id => v_inquiry.recipient_id,
    p_actor_user_id => v_user,
    p_context_type => 'service_inquiry',
    p_event_type => 'requester_followup_sent',
    p_from_status => 'info_shared',
    p_to_status => 'inquiry_followup_pending',
    p_metadata => jsonb_build_object(
      'inquiry_id', p_inquiry_id,
      'message_id', v_message_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'threadId', v_thread.thread_id,
    'messageId', v_message_id,
    'statusTag', 'inquiry_followup_pending'
  );
end;
$function$;

grant execute on function public.cx_send_service_inquiry_followup(uuid, text) to authenticated;

commit;
