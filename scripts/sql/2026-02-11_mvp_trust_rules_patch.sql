-- ConXion MVP trust/rules consistency patch
-- Date: 2026-02-11
--
-- Goals:
-- 1) Enforce "messages only after accepted connection"
-- 2) Standardize trips cap to max 5 active trips
-- 3) Standardize connection request limits (20/day, 5/hour, 30-day decline cooldown)
-- 4) Consolidate create_connection_request logic (keep both signatures via wrappers)
-- 5) Add reference lifecycle guardrails (requires completed sync signal when available, immutable after 15 days)
-- 6) Harden SECURITY DEFINER functions with fixed search_path

begin;

-- =========================================================
-- 1) SECURITY DEFINER hardening + send_message gate fix
-- =========================================================

create or replace function public.send_message(p_connection_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_conn record;
  v_count_min int;
  v_count_day int;
  v_clean_body text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_clean_body := trim(coalesce(p_body, ''));
  if length(v_clean_body) < 1 or length(v_clean_body) > 1000 then
    raise exception 'Message length invalid';
  end if;

  -- no links, emails, phone numbers, or handles
  if v_clean_body ~* '(https?://|www\.)' then raise exception 'Links not allowed'; end if;
  if v_clean_body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then raise exception 'Emails not allowed'; end if;
  if v_clean_body ~* '[@#][A-Za-z0-9_]+' then raise exception 'Handles not allowed'; end if;
  if v_clean_body ~* '(\+?\d[\d\s().-]{7,}\d)' then raise exception 'Phone numbers not allowed'; end if;

  -- Critical MVP gate: accepted + unblocked only
  select *
  into v_conn
  from public.connections
  where id = p_connection_id
    and (requester_id = auth.uid() or target_id = auth.uid())
    and status = 'accepted'
    and blocked_by is null
  limit 1;

  if v_conn is null then
    raise exception 'No permission for this connection';
  end if;

  -- 20 messages/min/thread
  select count(*) into v_count_min
  from public.messages
  where connection_id = p_connection_id
    and created_at >= now() - interval '1 minute';

  if v_count_min >= 20 then
    raise exception 'Rate limit: 20 per minute';
  end if;

  -- 100 messages/day/user
  select count(*) into v_count_day
  from public.messages
  where sender_id = auth.uid()
    and created_at >= now() - interval '1 day';

  if v_count_day >= 100 then
    raise exception 'Daily limit reached';
  end if;

  insert into public.messages (connection_id, sender_id, body)
  values (p_connection_id, auth.uid(), v_clean_body);
end;
$function$;

-- =========================================================
-- 2) Trips: unify to max 5 active
-- =========================================================

create or replace function public.enforce_max_5_active_trips()
returns trigger
language plpgsql
as $function$
declare
  active_count int;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  -- Active = trip end_date has not passed.
  select count(*)
    into active_count
  from public.trips t
  where t.user_id = new.user_id
    and t.end_date >= current_date
    and (tg_op <> 'UPDATE' or t.id <> new.id);

  if active_count >= 5 then
    raise exception 'Max 5 active trips allowed per user';
  end if;

  return new;
end;
$function$;

-- Remove old conflicting 4-trip trigger bindings if present.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and n.nspname = 'public'
      and p.proname in ('enforce_max_4_active_trips', 'enforce_max_4_total_trips')
  loop
    execute format('drop trigger if exists %I on %I.%I', r.trigger_name, r.schema_name, r.table_name);
  end loop;
end $$;

drop trigger if exists trg_trips_enforce_max_5_active on public.trips;
create trigger trg_trips_enforce_max_5_active
before insert or update on public.trips
for each row execute function public.enforce_max_5_active_trips();

create or replace function public.create_trip_checked(
  p_destination_city text,
  p_destination_country text,
  p_start_date date,
  p_end_date date,
  p_purpose text,
  p_styles text[],
  p_looking_for text[],
  p_note text
)
returns trips
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_active_count int;
  v_row public.trips;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_active_count
  from public.trips t
  where t.user_id = v_user
    and t.end_date >= current_date;

  if v_active_count >= 5 then
    raise exception 'You can only have up to 5 active trips.';
  end if;

  insert into public.trips (
    user_id, destination_city, destination_country,
    start_date, end_date, purpose, styles, looking_for, note, status
  )
  values (
    v_user, p_destination_city, p_destination_country,
    p_start_date, p_end_date, p_purpose, coalesce(p_styles,'{}'),
    coalesce(p_looking_for,'{}'), nullif(trim(p_note),''), 'published'
  )
  returning * into v_row;

  return v_row;
end;
$function$;

-- =========================================================
-- 3) Connections: unify request limits
-- =========================================================

create or replace function public.enforce_connection_request_limits()
returns trigger
language plpgsql
as $function$
declare
  v_day_count int;
  v_hour_count int;
  v_recent_declined int;
  v_existing_active int;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if current_setting('app.seed_mode', true) = 'on' then
    return new;
  end if;

  if new.status is distinct from 'pending' then
    return new;
  end if;

  if new.requester_id is null or new.target_id is null then
    raise exception 'requester_id/target_id required';
  end if;

  if new.requester_id = new.target_id then
    raise exception 'cannot_request_self';
  end if;

  -- Existing pending/accepted in either direction is not allowed.
  select count(*) into v_existing_active
  from public.connections c
  where ((c.requester_id = new.requester_id and c.target_id = new.target_id)
      or (c.requester_id = new.target_id and c.target_id = new.requester_id))
    and c.status in ('pending', 'accepted');

  if v_existing_active > 0 then
    raise exception 'already_pending_or_connected';
  end if;

  -- 20/day + 5/hour
  select count(*) into v_day_count
  from public.connections c
  where c.requester_id = new.requester_id
    and c.created_at >= now() - interval '24 hours';

  if v_day_count >= 20 then
    raise exception 'rate_limit_daily';
  end if;

  select count(*) into v_hour_count
  from public.connections c
  where c.requester_id = new.requester_id
    and c.created_at >= now() - interval '1 hour';

  if v_hour_count >= 5 then
    raise exception 'rate_limit_hourly';
  end if;

  -- 30-day cooldown after decline (same requester -> same target)
  select count(*) into v_recent_declined
  from public.connections c
  where c.requester_id = new.requester_id
    and c.target_id = new.target_id
    and c.status = 'declined'
    and c.created_at >= now() - interval '30 days';

  if v_recent_declined > 0 then
    raise exception 're_request_not_allowed_30_days';
  end if;

  return new;
end;
$function$;

-- Remove old conflicting request-limit trigger bindings.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and n.nspname = 'public'
      and p.proname in ('enforce_max_5_connections_per_day')
  loop
    execute format('drop trigger if exists %I on %I.%I', r.trigger_name, r.schema_name, r.table_name);
  end loop;
end $$;

drop trigger if exists trg_connections_enforce_limits on public.connections;
create trigger trg_connections_enforce_limits
before insert on public.connections
for each row execute function public.enforce_connection_request_limits();

-- =========================================================
-- 4) Consolidate create_connection_request logic
-- =========================================================

create or replace function public.create_connection_request_v2(
  p_target_id uuid,
  p_context text,
  p_connect_reason text,
  p_connect_reason_role text,
  p_trip_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_existing uuid;
  v_new_id uuid;
  v_blocked bool := false;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_target_id is null then
    raise exception 'missing_target_id';
  end if;

  if p_target_id = v_me then
    raise exception 'cannot_request_self';
  end if;

  if p_connect_reason is null or trim(p_connect_reason) = '' then
    raise exception 'reason_required';
  end if;

  -- Prefer user_blocks if available.
  if to_regclass('public.user_blocks') is not null then
    execute $sql$
      select exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = $1 and b.blocked_user_id = $2)
           or (b.blocker_id = $2 and b.blocked_user_id = $1)
      )
    $sql$
    into v_blocked
    using v_me, p_target_id;
  else
    -- Fallback to connections block state.
    select exists (
      select 1 from public.connections c
      where ((c.requester_id = v_me and c.target_id = p_target_id)
          or (c.requester_id = p_target_id and c.target_id = v_me))
        and (c.status = 'blocked' or c.blocked_by is not null)
    ) into v_blocked;
  end if;

  if v_blocked then
    raise exception 'blocked';
  end if;

  -- already pending/accepted either direction (fixed precedence)
  select c.id
    into v_existing
  from public.connections c
  where ((c.requester_id = v_me and c.target_id = p_target_id)
      or (c.requester_id = p_target_id and c.target_id = v_me))
    and c.status in ('pending', 'accepted')
  limit 1;

  if v_existing is not null then
    raise exception 'already_pending_or_connected';
  end if;

  insert into public.connections(
    requester_id, target_id, status,
    connect_context, connect_reason, connect_reason_role,
    trip_id, connect_note
  )
  values (
    v_me, p_target_id, 'pending',
    p_context, p_connect_reason, p_connect_reason_role,
    p_trip_id, p_note
  )
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

-- Keep existing app compatibility by preserving both signatures as wrappers.
create or replace function public.create_connection_request(
  p_target_id uuid,
  p_context text,
  p_connect_reason text,
  p_connect_reason_role text,
  p_trip_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
begin
  return public.create_connection_request_v2(
    p_target_id,
    p_context,
    p_connect_reason,
    p_connect_reason_role,
    p_trip_id,
    p_note
  );
end;
$function$;

create or replace function public.create_connection_request(
  p_target_id uuid,
  p_connect_context text,
  p_connect_reason uuid,
  p_connect_reason_role text,
  p_trip_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
begin
  return public.create_connection_request_v2(
    p_target_id,
    p_connect_context,
    p_connect_reason::text,
    p_connect_reason_role,
    p_trip_id,
    null
  );
end;
$function$;

-- =========================================================
-- 5) References lifecycle guardrails
-- =========================================================

create or replace function public.references_guardrails()
returns trigger
language plpgsql
as $function$
declare
  v_ref_created_at timestamptz;
  v_connection_id uuid;
  v_has_syncs bool;
  v_sync_ok bool;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_ref_created_at := nullif(coalesce(to_jsonb(old)->>'created_at', ''), '')::timestamptz;
    if v_ref_created_at is not null and v_ref_created_at < now() - interval '15 days' then
      raise exception 'references_immutable_after_15_days';
    end if;
    return coalesce(new, old);
  end if;

  -- INSERT checks
  if tg_op = 'INSERT' then
    v_connection_id := nullif(coalesce(to_jsonb(new)->>'connection_id', ''), '')::uuid;
    if v_connection_id is null then
      raise exception 'reference_connection_required';
    end if;

    v_has_syncs := to_regclass('public.syncs') is not null;
    v_sync_ok := false;

    if v_has_syncs then
      begin
        -- Accept either explicit completion timestamp or completed status.
        execute $sql$
          select exists (
            select 1
            from public.syncs s
            where s.connection_id = $1
              and (
                (to_jsonb(s)->>'completed_at') is not null
                or coalesce(to_jsonb(s)->>'status', '') = 'completed'
              )
          )
        $sql$
        into v_sync_ok
        using v_connection_id;
      exception
        when undefined_column then
          v_sync_ok := false;
      end;
    end if;

    -- Fallback: at minimum require accepted/unblocked connection.
    if not v_sync_ok then
      select exists (
        select 1
        from public.connections c
        where c.id = v_connection_id
          and c.status = 'accepted'
          and c.blocked_by is null
      ) into v_sync_ok;
    end if;

    if not v_sync_ok then
      raise exception 'references_require_completed_sync';
    end if;
  end if;

  return new;
end;
$function$;

do $$
begin
  if to_regclass('public.references') is not null then
    execute 'drop trigger if exists trg_references_guardrails on public.references';
    execute 'create trigger trg_references_guardrails before insert or update or delete on public.references for each row execute function public.references_guardrails()';
  else
    raise notice 'public.references table not found; references trigger skipped';
  end if;
end $$;

-- =========================================================
-- 6) SECURITY DEFINER hardening for existing RPCs
-- =========================================================

create or replace function public.accept_connection_request(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update public.connections c
  set status = 'accepted'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$function$;

create or replace function public.decline_connection_request(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update public.connections c
  set status = 'declined'
  where c.id = p_connection_id
    and c.target_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$function$;

create or replace function public.cancel_connection_request(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  delete from public.connections c
  where c.id = p_connection_id
    and c.requester_id = v_me
    and c.status = 'pending';

  if not found then
    raise exception 'not_found_or_not_allowed';
  end if;
end;
$function$;

grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.create_trip_checked(text, text, date, date, text, text[], text[], text) to authenticated;
grant execute on function public.create_connection_request_v2(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.create_connection_request(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.create_connection_request(uuid, text, uuid, text, uuid) to authenticated;
grant execute on function public.accept_connection_request(uuid) to authenticated;
grant execute on function public.decline_connection_request(uuid) to authenticated;
grant execute on function public.cancel_connection_request(uuid) to authenticated;

commit;

