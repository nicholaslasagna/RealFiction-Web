// Zero-dependency unit tests for payment readiness.
//
// Run with:  npm test   (which is: node --test lib/payment-readiness.test.ts)
//
// These assert the core fix: Stripe checkout can be READY even when PayPal is
// not configured, and the readiness snapshot never contains secret values.

import assert from "node:assert/strict"
import { test } from "node:test"

import { isPayPalConfigured, isStripeConfigured, paymentReadiness } from "./payment-readiness.ts"

test("Stripe is ready when only STRIPE_SECRET_KEY is set (PayPal absent)", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_example" }
  assert.equal(isStripeConfigured(env), true)
  assert.equal(isPayPalConfigured(env), false)
})

test("missing PayPal config never disables Stripe", () => {
  // Mirrors the live Cloudflare env: Stripe secret set, PAYPAL_ENVIRONMENT only.
  const env = { STRIPE_SECRET_KEY: "sk_live_example", PAYPAL_ENVIRONMENT: "sandbox" }
  const readiness = paymentReadiness(env)
  assert.equal(readiness.stripe, true)
  assert.equal(readiness.paypal, false)
})

test("PayPal requires BOTH client id and secret", () => {
  assert.equal(isPayPalConfigured({ PAYPAL_CLIENT_ID: "id-only" }), false)
  assert.equal(isPayPalConfigured({ PAYPAL_CLIENT_SECRET: "secret-only" }), false)
  assert.equal(isPayPalConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }), true)
})

test("Stripe readiness is independent of PayPal in both directions", () => {
  assert.equal(isStripeConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }), false)
  assert.equal(
    isStripeConfigured({ STRIPE_SECRET_KEY: "sk", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }),
    true
  )
})

test("nothing configured -> both providers not ready", () => {
  const readiness = paymentReadiness({})
  assert.equal(readiness.stripe, false)
  assert.equal(readiness.paypal, false)
})

test("readiness snapshot is booleans only and never leaks secret values", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_super_secret_value",
    PAYPAL_CLIENT_ID: "paypal-client-id",
    PAYPAL_CLIENT_SECRET: "paypal-client-secret",
    NEXT_PUBLIC_SITE_URL: "https://realfiction.live",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value"
  }
  const readiness = paymentReadiness(env)

  for (const value of Object.values(readiness)) {
    assert.equal(typeof value, "boolean")
  }
  assert.deepEqual(readiness, {
    stripe: true,
    paypal: true,
    hasSiteUrl: true,
    hasSupabaseUrl: true,
    hasServiceRole: true
  })

  const serialized = JSON.stringify(readiness)
  assert.equal(serialized.includes("sk_super_secret_value"), false)
  assert.equal(serialized.includes("service-role-secret-value"), false)
  assert.equal(serialized.includes("paypal-client-secret"), false)
})
