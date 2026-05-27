import { z } from "zod"

/**
 * Categories accepted by plugin HMAC routes and apply_economy_batch.
 * Must stay aligned with public._economy_assert_plugin_category in Supabase.
 */
export const PLUGIN_ECONOMY_CATEGORIES = [
  "vote_reward",
  "gameplay_earn",
  "gameplay_spend",
  "shop_sell",
  "shop_buy",
  /** Legacy alias; policy gate matches gameplay_spend (can_spend). */
  "spend"
] as const

export type PluginEconomyCategory = (typeof PLUGIN_ECONOMY_CATEGORIES)[number]

export const pluginEconomyCategorySchema = z.enum(PLUGIN_ECONOMY_CATEGORIES)

/**
 * All categories that may appear on economy_ledger rows.
 * Admin/service RPCs only for admin_adjustment, migration_import, and
 * vault_mirror_adjustment (not plugin routes).
 */
export const LEDGER_ECONOMY_CATEGORIES = [
  ...PLUGIN_ECONOMY_CATEGORIES,
  "admin_adjustment",
  "migration_import",
  "vault_mirror_adjustment"
] as const

export type LedgerEconomyCategory = (typeof LEDGER_ECONOMY_CATEGORIES)[number]

/** Policy flag required for each plugin category. */
export const PLUGIN_CATEGORY_POLICY_FLAG: Record<PluginEconomyCategory, "can_reward" | "can_earn" | "can_spend"> = {
  vote_reward: "can_reward",
  gameplay_earn: "can_earn",
  gameplay_spend: "can_spend",
  shop_sell: "can_earn",
  shop_buy: "can_spend",
  spend: "can_spend"
}
