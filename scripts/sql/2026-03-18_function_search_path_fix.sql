-- ConXion function search_path hardening
-- Date: 2026-03-18
--
-- Fixes Supabase lint warnings for helper functions created without an
-- explicit search_path.

begin;

do $$
begin
  if to_regprocedure('public.set_updated_at_ts()') is not null then
    execute 'alter function public.set_updated_at_ts() set search_path = public';
  end if;

  if to_regprocedure('public.set_event_feedback_updated_at()') is not null then
    execute 'alter function public.set_event_feedback_updated_at() set search_path = public';
  end if;

  if to_regprocedure('public.enforce_dance_contacts_limit()') is not null then
    execute 'alter function public.enforce_dance_contacts_limit() set search_path = public';
  end if;

  if to_regprocedure('public.update_thread_last_message_at()') is not null then
    execute 'alter function public.update_thread_last_message_at() set search_path = public';
  end if;
end $$;

commit;
