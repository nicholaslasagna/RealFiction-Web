-- Durable history of every role change.
--
-- WHY
-- ===
-- The RF-01 abuse audit could not answer the only question that mattered:
-- "was this account staff AT THE TIME?" `profiles.role` holds the current role
-- and nothing else, so an attacker and a since-demoted staff member look
-- identical forever. Every future incident review has that same blind spot
-- until something records the transitions.
--
-- SCOPE, DELIBERATELY SMALL
-- =========================
-- This is not an IAM system. It is one append-only table and one trigger.
-- It adds no API, no policy engine, no role-granting path, and it does not
-- touch `prevent_profile_role_escalation()` — that function remains the control
-- that stops self-escalation, and this only records what it allows through.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
-- ==========================================
-- Roles can change from the SQL editor, a migration, or a future admin screen.
-- A trigger is the only place that sees all of them, and it makes the history
-- write ATOMIC with the change: the row and its audit entry commit together or
-- not at all. Application-side logging would miss the database-operator path,
-- which is exactly how the first owner is bootstrapped.

create table if not exists public.profile_role_history (
  id uuid primary key default gen_random_uuid(),

  target_user_id uuid not null references public.profiles(id) on delete cascade,
  old_role public.app_role,
  new_role public.app_role not null,
  changed_at timestamptz not null default now(),

  -- The authenticated account that made the change, when there was one.
  -- NULL means no session: a migration, the SQL editor, or the first-owner
  -- bootstrap. That is a meaningful distinction, so it is preserved rather
  -- than papered over with a placeholder id.
  actor_user_id uuid references public.profiles(id) on delete set null,

  --   session            an authenticated request (actor_user_id is set)
  --   database_operator  no session: SQL editor, migration, bootstrap
  actor_type text not null check (actor_type in ('session', 'database_operator')),

  reason text
);

create index if not exists profile_role_history_target_idx
on public.profile_role_history(target_user_id, changed_at desc);

create index if not exists profile_role_history_actor_idx
on public.profile_role_history(actor_user_id, changed_at desc)
where actor_user_id is not null;

-- Deny-all. This is forensic data about privilege, and a customer reading it
-- learns who the staff are. RLS with no policy is the strongest posture and
-- matches how the other sensitive tables here are protected.
alter table public.profile_role_history enable row level security;
revoke all on table public.profile_role_history from public, anon, authenticated;
grant select, insert on table public.profile_role_history to service_role;

-- No UPDATE or DELETE is granted to anyone, including service_role: history
-- that can be rewritten is not history. Correcting a mistaken entry is a
-- deliberate database-operator act, not something an application can do.

comment on table public.profile_role_history is
  'Append-only record of profiles.role transitions. Written by a trigger so the '
  'entry is atomic with the change and the database-operator path (SQL editor, '
  'migration, first-owner bootstrap) is captured too.';

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
/**
 * Records one role transition.
 *
 * AFTER UPDATE, so it never influences whether the change is allowed —
 * `prevent_profile_role_escalation()` (a BEFORE trigger) keeps that job
 * entirely.
 *
 * `auth.uid()` is read defensively: it is absent outside a request context, and
 * a migration running this must not fail on that.
 */
create or replace function public.record_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  -- Only a genuine transition is history.
  if new.role is not distinct from old.role then
    return new;
  end if;

  begin
    v_actor := auth.uid();
  exception when others then
    -- No request context (migration, SQL editor). Not an error.
    v_actor := null;
  end;

  -- An actor id is only recorded when it names a profile that exists, so the
  -- foreign key cannot turn a legitimate role change into a failed one.
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  insert into public.profile_role_history (
    target_user_id, old_role, new_role, actor_user_id, actor_type
  )
  values (
    new.id,
    old.role,
    new.role,
    v_actor,
    case when v_actor is null then 'database_operator' else 'session' end
  );

  return new;
end;
$$;

revoke all on function public.record_profile_role_change() from public, anon, authenticated;

drop trigger if exists profiles_record_role_change on public.profiles;
create trigger profiles_record_role_change
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute function public.record_profile_role_change();

-- ---------------------------------------------------------------------------
-- Seed the current state as the starting point
-- ---------------------------------------------------------------------------
-- Without this, the first entry for an existing staff member would be their
-- next change, and the history would imply they had no role before it. These
-- rows record what is true today and are explicitly attributed to no actor.
insert into public.profile_role_history (target_user_id, old_role, new_role, actor_user_id, actor_type, reason)
select p.id, null, p.role, null, 'database_operator',
       'Baseline recorded when role history was introduced; earlier transitions are unknown'
from public.profiles p
where p.role in ('staff', 'admin', 'owner')
  and not exists (select 1 from public.profile_role_history h where h.target_user_id = p.id);
