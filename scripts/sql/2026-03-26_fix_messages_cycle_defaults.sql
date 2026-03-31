begin;

create or replace function public.cx_ensure_user_messaging_cycle(p_user_id uuid, p_at timestamptz default now())
returns public.user_messaging_cycles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_plan text := 'free';
  v_monthly_limit integer := 10;
  v_concurrent_limit integer := 10;
  v_row public.user_messaging_cycles%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  select cycle_start, cycle_end
    into v_cycle_start, v_cycle_end
  from public.cx_messaging_cycle_bounds(p_at);

  select
    coalesce(plan, 'free'),
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(monthly_activation_limit, 1000000)
      else coalesce(monthly_activation_limit, 10)
    end,
    case
      when coalesce(plan, 'free') = 'premium' then coalesce(concurrent_active_limit, 1000000)
      else coalesce(concurrent_active_limit, 10)
    end
  into v_plan, v_monthly_limit, v_concurrent_limit
  from public.user_messaging_plans
  where user_id = p_user_id
  limit 1;

  v_plan := coalesce(v_plan, 'free');
  v_monthly_limit := coalesce(v_monthly_limit, case when v_plan = 'premium' then 1000000 else 10 end);
  v_concurrent_limit := coalesce(v_concurrent_limit, case when v_plan = 'premium' then 1000000 else 10 end);

  insert into public.user_messaging_cycles (
    user_id,
    cycle_start,
    cycle_end,
    plan,
    monthly_activation_limit,
    concurrent_active_limit
  )
  values (
    p_user_id,
    v_cycle_start,
    v_cycle_end,
    v_plan,
    v_monthly_limit,
    v_concurrent_limit
  )
  on conflict (user_id, cycle_start)
  do update set
    cycle_end = excluded.cycle_end,
    plan = excluded.plan,
    monthly_activation_limit = excluded.monthly_activation_limit,
    concurrent_active_limit = excluded.concurrent_active_limit,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

commit;
