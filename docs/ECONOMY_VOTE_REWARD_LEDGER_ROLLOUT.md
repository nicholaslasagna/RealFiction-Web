# Vote Reward Ledger Writes Staging Rollout

This checklist is for staging the Phase 6E vote reward ledger write path after PR #37. It is documentation only. Do not use it as approval to deploy, run migrations, install a jar, or change live config without an explicit rollout decision.

## 1. Current Safe State After PR #37

PR #37 is merged with inert defaults:

```yaml
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

In this state, mapped vote rewards still use the existing command path, including configured `eco give` commands. The real ledger write service is loaded but cannot submit a vote reward ledger transaction unless the explicit `voteRewardsLedgerWritesEnabled` flag is set to `true`.

The shadow flags remain separate:

```yaml
economy:
  voteRewardsToLedger: false
  voteRewardsLedgerDryRun: true
```

Shadow mode does not enable real writes.

## 2. Preflight Checks Before Jar Install

Before installing any new RealCore jar on staging:

1. Confirm the target backend is Lobby1 only:
   - `server.id: "lobby-1"`
   - `server.group: "lobby"`
   - `modules.rewards: true`
   - `modules.economy: true`
   - `economy.enabled: true`
2. Confirm Anarchy remains disabled:
   - `server.group` must not be `anarchy`.
   - Do not install this rollout config on Anarchy.
3. Confirm `rewards.economy.byRewardKey.vote.standard` exists and matches the intended amount.
4. Confirm legacy fallback commands remain configured under `rewards.commands.byRewardKey.vote.standard`.
5. Confirm the website has the economy API route available: `/api/plugin/economy/transactions`.
6. Confirm production/staging database has migrations 018 and 019 applied before enabling writes.
7. Confirm no live config has `economy.voteRewardsLedgerWritesEnabled=true` yet.

## 3. Jar Install Steps With Writes Still Disabled

Install the PR #37 RealCore jar to staging Lobby1 with writes still disabled:

```yaml
economy:
  enabled: true
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Restart or reload RealCore using the normal staging process.

Expected behavior while disabled:

- Vote rewards still run the existing configured commands.
- No vote reward ledger transaction API call is submitted.
- `/rf economy` shows vote reward ledger writes as disabled.
- Existing reward delivery and ack behavior remains unchanged.

## 4. Verify `/rf status` and `/rf economy`

Run from a console or authorized in-game admin account:

```text
/rf status
/rf economy
```

Expected `/rf status` checks:

- RealCore is loaded.
- Server id is `lobby-1`.
- Server group is `lobby`.
- Rewards module is on.
- Economy module is on only for the staging Lobby1 rollout.

Expected `/rf economy` checks with writes disabled:

- Global economy client is enabled only on staging Lobby1.
- Vote reward ledger writes are `disabled`.
- Fallback commands are `enabled`.
- Success, duplicate, failure, and fallback counters are all `0` before the test.
- No Vault provider registration is reported by RealCore.

## 5. DB Policy Requirements For Lobby1 Only

The database policy must allow vote reward writes from `lobby-1` only. Do not enable Arcade, SMP, Factions, or Anarchy for this first rollout.

Verify policy rows:

```sql
select
  server_id,
  server_group,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend,
  max_credit_minor,
  max_debit_minor,
  max_batch_count,
  notes
from public.economy_server_policies
where server_id in ('lobby-1', 'arcade-1', 'smp-1', 'factions-1', 'anarchy-1')
order by server_id;
```

Required staging policy state before enabling writes:

- `lobby-1`: `server_group='lobby'`, `enabled=true`, `can_reward=true`, `max_credit_minor` at least the configured `vote.standard` amount, and `max_batch_count >= 1`.
- `lobby-1`: `can_earn=false` and `can_spend=false` unless a separate reviewed rollout explicitly enables those categories.
- `arcade-1`, `smp-1`, `factions-1`: not enabled for vote rewards during this first staging rollout.
- `anarchy-1`: must remain disabled and must not have reward mutation permissions.

If staging policy must be enabled for Lobby1, review and apply only a Lobby1-scoped policy change:

```sql
update public.economy_server_policies
set
  enabled = true,
  can_read = true,
  can_reward = true,
  can_earn = false,
  can_spend = false,
  max_credit_minor = greatest(max_credit_minor, 25000),
  max_debit_minor = 0,
  max_batch_count = greatest(max_batch_count, 1),
  notes = 'Staging Lobby1 vote reward ledger rollout only.',
  updated_at = now()
where server_id = 'lobby-1'
  and server_group = 'lobby';
```

Do not run this SQL against production unless separately approved for production rollout.

## 6. First Enablement Mode

After jar install verification and DB policy verification, the first enablement mode is:

```yaml
economy:
  enabled: true
  voteRewardsLedgerWritesEnabled: true
  voteRewardsLedgerFallbackCommands: true
```

This means:

- RealCore tries the ledger write first.
- Ledger applied success marks the reward delivered.
- Ledger duplicate success marks the reward delivered.
- Ledger failure runs the existing fallback commands.
- Fallback success marks the reward delivered.
- Fallback disabled is not part of first enablement.

Reload or restart RealCore using the normal staging process after changing config.

## 7. Test Plan For One `vote.standard` Reward

Use exactly one staging vote reward for a real test player.

Before the vote:

1. Record the player UUID and username.
2. Record `/rf economy` counters.
3. Record current ledger state for that player.
4. Confirm fallback commands remain configured.

Submit or enqueue one `vote.standard` reward through the normal staging vote flow.

Expected delivery:

1. `RewardPoller` claims the reward.
2. `RewardDispatcher` detects the `vote.standard` economy mapping.
3. `VoteRewardLedgerWriteService` submits one economy transaction.
4. On ledger success, the legacy `eco give` command is skipped.
5. `RewardPoller` marks the reward delivered locally.
6. `RewardPoller` queues and sends the normal reward ack.

If the ledger write fails during this first enablement mode, fallback commands should run and the reward should still be delivered through the existing path.

## 8. Expected Counters And Logs

After one successful ledger write:

```text
/rf economy
```

Expected counters:

- Success: increases by `1`.
- Duplicate success: unchanged.
- Failures: unchanged.
- Fallbacks: unchanged.

Expected log shape:

```text
Vote reward ledger write applied: rewardKey=vote.standard rewardId=<reward_id> applied=1
Delivered reward vote.standard -> <player>
Acknowledged rewardId=<reward_id> status=delivered duplicate=false
```

If fallback is used:

- Failures: increases by `1`.
- Fallbacks: increases by `1`.
- Existing fallback command runs.

Expected fallback log shape:

```text
Vote reward ledger write failed: rewardKey=vote.standard rewardId=<reward_id> error=<reason>
Vote reward ledger fallback commands running: rewardKey=vote.standard rewardId=<reward_id> reason=<reason>
```

Logs must not include HMAC secrets, plugin secrets, or request signatures.

## 9. Ledger Verification SQL

Replace placeholders before running.

Find the transaction for the test reward:

```sql
select
  id,
  minecraft_uuid,
  minecraft_username,
  currency_key,
  amount_minor,
  category,
  reason,
  idempotency_key,
  source,
  source_server_id,
  source_server_group,
  external_ref_type,
  external_ref_id,
  metadata,
  created_at
from public.economy_transactions
where external_ref_type = 'reward_queue'
  and external_ref_id = '<reward_id>'
order by created_at desc;
```

Expected:

- Exactly one applied ledger transaction for the reward id.
- `category = 'vote_reward'`.
- `external_ref_type = 'reward_queue'`.
- `external_ref_id = '<reward_id>'`.
- `idempotency_key = 'reward:<reward_id>:vote.standard:realfiction_main'`.
- `source_server_id = 'lobby-1'`.
- `source_server_group = 'lobby'`.
- `amount_minor` equals the configured `vote.standard` amount.
- `metadata->>'source' = 'vote_reward_ledger'`.

Verify player balance movement:

```sql
select
  minecraft_uuid,
  minecraft_username,
  currency_key,
  balance_minor,
  updated_at
from public.economy_balances
where minecraft_uuid = '<minecraft_uuid>'
  and currency_key = 'realfiction_main';
```

Verify no Anarchy writes:

```sql
select
  id,
  source_server_id,
  source_server_group,
  external_ref_type,
  external_ref_id,
  created_at
from public.economy_transactions
where lower(coalesce(source_server_group, '')) = 'anarchy'
   or source_server_id = 'anarchy-1'
order by created_at desc
limit 20;
```

Expected: no rows for this rollout.

## 10. Duplicate And Retry Verification

The idempotency key is stable:

```text
reward:<rewardId>:<rewardKey>:<currencyKey>
```

For a retry of the same reward id, the API/DB should return duplicate success rather than applying a second credit. Verification options:

1. Prefer observing a natural retry in staging by temporarily blocking ack after the local delivery, if that can be done safely without changing production behavior.
2. If using a direct staging API smoke test, submit the same transaction idempotency key and external ref twice with different batch ids, using staging-only HMAC credentials and a staging reward id.

Verification SQL:

```sql
select
  idempotency_key,
  external_ref_type,
  external_ref_id,
  count(*) as transaction_count,
  sum(amount_minor) as total_amount_minor,
  min(created_at) as first_seen_at,
  max(created_at) as last_seen_at
from public.economy_transactions
where idempotency_key = 'reward:<reward_id>:vote.standard:realfiction_main'
group by idempotency_key, external_ref_type, external_ref_id;
```

Expected after duplicate/retry:

- `transaction_count = 1`.
- `total_amount_minor` equals one vote reward amount.
- `/rf economy` duplicate counter increases if the plugin observed the duplicate response.
- No fallback command runs after duplicate success.

## 11. Stop Conditions

Immediately stop rollout and set `voteRewardsLedgerWritesEnabled=false` if any of these occur:

- A vote reward is acknowledged without ledger success, duplicate success, or fallback success.
- Legacy `eco give` runs after ledger success.
- Ledger failure does not run fallback while fallback is enabled.
- Fallback disabled is found on staging before cutover approval.
- Any Anarchy server submits or applies an economy transaction.
- Any non-Lobby1 server applies a vote reward transaction.
- More than one ledger transaction exists for the same reward idempotency key.
- `amount_minor` does not match the configured reward amount.
- `external_ref_type` or `external_ref_id` is missing or incorrect.
- Sensitive auth material appears in logs.
- Vault provider registration or direct Vault/EssentialsX mutation appears outside the existing command fallback path.

## 12. Fast Rollback Config

Fast rollback is config-only:

```yaml
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

Then reload or restart RealCore using the normal staging process.

Rollback rules:

- Do not delete ledger rows.
- Do not edit ledger rows in place.
- Keep fallback commands configured.
- Use compensating ledger entries for any confirmed correction.
- Keep reward id idempotency keys intact so retries cannot double-credit.

## 13. Cutover Criteria Before Fallback Can Ever Be Disabled

Do not set `economy.voteRewardsLedgerFallbackCommands=false` until all criteria are met:

- A sustained staging window has zero unexpected ledger failures.
- Duplicate/retry verification proves one credit per reward id.
- `/rf economy` counters show no unexplained fallback usage.
- SQL reconciliation shows one matching ledger row per tested reward id.
- No Anarchy or non-Lobby1 mutation attempts are observed.
- Staff can perform fast rollback from memory or the runbook.
- Legacy commands remain configured even after fallback is disabled, so rollback is still config-only.
- A separate approval explicitly authorizes ledger-only cutover.

## 14. Warning: Do Not Enable On Anarchy

Never enable real vote reward ledger writes on Anarchy.

Required Anarchy state:

```yaml
server:
  group: "anarchy"
economy:
  voteRewardsLedgerWritesEnabled: false
  voteRewardsLedgerFallbackCommands: true
```

The plugin refuses Anarchy before API submission, and the database policy also rejects Anarchy mutation requests. Treat either guard firing as a stop-condition event that needs investigation.
