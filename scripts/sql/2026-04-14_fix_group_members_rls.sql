-- Fix infinite recursion in group_members RLS by using a security definer helper

begin;

-- Helper that checks membership without triggering RLS on group_members
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

-- Fix select policy: no self-referential query
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select
  using (
    public.is_group_member(group_id, auth.uid())
    or exists (
      select 1 from public.groups g
      where g.id = group_id and g.host_user_id = auth.uid()
    )
  );

-- Fix insert policy similarly
drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert
  with check (
    exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
    or user_id = auth.uid()
  );

-- Fix delete policy
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
  );

commit;
