// The gift-card emails, driven through the REAL queue processor.
//
// Templates have been unit-tested as strings for several passes. What had never
// run is the path that matters: the processor claiming a row, looking up the
// credential, DECRYPTING the sealed claim secret, rendering, and handing the
// result to a transport. That is where a secret could leak into a provider
// payload, a delivery record, or a log line, and none of it was exercised.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createClaimCredential } = await import("./gift-card/crypto.ts")

/** Test-only key material. Obviously fake, never a real key. */
const KEY = "0".repeat(64)
const OTHER_KEY = "1".repeat(64)

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  RESEND_API_KEY: "resend-value",
  EMAIL_FROM: "RealFiction <orders@realfiction.live>",
  NEXT_PUBLIC_SITE_URL: "https://realfiction.live",
  GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY: KEY,
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1"
}

type Row = {
  id: string
  idempotency_key: string
  template: string
  recipient: string
  order_id: string | null
  params: Record<string, unknown> | null
  attempts: number
}

const db = {
  queue: [] as Row[],
  credentialCiphertext: null as string | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  sent: [] as { to: string; subject: string; text: string; html: string }[],
  logs: [] as string[]
}

let currentClient: unknown = null

mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient }
})

function fakeClient() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args })
      if (fn === "claim_due_email_deliveries") {
        return { data: db.queue, error: null }
      }
      return { data: null, error: null }
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                table === "gift_card_claim_credentials"
                  ? db.credentialCiphertext
                    ? { delivery_ciphertext: db.credentialCiphertext }
                    : null
                  : null
            })
          }),
          maybeSingle: async () => ({ data: null })
        })
      })
    })
  }
}

const { processEmailQueue } = await import("./email/processor.ts")

function fakeTransport(ok = true) {
  return (async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes("api.resend.com")) {
      throw new Error("unexpected host")
    }
    const body = JSON.parse(String(init?.body)) as {
      to: string[] | string
      subject: string
      text: string
      html: string
    }
    db.sent.push({
      to: Array.isArray(body.to) ? body.to[0] : body.to,
      subject: body.subject,
      text: body.text,
      html: body.html
    })
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => (ok ? { id: "resend-msg-1" } : { message: "nope" }),
      text: async () => (ok ? "{}" : "error")
    }
  }) as never as typeof fetch
}

async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string }> {
  const lines: string[] = []
  const original = { info: console.info, warn: console.warn, error: console.error }
  for (const level of ["info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    }
  }
  try {
    return { value: await fn(), logs: lines.join("\n") }
  } finally {
    Object.assign(console, original)
  }
}

function reset() {
  db.queue = []
  db.credentialCiphertext = null
  db.rpcCalls = []
  db.sent = []
  db.logs = []
  currentClient = fakeClient()
}

function row(overrides: Partial<Row>): Row {
  return {
    id: `delivery-${Math.random().toString(36).slice(2)}`,
    idempotency_key: "key-1",
    template: "gift_card_purchase",
    recipient: "buyer@example.com",
    order_id: "order-1",
    params: {},
    attempts: 0,
    ...overrides
  }
}

// ===========================================================================
// Purchaser confirmation
// ===========================================================================

test("the processor renders and SENDS the purchaser confirmation", async () => {
  reset()
  db.queue = [
    row({
      template: "gift_card_purchase",
      recipient: "buyer@example.com",
      params: {
        amount_cents: 2500,
        currency: "USD",
        recipient_email: "friend@example.com",
        sender_name: "Nicholas",
        public_ref: "RFG-ABCDEF0123"
      }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.claimed, 1)
  assert.equal(result.sent, 1)
  assert.equal(db.sent.length, 1)
  assert.equal(db.sent[0].to, "buyer@example.com")
  assert.match(db.sent[0].text, /\$25\.00/)
  assert.match(db.sent[0].text, /RFG-ABCDEF0123/)
  assert.match(db.sent[0].text, /f\*\*\*@example\.com/, "the recipient address is masked")
  assert.match(db.sent[0].text, /support@realfiction\.live/)
})

test("the purchaser confirmation carries NO claim secret, verifier, or ciphertext", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_purchase",
      params: { amount_cents: 2500, currency: "USD", recipient_email: "friend@example.com", sender_name: "N" }
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  const body = `${db.sent[0].subject}\n${db.sent[0].text}\n${db.sent[0].html}`
  assert.ok(!body.includes(credential.secret), "the purchaser email leaked the claim secret")
  assert.ok(!body.includes(credential.verifier))
  assert.ok(!body.includes(credential.sealed.ciphertext))
  assert.doesNotMatch(body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
})

// ===========================================================================
// Recipient delivery — the decryption boundary
// ===========================================================================

test("the processor DECRYPTS the sealed secret and builds one fragment claim URL", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      recipient: "friend@example.com",
      params: {
        gift_card_id: "card-1",
        amount_cents: 2500,
        currency: "USD",
        sender_name: "Nicholas",
        message: "Happy birthday!"
      }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 1)
  const expectedUrl = `https://realfiction.live/gift-cards/claim#${credential.secret}`
  assert.ok(db.sent[0].text.includes(expectedUrl), "the delivery must carry the real claim link")
  assert.equal(db.sent[0].text.split(expectedUrl).length - 1, 1, "exactly one claim URL")
  assert.ok(db.sent[0].html.includes(expectedUrl))
})

test("the claim secret is in the FRAGMENT, never a query string", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })
  const body = `${db.sent[0].text}\n${db.sent[0].html}`

  assert.ok(body.includes(`claim#${credential.secret}`), "fragment form")
  assert.ok(!body.includes(`claim?`), "no query string on the claim URL")
  assert.ok(!body.includes(`secret=${credential.secret}`))
  assert.ok(!body.includes(`token=${credential.secret}`))
})

test("the decrypted secret is NEVER written back to the outbox or the delivery record", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  // Every argument the processor sent to the database, after decrypting.
  const persisted = JSON.stringify(db.rpcCalls)
  assert.ok(!persisted.includes(credential.secret), "a database call carried the plaintext secret")
  assert.ok(!persisted.includes(credential.sealed.ciphertext))
  // And the queue row itself was never mutated to hold it.
  assert.ok(!JSON.stringify(db.queue).includes(credential.secret))
})

test("NO LOG LINE contains the secret, the ciphertext, or the key", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  const { logs } = await withCapturedLogs(() => processEmailQueue(ENV, { fetchImpl: fakeTransport() }))

  assert.ok(!logs.includes(credential.secret), "a log line carried the claim secret")
  assert.ok(!logs.includes(credential.sealed.ciphertext))
  assert.ok(!logs.includes(KEY))
})

test("user content is escaped in the rendered HTML", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  db.credentialCiphertext = credential.sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: {
        gift_card_id: "card-1",
        amount_cents: 2500,
        currency: "USD",
        sender_name: "<img src=x onerror=alert(1)>",
        message: "<script>steal()</script>"
      }
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.ok(!db.sent[0].html.includes("<img src=x"))
  assert.ok(!db.sent[0].html.includes("<script>"))
  assert.match(db.sent[0].html, /&lt;/)
})

// ===========================================================================
// Claim confirmation
// ===========================================================================

test("the claim confirmation renders the amount and the resulting balance", async () => {
  reset()
  db.queue = [
    row({
      template: "gift_card_claimed",
      recipient: "friend@example.com",
      order_id: null,
      params: { amount_cents: 2500, balance_cents: 3800, currency: "USD" }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 1)
  assert.match(db.sent[0].text, /\$25\.00/)
  assert.match(db.sent[0].text, /\$38\.00/)
  assert.match(db.sent[0].text, /\/store/)
  assert.match(db.sent[0].text, /\/account/)
})

// ===========================================================================
// Failure isolation
// ===========================================================================

test("a MISSING encryption key leaves the delivery RETRYABLE, not parked", async () => {
  reset()
  db.credentialCiphertext = (await createClaimCredential(ENV)).sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  await processEmailQueue(
    { ...ENV, GIFT_CARD_ENCRYPTION_KEY: "" },
    { fetchImpl: fakeTransport() }
  )

  assert.equal(db.sent.length, 0, "nothing may be sent without the key")
  // The processor must not mark this permanently failed: an operator can add
  // the binding and the queued gift card should still arrive.
  const failed = db.rpcCalls.find((c) => c.fn === "mark_email_failed")
  assert.ok(!failed || failed.args.p_retryable !== false, "a config problem must stay retryable")
})

test("the WRONG key fails without sending anything", async () => {
  reset()
  db.credentialCiphertext = (await createClaimCredential(ENV)).sealed.ciphertext
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  await processEmailQueue({ ...ENV, GIFT_CARD_ENCRYPTION_KEY: OTHER_KEY }, { fetchImpl: fakeTransport() })
  assert.equal(db.sent.length, 0, "a link we cannot build must not be emailed")
})

test("TAMPERED ciphertext fails safely, sending nothing", async () => {
  reset()
  const credential = await createClaimCredential(ENV)
  const [version, iv, cipher] = credential.sealed.ciphertext.split(".")
  // Mutate a MIDDLE character, not the last one. The final base64url character
  // of a group carries fewer significant bits, so flipping it can decode to
  // identical bytes — a "tampered" value that is not tampered at all, which
  // made this test intermittently pass a valid ciphertext.
  const at = Math.floor(cipher.length / 2)
  const swapped = cipher[at] === "A" ? "B" : "A"
  db.credentialCiphertext = `${version}.${iv}.${cipher.slice(0, at)}${swapped}${cipher.slice(at + 1)}`
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })
  assert.equal(db.sent.length, 0)
})

test("a card with NO active credential is parked, not retried forever", async () => {
  reset()
  db.credentialCiphertext = null
  db.queue = [
    row({
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(db.sent.length, 0)
  assert.equal(result.parked, 1, "a rotated-away card can never be delivered on this row")
})

test("ONE BROKEN gift-card email does not block unrelated messages", async () => {
  reset()
  db.credentialCiphertext = null // breaks the delivery row only
  db.queue = [
    row({
      id: "broken",
      template: "gift_card_delivery",
      params: { gift_card_id: "card-1", amount_cents: 2500, currency: "USD", sender_name: "N", message: "" }
    }),
    row({
      id: "healthy",
      template: "gift_card_claimed",
      recipient: "friend@example.com",
      order_id: null,
      params: { amount_cents: 500, balance_cents: 500, currency: "USD" }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.claimed, 2)
  assert.equal(result.sent, 1, "the healthy message still went out")
  assert.equal(db.sent[0].to, "friend@example.com")
  assert.match(db.sent[0].text, /\$5\.00/)
})

test("an existing non-gift-card template still processes unchanged", async () => {
  reset()
  db.queue = [
    row({
      template: "refund_confirmation",
      recipient: "buyer@example.com",
      order_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      params: { refundedCents: 1299, currency: "USD", isFullRefund: true, entitlementStatus: "revoked" }
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })
  assert.equal(result.sent, 1, "gift cards must not have changed ordinary email processing")
  assert.match(db.sent[0].text, /\$12\.99/)
})

test("the deterministic idempotency key is sent to the provider on every attempt", async () => {
  reset()
  db.queue = [
    row({
      idempotency_key: "gift_card_claimed:card-1",
      template: "gift_card_claimed",
      order_id: null,
      params: { amount_cents: 500, balance_cents: 500, currency: "USD" }
    })
  ]

  const seenKeys: string[] = []
  const capturing = (async (url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    seenKeys.push(String(headers.get("Idempotency-Key")))
    return { ok: true, status: 200, json: async () => ({ id: "m1" }), text: async () => "{}" }
  }) as never as typeof fetch

  await processEmailQueue(ENV, { fetchImpl: capturing })
  assert.deepEqual(seenKeys, ["gift_card_claimed:card-1"], "duplicate suppression depends on this key")
})

// ===========================================================================
// Refunds and disputes
//
// Rendered through the real processor, because that is where a template name
// typo becomes a delivery that is silently never sent — and where a param the
// purchaser must not see would actually reach a mailbox.
// ===========================================================================

const refundRow = (template: string, recipient: string, params: Record<string, unknown>) =>
  row({ template, recipient, order_id: null, params })

test("the purchaser's REFUNDED email quotes the refunded amount and the reference", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_refunded", "buyer@example.com", {
      amount_cents: 2500,
      currency: "USD",
      public_ref: "RFG-ABCDEF0123"
    })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 1)
  assert.equal(db.sent[0].to, "buyer@example.com")
  assert.match(db.sent[0].subject, /refunded/i)
  assert.match(db.sent[0].text, /\$25\.00/)
  assert.match(db.sent[0].text, /RFG-ABCDEF0123/)
  assert.match(db.sent[0].text, /original payment method/i)
})

test("the purchaser's REVIEW email says nothing about what the recipient did", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_refund_review", "buyer@example.com", {
      amount_cents: 2500,
      currency: "USD",
      public_ref: "RFG-ABCDEF0123"
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  const body = `${db.sent[0].subject}\n${db.sent[0].text}\n${db.sent[0].html}`
  for (const leak of [/spent/i, /claimed/i, /balance/i, /redeem/i, /recipient/i, /friend@/i]) {
    assert.doesNotMatch(body, leak, `the review email leaked ${leak}`)
  }
  assert.match(body, /review/i)
})

test("the recipient's REFUNDED email states the removal and the new balance", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_refunded_recipient", "friend@example.com", {
      amount_cents: 1201,
      currency: "USD",
      balance_cents: 0
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(db.sent[0].to, "friend@example.com")
  assert.match(db.sent[0].text, /\$12\.01/)
  assert.match(db.sent[0].text, /\$0\.00/)
  // Their ranks are not clawed back, and saying so prevents a support ticket.
  assert.match(db.sent[0].text, /already bought is affected/i)
})

test("the recipient's FROZEN email never says 'dispute' or 'chargeback'", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_frozen_recipient", "friend@example.com", {
      amount_cents: 2500,
      currency: "USD",
      balance_cents: 2500
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  const body = `${db.sent[0].subject}\n${db.sent[0].text}\n${db.sent[0].html}`
  // A chargeback is an accusation against the SENDER. The recipient is not the
  // one being asked about it, and repeating it to them is both a leak and, more
  // often than not, wrong.
  for (const leak of [/dispute/i, /chargeback/i, /fraud/i, /stolen/i, /purchaser/i, /buyer@/i]) {
    assert.doesNotMatch(body, leak, `the freeze email leaked ${leak}`)
  }
  assert.match(body, /on hold/i)
  assert.match(body, /\$25\.00/)
})

test("the recipient's RESTORED email says the hold is gone", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_restored_recipient", "friend@example.com", {
      amount_cents: 2500,
      currency: "USD",
      balance_cents: 4000
    })
  ]

  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.match(db.sent[0].subject, /available again/i)
  assert.match(db.sent[0].text, /\$40\.00/)
  assert.doesNotMatch(db.sent[0].text, /dispute|chargeback/i)
})

test("NO refund or dispute email carries a claim link", async () => {
  reset()
  // If any of these ever rendered a claim URL, the credential would be handed
  // to whoever received the mail AFTER the card was voided or frozen.
  db.queue = [
    refundRow("gift_card_refunded", "buyer@example.com", { amount_cents: 2500, currency: "USD", public_ref: "RFG-1" }),
    refundRow("gift_card_refund_review", "buyer@example.com", { amount_cents: 2500, currency: "USD", public_ref: "RFG-1" }),
    refundRow("gift_card_refunded_recipient", "f@example.com", { amount_cents: 2500, currency: "USD", balance_cents: 0 }),
    refundRow("gift_card_frozen_recipient", "f@example.com", { amount_cents: 2500, currency: "USD", balance_cents: 0 }),
    refundRow("gift_card_restored_recipient", "f@example.com", { amount_cents: 2500, currency: "USD", balance_cents: 0 })
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 5, "all five templates render")
  for (const mail of db.sent) {
    assert.doesNotMatch(`${mail.text}${mail.html}`, /gift-cards\/claim|#[A-Za-z0-9_-]{40,}/, "a claim link appeared")
  }
})

test("all five survive a missing currency and a missing amount without throwing", async () => {
  reset()
  db.queue = [
    refundRow("gift_card_refunded", "b@example.com", {}),
    refundRow("gift_card_refund_review", "b@example.com", {}),
    refundRow("gift_card_refunded_recipient", "f@example.com", {}),
    refundRow("gift_card_frozen_recipient", "f@example.com", {}),
    refundRow("gift_card_restored_recipient", "f@example.com", {})
  ]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 5)
  for (const mail of db.sent) {
    assert.match(mail.text, /\$0\.00/)
    assert.doesNotMatch(mail.text, /NaN|undefined|null/)
  }
})

// ===========================================================================
// Cash-redemption review
//
// These render from NO params at all. That is the safety property: a queue row
// physically cannot carry an amount into an email about a possible payout.
// ===========================================================================

const cashRow = (template: string) =>
  row({ template, recipient: "claimant@example.com", order_id: null, params: {} })

test("the REQUEST RECEIVED email confirms receipt and promises nothing", async () => {
  reset()
  db.queue = [cashRow("cash_redemption_received")]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 1)
  assert.equal(db.sent[0].to, "claimant@example.com")
  assert.match(db.sent[0].text, /received your cash-redemption request/i)
  assert.match(db.sent[0].text, /does not guarantee a payout/i)
  assert.match(db.sent[0].text, /held/i, "and explains why the balance will not spend")
})

test("NO cash-redemption email carries an amount, a date, or a legal reason", async () => {
  for (const template of [
    "cash_redemption_received",
    "cash_redemption_closed",
    "cash_redemption_completed"
  ]) {
    reset()
    db.queue = [cashRow(template)]
    await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

    const body = `${db.sent[0].subject} ${db.sent[0].text}`
    assert.doesNotMatch(body, /\$\d/, `${template} quoted an amount`)
    assert.doesNotMatch(body, /within \d|business days|\d+ weeks/i, `${template} promised a timeframe`)
    assert.doesNotMatch(
      body,
      /state law|jurisdiction|threshold|promotional|because your/i,
      `${template} published the legal reasoning`
    )
  }
})

test("the CLOSED email says the credit is untouched, without saying why", async () => {
  reset()
  db.queue = [cashRow("cash_redemption_closed")]
  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.match(db.sent[0].text, /not able to redeem this balance for cash/i)
  assert.match(db.sent[0].text, /store credit is unchanged/i)
  // A person, not a form letter, explains a compliance determination.
  assert.match(db.sent[0].text, /reply to this email/i)
})

test("the COMPLETED email records a payout made elsewhere, with no payment details", async () => {
  reset()
  db.queue = [cashRow("cash_redemption_completed")]
  await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.match(db.sent[0].text, /has been completed/i)
  assert.match(db.sent[0].text, /paid out separately/i)
  assert.doesNotMatch(db.sent[0].text, /bank|account number|routing|card ending|transfer id/i)
})

test("an unknown cash-redemption template is parked, not sent blank", async () => {
  reset()
  db.queue = [cashRow("cash_redemption_invented")]

  const result = await processEmailQueue(ENV, { fetchImpl: fakeTransport() })

  assert.equal(result.sent, 0)
  assert.equal(db.sent.length, 0)
})
