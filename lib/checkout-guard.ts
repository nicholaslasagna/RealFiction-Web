// Pure production checkout guards.
//
// No "server-only" import and no network/DB client, so every rule is unit-testable
// under `node --test`. These are server-side gates: the storefront also hides the
// disabled paths, but hiding a button is not a control — these functions are.

/** Payment providers the *server* will accept, independent of any UI. */
export type CheckoutProvider = "stripe" | "paypal" | "gift_card"

/**
 * Index signature so `process.env` (NodeJS.ProcessEnv) is assignable, matching
 * the pattern in payment-readiness.ts. Never holds or returns a secret value.
 */
type GuardEnv = {
  PAYPAL_ENVIRONMENT?: string
  STORE_GIFT_CARDS_ENABLED?: string
  NODE_ENV?: string
  [key: string]: string | undefined
}

/**
 * PayPal is sandbox-only and must never be reachable in production, even by a
 * direct API call. Kept as a live-environment check rather than a code deletion
 * so sandbox development and historical PayPal records keep working.
 */
export function isPayPalAllowed(env: GuardEnv = process.env): boolean {
  return (env.PAYPAL_ENVIRONMENT ?? "").trim().toLowerCase() === "live"
}

/**
 * Gift cards stay out of live checkout until the ledger/partial-balance/reversal
 * surface passes its own audit. The Stripe products and existing implementation
 * are intentionally left in place.
 */
export function areGiftCardsPurchasable(env: GuardEnv = process.env): boolean {
  return (env.STORE_GIFT_CARDS_ENABLED ?? "").trim().toLowerCase() === "true"
}

/** A slug or category is gift-card-ish. Checked on the server against DB rows. */
export function isGiftCardProduct(product: { slug?: string | null; category?: string | null }): boolean {
  const slug = (product.slug ?? "").toLowerCase()
  const category = (product.category ?? "").toLowerCase()
  return category === "gift_cards" || slug.startsWith("gift-card") || slug.startsWith("gift_card")
}

export type CheckoutRejection = { code: string; status: number; message: string }

/**
 * Server-side provider gate. Returns a rejection or null.
 */
export function rejectDisabledProvider(
  provider: CheckoutProvider,
  env: GuardEnv = process.env
): CheckoutRejection | null {
  if (provider === "paypal" && !isPayPalAllowed(env)) {
    return {
      code: "paypal_disabled",
      status: 400,
      message: "This payment method is not available. Please continue with secure card payment."
    }
  }
  return null
}

/**
 * Server-side gift-card gate over already-resolved (trusted) product rows.
 */
export function rejectDisabledProducts(
  products: ReadonlyArray<{ slug?: string | null; category?: string | null }>,
  env: GuardEnv = process.env
): CheckoutRejection | null {
  if (areGiftCardsPurchasable(env)) {
    return null
  }
  if (products.some(isGiftCardProduct)) {
    return {
      code: "gift_cards_disabled",
      status: 400,
      message: "Gift cards are temporarily unavailable."
    }
  }
  return null
}

/**
 * The SELLABLE catalogue, as opposed to the RESOLVABLE one.
 *
 * These are two different questions and conflating them is a rollout hazard:
 *
 *   "does this product row exist and can we act on it?"  -> products.active
 *   "may a customer start a NEW purchase of it today?"   -> this list
 *
 * Legacy timed SKUs (`realvip-1m`, `realvip-3m`, …) must stay `active` in the
 * database through the deploy overlap, because the previously deployed site is
 * still serving traffic and still resolves them — deactivating them in a
 * migration is what caused an earlier deploy-order outage. But the moment THIS
 * application is live, it must stop selling them, without waiting for anyone to
 * run an UPDATE.
 *
 * Keeping the rows active is also what keeps everything downstream working:
 * outstanding Stripe sessions still fulfil, historical orders still render,
 * refunds and revocations still resolve their products, and receipts still name
 * what was bought. None of those paths consult this list — only new checkouts do.
 *
 * Written out rather than derived from the presentation catalogue on purpose.
 * What the server will SELL is a deliberate list somebody has to edit and review;
 * it must not change as a side effect of someone adjusting a storefront card. A
 * test asserts the two agree, so drift is caught rather than silently shipped.
 */
const PURCHASABLE_SLUGS: ReadonlySet<string> = new Set([
  "realvip-permanent",
  "real-supporter-permanent",
  "username-colors-permanent",
  "particle-vault-permanent",
  "realpets-permanent",
  "cosmetic-atelier-permanent"
])

/** Exposed for tests and diagnostics; never sent to a browser as authority. */
export function isPurchasableSlug(slug: string): boolean {
  return PURCHASABLE_SLUGS.has(slug)
}

/**
 * Server-side purchasable gate over already-resolved (trusted) product rows.
 *
 * Runs BEFORE any order row, checkout attempt, store-credit reservation,
 * upgrade-credit reservation, or Stripe request exists, so a rejection leaves no
 * trace to clean up.
 *
 * The message deliberately does not say "legacy" or name the SKU list — the
 * customer's cart simply contains something we no longer sell.
 */
export function rejectUnsellableProducts(
  products: ReadonlyArray<{ slug?: string | null }>
): CheckoutRejection | null {
  const offending = products.find((product) => !isPurchasableSlug((product.slug ?? "").toLowerCase()))
  if (!offending) {
    return null
  }
  return {
    code: "product_not_sold",
    status: 400,
    message: "That item is no longer sold. Anything you already own is unaffected."
  }
}

// -- Checkout attempt identity ------------------------------------------------

/**
 * Shape of a client-supplied checkout attempt id.
 *
 * The client generates one cryptographically random UUID when the user starts a
 * checkout and reuses it for every retry of that attempt. It is an IDENTITY, not
 * an authorisation: the server binds it to the authenticated account, the
 * canonical server-resolved cart, and the linked Minecraft UUID, and a unique DB
 * constraint enforces one order per (account, attempt).
 *
 * A time bucket was used here previously and was wrong: two clicks either side
 * of a bucket boundary produced two attempt keys, two pending orders, and two
 * payable Stripe sessions — a real double-charge path, not a benign duplicate.
 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidCheckoutAttemptId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value)
}

/**
 * Canonical, order-independent fingerprint of what is being bought and for whom.
 * Built ONLY from server-resolved values (DB product slugs, the account id, the
 * verified Minecraft UUID) so a client cannot reuse an attempt id against a
 * different cart, account, or delivery target.
 */
export function buildCartFingerprint(input: {
  userId: string
  provider: string
  applyStoreCredit: boolean
  isGift: boolean
  giftRecipient?: string | null
  minecraftUuid?: string | null
  items: ReadonlyArray<{ productId: string; quantity: number }>
}): string {
  const items = [...input.items]
    .map((item) => `${item.productId}x${item.quantity}`)
    .sort()
    .join(",")
  const gift = input.isGift ? `gift:${(input.giftRecipient ?? "").trim().toLowerCase()}` : "self"
  return [
    input.userId,
    input.provider,
    input.applyStoreCredit ? "credit" : "nocredit",
    gift,
    `mc:${(input.minecraftUuid ?? "none").toLowerCase()}`,
    items
  ].join("|")
}

// -- Bounded attempt lifetime -------------------------------------------------

/**
 * How long one checkout attempt (and its Stripe session) may live.
 *
 * Bounded on purpose. Stripe prunes idempotency keys once they are roughly 24h
 * old, after which reusing `realfiction-checkout:<order-id>` would create a
 * SECOND payable session rather than replaying the first. The attempt therefore
 * dies well inside that window, together with the Stripe session it owns, so we
 * never depend on a key Stripe may have forgotten.
 *
 * Stripe requires Checkout `expires_at` to be 30 minutes–24 hours out; one hour
 * sits comfortably inside that range.
 */
export const CHECKOUT_ATTEMPT_TTL_SECONDS = 3600

/** Stripe's own bounds for Checkout Session `expires_at`. */
export const STRIPE_SESSION_MIN_TTL_SECONDS = 30 * 60
export const STRIPE_SESSION_MAX_TTL_SECONDS = 24 * 60 * 60

/** Absolute unix seconds for a session created now. Always inside Stripe's range. */
export function stripeSessionExpiresAt(nowMs: number, ttlSeconds = CHECKOUT_ATTEMPT_TTL_SECONDS): number {
  const clamped = Math.min(
    Math.max(ttlSeconds, STRIPE_SESSION_MIN_TTL_SECONDS),
    STRIPE_SESSION_MAX_TTL_SECONDS
  )
  return Math.floor(nowMs / 1000) + clamped
}

/** An attempt is usable only while unclosed AND unexpired. Fails closed on unknown state. */
export function isAttemptActive(
  attempt: { status?: string | null; attemptExpiresAt?: string | null },
  nowMs: number
): boolean {
  if (attempt.status === "closed") {
    return false
  }
  if (!attempt.attemptExpiresAt) {
    // Expiration state cannot be determined -> treat as unusable.
    return false
  }
  const expiry = Date.parse(attempt.attemptExpiresAt)
  return Number.isFinite(expiry) && expiry > nowMs
}

/** A stored Stripe session is only reusable while it too is unexpired. */
export function isSessionReusable(
  session: { id?: string | null; url?: string | null; expiresAt?: string | null },
  nowMs: number
): boolean {
  if (!session.id || !session.url || !session.expiresAt) {
    return false
  }
  const expiry = Date.parse(session.expiresAt)
  return Number.isFinite(expiry) && expiry > nowMs
}

export type AttemptBindingResult =
  | { ok: true }
  | { ok: false; code: "attempt_cart_mismatch"; status: number; message: string }

/**
 * An attempt id may only ever be used with the cart it was first bound to.
 * Reusing it with a modified cart is a client error (or an attack) and must be
 * refused rather than silently creating a second order.
 */
export function checkAttemptBinding(
  storedFingerprint: string | null,
  currentFingerprint: string
): AttemptBindingResult {
  if (storedFingerprint !== null && storedFingerprint !== currentFingerprint) {
    return {
      ok: false,
      code: "attempt_cart_mismatch",
      status: 409,
      message: "Your cart changed. Please refresh the page and start checkout again."
    }
  }
  return { ok: true }
}

// -- Rate limiting -----------------------------------------------------------

export const CHECKOUT_RATE_LIMIT = { maxAttempts: 10, windowSeconds: 300 } as const

export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number }

/**
 * Pure decision from a durable attempt count. Counting lives in Postgres (see
 * `count_recent_checkout_attempts`) because Workers isolates are per-request and
 * process-local memory would not survive — or be shared — between them.
 */
export function evaluateRateLimit(
  recentAttempts: number,
  limit: { maxAttempts: number; windowSeconds: number } = CHECKOUT_RATE_LIMIT
): RateLimitDecision {
  if (recentAttempts >= limit.maxAttempts) {
    return { allowed: false, retryAfterSeconds: limit.windowSeconds }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

// -- Verified buyer email -----------------------------------------------------

/**
 * Normalises an address for storage/comparison. Lowercases the whole thing:
 * the local part is technically case-sensitive per RFC 5321, but no real
 * mailbox provider treats it that way, and consistent storage matters more.
 */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

export function isValidEmailAddress(value: string): boolean {
  // Deliberately conservative: one @, no whitespace, a dotted domain, and a
  // length bound. Verification is what actually proves the mailbox exists.
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

export type BuyerEmailCheck =
  | { ok: true; email: string }
  | { ok: false; code: "email_missing" | "email_invalid" | "email_unverified"; status: number; message: string }

/**
 * A purchase must be tied to a mailbox the buyer has proven they control.
 *
 * Without this, a receipt (and any later refund/gift mail) could be directed at
 * an address the account holder never confirmed. Runs BEFORE any order, credit
 * reservation, or Stripe Session is created.
 */
export function requireVerifiedBuyerEmail(user: {
  email?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
}): BuyerEmailCheck {
  const email = normalizeEmail(user.email)

  if (!email) {
    return {
      ok: false,
      code: "email_missing",
      status: 403,
      message: "Add an email address to your account before checking out."
    }
  }

  if (!isValidEmailAddress(email)) {
    return {
      ok: false,
      code: "email_invalid",
      status: 403,
      message: "Your account email doesn't look valid. Please update it before checking out."
    }
  }

  // Supabase sets email_confirmed_at on verification; confirmed_at is the older
  // alias. Either proves control of the mailbox.
  const verifiedAt = user.email_confirmed_at ?? user.confirmed_at ?? null
  if (!verifiedAt) {
    return {
      ok: false,
      code: "email_unverified",
      status: 403,
      message: "Please verify your email address before checking out. Check your inbox for the confirmation link."
    }
  }

  return { ok: true, email }
}
