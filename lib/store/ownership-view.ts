// What a signed-in customer is told about what they own and what they may do.
//
// Every value here originates on the server. The browser is shown a state, not
// given an authority: checkout re-resolves ownership, eligibility and price
// regardless of what was rendered, so a tampered client can at worst display a
// lie to itself.
//
// The distinctions matter more than they look. "Owned" is not enough:
//
//   * permanent vs a term that expires on a date;
//   * bought outright vs INCLUDED with a higher rank (which is not a paid
//     upgrade source and must never be offered as one);
//   * an upgrade that is available vs one whose credit is currently held by
//     another checkout vs one whose source purchase is under review.
//
// Collapsing any of those into "Owned" either misleads a customer about what
// they keep, or invites them into a checkout the server will refuse.
//
// Pure: no `server-only`, no I/O. The storefront, the preview fixtures, and the
// tests all render from the same function.

/** Where an entitlement came from. Mirrors `entitlements.metadata->>'source'`. */
export type EntitlementSource = "order" | "inclusion" | "manual_grant" | "unknown"

export type EntitlementView = {
  /** Catalogue product id, i.e. the slug without the `product:` prefix. */
  productId: string
  /** Server-provided expiry. NEVER inferred from the product's duration. */
  expiresAt: string | null
  source: EntitlementSource
}

export type OwnershipState =
  | { kind: "none" }
  | { kind: "owned_permanent"; label: string }
  | { kind: "owned_term"; label: string; expiresAt: string }
  | { kind: "legacy_term"; label: string; expiresAt: string }
  | { kind: "included"; label: string; byName: string }

export type UpgradeState =
  | { kind: "none" }
  | { kind: "available"; targetPriceCents: number; creditCents: number; upgradePriceCents: number }
  | { kind: "reserved" }
  | { kind: "needs_review" }
  | { kind: "target_owned" }
  | { kind: "no_paid_source" }
  | { kind: "unavailable" }

/**
 * The server's answer, verbatim. `reason` values come from
 * `compute_upgrade_price`; `hold` from the reservation ledger.
 */
export type UpgradeQuoteView = {
  eligible: boolean
  reason: string
  targetPriceCents: number
  creditCents: number
  upgradePriceCents: number
  /** A live hold or an open review on this account's only eligible source. */
  hold: "none" | "reserved" | "needs_review"
}

function formatDate(value: string): string | null {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(
    new Date(parsed)
  )
}

/**
 * Ownership state for one catalogue product.
 *
 * `isPermanentProduct` says what the CATALOGUE sells today; the entitlement's
 * own `expiresAt` says what this customer actually holds. A legacy timed RealVIP
 * and a permanent RealVIP are the same catalogue card and must not read the
 * same, which is why both are consulted.
 */
export function ownershipStateFor(
  productId: string,
  entitlements: readonly EntitlementView[],
  options: {
    isPermanentProduct: boolean
    /** Products that INCLUDE this one, by product id, with display names. */
    includedByOwned?: { productId: string; name: string } | null
  }
): OwnershipState {
  const direct = entitlements.find((entitlement) => entitlement.productId === productId)

  if (direct) {
    // A grant that came from owning a higher rank is not a purchase of this one.
    if (direct.source === "inclusion" && options.includedByOwned) {
      return {
        kind: "included",
        label: `Included with ${options.includedByOwned.name}`,
        byName: options.includedByOwned.name
      }
    }

    if (!direct.expiresAt) {
      return { kind: "owned_permanent", label: "Owned permanently" }
    }

    const until = formatDate(direct.expiresAt)
    if (!until) {
      // An unparseable date must never render as "Invalid Date" or imply
      // permanence it does not have.
      return { kind: "owned_term", label: "Active — see your account for the end date", expiresAt: direct.expiresAt }
    }

    // The catalogue sells this permanently, but this customer holds a dated
    // grant: they are on legacy timed access and the difference is the whole
    // point of the upgrade conversation.
    return options.isPermanentProduct
      ? { kind: "legacy_term", label: `Legacy access active until ${until}`, expiresAt: direct.expiresAt }
      : { kind: "owned_term", label: `Active until ${until}`, expiresAt: direct.expiresAt }
  }

  if (options.includedByOwned) {
    return {
      kind: "included",
      label: `Included with ${options.includedByOwned.name}`,
      byName: options.includedByOwned.name
    }
  }

  return { kind: "none" }
}

/**
 * Maps the server's quote onto what the RealSupporter card should offer.
 *
 * Anything other than an outright `available` shows an explanation and NO
 * upgrade button. There is deliberately no fallback to a full-price checkout:
 * a customer who came to spend $22.00 must never be quietly moved to $34.99.
 */
export function upgradeStateFrom(quote: UpgradeQuoteView | null): UpgradeState {
  if (!quote) {
    return { kind: "none" }
  }

  // A live hold or an open review outranks the quote's generic
  // "no credit available" — the customer HAS a source, it is just not free.
  if (quote.hold === "reserved") {
    return { kind: "reserved" }
  }
  if (quote.hold === "needs_review") {
    return { kind: "needs_review" }
  }

  if (quote.eligible && quote.upgradePriceCents >= 0 && quote.creditCents > 0) {
    return {
      kind: "available",
      targetPriceCents: quote.targetPriceCents,
      creditCents: quote.creditCents,
      upgradePriceCents: quote.upgradePriceCents
    }
  }

  switch (quote.reason) {
    case "upgrade_target_already_owned":
      return { kind: "target_owned" }
    case "upgrade_credit_unavailable":
    case "no_upgrade_path":
      return { kind: "no_paid_source" }
    case "upgrade_target_unavailable":
      return { kind: "unavailable" }
    default:
      return { kind: "unavailable" }
  }
}

/** Customer-facing copy. No internal reason codes, no table or column names. */
export const UPGRADE_COPY: Record<UpgradeState["kind"], string> = {
  none: "",
  available: "",
  reserved:
    "Your upgrade credit is being used by a checkout you already started. Finish or cancel that one, then come back.",
  needs_review:
    "Your RealVIP purchase is being reviewed, so the upgrade is paused. Contact support and we will sort it out.",
  target_owned: "You already have RealSupporter.",
  no_paid_source:
    "Upgrade pricing applies to a RealVIP rank bought outright. Yours came another way, so RealSupporter is available at the normal price.",
  unavailable: "Upgrades are unavailable right now. Please try again shortly."
}

/**
 * Errors the checkout route can return, in customer language.
 *
 * The keys are the `code` values `/api/store/checkout` actually emits — the
 * `compute_upgrade_price` reasons, the `reserve_upgrade_credit` reasons, and the
 * upgrade shape guards. None of the wording names a table, a function, or a
 * reason code; "your upgrade credit is being used by a checkout you already
 * started" is true and actionable, "upgrade_credit_already_reserved" is neither.
 */
export const UPGRADE_CHECKOUT_ERRORS: Record<string, string> = {
  // compute_upgrade_price
  upgrade_target_already_owned: "You already have RealSupporter — there is nothing to upgrade.",
  upgrade_credit_unavailable:
    "We could not find a RealVIP purchase to credit. A RealVIP that was gifted to you, granted by staff, or included with another rank cannot fund an upgrade.",
  no_upgrade_path: "That product has no upgrade path.",
  upgrade_target_unavailable: "RealSupporter is not on sale right now.",
  // reserve_upgrade_credit
  upgrade_credit_already_reserved:
    "Your upgrade credit is being used by a checkout you already started. Finish or cancel that one, then try again.",
  // upgrade shape guards
  upgrade_gift_not_supported: "An upgrade applies to your own account and cannot be gifted.",
  upgrade_requires_single_line: "Check out your upgrade on its own, then buy the other items separately.",
  upgrade_requires_quantity_one: "An upgrade applies once, to your own account.",
  // cutover + availability
  product_not_sold: "That item is no longer sold. Anything you already own is unaffected.",
  // generic
  service_unavailable: "We could not start checkout safely just now. Nothing was charged. Please try again shortly.",
  checkout_failed: "We could not start checkout. Nothing was charged. Please try again."
}

export function upgradeErrorMessage(code: string | null | undefined, fallback?: string | null): string {
  if (code && UPGRADE_CHECKOUT_ERRORS[code]) {
    return UPGRADE_CHECKOUT_ERRORS[code]
  }
  return fallback ?? UPGRADE_CHECKOUT_ERRORS.checkout_failed
}
