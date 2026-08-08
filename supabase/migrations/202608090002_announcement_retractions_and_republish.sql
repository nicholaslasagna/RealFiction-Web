-- Advances the PARTIALLY APPLIED announcement schema to its final shape.
--
-- WHY THIS MIGRATION EXISTS
-- =========================
-- 202608090001 was edited in place after production had already applied it, and
-- the edited file was then re-run by hand. It is NOT transactional — psql
-- autocommits each statement — so it advanced partway and stopped at:
--
--   ERROR 42P13: cannot change return type of existing function
--
-- raised by `create or replace function public.claim_announcement_mirrors`,
-- because CREATE OR REPLACE cannot alter an OUT-table return type.
--
-- What that left behind, verified by replaying the failure against a snapshot
-- of the reported production schema:
--
--   * `create table if not exists` was a NO-OP, so `first_published_at` was
--     never added and the discord_state CHECK still lacks the retraction states
--   * `create index if not exists` was a NO-OP, so the mirror-due index still
--     has the old predicate and cannot see `retract_pending`
--   * `publish_announcement` WAS replaced (its signature did not change), and
--     its new body references `first_published_at` — so publishing currently
--     FAILS AT RUNTIME with "column first_published_at does not exist"
--   * `claim_announcement_mirrors` kept its old 10-column return type
--   * nothing after it ran: no unpublish, no retraction, no confirmation
--
-- 202608090001 is therefore historical from here on. Do not re-run it. This
-- migration is forward-only and moves that exact state to the final schema.
--
-- IT IS TRANSACTIONAL, ON PURPOSE
-- ===============================
-- Postgres DDL is transactional, and this file wraps everything in one
-- transaction. That matters most for the claim function: it must be DROPPED to
-- change its return type, and a failure between the drop and the recreate would
-- leave production with no mirror worker at all. Inside a transaction that
-- window does not exist — either both happen or neither does.

begin;

-- ---------------------------------------------------------------------------
-- 1. The column 090001 could not add
-- ---------------------------------------------------------------------------
-- `if not exists` here is correctness, not defensiveness: whether this column
-- is present is exactly the thing that differs between a database that applied
-- 090001 before the edit and one that applied it after.
alter table public.announcements
  add column if not exists first_published_at timestamptz;

-- BACKFILL POLICY
-- ===============
-- For every row that has ever been published, the best available evidence of
-- when it FIRST went out is its current `published_at`. Nothing else was ever
-- recorded, so this is the most truthful value that exists — not a guess.
--
-- Rows that were never published keep NULL, which is correct: they have no
-- first publication.
--
-- Bounded by `first_published_at is null` so re-running this migration cannot
-- overwrite a real first-publication date with a later republication date.
update public.announcements
set first_published_at = published_at
where published_at is not null
  and first_published_at is null;

-- ---------------------------------------------------------------------------
-- 2. The retraction states
-- ---------------------------------------------------------------------------
-- Named explicitly rather than with a broad `if exists` sweep: if this
-- constraint is not the one we expect, that is a schema mismatch worth failing
-- on, not something to swallow.
alter table public.announcements
  drop constraint if exists announcements_discord_state_check;

alter table public.announcements
  add constraint announcements_discord_state_check check (discord_state in (
    'pending', 'delivered', 'retrying', 'failed', 'review_required', 'skipped',
    'retract_pending', 'retracted', 'retract_failed'
  ));

-- The due index must be able to see a retraction, which is a DRAFT row.
drop index if exists public.announcements_mirror_due_idx;
create index announcements_mirror_due_idx
on public.announcements(discord_next_attempt_at)
where discord_state in ('pending', 'retrying', 'retract_pending');

-- ---------------------------------------------------------------------------
-- 3. The claim function: DROP then recreate, in this transaction
-- ---------------------------------------------------------------------------
-- The exact signature, so this cannot silently drop something else. Recreated
-- immediately below; the grants are restated afterwards because DROP discards
-- them.
drop function if exists public.claim_announcement_mirrors(text, integer, integer, integer);

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

-- ---------------------------------------------------------------------------
-- 4. Publishing, with the finalized timestamp semantics
-- ---------------------------------------------------------------------------
-- Replaces the body that currently references a column production did not have.
-- Same signature, so CREATE OR REPLACE is sufficient here.

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
grant execute on function public.publish_announcement(text, text, text, text, text, text, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Retraction and manual recovery
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 6. Guard: fail loudly if any of it did not take
-- ---------------------------------------------------------------------------
-- Inside the transaction, so a mismatch rolls the whole thing back rather than
-- leaving a half-advanced schema behind for a second time.
do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'announcements'
      and column_name = 'first_published_at'
  ) then
    raise exception 'ABORT: first_published_at was not added';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_announcement_mirrors'
      and pg_get_function_result(p.oid) like '%operation%'
  ) then
    raise exception 'ABORT: claim_announcement_mirrors does not return operation';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('unpublish_announcement', 'complete_announcement_retraction',
                          'confirm_announcement_discord_removed')) <> 3 then
    raise exception 'ABORT: the retraction functions are incomplete';
  end if;
end
$guard$;

commit;
