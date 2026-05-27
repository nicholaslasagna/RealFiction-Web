# Phase 28: Generic gameplay economy dry-run simulator

Admin-only command to submit synthetic `gameplay_earn` / `gameplay_spend` events into
`GenericGameplayEconomyProducerService` for observability, validation, idempotency,
and rejection testing. **This is not real gameplay integration.**

## Purpose

- Exercise generic producer dry-run without quests, shops, or Vault hooks.
- Verify `[GameplaySync:DRYRUN]` logs and `/rf economy gameplay producers` metrics.
- Confirm idempotency and allowlist rejection paths before any feature wires `submit()`.
- Prove no DB ledger rows, HTTP writes, or Vault mutation during dry-run.

## Command syntax

Requires `realcore.admin` (same as other `/rf economy` commands). Console allowed;
normal players denied.

```text
/rf economy gameplay simulate earn <player|uuid> <amountMinor> <source> <eventId>
/rf economy gameplay simulate spend <player|uuid> <amountMinor> <source> <eventId>
```

Example:

```text
/rf economy gameplay simulate earn Alex 100 manual_simulator test-event-1
```

Response fields: accepted/rejected, category, amountMinor, source, eventId, dryRun,
idempotency key (safe to print), rejection reason when applicable.

Player must be **online** unless a valid UUID is passed (offline UUID resolves name
from the argument).

## Default safety (unchanged)

| Setting | Default |
|---------|---------|
| `economy.gameplaySync.generic.enabled` | `false` → command rejects until enabled |
| `economy.gameplaySync.generic.dryRun` | `true` |
| `allowGameplayEarn` / `allowGameplaySpend` | `false` |
| `allowedSources` | `[]` |

No Vault mutation, no reward delivery, no shop producers, no vote_reward path.

## Dry-run test config (SMP lab only)

```yaml
economy:
  gameplaySync:
    enabled: true
    dryRun: true
    generic:
      enabled: true
      dryRun: true
      allowedSources:
        - manual_simulator
      allowGameplayEarn: true
      allowGameplaySpend: true
      logEvents: true
```

Also ensure `server.id` is in `economy.gameplaySync.backendAllowlist`, categories
`gameplayEarn` / `gameplaySpend` enabled as needed, and `modules.economy` +
`economy.enabled` true.

## Expected behavior (dry-run)

1. Command: `Simulator: accepted (dry-run)` with idempotency key.
2. Log: `[GameplaySync:DRYRUN] server=... category=gameplay_earn|gameplay_spend ...`
3. `/rf economy gameplay producers` → **genericGameplay** captured/dry-run counters increase; **queued** stays `0`.
4. No HTTP batch to platform economy API for generic dry-run.
5. No Vault balance change for the player.

## SQL verification (no ledger rows)

During dry-run on a test server, ledger should not gain generic rows:

```sql
SELECT id, category, source, player_uuid, amount_minor, created_at
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND source = 'manual_simulator'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
```

Expect **zero rows** while `generic.dryRun: true` and global `gameplaySync.dryRun: true`.

## Stop conditions

- Any `queued` > 0 on generic producer during simulator testing → stop, set `generic.enabled: false`, investigate config (`dryRun` accidentally false).
- Unexpected `gameplay_earn` / `gameplay_spend` rows with `manual_simulator` in production DB.
- Vote reward or shop producer metrics change during simulator-only window.
- Anarchy server group used for simulator (hard-rejected).

## Rollback

1. Set `economy.gameplaySync.generic.enabled: false` (or remove `manual_simulator` from `allowedSources`).
2. Reload RealCore.
3. Confirm `/rf economy gameplay producers` shows generic disabled.

## Live mode warning

Setting `generic.dryRun: false` or global `gameplaySync.dryRun: false` may enqueue real
writer batches. **Not approved for this phase.** Follow preflight, policy, and
[ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md)
before any live trial.

## Implementation

| Component | Role |
|-----------|------|
| `GameplayEconomySimulateCommand` | `/rf economy gameplay simulate ...` |
| `GameplayEconomySimulatorService` | Builds `GameplayEconomyEvent`, calls `genericProducer.submit()` |

## Related docs

- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md)
- [ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md)
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md)
