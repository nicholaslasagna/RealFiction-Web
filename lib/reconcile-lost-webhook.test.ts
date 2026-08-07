// THE FAILURE THIS RECOVERS, executed three ways.
//
// Stripe collects the money. The success webhook never arrives — not delayed,
// lost. The order sits pending, the customer is charged, and nothing is
// delivered. Reconciliation must finish the job, exactly once, and a webhook
// that finally shows up afterwards must change nothing.
//
// Every layer here is real: the checkout routes, the signed webhook handler,
// the shared fulfilment dispatch, and a disposable PostgreSQL built from the
// real migrations. Only Stripe's HTTP endpoint and the email transport are
// mocked. The test never calls a fulfilment, issuance, or credit RPC itself.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { isStripeRequest, isResendRequest } = await import("../tests/support/request-host.ts")

const { createPgSupabaseClient, rows, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_RECONCILE_DB ?? "rf_reconcile_lost"
const REPO = new URL("..", import.meta.url).pathname

execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})
sql(DB, `update public.products set active = true where slug in ('gift-card-25','gift-card-5')`)

const session = { user: null as { id: string; email: string; email_confirmed_at: string } | null }
const stripe = { requests: [] as string[], counter: 0, lastSessionId: "", session: null as unknown }

mock.module("server-only", { namedExports: {}, defaultExport: {} })
mock.module("@/lib/supabase/server", { namedExports: { getAuthenticatedUser: async () => session.user } })
mock.module("@/lib/supabase/service-role", {
  namedExports: { getSupabaseServiceRoleClient: () => createPgSupabaseClient(DB) }
})
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => createPgSupabaseClient(DB) } })

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const target = String(url)
  if (target.includes("/v1/checkout/sessions/")) {
    // RETRIEVAL: what reconciliation pulls.
    return { ok: true, status: 200, json: async () => stripe.session } as never
  }
  if (isStripeRequest(target)) {
    stripe.requests.push(String(init?.body))
    stripe.lastSessionId = `cs_rec_${++stripe.counter}`
    return {
      ok: true,
      json: async () => ({ id: stripe.lastSessionId, url: "https://checkout.stripe.com/x", expires_at: 2_000_000_000 })
    } as never
  }
  if (isResendRequest(target)) {
    return { ok: true, status: 200, json: async () => ({ id: "m1" }), text: async () => "{}" } as never
  }
  throw new Error(`unexpected network call: ${target}`)
}) as never as typeof fetch

Object.assign(process.env, {
  // Gift-card paths refuse outright without this: the abuse controls are
  // mandatory, not best-effort. A test-only value, never a secret.
  ABUSE_SUBJECT_PEPPER: "test-pepper-not-a-secret",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-not-a-real-key",
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key_for_tests",
  STRIPE_ENVIRONMENT: "live",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret_for_signing_only",
  NEXT_PUBLIC_SITE_URL: "https://realfiction.live",
  STORE_GIFT_CARDS_ENABLED: "true",
  GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
  GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY: "0".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1",
  RESEND_API_KEY: "not-a-real-key",
  EMAIL_FROM: "test@example.invalid"
})

const { POST: storeCheckout } = await import("../app/api/store/checkout/route.ts")
const { POST: giftCheckout } = await import("../app/api/store/gift-cards/checkout/route.ts")
const { POST: stripeWebhook } = await import("../app/api/webhooks/stripe/route.ts")
const { reconcilePendingStripeOrders } = await import("./store/reconcile-pending.ts")
const { fulfilVerifiedPayment } = await import("./store/fulfil-verified-payment.ts")

const RECONCILE_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_ENVIRONMENT: "live"
}

/** Runs reconciliation exactly as the Worker does, through the shared dispatch. */
const reconcile = () =>
  reconcilePendingStripeOrders(RECONCILE_ENV, {
    fulfil: (orderId, facts) => fulfilVerifiedPayment(orderId, facts, process.env as never)
  })

let seq = 0
const uuid = (p: number) => `${String(p).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`
const attemptId = () => `3f2504e0-4f89-41d3-9a0c-${String(++seq).padStart(12, "0")}`

function account(email: string) {
  const id = uuid(66660000)
  sql(
    DB,
    `insert into auth.users (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.profiles (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.minecraft_account_links
       (user_id,minecraft_username,minecraft_uuid,verification_code,status,verified_at)
     values ('${id}','P${seq}','${uuid(55550000)}','C${seq}','verified',now()) on conflict do nothing;`
  )
  session.user = { id, email, email_confirmed_at: "2026-01-01T00:00:00Z" }
  return id
}

const request = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

async function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  const ts = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.STRIPE_WEBHOOK_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`))
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return new Request("https://realfiction.live/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${hex}` },
    body: payload
  })
}

/** Makes the order old enough to be selected, without touching any other state. */
const age = (orderId: string) =>
  sql(DB, `update public.orders set created_at = now() - interval '10 minutes' where id='${orderId}'`)

const paidSession = (id: string, orderId: string, cents: number) => ({
  id,
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  amount_total: cents,
  livemode: true,
  metadata: { order_id: orderId },
  payment_intent: { id: `pi_${orderId.slice(0, 8)}`, status: "succeeded", latest_charge: "ch_x" }
})

const status = (orderId: string) => sql(DB, `select status from public.orders where id='${orderId}'`)
const rewardsFor = (userId: string) =>
  rows(DB, `select reward_key from public.reward_queue where user_id='${userId}'`) as { reward_key: string }[]
const entitlements = (userId: string) =>
  rows(
    DB,
    `select entitlement_key,
            (expires_at > now() + interval '85 days' and expires_at < now() + interval '95 days') as three_months
     from public.entitlements where user_id='${userId}' and status='active'`
  ) as { entitlement_key: string; three_months: boolean }[]
const giftAvailable = (u: string) => Number(sql(DB, `select public.gift_origin_available('${u}')`))

// ===========================================================================
// 1. ORDINARY PRODUCT
// ===========================================================================

test("ORDINARY: Stripe paid, webhook lost, reconciliation fulfils exactly once", async () => {
  stripe.requests.length = 0
  const userId = account(`ord${seq}@e.test`)

  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: false,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const body = (await response.json()) as { orderId?: string; error?: string }
  assert.equal(response.status, 200, `checkout failed: ${body.error ?? ""}`)
  const orderId = body.orderId as string
  const sessionId = stripe.lastSessionId

  assert.match(stripe.requests[0], /unit_amount%5D=1299/, "Stripe was asked for $12.99")
  assert.equal(status(orderId), "pending", "THE WEBHOOK NEVER ARRIVES — the order sits pending")
  assert.deepEqual(entitlements(userId), [], "no entitlement")
  assert.deepEqual(rewardsFor(userId), [], "no reward")

  // Stripe HAS the money. Reconciliation finds out.
  stripe.session = paidSession(sessionId, orderId, 1299)
  age(orderId)

  const result = await reconcile()
  assert.equal(result.selected, 1)
  assert.equal(result.fulfilled, 1, "RECONCILIATION ITSELF FULFILLED THE ORDER")

  assert.equal(status(orderId), "fulfilled")
  const granted = entitlements(userId)
  assert.equal(granted.length, 1, "exactly one entitlement change")
  assert.equal(granted[0].entitlement_key, "product:realvip-3m")
  assert.equal(granted[0].three_months, true, "existing three-month stacking, unchanged")

  const rewards = rewardsFor(userId)
  assert.equal(rewards.length, 1, "exactly one RealVIP reward")
  assert.equal(rewards[0].reward_key, "store.realvip-3m")

  const emailCount = Number(sql(DB, `select count(*) from public.email_deliveries where order_id='${orderId}'`))
  assert.equal(emailCount, 1, "exactly one confirmation email")

  // The late webhook.
  await stripeWebhook(
    await signed({
      id: `evt_late_${seq}`,
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { id: sessionId, metadata: { order_id: orderId }, payment_status: "paid", payment_intent: "pi_late", amount_total: 1299, currency: "usd" } }
    })
  )

  assert.equal(entitlements(userId).length, 1, "the late webhook granted nothing extra")
  assert.equal(rewardsFor(userId).length, 1, "and queued no second reward")
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where order_id='${orderId}'`)),
    1,
    "and queued no duplicate email"
  )
})

// ===========================================================================
// 2. MIXED PAYMENT
// ===========================================================================

test("MIXED: $5 credit held, $7.99 paid, webhook lost, reconciliation consumes $5 once", async () => {
  stripe.requests.length = 0
  const userId = account(`mix${seq}@e.test`)

  // Fund the account with gift-origin credit through the real claim path is
  // covered elsewhere; here a direct grant keeps this test about reconciliation.
  const cardId = uuid(44440000)
  sql(
    DB,
    `insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,status,public_ref)
     values ('${cardId}',500,500,'USD','${userId}','redeemed','RFG-${String(seq).padStart(8, "0")}');
     insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
     values ('${userId}',500,'gift_card_redemption','${cardId}','gift_card_claim:${cardId}','seed');
     insert into public.store_credit_lots (user_id,source,gift_card_id,original_cents,remaining_cents,currency)
     values ('${userId}','gift_card','${cardId}',500,500,'USD');`
  )
  assert.equal(giftAvailable(userId), 500)

  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: true,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const body = (await response.json()) as { orderId?: string; error?: string }
  assert.equal(response.status, 200, `checkout failed: ${body.error ?? ""}`)
  const orderId = body.orderId as string
  const sessionId = stripe.lastSessionId

  assert.match(stripe.requests[0], /unit_amount%5D=799/, "STRIPE WAS ASKED FOR EXACTLY $7.99")
  assert.ok(!stripe.requests[0].includes("=1299"))

  const consumed = () =>
    Number(
      sql(
        DB,
        `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
         where order_id='${orderId}' and state='consumed'`
      )
    )

  assert.equal(status(orderId), "pending", "webhook lost")
  assert.equal(consumed(), 0, "CREDIT IS RESERVED BUT UNCONSUMED")
  assert.equal(giftAvailable(userId), 0, "and held out of the balance")

  stripe.session = paidSession(sessionId, orderId, 799)
  age(orderId)

  const result = await reconcile()
  assert.equal(result.fulfilled, 1)
  assert.equal(consumed(), 500, "reconciliation consumed exactly $5.00, once")
  assert.equal(status(orderId), "fulfilled")

  const rewards = rewardsFor(userId)
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].reward_key, "store.realvip-3m")

  // The late webhook.
  await stripeWebhook(
    await signed({
      id: `evt_mixlate_${seq}`,
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { id: sessionId, metadata: { order_id: orderId }, payment_status: "paid", payment_intent: "pi_mixlate", amount_total: 799, currency: "usd" } }
    })
  )
  assert.equal(consumed(), 500, "the late webhook consumed nothing additional")
  assert.equal(rewardsFor(userId).length, 1)
})

// ===========================================================================
// 3. GIFT CARD
// ===========================================================================

test("GIFT CARD: $25 paid, webhook lost, reconciliation issues exactly one card", async () => {
  stripe.requests.length = 0
  const buyerEmail = `gbuy${seq}@e.test`
  const buyerId = account(buyerEmail)
  const recipientEmail = `grec${seq}@e.test`

  const response = await giftCheckout(
    request("https://realfiction.live/api/store/gift-cards/checkout", {
      slug: "gift-card-25",
      recipientEmail,
      senderName: "Nicholas",
      message: "Enjoy",
      sendToSelf: false,
      checkoutAttemptId: attemptId()
    })
  )
  const body = (await response.json()) as { orderId?: string; error?: string }
  assert.equal(response.status, 200, `gift checkout failed: ${body.error ?? ""}`)
  const orderId = body.orderId as string
  const sessionId = stripe.lastSessionId

  assert.match(stripe.requests[0], /unit_amount%5D=2500/)
  assert.equal(status(orderId), "pending", "webhook lost")
  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_cards where purchaser_order_id='${orderId}'`)),
    0,
    "no card before verified payment"
  )

  stripe.session = paidSession(sessionId, orderId, 2500)
  age(orderId)

  const result = await reconcile()
  assert.equal(result.fulfilled, 1, "RECONCILIATION ISSUED THE CARD")

  const cards = rows(DB, `select id from public.gift_cards where purchaser_order_id='${orderId}'`)
  assert.equal(cards.length, 1, "exactly one gift card")
  const cardId = cards[0].id as string

  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_card_claim_credentials where gift_card_id='${cardId}' and state='active'`)),
    1,
    "exactly one active credential"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where idempotency_key like '%${cardId}%'`)),
    2,
    "purchaser and recipient emails queued once"
  )
  assert.equal(status(orderId), "fulfilled")
  assert.equal(
    Number(sql(DB, `select count(*) from public.reward_queue where reward_key ilike '%gift%'`)),
    0,
    "NO RealCore reward for a gift card"
  )
  assert.deepEqual(rewardsFor(buyerId), [], "and none for the buyer")

  // The late webhook.
  await stripeWebhook(
    await signed({
      id: `evt_giftlate_${seq}`,
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { id: sessionId, metadata: { order_id: orderId }, payment_status: "paid", payment_intent: "pi_giftlate", amount_total: 2500, currency: "usd" } }
    })
  )

  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_cards where purchaser_order_id='${orderId}'`)),
    1,
    "the late webhook issued no second card"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where idempotency_key like '%${cardId}%'`)),
    2,
    "and queued no duplicate emails"
  )
})

// ===========================================================================
// 4. PROVIDER-PROVEN UNPAID EXPIRY
// ===========================================================================

test("EXPIRED UNPAID: the exact reservation is released, once, and nothing is granted", async () => {
  stripe.requests.length = 0
  const userId = account(`exp${seq}@e.test`)

  const cardId = uuid(33330000)
  sql(
    DB,
    `insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,status,public_ref)
     values ('${cardId}',500,500,'USD','${userId}','redeemed','RFG-E${String(seq).padStart(7, "0")}');
     insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
     values ('${userId}',500,'gift_card_redemption','${cardId}','gift_card_claim:${cardId}','seed');
     insert into public.store_credit_lots (user_id,source,gift_card_id,original_cents,remaining_cents,currency)
     values ('${userId}','gift_card','${cardId}',500,500,'USD');`
  )

  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: true,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const orderId = ((await response.json()) as { orderId: string }).orderId
  const sessionId = stripe.lastSessionId

  assert.equal(giftAvailable(userId), 0, "the $5.00 is held")

  // Stripe PROVES it expired unpaid.
  stripe.session = {
    id: sessionId,
    status: "expired",
    payment_status: "unpaid",
    currency: "usd",
    amount_total: 799,
    livemode: true,
    metadata: { order_id: orderId }
  }
  age(orderId)

  const result = await reconcile()
  assert.equal(result.cancelled, 1)
  assert.equal(result.fulfilled, 0)

  assert.equal(status(orderId), "cancelled")
  assert.equal(giftAvailable(userId), 500, "THE $5.00 CAME BACK to its lot")
  assert.deepEqual(entitlements(userId), [], "no entitlement")
  assert.deepEqual(rewardsFor(userId), [], "no reward")
  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_cards where purchaser_order_id='${orderId}'`)),
    0,
    "no gift card"
  )

  // Reconciling again releases nothing further.
  const second = await reconcile()
  assert.equal(second.selected, 0, "a cancelled order is no longer selected")
  assert.equal(giftAvailable(userId), 500, "NO SECOND RELEASE")
})

// ===========================================================================
// 5. MISMATCH PRESERVES EVERYTHING
// ===========================================================================

test("MISMATCH: nothing fulfilled, nothing released, order held for review", async () => {
  stripe.requests.length = 0
  const userId = account(`mis${seq}@e.test`)

  const cardId = uuid(22220000)
  sql(
    DB,
    `insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,status,public_ref)
     values ('${cardId}',500,500,'USD','${userId}','redeemed','RFG-M${String(seq).padStart(7, "0")}');
     insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
     values ('${userId}',500,'gift_card_redemption','${cardId}','gift_card_claim:${cardId}','seed');
     insert into public.store_credit_lots (user_id,source,gift_card_id,original_cents,remaining_cents,currency)
     values ('${userId}','gift_card','${cardId}',500,500,'USD');`
  )

  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: true,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const orderId = ((await response.json()) as { orderId: string }).orderId
  const sessionId = stripe.lastSessionId

  // Stripe reports a DIFFERENT amount than the order expects.
  stripe.session = { ...paidSession(sessionId, orderId, 100) }
  age(orderId)

  const result = await reconcile()
  assert.equal(result.review, 1)
  assert.equal(result.fulfilled, 0)
  assert.equal(result.cancelled, 0)

  assert.equal(status(orderId), "pending", "the order is NOT cancelled")
  assert.equal(giftAvailable(userId), 0, "THE RESERVATION IS PRESERVED")
  assert.deepEqual(entitlements(userId), [], "nothing granted")
  assert.equal(
    sql(DB, `select reconciliation_review_required from public.orders where id='${orderId}'`),
    "t",
    "a human owns it now"
  )

  // And it stops being retried automatically.
  const second = await reconcile()
  assert.equal(second.selected, 0, "review orders are not re-selected")
})

// ===========================================================================
// 6. CONCURRENCY AND LEASE RECOVERY
// ===========================================================================

test("two Workers cannot claim the same order, and a crashed lease recovers", async () => {
  const userId = account(`cc${seq}@e.test`)
  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: false,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const orderId = ((await response.json()) as { orderId: string }).orderId
  age(orderId)

  const first = rows(DB, `select * from public.claim_pending_reconciliations('worker-a', 10, 120, 120)`)
  assert.ok(
    first.some((r: { order_id: string }) => r.order_id === orderId),
    "worker A claims it"
  )

  const second = rows(DB, `select * from public.claim_pending_reconciliations('worker-b', 10, 120, 120)`)
  assert.ok(
    !second.some((r: { order_id: string }) => r.order_id === orderId),
    "worker B is refused while the lease is live"
  )

  assert.equal(status(orderId), "pending", "a claim alone changes nothing about the order")
  assert.deepEqual(entitlements(userId), [], "and grants nothing")

  // Worker A crashes: the lease lapses, nothing was released by crashing.
  sql(DB, `update public.orders set reconciliation_lease_until = now() - interval '1 second' where id='${orderId}'`)
  const third = rows(DB, `select * from public.claim_pending_reconciliations('worker-b', 10, 120, 120)`)
  assert.ok(
    third.some((r: { order_id: string }) => r.order_id === orderId),
    "after the lease expires the row is claimable again"
  )
  assert.equal(status(orderId), "pending", "AND A CRASHED WORKER RELEASED NOTHING")
})

test("backoff is scheduled, and an exhausted order goes to review rather than release", async () => {
  const userId = account(`bo${seq}@e.test`)
  const response = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: false,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const orderId = ((await response.json()) as { orderId: string }).orderId
  age(orderId)

  sql(DB, `select * from public.claim_pending_reconciliations('worker-a', 10, 120, 120)`)
  const retry = rows(
    DB,
    `select * from public.finish_pending_reconciliation('${orderId}','retry','provider_unavailable',null,null,10)`
  )[0] as { disposition: string; review: boolean }
  assert.equal(retry.disposition, "retry")
  assert.ok(
    Number(sql(DB, `select count(*) from public.orders where id='${orderId}' and reconciliation_next_at > now()`)) === 1,
    "backoff is scheduled"
  )

  // Exhaust the attempt ceiling.
  sql(DB, `update public.orders set reconciliation_attempts = 10, reconciliation_next_at = null where id='${orderId}'`)
  const exhausted = rows(
    DB,
    `select * from public.finish_pending_reconciliation('${orderId}','retry','provider_unavailable',null,null,10)`
  )[0] as { disposition: string; review: boolean }

  assert.equal(exhausted.disposition, "review")
  assert.equal(exhausted.review, true)
  assert.equal(status(orderId), "pending", "NEVER released on exhaustion")
  assert.deepEqual(entitlements(userId), [])
})
