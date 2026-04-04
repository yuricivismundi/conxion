begin;

create or replace function public.active_event_limit_for_user(p_user_id uuid)
returns integer
language plpgsql
stable
set search_path = public
as $function$
declare
  v_pro_status text := null;
begin
  if public.is_app_admin(p_user_id) then
    return 100;
  end if;

  select lower(trim(coalesce(u.raw_user_meta_data ->> 'billing_pro_status', '')))
    into v_pro_status
  from auth.users u
  where u.id = p_user_id
  limit 1;

  if coalesce(v_pro_status, '') in ('trialing', 'active', 'past_due') then
    return 5;
  end if;

  return 2;
end;
$function$;

commit;
