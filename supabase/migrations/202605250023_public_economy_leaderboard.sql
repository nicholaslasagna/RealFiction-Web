-- Public-safe economy leaderboard.
--
-- Read-only RPC for website display. It exposes only rank, current Minecraft
-- username, and current balance from the balance cache. It does not expose
-- economy_ledger rows, metadata, audit data, internal reasons, admin ids, or
-- service-only policy details.

create or replace function public.public_economy_leaderboard(
  p_currency_key text default 'realfiction_main',
  p_limit integer default 10
)
returns table(
  rank_position bigint,
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
    eb.minecraft_username,
    eb.balance_minor::bigint
  from public.economy_balances eb
  where eb.currency_key = v_currency
    and eb.balance_minor > 0
  order by eb.balance_minor desc, lower(coalesce(eb.minecraft_username, '')) asc, eb.minecraft_uuid asc
  limit v_limit;
end;
$$;

revoke all on function public.public_economy_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.public_economy_leaderboard(text, integer) to service_role;
