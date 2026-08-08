-- Announcements: RealFiction is the source of truth, Discord is a destination.
--
-- WHY A TABLE AT ALL
-- ==================
-- `/updates` is a hardcoded TypeScript array in lib/data.ts. That is fine for a
-- historical archive somebody edits with a deploy, and it is why the existing
-- entries stay exactly where they are — but it cannot be the canonical store
-- for something staff publish, because publishing would mean a code change and
-- a deploy, and because a Discord mirror needs durable per-announcement
-- delivery state.
--
-- So this table is the canonical store for NEW announcements. It does not
-- compete with `updates`: nothing here duplicates those rows, and the feed
-- merges the two by date.
--
-- WHY DELIVERY STATE LIVES ON THE ROW, NOT IN A SECOND OUTBOX TABLE
-- =================================================================
-- The email outbox (`email_deliveries`) is genuinely a queue: one order can
-- produce several emails to several recipients, so the delivery is its own
-- entity. An announcement has exactly ONE Discord mirror. A separate table for
-- a strictly 1:1 relationship buys nothing and adds a join, so the delivery
-- columns sit on the announcement and are claimed with the same
-- `FOR UPDATE SKIP LOCKED` + lease pattern the payment and refund reconcilers
-- already use.
--
-- The SCHEDULER is reused: the existing five-minute Cron Trigger. No new cron.
--
-- THE MIRROR MODEL — POST ONCE, PATCH ON EDIT, NEVER RE-POST
-- ==========================================================
-- Discord webhooks can edit a message they created
-- (`PATCH /webhooks/{id}/{token}/messages/{message_id}`), so an edited
-- announcement updates in place rather than posting a correction. The safety
-- property is the one that matters: `discord_message_id` is set exactly once,
-- and the state machine can never move a row back to a state that POSTs again.
-- A failed PATCH goes to review; it never falls back to a second POST, because
-- a duplicate announcement in a public channel is worse than a stale one.

-- ===========================================================================
-- 1. The announcement
-- ===========================================================================

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,

  title text not null check (length(trim(title)) > 0),
  excerpt text not null default '',
  body text not null default '',
  category text not null default 'Announcement',

  -- Draft is the default. A row is invisible to the public until an explicit
  -- publish, so an accidental insert cannot become a live announcement.
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,

  -- Display attribution only. NEVER an account id: this string is rendered on
  -- a public page and mirrored to Discord.
  author_display text,
  image_url text,

  -- Whether this one should reach Discord at all. Staff may want a web-only note.
  mirror_to_discord boolean not null default true,

  -- Delivery state.
  --   pending          not yet attempted (or an edit needs mirroring)
  --   delivered        Discord holds a message matching content_hash
  --   retrying         attempted, failed transiently, will try again
  --   failed           attempts exhausted; a human decides
  --   review_required  we cannot safely proceed (e.g. an edit whose PATCH fails)
  --   skipped          mirroring disabled or no webhook configured
  discord_state text not null default 'pending' check (discord_state in (
    'pending', 'delivered', 'retrying', 'failed', 'review_required', 'skipped'
  )),
  -- Set EXACTLY once, by the first successful POST. Its presence is what makes
  -- every later delivery an edit rather than a new post.
  discord_message_id text,
  discord_attempts integer not null default 0,
  discord_next_attempt_at timestamptz,
  discord_lease_until timestamptz,
  discord_worker text,
  discord_last_error text,
  -- Hash of the mirrored fields. A publish whose hash already matches
  -- `discord_delivered_hash` is a no-op, which is what makes retries and
  -- repeated publishes idempotent.
  discord_delivered_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A published announcement must have a timestamp; a draft must not pretend to.
  constraint announcements_published_has_timestamp
    check (status <> 'published' or published_at is not null)
);

create index if not exists announcements_public_idx
on public.announcements(published_at desc)
where status = 'published';

create index if not exists announcements_mirror_due_idx
on public.announcements(discord_next_attempt_at)
where discord_state in ('pending', 'retrying');

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. Access
-- ===========================================================================
-- The public may read PUBLISHED rows and nothing else. Drafts are staff-only,
-- and every mutation goes through the service role — there is no policy under
-- which a signed-in customer can write here.
alter table public.announcements enable row level security;

drop policy if exists announcements_public_read on public.announcements;
create policy announcements_public_read
on public.announcements for select
to anon, authenticated
using (status = 'published' and published_at <= now());

drop policy if exists announcements_staff_read on public.announcements;
create policy announcements_staff_read
on public.announcements for select
to authenticated
using (public.is_admin());

revoke insert, update, delete on public.announcements from anon, authenticated;
grant select on public.announcements to anon, authenticated;
grant all on public.announcements to service_role;

-- ===========================================================================
-- 3. Publishing
-- ===========================================================================

/**
 * THE authoritative publish operation.
 *
 * Persists first and returns. It does NOT talk to Discord: the mirror is
 * claimed by the scheduled worker afterwards, so a Discord outage can never
 * fail or roll back a website publication. That separation is the whole point
 * of the design — there is no distributed transaction here, just a row and a
 * job that catches up.
 *
 * Idempotent on `p_slug`. Publishing the same content twice changes nothing;
 * publishing CHANGED content re-arms the mirror so the Discord message is
 * edited to match.
 */
create or replace function public.publish_announcement(
  p_slug text,
  p_title text,
  p_excerpt text,
  p_body text,
  p_category text default 'Announcement',
  p_author_display text default null,
  p_image_url text default null,
  p_mirror_to_discord boolean default true,
  p_publish boolean default true
)
returns table(id uuid, slug text, status text, discord_state text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
  v_hash text;
  v_changed boolean := false;
begin
  if coalesce(trim(p_slug), '') = '' or coalesce(trim(p_title), '') = '' then
    raise exception 'announcement requires a slug and a title';
  end if;

  -- Only the MIRRORED fields feed the hash. Editing something Discord never
  -- shows must not cause a Discord edit.
  v_hash := encode(extensions.digest(
    coalesce(p_title, '') || chr(31) || coalesce(p_excerpt, '') || chr(31) ||
    coalesce(p_category, '') || chr(31) || coalesce(p_image_url, ''), 'sha256'), 'hex');

  select * into v_row from public.announcements a where a.slug = p_slug for update;

  if not found then
    insert into public.announcements (
      slug, title, excerpt, body, category, author_display, image_url,
      mirror_to_discord, status, published_at
    )
    values (
      p_slug, p_title, coalesce(p_excerpt, ''), coalesce(p_body, ''),
      coalesce(p_category, 'Announcement'), p_author_display, p_image_url,
      coalesce(p_mirror_to_discord, true),
      case when p_publish then 'published' else 'draft' end,
      case when p_publish then now() else null end
    )
    returning * into v_row;
    v_changed := true;
  else
    -- An already-delivered announcement whose mirrored content is unchanged is
    -- left completely alone: no state reset, no re-attempt, no duplicate.
    v_changed := (
      v_row.title is distinct from p_title
      or v_row.excerpt is distinct from coalesce(p_excerpt, '')
      or v_row.body is distinct from coalesce(p_body, '')
      or v_row.category is distinct from coalesce(p_category, 'Announcement')
      or v_row.image_url is distinct from p_image_url
      or (p_publish and v_row.status <> 'published')
    );

    update public.announcements a
    set title = p_title,
        excerpt = coalesce(p_excerpt, ''),
        body = coalesce(p_body, ''),
        category = coalesce(p_category, 'Announcement'),
        author_display = coalesce(p_author_display, a.author_display),
        image_url = p_image_url,
        mirror_to_discord = coalesce(p_mirror_to_discord, a.mirror_to_discord),
        status = case when p_publish then 'published' else a.status end,
        published_at = case
          when p_publish then coalesce(a.published_at, now())
          else a.published_at
        end
    where a.id = v_row.id
    returning * into v_row;
  end if;

  -- Re-arm the mirror only when the mirrored content actually differs from
  -- what Discord already holds. This is the idempotency guarantee: a repeated
  -- publish of identical content leaves `delivered` untouched.
  if v_row.status = 'published'
     and v_row.mirror_to_discord
     and coalesce(v_row.discord_delivered_hash, '') is distinct from v_hash
     and v_row.discord_state <> 'review_required'
  then
    update public.announcements a
    set discord_state = 'pending',
        discord_next_attempt_at = now(),
        discord_attempts = 0,
        discord_lease_until = null,
        discord_last_error = null
    where a.id = v_row.id
    returning * into v_row;
  elsif not v_row.mirror_to_discord and v_row.discord_state = 'pending' then
    update public.announcements a
    set discord_state = 'skipped'
    where a.id = v_row.id
    returning * into v_row;
  end if;

  id := v_row.id; slug := v_row.slug; status := v_row.status;
  discord_state := v_row.discord_state; changed := v_changed;
  return next;
end;
$$;

revoke all on function public.publish_announcement(text, text, text, text, text, text, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.publish_announcement(text, text, text, text, text, text, text, boolean, boolean)
to service_role;

-- ===========================================================================
-- 4. Reading
-- ===========================================================================

/** The newest published announcement. Drafts and future-dated rows excluded. */
create or replace function public.latest_announcement()
returns table(
  id uuid, slug text, title text, excerpt text, category text,
  published_at timestamptz, author_display text, image_url text,
  mirrored boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.slug, a.title, a.excerpt, a.category, a.published_at,
         a.author_display, a.image_url, (a.discord_state = 'delivered')
  from public.announcements a
  where a.status = 'published' and a.published_at <= now()
  order by a.published_at desc, a.created_at desc
  limit 1;
$$;

revoke all on function public.latest_announcement() from public, anon;
grant execute on function public.latest_announcement() to authenticated, service_role;

/** Published announcements, newest first, for the /updates archive. */
create or replace function public.published_announcements(p_limit integer default 50)
returns table(
  id uuid, slug text, title text, excerpt text, body text, category text,
  published_at timestamptz, author_display text, image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.slug, a.title, a.excerpt, a.body, a.category,
         a.published_at, a.author_display, a.image_url
  from public.announcements a
  where a.status = 'published' and a.published_at <= now()
  order by a.published_at desc, a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.published_announcements(integer) from public, anon;
grant execute on function public.published_announcements(integer) to authenticated, service_role;

-- ===========================================================================
-- 5. The mirror job
-- ===========================================================================

/**
 * Claims announcements whose Discord mirror is due.
 *
 * Same lease discipline as the payment and refund reconcilers: a bounded batch,
 * `for update skip locked`, and a lease so two Workers cannot post the same
 * announcement twice.
 */
create or replace function public.claim_announcement_mirrors(
  p_worker text,
  p_limit integer default 5,
  p_lease_seconds integer default 120,
  p_max_attempts integer default 6
)
returns table(
  id uuid, slug text, title text, excerpt text, category text,
  published_at timestamptz, author_display text, image_url text,
  discord_message_id text, attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_worker text := left(coalesce(p_worker, 'unknown'), 120);
begin
  with due as (
    select a.id
    from public.announcements a
    where a.status = 'published'
      and a.mirror_to_discord
      and a.discord_state in ('pending', 'retrying')
      and a.discord_attempts < greatest(1, coalesce(p_max_attempts, 6))
      and coalesce(a.discord_next_attempt_at, '-infinity'::timestamptz) <= now()
      and coalesce(a.discord_lease_until, '-infinity'::timestamptz) <= now()
    order by a.published_at
    limit greatest(1, least(coalesce(p_limit, 5), 25))
    for update of a skip locked
  ),
  claimed as (
    update public.announcements a
    set discord_lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        discord_worker = v_worker,
        discord_attempts = a.discord_attempts + 1
    from due
    where a.id = due.id
    returning a.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  return query
  select a.id, a.slug, a.title, a.excerpt, a.category, a.published_at,
         a.author_display, a.image_url, a.discord_message_id, a.discord_attempts
  from public.announcements a
  where a.id = any(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.claim_announcement_mirrors(text, integer, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_announcement_mirrors(text, integer, integer, integer) to service_role;

/**
 * Records the outcome of one mirror attempt.
 *
 * `p_message_id` is accepted ONLY when the row does not already have one.
 * Discord assigns a message id once; letting a later call overwrite it would
 * orphan the original message and make the next edit post a duplicate.
 */
create or replace function public.finish_announcement_mirror(
  p_id uuid,
  p_outcome text,
  p_message_id text default null,
  p_content_hash text default null,
  p_error text default null,
  p_max_attempts integer default 6
)
returns table(outcome text, state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
  v_backoff integer;
begin
  select * into v_row from public.announcements a where a.id = p_id for update;
  if not found then
    outcome := 'not_found'; state := null; return next; return;
  end if;

  if p_outcome = 'delivered' then
    update public.announcements a
    set discord_state = 'delivered',
        -- Set once. `coalesce` keeps the FIRST id for the lifetime of the row.
        discord_message_id = coalesce(a.discord_message_id, p_message_id),
        discord_delivered_hash = coalesce(p_content_hash, a.discord_delivered_hash),
        discord_lease_until = null,
        discord_worker = null,
        discord_next_attempt_at = null,
        discord_last_error = null
    where a.id = p_id;
    outcome := 'delivered'; state := 'delivered'; return next; return;
  end if;

  if p_outcome = 'review' or v_row.discord_attempts >= greatest(1, coalesce(p_max_attempts, 6)) then
    -- A human owns it. Never re-POSTs: an announcement stuck here keeps its
    -- message id, so nothing can decide to publish a second copy.
    update public.announcements a
    set discord_state = case when p_outcome = 'review' then 'review_required' else 'failed' end,
        discord_lease_until = null,
        discord_worker = null,
        discord_next_attempt_at = null,
        discord_last_error = left(coalesce(p_error, p_outcome), 200)
    where a.id = p_id;
    outcome := 'stopped';
    state := case when p_outcome = 'review' then 'review_required' else 'failed' end;
    return next; return;
  end if;

  -- 1, 2, 4, 8, 16 minutes, capped at 30.
  v_backoff := least(1800, 60 * power(2, least(greatest(v_row.discord_attempts - 1, 0), 5))::integer);

  update public.announcements a
  set discord_state = 'retrying',
      discord_lease_until = null,
      discord_worker = null,
      discord_next_attempt_at = now() + make_interval(secs => v_backoff),
      discord_last_error = left(coalesce(p_error, 'retry'), 200)
  where a.id = p_id;

  outcome := 'retry'; state := 'retrying'; return next;
end;
$$;

revoke all on function public.finish_announcement_mirror(uuid, text, text, text, text, integer)
from public, anon, authenticated;
grant execute on function public.finish_announcement_mirror(uuid, text, text, text, text, integer) to service_role;
