-- Limit new dashboard competition entries to 4 per user per calendar month.
-- Updates remain allowed so members can edit existing results.

create or replace function public.cx_enforce_competitions_monthly_limit()
returns trigger
language plpgsql
as $$
declare
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_count integer;
begin
  v_month_start := date_trunc('month', coalesce(new.created_at, now()));
  v_month_end := v_month_start + interval '1 month';

  select count(*)
    into v_count
  from public.dance_competitions_user
  where user_id = new.user_id
    and created_at >= v_month_start
    and created_at < v_month_end;

  if v_count >= 4 then
    raise exception 'competition_monthly_limit_reached'
      using errcode = 'P0001',
            detail = 'Members can add up to 4 competition results per calendar month.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dance_competitions_user_monthly_limit on public.dance_competitions_user;

create trigger trg_dance_competitions_user_monthly_limit
before insert on public.dance_competitions_user
for each row
execute function public.cx_enforce_competitions_monthly_limit();
