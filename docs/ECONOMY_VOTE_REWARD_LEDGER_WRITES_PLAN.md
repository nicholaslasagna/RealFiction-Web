# Phase 6D: Vote Reward Ledger Writes Plan

## 1. Goal

Document the accepted design for the first real vote reward ledger write path before implementation.

Phase 6D is separate from the Phase 6C shadow mode. Shadow mode may continue to compute and log the transaction that would be written, but real ledger writes must require a new explicit config flag and a separate delivery path.

The goal is to move vote reward economy crediting from legacy server commands toward the append-only global economy ledger without risking duplicate credits, skipped acknowledgements, Vault provider changes, or accidental Anarchy writes.

Non-goals:

- Do not change vote ingestion.
- Do not change the `reward_queue` source of truth.
- Do not register a Vault provider.
- Do not mutate EssentialsX or Vault directly, except through existing legacy `eco give` commands while fallback remains enabled.
- Do not replace existing command rewards until a later cutover.

## 2. Core Delivery Rule

A vote reward may be marked delivered and acknowledged only after one of these outcomes succeeds:

1. The real ledger write succeeds.
2. The real ledger write returns an idempotent duplicate success for the same reward id.
3. The existing legacy command fallback succeeds, if fallback is explicitly enabled.

`RewardPoller` ordering must remain:

1. Claim reward from the website.
2. Dispatch local/economy delivery.
3. Return delivered only after ledger success, duplicate success, or fallback success.
4. Call local `markDelivered`.
5. Queue acknowledgement to the website.

No ack may be sent for a vote reward whose ledger write failed unless fallback command delivery also succeeded.

## 3. New Config Flags

Do not reuse shadow-only flags for real writes.

Existing shadow flags stay observation-only:

```yaml
economy:
  voteRewardsToLedger: false
  voteRewardsLedgerDryRun: true
```

Add new real-write flags:

```yaml
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Defaults must be inert and rollback-friendly:

- `voteRewardsLedgerWritesEnabled: false`
- `voteRewardsLedgerFallbackCommands: true`

Behavior matrix:

| Writes enabled | Fallback commands | Behavior |
| --- | --- | --- |
| `false` | `true` | Current legacy command delivery only. Shadow may observe separately. |
| `false` | `false` | Current behavior should still be legacy-only unless a later PR explicitly defines command removal semantics. |
| `true` | `true` | Try ledger first; if it fails, run existing commands as fallback. |
| `true` | `false` | Ledger-only cutover. Ledger failure means no delivered result and no ack. |

Malformed or missing config must fail safe: no real ledger writes unless the new explicit real-write flag is true.

## 4. Delivery Flow

For each delivered reward:

1. Poll and claim behavior stays unchanged.
2. `reward_queue` remains the authoritative source of the reward id, reward key, target player, attempts, and targeting.
3. `RewardDispatcher` checks whether the reward key has an economy mapping under `rewards.economy.byRewardKey`.
4. If there is no mapping, existing reward command behavior stays unchanged.
5. If the reward is mapped and `economy.voteRewardsLedgerWritesEnabled` is false:
   - Run existing configured commands exactly as today.
   - Shadow mode may still observe/log if its separate flags are enabled.
6. If the reward is mapped and real writes are enabled:
   - Build one append-only ledger credit transaction.
   - Submit it through the economy transaction API.
   - Treat success or idempotent duplicate success as delivery success.
   - Do not run legacy `eco give` commands after ledger success.
7. If the ledger write fails:
   - If fallback commands are enabled, run existing configured commands.
   - If fallback commands succeed, return delivered.
   - If fallback commands fail, return failed.
   - If fallback commands are disabled, return failed.
8. `RewardPoller` only calls `markDelivered` and ack after `RewardDispatcher` returns delivered.

The ledger write path must not alter reward ordering relative to existing command delivery. It only changes what must succeed before the existing delivered/ack transition is reached.

## 5. Idempotency Key Format

Use the reward id as the idempotency source.

Recommended key:

```text
reward:<rewardId>:<rewardKey>:<currencyKey>
```

Required transaction fields:

```text
externalRefType = reward_queue
externalRefId   = <rewardId>
source          = vote_reward
```

Rules:

- Replaying the same reward id must be safe.
- Duplicate success from the API/DB counts as delivery success.
- Different reward ids must never share an idempotency key.
- Currency key is lowercased and validated before submission.
- The ledger is append-only. Rollbacks or corrections use compensating entries, never in-place edits.

## 6. Fallback Behavior

Legacy command fallback exists to make the first real-write rollout reversible.

When fallback is enabled:

1. Try ledger write first.
2. If ledger succeeds or duplicate-succeeds, do not run `eco give`.
3. If ledger fails, run the same command list that would run today.
4. If fallback commands succeed, return delivered and allow `markDelivered`/ack.
5. Log fallback usage with reward id, reward key, player label, and failure category.

When fallback is disabled:

- Ledger success or duplicate success is required.
- Ledger failure returns failed.
- The reward is not marked delivered and is not acked.
- Existing reward retry behavior handles the next attempt.

Legacy `eco give` commands must remain available until cutover and must not be removed in the first real-write PR.

## 7. Anarchy Block

Anarchy must be blocked in two places.

Plugin-side:

- If `server.group` is `anarchy`, refuse real vote reward ledger writes before any API request is made.
- Log a clear policy message.
- Do not enqueue or submit economy transactions from Anarchy.
- Shadow mode may continue to report skipped/refused mappings.

API/DB-side:

- The economy transaction route/RPC must reject mutation requests with `serverGroup = anarchy`.
- This guard must not trust the plugin as the only enforcement point.
- Rejection should be a policy error and must not create a ledger row.

The API/DB guard is required before enabling real ledger writes in production.

## 8. No Vault/EssentialsX Mutation Rule

The real ledger write path must not:

- Register a Vault provider.
- Call Vault `depositPlayer`, `withdrawPlayer`, `createPlayerAccount`, or equivalent mutation APIs.
- Call EssentialsX balance mutation APIs.
- Read-modify-write local player balances.
- Run background Vault sync automatically.

The only allowed local balance mutation during Phase 6D is the existing legacy command path, such as `eco give`, and only when fallback is enabled.

## 9. Likely Files To Change Later

RealCore production files:

- `realcore/src/main/java/com/realfiction/realcore/config/EconomyConfig.java`
- `realcore/src/main/resources/config.yml`
- `realcore/src/main/java/com/realfiction/realcore/economy/VoteRewardLedgerWriteService.java` (new)
- `realcore/src/main/java/com/realfiction/realcore/economy/VoteRewardLedgerShadowService.java` (only if sharing builder logic is justified)
- `realcore/src/main/java/com/realfiction/realcore/rewards/RewardDispatcher.java`
- `realcore/src/main/java/com/realfiction/realcore/RealCorePlugin.java`
- `realcore/src/main/java/com/realfiction/realcore/command/RealFictionCommand.java`

Website/API files if server-side enforcement is not already sufficient:

- `app/api/plugin/economy/transactions/route.ts`
- Economy transaction validation helpers under `lib/`

Supabase files if DB-side enforcement is missing:

- A new additive migration for API/RPC policy hardening.
- No modification to already-applied migrations.
- No `reward_queue` schema change unless explicitly planned in a separate migration review.

Test files:

- `realcore/src/test/java/com/realfiction/realcore/config/EconomyConfigTest.java`
- `realcore/src/test/java/com/realfiction/realcore/economy/VoteRewardLedgerWriteServiceTest.java` (new)
- `realcore/src/test/java/com/realfiction/realcore/rewards/RewardDispatcherTest.java` (new or expanded)
- Website/API tests for Anarchy rejection and idempotent duplicate handling, if the project has route/RPC test coverage available.

## 10. Required Tests

Config tests:

- Real write flag defaults false.
- Fallback flag defaults true.
- Shadow flags remain separate and do not enable writes.
- Missing `economy:` section is safe.
- Malformed values do not enable writes accidentally.

Ledger write tests:

- Mapped vote reward builds the expected append-only transaction.
- Idempotency key uses reward id, reward key, and currency key.
- API success returns delivered.
- API duplicate success returns delivered.
- API failure with fallback enabled runs legacy commands.
- API failure with fallback disabled returns failed.
- Anarchy returns failed/refused before any API request.
- Missing mapping falls back to existing command behavior.
- Missing or invalid UUID does not write and follows configured fallback behavior.

Ordering tests:

- `RewardDispatcher` returns delivered only after ledger success, duplicate success, or fallback success.
- `RewardPoller.markDelivered` remains after dispatcher success.
- Ack remains after `markDelivered`.
- Existing already-delivered reward re-ack behavior remains unchanged.

Legacy command tests:

- Existing `eco give` commands still run when real writes are disabled.
- Existing `eco give` commands run when ledger fails and fallback is enabled.
- Existing `eco give` commands do not run after ledger success.

No-mutation tests:

- Real write service does not call Vault or EssentialsX.
- No Vault provider registration occurs.
- No direct Vault/EssentialsX mutation methods are referenced from the ledger write path.

API/DB tests:

- API/DB rejects Anarchy write attempts.
- Duplicate idempotency key returns duplicate success.
- Append-only behavior is preserved.
- No update/delete path is required for rollback.

## 11. Rollout Flags and Stages

Stage 0: Merge implementation with inert defaults.

```yaml
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Stage 1: Shadow-only observation.

```yaml
economy:
  voteRewardsToLedger: true
  voteRewardsLedgerDryRun: true
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Stage 2: Real writes with fallback.

```yaml
economy:
  voteRewardsLedgerWritesEnabled: true
  voteRewardsLedgerFallbackCommands: true
```

Stage 3: Cutover candidate.

```yaml
economy:
  voteRewardsLedgerWritesEnabled: true
  voteRewardsLedgerFallbackCommands: false
```

Do not remove legacy commands in Stage 3. Leave them configured but disabled by logic so rollback is a config-only change.

Stage 4: Separate cleanup PR after sustained confidence.

- Remove or disable legacy `eco give` command mappings only after reconciliation proves ledger correctness.
- Keep a documented emergency fallback option.

## 12. Stop Conditions

Stop rollout and disable real writes if any of these occur:

- A reward is acked without ledger success, duplicate success, or fallback success.
- Anarchy attempts reach the API/DB mutation path.
- API/DB accepts an Anarchy write.
- Duplicate success is returned for a different reward id.
- Ledger write failures are not falling back when fallback is enabled.
- Fallback commands run after ledger success.
- Vault or EssentialsX mutation occurs outside existing legacy command execution.
- Ledger rows are updated or deleted instead of appended/compensated.
- Observed ledger amounts do not match existing reward amounts.
- Error rate or fallback rate exceeds the rollout threshold.
- Any sensitive token or HMAC material appears in logs.

## 13. Rollback Plan

Fast rollback is config-only:

```yaml
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Then reload/restart RealCore according to the normal deployment process.

Rollback rules:

- Do not delete ledger rows.
- Do not edit ledger rows in place.
- Use compensating entries for any economic correction.
- Keep the reward id idempotency keys intact so future retries cannot double-credit.
- Existing `eco give` commands remain available for immediate fallback.

If real writes were partially enabled:

1. Disable real writes.
2. Leave fallback enabled.
3. Reconcile ledger entries against delivered rewards.
4. Add compensating entries for confirmed over/under-crediting.
5. Only re-enable after the root cause is fixed and tested.

## 14. Follow-Up PRs Before Full Cutover

Before removing or disabling legacy `eco give` delivery, ship separate reviewed PRs for:

- API/DB Anarchy hard-block verification.
- Idempotent duplicate success contract documented at the API boundary.
- Admin-visible counters for ledger success, duplicate success, fallback, failures, and Anarchy refusals.
- Reconciliation report comparing ledger credits to historical vote reward command amounts.
- Alerting or log queries for fallback rate and ledger write failures.
- Staff runbook for rollback and compensating entries.
- Final cutover PR that disables legacy command delivery only after sustained successful real-write operation.
