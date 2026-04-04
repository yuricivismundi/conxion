begin;

with expanded as (
  select
    p.user_id,
    case lower(btrim(value))
      when 'dance at local socials and events' then 'Social dancing'
      when 'social dance party' then 'Social dancing'
      when 'find practice partners' then 'Practice partner'
      when 'practice / dance partner' then 'Practice partner'
      when 'festival travel buddy' then 'Festival buddy'
      when 'find buddies for workshops, socials, accommodations, or rides' then 'Travel / hosting buddy'
      when 'get tips on the local dance scene' then 'Local recommendations'
      when 'collaborate on video projects' then 'Content collaboration'
      when 'video collabs' then 'Content collaboration'
      when 'feature in promo videos/socials' then 'Content collaboration'
      when 'collaborate on tracks or live sets' then 'Content collaboration'
      when 'private lessons' then 'Private lessons'
      when 'offer private/group lessons' then 'Private lessons'
      when 'group lessons' then 'Group classes'
      when 'teach regular classes' then 'Group classes'
      when 'lead festival workshops' then 'Group classes'
      when 'co-teach sessions' then 'Group classes'
      when 'collaborate with artists/teachers for events/festivals' then 'Event / booking collaboration'
      when 'organize recurring local events' then 'Event / booking collaboration'
      when 'secure sponsorships and org collabs' then 'Event / booking collaboration'
      when 'offer volunteer roles for events' then 'Event / booking collaboration'
      when 'recruit guest dancers' then 'Event / booking collaboration'
      when 'promote special workshops and events' then 'Event / booking collaboration'
      when 'organize classes and schedules' then 'Event / booking collaboration'
      when 'collaborate with other studio owners' then 'Event / booking collaboration'
      when 'secure sponsorships and hire talent' then 'Event / booking collaboration'
      when 'partner to promote festivals' then 'Event / booking collaboration'
      when 'refer artists, djs, and teachers' then 'Event / booking collaboration'
      when 'co-promote local parties/socials' then 'Event / booking collaboration'
      when 'exchange guest lists and shoutouts' then 'Event / booking collaboration'
      when 'share promo materials and audiences' then 'Event / booking collaboration'
      when 'produce new songs and tracks' then 'Event / booking collaboration'
      when 'network for festival gigs' then 'Event / booking collaboration'
      when 'dj international and local events' then 'Event / booking collaboration'
      when 'exchange tips, curricula, and student referrals' then 'Event / booking collaboration'
      else nullif(btrim(value), '')
    end as normalized
  from profiles p
  left join lateral unnest(coalesce(p.interests, '{}'::text[])) as value on true
),
deduped as (
  select distinct on (user_id, normalized)
    user_id,
    normalized
  from expanded
  where normalized is not null
)
update profiles p
set interests = coalesce(
  (
    select array_agg(d.normalized order by
      case d.normalized
        when 'Social dancing' then 1
        when 'Practice partner' then 2
        when 'Festival buddy' then 3
        when 'Travel / hosting buddy' then 4
        when 'Private lessons' then 5
        when 'Group classes' then 6
        when 'Local recommendations' then 7
        when 'Content collaboration' then 8
        when 'Event / booking collaboration' then 9
        else 999
      end,
      d.normalized
    )
    from deduped d
    where d.user_id = p.user_id
  ),
  '{}'::text[]
)
where p.interests is not null;

commit;
