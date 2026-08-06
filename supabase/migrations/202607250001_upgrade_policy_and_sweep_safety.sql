-- Owner-approved upgrade policy + sweep safety.
--
-- THE DANGEROUS BUG THIS FIXES
-- ============================
-- expire_stale_upgrade_reservations released a reservation purely because two
-- hours had elapsed. A customer who completed Stripe Checkout while webhook
-- delivery was delayed (or retrying) would lose their reservation; fulfilment
-- would then find nothing to consume and the order would be granted with
-- incorrect accounting — after the money was taken.
--
-- Age is never sufficient evidence. A reservation may be released only when the
-- database can PROVE no successful payment can still consume it.

-- ---------------------------------------------------------------------------
-- 1. Owner policy: store-credit-funded RealVIP IS eligible
-- ---------------------------------------------------------------------------
-- Previous rule credited only the externally paid share, which disqualified a
-- customer who paid with refund credit or a gift-card balance. Store credit is
-- real customer value: someone who paid $7.99 by card and $5.00 from credit
-- still paid the full $12.99.
--
-- Credit is now the authoritative ITEM value after item-level discounts,
-- regardless of tender. Ineligible sources are excluded by provenance instead:
-- manual grants and inclusion-sourced entitlements have no paid order item at
-- all, so they cannot reach this query.
create or replace function public.eligible_upgrade_sources(
  p_user_id uuid,
  p_from_slug text
)
returns table(
  order_item_id uuid,
  order_id uuid,
  credit_cents bigint,
  purchased_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    oi.id,
    o.id,
    -- Authoritative item value. Not the order total: a multi-item order must
    -- never credit an upgrade with another product's money.
    greatest(0, oi.total_cents)::bigint,
    coalesce(o.paid_at, o.created_at)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.user_id = p_user_id
    and p.slug = p_from_slug
    -- Only a PERMANENT rank purchase. Legacy fixed-term RealVIP bought limited
    -- access, not permanent ownership, so it does not fund a permanent upgrade.
    and p.fulfillment_type = 'permanent'
    -- Settled and delivered. Excludes pending, cancelled, refunded, chargeback.
    and o.status = 'fulfilled'
    -- Not a gift in either direction: the payer and the recipient differ.
    and o.gifted_to_minecraft_username is null
    -- Must have a real paid value.
    and oi.total_cents > 0
    -- The entitlement must still be live and must NOT be inclusion-sourced
    -- (RealVIP inherited from RealSupporter) or a manual grant.
    and exists (
      select 1 from public.entitlements e
      where e.order_item_id = oi.id
        and e.entitlement_key = 'product:' || p_from_slug
        and e.status = 'active'
        and coalesce(e.metadata->>'source', '') = 'order'
    )
    -- Never already held or spent.
    and not exists (
      select 1 from public.upgrade_credit_reservations r
      where r.source_order_item_id = oi.id
        and r.state in ('reserved', 'consumed')
    )
$$;

revoke all on function public.eligible_upgrade_sources(uuid, text) from public, anon, authenticated;
grant execute on function public.eligible_upgrade_sources(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sweep safety
-- ---------------------------------------------------------------------------
alter table public.upgrade_credit_reservations
  drop constraint if exists upgrade_credit_reservations_state_check;
alter table public.upgrade_credit_reservations
  add constraint upgrade_credit_reservations_state_check
  check (state in ('reserved', 'consumed', 'released', 'invalidated', 'needs_review'));

/**
 * Releases ONLY reservations that can be proven dead.
 *
 * A reservation is releasable when its order is terminally unpaid, or when the
 * order is still pending AND the payment path is authoritatively closed:
 *   * a Stripe session existed and Stripe's own expiry has passed, or
 *   * no session was ever created and the checkout attempt is closed.
 *
 * Everything else is left alone:
 *   * order paid/fulfilled          -> fulfilment will consume it
 *   * session still within expiry   -> the customer can still pay
 *   * no attempt row / unknown      -> insufficient evidence
 *
 * Ambiguous rows that are very old are moved to `needs_review` rather than
 * released, so a human sees them instead of a customer losing a paid discount.
 */
create or replace function public.expire_stale_upgrade_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer;
  v_review integer;
begin
  with evidence as (
    select
      r.id,
      o.status as order_status,
      a.stripe_session_id,
      a.stripe_session_expires_at,
      a.closed_at
    from public.upgrade_credit_reservations r
    join public.orders o on o.id = r.order_id
    left join public.checkout_attempts a on a.order_id = r.order_id
    where r.state = 'reserved'
      and r.expires_at <= now()
  )
  update public.upgrade_credit_reservations r
  set state = 'released', released_at = now(), released_reason = 'no_viable_payment_path'
  from evidence e
  where r.id = e.id
    -- NEVER touch a paid order: fulfilment still needs this reservation.
    and e.order_status = 'pending'
    and (
      -- Stripe says the session can no longer be paid.
      (e.stripe_session_id is not null
        and e.stripe_session_expires_at is not null
        and e.stripe_session_expires_at <= now())
      -- Or no session was ever created and the attempt is closed.
      or (e.stripe_session_id is null and e.closed_at is not null)
    );

  get diagnostics v_released = row_count;

  -- Anything still expired after that has no authoritative evidence either way
  -- (unknown session state, missing attempt row, post-payment retry). Flag for
  -- a human rather than guessing.
  update public.upgrade_credit_reservations r
  set state = 'needs_review', released_reason = 'stale_without_evidence'
  from public.orders o
  where o.id = r.order_id
    and r.state = 'reserved'
    and r.expires_at <= now() - interval '24 hours'
    and o.status = 'pending';

  get diagnostics v_review = row_count;

  return v_released + v_review;
end;
$$;

revoke all on function public.expire_stale_upgrade_reservations() from public, anon, authenticated;
grant execute on function public.expire_stale_upgrade_reservations() to service_role;

-- A reservation in review is not available, so reserve_upgrade_credit must not
-- hand the same source out again — eligible_upgrade_sources only excludes
-- reserved/consumed, so add the review state explicitly.
create or replace function public.upgrade_source_is_held(p_order_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.upgrade_credit_reservations
    where source_order_item_id = p_order_item_id
      and state in ('reserved', 'consumed', 'needs_review')
  )
$$;

revoke all on function public.upgrade_source_is_held(uuid) from public, anon, authenticated;
grant execute on function public.upgrade_source_is_held(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Approved refund policy
-- ---------------------------------------------------------------------------
/**
 * Restores a consumed credit to available after a FULL refund of the upgraded
 * order — the owner-approved policy. Someone who legitimately refunds
 * RealSupporter keeps their valid RealVIP and can upgrade again later.
 *
 * Restoration requires ALL of:
 *   * the upgraded order is fully refunded (not partial, not chargeback)
 *   * its RealSupporter entitlement is fully revoked
 *   * the SOURCE RealVIP purchase is still valid and still owned
 *
 * Anything else routes to needs_review. Restoration transitions the SAME
 * reservation row, so no second credit is ever created.
 */
create or replace function public.restore_upgrade_credit_after_refund(
  p_upgraded_order_id uuid,
  p_is_full_refund boolean,
  p_is_chargeback boolean default false
)
returns table(restored boolean, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
  v_source_ok boolean;
  v_target_revoked boolean;
begin
  select * into v_res
  from public.upgrade_credit_reservations
  where order_id = p_upgraded_order_id and state = 'consumed';

  if not found then
    restored := false; outcome := 'no_consumed_reservation';
    return next; return;
  end if;

  -- Partial refunds and chargebacks never auto-restore.
  if not p_is_full_refund or p_is_chargeback then
    update public.upgrade_credit_reservations
    set state = 'needs_review',
        released_reason = case when p_is_chargeback then 'chargeback_review' else 'partial_refund_review' end
    where id = v_res.id;
    restored := false;
    outcome := case when p_is_chargeback then 'chargeback_needs_review' else 'partial_refund_needs_review' end;
    return next; return;
  end if;

  -- The upgraded entitlement must actually be gone.
  select not exists (
    select 1 from public.entitlements e
    where e.user_id = v_res.user_id
      and e.entitlement_key = 'product:' || v_res.to_slug
      and e.status = 'active'
  ) into v_target_revoked;

  -- The source must still be a valid, owned, unreversed purchase.
  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.entitlements e on e.order_item_id = oi.id
    where oi.id = v_res.source_order_item_id
      and o.status = 'fulfilled'
      and e.entitlement_key = 'product:' || v_res.from_slug
      and e.status = 'active'
  ) into v_source_ok;

  -- Revocation may legitimately land AFTER the refund event. That is a timing
  -- condition, not an ambiguity, so the reservation stays 'consumed' and a
  -- later correct call can still restore it. Parking it in review here would
  -- permanently strand a credit the customer is entitled to get back.
  if not v_target_revoked then
    restored := false; outcome := 'target_still_active';
    return next; return;
  end if;

  -- A source that is no longer valid IS ambiguous: there may be nothing left to
  -- credit. A human decides.
  if not v_source_ok then
    update public.upgrade_credit_reservations
    set state = 'needs_review', released_reason = 'source_no_longer_valid'
    where id = v_res.id;
    restored := false; outcome := 'needs_review';
    return next; return;
  end if;

  -- Same row, back to available. Never a second credit.
  update public.upgrade_credit_reservations
  set state = 'released', released_at = now(), released_reason = 'upgraded_order_fully_refunded'
  where id = v_res.id;

  restored := true; outcome := 'restored';
  return next;
end;
$$;

revoke all on function public.restore_upgrade_credit_after_refund(uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.restore_upgrade_credit_after_refund(uuid, boolean, boolean) to service_role;

/**
 * Refunding the SOURCE RealVIP after its credit was spent leaves a discounted
 * RealSupporter with no economic basis. This records the dependency as a
 * high-priority review naming every party, and marks the reservation so the
 * exploit cannot pass unnoticed.
 *
 * It deliberately does NOT auto-revoke the dependent rank: destructive
 * cross-order revocation is an owner policy call, not a migration's.
 */
create or replace function public.flag_source_refund_dependency(
  p_source_order_id uuid,
  p_event_id text,
  p_kind text default 'refund'
)
returns table(flagged boolean, upgraded_order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
begin
  select * into v_res
  from public.upgrade_credit_reservations
  where source_order_id = p_source_order_id and state = 'consumed'
  limit 1;

  if not found then
    flagged := false; upgraded_order_id := null;
    return next; return;
  end if;

  insert into public.payment_reviews (
    provider, provider_event_id, event_type, order_id, reason, detail
  )
  values (
    'stripe',
    p_event_id,
    'upgrade_source_' || p_kind,
    v_res.order_id,
    'upgrade_source_' || p_kind || '_dependency',
    jsonb_build_object(
      'priority', 'high',
      'source_order_id', p_source_order_id,
      'source_order_item_id', v_res.source_order_item_id,
      'upgrade_reservation_id', v_res.id,
      'upgraded_order_id', v_res.order_id,
      'dependent_entitlement_key', 'product:' || v_res.to_slug,
      'credit_cents', v_res.credit_cents,
      'note', 'Source purchase reversed after its upgrade credit was consumed. The dependent rank is still active and needs a decision.'
    )
  )
  on conflict (provider, provider_event_id) do nothing;

  update public.upgrade_credit_reservations
  set state = 'needs_review', released_reason = 'source_' || p_kind
  where id = v_res.id;

  flagged := true; upgraded_order_id := v_res.order_id;
  return next;
end;
$$;

revoke all on function public.flag_source_refund_dependency(uuid, text, text) from public, anon, authenticated;
grant execute on function public.flag_source_refund_dependency(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Wire the policy into the order trigger
-- ---------------------------------------------------------------------------
create or replace function public.close_checkout_attempt_on_terminal_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'fulfilled', 'cancelled', 'refunded', 'chargeback')
     and old.status is distinct from new.status then
    update public.checkout_attempts
    set closed_at = now(),
        closed_reason = coalesce(public.checkout_attempts.closed_reason, 'order_' || new.status::text)
    where public.checkout_attempts.order_id = new.id
      and public.checkout_attempts.closed_at is null;
  end if;

  -- Terminally unpaid -> the hold goes back.
  if new.status = 'cancelled' and old.status is distinct from new.status then
    perform public.release_upgrade_credit(new.id, 'order_cancelled');
  end if;

  -- The UPGRADED order was reversed. A full refund restores the credit; a
  -- chargeback routes to review. (Refund scope is decided by the webhook, which
  -- calls restore_upgrade_credit_after_refund directly with the real scope;
  -- this trigger covers manual/admin status changes conservatively.)
  if new.status = 'refunded' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(new.id, true, false);
  end if;

  if new.status = 'chargeback' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(new.id, false, true);
  end if;

  -- The SOURCE purchase was reversed after funding an upgrade.
  if new.status in ('refunded', 'chargeback') and old.status is distinct from new.status then
    perform public.flag_source_refund_dependency(
      new.id, 'order_status_' || new.id::text, new.status::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_close_checkout_attempt on public.orders;
create trigger orders_close_checkout_attempt
after update of status on public.orders
for each row
execute function public.close_checkout_attempt_on_terminal_order();

-- ---------------------------------------------------------------------------
-- 5. Availability gate
-- ---------------------------------------------------------------------------
-- Applying migrations must NOT by itself put proposed prices on sale. The new
-- permanent SKUs are seeded INACTIVE; checkout resolves only `active` products,
-- so every server path (old site, new site, direct API, service-role call)
-- refuses them until an operator explicitly enables them.
--
-- TO ENABLE SALES: docs/STORE_ENABLEMENT_RUNBOOK.md, which runs
-- docs/sql/store-permanent-rank-enablement.sql.
--
-- A copy-pasteable UPDATE deliberately does NOT live here. It would enable
-- whatever the pasted slug list happens to contain, would not check that the
-- prices in the database are the prices that were approved, and has no failure
-- mode — a partial paste leaves the store in a state nobody chose. The runbook
-- script verifies the schema version, both prices, the fulfilment types, the
-- RealSupporter -> RealVIP inclusion, the upgrade path, and that RealFiction+
-- and every gift card are still inactive, and aborts the whole transaction if
-- any of it disagrees.
update public.products
set active = false, updated_at = now()
where slug in (
  'realvip-permanent', 'real-supporter-permanent', 'realfiction-plus-30d',
  'username-colors-permanent', 'particle-vault-permanent',
  'realpets-permanent', 'cosmetic-atelier-permanent'
);
