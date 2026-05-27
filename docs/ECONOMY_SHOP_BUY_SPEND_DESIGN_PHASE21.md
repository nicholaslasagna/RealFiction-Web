# Shop buy and spend path design (Phase 21+)

Design and rollout plan for **debit-side** gameplay economy ledger events:
`shop_buy`, `gameplay_spend`, and legacy `spend`.

**Authority:** Vault authoritative in-game short-term; DB ledger records approved events.
Lobby1 `vote_reward` remains a separate path and must not change.

---

## Phase 22 implementation status (buy producer skeleton)

RealCore now includes **`EconomyShopGuiBuyProducer`** — disabled by default, dry-run only.

| Item | State |
|------|--------|
| Java class | `EconomyShopGuiBuyProducer` |
| Config block | `economy.gameplaySync.producers.economyShopGuiBuy` |
| Event | `me.gypopo.economyshopgui.api.events.PostTransactionEvent` (reflection) |
| Filters | `BUY`, `SUCCESS`, Vault/money, `amountMinor > 0` |
| Category | `shop_buy` (global `categories.shopBuy: false` by default) |
| Live debits | **No** — `dryRun=true` defaults; no writer enqueue |
| Vault | **No mutation** |
| DB policy | **No `can_spend` changes** in Phase 22 |
| Migrations / deploy | **None** |

Default config:

```yaml
economy:
  gameplaySync:
    categories:
      shopBuy: false
    producers:
      economyShopGuiBuy:
        enabled: false
        category: shop_buy
        dryRun: true
        logEvents: true
        maxEventsPerFlush: 250
```

Idempotency key (stable `eventId`, not timestamp-only):

```text
gameplay:<serverId>:shop_buy:economyshopgui:<playerUuid>:<eventId>
```

### How to test later (SMP dry-run, not live)

1. Deploy Phase 22 jar only (no Supabase policy changes).
2. On SMP: `gameplaySync.enabled=true`, `gameplaySync.dryRun=true`.
3. Enable capture only: `categories.shopBuy=true`, `producers.economyShopGuiBuy.enabled=true`, keep `producers.economyShopGuiBuy.dryRun=true`.
4. Buy items in EconomyShopGUI; confirm `[GameplaySync:DRYRUN]` lines and `/rf economy gameplay producers` **economyShopGuiBuy** metrics increase.
5. Confirm **no** ledger rows, **no** Vault balance change from RealCore, **no** vote reward changes.

### Rollback

Set `producers.economyShopGuiBuy.enabled: false` (or `gameplaySync.enabled: false`) and reload.

### Still future phases

- Live debit enqueue (`dryRun=false`) only after `can_spend` policy trial and Phase 19-style monitoring
- `gameplay_spend` producer(s)
- Compensating flows for refunds/cancels

See also:

- [ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md](ECONOMY_GAMEPLAY_PRODUCER_ROLLOUT.md)
- [GAMEPLAY_ECONOMY_SYNC_DESIGN.md](GAMEPLAY_ECONOMY_SYNC_DESIGN.md)
