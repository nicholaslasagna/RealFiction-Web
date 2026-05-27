# Phase 30: DB-backed Vault provider feasibility spike

**Scope:** architecture and feasibility study only. No Java implementation, no
migrations, no deploy steps, no Supabase policy changes, no Vault provider
registration, and no gameplay behavior changes in this phase.

**Context:** RealFiction currently operates under **Option B** (transitional):
EssentialsX/Vault authoritative in-game; RealCore records **approved** events
to an append-only DB ledger via producer integrations (`shop_sell`, `shop_buy`,
future `gameplay_earn` / `gameplay_spend`). Drift between Vault and DB is
expected and managed manually. **Option A** is the long-term target: RealCore
becomes the authoritative Vault `Economy` implementation backed by the same ledger.

Lobby1 `vote_reward` remains production-critical and isolated. Factions, Arcade,
and Anarchy are out of scope for near-term experimentation.

---

## 1. Purpose

### Why this document exists

Option B is a **deliberate transitional architecture**. It allows SMP to gain
append-only ledger visibility and website/global balance accuracy **without**
replacing EssentialsX economy authority overnight. That path introduced:

- per-producer integration work,
- category-specific rollout discipline,
- drift investigation overhead,
- duplicate-state risk if producers and Vault both “win.”

The **long-term goal** is to **eliminate DB/Vault drift entirely** by making the
ledger (and its derived balances) the single source of truth at the Vault API
boundary. Under Option A, **RealCore may eventually register as the Vault Economy
provider**, so every `deposit` / `withdraw` / `getBalance` flows through the same
idempotent, policy-aware pipeline that already backs the website.

This phase answers: **Is Option A feasible, what would we have to build, and what
must be true before we prototype it?** It does **not** authorize implementation.

---

## 2. Current architecture (Option B)

| Layer | Role today |
|-------|------------|
| **EssentialsX economy** | Authoritative in-game balance for most SMP plugins |
| **Vault API** | Standard integration surface; RealCore does **not** register a provider by default |
| **RealCore producers** | Translate known actions → `GameplayEconomyEvent` / shop events → buffered ledger writes |
| **Append-only DB ledger** | Authoritative **record** of approved global economy events; website leaderboards read DB |
| **Shadow / audit tools** | `VaultDeltaShadowService`, manual `sync-vault`, preflight — observe drift, do not auto-fix |

### Characteristics

- **Drift is possible** when Vault changes without a matching ledger event (commands,
  refunds, plugins without producers, staff adjustments).
- **Producer-based sync** requires each economic surface (shop sell/buy, generic
  gameplay, vote) to be wired explicitly with source, category, and idempotency.
- **Shop integrations** (e.g. EconomyShopGUI) required **individual** producer
  work — not automatic coverage of all Vault consumers.
- **Vote rewards** use a **separate** Lobby1 path (`vote_reward`); must remain
  isolated from gameplay producer and future provider experiments.

See [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) and
[GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md).

---

## 3. Target architecture (Option A)

RealCore registers a **DB-backed Vault Economy provider** that becomes the
**only** economy implementation plugins see (after cutover).

### Provider responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Implement Vault Economy API** | `getBalance`, `has`, `withdraw`, `deposit`, `createPlayerAccount`, formatters, bank APIs if needed |
| **Read balances** | From **DB-backed local cache** refreshed from ledger-derived balance + in-flight reservations |
| **Write ledger** | Every mutating Vault call → append-only transaction with category, source, idempotency key |
| **Update derived balances** | Materialized balance per player updated after durable ledger accept (or optimistic with reconciliation) |
| **Enforce policy/caps** | `can_earn`, `can_spend`, per-category limits, server/backend allowlists |
| **Idempotency** | Caller-agnostic dedup at provider boundary (plugin retries, Bukkit event redelivery) |
| **Retries** | Async queue with bounded retries; no double-apply on replay |
| **Observability** | Metrics: latency, queue depth, cache hit rate, reject reasons, API errors — `/rf economy` family |

### Conceptual flow

```text
Plugin → Vault.deposit/withdraw
           → RealCore Economy provider (sync API surface)
                → validate policy + caps
                → enqueue ledger proposal (async)
                → update local cache (reservation or post-commit)
                → return success/failure to plugin

Ledger writer (async) → platform API / DB
           → on ack: finalize cache, clear reservation
           → on fail: retry or reject + compensating policy
```

Category and `eventId` must be known at the provider boundary — either from
RealCore-owned calls or a **strict** mapping layer for legacy plugin calls
(default category rules are high-risk and need explicit design).

---

## 4. Expected benefits

| Benefit | Explanation |
|---------|-------------|
| **Single source of truth** | Vault balance, DB ledger, and website converge |
| **No drift** | No parallel EssentialsX balance diverging from ledger |
| **No mirror ambiguity** | Eliminates “which balance is correct?” under Option B |
| **No polling** | Shadow delta observers become diagnostic only, not reconciliation drivers |
| **Cleaner integrations** | Plugins keep using Vault; fewer bespoke producers over time |
| **Simpler reward logic** | One pipeline for grants and spends with shared idempotency |
| **Website/game consistency** | Leaderboards and in-game display read same derived state |
| **No duplicate economy state** | One write path per economic fact |

---

## 5. Major risks

| Risk | Impact |
|------|--------|
| **Provider incompatibility** | Plugins assume synchronous balance updates, specific rounding, or EssentialsX quirks |
| **Plugin assumptions** | Shop plugins may call Vault on region thread and expect instant persistence |
| **Latency sensitivity** | Blocking on network/DB during `deposit`/`withdraw` can cause TPS drops |
| **Network dependency** | SMP gameplay blocked or degraded if platform API unreachable |
| **DB outage behavior** | Must define fail-closed vs fail-open — both are dangerous |
| **Cache consistency** | Stale reads → double-spend perception; aggressive invalidation → load |
| **Transaction throughput** | Burst shop traffic / rewards → queue pressure, Cloudflare limits |
| **Folia threading** | Region-thread Vault calls vs async writer — wrong thread = bugs or deadlocks |
| **Queue pressure** | Unbounded queues → memory; bounded → plugin-visible failures |
| **Reconnect/retry correctness** | Duplicate Vault calls must not duplicate ledger rows |
| **Startup ordering** | Provider registration before/after EssentialsX; soft-depend conflicts |
| **Migration complexity** | Cutover from EssentialsX balances to ledger-derived balances |

---

## 6. Required architecture components (future)

Systems not fully built today that Option A would require:

| Component | Purpose |
|-----------|---------|
| **Async write queue** | Decouple Vault API thread from HTTP/DB persistence |
| **Local balance cache** | Fast `getBalance` / `has` without per-call HTTP |
| **Write-behind strategy** | Accept Vault call → reserve → persist → commit or roll back reservation |
| **Idempotent ledger pipeline** | Same keys as today’s gameplay idempotency, extended to all Vault mutations |
| **Retry-safe persistence** | Exponential backoff, batching, duplicate detection on platform |
| **Fallback behavior** | Explicit degraded mode (read-only? reject writes?) — no silent EssentialsX fallback without ops approval |
| **Bounded queues** | Per-server caps; backpressure signals to metrics |
| **Health monitoring** | Liveness: cache age, queue depth, last successful flush |
| **Degraded-mode behavior** | Documented operator playbook when API unhealthy |
| **Provider registration ordering** | Register high priority; disable EssentialsX economy module safely |

Existing pieces (Option B) that **inform** Option A but are **not sufficient**:

- `BufferedEconomyTransactionWriter`, gameplay buffer, HMAC client
- Producer metrics and preflight commands
- Vote reward isolated writer

---

## 7. Performance design

### Scale target

Design discussions should assume **1000+ concurrent players** on SMP during peak,
with hot players (shops, auctions) generating bursty Vault traffic.

### Principles

| Topic | Design direction |
|-------|----------------|
| **Region threads** | Never perform synchronous HTTP/DB on Folia region / main gameplay threads |
| **Local memory cache** | Sub-millisecond reads for `getBalance` after warm-up |
| **Async batching** | Aggregate ledger proposals; respect platform batch limits |
| **Eventual consistency window** | Brief period where cache shows reserved balance before ledger ack — plugins must tolerate or API must block until durable (latency tradeoff) |
| **Write coalescing** | Multiple rapid deposits to same player in one flush window (dangerous — needs strict idempotency per logical event) |
| **Hot-player behavior** | Dedicated per-UUID serialization to prevent lost updates |
| **Cache TTL/invalidation** | Invalidate on successful write; periodic reconcile with DB read for drift detection |
| **API/Cloudflare** | Rate limits, WAF, and payload size drive batch sizing and retry policy |

### Open performance choice

**Blocking vs non-blocking Vault API:** Vault plugins historically expect
`deposit`/`withdraw` to reflect immediately in `getBalance`. Option A must either:

1. **Block** until ledger accept (simple semantics, higher latency), or
2. **Reserve** locally and fail the call if persistence later fails (complex rollback
   for plugins that already gave items).

This choice affects shop plugins most acutely.

---

## 8. Failure handling

| Scenario | Required behavior (to be designed in prototype) |
|----------|--------------------------------------------------|
| **DB/API unavailable** | Reject new writes or enter degraded read-only; alert ops; no silent EssentialsX dual-write |
| **API timeout** | Retry with idempotency; do not double-apply; surface metric |
| **Partial batch failure** | Split batch; retry failed rows; never lose ordering per player without explicit design |
| **Duplicate replay** | Idempotency key dedup at provider and platform |
| **Stale cache** | Detect via version/sequence; refresh from DB; optional admin audit command |
| **Provider disable/reload** | Drain queue before unload; reject new Vault calls during drain |
| **Server crash mid-write** | On restart: replay queue from disk? reconcile reservations vs ledger |
| **Rollback strategy** | Re-register EssentialsX authority; freeze provider; manual balance audit — **no ledger deletion** |

Vote reward path must define independent failure behavior so provider experiments
do not block Lobby1 delivery.

---

## 9. Compatibility concerns

| System | Concern |
|--------|---------|
| **EssentialsX** | Currently owns economy; must disable economy module without breaking commands/users |
| **EconomyShopGUI** | Heavy Vault usage on sell/buy; latency and category mapping |
| **Vault API** | `Economy` interface version, `EconomyResponse` semantics, bank support |
| **Scoreboard / sidebar** | May read Vault directly; cache freshness |
| **PlaceholderAPI** | `%vault_eco_balance%` etc. — must match provider registration |
| **Multi-server balance** | DB is network-wide; provider on each SMP host must see consistent cache or regional partitioning |
| **Concurrent sessions** | Same UUID on two servers (if possible) — conflict resolution |
| **SMP** | First and only initial canary for Option A prototype |
| **Factions** | Future only after long SMP stability; see [ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md](ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md) |

### Producer path during transition

Option A does not immediately remove shop/generic **producers** — migration may run
**hybrid** where shops still use producers until provider cutover proves category
mapping at Vault boundary. Duplicate recording (producer + provider) is a **hard
failure mode** to guard against.

---

## 10. Migration strategy from Option B

Required **staged** path (no stage may be skipped):

| Stage | Name | Activities |
|-------|------|------------|
| **A** | Option B stable | Shop + monitoring + generic approval paths proven on SMP |
| **B** | Hybrid read-only provider experiments | RealCore registers provider read-only or shadow compare; EssentialsX still writes |
| **C** | Shadow provider | Log every EssentialsX vs provider balance delta; no plugin routing |
| **D** | One SMP canary | Single host; limited plugins; ops on-call |
| **E** | Parallel validation | SQL + commands + player reports; zero drift tolerance criteria defined |
| **F** | Controlled cutover | EssentialsX economy disabled; provider authoritative; rollback rehearsed |
| **G** | EssentialsX retirement | Remove economy authority if F successful; keep non-economy EssentialsX features |

Stages B–C may use **existing** `VaultDeltaShadowService` patterns extended for
provider shadow mode — not automatic reconciliation.

Generic gameplay and vote rewards follow **separate** gates ([Phase 29](ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md)).

---

## 11. Explicit non-goals (Phase 30)

| Non-goal | Notes |
|----------|--------|
| Implement provider now | Research only |
| Replace EssentialsX now | Cutover is stage F+ |
| Enable Factions / Arcade / Anarchy | SMP-only discipline continues |
| Change vote rewards | Lobby1 path untouched |
| Remove append-only ledger | Ledger remains system of record |
| Automatic reconciliation | No delta mirror → ledger automation |

---

## 12. Research questions (unresolved)

1. **Vault provider threading guarantees** — Which methods may be called from async
   threads vs region threads on Paper/Folia?
2. **Best cache strategy** — Reservation vs post-commit update; per-UUID locking model.
3. **Write durability guarantees** — When is it safe to return `EconomyResponse` success?
4. **Transaction ordering** — Global ordering vs per-player ordering under batching.
5. **Offline-player consistency** — `getBalance(offline)` without loading entity; cache seeding.
6. **Multi-backend synchronization** — One ledger, many SMP instances; cache invalidation fanout.
7. **Replay semantics** — Server restart with on-disk queue; at-least-once delivery handling.
8. **Provider fallback behavior** — Is any EssentialsX fallback acceptable, or fail-closed only?
9. **Category assignment for legacy Vault calls** — Default `gameplay_earn` vs reject unknown callers.
10. **EssentialsX migration** — One-time balance import vs gradual reconcile (import is high-risk).
11. **EconomyShopGUI** — Can shop path move from producer-only to provider-only without duplicate events?
12. **Cloudflare / API SLO** — Required uptime for write availability.

Prototype branch should answer these with benchmarks and failure injection tests.

---

## 13. Recommendation

| Horizon | Recommendation |
|---------|----------------|
| **Near-term production** | **Continue Option B** — producers, dry-run, SMP-only rollout, Phase 29 approvals |
| **Option A timing** | Attempt only after **long SMP stability** on shop + generic paths (months, not weeks) |
| **Next engineering step** | **Isolated prototype branch/environment** — shadow/read-only provider, no production registration |
| **Vote rewards** | Keep isolated; design provider interaction before any Lobby1 change |
| **Documentation** | Update this doc when prototype answers research questions |

**Do not** register RealCore as Vault Economy provider on production SMP until
stages A–E pass on a canary and rollback is rehearsed.

---

## 14. Related docs

- [ECONOMY_AUTHORITY_MODEL_PHASE20.md](ECONOMY_AUTHORITY_MODEL_PHASE20.md) — Option A/B/C summary
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — master phase plan
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — RC merge/deploy order
- [ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md](ECONOMY_GENERIC_GAMEPLAY_LIVE_APPROVAL_PHASE29.md) — generic source gates under Option B
- [ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md](ECONOMY_GENERIC_GAMEPLAY_SIMULATOR_PHASE28.md)
- [ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md)
- [ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md](ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md)

---

## Phase 30 deliverable summary

| Item | Status |
|------|--------|
| Feasibility / architecture study | This document |
| Java implementation | None |
| Migrations | None |
| Deploy | None |
| Policy SQL | None |
| Vault provider registration | None |
