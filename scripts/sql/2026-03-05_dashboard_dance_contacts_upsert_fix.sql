-- ConXion Dashboard dance contacts upsert fix
-- Purpose:
--   Ensure ON CONFLICT (user_id, linked_user_id) works for:
--   - public.dance_contacts seed
--   - app upserts from profile/dashboard
--
-- Why:
--   A partial unique index (WHERE linked_user_id is not null) does not match
--   ON CONFLICT (user_id, linked_user_id) inference in Postgres.

do $$
declare
  v_is_partial boolean;
begin
  select i.indpred is not null
  into v_is_partial
  from pg_index i
  join pg_class c
    on c.oid = i.indexrelid
  join pg_namespace n
    on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'ux_dance_contacts_user_linked';

  if coalesce(v_is_partial, false) then
    drop index if exists public.ux_dance_contacts_user_linked;
  end if;
end $$;

create unique index if not exists ux_dance_contacts_user_linked
  on public.dance_contacts(user_id, linked_user_id);

notify pgrst, 'reload schema';

