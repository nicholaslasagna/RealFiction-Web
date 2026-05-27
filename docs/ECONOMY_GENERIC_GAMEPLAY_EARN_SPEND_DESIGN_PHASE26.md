# Generic Gameplay Earn and Spend Design (Phase 26)

Design for **non-shop** gameplay economy ledger categories: `gameplay_earn`,
`gameplay_spend`, and legacy `spend`.

**Scope:** documentation only. No Java producers, migrations, Supabase policy
changes, deploy steps, or enablement of `gameplay_earn` / `gameplay_spend` in
default config.

**Context:** Shop paths (`shop_sell`, `shop_buy`) have dedicated EconomyShopGUI
producers and SMP rollout docs. This phase defines how **RealCore-owned or
explicitly integrated** systems should record quest rewards, event payouts,
minigame results, staff-approved grants, and gameplay fees.

**Authority:** [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) —
Vault authoritative in-game short-term; DB ledger records **approved** events.

**Prerequisite rollout:** SMP combined shop monitoring stable per
[ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md)
before any generic category live trial.

---

## 1. Purpose

`gameplay_earn` and `gameplay_spend` are **generic** ledger categories for
economic facts that are:

- Tied to **gameplay actions** (quests, events, minigames, approved admin flows)
- **Not** vote rewards (`vote_reward` — Lobby1 isolated path)
- **Not** EconomyShopGUI shop sell/buy (`shop_sell`, `shop_buy`)
- **Not** balance imports, mirror deltas, or shadow reconciliation

RealCore (or a reviewed integration adapter) must emit events with explicit
`source`, stable `eventId`, and allowlisted category — never infer category from
Vault balance changes alone.

---

## 2. Non-goals

| Out of scope | Notes |
|--------------|--------|
| `vote_reward` | Lobby1 `VoteRewardLedgerWriteService`; do not merge paths |
| EconomyShopGUI sell/buy | Use `shop_sell` / `shop_buy` producers |
| Historical balance imports | `migration_import` / admin import RPCs only |
| Vault polling deltas | Shadow/audit reads are not ledger events |
| Automatic Vault↔DB reconciliation | No mirror-adjustment automation |
| Anarchy | Hard refusal in RealCore and policy |
| Factions / Arcade (initially) | SMP-only candidate until separate review |
| Enabling categories in this PR | Design only |

---

## 3. Category definitions

| Category | Direction in ledger | `amount_minor` sign | Use |
|----------|---------------------|---------------------|-----|
| `gameplay_earn` | Credit | Positive | Non-shop reward: quest payout, event prize, minigame win, staff-approved grant |
| `gameplay_spend` | Debit | Negative | Non-shop cost: entry fee, ability cost, penalty, approved gameplay charge |
| `spend` | Debit | Negative | **Legacy alias** — same policy gate as `gameplay_spend`; avoid for new producers |

**Producer rule:** New integrations must use `gameplay_earn` or `gameplay_spend`.
Reserve `spend` only for backward-compatible clients already emitting that string.

Shop transactions must **never** use generic categories when `shop_sell` or
`shop_buy` apply.

See [ECONOMY_TRANSACTION_CATEGORIES.md](ECONOMY_TRANSACTION_CATEGORIES.md).

---

## 4. Allowed sources

### Future allowed sources (allowlist per producer phase)

Each source string is registered in config and code before live traffic. Examples:

| Source (illustrative) | Category | Owner |
|----------------------|----------|--------|
| `RealCoreQuests` | `gameplay_earn` | RealCore quest module |
| `RealCoreEvents` | `gameplay_earn` | Scheduled/network events |
| `RealCoreMinigames` | `gameplay_earn` / `gameplay_spend` | Per-minigame spec |
| `StaffGrant` | `gameplay_earn` | Staff-approved grant command (audited) |
| `GameplayFee` | `gameplay_spend` | RealCore fee system |
| `CustomRewardService` | `gameplay_earn` | Future reviewed service (explicit ADR) |

Allowlist lives in **producer config** (e.g. `gameplaySync.producers.<id>.allowedSources`)
in a future code phase — not enabled in Phase 26.

### Disallowed sources

| Disallowed | Why |
|------------|-----|
| Raw Vault balance differences | Not an economic fact; reconciliation is separate |
| Unknown console commands | No provenance |
| Arbitrary third-party plugin balance APIs | Unreviewed double-write risk |
| `Essentials` / `Vault` direct hooks without adapter | Use explicit integration design |
| Anarchy backends | Policy + RealCore guard |
| Unreviewed third-party plugins | Must pass security + idempotency review |
| Free-form `source` from HTTP without HMAC + schema | Injection / category spoofing |

---

## 5. Event requirements

Every proposed gameplay sync event (dry-run or live) must include:

| Field | Required | Notes |
|-------|----------|--------|
| `minecraftUuid` | Yes | Player UUID |
| `minecraftUsername` | Yes | Display name at capture time |
| `amountMinor` | Yes | Magnitude > 0; sign from category credit/debit |
| `source` | Yes | Allowlisted integration id (normalized lowercase in idempotency key) |
| `eventId` | Yes | Stable, replay-safe (see §6) |
| `category` | Yes | `gameplay_earn`, `gameplay_spend`, or legacy `spend` only |
| `reason` | Yes | Human-auditable string (quest id, event name, fee type) |
| `serverId` | Yes | From `config.server.id` (e.g. `smp-1`) |
| `serverGroup` | Yes | From `config.server.group` (e.g. `smp`) |

Optional metadata (future): quest id, event season, minigame match id — must not
replace `eventId` as the idempotency differentiator.

**Vote rewards** use a separate schema/path and must not populate these fields
through gameplay sync producers.

---

## 6. Idempotency

### Required key format

```text
gameplay:<serverId>:<category>:<source>:<playerUuid>:<eventId>
```

Example earn:

```text
gameplay:smp-1:gameplay_earn:realcorequests:550e8400-e29b-41d4-a716-446655440000:quest_daily_2026-05-27:completion
```

Example spend:

```text
gameplay:smp-1:gameplay_spend:gameplayfee:550e8400-e29b-41d4-a716-446655440000:minigame_entry:skywars:match-9f2a
```

### `eventId` rules

| Rule | Detail |
|------|--------|
| Stable | Same economic fact → same `eventId` across retries |
| Not timestamp-only | Timestamps may appear **inside** `eventId` but not as the sole key |
| Scoped | Include system + business id (quest id, match id, grant approval id) |
| Replay-safe | Server restart / flush retry must not mint a new id for the same grant |
| Unique per fact | Different payouts → different `eventId` |

Align with shop producers:
[ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md).

---

## 7. Policy mapping

Per-server `economy_server_policies` (manual changes only):

| Category | Policy flag | Cap field |
|----------|-------------|-----------|
| `gameplay_earn` | `can_earn` | `max_credit_minor` |
| `gameplay_spend` | `can_spend` | `max_debit_minor` |
| `spend` (legacy) | `can_spend` | `max_debit_minor` |

`shop_sell` / `shop_buy` share the same flags but must remain **separate categories**
for audit clarity.

**SMP default until approved trial:** `can_earn=false`, `can_spend=false` for
generic traffic even if shop flags are true during shop monitoring.

**Anarchy:** all write flags false; RealCore refuses capture.

---

## 8. Rollout phases

| Phase | Name | Deliverable | Live writes |
|-------|------|-------------|-------------|
| **A** | Design | This document + staff sign-off | No |
| **B** | Disabled producer interface | **`GenericGameplayEconomyProducerService`** + `GameplayEconomyEvent` (Phase 27); `economy.gameplaySync.generic.enabled: false` | No |
| **C** | Dry-run simulator / test command | Staff-triggered sample events; `[GameplaySync:DRYRUN]` only | No |
| **D** | One controlled live **reward** | Single `gameplay_earn`, tiny amount, one source | One event |
| **E** | One controlled live **spend** | Single `gameplay_spend`, tiny amount, one source | One event |
| **F** | Monitoring | 24h+ SQL + `/rf economy gameplay` (mirror Phase 25 pattern) | Capped |
| **G** | Broader SMP only | Additional sources after per-source review | Capped |

**Not in initial generic rollout:** Factions, Arcade, bulk backfill, multi-source
enablement in one change.

Dependencies: Phase 25 shop monitoring success before Phase D–G.

---

## 9. Risk notes

| Risk | Mitigation |
|------|------------|
| Generic categories are **broader** than shop-specific | Per-source allowlist; one source per live trial |
| **Spend** events remove global balance | Extra review; smaller caps; single-event trial (Phase E) |
| Unknown `source` in ledger | Config allowlist + producer guard; SQL audit (§10) |
| Arbitrary external category strings | API Zod + plugin enum; reject unknown categories |
| Double credit / double debit | Idempotency + dedup cache; duplicate SQL checks |
| Vault changed without ledger (or reverse) | Stop conditions; no auto-reconcile |
| Third-party plugin “helpfully” writing economy | Disallow until reviewed adapter exists |

**Debit bugs are more dangerous than earn bugs** — same principle as
[ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md](ECONOMY_SMP_SHOP_BUY_LIVE_TRIAL.md).

---

## 10. Verification SQL (future operations)

Read-only queries for monitoring phases F–G. Adjust time windows as needed.

### `gameplay_earn` rows (SMP)

```sql
select id, minecraft_uuid, amount_minor, source_server_id,
       idempotency_key, external_ref_type, external_ref_id, created_at
from public.economy_ledger
where category = 'gameplay_earn'
  and source_server_id = 'smp-1'
order by created_at desc
limit 20;
```

### `gameplay_spend` rows (SMP)

```sql
select id, minecraft_uuid, amount_minor, source_server_id,
       idempotency_key, external_ref_type, external_ref_id, created_at
from public.economy_ledger
where category in ('gameplay_spend', 'spend')
  and source_server_id = 'smp-1'
order by created_at desc
limit 20;
```

### Duplicate idempotency keys

```sql
select idempotency_key, count(*) as row_count
from public.economy_ledger
where category in ('gameplay_earn', 'gameplay_spend', 'spend')
  and source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours'
group by idempotency_key
having count(*) > 1;
```

### Source distribution (audit allowlist)

```sql
select external_ref_type, category, count(*) as n, sum(amount_minor) as net_minor
from public.economy_ledger
where category in ('gameplay_earn', 'gameplay_spend', 'spend')
  and source_server_id = 'smp-1'
  and created_at > now() - interval '7 days'
group by external_ref_type, category
order by n desc;
```

Investigate any `external_ref_type` not on the approved list.

### No Anarchy / Factions / Arcade gameplay rows

```sql
select source_server_id, category, count(*) as n
from public.economy_ledger
where category in ('gameplay_earn', 'gameplay_spend', 'spend')
  and created_at > now() - interval '24 hours'
  and source_server_id not in ('smp-1')
group by source_server_id, category;
```

### No `vote_reward` from SMP

```sql
select count(*) as smp_vote_rewards
from public.economy_ledger
where category = 'vote_reward'
  and source_server_id = 'smp-1'
  and created_at > now() - interval '24 hours';
```

**Expected:** `0`.

---

## 11. Rollback

Per source or whole generic rollout:

1. **Disable producer** in config (`enabled: false`) or remove source from allowlist.
2. Set `categories.gameplayEarn: false` / `gameplaySpend: false` on SMP.
3. If no other earn/spend traffic: set `can_earn=false` and/or `can_spend=false` via manual SQL.
4. Set caps to `0` if stopping all debits/credits.
5. Reload / restart RealCore on SMP.
6. **Preserve ledger rows** — append-only history.
7. **`admin_adjustment`** only after manual incident review.

Do not delete ledger rows. Do not mass-edit `economy_balances` without approval.

---

## 12. Stop conditions

Stop generic rollout immediately if:

| Condition |
|-----------|
| Unknown `source` / `external_ref_type` appears in ledger |
| Wrong `amount_minor` vs expected gameplay action |
| Duplicate idempotency key for same fact |
| Spend recorded without matching gameplay action (fee not taken, ability not used) |
| Reward recorded without matching completion |
| Rows on **non-SMP** servers |
| **Lobby1 vote rewards** behavior changes |
| Queue overflow, sustained writer failures, API 4xx/5xx storms |
| Player money complaints tied to generic sync |
| Category spoofing (`shop_*` emitted as `gameplay_*`) |

---

## 13. Default config posture (unchanged)

Generic categories remain **off** until a future code + ops phase.

Phase 27 adds the internal API only (`GenericGameplayEconomyProducerService`); no
quests, commands, or minigames call it yet.

```yaml
economy:
  gameplaySync:
    categories:
      gameplayEarn: false
      gameplaySpend: false
    generic:
      enabled: false
      dryRun: true
      allowedSources: []
      allowGameplayEarn: false
      allowGameplaySpend: false
```

Inspect via `/rf economy gameplay producers` → **genericGameplay** (disabled, dry-run).

Phase 28 adds an admin dry-run simulator command (no real gameplay wiring). See
[ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md](ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md).

---

## Related docs

- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md)
- [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md)
- [ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md)
- [ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md)
- [ECONOMY_TRANSACTION_CATEGORIES.md](ECONOMY_TRANSACTION_CATEGORIES.md)
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md)
- [ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md](ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md)
