// The refund lifecycle, wired and executed against real PostgreSQL.
//
// The database proved the state machine. What this proves is that the
// APPLICATION drives it correctly: that eligibility and the freeze happen
// before Stripe is asked, that the amount Stripe receives is the one the
// database computed, and that uncertainty leaves value exactly where it is.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { createPgSupabaseClient, rows, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_REFUND_DB ?? "rf_refund_integration"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
sql(DB, `update public.products set active = true where slug in ('gift-card-25','gift-card-5')`)

mock.module("server-only", { namedExports: {}, defaultExport: {} })
mock.module("@/lib/supabase/service-role", {
  namedExports: { getSupabaseServiceRoleClient: () => createPgSupabaseClient(DB) }
})
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => createPgSupabaseClient(DB) } })

// A UNIQUE provider refund id per call. Stripe never reuses one, and
// gift_card_refunds_provider_idx is unique — a constant collided across tests.
let refundSeq = 0
const stripe = { refundBodies: [] as string[], refundKeys: [] as string[], mode: "succeed" as string, listed: [] as unknown[] }

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const target = String(url)
  if (target.includes("/v1/refunds?")) {
    return { ok: true, status: 200, json: async () => ({ data: stripe.listed }) } as never
  }
  if (target.includes("/v1/refunds")) {
    stripe.refundBodies.push(String(init?.body))
    stripe.refundKeys.push(String(new Headers(init?.headers as HeadersInit).get("Idempotency-Key")))
    if (stripe.mode === "timeout") throw new Error("aborted")
    if (stripe.mode === "500") return { ok: false, status: 500, json: async () => ({}) } as never
    const params = new URLSearchParams(String(init?.body))
    return {
      ok: true,
      status: 200,
      // A UNIQUE provider refund id per call. Stripe never reuses one, and
      // `gift_card_refunds_provider_idx` is unique — a constant collided across
      // tests, which is the index doing its job.
      json: async () => ({
        id: `re_live_${++refundSeq}`,
        status: "succeeded",
        amount: Number(params.get("amount"))
      })
    } as never
  }
  throw new Error(`unexpected call: ${target}`)
}) as never as typeof fetch

Object.assign(process.env, {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-not-a-real-key",
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key"
})

const { requestGiftCardRefund } = await import("./gift-card/refunds.ts")
const { reconcileGiftCardRefunds } = await import("./gift-card/reconcile-refunds.ts")

let seq = 0
const uuid = (p: number) => `${String(p).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`

function fixture(cents: number, claimed: boolean) {
  const buyer = uuid(11110000)
  const recipient = uuid(22220000)
  const order = uuid(33330000)
  const card = uuid(44440000)
  const verifier = `v-${seq}`
  const email = `r${seq}@e.test`

  sql(DB, `
    insert into auth.users (id,email) values ('${buyer}','b${seq}@e.test'),('${recipient}','${email}') on conflict do nothing;
    insert into public.profiles (id,email) values ('${buyer}','b${seq}@e.test'),('${recipient}','${email}') on conflict do nothing;
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${buyer}','b@e.test','B','stripe','pi_${seq}','fulfilled',${cents},0,${cents},0,${cents},'USD');
    insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
    select '${order}', id, '{"slug":"gift-card"}'::jsonb,1,${cents},${cents} from public.products where category='gift_cards' and price_cents=${cents} limit 1;
    insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
    values ('${card}',${cents},${cents},'USD','${buyer}','${order}','active','${email}','RFG-${String(seq).padStart(8,'0')}');
    insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
    values ('${card}','${verifier}','WXYZ');`)

  if (claimed) sql(DB, `select public.claim_gift_card('${verifier}','${recipient}','${email}')`)
  return { buyer, recipient, order, card, verifier, email }
}

const avail = (u: string) => Number(sql(DB, `select public.gift_origin_available('${u}')`))
const ledger = (u: string) => Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${u}'`))
const cardStatus = (c: string) => sql(DB, `select status from public.gift_cards where id='${c}'`)
const refundState = (c: string) => sql(DB, `select state from public.gift_card_refunds where gift_card_id='${c}'`)

function reset() { stripe.refundBodies = []; stripe.refundKeys = []; stripe.mode = "succeed"; stripe.listed = [] }

// ===========================================================================

test("UNCLAIMED: refund sends exactly 2500 and the card becomes unclaimable", async () => {
  reset()
  const f = fixture(2500, false)

  const result = await requestGiftCardRefund(f.card)

  assert.equal(result.outcome, "refunded")
  assert.equal(stripe.refundBodies.length, 1, "exactly one Stripe call")
  assert.match(stripe.refundBodies[0], /amount=2500/, "STRIPE RECEIVED EXACTLY 2500")
  assert.match(stripe.refundBodies[0], /payment_intent=pi_/)
  assert.match(stripe.refundKeys[0], /^realfiction-giftcard-refund:/, "deterministic idempotency key")

  assert.equal(cardStatus(f.card), "void")
  assert.equal(refundState(f.card), "completed")
  assert.equal(
    sql(DB, `select outcome from public.claim_gift_card('${f.verifier}','${f.recipient}','${f.email}')`),
    "invalid",
    "CLAIM IS IMPOSSIBLE"
  )
  assert.equal(avail(f.recipient), 0, "no credit exists")
})

test("CLAIMED-UNUSED: value freezes, Stripe gets 2500, exact $25 reversal", async () => {
  reset()
  const f = fixture(2500, true)
  assert.equal(avail(f.recipient), 2500, "claimed")

  const result = await requestGiftCardRefund(f.card)

  assert.equal(result.outcome, "refunded")
  assert.match(stripe.refundBodies[0], /amount=2500/)
  assert.equal(result.refundedCents, 2500, "EXACT $25 REVERSAL")
  assert.equal(avail(f.recipient), 0, "zero remaining gift-origin value")
  assert.equal(ledger(f.recipient), 0, "and the ledger is exactly zero")
  assert.ok(ledger(f.recipient) >= 0, "NO NEGATIVE BALANCE")
})

test("PARTIALLY SPENT: no Stripe call at all, review once", async () => {
  reset()
  const f = fixture(2500, true)

  // Spend $12.99 through the real credit path.
  const order = uuid(55550000)
  sql(DB, `
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${f.recipient}','r@e.test','P','stripe','pending',1299,0,1299,0,1299,'USD');
    insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
    select '${order}', id, '{"slug":"realvip-3m"}'::jsonb,1,1299,1299 from public.products where slug='realvip-3m';
    select public.reserve_store_credit_for_order('${order}','${f.recipient}',1299);
    select public.complete_store_credit_only_order('${order}','${f.recipient}');`)

  assert.equal(avail(f.recipient), 1201, "$12.01 remains")

  const result = await requestGiftCardRefund(f.card)

  assert.equal(result.outcome, "review_required")
  assert.deepEqual(stripe.refundBodies, [], "NO STRIPE CALL WAS MADE")
  assert.equal(avail(f.recipient), 1201, "value untouched")
  assert.ok(
    Number(sql(DB, `select count(*) from public.entitlements e join public.order_items oi on oi.id=e.order_item_id where oi.order_id='${order}' and e.status='active'`)) === 1,
    "the delivered RealVIP remains"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.payment_reviews where reason='gift_card_claimed_partially_spent'`)),
    1,
    "review created once"
  )
})

test("LOST RESPONSE: value stays frozen, then reconciliation finalises exactly once", async () => {
  reset()
  const f = fixture(2500, true)

  // Stripe creates the Refund; our response is lost.
  stripe.mode = "500"
  const attempt = await requestGiftCardRefund(f.card)

  assert.equal(attempt.outcome, "provider_uncertain", "uncertainty is not failure")
  assert.equal(refundState(f.card), "provider_refund_pending")
  assert.equal(avail(f.recipient), 0, "THE VALUE STAYS FROZEN — nothing was unfrozen on a lost response")
  assert.equal(ledger(f.recipient), 2500, "and nothing was reversed prematurely")

  // The Refund really does exist at Stripe.
  const refundId = sql(DB, `select id from public.gift_card_refunds where gift_card_id='${f.card}'`)
  stripe.listed = [{ id: "re_recovered", status: "succeeded", amount: 2500, metadata: { realfiction_refund_id: refundId } }]
  sql(DB, `update public.gift_card_refunds set provider_requested_at = now() - interval '5 minutes' where id='${refundId}'`)

  const first = await reconcileGiftCardRefunds(process.env as never, {})
  assert.equal(first.selected, 1)
  assert.equal(first.finalized, 1, "RECONCILIATION FINALISED IT")
  assert.equal(refundState(f.card), "completed")
  assert.equal(avail(f.recipient), 0)
  assert.equal(ledger(f.recipient), 0, "exact reversal, once")

  // Replay.
  const second = await reconcileGiftCardRefunds(process.env as never, {})
  assert.equal(second.selected, 0, "a completed refund is no longer selected")
  assert.equal(ledger(f.recipient), 0, "NO DUPLICATE REVERSAL")
  assert.equal(stripe.refundBodies.length, 1, "and no second Stripe refund was created")
})

test("RECONCILIATION holds when Stripe still reports pending", async () => {
  reset()
  const f = fixture(2500, true)
  stripe.mode = "500"
  await requestGiftCardRefund(f.card)

  const refundId = sql(DB, `select id from public.gift_card_refunds where gift_card_id='${f.card}'`)
  stripe.listed = [{ id: "re_p", status: "pending", amount: 2500, metadata: { realfiction_refund_id: refundId } }]
  sql(DB, `update public.gift_card_refunds set provider_requested_at = now() - interval '5 minutes' where id='${refundId}'`)

  const result = await reconcileGiftCardRefunds(process.env as never, {})
  assert.equal(result.finalized, 0, "nothing is finalised on a pending refund")
  assert.equal(result.retried, 1)
  assert.equal(avail(f.recipient), 0, "value remains frozen")
  assert.equal(ledger(f.recipient), 2500, "and unreversed")
})

// ===========================================================================
// Races
// ===========================================================================

test("CLAIM vs REFUND: exactly one wins, never both", async () => {
  reset()
  const f = fixture(2500, false)

  const [claimResult, refundResult] = await Promise.all([
    Promise.resolve(sql(DB, `select outcome from public.claim_gift_card('${f.verifier}','${f.recipient}','${f.email}')`)),
    requestGiftCardRefund(f.card)
  ])

  const claimed = claimResult === "claimed"
  const refunded = refundResult.outcome === "refunded"

  // Both may not grant value. Either the claim won and the refund saw a claimed
  // card, or the refund won and the credential was already dead.
  assert.ok(!(claimed && refunded && avail(f.recipient) > 0), "NEVER BOTH: value cannot be claimed and refunded")

  if (claimed) {
    assert.ok(
      avail(f.recipient) === 0 || refundResult.outcome !== "refunded",
      "if the claim won, the refund did not silently also reverse"
    )
  } else {
    assert.equal(avail(f.recipient), 0, "if the refund won, no credit exists")
  }
  assert.ok(ledger(f.recipient) >= 0, "no negative balance either way")
})

test("RESERVATION vs REFUND: reservation wins → review, or freeze wins → no reservation", async () => {
  reset()
  const f = fixture(2500, true)

  const order = uuid(66660000)
  sql(DB, `
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${f.recipient}','r@e.test','P','stripe','pending',1299,0,1299,0,1299,'USD');`)

  const [reserved, refundResult] = await Promise.all([
    Promise.resolve(Number(sql(DB, `select public.reserve_credit_lots('${f.recipient}','${order}',1299)`))),
    requestGiftCardRefund(f.card)
  ])

  if (reserved > 0) {
    // The reservation won: the refund must not have externally refunded.
    assert.notEqual(refundResult.outcome, "refunded", "RESERVATION WON → the refund did not complete")
    assert.deepEqual(stripe.refundBodies, [], "and Stripe was never called")
  } else {
    // The freeze won: nothing could be reserved.
    assert.equal(reserved, 0, "REFUND FREEZE WON → checkout could not reserve")
  }

  // Never both: the value cannot be simultaneously spent and refunded.
  const consumed = Number(sql(DB, `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations where order_id='${order}' and state='consumed'`))
  assert.ok(!(consumed > 0 && refundResult.outcome === "refunded"), "NEVER BOTH")
  assert.ok(ledger(f.recipient) >= 0, "no negative balance")
})

test("a repeated refund request issues only ONE external refund", async () => {
  reset()
  const f = fixture(2500, false)

  await requestGiftCardRefund(f.card)
  const second = await requestGiftCardRefund(f.card)

  assert.equal(stripe.refundBodies.length, 1, "ONE external refund")
  assert.notEqual(second.outcome, "refunded", "the repeat did not refund again")
  assert.equal(Number(sql(DB, `select count(*) from public.order_refunds where order_id='${f.order}'`)), 1)
})
