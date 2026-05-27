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

## Enabling for SMP dry-run testing (later)

1. Apply Phase 6 category migration if not already applied.
2. Keep SMP DB policy read-only (Phase 5/7).
3. On SMP jar only:

```yaml
economy:
  enabled: true
modules:
  economy: true
  gameplaySync:
    enabled: true
    dryRun: true
    categories:
      shopSell: true
    producers:
      economyShopGuiSell:
        enabled: true
        dryRun: true
        logEvents: true
```

4. Reload RealCore and sell items in EconomyShopGUI.
5. Confirm `[GameplaySync:DRYRUN]` lines in console; confirm `/rf economy gameplay producers` counters increase.
6. Confirm no ledger rows appear for gameplay categories.

## Not in this phase

- `shop_buy` / `gameplay_spend`
- Vault balance mutation
- Automatic DB policy enablement
- Factions / Arcade producers

## Rollback

Set `economy.gameplaySync.producers.economyShopGuiSell.enabled: false` (or
`economy.gameplaySync.enabled: false`) and reload RealCore.
