begin;

alter table public.trips
drop constraint if exists trips_purpose_allowed;

update public.trips
set purpose = case lower(trim(coalesce(purpose, '')))
  when 'holiday trip' then 'Dance trip / Holiday'
  when 'dance festival' then 'Festival / Event'
  when 'social dancing' then 'Dance trip / Holiday'
  when 'training / workshops' then 'Training & Classes'
  when 'training / classes' then 'Training & Classes'
  when 'training and classes' then 'Training & Classes'
  when 'travel & events' then 'Festival / Event'
  when 'travel and events' then 'Festival / Event'
  else purpose
end
where lower(trim(coalesce(purpose, ''))) in (
  'holiday trip',
  'dance festival',
  'social dancing',
  'training / workshops',
  'training / classes',
  'training and classes',
  'travel & events',
  'travel and events'
);

alter table public.trips
add constraint trips_purpose_allowed
check (
  purpose is null
  or purpose in (
    'Dance trip / Holiday',
    'Training & Classes',
    'Festival / Event'
  )
);

commit;
