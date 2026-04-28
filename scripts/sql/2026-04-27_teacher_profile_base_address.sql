begin;

alter table public.teacher_profiles
  add column if not exists base_address text null,
  add constraint teacher_profiles_base_address_len_chk
    check (base_address is null or char_length(btrim(base_address)) <= 240);

commit;
