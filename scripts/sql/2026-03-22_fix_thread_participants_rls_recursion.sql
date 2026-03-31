begin;

create or replace function public.cx_is_thread_participant(
  p_thread_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
  );
$$;

grant execute on function public.cx_is_thread_participant(uuid, uuid) to authenticated;

drop policy if exists threads_select_participant on public.threads;
create policy threads_select_participant
on public.threads for select
to authenticated
using (public.cx_is_thread_participant(id, auth.uid()));

drop policy if exists thread_participants_select_thread_members on public.thread_participants;
create policy thread_participants_select_thread_members
on public.thread_participants for select
to authenticated
using (
  user_id = auth.uid()
  or public.cx_is_thread_participant(thread_id, auth.uid())
);

drop policy if exists thread_messages_select_participants on public.thread_messages;
create policy thread_messages_select_participants
on public.thread_messages for select
to authenticated
using (public.cx_is_thread_participant(thread_id, auth.uid()));

drop policy if exists thread_messages_insert_sender_participant on public.thread_messages;
create policy thread_messages_insert_sender_participant
on public.thread_messages for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.cx_is_thread_participant(thread_id, auth.uid())
);

drop policy if exists thread_messages_delete_sender on public.thread_messages;
create policy thread_messages_delete_sender
on public.thread_messages for delete
to authenticated
using (
  sender_id = auth.uid()
  and public.cx_is_thread_participant(thread_id, auth.uid())
);

drop policy if exists thread_contexts_select_participants on public.thread_contexts;
create policy thread_contexts_select_participants
on public.thread_contexts for select
to authenticated
using (public.cx_is_thread_participant(thread_id, auth.uid()));

commit;
