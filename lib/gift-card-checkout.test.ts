// Gift-card checkout policy, the feature gate, and the exact Stripe request.
//
// The property these all serve: a browser chooses a denomination and a
// recipient. It never chooses an amount, a currency, a quantity, a payment
// method, or whether the feature is on.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

mock.module("server-only", { namedExports: {}, defaultExport: {} })

const {
  GIFT_CARD_DENOMINATIONS,
  GIFT_CARD_MESSAGE_MAX,
  GIFT_CARD_SENDER_NAME_MAX,
  evaluateGiftCardAvailability,
  GIFT_CARD_UNAVAILABLE,
  findDenomination,
  graphemeLength,
  normalizeEmail,
  parseGiftCardCheckout
} = await import("./gift-card/checkout-policy.ts")

const { buildGiftCardCheckoutBody } = await import("./gift-card/stripe-request.ts")

const BUYER = { verifiedEmail: "buyer@example.com" }
const ATTEMPT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

const VALID = {
  slug: "gift-card-25",
  recipientEmail: "friend@example.com",
  senderName: "Nicholas",
  message: "Happy birthday!",
  sendToSelf: false,
  checkoutAttemptId: ATTEMPT
}

function parse(overrides: Record<string, unknown> = {}, buyer = BUYER) {
  return parseGiftCardCheckout({ ...VALID, ...overrides }, buyer)
}

// -- The nine denominations ---------------------------------------------------

test("exactly nine denominations exist, at the approved face values", () => {
  assert.equal(GIFT_CARD_DENOMINATIONS.length, 9)
  assert.deepEqual(
    GIFT_CARD_DENOMINATIONS.map((d) => d.faceValueCents),
    [500, 1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000]
  )
})

test("each denomination maps slug to Stripe lookup key correctly", () => {
  // The website uses hyphens, Stripe uses underscores. Mixing them up would
  // silently resolve nothing.
  for (const denomination of GIFT_CARD_DENOMINATIONS) {
    assert.equal(denomination.stripeLookupKey, denomination.slug.replace(/-/g, "_"))
    const dollars = denomination.faceValueCents / 100
    assert.equal(denomination.slug, `gift-card-${dollars}`)
  }
})

test("every denomination is accepted", () => {
  for (const denomination of GIFT_CARD_DENOMINATIONS) {
    const result = parse({ slug: denomination.slug })
    assert.equal(result.ok, true, `${denomination.slug} was rejected`)
    if (result.ok) {
      assert.equal(result.intent.faceValueCents, denomination.faceValueCents)
    }
  }
})

test("the face value comes from OUR table, never the request", () => {
  // A client that sends its own amount, price, or currency is ignored entirely:
  // the parser reads only the slug.
  const result = parse({
    slug: "gift-card-5",
    faceValueCents: 100_000,
    amount: 100_000,
    priceCents: 1,
    currency: "JPY"
  } as never)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.intent.faceValueCents, 500)
    assert.ok(!("currency" in result.intent))
  }
})

test("unknown, invented, and ordinary-product SKUs are rejected", () => {
  for (const slug of [
    "gift-card-7",
    "gift-card-1000",
    "realvip-3m",
    "gift_card_25",
    "GIFT-CARD-25",
    "",
    "../gift-card-25"
  ]) {
    const result = parse({ slug })
    assert.equal(result.ok, false, `${slug} was accepted`)
    if (!result.ok) {
      assert.equal(result.rejection.code, "denomination_invalid")
    }
  }
})

test("findDenomination is exact", () => {
  assert.equal(findDenomination("gift-card-25")?.faceValueCents, 2500)
  assert.equal(findDenomination("gift-card-26"), null)
})

// -- Buyer and recipient ------------------------------------------------------

test("an unverified buyer cannot buy a gift card", () => {
  const result = parse({}, { verifiedEmail: null })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.rejection.code, "buyer_email_unverified")
    assert.equal(result.rejection.status, 403)
  }
})

test("send-to-self uses the SESSION address, not a supplied duplicate", () => {
  // A supplied address would be an unverified value we would then treat as
  // verified.
  const result = parse({ sendToSelf: true, recipientEmail: "attacker@evil.test" })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.intent.recipientEmail, "buyer@example.com")
    assert.equal(result.intent.sendToSelf, true)
  }
})

test("recipient addresses are normalized and validated", () => {
  const result = parse({ recipientEmail: "  Friend@Example.COM " })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.intent.recipientEmail, "friend@example.com")
  }
  assert.equal(normalizeEmail(" A@B.CO "), "a@b.co")

  for (const bad of ["", "not-an-email", "a@b", "a b@c.com", "@example.com", `${"a".repeat(250)}@b.com`]) {
    assert.equal(parse({ recipientEmail: bad }).ok, false, `accepted "${bad}"`)
  }
})

test("a missing recipient is rejected when not sending to self", () => {
  const result = parse({ recipientEmail: undefined })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.rejection.code, "recipient_required")
  }
})

// -- Free text ----------------------------------------------------------------

test("sender name and message are length-limited by GRAPHEME, not code unit", () => {
  // Escaped explicitly so the literal survives any tooling that might normalize
  // the zero-width joiners out of a pasted emoji.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"
  // One grapheme, five code points, eight UTF-16 units. Counting units would
  // reject a short name containing an emoji; counting code points would still
  // miscount any joined sequence.
  assert.equal(family.length, 8)
  assert.equal([...family].length, 5)
  assert.equal(graphemeLength(family), 1)

  assert.equal(parse({ senderName: `${family} Nicholas` }).ok, true)
  // 60 graphemes of joined emoji is allowed; 61 is not.
  assert.equal(parse({ senderName: family.repeat(GIFT_CARD_SENDER_NAME_MAX) }).ok, true)
  assert.equal(parse({ senderName: family.repeat(GIFT_CARD_SENDER_NAME_MAX + 1) }).ok, false)
  assert.equal(parse({ senderName: "a".repeat(GIFT_CARD_SENDER_NAME_MAX) }).ok, true)
  assert.equal(parse({ senderName: "a".repeat(GIFT_CARD_SENDER_NAME_MAX + 1) }).ok, false)
  assert.equal(parse({ message: "m".repeat(GIFT_CARD_MESSAGE_MAX) }).ok, true)
  assert.equal(parse({ message: "m".repeat(GIFT_CARD_MESSAGE_MAX + 1) }).ok, false)
})

test("control characters are rejected, not stripped", () => {
  // A newline in a sender name is a header-injection attempt.
  for (const value of ["Nick\nBcc: evil@test", "Nick\r\nX: y", "Nick\u0000", "Nick\u001b[31m"]) {
    const result = parse({ senderName: value })
    assert.equal(result.ok, false, `accepted ${JSON.stringify(value)}`)
    if (!result.ok) {
      assert.equal(result.rejection.code, "sender_name_invalid")
    }
  }
})

test("whitespace in free text is normalized", () => {
  const result = parse({ senderName: "  Nick   Lasagna  ", message: "  hi\t\tthere  " })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.intent.senderName, "Nick Lasagna")
    assert.equal(result.intent.message, "hi there")
  }
})

test("a bad attempt id is rejected before anything else happens", () => {
  for (const id of ["", "not-a-uuid", "3f2504e0-4f89-41d3-9a0c", undefined]) {
    assert.equal(parse({ checkoutAttemptId: id }).ok, false)
  }
})

// -- The feature gate ---------------------------------------------------------

const FULL_ENV = {
  STORE_GIFT_CARDS_ENABLED: "true",
  RESEND_API_KEY: "resend-value",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>"
}

/** Everything a real launch needs: tax reviewed AND the abuse pepper present. */
const REVIEWED = {
  ...FULL_ENV,
  GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
  ABUSE_SUBJECT_PEPPER: "test-pepper-not-a-secret"
}

test("gift cards are DISABLED unless every requirement holds", () => {
  assert.equal(evaluateGiftCardAvailability({}, { cryptoConfigured: true }).available, false)
  assert.equal(
    evaluateGiftCardAvailability(FULL_ENV, { cryptoConfigured: false }).reason,
    "crypto_unconfigured"
  )
  assert.equal(
    evaluateGiftCardAvailability({ ...FULL_ENV, RESEND_API_KEY: "" }, { cryptoConfigured: true }).reason,
    "email_unconfigured"
  )
  assert.equal(
    evaluateGiftCardAvailability({ ...FULL_ENV, EMAIL_FROM: "" }, { cryptoConfigured: true }).reason,
    "email_sender_unconfigured"
  )
  assert.equal(
    evaluateGiftCardAvailability({ ...REVIEWED, STORE_GIFT_CARDS_ENABLED: "TRUE " }, { cryptoConfigured: true })
      .available,
    true
  )
  assert.equal(evaluateGiftCardAvailability(REVIEWED, { cryptoConfigured: true }).available, true)
})

// ===========================================================================
// The gate and the checkout route must refuse in the SAME conditions
//
// A gate that is more permissive than the route renders a purchase form whose
// every submission fails. The customer discovers it only after filling in a
// recipient address and a message — strictly worse than Coming Soon, because
// they have already been told the product is available.
// ===========================================================================

test("A MISSING ABUSE PEPPER KEEPS THE STOREFRONT UNAVAILABLE", () => {
  const { ABUSE_SUBJECT_PEPPER: _omitted, ...withoutPepper } = REVIEWED

  const verdict = evaluateGiftCardAvailability(withoutPepper, { cryptoConfigured: true })
  assert.equal(verdict.available, false, "a purchase form must not render")
  assert.equal(verdict.reason, "abuse_controls_unconfigured")
})

test("an EMPTY or whitespace pepper is treated as missing", () => {
  // A secret set to "" in a dashboard is the commonest way this goes wrong.
  for (const pepper of ["", "   ", "\t\n"]) {
    const verdict = evaluateGiftCardAvailability(
      { ...REVIEWED, ABUSE_SUBJECT_PEPPER: pepper },
      { cryptoConfigured: true }
    )
    assert.equal(verdict.available, false, `pepper ${JSON.stringify(pepper)} was accepted`)
    assert.equal(verdict.reason, "abuse_controls_unconfigured")
  }
})

test("the pepper is the LAST gate, so it never masks another misconfiguration", () => {
  // Ordering matters for the operator: the reason code should name the first
  // thing to fix, and a missing feature flag is more informative than a missing
  // pepper when both are absent.
  const nothing = evaluateGiftCardAvailability({}, { cryptoConfigured: true })
  assert.equal(nothing.reason, "feature_disabled")

  const { ABUSE_SUBJECT_PEPPER: _omitted, ...noPepper } = REVIEWED
  assert.equal(
    evaluateGiftCardAvailability({ ...noPepper, RESEND_API_KEY: "" }, { cryptoConfigured: true }).reason,
    "email_unconfigured",
    "an earlier failure must still be reported first"
  )
})

test("EVERY requirement is individually load-bearing", () => {
  // Removing any one of them must close the gate. This is the check that
  // catches a future requirement being added to the route but not to the gate.
  const required = [
    "STORE_GIFT_CARDS_ENABLED",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "GIFT_CARD_TAX_TREATMENT_REVIEWED",
    "ABUSE_SUBJECT_PEPPER"
  ] as const

  for (const key of required) {
    const env = { ...REVIEWED, [key]: undefined }
    assert.equal(
      evaluateGiftCardAvailability(env, { cryptoConfigured: true }).available,
      false,
      `${key} is not enforced by the gate`
    )
  }

  // And the complete set really does open it, so the test above is not passing
  // because everything is broken.
  assert.equal(evaluateGiftCardAvailability(REVIEWED, { cryptoConfigured: true }).available, true)
})

test("the reason code never leaks WHICH secret is missing to a customer", () => {
  // The code goes to a server log. GIFT_CARD_UNAVAILABLE is what a customer
  // sees, and it must stay uniform across every cause.
  const causes = [
    {},
    { ...REVIEWED, ABUSE_SUBJECT_PEPPER: "" },
    { ...REVIEWED, RESEND_API_KEY: "" },
    { ...REVIEWED, GIFT_CARD_TAX_TREATMENT_REVIEWED: "" }
  ]

  for (const env of causes) {
    const verdict = evaluateGiftCardAvailability(env, { cryptoConfigured: true })
    assert.equal(verdict.available, false)
    assert.doesNotMatch(
      GIFT_CARD_UNAVAILABLE.message,
      /pepper|key|resend|tax|abuse|secret|env/i,
      "the customer-facing message names a configuration value"
    )
  }
})

test("the default posture is OFF", () => {
  // No flag at all must not mean enabled.
  const result = evaluateGiftCardAvailability({ RESEND_API_KEY: "x", EMAIL_FROM: "y" }, { cryptoConfigured: true })
  assert.equal(result.available, false)
  assert.equal(result.reason, "feature_disabled")
})

// -- The Stripe request -------------------------------------------------------

const ORDER = {
  orderId: "11111111-2222-4333-8444-555555555555",
  slug: "gift-card-25",
  faceValueCents: 2500,
  buyerEmail: "buyer@example.com",
  publicRefHint: "RFG-ABCDEF0123"
}

function body() {
  return buildGiftCardCheckoutBody(ORDER, "https://realfiction.live")
}

test("the request charges exactly the face value, once, in USD", () => {
  const params = body()
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "2500")
  assert.equal(params.get("line_items[0][price_data][currency]"), "usd")
  assert.equal(params.get("line_items[0][quantity]"), "1")
  assert.equal(params.get("mode"), "payment")
})

test("CARD ONLY — dynamic payment methods are not inherited", () => {
  // BNPL and several other dynamic methods prohibit prepaid stored value in
  // their own terms. Pinning `card` keeps Apple Pay and Google Pay, which
  // Stripe surfaces as wallet presentations of card.
  const params = body()
  assert.equal(params.get("payment_method_types[0]"), "card")
  assert.equal(params.get("payment_method_types[1]"), null)
})

test("no promotion codes, no discounts, no store credit", () => {
  const params = body()
  assert.equal(params.get("allow_promotion_codes"), null)
  assert.equal(params.get("discounts[0][coupon]"), null)
  assert.equal(params.get("discounts[0][promotion_code]"), null)
  for (const key of [...params.keys()]) {
    assert.ok(!/store_credit|discount|coupon|promotion/i.test(key), `unexpected key ${key}`)
  }
})

test("the session is bound to the exact order", () => {
  const params = body()
  assert.equal(params.get("client_reference_id"), ORDER.orderId)
  assert.equal(params.get("metadata[order_id]"), ORDER.orderId)
  assert.equal(params.get("payment_intent_data[metadata][order_id]"), ORDER.orderId)
  assert.equal(params.get("metadata[order_kind]"), "gift_card")
})

test("the verified buyer email is used for the receipt", () => {
  const params = body()
  assert.equal(params.get("customer_email"), ORDER.buyerEmail)
  assert.equal(params.get("payment_intent_data[receipt_email]"), ORDER.buyerEmail)
})

test("the session expiry is bounded and there is no recovery link", () => {
  const params = body()
  const expiresAt = Number(params.get("expires_at"))
  assert.ok(Number.isFinite(expiresAt) && expiresAt > Date.now() / 1000)
  assert.equal(params.get("after_expiration[recovery][enabled]"), null)
})

test("NO personal content reaches Stripe", () => {
  // The recipient's address, the sender's name, and the message are the
  // customer's private content. Stripe has no need for any of it.
  const encoded = body().toString()
  for (const forbidden of ["friend@example.com", "Happy birthday", "Nicholas", "secret", "claim"]) {
    assert.ok(!encoded.includes(forbidden), `Stripe request leaked "${forbidden}"`)
  }
})

test("the gift-card product identity is declared", () => {
  const params = body()
  assert.equal(params.get("line_items[0][price_data][product_data][name]"), "RealFiction Gift Card")
  assert.equal(
    params.get("line_items[0][price_data][product_data][metadata][internal_sku]"),
    "gift_card"
  )
  assert.equal(
    params.get("line_items[0][price_data][product_data][metadata][entitlement]"),
    "store.credit"
  )
})

test("the request builds inline product data, so the Dashboard product's tax category never applies", () => {
  // EVIDENCE, not assumption. Ordinary checkout uses dynamic `price_data` and
  // never references a Stripe Price ID; nothing in the repository stores a
  // Price or Product mapping. This request does the same. That means the
  // existing "RealFiction Gift Card" Product in the Dashboard — and whatever
  // tax category it carries — is NOT what Stripe charges against here.
  const params = body()
  assert.ok(params.get("line_items[0][price_data][product_data][name]"))
  assert.equal(params.get("line_items[0][price"), null)
  assert.equal(params.get("line_items[0][price_data][product]"), null)
})

test("gift-card checkout FAILS CLOSED until the tax treatment is reviewed", () => {
  // The previous version of this file asserted that omitting `automatic_tax`
  // was correct. It was a guess, and locking a guess into a test is worse than
  // having no test: it makes an unreviewed decision look settled.
  //
  // Whether stored value is taxable at sale (versus at redemption) depends on
  // jurisdiction and on account-level Stripe Tax settings that cannot be read
  // from this repository. So availability now requires an explicit reviewed
  // value, and production has no default.
  assert.equal(
    evaluateGiftCardAvailability({ ...FULL_ENV }, { cryptoConfigured: true }).reason,
    "tax_treatment_unreviewed"
  )
  // Varied against an otherwise-COMPLETE env, so this measures the tax value
  // and not some other missing requirement.
  assert.equal(
    evaluateGiftCardAvailability(
      { ...REVIEWED, GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale" },
      { cryptoConfigured: true }
    ).available,
    true
  )
  // An unrecognised value is not an approval.
  assert.equal(
    evaluateGiftCardAvailability(
      { ...REVIEWED, GIFT_CARD_TAX_TREATMENT_REVIEWED: "true" },
      { cryptoConfigured: true }
    ).available,
    false
  )
})
