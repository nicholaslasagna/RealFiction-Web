-- Public economy leaderboard — surface minecraft_uuid alongside username
-- so the website can render skin heads through the same mc-heads.net /
-- UUID path the playtime "Top 10 - Network" board uses (works for Java
-- accounts AND Bedrock players linked through GeyserMC; their Geyser-
-- issued UUIDs resolve identically).
--
-- Background:
--   The pre-existing public_economy_leaderboard returned only rank +
--   username + balance. The website tried to enrich UUIDs by querying
--   minecraft_account_links on the username, which failed for Bedrock
--   players whose Geyser dot-prefix username (".Zaxthezack") doesn't
--   match the link-flow username they typed when binding their account.
--   Result: Bedrock players fell back to the generic Steve head while
--   their playtime row right next to it showed the real Bedrock skin.
--
-- This migration:
--   - DROPs and re-CREATEs the function so the return shape can change
--     (`create or replace` cannot alter return types).
--   - Adds a single new column to the return rowset: `minecraft_uuid text`.
--     The source column is the same text already used in the ORDER BY
--     for stable ranking, so this is a pure projection change.
--   - Preserves the existing privacy posture — same `security definer`,
--     same `search_path = public`, same validation, same row scope (only
--     rows with `balance_minor > 0`), same revoke/grant.
--
-- This migration does NOT:
--   - touch economy_ledger or economy_balances rows
--   - widen what is exposed beyond the UUID and existing username/balance
--     (no metadata, audit, internal reasons, admin ids, policy details)
--   - change the SMP / Factions / RealCore write paths
--   - alter RLS or other grants

set search_path = public;

drop function if exists public.public_economy_leaderboard(text, integer);

create or replace function public.public_economy_leaderboard(
  p_currency_key text default 'realfiction_main',
  p_limit integer default 10
)
returns table(
  rank_position bigint,
  minecraft_uuid text,
  minecraft_username text,
  balance_minor bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := lower(coalesce(nullif(p_currency_key, ''), 'realfiction_main'));
  v_limit integer := least(25, greatest(1, coalesce(p_limit, 10)));
begin
  if v_currency !~ '^[a-z0-9_.-]{2,80}$' then
    raise exception 'invalid currency key';
  end if;

  return query
  select
    row_number() over (
      order by eb.balance_minor desc, lower(coalesce(eb.minecraft_username, '')) asc, eb.minecraft_uuid asc
    )::bigint as rank_position,
    eb.minecraft_uuid,
    eb.minecraft_username,
    eb.balance_minor::bigint
  from public.economy_balances eb
  where eb.currency_key = v_currency
    and eb.balance_minor > 0
  order by eb.balance_minor desc, lower(coalesce(eb.minecraft_username, '')) asc, eb.minecraft_uuid asc
  limit v_limit;
end;
$$;

comment on function public.public_economy_leaderboard(text, integer) is
  'Public-safe economy leaderboard. Returns rank + minecraft_uuid + minecraft_username + balance_minor for the top balances in the currency, sorted descending. Used by /api/public/economy/leaderboard. minecraft_uuid is exposed so the website can render skin heads via mc-heads.net (same path the playtime leaderboard uses). No ledger rows, audit data, or admin metadata are returned.';

revoke all on function public.public_economy_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.public_economy_leaderboard(text, integer) to service_role;
