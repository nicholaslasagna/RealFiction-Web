# Gameplay economy preflight (Phase 14)

Automated **read-only** readiness checks before staff enable live gameplay economy
writes (`dryRun=false`) or set `can_earn=true` in Supabase.

Preflight does **not** submit ledger transactions, mutate Vault, change RLS policy, or
deploy anything.

## Commands

Run on the target backend (console or staff with `realcore.admin`):

```text
/rf economy gameplay preflight
/rf economy gameplay preflight dryrun
/rf economy gameplay preflight live
```

- **`dryrun`** (default when the third argument is omitted): validates a safe
  dry-run rollout (`dryRun=true`, no writer enqueue, dry-run volume estimates).
- **`live`**: validates configuration and runtime health for flipping to live
  enqueue and API writes. Still does not post transactions.

## Interpreting PASS / WARN / FAIL

| Status | Meaning |
|--------|---------|
| **PASS** | Check satisfied for the selected mode. |
| **WARN** | Not blocking preflight summary by itself, but needs human review (optional plugins, unproven DB write policy, high dry-run estimates). |
| **FAIL** | Blocker. Summary stays **NOT READY** until resolved. |

**Summary**

- **READY** — no FAIL checks (WARNs may remain; read them before go-live).
- **NOT READY** — at least one FAIL; do not enable live writes until fixed.

## Dry-run preflight (typical SMP shop-sell trial)

1. Deploy RealCore with Phase 13+ observability and Phase 14 jar.
2. Keep `economy.gameplaySync.dryRun: true` and DB policy read-only per
   [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md).
3. Run `/rf economy gameplay preflight dryrun`.
4. Exercise shop sells; re-run preflight and `/rf economy gameplay` to review queue
   metrics and dry-run estimates.
5. Stop if FAIL appears, dry-run estimates spike, or duplicate/overflow counters grow.

## Live preflight (before `dryRun=false`)

1. Complete dry-run soak and staff sign-off on observability docs.
2. Apply SMP write policy SQL from
   [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md)
   (`can_earn=true`, caps, `server_id = 'smp-1'` only).
3. Set plugin config for live trial (`dryRun: false`, `shopSell` on, producer on,
   `gameplaySpend` / `shopBuy` off) per trial docs.
4. Run `/rf economy gameplay preflight live`.
5. Manually verify policy in Supabase (preflight cannot prove `can_earn` without a
   write — see below).
6. Only then flip `dryRun=false` during a staffed window.

## Stop conditions

Do **not** proceed if preflight reports:

- `anarchyBlocked` or `anarchyServerId` FAIL on Anarchy backends
- `hmacSecret` / `baseUrl` / `apiReachable` FAIL
- `producerDisabled` FAIL (live mode)
- `shopBuyDisabled` or `gameplaySpendDisabled` FAIL (live mode)
- `recentWriterFailure`, `overflowDrops`, `expiredDrops`, or `permanentRejects` FAIL
- `gameplayQueue` or `retryQueue` at capacity (FAIL) or near capacity (WARN) under load
- Live mode with `dryRun=true` or `gameplaySync.enabled=false`

## What preflight cannot prove

- **`can_earn` / `can_spend` in `economy_server_policies`** — proving write permission
  requires a ledger POST, which preflight intentionally avoids. When the read-only
  balance probe succeeds, preflight emits:

  `WARN dbPolicyWritePermissionNotProven=DB policy cannot be proven without a write; verify economy_server_policies manually.`

- **End-to-end EconomyShopGUI event capture** — only config + plugin presence.
- **No double-credit after go-live** — requires staffed monitoring and ledger review.

## Manual SQL verification (`can_earn`)

After live preflight PASS (except the DB policy WARN), run:

```sql
select server_id, server_group, enabled, can_read, can_earn, can_spend,
       max_credit_minor, max_debit_minor, max_batch_count, notes, updated_at
from public.economy_server_policies
where server_id = 'smp-1';
```

Expected for SMP shop-sell earn trial (see
[ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md)):

- `enabled = true`, `can_read = true`, `can_earn = true`
- `can_reward = false` (vote rewards stay on Lobby1 path)
- `max_credit_minor = 50000`, `max_debit_minor = 50000` (plugin still keeps spend/buy off)

Rollback SQL is in the same policy doc (§2 disable).

## Related docs

- [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md)
- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](./REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md)
