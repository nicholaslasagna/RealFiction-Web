# Gameplay Economy Producer Rollout (Phase 9)

Phase 9 adds the first gameplay producer: **EconomyShopGUI sell** events on SMP. It
captures positive credits only (`shop_sell` or `gameplay_earn` category config) and
routes them through `GameplayEconomyTransactionBuffer`.

## Defaults (safe)

```yaml
economy:
  enabled: false
  gameplaySync:
    enabled: false
    dryRun: true
    categories:
      shopSell: false
    producers:
      economyShopGuiSell:
        enabled: false
        category: shop_sell
        dryRun: true
```

No DB ledger writes occur with these defaults.

## Event hook

- Plugin: `EconomyShopGUI` or `EconomyShopGUI-Premium` (softdepend)
- Event: `me.gypopo.economyshopgui.api.events.PostTransactionEvent`
- Filter: `Transaction.Type` name contains `SELL`, result starts with `SUCCESS`
- Vault amounts only (`getPrice()` / `getPrices()` VAULT entries), converted to minor units (`× 100`)

## Dry-run log format

```text
[GameplaySync:DRYRUN] server=smp-1 category=shop_sell player=Alex(00000000-0000-0000-0000-000000000123) amountMinor=2500 source=EconomyShopGUI eventId=SELL_SCREEN:blocks.stone:64:2500:00000000-0000-0000-0000-000000000123
```

## Observability

- `/rf economy gameplay` — buffer + producer summary
- `/rf economy gameplay producers` — producer metrics and hook status

## Dedup cache

- Key: gameplay idempotency key (`gameplay:<serverId>:<category>:<source>:<uuid>:<eventId>`)
- Default TTL: 300 seconds (`dedupCacheSeconds`)
- Default max entries: 10000

## Enabling for SMP dry-run testing

Use the operator checklist: **[ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md)** (Phase 10).

Summary: SMP-only jar + config with `gameplaySync.enabled=true`, both `dryRun=true`,
`shopSell` category on, producer enabled — **without** `can_earn` DB policy changes.

## Not in Phase 9

- `shop_buy` / `gameplay_spend` (buy skeleton: Phase 22; SMP buy dry-run ops: Phase 23)
- Vault balance mutation
- Automatic DB policy enablement
- Factions / Arcade producers

## Phase 22: EconomyShopGUI buy skeleton (prerequisite for Phase 23)

RealCore adds `economyShopGuiBuy` (disabled by default, `dryRun: true`). See
[ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md](ECONOMY_SHOP_BUY_SPEND_DESIGN_PHASE21.md).

## Phase 23: SMP shop_buy dry-run ops plan

Operator rollout to test buy capture on SMP with **no DB writes**: see
[ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md).

Requires Phase 22 jar on SMP; keeps `dryRun=true` and `can_spend=false`.

## Rollback

Set `economy.gameplaySync.producers.economyShopGuiSell.enabled: false` (or
`economy.gameplaySync.enabled: false`) and reload RealCore.

## Related docs

- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — Phase 10 SMP operator dry-run plan
- [ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md](ECONOMY_SMP_SHOP_BUY_DRY_RUN_ROLLOUT.md) — Phase 23 SMP buy dry-run plan
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — future live writes (not dry-run)
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md) — full phase plan
