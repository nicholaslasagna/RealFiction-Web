// Pure payment-provider readiness checks.
//
// This module intentionally does NOT import "server-only" so it can be unit
// tested directly under `node --test`. It never reads, returns, or logs secret
// VALUES — only booleans describing whether each provider's env is present.
//
// Stripe readiness is fully independent of PayPal: a missing PayPal config can
// never disable Stripe checkout (and vice versa).

type ReadinessEnv = {
  STRIPE_SECRET_KEY?: string
  PAYPAL_CLIENT_ID?: string
  PAYPAL_CLIENT_SECRET?: string
  NEXT_PUBLIC_SITE_URL?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  // Index signature so `process.env` (NodeJS.ProcessEnv) is assignable.
  [key: string]: string | undefined
}

export function isStripeConfigured(env: ReadinessEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY)
}

export function isPayPalConfigured(env: ReadinessEnv = process.env): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET)
}

export type PaymentReadiness = {
  stripe: boolean
  paypal: boolean
  hasSiteUrl: boolean
  hasSupabaseUrl: boolean
  hasServiceRole: boolean
}

/**
 * Boolean-only snapshot of payment/checkout readiness, safe to log.
 *
 * Contains presence flags only — never any secret value. Use this to confirm,
 * from server logs, that Stripe is ready even when PayPal is not configured,
 * and that the Supabase service-role / site URL needed by the checkout flow are
 * present at request time.
 */
export function paymentReadiness(env: ReadinessEnv = process.env): PaymentReadiness {
  return {
    stripe: isStripeConfigured(env),
    paypal: isPayPalConfigured(env),
    hasSiteUrl: Boolean(env.NEXT_PUBLIC_SITE_URL),
    hasSupabaseUrl: Boolean(env.SUPABASE_URL),
    hasServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
  }
}
