-- ConXion Dance Space: move detail MVP refinement
-- Date: 2026-03-04
-- Safe to run multiple times.
-- Adds: difficulty/type enums, practice counters, structured notes, reference URL,
-- limits (200 total, 20 practicing), practice logs table, and log_dance_move_practice RPC.

begin;

do $$
begin
  if to_regclass('public.dance_moves_user') is null then
    raise exception 'Missing table public.dance_moves_user. Run scripts/sql/2026-03-02_dance_space_growth.sql first.';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'dance_move_difficulty') then
    create type public.dance_move_difficulty as enum ('easy', 'medium', 'hard');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'dance_move_type') then
    create type public.dance_move_type as enum ('footwork', 'partnerwork', 'turn-pattern', 'styling', 'musicality', 'other');
  end if;
end $$;

alter table public.dance_moves_user add column if not exists difficulty public.dance_move_difficulty;
alter table public.dance_moves_user add column if not exists move_type public.dance_move_type;
alter table public.dance_moves_user add column if not exists practice_count integer;
alter table public.dance_moves_user add column if not exists started_practicing_at timestamptz;
alter table public.dance_moves_user add column if not exists last_practiced_at timestamptz;
alter table public.dance_moves_user add column if not exists reference_url text;
alter table public.dance_moves_user add column if not exists key_cue text;
alter table public.dance_moves_user add column if not exists common_mistake text;
alter table public.dance_moves_user add column if not exists fix_tip text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dance_moves_user'
      and column_name = 'difficulty'
      and udt_name <> 'dance_move_difficulty'
  ) then
    alter table public.dance_moves_user
      alter column difficulty type public.dance_move_difficulty
      using (
        case
          when lower(coalesce(difficulty::text, '')) in ('easy', 'hard') then lower(difficulty::text)::public.dance_move_difficulty
          else 'medium'::public.dance_move_difficulty
        end
      );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dance_moves_user'
      and column_name = 'move_type'
      and udt_name <> 'dance_move_type'
  ) then
    alter table public.dance_moves_user
      alter column move_type type public.dance_move_type
      using (
        case
          when lower(coalesce(move_type::text, '')) in ('footwork', 'partnerwork', 'turn-pattern', 'styling', 'musicality')
            then lower(move_type::text)::public.dance_move_type
          else 'other'::public.dance_move_type
        end
      );
  end if;
end $$;

update public.dance_moves_user set difficulty = 'medium' where difficulty is null;
update public.dance_moves_user set move_type = 'other' where move_type is null;
update public.dance_moves_user set practice_count = 0 where practice_count is null or practice_count < 0;
update public.dance_moves_user
set started_practicing_at = coalesce(started_practicing_at, updated_at, created_at)
where status in ('practicing', 'learned')
  and started_practicing_at is null;

alter table public.dance_moves_user alter column difficulty set not null;
alter table public.dance_moves_user alter column difficulty set default 'medium';
alter table public.dance_moves_user alter column move_type set not null;
alter table public.dance_moves_user alter column move_type set default 'other';
alter table public.dance_moves_user alter column practice_count set not null;
alter table public.dance_moves_user alter column practice_count set default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_practice_count_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_practice_count_chk
      check (practice_count >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_single_style_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_single_style_chk
      check (style !~ '[,;/|]');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_note_len_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_note_len_chk
      check (note is null or char_length(note) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_key_cue_len_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_key_cue_len_chk
      check (key_cue is null or char_length(key_cue) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_common_mistake_len_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_common_mistake_len_chk
      check (common_mistake is null or char_length(common_mistake) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_fix_tip_len_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_fix_tip_len_chk
      check (fix_tip is null or char_length(fix_tip) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dance_moves_user_reference_url_chk'
      and conrelid = 'public.dance_moves_user'::regclass
  ) then
    alter table public.dance_moves_user
      add constraint dance_moves_user_reference_url_chk
      check (reference_url is null or reference_url ~* '^https?://');
  end if;
end $$;

create index if not exists idx_dance_moves_user_user_practice
  on public.dance_moves_user(user_id, practice_count desc, updated_at desc);

create or replace function public.enforce_dance_moves_user_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_practicing integer;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id_cannot_be_changed';
  end if;

  select count(*)
  into v_total
  from public.dance_moves_user m
  where m.user_id = new.user_id
    and (tg_op <> 'UPDATE' or m.id <> new.id);

  if v_total >= 200 then
    raise exception 'max_moves_per_user_exceeded';
  end if;

  if new.status = 'practicing' then
    select count(*)
    into v_practicing
    from public.dance_moves_user m
    where m.user_id = new.user_id
      and m.status = 'practicing'
      and (tg_op <> 'UPDATE' or m.id <> new.id);

    if v_practicing >= 20 then
      raise exception 'max_practicing_moves_exceeded';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dance_moves_user_limits on public.dance_moves_user;
create trigger trg_dance_moves_user_limits
before insert or update of user_id, status
on public.dance_moves_user
for each row
execute function public.enforce_dance_moves_user_limits();

create table if not exists public.dance_move_practice_logs (
  id uuid primary key default gen_random_uuid(),
  move_id uuid not null references public.dance_moves_user(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  confidence_after smallint,
  quick_note text,
  created_at timestamptz not null default now(),
  constraint dance_move_practice_logs_confidence_chk
    check (confidence_after is null or confidence_after between 1 and 5),
  constraint dance_move_practice_logs_note_len_chk
    check (quick_note is null or char_length(quick_note) <= 500)
);

create index if not exists idx_dance_move_practice_logs_user_move_created
  on public.dance_move_practice_logs(user_id, move_id, created_at desc);

alter table public.dance_move_practice_logs enable row level security;

drop policy if exists dance_move_practice_logs_select_own on public.dance_move_practice_logs;
create policy dance_move_practice_logs_select_own
on public.dance_move_practice_logs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists dance_move_practice_logs_insert_own on public.dance_move_practice_logs;
create policy dance_move_practice_logs_insert_own
on public.dance_move_practice_logs
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists dance_move_practice_logs_delete_own on public.dance_move_practice_logs;
create policy dance_move_practice_logs_delete_own
on public.dance_move_practice_logs
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, delete on public.dance_move_practice_logs to authenticated;

create or replace function public.log_dance_move_practice(
  p_move_id uuid,
  p_confidence_after smallint default null,
  p_quick_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_confidence_after is not null and (p_confidence_after < 1 or p_confidence_after > 5) then
    raise exception 'invalid_confidence';
  end if;

  if p_quick_note is not null and char_length(p_quick_note) > 500 then
    raise exception 'quick_note_too_long';
  end if;

  update public.dance_moves_user
  set
    practice_count = coalesce(practice_count, 0) + 1,
    last_practiced_at = now(),
    confidence = coalesce(p_confidence_after, confidence),
    updated_at = now()
  where id = p_move_id
    and user_id = v_user;

  if not found then
    raise exception 'move_not_found';
  end if;

  insert into public.dance_move_practice_logs (move_id, user_id, confidence_after, quick_note)
  values (p_move_id, v_user, p_confidence_after, nullif(trim(p_quick_note), ''));

  delete from public.dance_move_practice_logs l
  using (
    select id
    from (
      select
        id,
        row_number() over (partition by move_id, user_id order by created_at desc, id desc) as rn
      from public.dance_move_practice_logs
      where move_id = p_move_id
        and user_id = v_user
    ) ranked
    where ranked.rn > 50
  ) old_rows
  where l.id = old_rows.id;
end;
$$;

revoke all on function public.log_dance_move_practice(uuid, smallint, text) from public;
grant execute on function public.log_dance_move_practice(uuid, smallint, text) to authenticated;

commit;

notify pgrst, 'reload schema';
