// What a signed-in customer is told about the access they hold, and what a
// purchase would do to it.
//
// Every date here originates on the server, from `entitlements.expires_at`.
// Nothing is inferred from a product's duration, because the two can legitimately
// disagree: a customer who bought three months twice has six months of access on
// a card that says "3 months".
//
// The projection is the single most useful thing the store can tell someone:
// "adding 3 months would extend access through December 18, 2026" answers the
// question they actually have. It mirrors the server's stacking rule exactly —
//
//     new_expiration = max(current_expiration, now) + purchased_duration
//
// — so the number shown before checkout is the number the database will produce.
// If those ever diverge, the projection is wrong and the fix belongs here, not in
// a nudge to the customer.
//
// Pure: no `server-only`, no I/O, so both the storefront and the tests use it.

export type EntitlementView = {
  /** Catalog product id, i.e. the slug without the `product:` prefix. */
  productId: string
  /** Server-provided expiry. Null means non-expiring, which store products are not. */
  expiresAt: string | null
}

/**
 * A raw entitlement row, as stored. The account page and the storefront read
 * the same table, so they share this shape.
 */
export type EntitlementRecord = {
  entitlement_key: string
  status?: string | null
  expires_at?: string | null
}

/**
 * THE rule for "does this account currently hold this?".
 *
 * An entitlement is CURRENT only while both are true:
 *   1. its status is `active` — a revoked or refunded grant is not ownership; and
 *   2. it has not expired — no `expires_at` (a permanent grant), or one in the
 *      future.
 *
 * Condition 2 is the one that gets forgotten, because `status` stays `active`
 * on a term grant after its date passes: nothing sweeps the column, and nothing
 * should — the row is the historical record of a real purchase. Expiry is a
 * function of the DATE, not of a flag, and reading only the flag is what made
 * the account page report a May 30 one-month purchase as owned indefinitely.
 *
 * Stacking works naturally: a customer with several rows for one product is
 * current while ANY of them is unexpired, which is the furthest-out date.
 *
 * Returns the slugs (`product:` prefix removed), not the raw rows, so callers
 * cannot accidentally re-derive ownership from a row this already rejected.
 */
export function activeEntitlementSlugs(
  rows: readonly EntitlementRecord[],
  now: number = Date.now()
): Set<string> {
  const active = new Set<string>()

  for (const row of rows) {
    // Absent status is treated as active: the storefront query filters on
    // status server-side and does not always re-select the column.
    const status = (row.status ?? "active").trim().toLowerCase()
    if (status !== "active") {
      continue
    }

    const expiry = row.expires_at ?? null
    if (expiry) {
      const parsed = Date.parse(expiry)
      // An UNPARSEABLE date is treated as expired, not as permanent. Reading a
      // corrupt value as "never expires" would grant access forever.
      if (Number.isNaN(parsed) || parsed <= now) {
        continue
      }
    }

    active.add(String(row.entitlement_key).replace(/^product:/, ""))
  }

  return active
}

export type AccessState =
  | { kind: "none" }
  | { kind: "active"; label: string; expiresAt: string }
  | { kind: "expired"; label: string; expiredAt: string }

export function formatAccessDate(value: string): string | null {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(
    new Date(parsed)
  )
}

/**
 * The furthest-out expiry this account holds for a product.
 *
 * A product can have several entitlement rows — one per paid order item — and
 * the customer's real access runs to the latest of them. Taking the max is what
 * makes two stacked purchases read as one continuous period.
 */
export function latestExpiry(
  productId: string,
  entitlements: readonly EntitlementView[]
): string | null {
  let latest: number | null = null
  for (const entitlement of entitlements) {
    if (entitlement.productId !== productId || !entitlement.expiresAt) {
      continue
    }
    const parsed = Date.parse(entitlement.expiresAt)
    if (!Number.isNaN(parsed) && (latest === null || parsed > latest)) {
      latest = parsed
    }
  }
  return latest === null ? null : new Date(latest).toISOString()
}

export function accessStateFor(
  productId: string,
  entitlements: readonly EntitlementView[],
  now: number = Date.now()
): AccessState {
  const expiry = latestExpiry(productId, entitlements)
  if (!expiry) {
    return { kind: "none" }
  }

  const parsed = Date.parse(expiry)
  const formatted = formatAccessDate(expiry)
  if (!formatted) {
    return { kind: "none" }
  }

  return parsed > now
    ? { kind: "active", label: `Active until ${formatted}`, expiresAt: expiry }
    : { kind: "expired", label: `Expired ${formatted}`, expiredAt: expiry }
}

/**
 * Where access would run to if this duration were purchased now.
 *
 * Deliberately calendar-month arithmetic rather than fixed 30-day blocks: a
 * customer reading "3 months" from August 18 expects November 18. The database
 * grants in days, so the two can differ by a day or two across month lengths —
 * the copy says "through" rather than naming a guaranteed instant, and the
 * account page always shows the authoritative date after fulfilment.
 */
export function projectedExpiry(
  currentExpiresAt: string | null,
  months: number,
  now: number = Date.now()
): string | null {
  const base = currentExpiresAt ? Date.parse(currentExpiresAt) : Number.NaN
  // max(current, now) — buying early never throws away time already paid for,
  // and buying after a lapse starts from today rather than back-dating.
  const start = new Date(Number.isNaN(base) || base < now ? now : base)
  const projected = new Date(start.getTime())
  const day = projected.getDate()
  projected.setMonth(projected.getMonth() + months)
  // setMonth overflows a short month (Jan 31 + 1 => Mar 3). Clamp to the last
  // day of the intended month instead.
  if (projected.getDate() !== day) {
    projected.setDate(0)
  }
  return projected.toISOString()
}

/** "Adding 3 months would extend access through December 18, 2026." */
export function projectionSentence(
  currentExpiresAt: string | null,
  months: number,
  durationLabel: string,
  now: number = Date.now()
): string | null {
  const projected = projectedExpiry(currentExpiresAt, months, now)
  if (!projected) {
    return null
  }
  const formatted = formatAccessDate(projected)
  if (!formatted) {
    return null
  }
  const active = currentExpiresAt ? Date.parse(currentExpiresAt) > now : false
  return active
    ? `Adding ${durationLabel} would extend access through ${formatted}.`
    : `Adding ${durationLabel} would give you access through ${formatted}.`
}

/** Customer-facing wording for checkout refusals. No reason codes, no internals. */
export const CHECKOUT_ERRORS: Record<string, string> = {
  product_not_sold: "That item is not available for purchase. Anything you already have is unaffected.",
  gift_cards_disabled: "Gift cards are not available yet.",
  paypal_disabled: "That payment method is not available. Please continue with secure card payment.",
  service_unavailable:
    "We could not start checkout safely just now. Nothing was charged. Please try again shortly.",
  checkout_failed: "We could not start checkout. Nothing was charged. Please try again."
}

export function checkoutErrorMessage(code: string | null | undefined, fallback?: string | null): string {
  if (code && CHECKOUT_ERRORS[code]) {
    return CHECKOUT_ERRORS[code]
  }
  return fallback ?? CHECKOUT_ERRORS.checkout_failed
}
