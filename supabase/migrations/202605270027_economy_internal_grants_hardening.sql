-- Phase 17: Economy internal grants hardening (Data API exposure).
--
-- Migration 018 intentionally revoked INSERT/UPDATE/DELETE on internal economy
-- tables from anon/authenticated, then granted SELECT to authenticated with
-- admin-only RLS (is_admin()). That still exposes raw internal tables through
-- Supabase PostgREST to any authenticated JWT holder; schema/column metadata and
-- direct SELECT remain broader than our desired posture.
--
-- Desired posture:
--   - Internal economy tables are NOT broadly readable via anon/authenticated.
--   - Website and RealCore access internal state only through reviewed RPCs
--     invoked server-side with service_role (Next.js API routes / HMAC plugin).
--   - public_economy_leaderboard (023) remains the public-safe leaderboard path.
--
-- This migration does NOT:
--   - modify ledger rows, balances, policies, or RPC bodies
--   - enable SMP/Factions live writes
--   - change vote reward delivery or RealCore/HMAC behavior
--
-- Admin RLS policies from 018 are retained as defense-in-depth if SELECT is ever
-- re-granted by mistake; they are inert while authenticated lacks table GRANT.

-- ---------------------------------------------------------------------------
-- Revoke direct table access from Data API roles
-- ---------------------------------------------------------------------------

revoke all on table public.economy_ledger from public, anon, authenticated;
revoke all on table public.economy_balances from public, anon, authenticated;
revoke all on table public.economy_transaction_batches from public, anon, authenticated;
revoke all on table public.economy_server_policies from public, anon, authenticated;
revoke all on table public.economy_admin_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Explicit service_role table grants (018 never revoked service_role; affirm)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.economy_ledger to service_role;
grant select, insert, update, delete on table public.economy_balances to service_role;
grant select, insert, update, delete on table public.economy_transaction_batches to service_role;
grant select, insert, update, delete on table public.economy_server_policies to service_role;
grant select, insert, update, delete on table public.economy_admin_audit to service_role;

-- ---------------------------------------------------------------------------
-- Re-affirm service_role EXECUTE on economy RPC surface (no logic changes)
-- ---------------------------------------------------------------------------

revoke all on function public.get_economy_balance(text, text) from public, anon, authenticated;
grant execute on function public.get_economy_balance(text, text) to service_role;

revoke all on function public.get_plugin_economy_balance(text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_plugin_economy_balance(text, text, text, text) to service_role;

revoke all on function public.apply_economy_transaction(
  text, text, text, text, text, bigint, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_economy_transaction(
  text, text, text, text, text, bigint, text, text, text, text, text, jsonb
) to service_role;

revoke all on function public.apply_economy_batch(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_economy_batch(text, text, text, uuid, jsonb) to service_role;

revoke all on function public.admin_adjust_economy_balance(
  uuid, text, text, text, bigint, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_adjust_economy_balance(
  uuid, text, text, text, bigint, text, text, jsonb
) to service_role;

revoke all on function public.admin_import_economy_balances(
  text, text, uuid, text, uuid, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_import_economy_balances(
  text, text, uuid, text, uuid, text, boolean, jsonb, jsonb
) to service_role;

revoke all on function public.admin_rollback_economy_import(
  text, text, uuid, text, uuid, uuid, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_rollback_economy_import(
  text, text, uuid, text, uuid, uuid, text, boolean, jsonb
) to service_role;

revoke all on function public.public_economy_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.public_economy_leaderboard(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Manual verification (run in SQL editor before/after apply; not executed here)
-- ---------------------------------------------------------------------------
--
-- Expect authenticated has NO table privileges:
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in (
--       'economy_ledger', 'economy_balances', 'economy_transaction_batches',
--       'economy_server_policies', 'economy_admin_audit'
--     )
--     and grantee in ('authenticated', 'anon')
--   order by table_name, grantee, privilege_type;
--
-- Expect service_role retains table + RPC access:
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name = 'economy_balances'
--     and grantee = 'service_role';
--
-- Leaderboard smoke (service_role RPC only):
--   select * from public.public_economy_leaderboard('realfiction_main', 5);
