-- Seed 5 sample incoming references for user 5fd75dd8-1893-4eb4-a8cc-6f026fd10d02.
-- Date: 2026-03-22
-- Notes:
-- - insert-only for missing author -> recipient -> context_tag pairs
-- - uses distinct peers from profiles
-- - safe with one-reference-per-pair-per-type rule

begin;

create extension if not exists pgcrypto;

do $$
declare
  v_target uuid := '5fd75dd8-1893-4eb4-a8cc-6f026fd10d02'::uuid;
  v_contexts text[] := array[
    'event',
    'travel_together',
    'hosting',
    'practice',
    'collaboration'
  ];
  v_sentiments text[] := array[
    'positive',
    'positive',
    'positive',
    'neutral',
    'positive'
  ];
  v_bodies text[] := array[
    'Excellent event partner. Clear communication, easy coordination, and a very grounded presence during the whole weekend.',
    'Traveling together was smooth from start to finish. Good planning, reliable timing, and great energy during the trip.',
    'A respectful guest and very easy to host. Communication was clear and the whole stay felt comfortable and well organized.',
    'Solid practice partner. There was a small delay in confirming details, but once the session started everything went well.',
    'Strong collaborator on creative work. Easy to align on ideas, responsive on details, and dependable when deadlines mattered.'
  ];
  v_replies text[] := array[
    null,
    'Appreciate this a lot. That weekend was easy to coordinate and I would happily work together again.',
    'Thank you. I also felt the stay was smooth and respectful all around.',
    null,
    null
  ];
  v_inserted int := 0;
  v_ctx text;
  v_peer record;
  v_created_at timestamptz;
begin
  if not exists (select 1 from public.profiles p where p.user_id = v_target) then
    raise exception 'target profile % not found', v_target;
  end if;

  for v_peer in
    with ranked_connections as (
      select
        case
          when c.requester_id = v_target then c.target_id
          else c.requester_id
        end as peer_user_id,
        c.id as connection_id,
        row_number() over (
          partition by case
            when c.requester_id = v_target then c.target_id
            else c.requester_id
          end
          order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
        ) as rn
      from public.connections c
      where (c.requester_id = v_target or c.target_id = v_target)
        and coalesce(c.status::text, '') = 'accepted'
        and c.blocked_by is null
    )
    select rc.peer_user_id as user_id, rc.connection_id
    from ranked_connections rc
    where rc.rn = 1
    order by rc.connection_id desc
    limit 100
  loop
    exit when v_inserted >= array_length(v_contexts, 1);

    v_ctx := v_contexts[v_inserted + 1];

    if exists (
      select 1
      from public.references r
      where coalesce(r.author_id, r.from_user_id) = v_peer.user_id
        and coalesce(r.recipient_id, r.to_user_id) = v_target
        and coalesce(r.context_tag, r.context, r.entity_type) = v_ctx
    ) then
      continue;
    end if;

    v_created_at := now() - make_interval(days => (10 - v_inserted));

    insert into public.references (
      connection_id,
      author_id,
      recipient_id,
      from_user_id,
      to_user_id,
      context,
      context_tag,
      entity_type,
      entity_id,
      sentiment,
      rating,
      body,
      text,
      reply_text,
      created_at,
      updated_at
    ) values (
      v_peer.connection_id,
      v_peer.user_id,
      v_target,
      v_peer.user_id,
      v_target,
      case
        when v_ctx in ('event', 'festival', 'competition', 'social_dance') then 'event'
        when v_ctx in ('travel_together', 'hosting', 'stay_as_guest') then 'trip'
        when v_ctx in ('practice', 'private_class', 'group_class', 'workshop') then 'practice'
        else 'collaboration'
      end,
      v_ctx,
      case
        when v_ctx in ('event', 'festival', 'competition', 'social_dance') then 'event'
        when v_ctx in ('travel_together', 'hosting', 'stay_as_guest') then 'trip'
        when v_ctx in ('practice', 'private_class', 'group_class', 'workshop') then 'sync'
        else 'connection'
      end,
      gen_random_uuid(),
      v_sentiments[v_inserted + 1],
      case
        when v_sentiments[v_inserted + 1] = 'positive' then 5
        when v_sentiments[v_inserted + 1] = 'neutral' then 3
        else 1
      end,
      v_bodies[v_inserted + 1],
      v_bodies[v_inserted + 1],
      v_replies[v_inserted + 1],
      v_created_at,
      v_created_at
    );

    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted < 5 then
    raise exception 'only inserted % of 5 references for target %', v_inserted, v_target;
  end if;

  raise notice 'inserted % sample references for %', v_inserted, v_target;
end
$$;

commit;
