-- RF-01 historical abuse audit. READ-ONLY.
--
-- WHAT RF-01 WAS
-- ==============
-- /api/admin/economy/import treated ANY authenticated account as an admin. It
-- then called `admin_import_economy_balances` / `admin_rollback_economy_import`
-- through the service role. The SQL records `actor_type`/`actor_id` on each
-- ledger row and writes an `economy_admin_audit` row per affected player — it
-- validates only the SHAPE of those fields, never that the caller held a role.
--
-- So the fingerprint of abuse is a ledger row with `actor_type = 'admin'` whose
-- `actor_id` is not a staff account.
--
-- AN HONEST LIMITATION, STATED UP FRONT
-- =====================================
-- There is no role-history table in this schema. `profiles.role` holds only the
-- CURRENT role. This can therefore tell you:
--
--     "the account recorded on this row is a plain player TODAY"
--
-- and it CANNOT tell you:
--
--     "that account was a plain player WHEN the row was written"
--
-- Someone who was staff then and was demoted since looks identical to an
-- attacker. Every row returned is a LEAD requiring human judgment, not proof.
-- Query 4 carries that caveat per row rather than burying it here.
--
-- Nothing below writes. Safe to run against production.

-- ---------------------------------------------------------------------------
-- 0. SUMMARY FIRST — read this before the detail
-- ---------------------------------------------------------------------------
-- Four numbers and a verdict. If `suspicious_current_role_actors` is 0 there is
-- nothing to chase; the detailed queries below are then context only.
select
  (select count(*) from public.economy_ledger
    where actor_type = 'admin')                          as total_admin_ledger_events,
  (select count(distinct external_ref_id) from public.economy_ledger
    where actor_type = 'admin' and external_ref_type is not null)
                                                          as distinct_import_batches,
  (select count(distinct actor_id) from public.economy_ledger
    where actor_type = 'admin')                          as unique_actor_ids,
  (select count(distinct a.admin_user_id)
     from public.economy_admin_audit a
     left join public.profiles p on p.id = a.admin_user_id
    where coalesce(p.role::text, 'player') not in ('staff','admin','owner'))
                                                          as suspicious_current_role_actors,
  case
    when (select count(distinct a.admin_user_id)
            from public.economy_admin_audit a
            left join public.profiles p on p.id = a.admin_user_id
           where coalesce(p.role::text, 'player') not in ('staff','admin','owner')) = 0
    then 'CLEAN so far: no admin-attributed economy activity belongs to an account that is a non-staff account today.'
    else 'REVIEW: at least one actor is not staff TODAY. This is a LEAD, not proof — see the historical-role caveat on every row of query 4.'
  end                                                     as summary_verdict;

-- ---------------------------------------------------------------------------
-- 1. Every import/rollback the economy ledger attributes to an "admin"
-- ---------------------------------------------------------------------------
-- Grouped by import batch, which the function stores in external_ref_id.
select
  l.external_ref_type,
  l.external_ref_id                        as import_batch_id,
  l.actor_type,
  l.actor_id,
  min(l.created_at)                        as first_row,
  max(l.created_at)                        as last_row,
  count(*)                                 as ledger_rows,
  count(distinct l.minecraft_uuid)         as players_affected,
  coalesce(sum(l.amount_minor), 0)         as total_delta_minor
from public.economy_ledger l
where l.actor_type = 'admin'
group by l.external_ref_type, l.external_ref_id, l.actor_type, l.actor_id
order by min(l.created_at) desc
limit 200;

-- ---------------------------------------------------------------------------
-- 2. Who is staff TODAY — the reference set for query 4
-- ---------------------------------------------------------------------------
select p.id, p.role, p.created_at
from public.profiles p
where p.role in ('staff', 'admin', 'owner')
order by p.role, p.created_at;

-- ---------------------------------------------------------------------------
-- 3. The admin audit trail, which records admin_user_id directly
-- ---------------------------------------------------------------------------
select
  a.admin_user_id,
  count(*)                          as audit_rows,
  count(distinct a.target_minecraft_uuid) as players_touched,
  coalesce(sum(a.amount_minor), 0)  as total_amount_minor,
  min(a.created_at)                 as first_seen,
  max(a.created_at)                 as last_seen
from public.economy_admin_audit a
group by a.admin_user_id
order by max(a.created_at) desc;

-- ---------------------------------------------------------------------------
-- 4. SUSPICIOUS: admin-attributed activity by an account that is not staff today
-- ---------------------------------------------------------------------------
-- Read `historical_role_known` before acting on any row. Account ids only — no
-- email is resolved here, because an id is enough to investigate and pulling
-- addresses into an audit output spreads personal data for no benefit.
select
  a.admin_user_id,
  coalesce(p.role::text, 'NO PROFILE ROW')  as actor_role_today,
  count(*)                                  as audit_rows,
  count(distinct a.target_minecraft_uuid)   as players_touched,
  coalesce(sum(a.amount_minor), 0)          as total_amount_minor,
  min(a.created_at)                         as first_seen,
  max(a.created_at)                         as last_seen,
  'NO — profiles.role holds only the current role; this account may have been staff at the time'
                                            as historical_role_known,
  case
    when p.id is null then 'INVESTIGATE: no profile row for the recorded admin'
    else 'INVESTIGATE: recorded admin is a plain player today'
  end                                       as assessment
from public.economy_admin_audit a
left join public.profiles p on p.id = a.admin_user_id
where coalesce(p.role::text, 'player') not in ('staff', 'admin', 'owner')
group by a.admin_user_id, p.id, p.role
order by max(a.created_at) desc;

-- ---------------------------------------------------------------------------
-- 5. Blast radius: balances currently attributable to admin-actor ledger rows
-- ---------------------------------------------------------------------------
-- Context if query 4 is empty; the affected-player list if it is not.
select
  l.minecraft_uuid,
  l.minecraft_username,
  count(*)                          as ledger_rows,
  coalesce(sum(l.amount_minor), 0)  as total_delta_minor,
  min(l.created_at)                 as first_seen,
  max(l.created_at)                 as last_seen
from public.economy_ledger l
where l.actor_type = 'admin'
group by l.minecraft_uuid, l.minecraft_username
having coalesce(sum(l.amount_minor), 0) <> 0
order by abs(coalesce(sum(l.amount_minor), 0)) desc
limit 100;

-- ---------------------------------------------------------------------------
-- 6. One-line verdict
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.economy_ledger where actor_type = 'admin')          as admin_ledger_rows,
  (select count(distinct admin_user_id) from public.economy_admin_audit)           as distinct_recorded_admins,
  (select count(*) from public.economy_admin_audit a
     left join public.profiles p on p.id = a.admin_user_id
    where coalesce(p.role::text, 'player') not in ('staff', 'admin', 'owner'))     as suspicious_audit_rows,
  case
    when (select count(*) from public.economy_admin_audit a
            left join public.profiles p on p.id = a.admin_user_id
           where coalesce(p.role::text, 'player') not in ('staff', 'admin', 'owner')) = 0
    then 'No admin-attributed economy activity by a non-staff account. Consistent with no RF-01 abuse.'
    else 'REVIEW REQUIRED: admin-attributed economy activity exists for an account that is not staff today. See query 4, and note the historical-role caveat.'
  end                                                                              as verdict;
