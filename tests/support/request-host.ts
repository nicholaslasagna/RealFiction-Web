// Which host a test's fake `fetch` was called with.
//
// TEST-ONLY. Nothing in the application imports this; it exists so the fetch
// stubs across the suite decide "is this Stripe?" the same way, and the right
// way.
//
// WHY NOT `url.includes("api.stripe.com")`
// ========================================
// Every one of these is a substring match, and none of them is Stripe:
//
//   https://evil.example/api.stripe.com        -> a PATH on someone else's host
//   https://api.stripe.com.evil.example        -> a SUBDOMAIN of an attacker
//   https://evil-api.stripe.com                -> a different host entirely
//   https://user@api.stripe.com.evil.example   -> userinfo, not authority
//
// `startsWith` and `endsWith` are the same mistake wearing a different hat:
// `startsWith("https://api.stripe.com")` still admits
// `https://api.stripe.com.evil.example`, and `endsWith("api.stripe.com")`
// still admits `https://evil-api.stripe.com`.
//
// In a TEST the consequence is subtler than in production but real: a stub that
// matches too loosely will happily record an outbound call to an unintended
// host as if it were the expected one, and an assertion like "Stripe received
// exactly 2500" then passes against a request that never went to Stripe. The
// test would be lying in exactly the direction that hides an SSRF-shaped bug.
//
// So: parse, and compare the hostname for equality. `URL` does the authority
// parsing, which is the part that is genuinely hard to get right by hand.

/** Hosts the suite knows about. Exact hostnames, never patterns. */
export const STRIPE_API_HOST = "api.stripe.com"
export const RESEND_API_HOST = "api.resend.com"

/**
 * The hostname of `input`, lowercased, or null when it is not a parsable
 * absolute URL.
 *
 * Fails CLOSED: an unparsable value has no host, so it matches nothing.
 */
export function requestHost(input: unknown): string | null {
  try {
    // `URL` requires an absolute URL; a relative one throws, which is the
    // answer we want anyway.
    return new URL(String(input)).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * True only when `input` is a URL whose host IS `host`.
 *
 * Equality, not containment. A subdomain does not match its parent: this is
 * used to identify a specific API endpoint, and `evil.api.stripe.com` is not
 * one even though it is genuinely under the domain.
 */
export function isRequestTo(input: unknown, host: string): boolean {
  return requestHost(input) === host.toLowerCase()
}

export const isStripeRequest = (input: unknown) => isRequestTo(input, STRIPE_API_HOST)
export const isResendRequest = (input: unknown) => isRequestTo(input, RESEND_API_HOST)
