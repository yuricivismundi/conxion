select
  count(*) filter (where coalesce(is_test, false) = true) as test_profiles,
  count(*) filter (
    where coalesce(is_test, false) = true
      and coalesce(can_host, false) = true
      and lower(coalesce(hosting_status, 'inactive')) in ('available', 'active', 'open', 'on')
  ) as test_hosts_enabled,
  count(*) filter (where coalesce(is_test, false) = false) as real_profiles
from public.profiles;

select
  p.user_id,
  p.display_name,
  p.city,
  p.country,
  p.is_test,
  p.can_host,
  p.hosting_status,
  u.email,
  u.created_at
from public.profiles p
left join auth.users u on u.id = p.user_id
where coalesce(p.is_test, false) = true
order by p.created_at nulls last, p.user_id
limit 20;
