create or replace function public.cx_profile_request_response_stats(p_profile_user_id uuid)
returns table (
  total_requests bigint,
  responded_requests bigint,
  pending_requests bigint,
  response_rate integer
)
language sql
stable
security definer
set search_path = public
as $$
  with stats as (
    select
      count(*) filter (where c.status in ('pending', 'accepted', 'declined')) as total_requests,
      count(*) filter (where c.status in ('accepted', 'declined')) as responded_requests,
      count(*) filter (where c.status = 'pending') as pending_requests
    from public.connections c
    where c.target_id = p_profile_user_id
      and c.blocked_by is null
      and c.status in ('pending', 'accepted', 'declined')
  )
  select
    stats.total_requests,
    stats.responded_requests,
    stats.pending_requests,
    case
      when stats.total_requests > 0
        then round((stats.responded_requests::numeric / stats.total_requests::numeric) * 100)::integer
      else 0
    end as response_rate
  from stats;
$$;

grant execute on function public.cx_profile_request_response_stats(uuid) to authenticated;

comment on function public.cx_profile_request_response_stats(uuid)
is 'Returns response-rate aggregates for incoming profile connection requests. Pending requests count in the denominator, accepted and declined count as responded, and cancelled or deleted requests are excluded.';
