-- Run this only if careers_applications already exists from an earlier schema.
-- Safe/idempotent patch to align table with CV upload support + constraints.

create extension if not exists pgcrypto;

alter table if exists public.careers_applications
  add column if not exists cv_storage_path text null,
  add column if not exists cv_file_name text null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'careers_applications'
      and column_name = 'cv_url'
      and is_nullable = 'NO'
  ) then
    alter table public.careers_applications alter column cv_url drop not null;
  end if;
exception when undefined_table then
  null;
end $$;

alter table if exists public.careers_applications
  drop constraint if exists careers_applications_cv_source_chk;

alter table if exists public.careers_applications
  add constraint careers_applications_cv_source_chk check (
    (cv_url is not null and cv_storage_path is null)
    or (cv_url is null and cv_storage_path is not null)
  );

create index if not exists careers_applications_role_created_idx
  on public.careers_applications(role_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'careers-cv',
  'careers-cv',
  false,
  8388608,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

