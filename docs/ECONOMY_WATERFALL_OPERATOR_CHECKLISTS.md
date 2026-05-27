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

## Stage 2 — SMP dry-run (user testing gate)

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

## Stage 3 — SMP live write trial

**Not approved until Stage 2 complete.**

- [ ] Dry-run soak signed off
- [ ] Apply SMP write policy SQL (`can_earn`/`can_spend`, caps) — see policy rollout doc
- [ ] Plugin: `dryRun=false` for controlled trial (shop_sell first, shop_buy later)
- [ ] `/rf economy gameplay preflight live` → READY (review WARNs)
- [ ] Staffed window, small transactions, ledger review
- [ ] Rollback SQL + compensating-entry plan ready

---

## Stage 4 — Factions dry-run

**Later — same architecture, separate policy.**

- [ ] `factions-1` allowlisted in config only (dry-run)
- [ ] Old_Factions excluded
- [ ] Dry-run proof before any Factions live policy

---

## Stage 5 — Factions live

**After SMP stable + Factions dry-run clean.**

- [ ] Separate `economy_server_policies` row review for `factions-1`
- [ ] Conservative caps, preflight live, staffed monitoring

---

## Stage 6 — DB-backed Vault provider (future)

Long-term: RealCore registers Vault provider backed by canonical DB; eliminates drift/mirroring. Design-only until Stages 2–5 complete.

---

## Dry-run log format (post-hardening)

Expected log line shape:

```text
[GameplaySync:DRYRUN] dryRun=true serverId=smp-1 producerId=economyShopGuiSell category=shop_sell player=... amountMinor=... source=EconomyShopGUI eventId=...
```

Dry-run must **never** enqueue to writer or POST gameplay transactions.
