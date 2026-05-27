# Phase 29: Generic gameplay live-trial approval architecture

**Scope:** documentation and operational approval framework only. No Java code,
migrations, deploy steps, Supabase policy changes, or wiring of real gameplay
systems in this phase.

**Context:** Phase 26 defines generic `gameplay_earn` / `gameplay_spend` design.
Phase 27 adds a disabled `GenericGameplayEconomyProducerService`. Phase 28 adds
an admin dry-run simulator. Shop producers (`shop_sell`, `shop_buy`) remain on
separate rollout paths. Lobby1 `vote_reward` must remain untouched.

---

## 1. Purpose

This phase defines the **approval requirements**, **source certification**,
**rollout gates**, and **monitoring requirements** that must be satisfied before
any real gameplay source may call `GenericGameplayEconomyProducerService.submit()`
and create `gameplay_earn` or `gameplay_spend` ledger entries.

Until a source completes this framework:

- It must not appear in `economy.gameplaySync.generic.allowedSources`.
- It must not be wired in production RealCore or third-party plugins.
- Live writes (`dryRun: false`) are forbidden.

This document does **not** approve any specific source for live trial.

---

## 2. Explicitly approved sources only

**Rule:** No generic gameplay source may be connected unless it is **explicitly
approved**, **documented**, and **signed off** by economy ops + the source owner.

Approval record must include:

| Field | Required |
|-------|----------|
| Source identifier | Exact string in `allowedSources` (case-sensitive config, normalized in idempotency key) |
| Categories | `gameplay_earn`, `gameplay_spend`, or both |
| Backend | `smp-*` only for initial trials |
| Owner | Team/person responsible for code and rollback |
| Approval date | ISO date + PR/issue link |
| Max amounts | Per-event and per-flush caps documented |
| Rollback owner | Who disables source on stop condition |

### Future candidate examples (not approved by this doc)

| Candidate | Typical category | Notes |
|-----------|------------------|--------|
| RealCore quests | `gameplay_earn` | RealCore-owned; preferred first integration style |
| Scheduled network events | `gameplay_earn` | Time-bounded; requires eventId per payout |
| Admin-reviewed minigames | `gameplay_earn` / `gameplay_spend` | Staff sign-off per minigame source ID |
| Seasonal objectives | `gameplay_earn` | Batch caps; seasonal source namespace |
| Custom reward systems | `gameplay_earn` | Must not overlap `vote_reward` or shop paths |

### Disallowed (never connect without full architecture review)

| Pattern | Why |
|---------|-----|
| Arbitrary plugin hooks | No stable contract, no owner |
| Vault delta mirrors | Category unknown; violates Option B |
| Unreviewed third-party rewards | No certification checklist |
| Economy/admin commands as sources | Manual adjustment uses `admin_adjustment`, not gameplay categories |
| Anarchy systems | Hard exclusion — no global ledger mutation |
| Factions / Arcade (default) | Out of initial SMP scope |
| Lobby1 vote flows | Isolated `vote_reward` path only |
| EconomyShopGUI sell/buy | Use `shop_sell` / `shop_buy` producers |

---

## 3. Required source contract

Every approved source **must** implement the following when calling
`GameplayEconomyEvent` → `submit()`:

| Field | Requirement |
|-------|-------------|
| **eventId** | Stable, unique per logical economic fact; survives retries; never time-only |
| **amountMinor** | Deterministic positive integer; known before submit; within configured caps |
| **playerUuid** | Authoritative UUID; not name-only |
| **source** | Fixed allowlisted identifier; one source per integration |
| **category** | `gameplay_earn` or `gameplay_spend` only — never shop or vote categories |
| **reason/context** | Human-readable audit string; no secrets |
| **Replay-safe semantics** | Same logical action → same `eventId`; safe on plugin reload |
| **Duplicate-safe behavior** | Retries must not change amount or category; rely on idempotency key |
| **Failure handling** | On reject: log, do not double-pay in-game; on buffer/API failure: no silent alternate path to Vault credit |

**Idempotency key format** (RealCore):

```text
gameplay:<serverId>:<category>:<source>:<playerUuid>:<eventId>
```

Sources must document how `eventId` is constructed for each action type.

**In-game payout policy:** Vault may still deliver immediate player feedback;
ledger write is the **approved global record**. Source owner must document whether
in-game money moves before, after, or independent of ledger accept — and must not
double-credit on retry.

---

## 4. Required source review checklist

Complete **before** adding a source to `allowedSources` or enabling live trial:

| # | Check | Evidence |
|---|--------|----------|
| 1 | Dry-run tested | Phase 28 simulator or integration dry-run on SMP lab; `[GameplaySync:DRYRUN]` logs |
| 2 | Duplicate tested | Same `eventId` twice → second reject; `duplicateRejected` metric |
| 3 | Retry tested | Simulated flush/API retry does not duplicate ledger row |
| 4 | Restart tested | Server restart mid-queue; no duplicate on replay |
| 5 | Queue tested | Bounded queue; no unbounded growth under expected load |
| 6 | Malformed event tested | Missing source/eventId/zero amount → reject |
| 7 | Over-cap tested | Amount above `maxCreditMinorPerEvent` / `maxDebitMinorPerEvent` → reject |
| 8 | API failure tested | Platform 5xx/timeout → retry/drop behavior understood; no runaway |
| 9 | Rollback plan documented | Disable source + allowlist removal steps |
| 10 | Observability verified | `/rf economy gameplay producers` shows source activity |
| 11 | Source owner identified | Named owner in approval record |

Sign-off: economy ops + source owner + (for first live trial) lead developer.

---

## 5. Required rollout path

Every approved source must follow these stages **in order**. Skipping a stage is not
permitted.

| Stage | Name | Activities |
|-------|------|------------|
| **A** | Design | Phase 26-style design for source; caps; eventId scheme; failure modes |
| **B** | Disabled integration | Code merged with `generic.enabled: false` or source not in allowlist |
| **C** | Dry-run only | `dryRun: true` globally and per-generic; simulator + integration emits dry-run only |
| **D** | One-event live test | Single player, single event, capped amount, `dryRun: false` only after preflight |
| **E** | Monitoring window | 24–72h SQL + command monitoring; zero stop conditions |
| **F** | SMP limited rollout | `smp-1` (or designated trial host); low rate caps; one source at a time |
| **G** | Broader SMP rollout | Additional SMP hosts after F stable; still no Factions/Arcade |
| **H** | Factions evaluation | **Only** after long SMP stability (months); separate approval doc |

Shop producers (`shop_sell`, `shop_buy`) use their own SMP trial docs — do not
merge shop and generic rollout gates.

---

## 6. Required live policy

Before any generic live trial, operators must intentionally enable (future phases;
**not** done in Phase 29):

| Control | Requirement |
|---------|-------------|
| `can_earn` / `can_spend` (Supabase policy) | Enabled only for approved categories on approved backends |
| Amount caps | `maxCreditMinorPerEvent`, `maxDebitMinorPerEvent`, per-flush limits |
| Backend | SMP-only initially (`economy.gameplaySync.backendAllowlist`) |
| Server groups | No Arcade, Factions, or Anarchy by default |
| Categories | `gameplayEarn` / `gameplaySpend` in config only when source approved |
| Generic flags | `allowGameplayEarn` / `allowGameplaySpend` per source approval |
| Dry-run exit | Explicit ops sign-off to set `dryRun: false` |

Default posture remains: **disabled**, **dry-run**, **empty allowlist**.

---

## 7. Monitoring requirements

### Required commands

| Command | Use |
|---------|-----|
| `/rf economy` | Global writer queue, HMAC readiness, gameplay sync enabled state |
| `/rf economy gameplay` | Gameplay buffer depth, dry-run simulation totals |
| `/rf economy gameplay producers` | Per-producer metrics including **genericGameplay** |
| `/rf economy gameplay preflight live` | Live-mode readiness check before first real write |

Run preflight **before** stage D and after any config change affecting live writes.

### Required SQL (examples)

**Category counts (generic only, trial window):**

```sql
SELECT category, source, COUNT(*) AS n, SUM(amount_minor) AS volume_minor
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND created_at > now() - interval '24 hours'
GROUP BY category, source
ORDER BY n DESC;
```

**Duplicate idempotency (should be zero duplicate rows for same key):**

```sql
SELECT idempotency_key, COUNT(*) AS c
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND created_at > now() - interval '7 days'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

**Largest transactions:**

```sql
SELECT id, category, source, player_uuid, amount_minor, created_at
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND created_at > now() - interval '24 hours'
ORDER BY amount_minor DESC
LIMIT 20;
```

**Source grouping (detect unauthorized sources):**

```sql
SELECT source, category, COUNT(*) AS n
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND created_at > now() - interval '7 days'
GROUP BY source, category
ORDER BY n DESC;
```

**No unauthorized server rows:**

```sql
SELECT server_id, category, COUNT(*) AS n
FROM economy_transactions
WHERE category IN ('gameplay_earn', 'gameplay_spend')
  AND created_at > now() - interval '24 hours'
  AND server_id NOT IN ('smp-1')  -- adjust to approved trial hosts only
GROUP BY server_id, category;
```

**No unexpected categories from generic integration:**

```sql
SELECT category, COUNT(*) AS n
FROM economy_transactions
WHERE source = '<approved_source_id>'
  AND created_at > now() - interval '24 hours'
  AND category NOT IN ('gameplay_earn', 'gameplay_spend');
```

Expect **zero rows**.

**Vote reward isolation:**

```sql
SELECT COUNT(*) FROM economy_transactions
WHERE category = 'vote_reward'
  AND created_at > now() - interval '1 hour';
```

Compare to baseline before generic trial; unexpected spikes trigger stop.

---

## 8. Drift policy

Under **Option B** ([ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md)):

| Principle | Policy |
|-----------|--------|
| Vault vs DB | Vault remains authoritative for in-game spend/display short-term |
| Expected drift | Drift between Vault balance and DB balance is **expected** during transition |
| Investigation | Drift investigated manually with audit commands and SQL — not auto-fixed |
| Forbidden | Automatic delta mirroring from Vault polls into `gameplay_*` |
| Forbidden | Automatic balance overwrite of DB or Vault |
| Compensating entries | Only after human review; use `admin_adjustment` or approved compensating flow — never silent gameplay events |

Generic gameplay sources must **not** attempt to “sync” Vault to DB via inferred deltas.

---

## 9. Stop conditions

**Immediately** disable the source (remove from allowlist, set `dryRun: true`, or
`generic.enabled: false`) and escalate if any of the following occur during rollout:

| Condition | Action |
|-----------|--------|
| Duplicate rewards or spends | Stop; SQL idempotency query; no new live events |
| Wrong amount vs intended gameplay fact | Stop; review eventId/amount logic |
| Malformed source events | Stop; fix contract before re-enable |
| Unauthorized source IDs in ledger | Stop; audit allowlist and code paths |
| Queue overflow / unbounded buffer growth | Stop; reduce rate; investigate flush |
| Repeated API errors | Stop; check platform/HMAC/Cloudflare |
| Retry storms | Stop; backoff; writer retry depth review |
| Permanent rejects spike | Stop; config/category/policy mismatch |
| Cloudflare runaway usage | Stop; rate limits; disable live writes |
| TPS/MSPT degradation correlated with rollout | Stop; profile; defer load |
| Non-SMP rows for generic categories | Stop; backend allowlist breach |
| Vote rewards affected | **Immediate** stop; verify Lobby1 path isolated |

Document incident in rollout log with timestamps and config snapshot.

---

## 10. Rollback policy

| Step | Action |
|------|--------|
| 1 | Disable source in code or stop calling `submit()` |
| 2 | Remove source from `economy.gameplaySync.generic.allowedSources` |
| 3 | Set `dryRun: true` on generic and global gameplay sync |
| 4 | Disable category flags if needed (`allowGameplayEarn` / `allowGameplaySpend`) |
| 5 | Reload RealCore |
| 6 | Preserve all ledger history — **no row deletion** |
| 7 | Compensating entries only after review (admin process) |

Rollback does **not** require jar downgrade unless a code defect caused the incident.
Prefer config rollback first.

---

## 11. Final architecture note

Generic gameplay live trials remain **transitional architecture under Option B**:

- Gameplay features may still use Vault for immediate player experience.
- The DB ledger records **approved, categorized, idempotent** economic facts for
  global balances and the website.
- Long-term direction remains **Option A: DB-backed Vault provider**, where
  deposit/withdraw at the provider boundary carries category and idempotency by
  construction.

Phase 29 does not commit to Option A timeline or design detail.

---

## 12. Future phases (possible)

| Phase | Topic | Notes |
|-------|--------|--------|
| 30+ | RealCore quest rewards | First preferred RealCore-owned source; full checklist |
| 31+ | Minigame rewards | Per-minigame source ID and approval record |
| 32+ | `gameplay_spend` live trials | Fees/penalties after earn path stable |
| 33+ | Factions evaluation | Separate doc; months after SMP stability |
| 30 | DB-backed Vault provider (Option A) | Feasibility spike — [ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md](ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md) |

Numbers are illustrative; actual phase IDs may shift in
[GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md).

---

## 13. Related docs

- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — master phase plan
- [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) — Option A/B/C
- [ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md) — category design
- [ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md](ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md) — dry-run simulator
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md) — producer rollout index
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — future policy enablement (not Phase 29)
- [ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md](ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md) — Option A long-term feasibility

---

## Phase 29 deliverable summary

| Item | Status |
|------|--------|
| Java / RealCore changes | None |
| Migrations | None |
| Deploy | None |
| Policy SQL | None |
| Real gameplay wiring | None |
| Approval framework | This document |
