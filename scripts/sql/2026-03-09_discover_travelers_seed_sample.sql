-- ConXion Discover Travelers sample seed
-- Date: 2026-03-09
-- Purpose:
--   Ensure Discover -> Travelers has visible cards for testing.
-- Notes:
--   - Safe to run multiple times.
--   - Uses existing profile data and only inserts when a user has no active/upcoming trip.

begin;

do $$
declare
  v_row record;
  v_idx int := 0;
  v_city text;
  v_country text;
  v_purpose text;
begin
  for v_row in
    select p.user_id, p.city, p.country
    from public.profiles p
    where coalesce(p.is_test, false) = false
    order by p.created_at nulls last, p.user_id
    limit 10
  loop
    if not exists (
      select 1
      from public.trips t
      where t.user_id = v_row.user_id
        and coalesce(lower(t.status), 'active') in ('active', 'published', 'open', 'upcoming')
        and coalesce(t.end_date, current_date + 1) >= current_date
    ) then
      v_city := coalesce(nullif(trim(v_row.city), ''), 'Barcelona');
      v_country := coalesce(nullif(trim(v_row.country), ''), 'Spain');
      v_purpose := (
        case (v_idx % 3)
          when 0 then 'Festival / Event'
          when 1 then 'Dance trip / Holiday'
          else 'Training & Classes'
        end
      );

      insert into public.trips (
        user_id,
        destination_city,
        destination_country,
        start_date,
        end_date,
        purpose,
        status
      ) values (
        v_row.user_id,
        v_city,
        v_country,
        current_date + (6 + v_idx),
        current_date + (9 + v_idx),
        v_purpose,
        'active'
      );
    end if;

    v_idx := v_idx + 1;
  end loop;
end $$;

commit;
