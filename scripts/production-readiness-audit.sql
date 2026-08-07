-- PRODUCTION GIFT-CARD READINESS AUDIT — READ ONLY.
--
-- Paste into the Supabase SQL editor for the PRODUCTION project.
-- Every statement is a SELECT. Nothing is created, altered, activated, or
-- deleted. Safe to run at any time, including during traffic.
--
-- Answers, in order:
--   1. are the nine denominations present, at the right cents, and INACTIVE?
--   2. are all required tables present?
--   3. are all required functions present?
--   4. is any gift-card data already live (it should be none)?

-- ===========================================================================
-- 1. The nine denominations
-- ===========================================================================
select
  '1. DENOMINATIONS' as check,
  slug,
  price_cents,
  active,
  case
    when active then 'UNEXPECTED — should still be false before activation'
    else 'ok (inactive)'
  end as status
from public.products
where category = 'gift_cards'
order by price_cents;

-- Roll-up: exactly nine, exact cents, none active.
select
  '1b. DENOMINATION SUMMARY' as check,
  count(*) as rows_found,
  count(*) filter (where active) as active_rows,
  (array_agg(price_cents order by price_cents))::text as cents,
  case
    when count(*) <> 9 then 'BLOCKED — expected 9 rows'
    -- Cast both sides: price_cents is integer in production, and an
    -- integer[] <> bigint[] comparison has no operator.
    when array_agg(price_cents::bigint order by price_cents)
         <> array[500,1000,1500,2000,2500,3000,5000,7500,10000]::bigint[]
      then 'BLOCKED — cents do not match the approved ladder'
    when count(*) filter (where active) > 0 then 'VERIFY — some rows already active'
    else 'READY — nine rows, correct cents, all inactive'
  end as verdict
from public.products
where category = 'gift_cards';

-- ===========================================================================
-- 2. Required tables
-- ===========================================================================
select
  '2. TABLES' as check,
  t.name as required_table,
  case when c.oid is null then 'MISSING — migration unapplied' else 'present' end as status
from (values
  ('gift_cards'),
  ('gift_card_claim_credentials'),
  ('gift_card_refunds'),
  ('store_credit_lots'),
  ('store_credit_lot_allocations'),
  ('store_credit_ledger'),
  ('order_refunds'),
  ('abuse_events'),
  ('cash_redemption_requests'),
  ('payment_reviews'),
  ('email_deliveries')
) as t(name)
left join pg_class c
  on c.relname = t.name
 and c.relnamespace = 'public'::regnamespace
 and c.relkind = 'r'
order by status desc, required_table;

-- ===========================================================================
-- 3. Required functions
-- ===========================================================================
select
  '3. FUNCTIONS' as check,
  f.name as required_function,
  case when p.oid is null then 'MISSING — migration unapplied' else 'present' end as status
from (values
  -- issuance and claim
  ('issue_gift_card_for_order'), ('claim_gift_card'), ('gift_card_for_order'),
  -- credit lots
  ('reserve_credit_lots'), ('consume_credit_lots'), ('release_credit_lots'),
  ('restore_credit_lots'), ('gift_origin_available'), ('store_credit_lot_balance'),
  ('freeze_gift_card_credit'), ('unfreeze_gift_card_credit'),
  -- refunds and disputes
  ('begin_gift_card_refund'), ('mark_gift_card_refund_pending'),
  ('complete_gift_card_refund'), ('fail_gift_card_refund'),
  ('record_gift_card_dispute'), ('resolve_gift_card_dispute'),
  ('gift_card_position'), ('gift_card_downstream_funding'), ('record_order_refund'),
  -- reconciliation
  ('claim_pending_gift_card_refunds'), ('defer_gift_card_refund'),
  ('claim_pending_reconciliations'), ('finish_pending_reconciliation'),
  ('cancel_reconciled_unpaid_order'),
  -- customer-visible state
  ('purchaser_gift_card_states'), ('recipient_credit_hold'),
  -- abuse controls
  ('gift_card_abuse_limits'), ('apply_abuse_rule'), ('abuse_rule_window'),
  ('record_abuse_event'), ('evaluate_gift_card_velocity'),
  ('evaluate_abuse_rule_for_actor'), ('record_velocity_review'), ('purge_abuse_events'),
  -- cash redemption
  ('request_cash_redemption'), ('resolve_cash_redemption'), ('gift_lot_provenance'),
  ('my_cash_redemption_status'), ('has_gift_origin_credit')
) as f(name)
left join pg_proc p
  on p.proname = f.name
 and p.pronamespace = 'public'::regnamespace
order by status desc, required_function;

-- ===========================================================================
-- 4. Nothing should be live yet
-- ===========================================================================
-- A non-zero count here means gift cards have already transacted, which would
-- contradict "never enabled" and needs explaining before activation.
select '4. EXISTING DATA' as check, 'gift_cards' as table, count(*) as rows from public.gift_cards
union all select '4. EXISTING DATA', 'gift_card_claim_credentials', count(*) from public.gift_card_claim_credentials
union all select '4. EXISTING DATA', 'gift_card_refunds', count(*) from public.gift_card_refunds
union all select '4. EXISTING DATA', 'store_credit_lots (gift_card source)', count(*) from public.store_credit_lots where source = 'gift_card'
union all select '4. EXISTING DATA', 'cash_redemption_requests', count(*) from public.cash_redemption_requests
union all select '4. EXISTING DATA', 'abuse_events', count(*) from public.abuse_events;
