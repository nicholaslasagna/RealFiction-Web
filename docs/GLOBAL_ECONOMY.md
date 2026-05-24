# RealFiction Global Economy Foundation

This document describes the DB-owned economy foundation added after migration
017. It is intentionally foundation-only: RealCore does not write to these
routes until a later approved RealCore phase enables `economy.enabled: true`.

## Currency scale

Economy balances use integer minor units only:

- `$1.00 = 100`
- `$250.00 = 25000`

Do not store or compare floating-point balances in database tables or RPCs.

## What exists in v1

- Append-only `economy_ledger`
- Cached `economy_balances` maintained only by RPCs
- `economy_transaction_batches` for batch retry idempotency
- `economy_server_policies` enforced inside the DB/RPC layer
- `economy_admin_audit` for future staff adjustments
- HMAC plugin routes:
  - `POST /api/plugin/economy/transactions`
  - `POST /api/plugin/economy/balance`

There is no public economy endpoint in v1.

## What is separate

`money.total` is still a private diagnostic stat mirror from Vault/EssentialsX.
It is not canonical and is not part of the economy ledger.

Existing vote rewards still use the established reward delivery flow. This
foundation does not change `reward_queue`, RealCore reward polling, or the
current `eco give` command rewards.

## Server policy

Every plugin economy write is checked against `economy_server_policies`.
Policy is enforced server-side, so a bad plugin config cannot grant itself
economy power.

Policy fields:

- `enabled`
- `can_read`
- `can_reward`
- `can_earn`
- `can_spend`
- `max_credit_minor`
- `max_debit_minor`
- `max_batch_count`

Category gates:

- `vote_reward` requires `can_reward`
- `gameplay_earn` requires `can_earn`
- `spend` requires `can_spend`
- `admin_adjustment` is not accepted by plugin routes
- `migration_import` is not accepted by plugin routes

Anarchy is blocked from mutations by the RPC policy checks even if the request
is signed with a valid plugin HMAC.

## Idempotency

The write path uses two layers:

1. `batch_id` in `economy_transaction_batches` for retry detection.
2. `idempotency_key` on each ledger transaction for individual duplicate
   protection.

Retries should reuse the same `batch_id` and the same per-transaction
`idempotency_key` values.

## Negative balances

V1 rejects any transaction that would make a balance negative. There is no
overdraft support.

## Rollout notes

1. Apply the additive migration in staging first.
2. Keep all server policies disabled initially.
3. Verify plugin HMAC calls against disabled policy return safe rejections.
4. Enable `can_read` on one staging backend and test balance reads.
5. Enable one write capability with conservative limits only after review.
6. Do not enable Anarchy mutations.
7. Do not replace Vault/EssentialsX or make RealCore a Vault provider in this
   phase.

Future phases can add RealCore buffered economy writing, import tooling, and
controlled producer migration after this foundation is validated.

## Phase 4C balance audit comparison

Before any migration import, staff should compare the read-only Vault balance
exports from Lobby1, SMP, Factions, and Arcade and choose one canonical source
in writing. Use [Economy Balance Audit Comparison](./ECONOMY_BALANCE_AUDIT.md)
for the report template, duplicate/missing player rules, anomaly checks, and
rollback/import readiness checklist.

## Migration imports

Migration imports are admin/service-only. They are not accepted by plugin
economy routes and do not change RealCore, Vault, EssentialsX, rewards, or
gameplay producers.

The approved import path is:

```text
POST /api/admin/economy/import
```

Accepted operations:

- `import`: import reviewed canonical target balances as `migration_import`
  ledger entries.
- `rollback`: create compensating `migration_import` entries for a previous
  import batch.

Both operations default to `dryRun: true`. A non-dry-run request should only be
sent after the CSV comparison report is reviewed and the import batch id,
reason, and rollback plan are recorded.

Import behavior:

- Uses integer minor units only.
- Computes a delta from current DB balance to the reviewed target balance.
- Writes append-only `economy_ledger` rows with category `migration_import`.
- Updates `economy_balances` through the service-role RPC only.
- Records actor, reason, import batch id, and metadata in ledger/audit rows.
- Uses a stable per-player idempotency key:

  ```text
  migration-import:<batch-id>:<minecraft-uuid>:<currency-key>
  ```

Rollback behavior:

- Never deletes ledger rows.
- Finds import rows from the original import batch.
- Writes equal-and-opposite compensating entries with stable rollback
  idempotency keys.
- Rejects rollback if compensation would create a negative balance.

The optional service-token path uses `ECONOMY_IMPORT_SERVICE_SECRET`. Browser
users must still be authenticated as staff/admin/owner; service scripts must
provide the import secret. Both paths execute service-role-only RPCs.
