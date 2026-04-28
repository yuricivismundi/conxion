-- Allow public read of teacher_info_blocks and teacher_info_profiles
-- when the teacher's profile is public (mirrors teacher_profiles_select policy).

drop policy if exists teacher_info_blocks_select_public on public.teacher_info_blocks;
create policy teacher_info_blocks_select_public
on public.teacher_info_blocks for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_info_blocks.user_id
      and tp.is_public = true
  )
);

-- Drop the owner-only policy so it doesn't conflict (owner is already covered above).
drop policy if exists teacher_info_blocks_select_owner on public.teacher_info_blocks;

drop policy if exists teacher_info_profiles_select_public on public.teacher_info_profiles;
create policy teacher_info_profiles_select_public
on public.teacher_info_profiles for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_info_profiles.user_id
      and tp.is_public = true
  )
);

drop policy if exists teacher_info_profiles_select_owner on public.teacher_info_profiles;
