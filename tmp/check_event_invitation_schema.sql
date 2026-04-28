select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'event_invitations'
order by ordinal_position;

select pg_get_function_identity_arguments(p.oid) as identity_args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'update_event'
order by 1;

select
  count(*) as total_rows,
  count(*) filter (where sender_id is null) as sender_nulls,
  count(*) filter (where recipient_id is null) as recipient_nulls
from public.event_invitations;

select event_id, recipient_id, count(*) as duplicate_count
from public.event_invitations
group by event_id, recipient_id
having count(*) > 1
order by duplicate_count desc
limit 10;
