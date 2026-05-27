# Economy Transaction Categories (Phase 6)

Phase 6 prepares schema and API category support for future gameplay economy
sync. **Category support does not enable live gameplay ledger writes.** SMP,
Factions, and Arcade remain read-only or disabled for mutation unless a later
reviewed rollout changes `economy_server_policies`.

## Canonical ledger categories

| Category | Plugin route | Policy flag | Notes |
|----------|--------------|-------------|-------|
| `vote_reward` | Yes | `can_reward` | Lobby1 live path; unchanged by Phase 6 |
| `gameplay_earn` | Yes | `can_earn` | General gameplay credit |
| `gameplay_spend` | Yes | `can_spend` | General gameplay debit |
| `shop_sell` | Yes | `can_earn` | Shop sell proceeds (credit) |
| `shop_buy` | Yes | `can_spend` | Shop purchase (debit) |
| `spend` | Yes | `can_spend` | **Legacy alias**; same gate as `gameplay_spend` |
| `admin_adjustment` | No | N/A | `admin_adjust_economy_balance` RPC only |
| `migration_import` | No | N/A | `admin_import_economy_balances` RPC only |
| `vault_mirror_adjustment` | No | N/A | Reserved for manual/admin reconciliation only; not for automatic live sync |

## Enforcement layers

1. **Ledger constraint** (`economy_ledger_category_allowed`) — all rows.
2. **`_economy_assert_plugin_category`** — plugin/batch RPC path only.
3. **`_economy_assert_policy`** — per-server caps and `can_*` flags; blocks Anarchy.
4. **API Zod** (`lib/economy-categories.ts`) — mirrors plugin categories before RPC.
5. **RealCore** — still uses `vote_reward`, `gameplay_earn`, `spend` only until a later plugin phase.

## Legacy `spend` compatibility

Existing RealCore and API clients may continue sending `spend`. The database
stores the category as submitted (`spend`). Policy treats `spend` and
`gameplay_spend` identically (`can_spend`). New producers should prefer
`gameplay_spend`, `shop_sell`, or `shop_buy` for clearer audit trails.

## Rollback

Never delete or update ledger rows. Roll back incorrect economy state with
compensating append-only entries (`admin_adjustment` or reviewed
`migration_import` / rollback import batches).

## Related docs

- `docs/GLOBAL_ECONOMY.md` — foundation and policy fields
- `docs/GAMEPLAY_ECONOMY_SYNC_DESIGN.md` — gameplay sync rollout phases
- [ECONOMY_DATABASE_READINESS_PHASE17.md](./ECONOMY_DATABASE_READINESS_PHASE17.md) — production migration/policy verification SQL
- Migration `supabase/migrations/202605270026_economy_transaction_categories.sql`
