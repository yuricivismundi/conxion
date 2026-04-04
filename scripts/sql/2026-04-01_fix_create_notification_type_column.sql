-- Fix: create_notification inserts into notifications without the required `type` column,
-- causing "null value in column "type" violates not-null constraint" on every notification.
-- Solution: replace the function to include type = p_kind in the INSERT.

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL::text,
  p_link_url text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  if p_user_id is null then
    raise exception 'notification_user_id_required';
  end if;

  if trim(coalesce(p_kind, '')) = '' then
    raise exception 'notification_kind_required';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'notification_title_required';
  end if;

  insert into public.notifications (
    user_id,
    actor_id,
    type,
    kind,
    title,
    body,
    link_url,
    metadata
  )
  values (
    p_user_id,
    auth.uid(),
    trim(p_kind),
    trim(p_kind),
    trim(p_title),
    nullif(trim(coalesce(p_body, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;
