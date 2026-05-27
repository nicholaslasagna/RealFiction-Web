# SMP shop_sell live trial (overview)

High-level plan for the **first live** global-economy gameplay write on **SMP only**:
EconomyShopGUI sell → RealCore buffer → Supabase `economy_ledger` (`shop_sell`).

**Canonical execution steps:** [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) (Phase 18).

This overview does not enable writes, run SQL, or deploy anything.

---

## Trial shape

| Aspect | Value |
|--------|--------|
| Backend | `smp-1` only |
| Category | `shop_sell` only (maps to `can_earn`) |
| Spend | **Off** (`can_spend=false`, `shopBuy` off) |
| Vote rewards | **Lobby1 only** — SMP `can_reward=false` |
| Volume | **One** low-value test sell, then hold/rollback |
| Anarchy / Factions / Arcade | **Out of scope** |

---

## Gate sequence

```text
Phase 16  SMP jar + config dry-run  →  no ledger rows
    ↓
Phase 17  DB migrations + policy verification (read-only SQL)
    ↓
Phase 18  Live execution (policy SQL + dryRun:false + one sell)  →  this trial
```

| Phase | Document |
|-------|----------|
| 16 | [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) |
| 17 | [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md) |
| 18 | [ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md](./ECONOMY_SMP_SHOP_SELL_LIVE_EXECUTION.md) |

---

## What changes in a live trial (vs dry-run)

| Layer | Dry-run (Phase 16) | Live (Phase 18) |
|-------|--------------------|-----------------|
| Supabase `smp-1` | `can_earn=false` | `can_earn=true` (manual SQL) |
| Plugin `gameplaySync.dryRun` | `true` | `false` |
| Producer `dryRun` | `true` | `false` |
| Ledger | No new `shop_sell` rows | **One** expected row per test sell |
| Vault | EconomyShopGUI pays locally | Same (unchanged) |

---

## Stop and rollback

Use Phase 18 §8–9: revert plugin `dryRun`, disable sync if needed, run SMP read-only
policy SQL, restart SMP. Never delete ledger rows; use compensating entries only
after review.

---

## Related docs

- [ECONOMY_SMP_LIVE_MONITORING_PHASE19.md](./ECONOMY_SMP_LIVE_MONITORING_PHASE19.md) — post-live monitoring window
- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — dry-run ops
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — policy SQL history (Phase 7)
- [REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md](./REALCORE_GAMEPLAY_ECONOMY_RELEASE_PLAN.md) — RC and merge order
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](./GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — phase index
