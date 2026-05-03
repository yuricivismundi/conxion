begin;

alter function public.cx_can_use_profile_username(uuid, text)
  security definer;

alter function public.cx_can_use_profile_username(uuid, text)
  set search_path = public;

alter function public.cx_profiles_apply_username()
  security definer;

alter function public.cx_profiles_apply_username()
  set search_path = public;

alter function public.cx_profiles_sync_username_history()
  security definer;

alter function public.cx_profiles_sync_username_history()
  set search_path = public;

commit;

notify pgrst, 'reload schema';
