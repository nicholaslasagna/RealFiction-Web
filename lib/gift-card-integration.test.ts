// The complete customer journey, across every real application layer.
//
// Each layer has been proven on its own: checkout route, signed webhook,
// issuance, email processor, claim route, ordinary checkout. What none of those
// proved is that they FIT — that the outbox row the webhook writes is one the
// processor can render, that the secret the processor puts in an email is one
// the claim route accepts, that the credit the claim grants is one ordinary
// checkout can spend.
//
// So this test never calls a financial RPC. It enters through HTTP handlers and
// the queue processor, reads what a customer would read, and checks the money.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { createPgSupabaseClient, rows, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_INTEGRATION_DB ?? "rf_gift_integration"
const REPO = new URL("..", import.meta.url).pathname

execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})

// Gift cards are inactive by default. This disposable database enables ONLY the
// $25 and $5 denominations, exactly as the reviewed enablement runbook would.
sql(DB, `update public.products set active = true where slug in ('gift-card-25','gift-card-5')`)

// ---------------------------------------------------------------------------
// Wiring: one real database, mocked session and outbound HTTP.
// ---------------------------------------------------------------------------

const session = { user: null as { id: string; email: string; email_confirmed_at: string } | null }

mock.module("server-only", { namedExports: {}, defaultExport: {} })
mock.module("@/lib/supabase/server", {
  namedExports: { getAuthenticatedUser: async () => session.user }
})
mock.module("@/lib/supabase/service-role", {
  namedExports: { getSupabaseServiceRoleClient: () => createPgSupabaseClient(DB) }
})
// The email processor builds its own client from explicit env.
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => createPgSupabaseClient(DB) }
})

const stripe = { requests: [] as string[], counter: 0, lastSessionId: "" }
const emails: { to: string; subject: string; text: string; html: string }[] = []
const logLines: string[] = []

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const target = String(url)
  if (target.includes("api.stripe.com")) {
    stripe.requests.push(String(init?.body))
    // A UNIQUE session id per call. Stripe never reuses one, and
    // `checkout_attempts_session_idx` is unique — returning a constant made the
    // second checkout in the file collide.
    stripe.lastSessionId = `cs_int_${++stripe.counter}`
    return {
      ok: true,
      json: async () => ({ id: stripe.lastSessionId, url: "https://checkout.stripe.com/x", expires_at: 2_000_000_000 })
    }
  }
  if (target.includes("api.resend.com")) {
    const body = JSON.parse(String(init?.body)) as { to: string[] | string; subject: string; text: string; html: string }
    emails.push({
      to: Array.isArray(body.to) ? body.to[0] : body.to,
      subject: body.subject,
      text: body.text,
      html: body.html
    })
    return { ok: true, status: 200, json: async () => ({ id: "resend-1" }), text: async () => "{}" }
  }
  throw new Error(`unexpected network call: ${target}`)
}) as never as typeof fetch

for (const level of ["info", "warn", "error"] as const) {
  const original = console[level]
  console[level] = (...args: unknown[]) => {
    logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    void original
  }
}

/** Test-only key material and gate values. Never real keys. */
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
  RESEND_API_KEY: "resend-not-a-real-key",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>"
})

// THE REAL HANDLERS.
const { POST: giftCheckout } = await import("../app/api/store/gift-cards/checkout/route.ts")
const { POST: stripeWebhook } = await import("../app/api/webhooks/stripe/route.ts")
const { POST: claimRoute } = await import("../app/api/gift-cards/claim/route.ts")
const { POST: storeCheckout } = await import("../app/api/store/checkout/route.ts")
const { processEmailQueue } = await import("./email/processor.ts")

// ---------------------------------------------------------------------------

let seq = 0
const uuid = (prefix: number) => `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`
const attemptId = () => `3f2504e0-4f89-41d3-9a0c-${String(++seq).padStart(12, "0")}`

function account(email: string) {
  const id = uuid(77770000)
  sql(
    DB,
    `insert into auth.users (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.profiles (id,email) values ('${id}','${email}') on conflict do nothing;
     insert into public.minecraft_account_links
       (user_id,minecraft_username,minecraft_uuid,verification_code,status,verified_at)
     values ('${id}','Player${seq}','${uuid(88880000)}','C${seq}','verified',now()) on conflict do nothing;`
  )
  return id
}

function request(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
}

/** Signs an event exactly as Stripe does. Authentication is not bypassed. */
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

const giftAvailable = (u: string) => Number(sql(DB, `select public.gift_origin_available('${u}')`))
const ledger = (u: string) =>
  Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${u}'`))
const rewardsFor = (u: string) =>
  rows(DB, `select reward_key from public.reward_queue where user_id='${u}'`) as { reward_key: string }[]

// ===========================================================================
// THE COMPLETE $25 PATH
// ===========================================================================

test("gift-card checkout → webhook → issuance → email → claim → store purchase", async () => {
  stripe.requests.length = 0
  emails.length = 0
  logLines.length = 0

  const buyerEmail = `buyer${seq}@e.test`
  const recipientEmail = `friend${seq}@e.test`
  const buyerId = account(buyerEmail)
  const recipientId = account(recipientEmail)

  // ---- 1. Gift-card checkout, through the real route --------------------
  session.user = { id: buyerId, email: buyerEmail, email_confirmed_at: "2026-01-01T00:00:00Z" }

  const checkoutResponse = await giftCheckout(
    request("https://realfiction.live/api/store/gift-cards/checkout", {
      slug: "gift-card-25",
      recipientEmail,
      senderName: "Nicholas",
      message: "Happy birthday!",
      sendToSelf: false,
      checkoutAttemptId: attemptId()
    })
  )
  const checkoutBody = (await checkoutResponse.json()) as { orderId?: string; error?: string }
  assert.equal(checkoutResponse.status, 200, `gift checkout failed: ${checkoutBody.error ?? ""}`)

  const giftOrderId = checkoutBody.orderId as string
  assert.equal(stripe.requests.length, 1)
  assert.match(stripe.requests[0], /unit_amount%5D=2500/, "the server resolved $25.00 authoritatively")
  assert.match(stripe.requests[0], /payment_method_types%5B0%5D=card/, "card-only for stored value")
  assert.ok(!stripe.requests[0].includes("allow_promotion_codes"))
  // The personal message stays in OUR order, not Stripe.
  assert.ok(!decodeURIComponent(stripe.requests[0]).includes("Happy birthday"))

  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_cards where purchaser_order_id='${giftOrderId}'`)),
    0,
    "NO card exists before verified payment"
  )

  // ---- 2. Signed paid webhook, through the real handler ------------------
  const giftSessionId = stripe.lastSessionId

  const unsigned = await stripeWebhook(
    request("https://realfiction.live/api/webhooks/stripe", { id: "evt_bad", type: "checkout.session.completed" })
  )
  assert.equal(unsigned.status, 401, "an unsigned webhook is refused")

  const paidEvent = {
    id: `evt_int_${seq}`,
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: giftSessionId,
        metadata: { order_id: giftOrderId },
        payment_status: "paid",
        payment_intent: "pi_integration",
        amount_total: 2500,
        currency: "usd"
      }
    }
  }
  const webhookResponse = await stripeWebhook(await signed(paidEvent))
  assert.equal(webhookResponse.status, 200)

  const cards = rows(DB, `select id, status::text as status from public.gift_cards where purchaser_order_id='${giftOrderId}'`)
  assert.equal(cards.length, 1, "EXACTLY ONE gift card was issued")
  const cardId = cards[0].id as string

  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_card_claim_credentials where gift_card_id='${cardId}' and state='active'`)),
    1,
    "exactly one active credential"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where idempotency_key like '%${cardId}%'`)),
    2,
    "exactly two initial emails"
  )
  assert.equal(
    sql(DB, `select status::text from public.orders where id='${giftOrderId}'`),
    "fulfilled"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.reward_queue where reward_key ilike '%gift%'`)),
    0,
    "NO RealCore reward for a gift card"
  )

  // Replay.
  await stripeWebhook(await signed(paidEvent))
  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_cards where purchaser_order_id='${giftOrderId}'`)),
    1,
    "a replayed webhook issues no second card"
  )

  // ---- 3. The real email processor ---------------------------------------
  const processed = await processEmailQueue(process.env as never, {})
  assert.ok(processed.sent >= 2, `the processor sent both emails (sent=${processed.sent})`)

  const purchaserEmail = emails.find((e) => e.to === buyerEmail)
  const deliveryEmail = emails.find((e) => e.to === recipientEmail)
  assert.ok(purchaserEmail, "the purchaser was emailed")
  assert.ok(deliveryEmail, "the recipient was emailed")

  // The secret a recipient would actually read, from the rendered email.
  const match = deliveryEmail.text.match(/\/gift-cards\/claim#([A-Za-z0-9_-]{43})/)
  assert.ok(match, "the delivery email carries exactly one fragment claim URL")
  const secret = match[1]

  assert.ok(!purchaserEmail.text.includes(secret), "the PURCHASER email carries no claim secret")
  assert.ok(!deliveryEmail.text.includes("claim?"), "no query-string secret")
  assert.ok(!logLines.join("\n").includes(secret), "no log line carries the secret")
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where params::text like '%${secret}%'`)),
    0,
    "the decrypted secret is never written back to the outbox"
  )

  // ---- 4. The real claim route -------------------------------------------
  session.user = { id: recipientId, email: recipientEmail, email_confirmed_at: "2026-01-01T00:00:00Z" }

  const claimResponse = await claimRoute(request("https://realfiction.live/api/gift-cards/claim", { secret }))
  const claimBody = (await claimResponse.json()) as { result?: string; amountCents?: number; balanceCents?: number }

  assert.equal(claimBody.result, "claimed")
  assert.equal(claimBody.amountCents, 2500)
  assert.equal(giftAvailable(recipientId), 2500, "$25.00 of gift-origin credit was granted")
  assert.equal(
    sql(DB, `select state from public.gift_card_claim_credentials where gift_card_id='${cardId}'`),
    "consumed"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.store_credit_lots where gift_card_id='${cardId}'`)),
    1,
    "exactly one gift-origin lot"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.email_deliveries where idempotency_key='gift_card_claimed:${cardId}'`)),
    1,
    "the claim confirmation was written atomically"
  )

  // Replay grants nothing extra.
  await claimRoute(request("https://realfiction.live/api/gift-cards/claim", { secret }))
  assert.equal(giftAvailable(recipientId), 2500, "a replayed claim grants no additional value")

  // ---- 5. The real ordinary checkout route -------------------------------
  stripe.requests.length = 0

  const storeResponse = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: true,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const storeBody = (await storeResponse.json()) as { completed?: boolean; orderId?: string; error?: string }
  assert.equal(storeResponse.status, 200, `store checkout failed: ${storeBody.error ?? ""}`)
  assert.equal(storeBody.completed, true)
  assert.deepEqual(stripe.requests, [], "NO Stripe request for a fully-covered order")

  const order = rows(
    DB,
    `select total_cents, store_credit_applied_cents, status::text as status
     from public.orders where id='${storeBody.orderId}'`
  )[0] as { total_cents: number; store_credit_applied_cents: number; status: string }

  assert.equal(order.total_cents, 1299, "the route resolved $12.99 from the database")
  assert.equal(order.store_credit_applied_cents, 1299)
  assert.equal(order.status, "fulfilled")

  // THE NUMBER.
  assert.equal(giftAvailable(recipientId), 1201, "$25.00 - $12.99 = $12.01")
  assert.equal(ledger(recipientId), 1201, "and the ledger reconciles to the same cent")

  const entitlement = rows(
    DB,
    `select status::text as status,
            (expires_at > now() + interval '85 days' and expires_at < now() + interval '95 days') as three_months
     from public.entitlements
     where user_id='${recipientId}' and entitlement_key='product:realvip-3m'`
  )[0] as { status: string; three_months: boolean }
  assert.equal(entitlement.status, "active")
  assert.equal(entitlement.three_months, true, "existing three-month stacking, unchanged")

  const rewards = rewardsFor(recipientId)
  assert.equal(rewards.length, 1, "exactly one RealCore reward")
  assert.equal(rewards[0].reward_key, "store.realvip-3m")
  assert.equal(
    Number(sql(DB, `select count(*) from public.reward_queue where reward_key ilike '%gift%'`)),
    0,
    "ZERO gift-card rewards anywhere in the entire flow"
  )
})

// ===========================================================================
// THE COMPLETE MIXED PATH
// ===========================================================================

test("$5 gift credit + $7.99 Stripe, consumed only after a signed paid webhook", async () => {
  stripe.requests.length = 0
  emails.length = 0

  const buyerEmail = `mbuyer${seq}@e.test`
  const recipientEmail = `mfriend${seq}@e.test`
  const buyerId = account(buyerEmail)
  const recipientId = account(recipientEmail)

  // Buy and pay for a $5 card.
  session.user = { id: buyerId, email: buyerEmail, email_confirmed_at: "2026-01-01T00:00:00Z" }
  const bought = await giftCheckout(
    request("https://realfiction.live/api/store/gift-cards/checkout", {
      slug: "gift-card-5",
      recipientEmail,
      senderName: "N",
      message: "",
      sendToSelf: false,
      checkoutAttemptId: attemptId()
    })
  )
  const giftOrderId = ((await bought.json()) as { orderId: string }).orderId
  const mixedSessionId = stripe.lastSessionId

  await stripeWebhook(
    await signed({
      id: `evt_mix_${seq}`,
      type: "checkout.session.completed",
      livemode: true,
      data: {
        object: {
          id: mixedSessionId,
          metadata: { order_id: giftOrderId },
          payment_status: "paid",
          payment_intent: "pi_mixed",
          amount_total: 500,
          currency: "usd"
        }
      }
    })
  )

  await processEmailQueue(process.env as never, {})
  const delivery = emails.find((e) => e.to === recipientEmail)
  const secret = delivery!.text.match(/\/gift-cards\/claim#([A-Za-z0-9_-]{43})/)![1]

  session.user = { id: recipientId, email: recipientEmail, email_confirmed_at: "2026-01-01T00:00:00Z" }
  await claimRoute(request("https://realfiction.live/api/gift-cards/claim", { secret }))
  assert.equal(giftAvailable(recipientId), 500)

  // Ordinary checkout: $12.99 total, $5.00 credit, $7.99 to Stripe.
  stripe.requests.length = 0
  const storeResponse = await storeCheckout(
    request("https://realfiction.live/api/store/checkout", {
      provider: "stripe",
      checkoutAttemptId: attemptId(),
      applyStoreCredit: true,
      items: [{ productId: "realvip-3m", quantity: 1 }]
    })
  )
  const storeBody = (await storeResponse.json()) as { orderId?: string; checkoutUrl?: string; error?: string }
  assert.equal(storeResponse.status, 200, `store checkout failed: ${storeBody.error ?? ""}`)
  const orderId = storeBody.orderId as string

  assert.equal(stripe.requests.length, 1)
  assert.match(stripe.requests[0], /unit_amount%5D=799/, "STRIPE IS ASKED FOR EXACTLY $7.99")
  assert.ok(!stripe.requests[0].includes("=1299"), "never the full $12.99")

  assert.equal(
    Number(
      sql(
        DB,
        `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
         where order_id='${orderId}' and state='consumed'`
      )
    ),
    0,
    "CREDIT IS NOT CONSUMED BEFORE VERIFIED PAYMENT"
  )

  // The signed paid webhook for the PRODUCT order.
  const productSessionId = stripe.lastSessionId
  const productEvent = {
    id: `evt_prod_${seq}`,
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: productSessionId,
        metadata: { order_id: orderId },
        payment_status: "paid",
        payment_intent: "pi_product",
        amount_total: 799,
        currency: "usd"
      }
    }
  }
  await stripeWebhook(await signed(productEvent))

  const consumed = () =>
    Number(
      sql(
        DB,
        `select coalesce(sum(amount_cents),0) from public.store_credit_lot_allocations
         where order_id='${orderId}' and state='consumed'`
      )
    )

  assert.equal(consumed(), 500, "verified payment consumed the $5.00 exactly once")
  assert.equal(giftAvailable(recipientId), 0, "gift-origin value is now $0.00")

  await stripeWebhook(await signed(productEvent))
  assert.equal(consumed(), 500, "a replayed webhook consumes nothing additional")

  const rewards = rewardsFor(recipientId)
  assert.equal(rewards.length, 1, "exactly one RealVIP reward")
  assert.equal(rewards[0].reward_key, "store.realvip-3m")
  assert.equal(
    Number(sql(DB, `select count(*) from public.reward_queue where reward_key ilike '%gift%'`)),
    0,
    "zero gift-card rewards"
  )
})
