-- Cancellation safety: a local cancel must never release payment-dependent
-- state while a Stripe session may already have collected money.
--
-- THE BUG THIS FIXES (reproduced before fixing)
-- =============================================
-- The order trigger released the upgrade reservation whenever an order became
-- 'cancelled'. But a local order can be cancelled — by a user, an admin, a
-- cleanup job, or an internal error path — while Stripe has ALREADY collected
-- payment and the success webhook is still in flight.
--
-- Reproduced: session-backed pending order, local cancel -> "released".
-- The delayed webhook would then fulfil a discounted order with no reservation.
--
-- New rule: cancellation releases financial holds ONLY when no provider session
-- was ever persisted. With a session present, cancellation is a REQUEST: holds
-- are retained and the order is queued for reconciliation, which is the only
-- thing allowed to conclude "terminal and unpaid".

alter table public.orders
  add column if not exists cancellation_requested_at timestamptz;
alter table public.orders
  add column if not exists cancellation_requested_reason text;

/**
 * True when this order has a persisted provider session — i.e. money may
 * already have moved and only the provider can say otherwise.
 */
create or replace function public.order_has_provider_session(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.checkout_attempts a
    where a.order_id = p_order_id and a.stripe_session_id is not null
  )
$$;

revoke all on function public.order_has_provider_session(uuid) from public, anon, authenticated;
grant execute on function public.order_has_provider_session(uuid) to service_role;

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

  -- Cancellation releases the upgrade hold ONLY when no provider session ever
  -- existed. With a session present the cancellation is not authoritative
  -- evidence the money did not move, so the hold is retained for reconciliation.
  if new.status = 'cancelled' and old.status is distinct from new.status then
    if public.order_has_provider_session(new.id) then
      -- Held deliberately. Reconciliation (or a terminal provider webhook) is
      -- the only thing that may release it.
      null;
    else
      perform public.release_upgrade_credit(new.id, 'order_cancelled_no_session');
    end if;
  end if;

  if new.status = 'refunded' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(new.id, true, false);
  end if;

  if new.status = 'chargeback' and old.status is distinct from new.status then
    perform public.restore_upgrade_credit_after_refund(new.id, false, true);
  end if;

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

/**
 * The safe cancellation entry point.
 *
 * No provider session  -> cancel immediately and release every hold.
 * Provider session      -> record the REQUEST, retain all financial holds, and
 *                          leave the order pending for reconciliation. The
 *                          caller must not treat this as a completed cancel.
 *
 * Idempotent: repeating either path changes nothing further.
 */
create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_reason text default 'user_requested'
)
returns table(outcome text, cancelled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status::text into v_status from public.orders where id = p_order_id;

  if v_status is null then
    outcome := 'order_not_found'; cancelled := false;
    return next; return;
  end if;

  if v_status <> 'pending' then
    -- Already terminal (paid, fulfilled, cancelled...). Nothing to do, and
    -- certainly nothing to release.
    outcome := 'not_pending_' || v_status; cancelled := false;
    return next; return;
  end if;

  if public.order_has_provider_session(p_order_id) then
    update public.orders
    set cancellation_requested_at = coalesce(cancellation_requested_at, now()),
        cancellation_requested_reason = coalesce(cancellation_requested_reason, p_reason)
    where id = p_order_id;

    outcome := 'cancellation_requested_pending_reconciliation'; cancelled := false;
    return next; return;
  end if;

  -- No session was ever created: nothing could have been charged.
  perform public.mark_order_unpaid_closed(p_order_id, p_reason);
  perform public.release_store_credit_for_order(p_order_id);
  perform public.release_upgrade_credit(p_order_id, p_reason);

  outcome := 'cancelled_no_provider_session'; cancelled := true;
  return next;
end;
$$;

revoke all on function public.request_order_cancellation(uuid, text) from public, anon, authenticated;
grant execute on function public.request_order_cancellation(uuid, text) to service_role;

-- Reconciliation must also pick up orders whose cancellation was requested but
-- could not be completed without a provider verdict. The OUT columns change, so
-- the old signature must be dropped rather than replaced.
drop function if exists public.upgrade_reservations_needing_reconciliation(integer);

create or replace function public.upgrade_reservations_needing_reconciliation(p_limit integer default 20)
returns table(reservation_id uuid, order_id uuid, provider_session_id text, requested_cancel boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.order_id, a.stripe_session_id, o.cancellation_requested_at is not null
  from public.upgrade_credit_reservations r
  join public.orders o on o.id = r.order_id
  left join lateral public.checkout_attempt_for_order(r.order_id) a on true
  where r.state = 'reserved'
    and o.status = 'pending'
    and a.stripe_session_id is not null
    -- Due for a check: the hold has aged out, or a cancel is waiting on a verdict.
    and (r.expires_at <= now() or o.cancellation_requested_at is not null)
  order by o.cancellation_requested_at nulls last, r.expires_at
  limit greatest(1, p_limit)
$$;

revoke all on function public.upgrade_reservations_needing_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.upgrade_reservations_needing_reconciliation(integer) to service_role;

-- When reconciliation proves a session terminal and unpaid, the cancellation
-- that was merely REQUESTED becomes real. apply_upgrade_reconciliation already
-- calls mark_order_unpaid_closed + release_store_credit_for_order, and the
-- trigger now sees a session-backed cancel... which would NOT release. So the
-- release is performed explicitly there instead.
create or replace function public.apply_upgrade_reconciliation(
  p_reservation_id uuid,
  p_provider_status text,
  p_provider_session_id text default null
)
returns table(outcome text, released boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.upgrade_credit_reservations%rowtype;
  v_outcome text;
  v_released boolean := false;
begin
  select * into v_res from public.upgrade_credit_reservations where id = p_reservation_id;

  if not found then
    outcome := 'reservation_not_found'; released := false;
    return next; return;
  end if;

  if v_res.state <> 'reserved' then
    outcome := 'already_' || v_res.state; released := false;
    return next; return;
  end if;

  if p_provider_status in ('paid', 'complete', 'succeeded') then
    v_outcome := 'held_payment_succeeded';

  elsif p_provider_status in ('async_pending', 'processing', 'unpaid_open', 'open') then
    v_outcome := 'held_payment_pending';

  elsif p_provider_status in ('expired_unpaid', 'payment_failed') then
    -- Authoritative terminal failure: now — and only now — is it safe to
    -- complete cancellation and release every hold.
    perform public.mark_order_unpaid_closed(v_res.order_id, 'reconciled_' || p_provider_status);
    perform public.release_store_credit_for_order(v_res.order_id);

    update public.upgrade_credit_reservations
    set state = 'released', released_at = now(),
        released_reason = 'reconciled_' || p_provider_status
    where id = p_reservation_id and state = 'reserved';

    v_outcome := 'released_' || p_provider_status;
    v_released := true;

  else
    v_outcome := 'held_unknown_provider_state';
  end if;

  insert into public.upgrade_reconciliations (
    reservation_id, order_id, provider_session_id, provider_status, outcome
  )
  values (p_reservation_id, v_res.order_id, p_provider_session_id, p_provider_status, v_outcome);

  outcome := v_outcome; released := v_released;
  return next;
end;
$$;

revoke all on function public.apply_upgrade_reconciliation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_upgrade_reconciliation(uuid, text, text) to service_role;
