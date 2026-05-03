begin;

create or replace function public.private_group_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$function$;

create or replace function public.private_group_monthly_usage_count(
  p_user_id uuid,
  p_anchor timestamptz default now()
)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select count(distinct e.id)::integer
  from public.events e
  join public.event_members em on em.event_id = e.id
  where em.user_id = p_user_id
    and em.status in ('host', 'going', 'waitlist')
    and e.event_access_type = 'private_group'
    and e.status = 'published'
    and coalesce(e.hidden_by_admin, false) = false;
$function$;

create or replace function public.group_slot_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 500;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 25;
  end if;

  return 5;
end;
$function$;

create or replace function public.active_group_slot_usage_count(
  p_user_id uuid,
  p_exclude_group_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  with active_groups as (
    select g.id
    from public.groups g
    where g.status = 'active'
      and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
      and (
        g.host_user_id = p_user_id
        or exists (
          select 1
          from public.group_members gm
          where gm.group_id = g.id
            and gm.user_id = p_user_id
        )
      )
  )
  select count(distinct id)::integer
  from active_groups;
$function$;

create or replace function public.cx_check_group_slot_allowed(
  p_user_id uuid,
  p_exclude_group_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
  v_limit integer := 0;
begin
  if p_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select public.active_group_slot_usage_count(p_user_id, p_exclude_group_id) into v_count;
  select public.group_slot_limit_for_user(p_user_id) into v_limit;

  if v_limit is not null and v_count >= v_limit then
    raise exception 'group_slot_limit_reached';
  end if;

  return true;
end;
$function$;

create or replace function public.cx_check_group_create_allowed(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  return public.cx_check_group_slot_allowed(p_user_id, null);
end;
$function$;

commit;
