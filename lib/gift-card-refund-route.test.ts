// POST /api/store/gift-cards/refund — authorization and safety.
//
// `requestGiftCardRefund` refunds any card it is handed. This route is the only
// thing deciding who may call it, so the deny cases matter more than the happy
// path: without them, any authenticated account could refund any gift card.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_REFUND_ROUTE_DB ?? "rf_refund_route"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
sql(DB, `update public.products set active = true where slug in ('gift-card-25','realvip-3m')`)

const session = { user: null as { id: string; email: string } | null }

mock.module("server-only", { namedExports: {}, defaultExport: {} })
mock.module("@/lib/supabase/server", { namedExports: { getAuthenticatedUser: async () => session.user } })
mock.module("@/lib/supabase/service-role", {
  namedExports: { getSupabaseServiceRoleClient: () => createPgSupabaseClient(DB) }
})

let refundSeq = 0
const stripe = { bodies: [] as string[] }

globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (String(url).includes("/v1/refunds")) {
    stripe.bodies.push(String(init?.body))
    const params = new URLSearchParams(String(init?.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: `re_${++refundSeq}`, status: "succeeded", amount: Number(params.get("amount")) })
    } as never
  }
  throw new Error("unexpected call")
}) as never as typeof fetch

process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key"
// The route refuses outright without this. A test-only value, never a secret.
process.env.ABUSE_SUBJECT_PEPPER = "test-pepper-not-a-secret"

const { POST, GET } = await import("../app/api/store/gift-cards/refund/route.ts")

let seq = 0
const uuid = (p: number) => `${String(p).padStart(8, "0")}-0000-4000-8000-${String(++seq).padStart(12, "0")}`

function fixture(claimed: boolean, spend = 0) {
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
    values ('${order}','${buyer}','b@e.test','B','stripe','pi_${seq}','fulfilled',2500,0,2500,0,2500,'USD');
    insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
    select '${order}', id, '{"slug":"gift-card-25"}'::jsonb,1,2500,2500 from public.products where slug='gift-card-25';
    insert into public.gift_cards (id,original_balance_cents,balance_cents,currency,purchaser_user_id,purchaser_order_id,status,recipient_email,public_ref)
    values ('${card}',2500,2500,'USD','${buyer}','${order}','active','${email}','RFG-${String(seq).padStart(8,'0')}');
    insert into public.gift_card_claim_credentials (gift_card_id,verifier,masked_suffix)
    values ('${card}','${verifier}','WXYZ');`)

  if (claimed) sql(DB, `select public.claim_gift_card('${verifier}','${recipient}','${email}')`)

  if (spend > 0) {
    const o = uuid(55550000)
    sql(DB, `
      insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
        subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
      values ('${o}','${recipient}','r@e.test','P','stripe','pending',${spend},0,${spend},0,${spend},'USD');
      insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
      select '${o}', id, '{"slug":"realvip-3m"}'::jsonb,1,${spend},${spend} from public.products where slug='realvip-3m';
      select public.reserve_store_credit_for_order('${o}','${recipient}',${spend});
      select public.complete_store_credit_only_order('${o}','${recipient}');`)
  }

  session.user = { id: buyer, email: `b${seq}@e.test` }
  return { buyer, recipient, order, card, verifier, email }
}

const post = (body: unknown) =>
  POST(new Request("https://realfiction.live/api/store/gift-cards/refund", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }))

const status = async (r: Response) => ({ code: r.status, body: (await r.json()) as { status?: string; error?: string } })
const avail = (u: string) => Number(sql(DB, `select public.gift_origin_available('${u}')`))
const cardStatus = (c: string) => sql(DB, `select status from public.gift_cards where id='${c}'`)

function reset() { stripe.bodies = [] }

// ===========================================================================
// AUTHORIZATION
// ===========================================================================

test("SIGNED OUT is denied and touches nothing", async () => {
  reset()
  const f = fixture(false)
  session.user = null

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.code, 401)
  assert.deepEqual(stripe.bodies, [])
  assert.equal(cardStatus(f.card), "active")
})

test("the RECIPIENT cannot refund a card bought for them", async () => {
  reset()
  const f = fixture(true)
  session.user = { id: f.recipient, email: f.email }

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.code, 404, "and learns nothing about the order existing")
  assert.deepEqual(stripe.bodies, [], "NO STRIPE CALL")
  assert.equal(avail(f.recipient), 2500, "their claimed value is untouched")
})

test("a DIFFERENT account cannot refund someone else's order", async () => {
  reset()
  const f = fixture(false)
  const stranger = uuid(66660000)
  sql(DB, `insert into auth.users (id,email) values ('${stranger}','s@e.test') on conflict do nothing;
           insert into public.profiles (id,email) values ('${stranger}','s@e.test') on conflict do nothing;`)
  session.user = { id: stranger, email: "s@e.test" }

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.code, 404)
  assert.deepEqual(stripe.bodies, [])
  assert.equal(cardStatus(f.card), "active")
})

test("a MISSING order and someone else's order are indistinguishable", async () => {
  reset()
  const f = fixture(false)
  const mine = await status(await post({ orderId: uuid(77770000) }))

  const stranger = uuid(66660000)
  sql(DB, `insert into auth.users (id,email) values ('${stranger}','s2@e.test') on conflict do nothing;
           insert into public.profiles (id,email) values ('${stranger}','s2@e.test') on conflict do nothing;`)
  session.user = { id: stranger, email: "s2@e.test" }
  const theirs = await status(await post({ orderId: f.order }))

  assert.equal(mine.code, theirs.code, "same status")
  assert.deepEqual(mine.body, theirs.body, "and the same body — no order-id oracle")
})

test("an ORDINARY product order is refused by this endpoint", async () => {
  reset()
  const buyer = uuid(11110000)
  const order = uuid(33330000)
  sql(DB, `
    insert into auth.users (id,email) values ('${buyer}','o@e.test') on conflict do nothing;
    insert into public.profiles (id,email) values ('${buyer}','o@e.test') on conflict do nothing;
    insert into public.orders (id,user_id,buyer_email,minecraft_username,provider,status,
      subtotal_cents,discount_cents,total_cents,store_credit_applied_cents,payment_due_cents,currency)
    values ('${order}','${buyer}','o@e.test','P','stripe','fulfilled',1299,0,1299,0,1299,'USD');
    insert into public.order_items (order_id,product_id,product_snapshot,quantity,unit_price_cents,total_cents)
    select '${order}', id, '{"slug":"realvip-3m"}'::jsonb,1,1299,1299 from public.products where slug='realvip-3m';`)
  session.user = { id: buyer, email: "o@e.test" }

  const r = await status(await post({ orderId: order }))
  assert.equal(r.code, 400)
  assert.deepEqual(stripe.bodies, [])
})

test("GET can never trigger a refund", async () => {
  reset()
  const response = await GET()
  assert.equal(response.status, 405)
  assert.deepEqual(stripe.bodies, [])
})

// ===========================================================================
// CLIENT-CONTROLLED FIELDS
// ===========================================================================

test("any client monetary or identity field REJECTS the request", async () => {
  const f = fixture(false)
  for (const field of [
    "amount", "amountCents", "refundCents", "price", "faceValue", "currency",
    "paymentIntentId", "chargeId", "recipientEmail", "giftCardId", "eligible", "state", "refundId"
  ]) {
    reset()
    const r = await status(await post({ orderId: f.order, [field]: 1 }))
    assert.equal(r.code, 400, `${field} was not rejected`)
    assert.deepEqual(stripe.bodies, [], `${field} reached Stripe`)
  }
  assert.equal(cardStatus(f.card), "active", "nothing was refunded by any of them")
})

test("a malformed order id is refused before any lookup", async () => {
  reset()
  fixture(false)
  for (const bad of ["", "not-a-uuid", 12345, null]) {
    const r = await status(await post({ orderId: bad }))
    assert.equal(r.code, 400)
  }
  assert.deepEqual(stripe.bodies, [])
})

// ===========================================================================
// THE HAPPY PATHS, THROUGH THE ROUTE
// ===========================================================================

test("UNCLAIMED: the purchaser refunds, Stripe receives exactly 2500", async () => {
  reset()
  const f = fixture(false)

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.body.status, "refunded")
  assert.equal(stripe.bodies.length, 1)
  assert.match(stripe.bodies[0], /amount=2500/, "STRIPE RECEIVED EXACTLY 2500")
  assert.equal(cardStatus(f.card), "void")
  assert.equal(
    sql(DB, `select outcome from public.claim_gift_card('${f.verifier}','${f.recipient}','${f.email}')`),
    "invalid",
    "the credential is dead"
  )
})

test("CLAIMED-UNUSED: freezes, Stripe gets 2500, exact reversal", async () => {
  reset()
  const f = fixture(true)
  assert.equal(avail(f.recipient), 2500)

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.body.status, "refunded")
  assert.match(stripe.bodies[0], /amount=2500/)
  assert.equal(avail(f.recipient), 0, "exact $25 reversal")
  assert.ok(
    Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${f.recipient}'`)) >= 0,
    "no negative balance"
  )
})

test("PARTIALLY SPENT: no Stripe call, review, and the response reveals nothing", async () => {
  reset()
  const f = fixture(true, 1299)

  const r = await status(await post({ orderId: f.order }))
  assert.equal(r.body.status, "review_required")
  assert.deepEqual(stripe.bodies, [], "NO STRIPE CALL")
  assert.equal(avail(f.recipient), 1201, "the recipient's value is untouched")

  // The purchaser must not learn what the recipient did.
  const text = JSON.stringify(r.body)
  assert.ok(!/1201|12\.01|spent|balance|realvip/i.test(text), "no recipient state leaked")
  assert.ok(!text.includes(f.recipient), "no recipient account id")
})

test("DUPLICATE submission produces ONE external refund and ONE reversal", async () => {
  reset()
  const f = fixture(true)

  const first = await status(await post({ orderId: f.order }))
  const second = await status(await post({ orderId: f.order }))

  assert.equal(first.body.status, "refunded")
  assert.notEqual(second.body.status, "refunded", "the repeat did not refund again")
  assert.equal(stripe.bodies.length, 1, "ONE external refund")
  assert.equal(
    Number(sql(DB, `select count(*) from public.order_refunds where order_id='${f.order}'`)),
    1,
    "ONE internal reversal"
  )
  assert.equal(avail(f.recipient), 0)
})

test("CONCURRENT route requests produce one refund", async () => {
  reset()
  const f = fixture(true)

  await Promise.all([post({ orderId: f.order }), post({ orderId: f.order })])

  assert.ok(stripe.bodies.length <= 1, `expected at most one Stripe call, got ${stripe.bodies.length}`)
  assert.equal(
    Number(sql(DB, `select count(*) from public.order_refunds where order_id='${f.order}'`)),
    stripe.bodies.length,
    "reversals match external refunds"
  )
  assert.ok(avail(f.recipient) >= 0, "no negative balance")
})

test("no response ever carries a recipient id or an internal identifier", async () => {
  reset()
  const f = fixture(true, 1299)
  const r = await post({ orderId: f.order })
  const text = await r.text()

  assert.ok(!text.includes(f.recipient))
  assert.ok(!text.includes(f.card))
  assert.doesNotMatch(text, /provider_refund|re_[0-9]|pi_[0-9]/)
})

test("REPLAYING a request that is already in review does not escalate it", async () => {
  reset()
  const f = fixture(true, 1299)

  const first = await status(await post({ orderId: f.order }))
  const second = await status(await post({ orderId: f.order }))
  const third = await status(await post({ orderId: f.order }))

  assert.equal(first.body.status, "review_required")
  assert.equal(second.body.status, "review_required")
  assert.equal(third.body.status, "review_required")
  assert.deepEqual(stripe.bodies, [], "hammering the endpoint NEVER reaches Stripe")
  assert.equal(
    Number(sql(DB, `select count(*) from public.gift_card_refunds where gift_card_id='${f.card}'`)),
    1,
    "and opens exactly ONE refund workflow"
  )
  assert.equal(
    Number(sql(DB, `select count(*) from public.payment_reviews where reason like 'gift_card_%'
      and detail->>'gift_card_id' = '${f.card}'`)),
    1,
    "and exactly ONE review for a human"
  )
  assert.equal(avail(f.recipient), 1201, "the recipient's remaining value is untouched throughout")
})

test("a COMPLETED refund cannot be replayed into a second reversal", async () => {
  reset()
  const f = fixture(true)

  await post({ orderId: f.order })
  for (let i = 0; i < 4; i++) {
    await post({ orderId: f.order })
  }

  assert.equal(stripe.bodies.length, 1, "ONE external refund after five submissions")
  assert.equal(
    Number(sql(DB, `select count(*) from public.store_credit_ledger
      where idempotency_key = 'gift_card_refund_reversal:${f.card}'`)),
    1,
    "ONE internal reversal"
  )
  assert.equal(avail(f.recipient), 0)
  assert.ok(
    Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${f.recipient}'`)) >= 0,
    "no negative balance"
  )
})
