# RealFiction Global Economy — Waterfall Operator Checklists

Operator checklists for staged economy rollout. **Do not execute a stage until the prior stage is complete and explicitly approved.**

Related implementation docs:

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md)
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md)
- [sql/economy-smp-gameplay-write-trial.sql](./sql/economy-smp-gameplay-write-trial.sql)

---

## Stage 1 — Global economy foundation

**Status:** Applied on production (`wznnetmkmmqiiejecfjl`).

- [x] Economy tables + RPCs (018+)
- [x] SMP read-only policy 024 (`can_read=true`, writes false)
- [x] Category expansion 026 (`shop_sell`, `shop_buy`, gameplay categories)
- [x] Grants hardening 027 (no direct authenticated table access)

---

## Stage 3 — Production candidate (repo gate)

**Status:** Phase 19 audit — verify on `main` before first deploy.

- [ ] `mvn -q -f realcore/pom.xml test` passes
- [ ] Jar built and SHA256 recorded (see [ECONOMY_PRODUCTION_CANDIDATE_READINESS.md](./ECONOMY_PRODUCTION_CANDIDATE_READINESS.md))
- [ ] Bundled defaults verified safe (`modules.economy=false`, gameplay sync off/dry-run)
- [ ] Startup `[EconomyProduction]` log reviewed after reload (no unexpected live-arm warnings)
- [ ] Operator runbooks match current commands/config keys

**Not required for this stage:** SMP deploy, SQL, live writes.

---

## Stage 4 — SMP dry-run (user testing gate)

**Definition of done:**

- [ ] RealCore jar from `main` deployed to **SMP only**
- [ ] Economy infrastructure enabled (`modules.economy`, `economy.enabled`)
- [ ] `gameplaySync.dryRun=true` throughout
- [ ] **Gate A:** gameplay sync disabled, preflight READY, no capture
- [ ] **Gate B:** `shop_sell` dry-run — `[GameplaySync:DRYRUN]`, `queued=0`, no ledger rows
- [ ] **Gate C:** `shop_buy` dry-run — same proof, no ledger rows
- [ ] Per-producer metrics distinguish sell vs buy (`/rf economy gameplay producers`)
- [ ] Lobby1 vote rewards unchanged
- [ ] Factions / Anarchy untouched

**Stop conditions:** gameplay POSTs during dry-run, `queued`/`accepted` increment, new `shop_sell`/`shop_buy` ledger rows, TPS degradation.

**Rollback:** disable producers + `gameplaySync.enabled=false`; restore jar/config backup.

---

## Stage 5 — SMP live write trial

**Not approved until Stage 4 (SMP dry-run) complete.**

- [ ] Dry-run soak signed off
- [ ] Apply SMP write policy SQL (`can_earn`/`can_spend`, caps) — see policy rollout doc
- [ ] Plugin: `dryRun=false` for controlled trial (shop_sell first, shop_buy later)
- [ ] `/rf economy gameplay preflight live` → READY (review WARNs)
- [ ] Staffed window, small transactions, ledger review
- [ ] Rollback SQL + compensating-entry plan ready

---

## Stage 6 — Factions dry-run

**Later — same architecture, separate policy.**

- [ ] `factions-1` allowlisted in config only (dry-run)
- [ ] Old_Factions excluded
- [ ] Dry-run proof before any Factions live policy

---

## Stage 7 — Factions live

**After SMP stable + Factions dry-run clean.**

- [ ] Separate `economy_server_policies` row review for `factions-1`
- [ ] Conservative caps, preflight live, staffed monitoring

---

## Stage 8 — DB-backed Vault provider (future)

Long-term: RealCore registers Vault provider backed by canonical DB; eliminates drift/mirroring. Design-only until Stages 2–5 complete.

---

## Dry-run log format (post-hardening)

Expected log line shape:

```text
[GameplaySync:DRYRUN] dryRun=true serverId=smp-1 producerId=economyShopGuiSell category=shop_sell player=... amountMinor=... source=EconomyShopGUI eventId=...
```

Dry-run must **never** enqueue to writer or POST gameplay transactions.

## Pre-test complete baseline (main)

When labeled **SMP dry-run pre-test complete**, record the jar fingerprint at build time:

```bash
git rev-parse HEAD
shasum -a 256 realcore/target/RealCore-0.1.0-SNAPSHOT.jar
```

**Always re-record after rebuilding from main** — do not reuse an old hash in operator logs. Record commit + SHA in your deploy log when completing Stage 3.

## Dry-run soak cautions

- Do **not** run `/rf economy test` during Gates B/C dry-run unless intentionally testing the global writer — it bypasses gameplay producer dry-run and can POST to the economy API.
- Do **not** enable `dryRun=false` or Supabase `can_earn`/`can_spend` during Stage 4 dry-run.
- EconomyShopGUI must be installed before Gate B/C; absent plugin is a clean no-op at startup but capture will not occur.
