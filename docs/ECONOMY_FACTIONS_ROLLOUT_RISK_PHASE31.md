# Phase 31: Factions economy rollout risk assessment

**Scope:** documentation and risk assessment only. No Java code, migrations, deploy
steps, Supabase policy changes, or enablement of Factions economy reads/writes.

**Context:** SMP (`smp-1`) is the **only** approved gameplay economy test backend
under Option B (producer-based sync). Option A (DB-backed Vault provider) remains
long-term research only. Lobby1 `vote_reward` is production-critical and isolated.
Anarchy must remain disabled for global economy mutation.

**Phase 31 does not authorize any Factions dry-run or live trial.**

---

## 1. Purpose

Factions requires a **separate review and rollout plan** before any economy sync
attempt. It is not a copy-paste of the SMP playbook.

| Factor | Why it matters |
|--------|----------------|
| **Competitive economy** | Balance changes affect PvP, raiding, and faction power rankings |
| **PvP impact** | Perceived unfair credits/debits drive support volume and churn |
| **Old preserved worlds** | Legacy `Old_Factions*` worlds hold historical state — contamination risk |
| **Historical balances** | Large legacy balances may not match current DB ledger expectations |
| **Shops / claims / factions plugins** | More integration surfaces than SMP-only shop trials |
| **Higher support risk** | Players treat economy bugs as gameplay integrity failures |

This document defines prerequisites, dry-run/live strategies, Old_Factions policy,
verification SQL, stop conditions, and rollback **before** operators enable anything
on `factions-1`.

---

## 2. Current Factions state

| Item | Expected state (do not change in Phase 31) |
|------|---------------------------------------------|
| **`server.id`** | `factions-1` |
| **`server.group`** | `factions` |
| **`economy_server_policies`** | **Disabled** for mutation — `enabled=false` or equivalent; no `can_earn` / `can_spend` unless explicitly approved in a **future** policy PR |
| **RealCore `gameplaySync`** | Not enabled for Factions production; `backendAllowlist` must not include `factions-1` until approved |
| **Anarchy** | Remains hard-disabled for global economy writes |

### Worlds (single backend `factions-1`)

| World | Role |
|-------|------|
| `Factions` | Active public overworld |
| `Factions_nether` | Active nether |
| `Factions_the_end` | Active end |
| `Old_Factions` | **Archival / private / preserved** — not a public economy source |
| `Old_Factions_Nether` | Archival nether |
| `Old_Factions_End` | Archival end |

All worlds share `server.group: factions` for stats/playtime; economy sync
decisions apply at **backend** level (`factions-1`), not per-world — except that
**Old_Factions\*** must be excluded from any automatic economy flow.

See [REALCORE_SERVER_PROFILES.md](REALCORE_SERVER_PROFILES.md).

---

## 3. Non-goals (Phase 31 and until explicit future approval)

| Non-goal | Notes |
|----------|--------|
| Factions ledger **writes** | No `shop_sell`, `shop_buy`, `gameplay_*`, or vote paths on Factions |
| Factions ledger **reads** | No `can_read` / DB balance shadow on Factions unless separately approved |
| Old_Factions import/replay | No automatic backfill from preserved worlds |
| Automatic historical sync | No Vault delta mirror → ledger for legacy balances |
| Anarchy support | Never mutate global economy from Anarchy |
| Ledger row deletion | Rollback is disable + config, not DELETE FROM ledger |

---

## 4. Risks

### Economic integrity

| Risk | Description |
|------|-------------|
| **Duplicate credits** | Retry/idempotency failure → double `shop_sell` or reward-like credits |
| **Duplicate debits** | Double `shop_buy` or spend miscategorized |
| **Large balances** | Legacy Vault balances vs DB; drift investigations at scale |
| **Wrong amounts** | Shop plugin quantity/price edge cases on Factions configs |

### Gameplay and community

| Risk | Description |
|------|-------------|
| **PvP / faction balance impact** | Economy changes alter raid/defense economics |
| **Support complaints** | “Lost money” / “dupe” reports even when ledger is correct |
| **Shop exploit risk** | Sell/buy loops, price bugs, lag-based duplicate transactions |
| **Claim/economy integration** | Factions/claims plugins interacting with Vault outside shop producers |

### Data and history

| Risk | Description |
|------|-------------|
| **Old_Factions contamination** | Accidental events attributed to live `factions-1` public economy |
| **Staff/admin balance edits** | EssentialsX or command adjustments without ledger category |
| **Historical replay** | Importing old balances as `gameplay_earn` without migration review |

### Operations

| Risk | Description |
|------|-------------|
| **Rollback complexity** | Many players affected; compensating entries need manual review |
| **SMP regression** | Factions trial distracts from unresolved SMP issues |
| **Policy misconfiguration** | `factions-1` enabled in SQL while jar still dry-run (or inverse) |

---

## 5. Required prerequisites before Factions dry-run

All must be **true** before any future Factions jar/config experiment:

| # | Prerequisite |
|---|----------------|
| 1 | **SMP `shop_sell` stable** — dry-run + live trial complete per SMP docs; clean monitoring window |
| 2 | **SMP `shop_buy` stable** — if debit paths required before Factions spend tests |
| 3 | **No unresolved writer/API issues** on SMP — queue, retries, permanent rejects understood |
| 4 | **No Cloudflare usage spikes** from economy API during SMP trials |
| 5 | **No idempotency bugs** — duplicate SQL query clean on SMP |
| 6 | **Authority model approved** — [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md); drift policy understood |
| 7 | **Factions plugin list audited** — Vault consumers, shop, factions, claims, rewards documented |
| 8 | **EconomyShopGUI on Factions verified** — sell/buy events fire correctly; configs differ from SMP |
| 9 | **Old_Factions excluded** — no public player routing; no producer hooks on archival worlds |
| 10 | **This risk doc signed off** — ops + lead dev; separate from SMP sign-off |

Generic `gameplay_earn` / `gameplay_spend` on Factions require
[ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md](ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md)
**after** shop paths stable — not part of initial Factions trial.

---

## 6. Factions dry-run strategy (future only)

**Not authorized in Phase 31.** When prerequisites pass:

| Step | Setting / action |
|------|------------------|
| Jar | Same tested RealCore build as SMP RC — install on **Factions only** after SMP stability period (days/weeks) |
| `economy.gameplaySync.enabled` | `true` |
| `economy.gameplaySync.dryRun` | `true` |
| Categories | **`shopSell` only** initially — no `shopBuy`, no generic gameplay |
| Producer | `economyShopGuiSell` (or equivalent) **`dryRun: true`**, `enabled: true` |
| Policy | **No** `can_earn` / `can_spend` enablement in Supabase |
| `backendAllowlist` | Include `factions-1` only with ops approval |
| Verify | `[GameplaySync:DRYRUN]` logs; `/rf economy gameplay producers`; **queued = 0** |

### SQL — expect no ledger rows during dry-run

```sql
SELECT COUNT(*) AS n
FROM economy_transactions
WHERE server_id = 'factions-1'
  AND created_at > now() - interval '24 hours';
```

Expect **0** while global and producer dry-run remain true.

---

## 7. Factions live strategy (future only)

**Not authorized in Phase 31.** After successful Factions dry-run window:

| Order | Control |
|-------|---------|
| 1 | **`shop_sell` live first** — single low-value test sell with staff online |
| 2 | **Policy** — `can_earn=true` only for `factions-1`; `can_spend=false` |
| 3 | **Caps** — low `max_credit_minor` and per-event caps in config + policy |
| 4 | **No `shop_buy`** until sell path stable for 24–72h |
| 5 | **Monitoring** — same commands as SMP; Factions-specific SQL below |
| 6 | **One transaction** — first live test is one player, one sell, documented `eventId` |

Do not enable generic gameplay categories on Factions before SMP generic approval
path exists and Factions shop path is proven.

---

## 8. Old_Factions policy

| Rule | Detail |
|------|--------|
| **Archival / private** | `Old_Factions`, `Old_Factions_Nether`, `Old_Factions_End` are preservation worlds |
| **Not a public economy source** | Do not treat balances or activity there as live `factions-1` ledger input |
| **No automatic replay** | Do not replay old balances into the global ledger without manual review |
| **Import path** | Any preservation import must use **`migration_import` / `admin_adjustment`** (or future approved migration RPC) — not `shop_sell` or `gameplay_earn` |
| **Metadata** | If events include world metadata, SQL must prove no `Old_Factions` markers in live categories |

Operators must confirm world access rules (private/whitelist) before any jar
that hooks EconomyShopGUI globally on the backend.

---

## 9. Verification SQL (future rollout windows)

### Policy state — Factions must stay disabled until approved

```sql
SELECT server_id, enabled, can_read, can_reward, can_earn, can_spend,
       max_credit_minor, max_debit_minor, notes
FROM public.economy_server_policies
WHERE server_id = 'factions-1';
```

Expect: **disabled writes** until explicit live approval PR.

### No Factions rows before rollout

```sql
SELECT COUNT(*) AS factions_tx_count
FROM economy_transactions
WHERE server_id = 'factions-1';
```

Baseline before any trial; investigate unexpected rows immediately.

### Latest Factions shop rows (after future live test only)

```sql
SELECT id, category, source, player_uuid, amount_minor, idempotency_key, created_at
FROM economy_transactions
WHERE server_id = 'factions-1'
  AND category IN ('shop_sell', 'shop_buy')
ORDER BY created_at DESC
LIMIT 20;
```

### Old_Factions contamination check (if metadata column exists)

```sql
-- Adjust column names to match schema if world/region metadata is stored
SELECT id, category, source, created_at, metadata
FROM economy_transactions
WHERE server_id = 'factions-1'
  AND (
    metadata::text ILIKE '%Old_Factions%'
    OR source ILIKE '%old_factions%'
  );
```

Expect **zero rows** for automated gameplay sync.

### No Anarchy rows (regression guard)

```sql
SELECT server_id, category, COUNT(*) AS n
FROM economy_transactions
WHERE server_group = 'anarchy'
   OR server_id LIKE 'anarchy%'
GROUP BY server_id, category;
```

### Duplicate idempotency

```sql
SELECT idempotency_key, COUNT(*) AS c
FROM economy_transactions
WHERE server_id = 'factions-1'
  AND created_at > now() - interval '7 days'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

---

## 10. Stop conditions

**Immediately halt** Factions rollout (disable producer, remove `factions-1` from
allowlist, keep policy disabled) if:

| Signal | Action |
|--------|--------|
| SMP not stable | Do not start Factions |
| Factions dry-run creates ledger rows | Stop — config or bug |
| Duplicate credits/debits | Stop — idempotency investigation |
| Wrong amounts | Stop — shop/producer logic |
| Old_Factions data in ledger | Stop — world/hook contamination |
| PvP/economy player complaints spike | Stop — comms + audit |
| TPS/MSPT degradation | Stop — performance |
| Queue/API failures | Stop — platform health |
| Unauthorized categories | Stop — policy/config leak |
| Anarchy affected | **Immediate** stop network-wide review |
| Lobby1 vote rewards affected | **Immediate** stop — isolate Lobby path |

---

## 11. Rollback

| Step | Action |
|------|--------|
| 1 | Disable shop (and any) producers on Factions |
| 2 | Set `economy.gameplaySync.enabled: false` or remove `factions-1` from `backendAllowlist` |
| 3 | Set **`factions-1` policy disabled** in Supabase (`can_earn`/`can_spend` false) |
| 4 | Reload RealCore |
| 5 | **Preserve all ledger rows** — no deletion |
| 6 | Compensating fixes via **`admin_adjustment`** only after human review |

Jar downgrade only if code defect; prefer config/policy rollback first.

---

## 12. Recommendation

| Recommendation | Rationale |
|----------------|-----------|
| **Do not start Factions** until SMP has **several days to weeks** of clean monitoring (shop sell, then buy if used) | Factions amplifies SMP mistakes |
| **Start with dry-run `shop_sell` only** | Smallest blast radius; matches SMP sequence |
| **Do not include Old_Factions** in economy sync | Prevents historical contamination |
| **Keep `factions-1` policy disabled** until a dedicated policy PR after dry-run success | SQL is the final gate |
| **Defer Option A (Vault provider)** on Factions until SMP Option A prototype (if ever) succeeds | [ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md](ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md) |

**Phase 31 status:** Factions economy sync remains **off** — planning only.

---

## 13. Related docs

- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — master phase plan
- [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) — Option B vs A
- [ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md](ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md) — long-term provider (not Factions-first)
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — SMP RC scope (excludes Factions)
- [ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md](ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md) — generic sources (stage H)
- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)
- [ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md)
- [ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md](ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md)

---

## Phase 31 deliverable summary

| Item | Status |
|------|--------|
| Factions risk assessment | This document |
| Java / RealCore changes | None |
| Migrations / policy SQL | None |
| Deploy | None |
| Factions reads/writes enabled | **No** — remains disabled |
