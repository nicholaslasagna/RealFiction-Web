// Gift-origin credit spent through the REAL ordinary checkout route.
//
// Every previous pass proved this in SQL and reported the HTTP route as
// outstanding. This enters through the actual exported `POST` handler of
// app/api/store/checkout/route.ts, against a real disposable PostgreSQL built
// from the real migrations. The only things mocked are the browser session and
// Stripe's HTTP endpoint.
//
// What that buys over the SQL proof: the route's own price resolution, credit
// application, order creation, reservation ordering, and the branch between
// store-credit-only completion and Stripe session creation all execute.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { createPgSupabaseClient, rows, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_CHECKOUT_DB ?? "rf_checkout_route"
const REPO = new URL("..", import.meta.url).pathname

/** Rebuilds a disposable database from the real migration files. */
function buildDatabase() {
  execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" }
  })
}

buildDatabase()

// -- Session ------------------------------------------------------------------

const session = {
  user: null as { id: string; email: string; email_confirmed_at: string } | null
}

mock.module("server-only", { namedExports: {}, defaultExport: {} })

mock.module("@/lib/supabase/server", {
  namedExports: { getAuthenticatedUser: async () => session.user }
})

// The REAL service-role boundary, pointed at real PostgreSQL.
const queries: { kind: string; detail: unknown }[] = []
mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () =>
      createPgSupabaseClient(DB, { onQuery: (kind: string, detail: unknown) => queries.push({ kind, detail }) })
  }
})

// -- Stripe -------------------------------------------------------------------

const stripe = { requests: [] as string[], ok: true }

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (String(url).includes("api.stripe.com")) {
    stripe.requests.push(String(init?.body))
    if (!stripe.ok) {
      return { ok: false, status: 402, json: async () => ({ error: { type: "card_error", code: "declined" } }) }
    }
    return {
      ok: true,
      json: async () => ({ id: "cs_route_1", url: "https://checkout.stripe.com/x", expires_at: 2_000_000_000 })
    }
  }
  throw new Error(`unexpected network call: ${String(url)}`)
}) as never as typeof fetch

process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key_for_tests"
process.env.STRIPE_ENVIRONMENT = "test"
process.env.NEXT_PUBLIC_SITE_URL = "https://realfiction.live"
process.env.GIFT_CARD_CLAIM_PEPPER = "a".repeat(64)
process.env.GIFT_CARD_ENCRYPTION_KEY = "0".repeat(64)
process.env.GIFT_CARD_ENCRYPTION_KEY_VERSION = "1"

// THE ROUTES UNDER TEST — the real exported handlers.
const { POST: checkout } = await import("../app/api/store/checkout/route.ts")
const { POST: claim } = await import("../app/api/gift-cards/claim/route.ts")
const { computeClaimVerifier } = await import("./gift-card/crypto.ts")

// -- Fixtures -----------------------------------------------------------------

let seq = 0

function uuid(prefix: number) {
  return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`
}

/** An account with a verified email and a linked Minecraft name. */
function account(email: string) {
  const id = uuid(11110000)
  sql(
    DB,
    `insert into auth.users (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.profiles (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.minecraft_account_links
       (user_id,minecraft_username,minecraft_uuid,verification_code,status,verified_at)
     values ('${id}','Player${seq}','${uuid(22220000)}','CODE${seq}','verified',now())
     on conflict do nothing;`
  )
  session.user = { id, email, email_confirmed_at: "2026-01-01T00:00:00Z" }
  return id
}

/** Issues a card and claims it THROUGH THE REAL CLAIM ROUTE. */
async function claimGiftCard(email: string, cents: number) {
  const cardId = uuid(33330000)
  const secret = "abcdefghijklmnopqrstuvwxyz0123456789_-ABC" + String(seq).padStart(2, "0").slice(0, 2)
  const verifier = await computeClaimVerifier(secret, process.env)

  sql(
    DB,
    `insert into public.gift_cards
       (id,original_balance_cents,balance_cents,currency,purchaser_user_id,status,recipient_email,public_ref)
     values ('${cardId}',${cents},${cents},'USD',
             (select id from public.profiles limit 1),'active','${email}','RFG-${String(seq).padStart(8, "0")}');
     insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
     values ('${cardId}','${verifier}','WXYZ');`
  )

  const response = await claim(
    new Request("https://realfiction.live/api/gift-cards/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret })
    })
  )
  const body = (await response.json()) as { result?: string; balanceCents?: number }
  assert.equal(body.result, "claimed", "the claim route must grant the credit")
  return { cardId, balanceCents: body.balanceCents ?? 0 }
}

function post(body: Record<string, unknown>) {
  return checkout(
    new Request("https://realfiction.live/api/store/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  )
}

function attemptId() {
  return `3f2504e0-4f89-41d3-9a0c-${String(++seq).padStart(12, "0")}`
}

const giftAvailable = (userId: string) =>
  Number(sql(DB, `select public.gift_origin_available('${userId}')`))
const ledger = (userId: string) =>
  Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${userId}'`))
const rewardsFor = (userId: string) =>
  rows(DB, `select reward_key, status::text from public.reward_queue where user_id = '${userId}'`)
const entitlementsFor = (userId: string) =>
  rows(
    DB,
    `select entitlement_key, status::text as status,
            (expires_at > now() + interval '85 days' and expires_at < now() + interval '95 days') as three_months
     from public.entitlements where user_id = '${userId}'`
  )

function resetStripe() {
  stripe.requests = []
  stripe.ok = true
  queries.length = 0
}

// ===========================================================================
// FLOW A — store-credit-only: $25.00 - $12.99 = $12.01
// ===========================================================================

test("$25 gift credit buys realvip_3m through the REAL checkout route, leaving $12.01", async () => {
  resetStripe()
  const email = `a${seq}@e.test`
  const userId = account(email)
  await claimGiftCard(email, 2500)

  assert.equal(giftAvailable(userId), 2500, "the claim route granted $25.00 of gift-origin credit")

  const response = await post({
    provider: "stripe",
    checkoutAttemptId: attemptId(),
    applyStoreCredit: true,
    items: [{ productId: "realvip-3m", quantity: 1 }]
  })
  const body = (await response.json()) as { completed?: boolean; orderId?: string; error?: string }

  assert.equal(response.status, 200, `checkout failed: ${body.error ?? ""}`)
  assert.equal(body.completed, true, "a fully-covered order completes without Stripe")
  assert.deepEqual(stripe.requests, [], "NO Stripe request may be made")

  const orderId = body.orderId as string
  const order = rows(
    DB,
    `select status::text as status, total_cents, store_credit_applied_cents, payment_due_cents
     from public.orders where id='${orderId}'`
  )[0]

  assert.equal(order.total_cents, 1299, "the route used the DATABASE price, not a client value")
  assert.equal(order.store_credit_applied_cents, 1299)
  assert.equal(order.payment_due_cents, 0)
  assert.equal(order.status, "fulfilled")

  // THE NUMBER.
  assert.equal(giftAvailable(userId), 1201, "$25.00 - $12.99 = $12.01 of gift-origin credit remains")
  assert.equal(ledger(userId), 1201, "and the LEDGER reconciles to the same cent")

  // The reservation was allocated to the gift-origin lot, and consumed.
  const consumed = Number(
    sql(
      DB,
      `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
       where order_id='${orderId}' and state='consumed'`
    )
  )
  assert.equal(consumed, 1299, "exactly $12.99 was consumed from the gift-origin lot")

  // Ordinary product outcome, untouched by how it was paid for.
  const entitlements = entitlementsFor(userId)
  const vip = entitlements.find((e: { entitlement_key: string }) => e.entitlement_key === "product:realvip-3m")
  assert.ok(vip, "the RealVIP entitlement was granted")
  assert.equal(vip.status, "active")
  assert.equal(vip.three_months, true, "the existing three-month stacking rule applied")

  const rewards = rewardsFor(userId)
  assert.equal(rewards.length, 1, "exactly ONE RealCore reward")
  assert.equal(rewards[0].reward_key, "store.realvip-3m")
  assert.ok(
    !rewards.some((r: { reward_key: string }) => /gift/i.test(r.reward_key)),
    "NO gift-card reward"
  )
})

test("the client cannot name a price, a lot, a gift card, or a ledger entry", async () => {
  resetStripe()
  const email = `b${seq}@e.test`
  const userId = account(email)
  await claimGiftCard(email, 2500)

  const response = await post({
    provider: "stripe",
    checkoutAttemptId: attemptId(),
    applyStoreCredit: true,
    items: [{ productId: "realvip-3m", quantity: 1 }],
    // All ignored: the schema strips unknown keys and the server re-resolves.
    priceCents: 1,
    totalCents: 1,
    creditLotId: "00000000-0000-4000-8000-000000000001",
    giftCardId: "00000000-0000-4000-8000-000000000002",
    ledgerEntryId: 99,
    storeCreditCents: 9999
  })
  const body = (await response.json()) as { orderId?: string }

  assert.equal(response.status, 200)
  const order = rows(DB, `select total_cents, store_credit_applied_cents from public.orders where id='${body.orderId}'`)[0]
  assert.equal(order.total_cents, 1299, "the authoritative price won")
  assert.equal(order.store_credit_applied_cents, 1299, "the server computed the credit, not the client")
  assert.equal(giftAvailable(userId), 1201)
})

test("replaying the same checkout attempt consumes nothing further", async () => {
  resetStripe()
  const email = `c${seq}@e.test`
  const userId = account(email)
  await claimGiftCard(email, 2500)

  const attempt = attemptId()
  const cart = {
    provider: "stripe",
    checkoutAttemptId: attempt,
    applyStoreCredit: true,
    items: [{ productId: "realvip-3m", quantity: 1 }]
  }

  await post(cart)
  const after = giftAvailable(userId)
  await post(cart)
  await post(cart)

  assert.equal(giftAvailable(userId), after, "REPLAY CONSUMED NOTHING")
  assert.equal(ledger(userId), after)
  assert.equal(rewardsFor(userId).length, 1, "and queued no second reward")
})

// ===========================================================================
// FLOW B — mixed payment: $12.99 - $5.00 = $7.99 through Stripe
// ===========================================================================

test("$5 gift credit leaves exactly $7.99 for Stripe, unconsumed until paid", async () => {
  resetStripe()
  const email = `d${seq}@e.test`
  const userId = account(email)
  await claimGiftCard(email, 500)

  const response = await post({
    provider: "stripe",
    checkoutAttemptId: attemptId(),
    applyStoreCredit: true,
    items: [{ productId: "realvip-3m", quantity: 1 }]
  })
  const body = (await response.json()) as { checkoutUrl?: string; orderId?: string; error?: string }

  assert.equal(response.status, 200, `checkout failed: ${body.error ?? ""}`)
  assert.equal(body.checkoutUrl, "https://checkout.stripe.com/x")
  assert.equal(stripe.requests.length, 1, "one Stripe session")

  // THE NUMBER.
  const encoded = stripe.requests[0]
  assert.match(encoded, /unit_amount%5D=799/, "STRIPE IS ASKED FOR EXACTLY $7.99")
  assert.ok(!encoded.includes("=1299"), "never the full $12.99")

  const orderId = body.orderId as string
  const order = rows(
    DB,
    `select payment_due_cents, store_credit_applied_cents, status::text as status
     from public.orders where id='${orderId}'`
  )[0]
  assert.equal(order.payment_due_cents, 799)
  assert.equal(order.store_credit_applied_cents, 500)
  assert.equal(order.status, "pending")

  // Reserved, NOT consumed: nothing has been paid yet.
  assert.equal(giftAvailable(userId), 0, "the $5.00 is held")
  const consumedBefore = Number(
    sql(
      DB,
      `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
       where order_id='${orderId}' and state='consumed'`
    )
  )
  assert.equal(consumedBefore, 0, "CREDIT IS NOT CONSUMED BEFORE VERIFIED PAYMENT")

  // The verified-payment fulfilment the webhook performs.
  sql(DB, `select public.fulfill_paid_order_with_outbox('${orderId}','pi_route','ch_route',null)`)

  const consumedAfter = Number(
    sql(
      DB,
      `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
       where order_id='${orderId}' and state='consumed'`
    )
  )
  assert.equal(consumedAfter, 500, "verified payment consumes the $5.00 exactly once")
  assert.equal(giftAvailable(userId), 0, "gift-origin value is now $0.00")

  const rewards = rewardsFor(userId)
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].reward_key, "store.realvip-3m")

  // Replay.
  sql(DB, `select public.fulfill_paid_order_with_outbox('${orderId}','pi_route','ch_route',null)`)
  assert.equal(
    Number(
      sql(
        DB,
        `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
         where order_id='${orderId}' and state='consumed'`
      )
    ),
    500,
    "a replayed fulfilment consumes nothing additional"
  )
  assert.equal(rewardsFor(userId).length, 1, "and creates no duplicate reward")
})

test("a Stripe session failure releases exactly the $5 reservation", async () => {
  resetStripe()
  stripe.ok = false
  const email = `e${seq}@e.test`
  const userId = account(email)
  await claimGiftCard(email, 500)

  const response = await post({
    provider: "stripe",
    checkoutAttemptId: attemptId(),
    applyStoreCredit: true,
    items: [{ productId: "realvip-3m", quantity: 1 }]
  })

  assert.ok(response.status >= 400, "the checkout must fail")
  assert.equal(giftAvailable(userId), 500, "THE $5.00 CAME BACK to its lot")
  assert.equal(ledger(userId), 500, "and the ledger agrees")
})
