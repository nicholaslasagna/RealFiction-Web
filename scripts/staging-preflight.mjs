#!/usr/bin/env node
// Staging preflight for gift cards.
//
// WHAT THIS IS
// ============
// Everything about a staging gift-card run that can be checked WITHOUT a card,
// a browser, or a human. It answers one question — "is staging configured so
// the E2E sequence can succeed?" — which is what actually fails first, and
// which is tedious and error-prone to verify by hand.
//
// It does NOT buy anything, issue anything, or send anything. It is read-only
// against Stripe and Supabase, and it REFUSES to run against a live key.
//
// USAGE (staging credentials only, never production):
//   STRIPE_SECRET_KEY=sk_test_... \
//   SUPABASE_URL=https://<staging>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   STAGING_URL=https://<staging-worker-url> \
//   node scripts/staging-preflight.mjs
import { createClient } from "@supabase/supabase-js"

import { formatBlocked, formatResult } from "./preflight-reporter.mjs"

const results = []
const record = (ok, label, reasonCode = null, count = null) => {
  const { row, line } = formatResult(ok, label, reasonCode, count)
  // Only allowlisted text and a stringified number are STORED, so the summary
  // at the end cannot reconstruct anything unsafe either.
  results.push(row)
  console.log(line)
}

const env = process.env
const need = ["STRIPE_SECRET_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STAGING_URL"]
const missing = need.filter((k) => !env[k]?.trim())
if (missing.length) {
  console.error(`Set these first: ${missing.join(", ")}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// 1. Stripe must be TEST mode. This guard is what makes the rest safe to run.
// ---------------------------------------------------------------------------
const key = env.STRIPE_SECRET_KEY.trim()
if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
  console.error("\nREFUSING TO RUN: STRIPE_SECRET_KEY is a LIVE key.")
  console.error("This script is for staging only. Nothing was contacted.")
  process.exit(3)
}
// The key PREFIX is still checked; it is simply no longer printed. Even eight
// characters of a secret is eight characters of a secret in a CI log.
const keyIsTest = key.startsWith("sk_test_") || key.startsWith("rk_test_")
record(keyIsTest, "Stripe key is test mode", keyIsTest ? "ok" : "stripe_key_not_test")

// Read-only, and it makes Stripe itself confirm the mode rather than trusting
// the key prefix.
const balance = await fetch("https://api.stripe.com/v1/balance", {
  headers: { Authorization: `Bearer ${key}` }
})
const balanceBody = await balance.json().catch(() => ({}))
// Stripe's own error text is NOT echoed: a provider message can quote back a
// redacted key fragment. The HTTP status is a number and is safe.
record(balance.ok, "Stripe API reachable with that key",
  balance.ok ? "ok" : "stripe_unreachable", balance.ok ? null : balance.status)
record(balanceBody.livemode === false, "Stripe reports livemode=false",
  balanceBody.livemode === false ? "ok" : "stripe_livemode_true")

// ---------------------------------------------------------------------------
// 2. Supabase: migrations and catalog.
// ---------------------------------------------------------------------------
const db = createClient(env.SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
  auth: { persistSession: false }
})

// Every function the gift-card path calls. A missing one means an unapplied
// migration — the failure this exists to catch before a customer does.
const REQUIRED_FUNCTIONS = [
  "issue_gift_card_for_order",
  "claim_gift_card",
  "reserve_credit_lots",
  "gift_origin_available",
  "begin_gift_card_refund",
  "complete_gift_card_refund",
  "record_gift_card_dispute",
  "resolve_gift_card_dispute",
  "claim_pending_gift_card_refunds",
  "evaluate_gift_card_velocity",
  "record_abuse_event",
  "purge_abuse_events",
  "request_cash_redemption",
  "resolve_cash_redemption"
]

for (const fn of REQUIRED_FUNCTIONS) {
  const { error } = await db.rpc(fn, {})
  // PGRST202 means "no such function". Any OTHER error means the function
  // exists and merely rejected our empty arguments — which is what we want.
  const exists = !(error && String(error.code) === "PGRST202")
  // `fn` comes from the REQUIRED_FUNCTIONS literal above, never the environment.
  record(exists, `migration applied: ${fn}()`, exists ? null : "migration_missing")
}

const { data: rows, error: rowsError } = await db
  .from("products")
  .select("slug,price_cents,active")
  .eq("category", "gift_cards")
  .order("price_cents")

const EXPECTED = [500, 1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000]
if (rowsError) {
  // The driver's error message can carry the project URL, which is built from
  // SUPABASE_URL. Only the fixed reason is reported.
  record(false, "gift-card catalog readable", "catalog_unreadable")
} else {
  record(rows.length === 9, "nine gift-card rows exist",
    rows.length === 9 ? null : "row_count_wrong", rows.length)
  record(
    JSON.stringify(rows.map((r) => r.price_cents)) === JSON.stringify(EXPECTED),
    "denominations are $5-$100 at the right cents",
    "denominations_wrong"
  )
  const active = rows.filter((r) => r.active).length
  record(active === 9, "all nine rows ACTIVE in staging",
    active === 9 ? null : "rows_not_active", active)
}

// ---------------------------------------------------------------------------
// 3. The deployed gate.
// ---------------------------------------------------------------------------
// The storefront is the one honest signal that every runtime secret landed: it
// renders a purchase form only when the feature flag, both crypto keys, the
// abuse pepper, Resend, the sender, AND the tax value are all present.
const store = await fetch(`${env.STAGING_URL.replace(/\/$/, "")}/store`, {
  headers: { Accept: "text/html" }
})
const html = await store.text().catch(() => "")
record(store.ok, "staging /store reachable", store.ok ? null : "store_unreachable", store.status)

const offersGiftCards = /gift[- ]card/i.test(html) && !/coming soon/i.test(html)
record(
  offersGiftCards,
  "storefront gate is OPEN (all six runtime secrets present)",
  offersGiftCards ? "gate_open" : "gate_closed"
)

console.log("")
const blocked = results.filter((r) => !r.ok)
if (blocked.length === 0) {
  console.log("PREFLIGHT CLEAN - staging is ready for the manual E2E sequence.")
  process.exit(0)
}
console.log(`${blocked.length} BLOCKED item(s):`)
// `b.reason` is a value from REASONS and `b.count` is a stringified number, so
// this sink can only print allowlisted text.
for (const b of blocked) console.log(formatBlocked(b))
process.exit(1)
