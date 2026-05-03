-- Full teacher profile seed for Yuri Bucio (5fd75dd8-1893-4eb4-a8cc-6f026fd10d02)
-- Run in Supabase SQL editor

do $$
declare
  yuri uuid := '5fd75dd8-1893-4eb4-a8cc-6f026fd10d02';
begin

-- ── teacher_profiles ──────────────────────────────────────────────────────────
insert into public.teacher_profiles (
  user_id, teacher_profile_enabled, default_public_view,
  headline, bio, base_city, base_country, base_school,
  languages, travel_available, availability_summary, is_public
) values (
  yuri, true, 'teacher',
  'Bachata & Salsa instructor · Barcelona based · Available to travel',
  'I started dancing Bachata in 2013 in Barcelona and never looked back. '
  'My teaching philosophy centres on musicality, body movement, and connection — '
  'whether you are stepping on a dancefloor for the first time or refining your technique for competitions. '
  'I offer private classes, packages, workshops, and personalised choreography for reels and collabs. '
  'Currently based in Barcelona; available to travel across Europe.',
  'Barcelona', 'Spain', 'ConXion Dance Studio',
  ARRAY['English', 'Spanish', 'French'],
  true,
  'Mon–Fri mornings + evenings. Sat all day. Sun selected. Flexible with 48h notice.',
  true
)
on conflict (user_id) do update set
  teacher_profile_enabled  = excluded.teacher_profile_enabled,
  default_public_view      = excluded.default_public_view,
  headline                 = excluded.headline,
  bio                      = excluded.bio,
  base_city                = excluded.base_city,
  base_country             = excluded.base_country,
  base_school              = excluded.base_school,
  languages                = excluded.languages,
  travel_available         = excluded.travel_available,
  availability_summary     = excluded.availability_summary,
  is_public                = excluded.is_public,
  updated_at               = now();

-- ── teacher_weekly_availability (matching design: MON–SUN) ───────────────────
delete from public.teacher_weekly_availability where user_id = yuri;

-- weekday: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
insert into public.teacher_weekly_availability
  (user_id, service_type, weekday, start_time, end_time, label, is_available, is_flexible, note, position)
values
  -- MON: 17:00 slot
  (yuri, 'private_class', 1, '17:00', '18:00', 'Monday evening', true, false, null, 0),
  -- MON: 18:30 slot
  (yuri, 'private_class', 1, '18:30', '19:30', 'Monday evening late', true, false, null, 1),
  -- TUE: 10:00 slot
  (yuri, 'private_class', 2, '10:00', '11:00', 'Tuesday morning', true, false, null, 2),
  -- TUE: Flexible slot
  (yuri, 'private_class', 2, null, null, 'Tuesday flexible', true, true, 'Contact to arrange', 3),
  -- WED: 19:00 slot
  (yuri, 'private_class', 3, '19:00', '20:00', 'Wednesday evening', true, false, null, 4),
  -- WED: 20:30 slot
  (yuri, 'private_class', 3, '20:30', '21:30', 'Wednesday late', true, false, null, 5),
  -- THU: Flexible slot
  (yuri, 'private_class', 4, null, null, 'Thursday flexible', true, true, 'Contact to arrange', 6),
  -- THU: 14:00 slot
  (yuri, 'private_class', 4, '14:00', '15:00', 'Thursday afternoon', true, false, null, 7),
  -- FRI: 16:00 slot
  (yuri, 'private_class', 5, '16:00', '17:00', 'Friday afternoon', true, false, null, 8),
  -- FRI: 17:30 slot
  (yuri, 'private_class', 5, '17:30', '18:30', 'Friday evening', true, false, null, 9),
  -- SAT: All Day
  (yuri, 'private_class', 6, '10:00', '20:00', 'Saturday all day', true, false, 'All Day', 10),
  (yuri, 'workshop',      6, '10:00', '20:00', 'Saturday workshops', true, false, 'Group workshops & intensives', 11),
  -- SUN: Off
  (yuri, 'private_class', 0, null, null, 'Sunday', false, false, 'Off', 12);

-- ── teacher_info_profiles ─────────────────────────────────────────────────────
insert into public.teacher_info_profiles (user_id, headline, intro_text, is_enabled)
values (
  yuri,
  'Private classes, choreography & content collaboration in Barcelona',
  'Book a private class, a choreography session for your next reel, or collaborate with me directly on a video project. All services include personalised attention and full preparation.',
  true
)
on conflict (user_id) do update set
  headline   = excluded.headline,
  intro_text = excluded.intro_text,
  is_enabled = excluded.is_enabled,
  updated_at = now();

-- ── teacher_info_blocks ───────────────────────────────────────────────────────
delete from public.teacher_info_blocks where user_id = yuri;

-- Block 1: Private class (single session)
insert into public.teacher_info_blocks
  (user_id, kind, title, short_summary, content_json, is_active, position)
values (
  yuri,
  'private_class',
  'Private Class – 1 hour',
  'One-on-one session tailored to your level and goals. Bachata or Salsa.',
  jsonb_build_object(
    'price_text',        '60 EUR / session',
    'package_text',      'Package 5 hrs: 270 EUR (save 30 EUR) · Package 10 hrs: 500 EUR (save 100 EUR)',
    'conditions_text',   'Includes: personalised plan · technique assessment · homework exercises · studio rental',
    'availability_text', 'Mon–Fri evenings · Sat all day · Flexible with 48 h notice',
    'travel_text',       'Available in Barcelona. Travel across Europe on request.',
    'notes_text',        null,
    'cta_text',          'Send a request through the platform to book your first session.'
  ),
  true, 0
);

-- Block 2: Package 5 hours
insert into public.teacher_info_blocks
  (user_id, kind, title, short_summary, content_json, is_active, position)
values (
  yuri,
  'private_class',
  'Class Package – 5 Hours',
  'Five private sessions to build real progress with continuity and a structured plan.',
  jsonb_build_object(
    'price_text',        '270 EUR (regular 300 EUR — save 30 EUR)',
    'package_text',      'Spread sessions across any weeks. No expiry.',
    'conditions_text',   'Includes: personalised plan · assessment after each session · homework · studio rental · progress tracking',
    'availability_text', 'Schedule session by session — fully flexible',
    'notes_text',        null,
    'cta_text',          'Message me to start your package.'
  ),
  true, 1
);

-- Block 3: Package 10 hours
insert into public.teacher_info_blocks
  (user_id, kind, title, short_summary, content_json, is_active, position)
values (
  yuri,
  'private_class',
  'Class Package – 10 Hours',
  'Ten sessions for a deep transformation. Best value for committed students.',
  jsonb_build_object(
    'price_text',        '500 EUR (regular 600 EUR — save 100 EUR)',
    'package_text',      'Use sessions at your own pace. No expiry.',
    'conditions_text',   'Includes: full personalised curriculum · weekly homework · studio rental · video feedback · progress report',
    'availability_text', 'Fully flexible scheduling',
    'notes_text',        null,
    'cta_text',          'Message me to lock in your 10-hour package.'
  ),
  true, 2
);

-- Block 4: Choreography – Reel / Content project
insert into public.teacher_info_blocks
  (user_id, kind, title, short_summary, content_json, is_active, position)
values (
  yuri,
  'other',
  'Choreography – Personalised 30-sec Reel',
  'Custom choreography designed for your body, style, and song. Perfect for Instagram or TikTok reels.',
  jsonb_build_object(
    'price_text',        'From 80 EUR',
    'conditions_text',   'Includes: choreography creation · 1 rehearsal session · export-ready breakdown · optional studio session',
    'availability_text', 'Delivery within 5–7 days after first session',
    'notes_text',        'Send me the song and your level. I will design a 30-second sequence that fits your style and is achievable in 1–2 sessions.',
    'cta_text',          'Message me with your song and goal.'
  ),
  true, 3
);

-- Block 5: Collab – filming + choreography + me in the video
insert into public.teacher_info_blocks
  (user_id, kind, title, short_summary, content_json, is_active, position)
values (
  yuri,
  'organizer_collab',
  'Collab with Me – Choreo, Filming & Presence',
  'I join your video project as a co-performer: we create the choreography together, I appear in the video, and we film it in studio.',
  jsonb_build_object(
    'price_text',        '150 EUR',
    'conditions_text',   'Includes: choreography creation · studio booking · full filming session · Yuri featured in the video',
    'availability_text', 'Sat or Sun preferred. Weekday evenings on request.',
    'notes_text',        'Ideal for content creators looking for a professional dance partner for reels, YouTube videos, or brand collaborations. Final video is yours to publish.',
    'cta_text',          'Message me with your concept and preferred date.'
  ),
  true, 4
);

end $$;
