create table if not exists public.teacher_session_availability (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(user_id) on delete cascade,
  availability_date date not null,
  start_time time not null,
  end_time time not null,
  is_available boolean not null default true,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_session_availability_time_chk check (start_time < end_time)
);

create index if not exists idx_teacher_session_availability_teacher_date
  on public.teacher_session_availability(teacher_id, availability_date, start_time);

create unique index if not exists ux_teacher_session_availability_teacher_slot
  on public.teacher_session_availability(teacher_id, availability_date, start_time, end_time);

drop trigger if exists trg_teacher_session_availability_set_updated_at on public.teacher_session_availability;
create trigger trg_teacher_session_availability_set_updated_at
before update on public.teacher_session_availability
for each row execute function public.set_updated_at_ts();

alter table public.teacher_session_availability enable row level security;

drop policy if exists teacher_session_availability_select on public.teacher_session_availability;
create policy teacher_session_availability_select
on public.teacher_session_availability for select
using (
  auth.uid() = teacher_id
  or exists (
    select 1 from public.teacher_profiles tp
    where tp.user_id = teacher_session_availability.teacher_id
      and tp.is_public = true
  )
);

drop policy if exists teacher_session_availability_insert_owner on public.teacher_session_availability;
create policy teacher_session_availability_insert_owner
on public.teacher_session_availability for insert
with check (
  auth.uid() = teacher_id
  and availability_date >= current_date
  and availability_date <= current_date + interval '3 months'
);

drop policy if exists teacher_session_availability_update_owner on public.teacher_session_availability;
create policy teacher_session_availability_update_owner
on public.teacher_session_availability for update
using (auth.uid() = teacher_id)
with check (
  auth.uid() = teacher_id
  and availability_date >= current_date
  and availability_date <= current_date + interval '3 months'
);

drop policy if exists teacher_session_availability_delete_owner on public.teacher_session_availability;
create policy teacher_session_availability_delete_owner
on public.teacher_session_availability for delete
using (auth.uid() = teacher_id);

create table if not exists public.teacher_session_bookings (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(user_id) on delete cascade,
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  availability_id uuid null references public.teacher_session_availability(id) on delete set null,
  service_type text not null default 'private_class'
    constraint teacher_session_bookings_service_type_chk check (service_type in ('private_class')),
  session_date date not null,
  session_time time not null,
  duration_min int null
    constraint teacher_session_bookings_duration_chk check (duration_min is null or duration_min > 0),
  note text null,
  status text not null default 'pending'
    constraint teacher_session_bookings_status_chk check (status in ('pending', 'accepted', 'declined')),
  accepted_at timestamptz null,
  declined_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_session_bookings_not_self_chk check (teacher_id <> student_id)
);

create index if not exists idx_teacher_session_bookings_teacher
  on public.teacher_session_bookings(teacher_id, session_date desc, session_time asc);

create index if not exists idx_teacher_session_bookings_student
  on public.teacher_session_bookings(student_id, created_at desc);

create unique index if not exists ux_teacher_session_bookings_one_accepted_slot
  on public.teacher_session_bookings(teacher_id, session_date, session_time)
  where status = 'accepted';

drop trigger if exists trg_teacher_session_bookings_set_updated_at on public.teacher_session_bookings;
create trigger trg_teacher_session_bookings_set_updated_at
before update on public.teacher_session_bookings
for each row execute function public.set_updated_at_ts();

alter table public.teacher_session_bookings enable row level security;

drop policy if exists teacher_session_bookings_select_owner on public.teacher_session_bookings;
create policy teacher_session_bookings_select_owner
on public.teacher_session_bookings for select
using (auth.uid() = teacher_id or auth.uid() = student_id);

drop policy if exists teacher_session_bookings_insert_student on public.teacher_session_bookings;
create policy teacher_session_bookings_insert_student
on public.teacher_session_bookings for insert
with check (
  auth.uid() = student_id
  and student_id <> teacher_id
  and session_date >= current_date
  and session_date <= current_date + interval '3 months'
  and status = 'pending'
);

drop policy if exists teacher_session_bookings_update_teacher on public.teacher_session_bookings;
create policy teacher_session_bookings_update_teacher
on public.teacher_session_bookings for update
using (auth.uid() = teacher_id)
with check (auth.uid() = teacher_id);
