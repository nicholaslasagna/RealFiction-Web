-- The claim-confirmation email must be created BY the claim transaction.
--
-- THE DEFECT THIS FIXES
-- =====================
-- The claim route committed the claim, then inserted the confirmation outbox
-- row afterwards:
--
--   claim commits  ->  credit granted
--   outbox insert  ->  may fail
--   result         ->  value exists, no durable confirmation ever will
--
-- The previous pass isolated that insert in a try/catch so a failure could not
-- misreport a committed claim as failed. That was the right fix for the WRONG
-- half of the problem: it stopped the customer being told a lie, but it left
-- the missing email genuinely missing, with nothing to retry it. Someone gets
-- $25 of credit and no record that it happened.
--
-- An email queue exists precisely so that "the message will be sent" is a
-- durable fact established in the same transaction as the thing being
-- announced. So the insert moves inside, and the route stops doing it.
--
-- If the outbox insert fails now, the whole claim rolls back: no credential
-- consumed, no card claimed, no lot, no ledger grant. The recipient's link
-- still works and a retry grants exactly once.

create or replace function public.claim_gift_card(
  p_verifier text,
  p_user_id uuid,
  p_user_email text
)
returns table(outcome text, amount_cents bigint, gift_card_id uuid, balance_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cred public.gift_card_claim_credentials%rowtype;
  v_card public.gift_cards%rowtype;
  v_lot_id uuid;
  v_balance bigint;
begin
  outcome := 'invalid'; amount_cents := 0; gift_card_id := null; balance_cents := 0;

  if p_verifier is null or p_user_id is null then
    return next; return;
  end if;

  select * into v_cred
  from public.gift_card_claim_credentials
  where verifier = p_verifier
  for update;

  if not found then
    return next; return;
  end if;

  select * into v_card from public.gift_cards where id = v_cred.gift_card_id for update;
  if not found then
    return next; return;
  end if;

  gift_card_id := v_card.id;

  -- Already claimed by THIS account: idempotent success, no new value and no
  -- second email. The outbox row from the original claim already exists.
  if v_card.status = 'redeemed' and v_card.claimed_by = p_user_id then
    outcome := 'already_claimed_by_you';
    amount_cents := v_card.original_balance_cents;
    select coalesce(sum(delta_cents), 0) into balance_cents
    from public.store_credit_ledger where user_id = p_user_id;
    return next; return;
  end if;

  -- A consumed, rotated, or invalidated credential is indistinguishable from a
  -- wrong guess.
  if v_cred.state <> 'active' then
    return next; return;
  end if;

  if v_card.status <> 'active' then
    outcome := case
      when v_card.status = 'redeemed' then 'already_claimed'
      when v_card.status = 'void' then 'void'
      else 'invalid'
    end;
    return next; return;
  end if;

  if v_card.frozen_at is not null then
    outcome := 'frozen'; return next; return;
  end if;

  -- Recipient binding. A card addressed to someone must be claimed by an
  -- account holding that verified address.
  if v_card.recipient_email is not null
     and (p_user_email is null or lower(trim(p_user_email)) <> lower(trim(v_card.recipient_email))) then
    outcome := 'wrong_recipient'; return next; return;
  end if;

  -- Single use: the credential is spent inside this transaction, so a
  -- concurrent second claim finds it non-active and gets nothing.
  update public.gift_card_claim_credentials
  set state = 'consumed', consumed_at = now()
  where id = v_cred.id and state = 'active';

  if not found then
    outcome := 'invalid'; return next; return;
  end if;

  update public.gift_cards
  set status = 'redeemed',
      claimed_by = p_user_id,
      claimed_at = now(),
      redeemed_by = p_user_id,
      redeemed_at = now(),
      balance_cents = 0
  where id = v_card.id;

  insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
  values (
    p_user_id, v_card.original_balance_cents, 'gift_card_redemption', v_card.id::text,
    'gift_card_claim:' || v_card.id::text, 'Gift card claimed'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  if not exists (select 1 from public.store_credit_lots l where l.gift_card_id = v_card.id) then
    insert into public.store_credit_lots (
      user_id, source, gift_card_id, original_cents, remaining_cents, currency
    )
    values (
      p_user_id, 'gift_card', v_card.id,
      v_card.original_balance_cents, v_card.original_balance_cents, coalesce(v_card.currency, 'USD')
    )
    returning id into v_lot_id;
  end if;

  select coalesce(sum(delta_cents), 0) into v_balance
  from public.store_credit_ledger where user_id = p_user_id;

  -- THE CONFIRMATION, IN THIS TRANSACTION. If this insert fails, everything
  -- above rolls back with it: the credential goes back to 'active', the card
  -- goes back to 'active', and no credit was granted. The recipient's link
  -- still works and a retry grants exactly once.
  --
  -- Keyed on the card, so the unique index makes a concurrent claim's duplicate
  -- a constraint violation rather than a second email.
  insert into public.email_deliveries (idempotency_key, template, recipient, params)
  values (
    'gift_card_claimed:' || v_card.id::text,
    'gift_card_claimed',
    coalesce(nullif(trim(p_user_email), ''), v_card.recipient_email),
    jsonb_build_object(
      'amount_cents', v_card.original_balance_cents,
      'balance_cents', v_balance,
      'currency', coalesce(v_card.currency, 'USD')
      -- No secret. It has just been spent, and the confirmation has no use for it.
    )
  );

  outcome := 'claimed';
  amount_cents := v_card.original_balance_cents;
  balance_cents := v_balance;
  return next;
end;
$$;

revoke all on function public.claim_gift_card(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_gift_card(text, uuid, text) to service_role;
