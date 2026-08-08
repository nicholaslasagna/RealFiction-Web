-- Cash-redemption completion safety.
--
-- The application derives p_paid_out_cents from this exact request's
-- cash_redemption_requests.frozen_cents. Keep the invariant in the canonical
-- resolver as well, so a service-role caller cannot record a mismatched amount.
-- This replaces the existing function without changing its signature, state
-- machine, accounting operations, notification outbox, or execute grants.

begin;

create or replace function public.resolve_cash_redemption(
  p_request_id uuid,
  p_state text,
  p_note text default null,
  p_paid_out_cents bigint default 0
)
returns table(outcome text, released_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.cash_redemption_requests%rowtype;
  v_release bigint := 0;
begin
  select * into v_req from public.cash_redemption_requests where id = p_request_id for update;
  if not found then
    outcome := 'not_found'; released_cents := 0; return next; return;
  end if;

  if v_req.state in ('completed', 'rejected', 'ineligible') then
    outcome := 'already_final'; released_cents := 0; return next; return;
  end if;

  if p_state not in ('eligibility_review', 'eligible', 'ineligible', 'manual_payout_required', 'completed', 'rejected') then
    outcome := 'invalid_state'; released_cents := 0; return next; return;
  end if;

  if p_state = 'completed' and v_req.state <> 'manual_payout_required' then
    -- A payout has to have been arranged before it can be recorded as done.
    outcome := 'payout_not_authorized'; released_cents := 0; return next; return;
  end if;

  if p_state = 'completed' and coalesce(p_paid_out_cents, 0) <> v_req.frozen_cents then
    -- Completion must describe the exact amount frozen on this request. The
    -- request amount, not the lot total or caller input, is authoritative.
    outcome := 'payout_amount_mismatch'; released_cents := 0; return next; return;
  end if;

  perform pg_advisory_xact_lock(hashtext('creditlots:' || v_req.claimant_user_id::text));

  if p_state in ('ineligible', 'rejected') then
    v_release := v_req.frozen_cents;
    if v_release > 0 and v_req.lot_id is not null then
      update public.store_credit_lots
      set frozen_cents = greatest(0, frozen_cents - v_release)
      where id = v_req.lot_id;
    end if;
  end if;

  if p_state = 'completed' then
    -- The value leaves the account for good: it was paid in cash. The freeze
    -- becomes a removal, so the balance and the lot agree.
    if v_req.lot_id is not null then
      update public.store_credit_lots
      set remaining_cents = greatest(0, remaining_cents - v_req.frozen_cents),
          frozen_cents = greatest(0, frozen_cents - v_req.frozen_cents)
      where id = v_req.lot_id;
    end if;

    insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
    values (
      v_req.claimant_user_id, -v_req.frozen_cents, 'manual_revoke', v_req.id::text,
      'cash_redemption:' || v_req.id::text, 'Redeemed for cash'
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  update public.cash_redemption_requests
  set state = p_state,
      review_note = coalesce(p_note, review_note),
      ineligible_reason = case when p_state = 'ineligible' then coalesce(p_note, 'reviewed') else ineligible_reason end,
      frozen_cents = case when p_state in ('ineligible', 'rejected', 'completed') then 0 else frozen_cents end,
      paid_out_cents = case when p_state = 'completed' then greatest(0, coalesce(p_paid_out_cents, 0)) else paid_out_cents end,
      decided_at = coalesce(decided_at, now()),
      completed_at = case when p_state = 'completed' then now() else completed_at end
  where id = p_request_id;

  -- Only the states a customer should hear about. `eligibility_review`,
  -- `eligible`, and `manual_payout_required` are internal progress and send
  -- nothing.
  if p_state in ('ineligible', 'rejected') then
    perform public.enqueue_cash_redemption_email(p_request_id, 'cash_redemption_closed');
  elsif p_state = 'completed' then
    perform public.enqueue_cash_redemption_email(p_request_id, 'cash_redemption_completed');
  end if;

  outcome := p_state; released_cents := v_release;
  return next;
end;
$$;

revoke all on function public.resolve_cash_redemption(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.resolve_cash_redemption(uuid, text, text, bigint) to service_role;
alter function public.resolve_cash_redemption(uuid, text, text, bigint) owner to postgres;

commit;
