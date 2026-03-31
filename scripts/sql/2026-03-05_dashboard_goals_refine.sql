-- ConXion Dashboard goals refinement (MVP discipline)
-- Date: 2026-03-05
-- Safe to run multiple times.

begin;

alter table public.dance_goals_user
  add column if not exists category text;

-- Normalize existing data before tightening constraints.
update public.dance_goals_user
set title = left(trim(title), 120)
where title is not null and (title <> trim(title) or char_length(title) > 120);

update public.dance_goals_user
set note = left(note, 200)
where note is not null and char_length(note) > 200;

update public.dance_goals_user
set target_date = current_date + 14
where target_date is null;

update public.dance_goals_user
set target_date = current_date + 90
where status = 'active' and target_date > current_date + 90;

alter table public.dance_goals_user
  alter column target_date set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_title_len_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_title_len_chk
      check (char_length(title) <= 120);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_note_len_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_note_len_chk
      check (note is null or char_length(note) <= 200);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_category_allowed_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_category_allowed_chk
      check (category is null or category in ('practice', 'learning', 'social', 'competition', 'event'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_goals_target_within_90_days_chk'
      and conrelid = 'public.dance_goals_user'::regclass
  ) then
    alter table public.dance_goals_user
      add constraint dance_goals_target_within_90_days_chk
      check (target_date <= current_date + 90);
  end if;
end $$;

create or replace function public.enforce_dance_goals_active_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_count integer;
begin
  if new.status = 'active' then
    select count(*)
      into v_active_count
    from public.dance_goals_user g
    where g.user_id = new.user_id
      and g.status = 'active'
      and g.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_active_count >= 3 then
      raise exception 'Maximum 3 active goals allowed per user.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dance_goals_user_active_limit on public.dance_goals_user;
create trigger trg_dance_goals_user_active_limit
before insert or update of status, user_id
on public.dance_goals_user
for each row
execute function public.enforce_dance_goals_active_limit();

create index if not exists idx_dance_goals_user_status_updated_at
  on public.dance_goals_user(user_id, status, updated_at desc);

commit;

notify pgrst, 'reload schema';
