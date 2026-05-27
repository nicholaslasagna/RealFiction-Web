# Economy authority model (Phase 20)

**Short-term (Option B):** Vault is authoritative for in-game balances; the DB
ledger records **approved** events for global/website tracking.

**Long-term (Option A):** DB-backed authority when ready — not part of current SMP
shop monitoring.

**Rejected:** Option C (dual-writer / automatic two-way sync without clear ownership).

During SMP `shop_sell` / `shop_buy` rollout, do not treat shadow reads as automatic
reconciliation. See combined monitoring:
[ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md](ECONOMY_SMP_EARN_SPEND_MONITORING_PHASE25.md).

Generic non-shop categories (`gameplay_earn`, `gameplay_spend`) are defined in
[ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md](ECONOMY_GENERIC_GAMEPLAY_EARN_SPEND_DESIGN_PHASE26.md)
— still disabled until a later phased rollout.

Lobby1 `vote_reward` uses a separate write path and must remain unchanged.
