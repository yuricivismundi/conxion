-- Seed trips for Spain, Mexico, Italy
-- Safe to run multiple times.

begin;

do $$
declare
  v_cities   text[] := array['Madrid','Barcelona','Mexico City','Guadalajara','Rome','Milan'];
  v_countries text[] := array['Spain','Spain','Mexico','Mexico','Italy','Italy'];
  v_purposes text[] := array['Festival / Event','Dance trip / Holiday','Training & Classes'];
  v_profiles record;
  v_idx int := 0;
  v_dest_idx int;
  v_city text;
  v_country text;
begin
  for v_profiles in
    select p.user_id
    from public.profiles p
    where coalesce(p.is_test, false) = false
    order by p.created_at nulls last, p.user_id
    limit 12
  loop
    v_dest_idx := (v_idx % array_length(v_cities, 1)) + 1;
    v_city    := v_cities[v_dest_idx];
    v_country := v_countries[v_dest_idx];

    if not exists (
      select 1 from public.trips t
      where t.user_id = v_profiles.user_id
        and lower(t.destination_country) = lower(v_country)
        and coalesce(lower(t.status), 'active') in ('active','published','open','upcoming')
        and coalesce(t.end_date, current_date + 1) >= current_date
    ) then
      insert into public.trips (user_id, destination_city, destination_country, start_date, end_date, purpose, status)
      values (
        v_profiles.user_id,
        v_city,
        v_country,
        current_date + (7 + (v_idx * 3)),
        current_date + (10 + (v_idx * 3)),
        v_purposes[(v_idx % array_length(v_purposes, 1)) + 1],
        'active'
      );
    end if;

    v_idx := v_idx + 1;
  end loop;
end $$;

commit;
