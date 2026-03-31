alter table public.profile_media
  add column if not exists source_stream_uid text null,
  add column if not exists clip_start_sec integer null,
  add column if not exists clip_end_sec integer null;

alter table public.profile_media
  drop constraint if exists profile_media_clip_window_check;

alter table public.profile_media
  add constraint profile_media_clip_window_check
  check (
    (
      clip_start_sec is null
      and clip_end_sec is null
    )
    or (
      clip_start_sec is not null
      and clip_end_sec is not null
      and clip_start_sec >= 0
      and clip_end_sec > clip_start_sec
      and clip_end_sec - clip_start_sec <= 15
    )
  );

create index if not exists profile_media_user_source_stream_uid_idx
  on public.profile_media (user_id, source_stream_uid)
  where source_stream_uid is not null;
