begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teacher-info-assets',
  'teacher-info-assets',
  true,
  8388608,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
