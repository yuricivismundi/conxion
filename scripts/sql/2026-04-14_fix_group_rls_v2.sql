-- Fix RLS recursion cycle:
-- group_members policy → groups → groups policy → group_members → loop
-- Solution: use security definer helper everywhere to break the cycle

begin;

-- Security definer helper bypasses RLS when checking membership
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

-- Fix groups SELECT: use helper instead of direct subquery on group_members
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select
  using (
    host_user_id = auth.uid()
    or public.is_group_member(id, auth.uid())
  );

-- Fix group_members SELECT: only use helper (no reference to groups table)
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select
  using (
    public.is_group_member(group_id, auth.uid())
  );

-- Fix insert: use helper for host check
drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
  );

-- Fix delete
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.host_user_id = auth.uid())
  );

commit;
