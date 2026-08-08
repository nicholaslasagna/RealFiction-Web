-- READ-ONLY post-migration verification for public.announcements.
-- Safe to run in production: it only SELECTs. Every row should read PASS.

with checks as (
  select 1 as ord, 'first_published_at column exists' as check_name,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'announcements'
        and column_name = 'first_published_at'
    ) as ok,
    '' as detail

  union all
  select 2, 'discord_state accepts the retraction states',
    -- One constraint satisfying all three conditions, not three constraints.
    (select count(*) = 1 from pg_constraint
     where conrelid = 'public.announcements'::regclass
       and conname = 'announcements_discord_state_check'
       and pg_get_constraintdef(oid) like '%retract_pending%'
       and pg_get_constraintdef(oid) like '%retracted%'
       and pg_get_constraintdef(oid) like '%retract_failed%'),
    ''

  union all
  select 3, 'mirror-due index can see retract_pending',
    (select indexdef like '%retract_pending%' from pg_indexes
     where schemaname = 'public' and indexname = 'announcements_mirror_due_idx'),
    ''

  union all
  select 4, 'claim_announcement_mirrors returns operation',
    (select pg_get_function_result(p.oid) like '%operation%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_announcement_mirrors'),
    ''

  union all
  select 5, 'exactly one claim_announcement_mirrors exists',
    (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_announcement_mirrors'),
    ''

  union all
  select 6, 'all three retraction functions exist',
    (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'unpublish_announcement', 'complete_announcement_retraction',
       'confirm_announcement_discord_removed')),
    ''

  union all
  select 7, 'publish_announcement no longer references a missing column',
    (select prosrc like '%first_published_at%' from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'publish_announcement')
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'announcements'
        and column_name = 'first_published_at'),
    ''

  union all
  select 8, 'every published row has a first_published_at',
    (select count(*) = 0 from public.announcements
     where published_at is not null and first_published_at is null),
    (select coalesce(string_agg(slug, ', '), 'none missing') from public.announcements
     where published_at is not null and first_published_at is null)

  union all
  select 9, 'no first_published_at is later than its published_at',
    (select count(*) = 0 from public.announcements
     where first_published_at is not null and published_at is not null
       and first_published_at > published_at),
    ''

  union all
  select 10, 'privileged functions are service_role only',
    (select bool_and(p.proacl::text not like '%anon=%' and p.proacl::text not like '%authenticated=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'claim_announcement_mirrors', 'publish_announcement', 'unpublish_announcement',
       'complete_announcement_retraction', 'confirm_announcement_discord_removed')),
    ''

  union all
  select 11, 'privileged functions are SECURITY DEFINER with a fixed search_path',
    (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'claim_announcement_mirrors', 'unpublish_announcement',
       'complete_announcement_retraction', 'confirm_announcement_discord_removed')),
    ''

  union all
  select 12, 'no row is stuck in an unknown delivery state',
    (select count(*) = 0 from public.announcements
     where discord_state not in (
       'pending', 'delivered', 'retrying', 'failed', 'review_required', 'skipped',
       'retract_pending', 'retracted', 'retract_failed')),
    ''
)
select
  case when ok then 'PASS' else '*** FAIL ***' end as result,
  check_name,
  detail
from checks
order by ord;

-- Announcement inventory, for a human eye.
select slug, status, discord_state,
       published_at::date as published,
       first_published_at::date as first_published,
       discord_message_id is not null as has_discord_message
from public.announcements
order by coalesce(published_at, created_at) desc
limit 50;
