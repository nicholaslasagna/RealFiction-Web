# Economy authority model decision (Phase 20)

Architecture decision record (ADR) for how RealFiction keeps **in-game Vault balances**
and the **Supabase canonical ledger** aligned long-term.

**Status:** Design / decision doc only. No code, migrations, deploy, or category enablement in this phase.

**Long-term (Option A):** DB-backed authority when ready — not part of current SMP
shop monitoring. Feasibility spike:
[ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md](ECONOMY_DB_BACKED_VAULT_PROVIDER_PHASE30.md).

**Prerequisites (operational, not replaced by this doc):**

- [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) — first live sell
- [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md) — stability window
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](./GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — rollout phases

---

## Executive recommendation

| Horizon | Choice | Summary |
|---------|--------|---------|
| **Short term (now → ~12 months)** | **Option B** — Plugin hook integration | Capture approved events at source; Vault stays authoritative in-game; DB ledger is append-only audit + website truth. |
| **Long term (target architecture)** | **Option A** — DB-backed Vault provider | RealCore registers a Vault `Economy` provider; in-game balance reads/writes route through DB-backed logic. |
| **Rejected for production live sync** | **Option C** — Vault polling / delta mirror | Shadow and telemetry only; never auto-apply deltas to the ledger. |

**Do not enable `shop_buy`, `gameplay_spend`, or broad Factions rollout until this authority model is approved and SMP `shop_sell` has passed Phase 19.**

---

## 1. Current state

| Layer | Role today |
|-------|------------|
| **Vault / EconomyShopGUI / Essentials** | Authoritative for what players see and spend **in-game** on each backend |
| **Supabase `economy_ledger` + `economy_balances`** | Canonical for **website**, leaderboards, cross-server totals, audit |
| **RealCore gameplay sync** | `economyShopGuiSell` producer → buffer → HMAC API → ledger (`shop_sell`); dry-run and limited live trial on SMP |
| **RealCore vote rewards** | Separate path: Lobby1 → `VoteRewardLedgerWriteService` → `vote_reward` (must stay isolated) |
| **Vault delta shadow** | Observes drift; does not fix it automatically |
| **Anarchy** | Hard-blocked from global economy mutation (plugin + DB policy) |

Phases 16–19 prove **event capture and ledger integrity** for `shop_sell` on SMP. They do **not** make Vault and DB identical in real time.

---

## 2. Problem statement

Players experience economy through **Vault**. Staff and the website rely on the **DB ledger**. Without an explicit authority model:

- The same sell can update Vault immediately but DB only after batch flush.
- EssentialsX admin commands, other plugins, or manual Vault edits change balances without ledger rows.
- A periodic “sync Vault to DB” job can **double-credit** or hide root cause.
- Expanding to `shop_buy` / `gameplay_spend` multiplies drift and incident cost.

We need a **documented split of authority**, investigation rules for drift, and a migration path from incremental hooks to a single provider.

---

## 3. Design goals

1. **Single canonical global balance** for website, leaderboards, and cross-server reporting (DB).
2. **Predictable in-game experience** — no surprise balance jumps from background sync (Vault during Option B).
3. **Append-only ledger** — audit trail; no row deletes or in-place balance overwrites.
4. **Idempotent plugin writes** — duplicate events must not duplicate credits.
5. **Backend isolation** — Anarchy never mutates; Lobby1 vote path unchanged.
6. **Incremental rollout** — SMP first, Factions/Arcade only after proof.
7. **Operable incidents** — drift is measurable, explainable, and fixable via compensating entries.
8. **Bounded API/Cloudflare cost** — no runaway polling or mirror loops.

---

## 4. Non-goals (Phase 20)

- Implementing Option A or expanding Option B in code (separate phases).
- Enabling `shop_buy`, `gameplay_spend`, or generic `gameplay_earn` producers.
- Factions / Arcade / Anarchy gameplay economy rollout.
- Changing Lobby1 vote reward delivery or `can_reward` policy.
- Running Supabase migrations or production deploys.
- Replacing EconomyShopGUI or EssentialsX entirely in one step.
- Automatic mass `syncVaultFromDb --apply` on production SMP.

---

## 5. Option comparison

| Criterion | **A: DB-backed Vault provider** | **B: Plugin hook integration** | **C: Vault polling / delta mirror** |
|-----------|-----------------------------------|--------------------------------|-------------------------------------|
| **In-game authority** | DB (via RealCore provider) | Vault | Vault |
| **Ledger completeness** | High (all provider touches) | Medium (hooked events only) | Low (infers from deltas) |
| **Implementation risk** | High | Medium | Low code, **high incident risk** |
| **Drift between Vault & DB** | Minimal when mature | Expected temporarily | Chronic / ambiguous |
| **Double-credit risk** | Low if provider is sole writer | Low if idempotent hooks only | **High** if deltas applied live |
| **Rollout** | Big-bang per backend | Per producer / per backend | “Simple” but unsafe |
| **EssentialsX / other plugins** | Must use RealCore provider | May bypass hooks | Bypass + mirror fights them |
| **Operational clarity** | Excellent long-term | Good with shadow + discipline | Poor |
| **Fit for Phases 16–19** | Future | **Current trial** | Shadow only |

### Option A — DB-backed Vault provider

RealCore registers as the server’s Vault `Economy` implementation. Shop plugins, pay commands, and (eventually) other economy features read/write through RealCore, which:

- Enforces policy (`economy_server_policies`, caps, categories).
- Appends matching `economy_ledger` rows.
- Exposes balance = DB `economy_balances` (with caching).

**Pros:** One write path; best long-term consistency; clearest incident model.
**Cons:** Highest engineering and migration cost; must subsume or intercept EssentialsX economy; high regression risk during cutover.

### Option B — Plugin hook integration

RealCore hooks **specific producers** (today: EconomyShopGUI sell). Vault still applies payouts; RealCore records the same economic intent to the ledger when policy allows.

**Pros:** Matches current architecture; incremental; SMP-proven path; lower blast radius.
**Cons:** Incomplete ledger if unhooked plugins change Vault; requires drift monitoring and staff discipline.

### Option C — Vault polling / delta mirror

Periodic compare Vault vs DB; write `vault_mirror_adjustment` or similar for differences.

**Pros:** Easy to describe.
**Cons:** Cannot attribute cause; risks double-credit; fights legitimate Vault-only flows; unsuitable for production **live** sync.

**Decision: Option C is rejected for production live sync.** It may continue as **shadow/telemetry only** ([ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md), vault delta shadow).

---

## 6. Recommended path

```text
Today ─────────────────────────────────────────────► Long term
        Option B (hooks + ledger)              Option A (DB Vault provider)
              │                                        ▲
              │    Phase 16–19 prove shop_sell       │
              │    Factions after SMP stable          │
              │    Migrate backend-by-backend         │
              └────────────────────────────────────────┘
                        Option C: shadow only, never live mirror
```

1. **Now:** Option B for `shop_sell` on SMP (and future hooks per producer).
2. **During Option B:** Vault authoritative in-game; DB authoritative for website; investigate drift.
3. **After SMP + monitoring success:** Design Option A per backend; pilot one non-critical backend before Lobby1-adjacent changes.
4. **Never:** Option C as automated ledger writer.

---

## 7. Short-term implementation plan (Option B)

| Step | Action |
|------|--------|
| 1 | Complete Phase 16 dry-run + Phase 17 DB readiness + Phase 18 live sell + Phase 19 monitoring on **SMP only** |
| 2 | Keep `shop_sell` only; `can_earn=true`, `can_spend=false` until spend model approved |
| 3 | Enable producers one at a time with dry-run → preflight → single live event → monitoring |
| 4 | Run vault delta shadow + `/rf economy balance` samples; log unexplained drift |
| 5 | Document per-event idempotency keys and ledger row for each hook |
| 6 | **Next hooks (ordered):** EconomyShopGUI buy (`shop_buy`) only after authority doc sign-off; then gameplay spend if needed |
| 7 | Factions: **wait** until SMP Phase 19 success criteria met |
| 8 | Arcade / Anarchy: **no rollout** |

**Authority rule (Option B):** When hook fires successfully, ledger amount must match Vault credit/debit for that event. When hook does not fire, drift is **expected** until investigated.

---

## 8. Long-term implementation plan (Option A)

| Step | Action |
|------|--------|
| 1 | Design RealCore `Economy` provider API: deposit, withdraw, getBalance, format |
| 2 | Route EconomyShopGUI (and other economy plugins) through provider on pilot backend |
| 3 | Disable direct EssentialsX economy mutations on pilot or intercept via provider priority |
| 4 | Single write path: provider → policy check → ledger append → balance update |
| 5 | Remove redundant Option B hooks where provider subsumes them |
| 6 | Expand backend-by-backend: SMP → Factions → Arcade (if ever); never Anarchy |
| 7 | Keep vote rewards on dedicated Lobby1 path until explicitly merged into provider design |

**Success:** In-game balance equals DB balance except replication lag &lt; few seconds; no shadow “mystery deltas.”

---

## 9. Drift handling policy

| Principle | Policy |
|-----------|--------|
| **Expected during Option B** | Vault moves on every sell; DB moves when hook + batch succeed — temporary gap is normal |
| **Investigation** | Shadow logs, `/rf economy balance`, ledger row lookup by idempotency key, staff interview (admin commands?) |
| **Forbidden** | Blind mirror of `abs(vault - db)` into ledger in production |
| **Corrections** | `admin_adjustment` or reviewed compensating append-only entries |
| **Never** | `DELETE`/`UPDATE` on `economy_ledger` or overwrite `economy_balances` |
| **Large drift** | Stop live hooks; rollback policy; fix root cause before resuming |

---

## 10. Rollback policy

| Layer | Rollback |
|-------|----------|
| **Plugin** | `dryRun=true`, disable producer, `gameplaySync.enabled=false` |
| **Policy** | `smp-1` `can_earn=false`, caps `0` (see Phase 17/18/19 docs) |
| **Option A pilot** | Re-register prior Vault economy provider; disable RealCore provider |
| **Ledger mistakes** | Compensating entries only; preserve history |

Vote reward rollback is **independent** — never disable Lobby1 `can_reward` as part of SMP gameplay rollback.

---

## 11. Migration path from Option B → Option A

| Phase | Description |
|-------|-------------|
| **B1** | SMP `shop_sell` stable (Phases 18–19) |
| **B2** | Add `shop_buy` on SMP under Option B (if approved) |
| **B3** | Factions read-only + shadow; then hooked earn/spend if policy approved |
| **A0** | Provider design + unit/integration tests offline |
| **A1** | SMP maintenance window: enable RealCore Vault provider; disable parallel hook for shop events already covered |
| **A2** | Compare shadow deltas for 7+ days; zero unexplained severe deltas |
| **A3** | Factions cutover (if in scope); Arcade only with strict caps |
| **A4** | Deprecate Option B hooks superseded by provider; keep vote path explicit |

**Data:** No ledger migration required — same tables. **Behavior:** players see balance source change; communicate in release notes.

---

## 12. Impact by area

### SMP

- **Option B:** Continue current trial; Vault pays sells; ledger records `shop_sell`.
- **Option A:** Players see DB-backed balance via provider; shop plugins unchanged at API level.
- **Risk:** Cutover window; rehearse rollback.

### Factions

- **Option B:** Deferred until SMP Phase 19 pass.
- **Option A:** Later; likely stricter caps and separate policy row.

### Arcade

- **Excluded** until SMP + Factions patterns exist; small-reward character may need different caps.

### Anarchy

- **No mutation** in any option for global economy; plugin guard + `economy_server_policies` remain disabled.

### Lobby1 vote rewards

- **Unchanged** in Option B and during SMP work.
- **Option A:** Keep `VoteRewardLedgerWriteService` or equivalent isolated path until single-provider design explicitly includes `vote_reward` with `can_reward` on `lobby-1` only.
- **Never** route vote payouts through SMP producers or mirror jobs.

### Website leaderboard

- Reads `economy_balances` / `public_economy_leaderboard` — benefits from complete ledger under Option B; fully aligned under Option A.
- Drift during Option B may make leaderboard differ from in-game Vault until players “earn” hooked events.

### Cloudflare / API usage

- **Option B:** Bounded batch writes per hooked event; no polling loop.
- **Option A:** Similar batch volume if one write per provider operation; avoid mirror polling (Option C anti-pattern).
- **Watch:** 429 rate limits during spikes — preflight + monitoring thresholds from Phase 19.

### Supabase ledger / balances

- Append-only `economy_ledger`; `economy_balances` updated only via RPC paths.
- Option B may lag Vault; Option A converges them.
- Corrections only via `admin_adjustment` / import paths — never destructive edits.

---

## 13. Stop conditions

Stop expanding hooks or starting Option A pilot if:

| Condition |
|-----------|
| Duplicate credits or idempotency failures |
| Unexplained severe drift growth on shadow |
| Vote reward regressions on Lobby1 |
| Non-SMP gameplay ledger rows |
| Anarchy policy or plugin guard bypass |
| Repeated API 4xx/5xx or 429 storms |
| Staff cannot attribute drift within SLA |
| `shop_buy` / spend requested before this ADR is signed off |

---

## 14. Open questions

| # | Question | Owner / when |
|---|----------|--------------|
| 1 | When is EssentialsX economy disabled vs wrapped on each backend? | Before Option A pilot |
| 2 | Should `shop_buy` use separate policy trial (`can_spend`) or earn-only longer? | Product + economy lead |
| 3 | Does Factions need local-only economy separate from global DB? | Network design |
| 4 | Maximum acceptable DB–Vault drift (minor units) during Option B? | Ops SLA |
| 5 | Merge vote path into Vault provider vs permanent side channel? | Before Lobby touches Option A |
| 6 | Public leaderboard disclaimer while Option B active? | Website |
| 7 | `vault_mirror_adjustment` category — ever for manual staff use only? | Policy |
| 8 | Timeline for Option A pilot after Phase 19 sign-off? | Roadmap |

---

## Related docs

| Doc | Role |
|-----|------|
| [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](./GAMEPLAY_ECONOMY_SYNC_DESIGN.md) | Phase index (update Phase 3 to this ADR) |
| [GLOBAL_ECONOMY.md](./GLOBAL_ECONOMY.md) | Ledger foundation |
| [ECONOMY_GAMEPLAY_OBSERVABILITY.md](./ECONOMY_GAMEPLAY_OBSERVABILITY.md) | Metrics / shadow |
| [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md) | Pre-requisite stability |

---

## Sign-off (optional)

| Role | Name | Date | Approved Option B→A path |
|------|------|------|-------------------------|
| Network lead | | | |
| Plugin / RealCore | | | |
| Ops / DB | | | |

**shop_buy / gameplay_spend enablement:** blocked until row above complete.

Lobby1 `vote_reward` uses a separate write path and must remain unchanged.

Factions economy sync is **not approved**; risk assessment and prerequisites:
[ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md](ECONOMY_FACTIONS_ROLLOUT_RISK_PHASE31.md).
