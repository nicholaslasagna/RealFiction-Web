// Pure queue policy: how a provider response is classified, and what may be
// shown as a receipt link. No network, no DB, no "server-only" — all of it is
// unit-testable, and these are the rules that decide whether a customer's email
// is retried, parked, or dropped.

export const EMAIL_MAX_ATTEMPTS = 8
export const EMAIL_LEASE_SECONDS = 120
export const EMAIL_BATCH_SIZE = 20

export type DeliveryOutcome =
  /** Provider accepted it. Terminal. */
  | { kind: "sent"; providerMessageId: string | null; statusCode: number }
  /** Try again later. */
  | { kind: "retry"; error: string; statusCode: number | null; category: string; retryAfterSeconds: number | null }
  /** Will never succeed — park it. */
  | { kind: "permanent"; error: string; statusCode: number | null; category: string }
  /** No mail binding yet. Not a failure; must not consume the attempt budget. */
  | { kind: "unconfigured" }

/**
 * Classifies a provider HTTP status.
 *
 * 429 and 5xx are transient. Ordinary 4xx (bad address, rejected payload,
 * rejected key) will never succeed on retry, so retrying only delays the point
 * at which a human notices.
 */
export function classifyProviderStatus(status: number): "retry" | "permanent" {
  if (status === 408 || status === 429 || status >= 500) {
    return "retry"
  }
  return "permanent"
}

/** Short, safe diagnostic label. Never derived from a response body. */
export function diagnosticCategory(status: number | null): string {
  if (status === null) return "transport_error"
  if (status === 429) return "rate_limited"
  if (status === 408) return "provider_timeout"
  if (status >= 500) return "provider_error"
  if (status === 401 || status === 403) return "auth_rejected"
  if (status === 422 || status === 400) return "payload_rejected"
  if (status >= 400) return "client_error"
  return "accepted"
}

/**
 * Parses a Retry-After header. Supports both delta-seconds and an HTTP date;
 * returns null for anything unparseable so the caller falls back to its own
 * backoff rather than trusting a malformed value.
 */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return seconds > 0 && seconds <= 86_400 ? seconds : null
  }
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) {
    return null
  }
  const seconds = Math.ceil((date - nowMs) / 1000)
  return seconds > 0 && seconds <= 86_400 ? seconds : null
}

/**
 * Exponential backoff with jitter, mirroring the SQL schedule. Exposed so the
 * policy can be asserted in tests; the database applies the authoritative value.
 */
export function backoffSeconds(attempts: number, random = Math.random): number {
  const base = Math.min(3600, 15 * 2 ** Math.max(0, attempts - 1))
  return Math.ceil(base * (0.75 + random() * 0.5))
}

// -- Receipt URL validation ---------------------------------------------------

/**
 * A receipt link is rendered into a customer email, so it must be provably
 * Stripe-hosted and HTTPS. An attacker-influenced or malformed URL is dropped —
 * the email still ships, just without the link.
 */
const STRIPE_RECEIPT_HOSTS = new Set([
  "pay.stripe.com",
  "invoice.stripe.com",
  "billing.stripe.com"
])

export function isValidStripeReceiptUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:") {
    return false
  }
  const host = url.hostname.toLowerCase()
  return STRIPE_RECEIPT_HOSTS.has(host) || host.endsWith(".stripe.com")
}

export function sanitizeReceiptUrl(value: string | null | undefined): string | null {
  return isValidStripeReceiptUrl(value) ? (value as string) : null
}

// -- Delivery identities ------------------------------------------------------

export function orderConfirmationKey(orderId: string): string {
  return `order_confirmation:${orderId}`
}

/**
 * Keyed on the Stripe REFUND id, not the event id: Stripe emits several events
 * per refund (created, then one or more updated), and all of them must collapse
 * onto exactly one email.
 */
export function refundConfirmationKey(refundId: string): string {
  return `refund_confirmation:${refundId}`
}
