-- ConXion References RLS Unified Fix
-- Date: 2026-03-18
-- Purpose:
--   Ensure references rows remain visible and insertable when using
--   canonical fields from_user_id/to_user_id (while keeping legacy compatibility).

begin;

-- Keep legacy aliases populated for compatibility with existing UI/API paths.
update public.references
set author_id = coalesce(author_id, from_user_id)
where author_id is null
  and from_user_id is not null;

update public.references
set recipient_id = coalesce(recipient_id, to_user_id)
where recipient_id is null
  and to_user_id is not null;

alter table public.references enable row level security;

drop policy if exists references_select_participants on public.references;
create policy references_select_participants
on public.references for select
to authenticated
using (
  true
);

drop policy if exists references_insert_author on public.references;
create policy references_insert_author
on public.references for insert
to authenticated
with check (
  coalesce(author_id, from_user_id) = auth.uid()
  and coalesce(recipient_id, to_user_id) is not null
);

commit;
