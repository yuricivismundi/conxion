-- Normalise all existing event_type values to the canonical set,
-- then add a CHECK constraint to enforce them going forward.

-- 1. Map legacy/variant values to canonical ones
update public.events
set event_type = case
  when lower(trim(event_type)) in ('congress', 'marathon', 'party', 'festival') then 'Festival'
  when lower(trim(event_type)) in ('workshop', 'class', 'training')             then 'Workshop'
  when lower(trim(event_type)) in ('masterclass')                               then 'Masterclass'
  when lower(trim(event_type)) in ('competition', 'contest')                    then 'Competition'
  else 'Social'
end
where lower(trim(event_type)) not in ('social', 'workshop', 'festival', 'masterclass', 'competition');

-- 2. Add CHECK constraint
alter table public.events
  add constraint events_event_type_check
  check (event_type in ('Social', 'Workshop', 'Festival', 'Masterclass', 'Competition'));

-- 3. Update create_event default
-- (the function already defaults to 'Social' via coalesce — no change needed)
