select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;

select
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
left join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'profiles'
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

select
  tg.tgname as trigger_name,
  pg_get_triggerdef(tg.oid) as trigger_def
from pg_trigger tg
join pg_class tbl on tbl.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = tbl.relnamespace
where nsp.nspname = 'auth'
  and tbl.relname = 'users'
  and not tg.tgisinternal
order by tg.tgname;
