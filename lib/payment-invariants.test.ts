// Repo-level payment invariants.
//
// These assert facts about the source tree itself — the class of mistake that
// unit tests on a module can't catch: a second webhook route appearing, the
// success page learning how to fulfil, or docs telling an operator to configure
// the wrong endpoint (which is exactly how the production destination ended up
// pointed at a 404).
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === ".open-next") {
      continue
    }
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const CANONICAL_WEBHOOK_PATH = "/api/webhooks/stripe"

test("there is exactly one Stripe webhook route", () => {
  const routes = walk(path.join(repoRoot, "app", "api"))
    .filter((file) => file.endsWith("route.ts"))
    .filter((file) => file.toLowerCase().includes("stripe"))
    .map((file) => path.relative(repoRoot, file))

  assert.deepEqual(routes, [path.join("app", "api", "webhooks", "stripe", "route.ts")])
})

test("docs never instruct the wrong webhook path", () => {
  const docs = walk(path.join(repoRoot, "docs")).filter((file) => file.endsWith(".md"))
  for (const file of docs) {
    const contents = readFileSync(file, "utf8")
    const label = path.relative(repoRoot, file)

    // The copy-paste failure mode: a full URL an operator would paste into the
    // Stripe dashboard. This is what actually pointed production at a 404.
    assert.doesNotMatch(
      contents,
      /realfiction\.live\/api\/stripe\/webhook/,
      `${label} documents a webhook URL that does not exist`
    )

    // Config values live in fenced blocks; prose may discuss the wrong path
    // (e.g. to explain that no such alias exists).
    const fenced = contents.match(/```[\s\S]*?```/g) ?? []
    for (const block of fenced) {
      assert.doesNotMatch(
        block,
        /\/api\/stripe\/webhook/,
        `${label} has a code block naming a webhook path that does not exist`
      )
    }
  }
})

test("docs document the canonical webhook path and all nine production events", () => {
  const setup = readFileSync(path.join(repoRoot, "docs", "STRIPE_SETUP.md"), "utf8")
  assert.match(setup, new RegExp(CANONICAL_WEBHOOK_PATH.replace(/\//g, "\\/")))

  for (const event of [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.dispute.created",
    "charge.dispute.closed"
  ]) {
    assert.match(setup, new RegExp(event.replace(/\./g, "\\.")), `STRIPE_SETUP.md must document ${event}`)
  }
})

test("only webhook/capture routes can fulfil an order — never a page or success route", () => {
  const fulfillers = walk(path.join(repoRoot, "app"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => {
      const contents = readFileSync(file, "utf8")
      return /fulfillPaidOrderWithOutbox|fulfill_paid_order|revoke_order|revokeOrderWithRefundOutbox|completeStoreCreditOnlyOrder/.test(contents)
    })
    .map((file) => path.relative(repoRoot, file))
    .sort()

  assert.deepEqual(fulfillers, [
    path.join("app", "api", "store", "checkout", "route.ts"),
    path.join("app", "api", "store", "paypal", "capture", "route.ts"),
    path.join("app", "api", "webhooks", "paypal", "route.ts"),
    path.join("app", "api", "webhooks", "stripe", "route.ts")
  ])

  // Any page under app/ (the success page lives at /account) must never fulfil.
  const pages = walk(path.join(repoRoot, "app")).filter((file) => path.basename(file) === "page.tsx")
  for (const file of pages) {
    const contents = readFileSync(file, "utf8")
    assert.doesNotMatch(
      contents,
      /fulfillPaidOrderWithOutbox|fulfill_paid_order|revoke_order/,
      `${path.relative(repoRoot, file)} must never grant or revoke entitlements`
    )
  }
})

test("the production storefront offers no PayPal button", () => {
  const storefront = readFileSync(path.join(repoRoot, "components", "storefront.tsx"), "utf8")
  assert.doesNotMatch(storefront, /checkout\("paypal"\)/)
  assert.doesNotMatch(storefront, /Pay with PayPal/i)
  assert.doesNotMatch(storefront, /payments\/paypal\.svg/)
})

test("the Stripe checkout request pins a version and an idempotency key", () => {
  const payments = readFileSync(path.join(repoRoot, "lib", "payments.ts"), "utf8")
  assert.match(payments, /"Idempotency-Key": `realfiction-checkout:\$\{order\.id\}`/)
  assert.match(payments, /"Stripe-Version": STRIPE_API_VERSION/)
  assert.match(payments, /STRIPE_API_VERSION = "2026-04-22\.dahlia"/)
})

test("the webhook enforces livemode before doing any work", () => {
  const route = readFileSync(path.join(repoRoot, "app", "api", "webhooks", "stripe", "route.ts"), "utf8")
  const livemodeIndex = route.indexOf("checkLivemode")
  const persistIndex = route.indexOf("persistWebhookEvent")
  assert.ok(livemodeIndex > 0, "webhook must check livemode")
  assert.ok(persistIndex > livemodeIndex, "livemode must be checked before any order work")

  // The signature must still be verified against the raw body, before parsing.
  const rawBodyIndex = route.indexOf("await request.text()")
  const parseIndex = route.indexOf("JSON.parse(payload)")
  assert.ok(rawBodyIndex > 0 && parseIndex > rawBodyIndex)
})

test("Stripe Checkout Sessions are created with an explicit bounded expiry", () => {
  const payments = readFileSync(path.join(repoRoot, "lib", "payments.ts"), "utf8")
  assert.match(payments, /body\.set\("expires_at", String\(stripeSessionExpiresAt\(Date\.now\(\)\)\)\)/)
})

test("Stripe after_expiration recovery is never enabled", () => {
  // A recovery URL is a SECOND payable link, created outside our attempt lock.
  // Only actual parameter-setting is forbidden; the comment explaining why we
  // avoid it is expected to mention the field by name.
  const payments = readFileSync(path.join(repoRoot, "lib", "payments.ts"), "utf8")
  const settings = payments.match(/body\.set\([^)]*\)/g) ?? []
  for (const setting of settings) {
    assert.doesNotMatch(setting, /after_expiration/, `must not set ${setting}`)
  }
})

test("no code path claims idempotency across unbounded elapsed time", () => {
  // The old, wrong claim. Stripe prunes idempotency keys at ~24h, so any
  // "forever" wording here would be a false guarantee.
  for (const file of ["lib/checkout-guard.ts", "lib/payments.ts", "docs/STRIPE_SETUP.md"]) {
    const contents = readFileSync(path.join(repoRoot, file), "utf8")
    assert.doesNotMatch(contents, /any amount of elapsed time/i, `${file} must not claim unbounded idempotency`)
  }
})

test("the storefront persists the attempt id without personal data", () => {
  const storefront = readFileSync(path.join(repoRoot, "components", "storefront.tsx"), "utf8")
  assert.match(storefront, /sessionStorage/)
  // Only a random UUID + cart shape may be stored — never identity or contact data.
  assert.doesNotMatch(storefront, /sessionStorage\.setItem\([^)]*(email|username|uuid|linkedUsername)/i)
})
