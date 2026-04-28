-- Seed teacher profile data for Yuri Bucio (5fd75dd8-1893-4eb4-a8cc-6f026fd10d02)
-- Run in Supabase SQL editor

do $$
declare
  yuri uuid := '5fd75dd8-1893-4eb4-a8cc-6f026fd10d02';
begin

-- ── teacher_profiles ──────────────────────────────────────────────────────────
insert into public.teacher_profiles (
  user_id, teacher_profile_enabled, default_public_view,
  headline, bio, base_city, base_school,
  languages, travel_available, availability_summary, is_public
) values (
  yuri, true, 'teacher',
  'Bachata & Salsa instructor · 10+ years on the floor',
  'I started dancing Bachata in 2013 in Barcelona and never looked back. '
  'My teaching philosophy centres on musicality, body movement, and connection — '
  'whether you are stepping on a dancefloor for the first time or refining your technique for competitions. '
  'I offer private classes, workshops, and intensive weekends. '
  'Currently based in Barcelona; available to travel across Europe.',
  'Barcelona', 'ConXion Dance Studio',
  ARRAY['English', 'Spanish', 'French'],
  true,
  'Mon–Fri evenings + weekends. Flexible for private bookings with 48 h notice.',
  true
)
on conflict (user_id) do update set
  teacher_profile_enabled   = excluded.teacher_profile_enabled,
  default_public_view       = excluded.default_public_view,
  headline                  = excluded.headline,
  bio                       = excluded.bio,
  base_city                 = excluded.base_city,
  base_school               = excluded.base_school,
  languages                 = excluded.languages,
  travel_available          = excluded.travel_available,
  availability_summary      = excluded.availability_summary,
  is_public                 = excluded.is_public,
  updated_at                = now();

-- ── teacher_regular_classes ───────────────────────────────────────────────────
delete from public.teacher_regular_classes where user_id = yuri;

insert into public.teacher_regular_classes
  (user_id, title, style, level, venue_name, city, weekday, start_time, duration_min, recurrence_text, notes, is_active, position)
values
  (yuri, 'Bachata Sensual – Beginners', 'Bachata', 'Beginner',
   'Studio Groove BCN', 'Barcelona', 1, '19:30', 75,
   'Every Monday', 'No partner needed. Comfortable shoes recommended.', true, 0),
  (yuri, 'Bachata – Intermediate Technique', 'Bachata', 'Intermediate',
   'Studio Groove BCN', 'Barcelona', 3, '20:00', 90,
   'Every Wednesday', 'Focus on musicality and body isolation.', true, 1),
  (yuri, 'Salsa On2 – All Levels', 'Salsa', 'All levels',
   'Espai Flamenc', 'Barcelona', 5, '19:00', 60,
   'Every Friday', 'Latin social night follows the class.', true, 2),
  (yuri, 'Private – Bachata or Salsa', 'Bachata / Salsa', 'Any',
   'Flexible (home studio or your location)', 'Barcelona', null, null, 60,
   'By appointment', 'Online sessions available on request.', true, 3);

-- ── teacher_event_teaching ────────────────────────────────────────────────────
delete from public.teacher_event_teaching where user_id = yuri;

insert into public.teacher_event_teaching
  (user_id, event_name, city, country, start_date, end_date, role, notes, is_active, position)
values
  (yuri, 'Barcelona Bachata Festival 2026', 'Barcelona', 'Spain',
   '2026-06-12', '2026-06-15', 'Instructor & Workshop Host',
   'Teaching two workshops: Musicality in Bachata Sensual and Partner Connection.', true, 0),
  (yuri, 'Paris Salsa Congress 2025', 'Paris', 'France',
   '2025-11-07', '2025-11-09', 'Guest Instructor',
   'Invited to teach a Salsa On2 styling workshop.', true, 1),
  (yuri, 'Lisbon Dance Weekend 2025', 'Lisbon', 'Portugal',
   '2025-09-19', '2025-09-21', 'Instructor',
   'Bachata Sensual workshop and social dance showcase.', true, 2),
  (yuri, 'Berlin Latin Night Festival 2024', 'Berlin', 'Germany',
   '2024-04-26', '2024-04-28', 'Instructor',
   'Taught beginner & intermediate Bachata workshops.', true, 3);

-- ── teacher_weekly_availability ───────────────────────────────────────────────
delete from public.teacher_weekly_availability where user_id = yuri;

insert into public.teacher_weekly_availability
  (user_id, service_type, weekday, start_time, end_time, label, is_available, is_flexible, note, position)
values
  (yuri, 'private_class', 1, '09:00', '13:00', 'Monday morning', true, false, null, 0),
  (yuri, 'private_class', 2, '09:00', '13:00', 'Tuesday morning', true, false, null, 1),
  (yuri, 'private_class', 4, '09:00', '13:00', 'Thursday morning', true, true, 'Flexible — contact to confirm', 2),
  (yuri, 'workshop',      6, '10:00', '18:00', 'Saturday',         true, false, 'Group workshops / intensives', 3),
  (yuri, 'workshop',      0, '11:00', '17:00', 'Sunday',           true, true,  'Available on selected Sundays', 4);

end $$;
