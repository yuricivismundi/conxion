select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'auth'
  and table_name = 'users'
order by ordinal_position;

select
  id,
  email,
  aud,
  role,
  email_confirmed_at,
  encrypted_password is not null as has_password,
  created_at
from auth.users
order by created_at asc
limit 5;
