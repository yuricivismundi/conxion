-- Group message rate limits and plan-based group caps
-- Rules:
--   Starter: max 3 groups owned, 50 msgs/day per user per group, 200 msgs/day per group
--   Plus:    max 10 groups owned, 100 msgs/day per user per group, 500 msgs/day per group

begin;

-- ── 1. Rate-limit helper: messages sent by a user in a group thread today ────
create or replace function public.cx_group_user_messages_today(
  p_group_id uuid,
  p_user_id  uuid
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.sender_id = p_user_id
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;

-- ── 2. Rate-limit helper: total messages in a group thread today ─────────────
create or replace function public.cx_group_messages_today(p_group_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*)::int, 0)
  from public.thread_messages tm
  join public.threads t on t.id = tm.thread_id
  where t.group_id = p_group_id
    and t.thread_type = 'group'
    and tm.created_at >= date_trunc('day', now() at time zone 'utc');
$$;

-- ── 3. Gate function called before inserting a group message ─────────────────
-- Returns true if the send is allowed, raises an exception otherwise.
create or replace function public.cx_check_group_message_allowed(
  p_group_id uuid,
  p_user_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan            text;
  v_is_owner        boolean;
  v_user_daily_max  int;
  v_group_daily_max int;
  v_chat_mode       text;
begin
  -- Resolve sender plan
  select coalesce(plan, 'starter') into v_plan
  from public.profiles
  where user_id = p_user_id;

  -- Check chat mode — broadcast: only owner may send
  select chat_mode, (host_user_id = p_user_id) into v_chat_mode, v_is_owner
  from public.groups
  where id = p_group_id;

  if v_chat_mode = 'broadcast' and not v_is_owner then
    raise exception 'broadcast_only_owner';
  end if;

  -- Set limits per plan
  if v_plan = 'pro' then
    v_user_daily_max  := 100;
    v_group_daily_max := 500;
  else
    v_user_daily_max  := 50;
    v_group_daily_max := 200;
  end if;

  -- Check per-user daily limit
  if public.cx_group_user_messages_today(p_group_id, p_user_id) >= v_user_daily_max then
    raise exception 'group_user_daily_limit_reached';
  end if;

  -- Check per-group daily limit
  if public.cx_group_messages_today(p_group_id) >= v_group_daily_max then
    raise exception 'group_daily_limit_reached';
  end if;

  return true;
end;
$$;

grant execute on function public.cx_check_group_message_allowed(uuid, uuid) to authenticated;
grant execute on function public.cx_group_user_messages_today(uuid, uuid) to authenticated;
grant execute on function public.cx_group_messages_today(uuid) to authenticated;

-- ── 4. Plan-based group ownership cap ────────────────────────────────────────
-- Returns true if user can create another group, raises exception otherwise.
create or replace function public.cx_check_group_create_allowed(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan      text;
  v_max       int;
  v_current   int;
begin
  select coalesce(plan, 'starter') into v_plan
  from public.profiles
  where user_id = p_user_id;

  v_max := case when v_plan = 'pro' then 10 else 3 end;

  select count(*) into v_current
  from public.groups
  where host_user_id = p_user_id;

  if v_current >= v_max then
    raise exception 'group_limit_reached';
  end if;

  return true;
end;
$$;

grant execute on function public.cx_check_group_create_allowed(uuid) to authenticated;

commit;
