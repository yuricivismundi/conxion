-- ConXion Dashboard competition outcomes refresh
-- Date: 2026-03-03
-- Purpose:
--   1) Support new outcomes: Quarterfinalist, Semifinalist, Finalist.
--   2) Migrate legacy values: Top 5 / Podium.
--   3) Keep winner count as explicit Winner entries only.

begin;

do $$
begin
  if to_regclass('public.dance_competitions_user') is null then
    raise exception 'Missing table public.dance_competitions_user. Run scripts/sql/2026-03-02_dashboard_competitions.sql first.';
  end if;
end $$;

alter table public.dance_competitions_user
  drop constraint if exists dance_competitions_result_allowed_chk;

-- Some environments may have older differently named check constraints on result.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.dance_competitions_user'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%result%'
  loop
    execute format('alter table public.dance_competitions_user drop constraint if exists %I', c.conname);
  end loop;
end $$;

update public.dance_competitions_user
set result = case
  when lower(trim(result)) in ('top 5', 'quarter of finals', 'quarter of finals', 'quarterfinal', 'quarterfinals', 'quarter finalist', 'quarter-finalist', 'quarterfinalist')
    then 'Quarterfinalist'
  when lower(trim(result)) in ('semifinal', 'semi final', 'semi finalist', 'semi-finalist', 'semifinalist')
    then 'Semifinalist'
  when lower(trim(result)) in ('podium', 'final', 'finalist')
    then 'Finalist'
  when lower(trim(result)) in ('winner', '1st', 'first place')
    then 'Winner'
  when lower(trim(result)) in ('participated', 'participant')
    then 'Participated'
  else result
end;

-- Ensure add-constraint never fails because of unexpected legacy labels.
update public.dance_competitions_user
set result = 'Participated'
where result not in ('Participated', 'Quarterfinalist', 'Semifinalist', 'Finalist', 'Winner')
   or result is null;

alter table public.dance_competitions_user
  add constraint dance_competitions_result_allowed_chk
  check (result in ('Participated', 'Quarterfinalist', 'Semifinalist', 'Finalist', 'Winner'));

commit;

notify pgrst, 'reload schema';
