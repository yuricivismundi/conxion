-- Seed visible sample members for Discover:
-- - 50 dancers
-- - 30 hosts
-- Notes:
-- - These are tagged sample users in auth metadata and by email domain.
-- - profiles.is_test stays false because Discover currently hides is_test=true rows.
-- - Safe to rerun: replaces only prior rows from this seed set.

begin;

do $$
declare
  v_seed text := 'discover_members_hosts_v1';
  v_domain text := 'sample.conxion.test';
  v_instance_id uuid;
  v_password_hash text;
  v_user_id uuid;
  v_idx integer;
  v_local_index integer;
  v_is_host boolean;
  v_display_name text;
  v_email text;
  v_city text;
  v_country text;
  v_style text;
  v_level text;
  v_roles text[];
  v_languages text[];
  v_interests text[];
  v_availability text[];
  v_avatar_url text;
  v_verified boolean;
begin
  select u.instance_id, coalesce(u.encrypted_password, '')
  into v_instance_id, v_password_hash
  from auth.users u
  order by u.created_at asc
  limit 1;

  if v_instance_id is null then
    raise exception 'No auth.users rows found to inherit instance_id from.';
  end if;

  delete from public.profiles p
  using auth.users u
  where p.user_id = u.id
    and (
      coalesce(u.raw_user_meta_data->>'seed', '') = v_seed
      or lower(coalesce(u.email, '')) like '%@' || v_domain
    );

  delete from auth.users u
  where coalesce(u.raw_user_meta_data->>'seed', '') = v_seed
     or lower(coalesce(u.email, '')) like '%@' || v_domain;

  for v_idx in 1..80 loop
    v_is_host := v_idx > 50;
    v_local_index := case when v_is_host then v_idx - 50 else v_idx end;
    v_user_id := gen_random_uuid();

    v_display_name := case
      when v_is_host then format('Sample Host %s', lpad(v_local_index::text, 2, '0'))
      else format('Sample Dancer %s', lpad(v_local_index::text, 2, '0'))
    end;

    v_email := case
      when v_is_host then format('host-%s@%s', lpad(v_local_index::text, 3, '0'), v_domain)
      else format('dancer-%s@%s', lpad(v_local_index::text, 3, '0'), v_domain)
    end;

    case (v_idx - 1) % 10
      when 0 then v_city := 'Barcelona'; v_country := 'Spain';
      when 1 then v_city := 'Madrid'; v_country := 'Spain';
      when 2 then v_city := 'Lisbon'; v_country := 'Portugal';
      when 3 then v_city := 'Paris'; v_country := 'France';
      when 4 then v_city := 'Tallinn'; v_country := 'Estonia';
      when 5 then v_city := 'Riga'; v_country := 'Latvia';
      when 6 then v_city := 'Warsaw'; v_country := 'Poland';
      when 7 then v_city := 'Berlin'; v_country := 'Germany';
      when 8 then v_city := 'Milan'; v_country := 'Italy';
      else v_city := 'Prague'; v_country := 'Czech Republic';
    end case;

    case (v_idx - 1) % 6
      when 0 then v_style := 'bachata';
      when 1 then v_style := 'salsa';
      when 2 then v_style := 'kizomba';
      when 3 then v_style := 'zouk';
      when 4 then v_style := 'tango';
      else v_style := 'other';
    end case;

    case (v_idx - 1) % 3
      when 0 then v_level := 'Beginner';
      when 1 then v_level := 'Intermediate';
      else v_level := 'Advanced';
    end case;

    v_roles := case
      when v_is_host
        then array[
          case when (v_idx % 2) = 0 then 'Leader' else 'Follower' end,
          case when (v_idx % 3) = 0 then 'Teacher' else 'Organizer' end
        ]
      else array[
        case when (v_idx % 2) = 0 then 'Leader' else 'Follower' end
      ]
    end;

    v_languages := case (v_idx - 1) % 5
      when 0 then array['English', 'Spanish']
      when 1 then array['English', 'French']
      when 2 then array['English', 'Portuguese']
      when 3 then array['English', 'German']
      else array['English']
    end;

    v_interests := case
      when v_is_host then array['Hosting', 'Social dancing']
      else array['Social dancing', 'Workshops']
    end;

    v_availability := case (v_idx - 1) % 3
      when 0 then array['Weekends']
      when 1 then array['Evenings', 'Weekends']
      else array['Travel for Events']
    end;

    v_avatar_url := format('https://i.pravatar.cc/400?img=%s', ((v_idx - 1) % 70) + 1);
    v_verified := (v_idx % 4) = 0;

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user,
      is_anonymous
    ) values (
      v_instance_id,
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_password_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object(
        'display_name', v_display_name,
        'seed', v_seed,
        'sample_kind', case when v_is_host then 'host' else 'dancer' end
      ),
      now() - ((90 - v_idx) * interval '4 minutes'),
      now() - ((90 - v_idx) * interval '4 minutes'),
      false,
      false
    );

    insert into public.profiles (
      user_id,
      auth_user_id,
      created_at,
      updated_at,
      display_name,
      city,
      country,
      dance_styles,
      avatar_url,
      roles,
      languages,
      verified,
      verified_at,
      verified_label,
      dance_skills,
      connections_count,
      interests,
      availability,
      is_test,
      has_other_style,
      last_seen_at,
      can_host,
      hosting_status,
      max_guests,
      hosting_last_minute_ok,
      hosting_preferred_guest_gender,
      hosting_kid_friendly,
      hosting_pet_friendly,
      hosting_smoking_allowed,
      hosting_sleeping_arrangement,
      hosting_guest_share,
      hosting_transit_access,
      is_verified,
      verification_type,
      hosting_notes,
      house_rules
    ) values (
      v_user_id,
      v_user_id,
      now() - ((90 - v_idx) * interval '4 minutes'),
      now() - ((90 - v_idx) * interval '4 minutes'),
      v_display_name,
      v_city,
      v_country,
      array[v_style],
      v_avatar_url,
      v_roles,
      v_languages,
      v_verified,
      case when v_verified then now() - ((v_idx % 12) * interval '1 day') else null end,
      case when v_verified then 'Verified' else null end,
      jsonb_build_object(v_style, jsonb_build_object('level', v_level, 'verified', v_verified)),
      0,
      v_interests,
      v_availability,
      false,
      v_style = 'other',
      now() - ((v_idx % 9) * interval '3 hours'),
      v_is_host,
      case when v_is_host then 'available' else 'inactive' end,
      case when v_is_host then 1 + ((v_local_index - 1) % 4) else null end,
      v_is_host and (v_idx % 2 = 0),
      'any',
      v_is_host and (v_idx % 5 = 0),
      v_is_host and (v_idx % 6 = 0),
      false,
      case
        when v_is_host and (v_idx % 3 = 0) then 'private_room'
        when v_is_host then 'shared_room'
        else 'not_specified'
      end,
      case when v_is_host then 'Welcoming dancers for congress weekends.' else null end,
      case when v_is_host then 'Close to transit and city socials.' else null end,
      v_verified,
      case when v_verified then 'payment' else null end,
      case when v_is_host then 'Hosting for dance travelers with clear expectations.' else null end,
      case when v_is_host then 'Quiet hours after midnight.' else null end
    );
  end loop;

  raise notice 'Seeded 50 dancers and 30 hosts for Discover (seed: %).', v_seed;
end $$;

commit;

notify pgrst, 'reload schema';

select
  count(*) filter (where lower(email) like 'dancer-%@sample.conxion.test') as seeded_dancers,
  count(*) filter (where lower(email) like 'host-%@sample.conxion.test') as seeded_hosts
from auth.users;
