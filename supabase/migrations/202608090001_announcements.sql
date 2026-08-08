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

  -- CURRENT publication time. Drives public ordering and visibility, and is
  -- RESTAMPED when a retracted announcement is deliberately published again —
  -- otherwise a republished announcement would reappear buried under its
  -- original date, which is not what "publish this" means to the person who
  -- clicked it.
  --
  -- Editing an already-live announcement does NOT restamp it: a typo fix must
  -- not bump something back to the top of the feed.
  published_at timestamptz,

  -- The FIRST time this was ever made public. Written once and never rewritten,
  -- so retracting and republishing cannot erase the fact that it went out
  -- before — which is the question that matters if anyone later asks what was
  -- visible and when.
  --
  -- One extra column rather than overloading `published_at`, because that field
  -- cannot mean "current" and "first" at once without one of them being a lie.
  -- This is deliberately NOT an audit-log table; it is the smallest field that
  -- answers the question.
  first_published_at timestamptz,

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
  --
  -- Retraction states. An unpublish is a SEPARATE lifecycle from delivery:
  --   retract_pending  the website is already private; Discord still holds a
  --                    message that must be deleted
  --   retracted        Discord confirmed the delete. `discord_message_id` is
  --                    cleared, so a later publish POSTs a NEW message rather
  --                    than PATCHing an id we know is gone
  --   retract_failed   the delete did not succeed. The message MAY still exist,
  --                    so the id is deliberately KEPT: a later publish PATCHes
  --                    it (harmless if it exists, review_required if it does
  --                    not) instead of POSTing a duplicate
  discord_state text not null default 'pending' check (discord_state in (
    'pending', 'delivered', 'retrying', 'failed', 'review_required', 'skipped',
    'retract_pending', 'retracted', 'retract_failed'
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
where discord_state in ('pending', 'retrying', 'retract_pending');

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
      mirror_to_discord, status, published_at, first_published_at
    )
    values (
      p_slug, p_title, coalesce(p_excerpt, ''), coalesce(p_body, ''),
      coalesce(p_category, 'Announcement'), p_author_display, p_image_url,
      coalesce(p_mirror_to_discord, true),
      case when p_publish then 'published' else 'draft' end,
      case when p_publish then now() else null end,
      -- Stamped on the FIRST publish, here as well as in the update branch.
      -- Setting it only on update left every first-time publish with a null
      -- first_published_at, which is the one value this column exists to hold.
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
          -- A transition INTO published: stamp it now. Covers both the first
          -- publish and a deliberate republish after a retraction.
          when p_publish and a.status <> 'published' then now()
          -- Already live, so this is an edit. Keep the date.
          when p_publish then coalesce(a.published_at, now())
          else a.published_at
        end,
        first_published_at = case
          when p_publish then coalesce(a.first_published_at, a.published_at, now())
          else a.first_published_at
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
  discord_message_id text, attempts integer,
  -- 'mirror' (POST/PATCH) or 'retract' (DELETE). Decided HERE, under the same
  -- lock as the claim, so the worker cannot infer it from stale row state.
  operation text
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
    where (
        -- A normal mirror: the row is public and needs posting or editing.
        (a.status = 'published' and a.mirror_to_discord and a.discord_state in ('pending', 'retrying'))
        -- A RETRACTION: the row is already private on the website, and Discord
        -- still holds a message. The status filter above would never see it,
        -- which is exactly the bug that would leave a retracted announcement
        -- visible in Discord forever.
        or (a.discord_state = 'retract_pending' and a.discord_message_id is not null)
      )
      and a.discord_attempts < greatest(1, coalesce(p_max_attempts, 6))
      and coalesce(a.discord_next_attempt_at, '-infinity'::timestamptz) <= now()
      and coalesce(a.discord_lease_until, '-infinity'::timestamptz) <= now()
    -- Retractions first: leaving a retracted announcement visible in Discord is
    -- worse than delaying a new one by one cron tick.
    order by (a.discord_state = 'retract_pending') desc, a.published_at nulls last
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
         a.author_display, a.image_url, a.discord_message_id, a.discord_attempts,
         case when a.discord_state = 'retract_pending' then 'retract' else 'mirror' end
  from public.announcements a
  where a.id = any(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.claim_announcement_mirrors(text, integer, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_announcement_mirrors(text, integer, integer, integer) to service_role;

/**
 * Retracts a published announcement.
 *
 * THE WEBSITE IS PRIVATE THE MOMENT THIS COMMITS
 * ==============================================
 * `status` goes back to `draft` in this transaction, so `/updates`,
 * `/discord`, and `/updates/<slug>` stop serving it immediately. Discord
 * deletion is scheduled, never awaited: a Discord outage must not be able to
 * keep an announcement public on our own site, which is the surface we control
 * and the one that matters.
 *
 * NOTHING IS DELETED. The row, its body, its slug, and its timestamps all
 * remain — `published_at` is deliberately kept as the record of when it went
 * out. Only `status` changes.
 *
 * Idempotent: retracting an already-private announcement is a no-op that does
 * not re-arm a second Discord delete.
 */
create or replace function public.unpublish_announcement(p_slug text)
returns table(slug text, status text, discord_state text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
begin
  select * into v_row from public.announcements a where a.slug = p_slug for update;

  if not found then
    slug := p_slug; status := 'missing'; discord_state := 'none'; changed := false;
    return next; return;
  end if;

  if v_row.status <> 'published' then
    -- Already private. Report the current state without touching the mirror:
    -- re-arming would schedule a second DELETE for a message that a previous
    -- retraction may already have removed.
    slug := v_row.slug; status := v_row.status;
    discord_state := v_row.discord_state; changed := false;
    return next; return;
  end if;

  update public.announcements a
  set status = 'draft',
      -- published_at is KEPT. It is history, and clearing it would also break
      -- the announcements_published_has_timestamp constraint's intent.
      discord_state = case
        -- Discord holds a message: schedule its deletion.
        when a.discord_message_id is not null then 'retract_pending'
        -- Never mirrored, so there is nothing in Discord to remove.
        else 'skipped'
      end,
      discord_next_attempt_at = case when a.discord_message_id is not null then now() else null end,
      discord_attempts = 0,
      discord_lease_until = null,
      discord_last_error = null,
      -- The delivered hash is cleared either way: whatever Discord holds (or
      -- held) no longer corresponds to a published announcement, so a later
      -- publish must re-evaluate rather than treat it as already delivered.
      discord_delivered_hash = null
  where a.id = v_row.id
  returning * into v_row;

  slug := v_row.slug; status := v_row.status;
  discord_state := v_row.discord_state; changed := true;
  return next;
end;
$$;

revoke all on function public.unpublish_announcement(text) from public, anon, authenticated;
grant execute on function public.unpublish_announcement(text) to service_role;

/**
 * Records the outcome of one Discord DELETE.
 *
 * THE REPUBLISH-SAFETY DECISION LIVES HERE
 * ========================================
 *   success -> `discord_message_id` is CLEARED. The message is known gone, so a
 *              later publish must POST a new one. PATCHing a deleted id would
 *              404 and strand the announcement in review.
 *
 *   failure -> the id is deliberately KEPT. The message may still exist, and
 *              clearing it would make the next publish POST a SECOND message
 *              beside the one still sitting in the channel. Keeping it means
 *              the next publish PATCHes: harmless if the message is there, and
 *              a clean review_required if it is not. Never a duplicate.
 *
 * A 404 from Discord counts as SUCCESS: the message is gone, which is the
 * outcome we wanted.
 */
create or replace function public.complete_announcement_retraction(
  p_id uuid,
  p_outcome text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  if p_outcome = 'deleted' then
    update public.announcements a
    set discord_state = 'retracted',
        -- Known gone. This is what makes the next publish a POST.
        discord_message_id = null,
        discord_lease_until = null,
        discord_next_attempt_at = null,
        discord_last_error = null
    where a.id = p_id
    returning a.discord_state into v_state;

  elsif p_outcome = 'retry' then
    update public.announcements a
    set discord_state = 'retract_pending',
        discord_lease_until = null,
        discord_next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, a.discord_attempts)::int)),
        discord_last_error = left(coalesce(p_error, 'retry'), 200)
    where a.id = p_id
    returning a.discord_state into v_state;

  else
    -- Exhausted or refused. The id stays; a human decides.
    update public.announcements a
    set discord_state = 'retract_failed',
        discord_lease_until = null,
        discord_next_attempt_at = null,
        discord_last_error = left(coalesce(p_error, 'failed'), 200)
    where a.id = p_id
    returning a.discord_state into v_state;
  end if;

  return coalesce(v_state, 'missing');
end;
$$;

revoke all on function public.complete_announcement_retraction(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_announcement_retraction(uuid, text, text) to service_role;

/**
 * Staff confirmation that a stuck Discord message was removed BY HAND.
 *
 * WHY THIS EXISTS
 * ===============
 * A failed DELETE deliberately keeps `discord_message_id`, because the message
 * may still exist and clearing it would let a later publish POST a duplicate
 * beside it. That is the safe default, but it leaves a trap: once an operator
 * deletes the message manually in Discord, the row still holds a now-dead id,
 * and the next publish PATCHes it, 404s, and lands in review.
 *
 * This is the only way out, and it is deliberately a HUMAN ASSERTION: "I have
 * looked at the channel and the message is gone." Nothing here contacts
 * Discord, because if we could verify it automatically the DELETE would not
 * have failed in the first place.
 *
 * ONLY from `retract_failed`. A timed-out delete sits in `retract_pending` and
 * is still being retried automatically — offering this there would invite an
 * operator to clear an id while the message is very much still there.
 *
 * It publishes nothing and posts nothing. Its entire effect is to forget a
 * message id, which is what lets the NEXT publish POST exactly one new message.
 */
create or replace function public.confirm_announcement_discord_removed(p_slug text)
returns table(slug text, discord_state text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
begin
  select * into v_row from public.announcements a where a.slug = p_slug for update;

  if not found then
    slug := p_slug; discord_state := 'none'; changed := false;
    return next; return;
  end if;

  -- Idempotent: already known-retracted is a success, not an error. An operator
  -- who clicks twice has not done anything wrong.
  if v_row.discord_state = 'retracted' and v_row.discord_message_id is null then
    slug := v_row.slug; discord_state := v_row.discord_state; changed := false;
    return next; return;
  end if;

  if v_row.discord_state <> 'retract_failed' then
    -- Includes retract_pending (still retrying) and delivered (still live and
    -- still public). Neither is something an operator should be able to
    -- "confirm away".
    slug := v_row.slug; discord_state := v_row.discord_state; changed := false;
    return next; return;
  end if;

  update public.announcements a
  set discord_state = 'retracted',
      -- The whole point. From here a publish POSTs rather than PATCHes.
      discord_message_id = null,
      discord_next_attempt_at = null,
      discord_lease_until = null,
      discord_last_error = null
  where a.id = v_row.id
  returning * into v_row;

  slug := v_row.slug; discord_state := v_row.discord_state; changed := true;
  return next;
end;
$$;

revoke all on function public.confirm_announcement_discord_removed(text)
from public, anon, authenticated;
grant execute on function public.confirm_announcement_discord_removed(text) to service_role;

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
