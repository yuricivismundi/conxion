-- ConXion Dashboard sample seed (growth + goals + competitions)
-- Date: 2026-03-02
-- Usage:
--   1) Run migrations first:
--      - scripts/sql/2026-03-02_dance_space_growth.sql
--      - scripts/sql/2026-03-04_dance_space_move_detail_refine.sql
--      - scripts/sql/2026-03-02_dashboard_goals.sql
--      - scripts/sql/2026-03-05_dashboard_goals_refine.sql
--      - scripts/sql/2026-03-02_dashboard_competitions.sql
--      - scripts/sql/2026-03-03_dashboard_competitions_results_refresh.sql
--   2) Optional: set v_email below to an existing auth.users email in this project.
--      If left blank, script uses the oldest non-anon auth user.
--   3) Run this script in Supabase SQL editor.

begin;

do $$
declare
  v_email text := '';
  v_user uuid;
begin
  if to_regclass('public.dance_moves_user') is null then
    raise exception 'Missing table public.dance_moves_user. Run scripts/sql/2026-03-02_dance_space_growth.sql first.';
  end if;

  if to_regclass('public.dance_move_practice_logs') is null then
    raise exception 'Missing table public.dance_move_practice_logs. Run scripts/sql/2026-03-04_dance_space_move_detail_refine.sql first.';
  end if;

  if to_regclass('public.dance_goals_user') is null then
    raise exception 'Missing table public.dance_goals_user. Run scripts/sql/2026-03-02_dashboard_goals.sql first.';
  end if;

  if to_regclass('public.dance_competitions_user') is null then
    raise exception 'Missing table public.dance_competitions_user. Run scripts/sql/2026-03-02_dashboard_competitions.sql first.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'dance_competitions_result_allowed_chk'
      and c.conrelid = 'public.dance_competitions_user'::regclass
      and pg_get_constraintdef(c.oid) ilike '%Quarterfinalist%'
      and pg_get_constraintdef(c.oid) ilike '%Semifinalist%'
  ) then
    raise exception 'Outdated competitions result constraint. Run scripts/sql/2026-03-03_dashboard_competitions_results_refresh.sql before seeding.';
  end if;

  if length(trim(v_email)) > 0 then
    select u.id
    into v_user
    from auth.users u
    where lower(u.email) = lower(v_email)
    order by u.created_at asc
    limit 1;
  else
    select u.id
    into v_user
    from auth.users u
    where u.email is not null
      and lower(u.email) not like '%@local.test'
    order by u.created_at asc
    limit 1;
  end if;

  if v_user is null then
    if length(trim(v_email)) > 0 then
      raise exception 'No auth user found for email: %', v_email;
    end if;
    raise exception 'No auth user found. Create at least one real user first, or set v_email in this script.';
  end if;

  -- Optional starter catalog rows (idempotent-ish)
  insert into public.dance_moves_catalog (style, name, level, is_default)
  select x.style, x.name, x.level, true
  from (
    values
      ('bachata', 'Body Wave', 'Beginner'),
      ('bachata', 'Shadow Position', 'Intermediate'),
      ('salsa', 'Cross Body Lead', 'Beginner'),
      ('salsa', 'Enchufla', 'Intermediate'),
      ('kizomba', 'Saida', 'Beginner'),
      ('zouk', 'Lateral', 'Intermediate')
  ) as x(style, name, level)
  where not exists (
    select 1
    from public.dance_moves_catalog c
    where lower(c.style) = lower(x.style)
      and lower(c.name) = lower(x.name)
  );

  -- Reset user sample rows for clean re-runs.
  delete from public.dance_move_practice_logs where user_id = v_user;
  delete from public.dance_moves_user where user_id = v_user;
  delete from public.dance_goals_user where user_id = v_user;
  delete from public.dance_competitions_user where user_id = v_user;

  insert into public.dance_moves_user (
    user_id, style, name, status, confidence, difficulty, move_type, practice_count, started_practicing_at, last_practiced_at, reference_url, key_cue, common_mistake, fix_tip, note, learned_at, created_at, updated_at
  )
  values
    (
      v_user, 'bachata', 'Body Wave', 'planned', null, 'easy', 'styling', 0, null, null,
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Keep ribcage isolated', 'Shoulders get tense', 'Relax shoulders before wave',
      'Queued for next social.', null, now() - interval '12 days', now() - interval '12 days'
    ),
    (
      v_user, 'salsa', 'Enchufla', 'planned', null, 'medium', 'turn-pattern', 0, null, null,
      null, null, null, null,
      null, null, now() - interval '10 days', now() - interval '8 days'
    ),
    (
      v_user, 'bachata', 'Shadow Position', 'practicing', 3, 'medium', 'partnerwork', 6, now() - interval '9 days', now() - interval '1 day',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Control frame on count 3', 'Breaks on transition', 'Slow down entry then rotate',
      'Focus on connection and timing.', null, now() - interval '9 days', now() - interval '1 day'
    ),
    (
      v_user, 'kizomba', 'Saida', 'practicing', 4, 'hard', 'footwork', 11, now() - interval '8 days', now() - interval '6 hours',
      null, 'Grounded steps', 'Over-rotating hips', 'Shorter step length',
      'Practice with slower songs first.', null, now() - interval '8 days', now() - interval '6 hours'
    ),
    (
      v_user, 'salsa', 'Cross Body Lead', 'learned', 5, 'easy', 'partnerwork', 18, now() - interval '28 days', now() - interval '2 days',
      null, null, null, null,
      null, now() - interval '20 days', now() - interval '30 days', now() - interval '20 days'
    ),
    (
      v_user, 'zouk', 'Lateral', 'learned', 4, 'medium', 'styling', 9, now() - interval '12 days', now() - interval '5 days',
      null, null, null, null,
      null, now() - interval '5 days', now() - interval '14 days', now() - interval '5 days'
    );

  insert into public.dance_move_practice_logs (move_id, user_id, confidence_after, quick_note, created_at)
  select id, v_user, 3, 'Worked on transitions', now() - interval '5 days'
  from public.dance_moves_user
  where user_id = v_user and name = 'Shadow Position'
  limit 1;

  insert into public.dance_move_practice_logs (move_id, user_id, confidence_after, quick_note, created_at)
  select id, v_user, 4, 'Better balance today', now() - interval '2 days'
  from public.dance_moves_user
  where user_id = v_user and name = 'Shadow Position'
  limit 1;

  insert into public.dance_move_practice_logs (move_id, user_id, confidence_after, quick_note, created_at)
  select id, v_user, 4, 'Flow improved with slower tempo', now() - interval '1 day'
  from public.dance_moves_user
  where user_id = v_user and name = 'Saida'
  limit 1;

  insert into public.dance_goals_user (
    user_id, title, category, status, progress, target_date, note, created_at, updated_at
  )
  values
    (v_user, 'Practice 3 partnerwork sessions this week', 'practice', 'active', 40, current_date + 10, 'Use Tuesday and Thursday classes.', now() - interval '6 days', now() - interval '2 days'),
    (v_user, 'Learn one new Salsa combo', 'learning', 'active', 65, current_date + 21, null, now() - interval '12 days', now() - interval '1 day'),
    (v_user, 'Attend 2 social nights this month', 'social', 'completed', 100, current_date - 3, 'Completed earlier than planned.', now() - interval '20 days', now() - interval '3 days');

  insert into public.dance_competitions_user (
    user_id, event_name, city, country, style, division, role, result, year, note, created_at, updated_at
  )
  values
    (v_user, 'Tallinn Bachata Open', 'Tallinn', 'Estonia', 'bachata', 'Intermediate', 'Leader', 'Finalist', 2025, null, now() - interval '200 days', now() - interval '200 days'),
    (v_user, 'Barcelona Social Weekend', 'Barcelona', 'Spain', 'salsa', 'Beginner', 'Follower', 'Participated', 2024, 'Great feedback from judges.', now() - interval '420 days', now() - interval '420 days'),
    (v_user, 'Riga Latin Cup', 'Riga', 'Latvia', 'salsa', 'Intermediate', 'Switch', 'Quarterfinalist', 2025, null, now() - interval '120 days', now() - interval '120 days');

  raise notice 'Seed complete for user % (email selector: %)', v_user, coalesce(nullif(trim(v_email), ''), 'auto');
end $$;

commit;

notify pgrst, 'reload schema';
