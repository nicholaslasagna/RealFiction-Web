# Shop buy and spend path design (Phase 21+)

Design and rollout plan for **debit-side** gameplay economy ledger events:
`shop_buy`, `gameplay_spend`, and legacy `spend`.

**Authority:** Vault authoritative in-game short-term; DB ledger records approved events.
Lobby1 `vote_reward` remains a separate path and must not change.

---

## Phase 22 (code)

`EconomyShopGuiBuyProducer` — disabled by default, dry-run only. Merge the Phase 22
RealCore PR before running Phase 23 SMP dry-run ops.

---

## Phase 23: SMP dry-run testing

Full operator steps: **[ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md)**.

Summary: SMP jar with Phase 22 code, `shopBuy` + `economyShopGuiBuy` enabled with
both `dryRun=true`, one tiny buy, confirm `[GameplaySync:DRYRUN] category=shop_buy`,
`queued=0`, unchanged `shop_buy` ledger count — **no** `can_spend`, **no** `dryRun=false`.

---

## Related docs

- [ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md)
- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md)
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md)
