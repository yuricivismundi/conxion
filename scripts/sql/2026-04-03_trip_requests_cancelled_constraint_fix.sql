begin;

alter table if exists public.trip_requests
  drop constraint if exists trip_requests_status_allowed;

alter table if exists public.trip_requests
  drop constraint if exists trip_requests_status_chk;

alter table if exists public.trip_requests
  add constraint trip_requests_status_allowed
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

commit;
