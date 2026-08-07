# Gift-card legacy credential rotation

**Do not run any part of this without Nicholas's review.** It moves stored value.

Migration `202608060002_gift_card_issuance_and_legacy_removal.sql` **aborts** when
it finds a redeemable gift card carrying a legacy plaintext code:

```
ERROR: ABORT: 1 redeemable legacy gift card(s) worth 2500 cents exist.
       This migration removes the plaintext-code redemption path and would strand them.
HINT:  ... follow docs/GIFT_CARD_LEGACY_ROTATION.md ... Do not delete rows.
```

This document is what that hint points at.

## Why it aborts

Gift cards have never been enabled on the website, so a correctly-behaving
database should report **zero**. A non-zero count means either a test fixture
reached a real database, or a card was issued through a path nobody expected. In
both cases the honest response is to stop and look, not to proceed.

The migration cannot safely continue, because it removes the only mechanism by
which those cards can currently be redeemed.

## What was wrong with the legacy design

`202605300030` generated codes shaped `RF-XXXX-XXXX-XXXX`, where each group was
`gen_random_bytes(2)` — 16 bits each, **48 bits total** — and stored:

- `gift_cards.code` — the **plaintext** code, readable by the purchaser's own
  session through an RLS policy on `purchaser_user_id`; and
- `gift_cards.code_hash` — an **unkeyed SHA-256** of the normalized code.

Two consequences, and the second is the serious one:

1. A plaintext secret sat in the database indefinitely.
2. Because the hash is unkeyed and the space is 48 bits, **reading the
   `code_hash` column is equivalent to reading every code.** Exhausting 2^48
   unkeyed SHA-256 evaluations is hours of commodity GPU time. A read-only
   database leak was a total loss of unclaimed value.

`redeem_gift_card(p_code_hash, p_user_id)` also accepted a **client-computed**
hash, so possession of the hash — not the code — was sufficient to redeem.

The replacement uses a 256-bit secret that is never stored, an HMAC verifier
under a server-side pepper, and AES-256-GCM sealing for delivery.

## Preflight — read only, prints no secrets

```sql
select * from public.gift_card_legacy_preflight();
```

Returns `total_cards`, `legacy_coded`, `redeemable`, `redeemable_value_cents`.
**`redeemable` is the number that blocks the migration.**

To identify the affected rows without printing a secret:

```sql
select
  id,
  public_ref,
  purchaser_user_id,
  purchaser_order_id,
  original_balance_cents,
  balance_cents,
  status,
  created_at,
  -- Last four characters only. Enough to match a customer's screenshot;
  -- useless for redeeming.
  right(code, 4) as code_tail
from public.gift_cards
where (code is not null or code_hash is not null)
  and status = 'active'
order by created_at;
```

Never `select code` or `select code_hash` in full, never paste either into a
ticket, a chat message, or a log.

## Why rows must not be deleted

Every row is a **liability the customer may still be holding**. A gift card is
prepaid value; in several US states it is also subject to unclaimed-property
law. Deleting a row does not extinguish the obligation — it destroys the record
of it while leaving the obligation intact, which is strictly worse than the
weak credential.

Rotation replaces the *credential*. It never changes `original_balance_cents`
and never removes a card.

## Safe manual rotation

For each affected card, in one transaction per card:

1. **Record the before state.**

   ```sql
   select id, public_ref, original_balance_cents, balance_cents, status
   from public.gift_cards where id = '<card-id>';
   ```

2. **Generate a new credential in application code**, not in SQL. The secret
   must come from `createClaimCredential()` in `lib/gift-card/crypto.ts` so it
   is 256 bits, keyed against the configured pepper, and sealed under the
   configured encryption key. Do not invent a code by hand.

3. **Invalidate any existing credential and insert the new one.**

   ```sql
   begin;

   update public.gift_card_claim_credentials
   set state = 'invalidated',
       invalidated_at = now(),
       invalidated_reason = 'legacy_rotation'
   where gift_card_id = '<card-id>' and state = 'active';

   insert into public.gift_card_claim_credentials (
     gift_card_id, verifier, delivery_ciphertext, delivery_key_version,
     masked_suffix, state, issue_reason
   )
   values (
     '<card-id>', '<verifier-from-step-2>', '<ciphertext-from-step-2>', <key-version>,
     '<masked-suffix>', 'active', 'legacy_rotation'
   );

   -- Verify BEFORE committing.
   select original_balance_cents, balance_cents, status
   from public.gift_cards where id = '<card-id>';

   commit;
   ```

   The partial unique index `gift_card_credentials_one_active_idx` guarantees at
   most one active credential per card, so a mistake here fails loudly.

4. **Notify the holder.** The old code stops working the moment step 3 commits.
   Queue a delivery through the outbox — do not email by hand, and do not paste
   the new secret into the notification yourself.

## Verify value is preserved

Before and after the whole rotation, these must be identical:

```sql
select
  count(*) as cards,
  sum(original_balance_cents) as face_value,
  sum(balance_cents) filter (where status = 'active') as unclaimed_value
from public.gift_cards;
```

Also confirm every affected card has exactly one active credential:

```sql
select g.id, g.public_ref, count(c.*) filter (where c.state = 'active') as active_credentials
from public.gift_cards g
left join public.gift_card_claim_credentials c on c.gift_card_id = g.id
where g.status = 'active'
group by g.id, g.public_ref
having count(c.*) filter (where c.state = 'active') <> 1;
```

An empty result is the passing condition.

## Retry the migration

Once `redeemable` is zero — every legacy card rotated onto a new credential:

```sql
select * from public.gift_card_legacy_preflight();
```

Then re-apply `202608060002`. It will drop `code`, `code_hash`, and
`redeem_gift_card`.

## Rollback considerations

- **Before the migration commits**, rollback is free: the columns still exist.
- **After it commits**, `code` and `code_hash` are gone and cannot be restored
  from the schema. Recovery requires a database backup taken before the
  migration. Take one first.
- Rotation itself is not reversible in a useful sense: the old credential is
  invalidated deliberately. That is the point.
- Restoring a pre-rotation backup would **reactivate the weak credential**. If a
  restore is ever needed, re-run the rotation immediately afterward.

## Do not run this unattended

Everything here moves or invalidates stored value. It needs Nicholas's explicit
approval, a fresh backup, and a second person reading the preflight output —
before the first `begin;`.
