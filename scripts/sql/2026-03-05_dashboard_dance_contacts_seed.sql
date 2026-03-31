-- ConXion Dashboard Dance Contacts sample seed
-- Date: 2026-03-05
-- Usage:
--   1) Run scripts/sql/2026-03-05_dashboard_dance_contacts.sql first.
--   2) If you see ON CONFLICT index errors, run:
--      scripts/sql/2026-03-05_dashboard_dance_contacts_upsert_fix.sql
--   3) Optional: set v_email to a specific existing auth user email.
--   4) Run in Supabase SQL editor.

begin;

do $$
declare
  v_email text := '';
  v_me uuid;
  v_member uuid;
  v_count integer := 0;
begin
  if to_regclass('public.dance_contacts') is null then
    raise exception 'Missing table public.dance_contacts. Run scripts/sql/2026-03-05_dashboard_dance_contacts.sql first.';
  end if;

  if length(trim(v_email)) > 0 then
    select u.id
    into v_me
    from auth.users u
    where lower(u.email) = lower(v_email)
    order by u.created_at asc
    limit 1;
  else
    select u.id
    into v_me
    from auth.users u
    where u.email is not null
      and lower(u.email) not like '%@local.test'
    order by u.created_at asc
    limit 1;
  end if;

  if v_me is null then
    raise exception 'No auth user found. Create at least one real user first, or set v_email.';
  end if;

  delete from public.dance_contacts
  where user_id = v_me
    and notes ilike '%[seed-dashboard-contact]%';

  insert into public.dance_contacts (
    user_id,
    contact_type,
    linked_user_id,
    name,
    role,
    city,
    country,
    instagram,
    whatsapp,
    email,
    tags,
    notes
  )
  values
    (
      v_me,
      'external',
      null,
      'Marta Ruiz',
      array['Organizer', 'Dancer']::text[],
      'Madrid',
      'Spain',
      '@bachata_marta',
      null,
      null,
      array['festival buddy', 'organizer']::text[],
      'Runs Thursday socials in Madrid. [seed-dashboard-contact]'
    ),
    (
      v_me,
      'external',
      null,
      'Leo DJ',
      array['DJ']::text[],
      'Barcelona',
      'Spain',
      '@djleo',
      '+34 600 000 001',
      null,
      array['music', 'event']::text[],
      'Great bachata sets, met in BCN social. [seed-dashboard-contact]'
    ),
    (
      v_me,
      'external',
      null,
      'Anna Photo',
      array['Photographer']::text[],
      'Tallinn',
      'Estonia',
      '@annashots',
      null,
      'anna@example.com',
      array['photo', 'festival']::text[],
      'Shoots congress weekend highlights. [seed-dashboard-contact]'
    );

  for v_member in
    select u.id
    from auth.users u
    where u.id <> v_me
      and u.email is not null
      and lower(u.email) not like '%@local.test'
    order by u.created_at asc
    limit 3
  loop
    insert into public.dance_contacts (
      user_id,
      contact_type,
      linked_user_id,
      name,
      role,
      city,
      country,
      tags,
      notes
    )
    values (
      v_me,
      'member',
      v_member,
      coalesce(
        (select p.display_name from public.profiles p where p.user_id = v_member limit 1),
        'ConXion Member'
      ),
      coalesce(
        (select p.roles from public.profiles p where p.user_id = v_member limit 1),
        array['Dancer']::text[]
      ),
      (select p.city from public.profiles p where p.user_id = v_member limit 1),
      (select p.country from public.profiles p where p.user_id = v_member limit 1),
      array['member']::text[],
      '[seed-dashboard-contact]'
    )
    on conflict (user_id, linked_user_id) do update
      set updated_at = now(),
          notes = excluded.notes;

    v_count := v_count + 1;
  end loop;

  raise notice 'Dance contacts seed complete for user % (email selector: %). Member contacts processed: %',
    v_me,
    coalesce(nullif(trim(v_email), ''), 'auto'),
    v_count;
end $$;

commit;

notify pgrst, 'reload schema';
