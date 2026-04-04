begin;

-- ---------------------------------------------------------------------------
-- teacher_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_profiles (
  user_id                       uuid primary key references public.profiles(user_id) on delete cascade,
  teacher_profile_enabled       boolean not null default false,
  teacher_profile_trial_started_at timestamptz null,
  teacher_profile_trial_ends_at timestamptz null,
  default_public_view           text not null default 'social'
    constraint teacher_profiles_default_public_view_chk check (default_public_view in ('social', 'teacher')),
  headline                      text null
    constraint teacher_profiles_headline_len_chk check (char_length(btrim(headline)) <= 120),
  bio                           text null
    constraint teacher_profiles_bio_len_chk check (char_length(btrim(bio)) <= 1000),
  base_city                     text null,
  base_school                   text null,
  languages                     text[] not null default '{}',
  travel_available              boolean not null default false,
  availability_summary          text null
    constraint teacher_profiles_availability_summary_len_chk check (char_length(btrim(availability_summary)) <= 300),
  is_public                     boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_teacher_profiles_user_id
  on public.teacher_profiles(user_id);

drop trigger if exists trg_teacher_profiles_set_updated_at on public.teacher_profiles;
create trigger trg_teacher_profiles_set_updated_at
before update on public.teacher_profiles
for each row execute function public.set_updated_at_ts();

alter table public.teacher_profiles enable row level security;

drop policy if exists teacher_profiles_select on public.teacher_profiles;
create policy teacher_profiles_select
on public.teacher_profiles for select
using (is_public = true or auth.uid() = user_id);

drop policy if exists teacher_profiles_insert_owner on public.teacher_profiles;
create policy teacher_profiles_insert_owner
on public.teacher_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_profiles_update_owner on public.teacher_profiles;
create policy teacher_profiles_update_owner
on public.teacher_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_profiles_delete_owner on public.teacher_profiles;
create policy teacher_profiles_delete_owner
on public.teacher_profiles for delete
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- teacher_regular_classes
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_regular_classes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(user_id) on delete cascade,
  title          text not null
    constraint teacher_regular_classes_title_nonempty_chk check (length(btrim(title)) > 0),
  style          text null,
  level          text null,
  venue_name     text null,
  city           text null,
  weekday        int null
    constraint teacher_regular_classes_weekday_chk check (weekday between 0 and 6),
  start_time     time null,
  duration_min   int null
    constraint teacher_regular_classes_duration_chk check (duration_min > 0),
  recurrence_text text null,
  notes          text null,
  is_active      boolean not null default true,
  position       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_teacher_regular_classes_user_id
  on public.teacher_regular_classes(user_id);

drop trigger if exists trg_teacher_regular_classes_set_updated_at on public.teacher_regular_classes;
create trigger trg_teacher_regular_classes_set_updated_at
before update on public.teacher_regular_classes
for each row execute function public.set_updated_at_ts();

alter table public.teacher_regular_classes enable row level security;

drop policy if exists teacher_regular_classes_select on public.teacher_regular_classes;
create policy teacher_regular_classes_select
on public.teacher_regular_classes for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_regular_classes.user_id
      and tp.is_public = true
  )
);

drop policy if exists teacher_regular_classes_insert_owner on public.teacher_regular_classes;
create policy teacher_regular_classes_insert_owner
on public.teacher_regular_classes for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_regular_classes_update_owner on public.teacher_regular_classes;
create policy teacher_regular_classes_update_owner
on public.teacher_regular_classes for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_regular_classes_delete_owner on public.teacher_regular_classes;
create policy teacher_regular_classes_delete_owner
on public.teacher_regular_classes for delete
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- teacher_event_teaching
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_event_teaching (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  event_name  text not null
    constraint teacher_event_teaching_event_name_nonempty_chk check (length(btrim(event_name)) > 0),
  city        text null,
  country     text null,
  start_date  date null,
  end_date    date null,
  role        text null,
  notes       text null,
  is_active   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_teacher_event_teaching_user_id
  on public.teacher_event_teaching(user_id);

drop trigger if exists trg_teacher_event_teaching_set_updated_at on public.teacher_event_teaching;
create trigger trg_teacher_event_teaching_set_updated_at
before update on public.teacher_event_teaching
for each row execute function public.set_updated_at_ts();

alter table public.teacher_event_teaching enable row level security;

drop policy if exists teacher_event_teaching_select on public.teacher_event_teaching;
create policy teacher_event_teaching_select
on public.teacher_event_teaching for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_event_teaching.user_id
      and tp.is_public = true
  )
);

drop policy if exists teacher_event_teaching_insert_owner on public.teacher_event_teaching;
create policy teacher_event_teaching_insert_owner
on public.teacher_event_teaching for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_event_teaching_update_owner on public.teacher_event_teaching;
create policy teacher_event_teaching_update_owner
on public.teacher_event_teaching for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_event_teaching_delete_owner on public.teacher_event_teaching;
create policy teacher_event_teaching_delete_owner
on public.teacher_event_teaching for delete
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- teacher_weekly_availability
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_weekly_availability (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  service_type text not null default 'private_class',
  weekday      int not null
    constraint teacher_weekly_availability_weekday_chk check (weekday between 0 and 6),
  start_time   time null,
  end_time     time null,
  label        text null,
  is_available boolean not null default true,
  is_flexible  boolean not null default false,
  note         text null,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_teacher_weekly_availability_user_id
  on public.teacher_weekly_availability(user_id);

drop trigger if exists trg_teacher_weekly_availability_set_updated_at on public.teacher_weekly_availability;
create trigger trg_teacher_weekly_availability_set_updated_at
before update on public.teacher_weekly_availability
for each row execute function public.set_updated_at_ts();

alter table public.teacher_weekly_availability enable row level security;

drop policy if exists teacher_weekly_availability_select on public.teacher_weekly_availability;
create policy teacher_weekly_availability_select
on public.teacher_weekly_availability for select
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_weekly_availability.user_id
      and tp.is_public = true
  )
);

drop policy if exists teacher_weekly_availability_insert_owner on public.teacher_weekly_availability;
create policy teacher_weekly_availability_insert_owner
on public.teacher_weekly_availability for insert
with check (auth.uid() = user_id);

drop policy if exists teacher_weekly_availability_update_owner on public.teacher_weekly_availability;
create policy teacher_weekly_availability_update_owner
on public.teacher_weekly_availability for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists teacher_weekly_availability_delete_owner on public.teacher_weekly_availability;
create policy teacher_weekly_availability_delete_owner
on public.teacher_weekly_availability for delete
using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- teacher_students (mini CRM)
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_students (
  id               uuid primary key default gen_random_uuid(),
  teacher_user_id  uuid not null references public.profiles(user_id) on delete cascade,
  student_user_id  uuid null references public.profiles(user_id) on delete set null,
  display_name     text null,
  notes_private    text null,
  tags             text[] not null default '{}',
  session_count    int not null default 0,
  status           text not null default 'active'
    constraint teacher_students_status_chk check (status in ('active', 'inactive', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_teacher_students_teacher_user_id
  on public.teacher_students(teacher_user_id);
create index if not exists idx_teacher_students_student_user_id
  on public.teacher_students(student_user_id);

drop trigger if exists trg_teacher_students_set_updated_at on public.teacher_students;
create trigger trg_teacher_students_set_updated_at
before update on public.teacher_students
for each row execute function public.set_updated_at_ts();

alter table public.teacher_students enable row level security;

drop policy if exists teacher_students_select_owner on public.teacher_students;
create policy teacher_students_select_owner
on public.teacher_students for select
using (auth.uid() = teacher_user_id);

drop policy if exists teacher_students_insert_owner on public.teacher_students;
create policy teacher_students_insert_owner
on public.teacher_students for insert
with check (auth.uid() = teacher_user_id);

drop policy if exists teacher_students_update_owner on public.teacher_students;
create policy teacher_students_update_owner
on public.teacher_students for update
using (auth.uid() = teacher_user_id)
with check (auth.uid() = teacher_user_id);

drop policy if exists teacher_students_delete_owner on public.teacher_students;
create policy teacher_students_delete_owner
on public.teacher_students for delete
using (auth.uid() = teacher_user_id);

-- ---------------------------------------------------------------------------
-- teacher_student_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_student_sessions (
  id                  uuid primary key default gen_random_uuid(),
  teacher_student_id  uuid not null references public.teacher_students(id) on delete cascade,
  scheduled_at        timestamptz null,
  completed_at        timestamptz null,
  session_type        text null,
  summary_shared      text null,
  notes_private       text null,
  exercises           text null,
  next_focus          text null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_teacher_student_sessions_teacher_student_id
  on public.teacher_student_sessions(teacher_student_id);

drop trigger if exists trg_teacher_student_sessions_set_updated_at on public.teacher_student_sessions;
create trigger trg_teacher_student_sessions_set_updated_at
before update on public.teacher_student_sessions
for each row execute function public.set_updated_at_ts();

alter table public.teacher_student_sessions enable row level security;

drop policy if exists teacher_student_sessions_select_owner on public.teacher_student_sessions;
create policy teacher_student_sessions_select_owner
on public.teacher_student_sessions for select
using (
  exists (
    select 1 from public.teacher_students ts
    where ts.id = teacher_student_sessions.teacher_student_id
      and ts.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_student_sessions_insert_owner on public.teacher_student_sessions;
create policy teacher_student_sessions_insert_owner
on public.teacher_student_sessions for insert
with check (
  exists (
    select 1 from public.teacher_students ts
    where ts.id = teacher_student_sessions.teacher_student_id
      and ts.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_student_sessions_update_owner on public.teacher_student_sessions;
create policy teacher_student_sessions_update_owner
on public.teacher_student_sessions for update
using (
  exists (
    select 1 from public.teacher_students ts
    where ts.id = teacher_student_sessions.teacher_student_id
      and ts.teacher_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.teacher_students ts
    where ts.id = teacher_student_sessions.teacher_student_id
      and ts.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_student_sessions_delete_owner on public.teacher_student_sessions;
create policy teacher_student_sessions_delete_owner
on public.teacher_student_sessions for delete
using (
  exists (
    select 1 from public.teacher_students ts
    where ts.id = teacher_student_sessions.teacher_student_id
      and ts.teacher_user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- teacher_class_confirmations
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_class_confirmations (
  id                        uuid primary key default gen_random_uuid(),
  teacher_user_id           uuid not null references public.profiles(user_id) on delete cascade,
  student_user_id           uuid not null references public.profiles(user_id) on delete cascade,
  teacher_student_id        uuid null references public.teacher_students(id) on delete set null,
  service_type              text not null default 'private_class',
  title                     text not null default 'Private class',
  class_date                date not null,
  start_time                time not null,
  duration_min              int null,
  city                      text null,
  venue_name                text null,
  studio_included           boolean not null default false,
  teacher_note              text null,
  cancellation_policy_text  text null,
  status                    text not null default 'pending_confirmation'
    constraint teacher_class_confirmations_status_chk check (
      status in ('pending_confirmation', 'confirmed', 'declined', 'cancelled', 'completed')
    ),
  thread_id                 uuid null references public.threads(id) on delete set null,
  confirmed_at              timestamptz null,
  declined_at               timestamptz null,
  cancelled_at              timestamptz null,
  completed_at              timestamptz null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint distinct_teacher_student check (teacher_user_id <> student_user_id)
);

create index if not exists idx_teacher_class_confirmations_teacher_user_id
  on public.teacher_class_confirmations(teacher_user_id);
create index if not exists idx_teacher_class_confirmations_student_user_id
  on public.teacher_class_confirmations(student_user_id);
create index if not exists idx_teacher_class_confirmations_thread_id
  on public.teacher_class_confirmations(thread_id);

drop trigger if exists trg_teacher_class_confirmations_set_updated_at on public.teacher_class_confirmations;
create trigger trg_teacher_class_confirmations_set_updated_at
before update on public.teacher_class_confirmations
for each row execute function public.set_updated_at_ts();

alter table public.teacher_class_confirmations enable row level security;

drop policy if exists teacher_class_confirmations_select_participants on public.teacher_class_confirmations;
create policy teacher_class_confirmations_select_participants
on public.teacher_class_confirmations for select
using (auth.uid() = teacher_user_id or auth.uid() = student_user_id);

drop policy if exists teacher_class_confirmations_insert_teacher on public.teacher_class_confirmations;
create policy teacher_class_confirmations_insert_teacher
on public.teacher_class_confirmations for insert
with check (auth.uid() = teacher_user_id);

drop policy if exists teacher_class_confirmations_update_teacher on public.teacher_class_confirmations;
create policy teacher_class_confirmations_update_teacher
on public.teacher_class_confirmations for update
using (auth.uid() = teacher_user_id)
with check (auth.uid() = teacher_user_id);

drop policy if exists teacher_class_confirmations_delete_teacher on public.teacher_class_confirmations;
create policy teacher_class_confirmations_delete_teacher
on public.teacher_class_confirmations for delete
using (auth.uid() = teacher_user_id);

-- ---------------------------------------------------------------------------
-- teacher_class_reminders
-- ---------------------------------------------------------------------------

create table if not exists public.teacher_class_reminders (
  id                      uuid primary key default gen_random_uuid(),
  class_confirmation_id   uuid not null references public.teacher_class_confirmations(id) on delete cascade,
  channel                 text not null default 'email'
    constraint teacher_class_reminders_channel_chk check (channel in ('email')),
  send_at                 timestamptz not null,
  status                  text not null default 'pending'
    constraint teacher_class_reminders_status_chk check (status in ('pending', 'sent', 'failed')),
  reminder_type           text not null
    constraint teacher_class_reminders_reminder_type_chk check (
      reminder_type in ('confirmation_requested', 'confirmed_24h', 'confirmed_2h')
    ),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_teacher_class_reminders_class_confirmation_id
  on public.teacher_class_reminders(class_confirmation_id);
create index if not exists idx_teacher_class_reminders_send_at_status
  on public.teacher_class_reminders(send_at, status);

drop trigger if exists trg_teacher_class_reminders_set_updated_at on public.teacher_class_reminders;
create trigger trg_teacher_class_reminders_set_updated_at
before update on public.teacher_class_reminders
for each row execute function public.set_updated_at_ts();

alter table public.teacher_class_reminders enable row level security;

drop policy if exists teacher_class_reminders_select_owner on public.teacher_class_reminders;
create policy teacher_class_reminders_select_owner
on public.teacher_class_reminders for select
using (
  exists (
    select 1 from public.teacher_class_confirmations tcc
    where tcc.id = teacher_class_reminders.class_confirmation_id
      and tcc.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_class_reminders_insert_owner on public.teacher_class_reminders;
create policy teacher_class_reminders_insert_owner
on public.teacher_class_reminders for insert
with check (
  exists (
    select 1 from public.teacher_class_confirmations tcc
    where tcc.id = teacher_class_reminders.class_confirmation_id
      and tcc.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_class_reminders_update_owner on public.teacher_class_reminders;
create policy teacher_class_reminders_update_owner
on public.teacher_class_reminders for update
using (
  exists (
    select 1 from public.teacher_class_confirmations tcc
    where tcc.id = teacher_class_reminders.class_confirmation_id
      and tcc.teacher_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.teacher_class_confirmations tcc
    where tcc.id = teacher_class_reminders.class_confirmation_id
      and tcc.teacher_user_id = auth.uid()
  )
);

drop policy if exists teacher_class_reminders_delete_owner on public.teacher_class_reminders;
create policy teacher_class_reminders_delete_owner
on public.teacher_class_reminders for delete
using (
  exists (
    select 1 from public.teacher_class_confirmations tcc
    where tcc.id = teacher_class_reminders.class_confirmation_id
      and tcc.teacher_user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- helper function: teacher_profile_is_active
-- ---------------------------------------------------------------------------

create or replace function public.teacher_profile_is_active(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = p_user_id
      and tp.teacher_profile_enabled = true
      and tp.is_public = true
      and (
        tp.teacher_profile_trial_ends_at is null
        or tp.teacher_profile_trial_ends_at > now()
        or exists (
          select 1 from public.profiles p
          where p.user_id = tp.user_id
            and p.roles @> array['verified']
        )
      )
  )
$$;

grant execute on function public.teacher_profile_is_active(uuid) to authenticated, anon;

commit;
