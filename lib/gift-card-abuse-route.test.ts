// Abuse controls, driven through the REAL routes against a REAL database.
//
// The point of this file is that the counting is DURABLE. A test that mocked
// the counter would have passed just as happily against the module-scope Map
// this replaced — which was not a rate limiter on Cloudflare at all, because
// isolates are per-request and do not share memory. So every count below is
// written to Postgres by the route and read back from Postgres by the route.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { isStripeRequest, isResendRequest } = await import("../tests/support/request-host.ts")

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_ABUSE_DB ?? "rf_abuse_route"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
sql(DB, `update public.products set active = true where slug in ('gift-card-25','realvip-3m')`)

const ENV = {
  STORE_GIFT_CARDS_ENABLED: "true",
  GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY: "0".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1",
  GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
  RESEND_API_KEY: "resend-value",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>",
  NEXT_PUBLIC_SITE_URL: "https://realfiction.live",
  // A test-only pepper. Its presence is what makes the IP and recipient
  // subjects exist at all, so the hashing path is genuinely exercised.
  ABUSE_SUBJECT_PEPPER: "test-pepper-not-a-secret"
}
Object.assign(process.env, ENV)

const session = { user: null as { id: string; email: string; email_confirmed_at: string } | null }
const stripe = { calls: 0 }

mock.module("server-only", { namedExports: {}, defaultExport: {} })
mock.module("@/lib/supabase/server", { namedExports: { getAuthenticatedUser: async () => session.user } })
/**
 * Lets a test simulate the abuse-counter database being unreachable, which is
 * the exact condition the fail-open bug turned into "sell anyway".
 */
const db = { broken: false }
const brokenClient = () => ({
  rpc: async () => ({ data: null, error: { code: "57P01", message: "server closed the connection" } }),
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "57P01" } }) }) })
  })
})

mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => (db.broken ? brokenClient() : createPgSupabaseClient(DB))
  }
})
mock.module("@/lib/supabase/service-role-rest", {
  namedExports: {
    callServiceRoleRpc: async (fn: string, args: Record<string, unknown>) =>
      createPgSupabaseClient(DB).rpc(fn, args)
  }
})

// Only the payment provider is faked. Everything else is real.
mock.module("@/lib/store-server", {
  namedExports: {
    CheckoutGuardUnavailableError: class extends Error {},
    resolveCheckoutLines: async (input: { items: { productId: string }[] }) => [
      {
        product: {
          id: "product-uuid", slug: input.items[0].productId, category: "gift_cards",
          name: "RealFiction Gift Card", description: "", price_cents: 2500, currency: "USD",
          fulfillment_type: "consumable", duration_days: null, metadata: {}, active: true
        },
        quantity: 1,
        lineTotalCents: 2500
      }
    ],
    claimCheckoutAttempt: async () => ({
      claimId: "claim-1", existingOrderId: null, storedFingerprint: null, status: "new",
      attemptExpiresAt: null, sessionId: null, sessionUrl: null, sessionExpiresAt: null
    }),
    createPendingOrder: async () => "11111111-2222-4333-8444-555555555555",
    attachCheckoutAttemptOrder: async () => {},
    attachCheckoutSession: async () => true,
    attachProviderSession: async () => {},
    closeCheckoutAttempt: async () => {},
    cancelOrder: async () => {}
  }
})

globalThis.fetch = (async (url: unknown) => {
  if (isStripeRequest(url)) {
    stripe.calls++
    return { ok: true, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/x", expires_at: 1 }) } as never
  }
  throw new Error("unexpected network call")
}) as never as typeof fetch

const checkout = (await import("../app/api/store/gift-cards/checkout/route.ts")).POST
const claim = (await import("../app/api/gift-cards/claim/route.ts")).POST
const cash = await import("../app/api/store/gift-cards/cash-redemption/route.ts")

let seq = 0
const uuid = (p: number) => `${String(p).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`
const attemptId = () => `3f2504e0-4f89-41d3-9a0c-${String(++seq).padStart(12, "0")}`

function account() {
  const id = uuid(90000000)
  const email = `a${seq}@e.test`
  sql(DB, `insert into auth.users (id,email) values ('${id}','${email}') on conflict do nothing;
           insert into public.profiles (id,email) values ('${id}','${email}') on conflict do nothing;`)
  session.user = { id, email, email_confirmed_at: "2026-01-01T00:00:00Z" }
  return { id, email }
}

const buy = (recipient: string, ip?: string) =>
  checkout(new Request("https://realfiction.live/api/store/gift-cards/checkout", {
    method: "POST",
    headers: ip
      ? { "Content-Type": "application/json", "cf-connecting-ip": ip }
      : { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: "gift-card-25", recipientEmail: recipient, senderName: "A",
      sendToSelf: false, checkoutAttemptId: attemptId()
    })
  }))

/** Restores the environment a passing test assumes. */
function restore() {
  db.broken = false
  process.env.ABUSE_SUBJECT_PEPPER = ENV.ABUSE_SUBJECT_PEPPER
}

const counted = (kind: string, actor: string) =>
  Number(sql(DB, `select count(*) from public.abuse_events where kind='${kind}' and actor='${actor}' and subject_kind='account'`))

// ===========================================================================
// A NORMAL CUSTOMER
// ===========================================================================

test("a normal $25 gift-card purchase is ALLOWED and unaffected", async () => {
  const user = account()
  const response = await buy("friend@e.test", "203.0.113.10")

  assert.equal(response.status, 200, "the purchase went through")
  assert.equal(counted("gift_card_checkout", user.id), 1, "and the attempt was counted durably")
})

test("the counters never store an address or an email in the clear", async () => {
  const user = account()
  await buy("victim@e.test", "203.0.113.55")

  const rows = sql(DB, `select subject_kind || '=' || subject from public.abuse_events where actor='${user.id}'`)
  assert.ok(!rows.includes("203.0.113.55"), "THE IP ADDRESS IS NOT STORED")
  assert.ok(!rows.includes("victim@e.test"), "THE RECIPIENT ADDRESS IS NOT STORED")
  assert.ok(!rows.includes(user.email), "NOR THE PURCHASER'S OWN ADDRESS")
  assert.match(rows, /ip=[0-9a-f]{64}/, "only a 256-bit hash")
})

test("an untrusted X-Forwarded-For is ignored entirely", async () => {
  const user = account()
  await checkout(new Request("https://realfiction.live/api/store/gift-cards/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: JSON.stringify({
      slug: "gift-card-25", recipientEmail: "f@e.test", senderName: "A",
      sendToSelf: false, checkoutAttemptId: attemptId()
    })
  }))

  assert.equal(
    Number(sql(DB, `select count(*) from public.abuse_events where actor='${user.id}' and subject_kind='ip'`)),
    0,
    "a client-settable header never becomes an identity"
  )
})

// ===========================================================================
// VELOCITY
// ===========================================================================

test("RAPID REPEATED CHECKOUT is blocked, safely", async () => {
  const user = account()
  const responses = []
  for (let i = 0; i < 14; i++) {
    responses.push(await buy("target@e.test"))
  }

  const blocked = responses.filter((r) => r.status === 403)
  assert.ok(blocked.length > 0, "the burst was eventually refused")

  const body = (await blocked[0].json()) as { error?: string }
  // Safely: no rule name, no count, no window, no retry hint.
  assert.doesNotMatch(String(body.error), /attempt|limit|rule|minute|hour|\d/i)
  assert.equal(blocked[0].headers.get("retry-after"), null, "and no Retry-After to read the window off")
})

test("a blocked attempt still COUNTS, so hammering does not reset anything", async () => {
  const user = account()
  for (let i = 0; i < 14; i++) {
    await buy("target2@e.test")
  }
  const before = counted("gift_card_checkout", user.id)
  await buy("target2@e.test")

  assert.equal(counted("gift_card_checkout", user.id), before + 1)
})

test("MANY RECIPIENTS RAPIDLY is caught even when each is a first attempt", async () => {
  const user = account()
  const responses = []
  for (let i = 0; i < 11; i++) {
    responses.push(await buy(`victim-${i}@e.test`))
  }
  assert.ok(responses.some((r) => r.status === 403), "recipient cycling is refused")
})

test("HIGH PURCHASE VALUE is refused before the purchase happens", async () => {
  const user = account()
  // 20 completed $50 purchases = $1000, the 24h ceiling.
  sql(DB, `insert into public.abuse_events (kind, actor, subject_kind, subject, amount_cents)
           select 'gift_card_purchase','${user.id}','account','${user.id}',100000`)

  const before = stripe.calls
  const response = await buy("bigspender@e.test")

  assert.equal(response.status, 403, "blocked")
  assert.equal(stripe.calls, before, "AND NO STRIPE SESSION WAS CREATED FOR IT")
  assert.equal(
    Number(sql(DB, `select count(*) from public.orders where user_id='${user.id}'`)),
    0,
    "NOTHING WAS CREATED TO CLEAN UP — no order, no reservation"
  )
})

test("a review-tier customer is NOT blocked, and one review item is filed", async () => {
  const user = account()
  for (let i = 0; i < 6; i++) {
    await buy("reviewed@e.test")
  }
  const seventh = await buy("reviewed@e.test")

  assert.equal(seventh.status, 200, "the customer still buys")
  assert.ok(
    Number(sql(DB, `select count(*) from public.payment_reviews where event_type='gift_card_velocity'
                    and detail->>'actor'='${user.id}'`)) >= 1,
    "and a human is asked to look"
  )
})

// ===========================================================================
// CLAIM BRUTE FORCE
// ===========================================================================

test("CLAIM BRUTE FORCE IS THROTTLED, durably", async () => {
  const user = account()
  const attempt = () =>
    claim(new Request("https://realfiction.live/api/gift-cards/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.99" },
      body: JSON.stringify({ secret: "z".repeat(43) })
    }))

  const results = []
  for (let i = 0; i < 9; i++) {
    const response = await attempt()
    results.push((await response.json()) as { result?: string })
  }

  assert.ok(results.some((r) => r.result === "rate_limited"), "the guessing was cut off")
  assert.ok(
    counted("gift_card_claim_failure", user.id) >= 6,
    "and every failure is in the DATABASE, not in one isolate's memory"
  )

  // The decisive proof: a brand-new module instance (which is what a fresh
  // Cloudflare isolate is) still refuses, because it reads the same rows.
  const fresh = (await import(`../app/api/gift-cards/claim/route.ts?fresh=${Date.now()}`)).POST
  const response = await fresh(new Request("https://realfiction.live/api/gift-cards/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "z".repeat(43) })
  }))
  assert.equal((await response.json()).result, "rate_limited", "A FRESH ISOLATE IS STILL THROTTLED")
})

test("one account's failures never throttle another", async () => {
  account()
  const response = await claim(new Request("https://realfiction.live/api/gift-cards/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "y".repeat(43) })
  }))
  assert.notEqual((await response.json()).result, "rate_limited")
})

// ===========================================================================
// CASH REDEMPTION
// ===========================================================================

function giftCredit(cents = 2500) {
  const buyer = uuid(91000000)
  const order = uuid(92000000)
  const card = uuid(93000000)
  const recipient = account()
  const verifier = `v-cash-${seq}`

  sql(DB, `
    insert into auth.users (id,email) values ('${buyer}','p${seq}@e.test') on conflict do nothing;
    insert into public.profiles (id,email) values ('${buyer}','p${seq}@e.test') on conflict do nothing;
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${buyer}','p@e.test','B','stripe','pi_c${seq}','fulfilled',${cents},0,${cents},0,${cents},'USD');
    insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
    values ('${card}',${cents},${cents},'USD','${buyer}','${order}','active','${recipient.email}','RFG-C${String(seq).padStart(7,'0')}');
    insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
    values ('${card}','${verifier}','WXYZ');
    select public.claim_gift_card('${verifier}','${recipient.id}','${recipient.email}');`)

  session.user = { id: recipient.id, email: recipient.email, email_confirmed_at: "2026-01-01T00:00:00Z" }
  return { ...recipient, buyer, card, order }
}

const requestCash = (body: unknown = {}) =>
  cash.POST(new Request("https://realfiction.live/api/store/gift-cards/cash-redemption", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }))

const frozen = (u: string) =>
  Number(sql(DB, `select coalesce(sum(frozen_cents),0) from public.store_credit_lots where user_id='${u}'`))

test("an ELIGIBLE gift-origin remainder freezes, files ONE review, and pays nobody", async () => {
  const user = giftCredit()

  const response = await requestCash()
  const body = (await response.json()) as { status?: string; message?: string }

  assert.equal(body.status, "received")
  assert.equal(frozen(user.id), 2500, "THE AMOUNT IS FROZEN")
  assert.equal(Number(sql(DB, `select public.gift_origin_available('${user.id}')`)), 0, "and unspendable")
  assert.equal(
    Number(sql(DB, `select count(*) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    1,
    "ONE review created"
  )
  assert.equal(
    sql(DB, `select state from public.cash_redemption_requests where claimant_user_id='${user.id}'`),
    "requested",
    "NO AUTOMATIC PAYOUT"
  )
  assert.equal(
    Number(sql(DB, `select coalesce(sum(paid_out_cents),0) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    0,
    "and nothing paid"
  )
})

test("the response promises nothing and reveals nothing", async () => {
  const user = giftCredit()
  const text = await (await requestCash()).text()

  assert.doesNotMatch(text, /25\.00|2500|amount|eligible|approv|payout|state/i)
  assert.ok(!text.includes(user.buyer), "and never names the purchaser")
  assert.ok(!text.includes(user.card))
})

test("a DUPLICATE request is idempotent and does not freeze twice", async () => {
  const user = giftCredit()
  await requestCash()
  const second = (await (await requestCash()).json()) as { status?: string }

  assert.equal(second.status, "already_open")
  assert.equal(frozen(user.id), 2500, "STILL $25, NOT $50")
  assert.equal(
    Number(sql(DB, `select count(*) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    1
  )
})

test("CONCURRENT requests are safe", async () => {
  const user = giftCredit()
  await Promise.all([requestCash(), requestCash(), requestCash()])

  assert.equal(frozen(user.id), 2500, "the value is frozen exactly once")
  assert.equal(
    Number(sql(DB, `select count(*) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    1
  )
})

test("PROMOTIONAL credit is ineligible", async () => {
  const user = account()
  sql(DB, `
    insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
    values ('${user.id}', 5000, 'manual_grant', 'promo', 'promo:${seq}', 'Promo');
    insert into public.store_credit_lots (user_id, source, original_cents, remaining_cents, currency)
    values ('${user.id}', 'promotional', 5000, 5000, 'USD');`)

  const body = (await (await requestCash()).json()) as { status?: string }
  assert.equal(body.status, "not_eligible")
  assert.equal(frozen(user.id), 0, "and nothing was frozen")
})

test("ORDINARY UNLOTTED store credit is ineligible", async () => {
  const user = account()
  sql(DB, `insert into public.store_credit_ledger (user_id, delta_cents, source, source_ref, idempotency_key, note)
           values ('${user.id}', 7500, 'manual_grant', 'plain', 'plain:${seq}', 'Plain')`)

  const body = (await (await requestCash()).json()) as { status?: string }
  assert.equal(body.status, "not_eligible")
  assert.equal(
    Number(sql(DB, `select balance_cents from public.get_store_credit_balance('${user.id}')`)),
    7500,
    "even though the balance is real"
  )
})

test("DISPUTED value is ineligible", async () => {
  const user = giftCredit()
  sql(DB, `update public.gift_cards set disputed_at = now(), dispute_status='open' where id='${user.card}'`)

  const body = (await (await requestCash()).json()) as { status?: string }
  assert.equal(body.status, "not_eligible")
  assert.equal(frozen(user.id), 0, "nothing frozen for a payout that must not happen")
})

// ===========================================================================
// RACE: one use wins
// ===========================================================================

test("SAME VALUE RACED between checkout and redemption — exactly one use wins", async () => {
  const user = giftCredit()
  const order = uuid(94000000)
  sql(DB, `
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${user.id}','r@e.test','R','stripe','pending',2500,0,2500,0,2500,'USD');`)

  // Both go for the same $25 at the same time.
  await Promise.all([
    requestCash(),
    (async () => sql(DB, `select public.reserve_store_credit_for_order('${order}','${user.id}',2500)`))()
  ])

  const redeemed = Number(sql(DB, `select coalesce(sum(requested_cents),0) from public.cash_redemption_requests
    where claimant_user_id='${user.id}' and state not in ('rejected','ineligible')`))
  const reserved = Number(sql(DB, `select coalesce(sum(a.amount_cents),0)
    from public.store_credit_lot_allocations a where a.order_id='${order}' and a.state in ('reserved','consumed')`))

  assert.ok(redeemed + reserved <= 2500, `EXACTLY ONE USE: redeemed ${redeemed} + reserved ${reserved} exceeded $25`)
  assert.ok(redeemed === 2500 || reserved === 2500, "and the winner took the whole $25")
  assert.ok(
    Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${user.id}'`)) >= 0,
    "no negative balance"
  )
})

// ===========================================================================
// SECURITY
// ===========================================================================

test("SIGNED OUT is denied", async () => {
  giftCredit()
  const owner = session.user!.id
  session.user = null

  const response = await requestCash()
  assert.equal(response.status, 401)
  assert.equal(frozen(owner), 0)
})

test("CROSS-ACCOUNT: another user's lot cannot be redeemed", async () => {
  const victim = giftCredit()
  const lot = sql(DB, `select id from public.store_credit_lots where user_id='${victim.id}' limit 1`)

  const attacker = account()
  const body = (await (await requestCash({ lotId: lot })).json()) as { status?: string }

  assert.equal(body.status, "not_eligible", "and looks exactly like having no credit")
  assert.equal(frozen(victim.id), 0, "THE VICTIM'S VALUE IS UNTOUCHED")
  assert.equal(frozen(attacker.id), 0)
})

test("a CLIENT-SUPPLIED AMOUNT is rejected outright", async () => {
  const user = giftCredit()
  for (const field of [
    "amount", "amountCents", "requestedCents", "eligibleCents", "frozenCents",
    "currency", "state", "eligible", "giftCardId", "purchaserUserId", "claimantUserId", "userId"
  ]) {
    const response = await requestCash({ [field]: 999999 })
    assert.equal(response.status, 400, `${field} was not rejected`)
  }
  assert.equal(frozen(user.id), 0, "none of them froze anything")
})

test("a malformed lot id is refused before any lookup", async () => {
  giftCredit()
  for (const bad of ["", "not-a-uuid", 12345]) {
    assert.equal((await requestCash({ lotId: bad })).status, 400)
  }
})

test("GET can never open a review", async () => {
  giftCredit()
  assert.equal((await cash.GET()).status, 405)
})

test("REFUND ABUSE is throttled", async () => {
  const user = account()
  sql(DB, `insert into public.abuse_events (kind, actor, subject_kind, subject)
           select 'gift_card_refund_request','${user.id}','account','${user.id}' from generate_series(1,8)`)

  const { checkActorRule } = await import("./abuse/guard.ts")
  const verdict = await checkActorRule("refund_requests_24h", "gift_card_refund_request", user.id)
  assert.equal(verdict.decision, "block", "an eighth refund request in a day is refused")
})


// ===========================================================================
// FAIL CLOSED: the controls are down
//
// This is the regression that matters most in the file. The first version of
// this system failed OPEN on a purchase — a database hiccup produced an
// interval with no velocity limit, no value ceiling, and no recipient check, on
// the one product where those are load-bearing.
// ===========================================================================

test("ABUSE DB UNAVAILABLE -> checkout is refused with 503, not sold anyway", async () => {
  const user = account()
  const before = stripe.calls
  db.broken = true

  const response = await buy("friend@e.test", "203.0.113.10")

  assert.equal(response.status, 503, "TEMPORARILY UNAVAILABLE, not a silent allow")
  assert.equal(stripe.calls, before, "NO STRIPE REQUEST")

  restore()
  assert.equal(
    Number(sql(DB, `select count(*) from public.orders where user_id='${user.id}'`)),
    0,
    "NO ORDER"
  )
})

test("the unavailable answer is temporary and says nothing about fraud controls", async () => {
  account()
  db.broken = true
  const body = (await (await buy("friend@e.test")).json()) as { error?: string }
  restore()

  assert.match(String(body.error), /temporarily unavailable|try again/i)
  assert.doesNotMatch(String(body.error), /fraud|abuse|velocity|limit|rule|database/i)
})

test("a normal purchase still succeeds once the controls recover", async () => {
  const user = account()
  db.broken = true
  assert.equal((await buy("friend@e.test")).status, 503)

  restore()
  assert.equal((await buy("friend@e.test")).status, 200, "the refusal was transient, not sticky")
  assert.equal(counted("gift_card_checkout", user.id), 1)
})

test("a broken counter BLOCKS a claim rather than letting guessing through", async () => {
  account()
  db.broken = true

  const response = await claim(new Request("https://realfiction.live/api/gift-cards/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "z".repeat(43) })
  }))
  const body = (await response.json()) as { result?: string }
  restore()

  assert.ok(
    body.result === "rate_limited" || body.result === "temporarily_unavailable",
    `expected a refusal, got ${body.result}`
  )
})

test("a broken counter BLOCKS a cash-redemption request, freezing nothing", async () => {
  const user = giftCredit()
  db.broken = true

  const response = await requestCash()
  restore()

  assert.ok(response.status >= 400, "refused")
  assert.equal(frozen(user.id), 0, "NO VALUE MOVED")
  assert.equal(
    Number(sql(DB, `select count(*) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    0,
    "and no review was opened"
  )
})

// ===========================================================================
// PEPPER MISSING -> every gift-card path is refused
//
// Without it there is no per-IP, per-email, or per-recipient counting, only
// per-account — which an attacker defeats by making accounts. It used to
// degrade silently; now it is a configuration failure.
// ===========================================================================

test("PEPPER MISSING -> gift-card checkout is blocked, with NO Stripe call", async () => {
  const user = account()
  const before = stripe.calls
  delete process.env.ABUSE_SUBJECT_PEPPER

  const response = await buy("friend@e.test", "203.0.113.10")
  restore()

  assert.equal(response.status, 503)
  assert.equal(stripe.calls, before, "NO STRIPE CALL")
  assert.equal(
    Number(sql(DB, `select count(*) from public.orders where user_id='${user.id}'`)),
    0,
    "NO ORDER"
  )
})

test("PEPPER MISSING -> claim is blocked before the claim transaction", async () => {
  const user = giftCredit()
  const balanceBefore = Number(sql(DB, `select public.gift_origin_available('${user.id}')`))
  delete process.env.ABUSE_SUBJECT_PEPPER

  const response = await claim(new Request("https://realfiction.live/api/gift-cards/claim", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "z".repeat(43) })
  }))
  const body = (await response.json()) as { result?: string }
  restore()

  assert.equal(response.status, 503)
  assert.equal(body.result, "temporarily_unavailable")
  assert.equal(
    Number(sql(DB, `select public.gift_origin_available('${user.id}')`)),
    balanceBefore,
    "NO VALUE MOVEMENT"
  )
})

test("PEPPER MISSING -> a refund is blocked before Stripe and before any reversal", async () => {
  // A real purchased gift card, refundable by its purchaser.
  const buyerId = uuid(95000000)
  const orderId = uuid(96000000)
  const cardId = uuid(97000000)
  sql(DB, `
    insert into auth.users (id,email) values ('${buyerId}','rb${seq}@e.test') on conflict do nothing;
    insert into public.profiles (id,email) values ('${buyerId}','rb${seq}@e.test') on conflict do nothing;
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,provider_payment_id,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${orderId}','${buyerId}','rb@e.test','B','stripe','pi_r${seq}','fulfilled',2500,0,2500,0,2500,'USD');
    insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
    select '${orderId}', id, '{"slug":"gift-card-25"}'::jsonb,1,2500,2500 from public.products where slug='gift-card-25';
    insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
    values ('${cardId}',2500,2500,'USD','${buyerId}','${orderId}','active','r${seq}@e.test','RFG-P${String(seq).padStart(7,'0')}');
    insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
    values ('${cardId}','v-pep-${seq}','WXYZ');`)

  session.user = { id: buyerId, email: `rb${seq}@e.test`, email_confirmed_at: "2026-01-01T00:00:00Z" }
  const refund = (await import("../app/api/store/gift-cards/refund/route.ts")).POST

  const before = stripe.calls
  delete process.env.ABUSE_SUBJECT_PEPPER
  const response = await refund(new Request("https://realfiction.live/api/store/gift-cards/refund", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId })
  }))
  restore()

  assert.equal(response.status, 503)
  assert.equal(stripe.calls, before, "NO STRIPE CALL")
  assert.equal(sql(DB, `select status from public.gift_cards where id='${cardId}'`), "active", "card untouched")
  assert.equal(
    Number(sql(DB, `select count(*) from public.order_refunds where order_id='${orderId}'`)),
    0,
    "NO INTERNAL REVERSAL"
  )
})

test("PEPPER MISSING -> a cash-redemption request is blocked, freezing nothing", async () => {
  const user = giftCredit()
  delete process.env.ABUSE_SUBJECT_PEPPER

  const response = await requestCash()
  restore()

  assert.equal(response.status, 503)
  assert.equal(frozen(user.id), 0, "NO VALUE FROZEN")
  assert.equal(
    Number(sql(DB, `select count(*) from public.cash_redemption_requests where claimant_user_id='${user.id}'`)),
    0
  )
})

test("PEPPER MISSING -> there is NO FALLBACK to unpeppered hashes", async () => {
  const user = account()
  const before = Number(sql(DB, `select count(*) from public.abuse_events where actor='${user.id}'`))
  delete process.env.ABUSE_SUBJECT_PEPPER

  await buy("friend@e.test", "203.0.113.10")
  restore()

  assert.equal(
    Number(sql(DB, `select count(*) from public.abuse_events where actor='${user.id}'`)),
    before,
    "nothing was written — an unpeppered IP hash IS the IP address"
  )
})
