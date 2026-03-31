begin;

create or replace function public.create_report(
  p_connection_id uuid default null,
  p_target_user_id uuid default null,
  p_context text default 'connection',
  p_context_id text default null,
  p_reason text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_report_id uuid;
  v_context_id uuid := null;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if to_regclass('public.reports') is null then
    raise exception 'reports_table_missing';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'report_reason_required';
  end if;

  if p_target_user_id is not null then
    v_target := p_target_user_id;
  elsif p_connection_id is not null then
    select case when c.requester_id = v_me then c.target_id else c.requester_id end
      into v_target
    from public.connections c
    where c.id = p_connection_id
      and (c.requester_id = v_me or c.target_id = v_me)
    limit 1;
  else
    raise exception 'missing_target';
  end if;

  if v_target is null then
    raise exception 'target_not_found_or_not_allowed';
  end if;

  if v_target = v_me then
    raise exception 'cannot_report_self';
  end if;

  if p_context_id is not null and trim(p_context_id) <> '' then
    begin
      v_context_id := trim(p_context_id)::uuid;
    exception
      when invalid_text_representation then
        v_context_id := null;
    end;
  elsif p_connection_id is not null then
    v_context_id := p_connection_id;
  end if;

  insert into public.reports (
    reporter_id,
    reported_user_id,
    target_user_id,
    context,
    context_id,
    reason,
    details,
    note,
    status
  )
  values (
    v_me,
    v_target,
    v_target,
    coalesce(nullif(trim(p_context), ''), 'connection'),
    v_context_id,
    trim(p_reason),
    nullif(trim(p_note), ''),
    nullif(trim(p_note), ''),
    'open'
  )
  returning id into v_report_id;

  return v_report_id;
end;
$function$;

grant execute on function public.create_report(uuid, uuid, text, text, text, text) to authenticated;

commit;
