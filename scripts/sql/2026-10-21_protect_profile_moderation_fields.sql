-- Protect admin-moderated profile fields from self-edits.
--
-- Why: profiles_update_own lets a member update their own row, so without this
-- a member could set avatar_status = 'approved' (or verified = true) from the
-- browser and skip admin photo approval, which now gates hosting requests.
--
-- Rules for non-admin members (auth.uid() set and not an admin):
--   * verified / verified_* / organizer_verified* / is_verified /
--     verification_type can't be changed by the member.
--   * avatar_status can't be set by the member. Changing the photo
--     (avatar_path or avatar_url) resets it to 'pending' so an admin reviews it.
-- Admins (public.is_app_admin) and server code using the service role
-- (auth.uid() is null) are not affected.
--
-- Run on STAGING first, then production. Safe to re-run.

begin;

create or replace function public.protect_profile_moderation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Service role, SQL editor, cron: trusted.
  if v_uid is null then
    return new;
  end if;

  if public.is_app_admin(v_uid) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.avatar_status := 'pending';
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
    new.verified_label := null;
    new.organizer_verified := false;
    new.organizer_verified_at := null;
    new.organizer_verified_by := null;
    new.is_verified := false;
    new.verification_type := null;
    return new;
  end if;

  -- UPDATE: moderation fields stay as they were.
  new.verified := old.verified;
  new.verified_at := old.verified_at;
  new.verified_by := old.verified_by;
  new.verified_label := old.verified_label;
  new.organizer_verified := old.organizer_verified;
  new.organizer_verified_at := old.organizer_verified_at;
  new.organizer_verified_by := old.organizer_verified_by;
  new.is_verified := old.is_verified;
  new.verification_type := old.verification_type;

  -- New photo => back to the admin review queue. Otherwise keep the status.
  if new.avatar_path is distinct from old.avatar_path
     or new.avatar_url is distinct from old.avatar_url then
    new.avatar_status := 'pending';
  else
    new.avatar_status := old.avatar_status;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_protect_profile_moderation_fields on public.profiles;

create trigger trg_protect_profile_moderation_fields
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_moderation_fields();

commit;

-- ── Verify (as a normal member in the app, not in the SQL editor) ───────────
-- update profiles set avatar_status = 'approved' where user_id = auth.uid();
--   -> avatar_status stays unchanged
