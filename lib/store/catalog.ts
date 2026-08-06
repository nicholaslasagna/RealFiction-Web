// The RealFiction store catalog — presentation metadata ONLY.
//
// ============================================================================
// THIS FILE IS NOT A PRICING OR ENTITLEMENT AUTHORITY.
// ============================================================================
// Checkout resolves price, duration, and fulfillment type from the Supabase
// `products` table (see lib/store-server.ts `resolveCheckoutLines`). The prices
// here exist so the storefront can render without a round trip; a mismatch is a
// display bug, never a billing one, and `lib/store-catalog.test.ts` fails the
// build if the two drift apart.
//
// Product model
// -------------
// RealFiction sells three shapes of thing, and every card must say which:
//
//   permanent  one-time purchase, never expires        (ranks, cosmetics)
//   term       one-time purchase, fixed window, NO auto-renew  (RealFiction+)
//   recurring  charged until cancelled                 (NOT IMPLEMENTED)
//
// `recurring` is deliberately declared and deliberately unused. The repo has no
// Stripe Billing foundation — no customer/subscription/price ids, no invoice
// handling, no cancellation flow — so nothing may claim automatic renewal.
// `lib/store-catalog.test.ts` enforces that no live product uses it.

export type BillingType = "permanent" | "term" | "recurring"

export type StoreCategory =
  | "ranks"
  | "membership"
  | "cosmetics"
  | "pets"
  | "bundles"
  | "gift-cards"

export type Availability = "available" | "coming-soon" | "unavailable"

export type CatalogProduct = {
  /** Stable id. Matches the Supabase `products.slug` for purchasable items. */
  id: string
  name: string
  category: StoreCategory
  billing: BillingType
  /** Term products only. Null for permanent. */
  durationDays: number | null
  /** `product:<slug>`, matching fulfill_paid_order's key construction. */
  entitlementKey: string
  /**
   * Product ids whose benefits this product also grants. Enforced server-side
   * at fulfilment (see the rank-inclusion migration), not just displayed.
   */
  includes: string[]
  /** Product id this can be upgraded FROM, with credit for what was paid. */
  upgradeFrom: string | null
  /** Display only. The Supabase row is authoritative at checkout. */
  priceCents: number
  /** Concrete inclusions. No vague copy — every line is a specific thing. */
  features: string[]
  /** What the buyer keeps forever vs loses. Rendered verbatim on the card. */
  retained: string[]
  expires: string[]
  availability: Availability
  giftable: boolean
  banner: string | null
  /** Exactly one product may carry a recommendation badge. */
  badge: string | null
  sortOrder: number
}

/** The legally-required billing disclosure for each billing shape. */
export const BILLING_DISCLOSURE: Record<BillingType, string[]> = {
  permanent: ["One-time purchase", "Permanent unlock"],
  term: ["One-time purchase", "Does not automatically renew"],
  // Only correct once real Stripe Billing exists. No live product uses this.
  recurring: ["Charged monthly until canceled", "Cancel online"]
}

const NO_PAY_TO_WIN = "No competitive advantage"

export const CATALOG: CatalogProduct[] = [
  // -- Ranks -----------------------------------------------------------------
  {
    id: "realvip-permanent",
    name: "RealVIP",
    category: "ranks",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:realvip-permanent",
    includes: [],
    upgradeFrom: null,
    priceCents: 1299,
    features: [
      "Permanent [VIP] chat prefix",
      "Permanent VIP profile badge",
      "8 username colours",
      "3 cosmetic loadout slots",
      "Lobby cosmetics: basic trails and hats",
      "Supporter recognition on your profile",
      NO_PAY_TO_WIN
    ],
    retained: ["Everything above, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/realvip.png",
    badge: null,
    sortOrder: 10
  },
  {
    id: "real-supporter-permanent",
    name: "RealSupporter",
    category: "ranks",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:real-supporter-permanent",
    includes: ["realvip-permanent"],
    upgradeFrom: "realvip-permanent",
    priceCents: 3499,
    features: [
      "Everything in RealVIP",
      "Permanent [SUPPORTER] chat prefix",
      "Permanent lobby flight",
      "24 username colours",
      "8 cosmetic loadout slots",
      "3 permanent pets",
      "4 permanent particle effects",
      "Lobby entrance and celebration effects",
      NO_PAY_TO_WIN
    ],
    retained: ["Everything above, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/real-supporter.png",
    badge: "Best value",
    sortOrder: 20
  },

  // -- Membership ------------------------------------------------------------
  {
    id: "realfiction-plus-30d",
    name: "RealFiction+",
    category: "membership",
    billing: "term",
    durationDays: 30,
    entitlementKey: "product:realfiction-plus-30d",
    includes: [],
    upgradeFrom: null,
    priceCents: 599,
    features: [
      "This month's collectible cosmetic — yours to keep",
      "Rotating cosmetic vault while active",
      "Animated member profile frame while active",
      "4 extra cosmetic loadout slots while active",
      "Lobby flight while active",
      "A vote on next month's cosmetic theme",
      "Discord member role while active",
      NO_PAY_TO_WIN
    ],
    retained: ["Every monthly collectible you were a member for"],
    expires: [
      "Rotating vault access",
      "Member profile frame",
      "Extra loadout slots",
      "Lobby flight (unless you own RealSupporter)",
      "Discord member role"
    ],
    availability: "available",
    giftable: true,
    banner: null,
    badge: null,
    sortOrder: 30
  },

  // -- Cosmetics -------------------------------------------------------------
  {
    id: "username-colors-permanent",
    name: "Username Colours",
    category: "cosmetics",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:username-colors-permanent",
    includes: [],
    upgradeFrom: null,
    priceCents: 499,
    features: ["16 username colours", "Switch any time", NO_PAY_TO_WIN],
    retained: ["All 16 colours, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/username-colors.png",
    badge: null,
    sortOrder: 40
  },
  {
    id: "particle-vault-permanent",
    name: "Particle Vault",
    category: "cosmetics",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:particle-vault-permanent",
    includes: [],
    upgradeFrom: null,
    priceCents: 899,
    features: ["12 particle effects", "Lobby and hub only", NO_PAY_TO_WIN],
    retained: ["All 12 effects, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/particle-vault.png",
    badge: null,
    sortOrder: 50
  },

  // -- Pets ------------------------------------------------------------------
  {
    id: "realpets-permanent",
    name: "RealPets Pack",
    category: "pets",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:realpets-permanent",
    includes: [],
    upgradeFrom: null,
    priceCents: 799,
    features: ["6 lobby companion pets", "Cosmetic only — pets cannot fight or carry items", NO_PAY_TO_WIN],
    retained: ["All 6 pets, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/realpets.png",
    badge: null,
    sortOrder: 60
  },

  // -- Bundles ---------------------------------------------------------------
  {
    id: "cosmetic-atelier-permanent",
    name: "Cosmetic Atelier",
    category: "bundles",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:cosmetic-atelier-permanent",
    includes: [
      "username-colors-permanent",
      "particle-vault-permanent",
      "realpets-permanent"
    ],
    upgradeFrom: null,
    priceCents: 1799,
    features: [
      "Everything in Username Colours, Particle Vault and RealPets Pack",
      "4 bundle-exclusive cosmetics",
      NO_PAY_TO_WIN
    ],
    retained: ["Every cosmetic in the bundle, permanently"],
    expires: [],
    availability: "available",
    giftable: true,
    banner: "/images/store/cosmetic-atelier.png",
    badge: null,
    sortOrder: 70
  },

  // -- Gift cards ------------------------------------------------------------
  // Deliberately NOT purchasable. The secure issuance/claim/ledger/reversal flow
  // is unbuilt, and checkout refuses gift-card slugs server-side
  // (lib/checkout-guard.ts). One honest placeholder beats nine buyable-looking
  // denominations for a disabled system.
  {
    id: "gift-cards-placeholder",
    name: "Gift Cards",
    category: "gift-cards",
    billing: "permanent",
    durationDays: null,
    entitlementKey: "product:gift-cards-placeholder",
    includes: [],
    upgradeFrom: null,
    priceCents: 0,
    features: ["Send RealFiction credit to a friend"],
    retained: [],
    expires: [],
    availability: "coming-soon",
    giftable: false,
    banner: null,
    badge: null,
    sortOrder: 90
  }
]

// -- Lookups -----------------------------------------------------------------

export const CATALOG_BY_ID = new Map(CATALOG.map((product) => [product.id, product]))

export function getProduct(id: string): CatalogProduct | undefined {
  return CATALOG_BY_ID.get(id)
}

export function purchasableProducts(): CatalogProduct[] {
  return CATALOG.filter((product) => product.availability === "available")
}

/**
 * Every product id whose benefits `id` grants, transitively.
 *
 * Display-side mirror of the server-side inclusion grant. Guarded against
 * cycles: a malformed catalog must not hang the storefront.
 */
export function expandIncludes(id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) {
    return []
  }
  seen.add(id)
  const product = CATALOG_BY_ID.get(id)
  if (!product) {
    return []
  }
  const out: string[] = []
  for (const included of product.includes) {
    out.push(included, ...expandIncludes(included, seen))
  }
  return [...new Set(out)]
}

/** True when owning `ownedId` already grants everything in `candidateId`. */
export function isIncludedIn(candidateId: string, ownedId: string): boolean {
  return expandIncludes(ownedId).includes(candidateId)
}

export const STORE_SECTIONS: Array<{ id: StoreCategory; title: string; blurb: string }> = [
  { id: "ranks", title: "Ranks", blurb: "Permanent supporter identity. Buy once, keep forever." },
  { id: "membership", title: "RealFiction+", blurb: "A 30-day pass with a collectible you keep." },
  { id: "cosmetics", title: "Cosmetics", blurb: "Permanent unlocks for how you look in the lobby." },
  { id: "pets", title: "Pets", blurb: "Permanent lobby companions." },
  { id: "bundles", title: "Bundles", blurb: "Several cosmetic packs together, cheaper." },
  { id: "gift-cards", title: "Gift Cards", blurb: "Coming soon." }
]

/** The Fair Play Promise. A RealFiction product promise, not a legal claim. */
export const FAIR_PLAY = {
  never: [
    "Combat strength or better gear",
    "Kits that outclass free kits",
    "Paid progression or XP boosts",
    "Resource-generation advantages",
    "Competitive multipliers",
    "Access needed to play any core mode",
    "Priority moderation or support",
    "Lootboxes, mystery rewards, or anything gambling-like"
  ],
  sell: [
    "Cosmetic effects, pets and particles",
    "Profile and chat presentation",
    "Lobby-only convenience such as flight",
    "Supporter recognition",
    "Non-competitive community participation"
  ]
} as const
