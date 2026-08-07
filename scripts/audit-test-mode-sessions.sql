-- READ-ONLY: production orders still pointing at TEST-MODE Stripe sessions.
--
-- Paste into the Supabase SQL editor. One SELECT, no writes of any kind.
--
-- WHY THESE MATTER
-- ================
-- The reconciler retrieves `GET /v1/checkout/sessions/:id` with the LIVE secret
-- key. A `cs_test_...` id cannot be resolved with live credentials, so Stripe
-- answers `resource_missing`. The reconciler cannot distinguish that 404 from a
-- timeout or a 500 — all three mean "we do not know", not "unpaid" — so it
-- retries on a backoff until it exhausts its attempts and hands the row to a
-- human.
--
-- What to look at in the output, in order:
--   attempts_state       'exhausted - retries STOPPED' is the benign end state.
--                        'RETRYING' means the row is still generating calls.
--   status               'pending' is the only status the reconciler selects.
--   credit_reserved_cents  non-zero means a customer's store credit is still
--                        held against an order that will never complete.
--   order_kind           gift_card vs ordinary, to confirm nothing stored-value
--                        is caught up in this.

select
  o.id                                   as order_id,
  o.provider_session_id,
  o.status                               as order_status,
  o.provider,
  o.total_cents,
  o.payment_due_cents,
  o.store_credit_applied_cents           as credit_reserved_cents,
  o.currency,
  o.created_at,
  o.updated_at,

  -- Reconciliation state
  o.reconciliation_attempts,
  o.reconciliation_review_required,
  o.reconciliation_outcome,
  o.reconciliation_provider_status,
  o.reconciliation_diagnostic,
  o.reconciliation_last_at,
  o.reconciliation_next_at,
  o.reconciliation_lease_until,

  -- Is this row still producing Stripe calls?
  case
    when o.status <> 'pending'            then 'not selectable - status is not pending'
    when o.reconciliation_review_required then 'exhausted - retries STOPPED (human owns it)'
    when o.reconciliation_attempts >= 10  then 'at ceiling - stops on next finish'
    else 'RETRYING - still generating Stripe calls'
  end                                     as attempts_state,

  -- Ordinary or gift card, from our own snapshot.
  case
    when exists (
      select 1
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id and p.category = 'gift_cards'
    ) then 'gift_card'
    else 'ordinary'
  end                                     as order_kind,

  -- Did this order ever issue stored value? Must be none for a test-mode row.
  (select count(*) from public.gift_cards g where g.purchaser_order_id = o.id)
                                          as gift_cards_issued,

  -- Live store-credit hold, if any. A reserve with no matching release is the
  -- case worth acting on: real customer credit held against a dead order.
  (
    select coalesce(sum(l.delta_cents), 0)
    from public.store_credit_ledger l
    where l.source_ref = o.id::text
  )                                       as credit_ledger_net_cents,
  (
    select count(*)
    from public.store_credit_ledger l
    where l.source_ref = o.id::text and l.source = 'store_credit_reserve'
  )                                       as credit_reserve_entries,
  (
    select count(*)
    from public.store_credit_lot_allocations a
    where a.order_id = o.id and a.state = 'reserved'
  )                                       as gift_lot_allocations_held

from public.orders o
where o.provider_session_id like 'cs_test_%'
order by o.created_at desc;
