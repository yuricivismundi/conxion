-- Careers applications intake for /careers and /api/careers/apply

create extension if not exists pgcrypto;

create table if not exists public.careers_applications (
  id uuid primary key default gen_random_uuid(),
  role_id text not null,
  role_title text not null,
  full_name text not null,
  email text not null,
  location text null,
  linkedin_url text null,
  portfolio_url text null,
  cv_url text null,
  cv_storage_path text null,
  cv_file_name text null,
  cover_letter text not null,
  user_id uuid null references auth.users(id) on delete set null,
  ip_address text null,
  user_agent text null,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careers_applications_status_chk check (
    status in ('submitted', 'reviewing', 'interview', 'rejected', 'hired')
  ),
  constraint careers_applications_cover_letter_len_chk check (char_length(cover_letter) between 120 and 3000),
  constraint careers_applications_cv_source_chk check (
    (cv_url is not null and cv_storage_path is null)
    or (cv_url is null and cv_storage_path is not null)
  )
);

create index if not exists careers_applications_created_at_idx
  on public.careers_applications(created_at desc);

create index if not exists careers_applications_email_created_idx
  on public.careers_applications(lower(email), created_at desc);

create index if not exists careers_applications_ip_created_idx
  on public.careers_applications(ip_address, created_at desc)
  where ip_address is not null;

create index if not exists careers_applications_role_created_idx
  on public.careers_applications(role_id, created_at desc);

alter table public.careers_applications enable row level security;

-- Keep table private by default. API writes with service role.
revoke all on public.careers_applications from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'careers-cv',
  'careers-cv',
  false,
  8388608,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;
