// Everything the server decides about a gift-card purchase, before any state
// exists. Pure: no "server-only", no DB, no network, so every rule is testable.
//
// Gift cards are deliberately NOT routed through ordinary product checkout.
// A gift card is stored value, and stored value has rules ordinary products do
// not: it cannot be bought with store credit, it cannot be bought with another
// gift card, it cannot share a cart, it cannot be gifted to a Minecraft
// username, and it must not be purchasable by a payment method that prohibits
// prepaid stored value.

export const GIFT_CARD_SENDER_NAME_MAX = 60
export const GIFT_CARD_MESSAGE_MAX = 500

/**
 * The nine approved denominations, as `public.products.slug`.
 *
 * The Stripe lookup keys use underscores (`gift_card_25`); the website's product
 * slugs use hyphens (`gift-card-25`). Both are recorded so the mapping is
 * explicit rather than something a reader has to infer — mixing them up would
 * mean a checkout that silently resolves nothing.
 */
export const GIFT_CARD_DENOMINATIONS = [
  { slug: "gift-card-5", stripeLookupKey: "gift_card_5", faceValueCents: 500 },
  { slug: "gift-card-10", stripeLookupKey: "gift_card_10", faceValueCents: 1000 },
  { slug: "gift-card-15", stripeLookupKey: "gift_card_15", faceValueCents: 1500 },
  { slug: "gift-card-20", stripeLookupKey: "gift_card_20", faceValueCents: 2000 },
  { slug: "gift-card-25", stripeLookupKey: "gift_card_25", faceValueCents: 2500 },
  { slug: "gift-card-30", stripeLookupKey: "gift_card_30", faceValueCents: 3000 },
  { slug: "gift-card-50", stripeLookupKey: "gift_card_50", faceValueCents: 5000 },
  { slug: "gift-card-75", stripeLookupKey: "gift_card_75", faceValueCents: 7500 },
  { slug: "gift-card-100", stripeLookupKey: "gift_card_100", faceValueCents: 10000 }
] as const

export const GIFT_CARD_SLUGS: ReadonlySet<string> = new Set(
  GIFT_CARD_DENOMINATIONS.map((denomination) => denomination.slug)
)

export function findDenomination(slug: string) {
  return GIFT_CARD_DENOMINATIONS.find((denomination) => denomination.slug === slug) ?? null
}

export type GiftCardRejection = { code: string; status: number; message: string }

export type GiftCardCheckoutRequest = {
  slug?: unknown
  recipientEmail?: unknown
  senderName?: unknown
  message?: unknown
  sendToSelf?: unknown
  checkoutAttemptId?: unknown
}

export type GiftCardCheckoutIntent = {
  slug: string
  faceValueCents: number
  recipientEmail: string
  senderName: string
  message: string
  sendToSelf: boolean
  checkoutAttemptId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// Deliberately conservative. A gift card goes to an address we have never
// verified, so a permissive pattern buys nothing and costs deliverability.
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/
// C0 and C1 control characters. A newline in a sender name is a header-injection
// attempt; the rest have no place in plain text.
/**
 * True when the value contains a C0 or C1 control character.
 *
 * This was a regex character class written with the control characters as
 * LITERAL BYTES in this file — the same defect CodeQL raised as
 * js/overly-large-range against lib/email/gift-card-templates.ts, in production
 * code, just not separately alerted. Nobody reading a range of invisible bytes
 * can tell what it covers, and the file was binary to grep as a result.
 *
 * Behaviour is unchanged and deliberately STRICTER than the email templates'
 * sanitizer: this REJECTS the whole input rather than stripping, and it covers
 * C1 (0x80-0x9f) as well. Callers that want to tolerate tab/newline/carriage
 * return strip those before calling — see the message check below.
 */
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    // C0 and DEL, then C1.
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/** Lowercased and trimmed, matching how accounts store addresses. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Counts USER-PERCEIVED characters — grapheme clusters, not UTF-16 code units
 * and not code points.
 *
 * All three differ for the family emoji "👨‍👩‍👧": 8 code units, 5 code points
 * (three people plus two zero-width joiners), 1 grapheme. Clamping on `.length`
 * would reject a legitimately short name containing an emoji; clamping on code
 * points would still miscount any joined sequence.
 *
 * `Intl.Segmenter` is available in Node 18+, every current browser, and the
 * Cloudflare Workers runtime. The code-point fallback exists only so an exotic
 * runtime degrades to a stricter limit rather than throwing.
 */
export function graphemeLength(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
    let count = 0
    for (const _segment of segmenter.segment(value)) {
      count++
    }
    return count
  }
  return [...value].length
}

/**
 * Validates a gift-card purchase request into an intent the server can act on.
 *
 * Every monetary and identity value in the result comes from OUR table of
 * denominations or from the authenticated session — never from the request. The
 * client chooses a denomination slug and who receives it; nothing else.
 */
export function parseGiftCardCheckout(
  request: GiftCardCheckoutRequest,
  buyer: { verifiedEmail: string | null }
): { ok: true; intent: GiftCardCheckoutIntent } | { ok: false; rejection: GiftCardRejection } {
  const reject = (code: string, message: string, status = 400) =>
    ({ ok: false as const, rejection: { code, status, message } })

  if (!buyer.verifiedEmail) {
    return reject(
      "buyer_email_unverified",
      "Please verify your email address before buying a gift card.",
      403
    )
  }

  if (typeof request.checkoutAttemptId !== "string" || !UUID.test(request.checkoutAttemptId)) {
    return reject("attempt_id_invalid", "Something went wrong starting checkout. Please try again.")
  }

  const slug = typeof request.slug === "string" ? request.slug.trim() : ""
  const denomination = findDenomination(slug)
  if (!denomination) {
    // Covers an unknown slug, an ordinary product slug, and a client-invented
    // denomination alike. The message does not enumerate what IS valid.
    return reject("denomination_invalid", "Choose one of the available gift card amounts.")
  }

  const sendToSelf = request.sendToSelf === true

  // When sending to self the address comes from the SESSION, never from the
  // request — a supplied duplicate would be an unverified value we would then
  // treat as verified.
  let recipientEmail: string
  if (sendToSelf) {
    recipientEmail = normalizeEmail(buyer.verifiedEmail)
  } else {
    if (typeof request.recipientEmail !== "string") {
      return reject("recipient_required", "Enter the email address to send the gift card to.")
    }
    recipientEmail = normalizeEmail(request.recipientEmail)
    if (!EMAIL.test(recipientEmail) || recipientEmail.length > 254) {
      return reject("recipient_invalid", "That email address does not look right.")
    }
  }

  const senderNameRaw = typeof request.senderName === "string" ? request.senderName : ""
  const senderName = senderNameRaw.replace(/\s+/g, " ").trim()
  if (hasControlCharacter(senderNameRaw)) {
    return reject("sender_name_invalid", "Your name cannot contain special formatting characters.")
  }
  if (graphemeLength(senderName) > GIFT_CARD_SENDER_NAME_MAX) {
    return reject(
      "sender_name_too_long",
      `Your name can be up to ${GIFT_CARD_SENDER_NAME_MAX} characters.`
    )
  }

  const messageRaw = typeof request.message === "string" ? request.message : ""
  if (hasControlCharacter(messageRaw.replace(/[\n\r\t]/g, ""))) {
    return reject("message_invalid", "Your message cannot contain special formatting characters.")
  }
  const message = messageRaw.replace(/\s+/g, " ").trim()
  if (graphemeLength(message) > GIFT_CARD_MESSAGE_MAX) {
    return reject("message_too_long", `Your message can be up to ${GIFT_CARD_MESSAGE_MAX} characters.`)
  }

  return {
    ok: true,
    intent: {
      slug: denomination.slug,
      // From OUR table. The request cannot name a price.
      faceValueCents: denomination.faceValueCents,
      recipientEmail,
      senderName,
      message,
      sendToSelf,
      checkoutAttemptId: request.checkoutAttemptId
    }
  }
}

export type GiftCardFeatureEnv = {
  STORE_GIFT_CARDS_ENABLED?: string
  GIFT_CARD_CLAIM_PEPPER?: string
  GIFT_CARD_ENCRYPTION_KEY?: string
  GIFT_CARD_ENCRYPTION_KEY_VERSION?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  /**
   * The owner's reviewed decision about gift-card tax treatment.
   *
   * There is no default and no boolean. Ordinary checkout builds inline
   * `price_data` and never references a Stripe Price, so the tax category on
   * the existing "RealFiction Gift Card" Product in the Dashboard is not what
   * Stripe charges against — which means the correct behaviour cannot be
   * determined from this repository at all.
   *
   * Accepted values, each a deliberate statement someone has to make:
   *   no_tax_at_sale   — stored value is not taxed at sale; tax applies when
   *                      the credit is spent. Requires confirmation that Stripe
   *                      Tax is not configured to tax this session.
   *   tax_at_sale      — tax applies at sale. NOT implementable without a
   *                      Dashboard tax-code decision, so it fails closed here.
   */
  GIFT_CARD_TAX_TREATMENT_REVIEWED?: string
  /**
   * Pepper for the abuse counters' hashed subjects.
   *
   * Part of THIS gate rather than only the checkout route because the two must
   * agree. The checkout route fails closed without it (503), so a storefront
   * that offered a purchase form while the pepper was unset would render a buy
   * button that could never succeed — the worst of both states, since the
   * customer only discovers it after filling the form in.
   */
  ABUSE_SUBJECT_PEPPER?: string
  [key: string]: string | undefined
}

/**
 * Every condition that must hold before a gift card may be sold.
 *
 * Reports a boolean and a reason CODE for the server log. The reason never
 * reaches a customer: telling an attacker which key is missing is free
 * reconnaissance, and telling a customer "GIFT_CARD_CLAIM_PEPPER is unset"
 * helps nobody.
 *
 * `cryptoConfigured` is injected rather than imported so this module stays free
 * of `server-only` and remains unit-testable.
 */
export function evaluateGiftCardAvailability(
  env: GiftCardFeatureEnv,
  checks: { cryptoConfigured: boolean }
): { available: boolean; reason: string } {
  if ((env.STORE_GIFT_CARDS_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return { available: false, reason: "feature_disabled" }
  }
  if (!checks.cryptoConfigured) {
    // A card whose credential cannot be sealed can never be delivered, so it
    // must never be sold.
    return { available: false, reason: "crypto_unconfigured" }
  }
  if (!env.RESEND_API_KEY?.trim()) {
    return { available: false, reason: "email_unconfigured" }
  }
  if (!env.EMAIL_FROM?.trim()) {
    return { available: false, reason: "email_sender_unconfigured" }
  }
  // LAUNCH BLOCKER, deliberately unset in production. See the field docs above:
  // the tax treatment of stored value at sale is a Dashboard and tax-review
  // decision, and this code has no basis to assume either answer.
  if ((env.GIFT_CARD_TAX_TREATMENT_REVIEWED ?? "").trim() !== "no_tax_at_sale") {
    return { available: false, reason: "tax_treatment_unreviewed" }
  }
  // The abuse controls are MANDATORY and the checkout route fails closed on a
  // missing pepper. Without this check the storefront would happily render a
  // purchase form whose every submission returns 503 — the gate and the route
  // must refuse in the same conditions, or the gate is lying to the customer.
  if (!env.ABUSE_SUBJECT_PEPPER?.trim()) {
    return { available: false, reason: "abuse_controls_unconfigured" }
  }
  return { available: true, reason: "available" }
}

/** What a customer sees when gift cards are off, for any reason. */
export const GIFT_CARD_UNAVAILABLE: GiftCardRejection = {
  code: "gift_cards_unavailable",
  status: 503,
  message: "Gift cards are not available right now. Nothing has been charged."
}
