// The RealFiction store catalog: seven products, each sold as a fixed period of
// access, in 1 / 3 / 6 / 12-month durations.
//
// WHAT "ONE-OFF" MEANS HERE
// ========================
// Stripe charges once. Nothing renews automatically. RealFiction grants the
// selected entitlement for the purchased number of months, RealCore delivers it,
// and a later purchase EXTENDS the existing access rather than replacing it.
//
// One-off is not permanent. It is a single payment for a bounded period, and the
// storefront must say so on every card: "One-time payment. Does not
// automatically renew."
//
// WHAT THIS FILE IS NOT
// =====================
// Not a pricing authority and not an entitlement authority. `public.products` in
// Supabase holds the prices the server actually charges and the durations it
// actually grants; this is the presentation layer plus the server's sellable
// allowlist. A contract test asserts the two agree exactly, so a copy edit here
// can never change what a customer is charged.
//
// Prices, descriptions, and durations below mirror the existing approved Stripe
// catalog. Do not invent products, prices, durations, perks, or bundles.

export type DurationMonths = 1 | 3 | 6 | 12

export type StoreCategory =
  | "supporter"
  | "cosmetics"
  | "pets"
  | "particles"
  | "identity"
  | "lobby"
  | "gift-cards"

export type Availability = "available" | "coming-soon"

/** One purchasable duration of a product. */
export type CatalogPrice = {
  /** `public.products.slug` — the only identifier checkout accepts. */
  slug: string
  months: DurationMonths
  priceCents: number
  /** The Stripe Price lookup key for this duration. */
  stripeLookupKey: string
}

export type CatalogProduct = {
  /** Stable product id, matching `internal_sku` in Stripe metadata. */
  id: string
  name: string
  category: StoreCategory
  /** The approved store description. Not marketing copy to be rewritten freely. */
  description: string
  /**
   * The entitlement RealCore delivers. Website entitlement rows are keyed
   * `product:<slug>`; this is the Stripe metadata `entitlement` value, recorded
   * so the two systems can be reconciled by a human.
   */
  stripeEntitlement: string
  prices: CatalogPrice[]
  banner: string | null
  availability: Availability
  /** Whether a purchase may be sent to another player. */
  giftable: boolean
  /** True when the product has no gameplay effect and may say so. */
  cosmeticOnly: boolean
  sortOrder: number
}

/**
 * Disclosure shown on every card and in the cart. Non-negotiable wording: a
 * customer must never be able to finish checkout believing they bought a
 * subscription, or that access continues after the period they bought.
 */
export const BILLING_DISCLOSURE = [
  "One-time payment",
  "Does not automatically renew"
] as const

export const CATALOG: CatalogProduct[] = [
  {
    id: "realvip",
    name: "RealVIP",
    category: "supporter",
    description:
      "Cosmetic supporter access for the RealFiction Minecraft network, including supporter profile style, chat flair, and lobby cosmetic perks. No gameplay or competitive advantages.",
    stripeEntitlement: "rank.realvip",
    prices: [
      { slug: "realvip-1m", months: 1, priceCents: 499, stripeLookupKey: "realvip_1m" },
      { slug: "realvip-3m", months: 3, priceCents: 1299, stripeLookupKey: "realvip_3m" },
      { slug: "realvip-6m", months: 6, priceCents: 2399, stripeLookupKey: "realvip_6m" },
      { slug: "realvip-12m", months: 12, priceCents: 3999, stripeLookupKey: "realvip_12m" }
    ],
    banner: "/images/store/realvip.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 10
  },
  {
    // RealSupporter is the higher-priced supporter product. It is NOT documented
    // anywhere in RealCore or the entitlement policy as including RealVIP, so
    // the store treats them as independent products and says nothing about a
    // relationship between them.
    id: "realsupporter",
    name: "RealSupporter",
    category: "supporter",
    description:
      "Top cosmetic supporter access for the RealFiction Minecraft network, including supporter profile styling, Discord supporter synchronization, cosmetic-only perks, and eligible monthly cosmetic drops. No gameplay or competitive advantages.",
    stripeEntitlement: "rank.realsupporter",
    prices: [
      { slug: "real-supporter-1m", months: 1, priceCents: 999, stripeLookupKey: "realsupporter_1m" },
      { slug: "real-supporter-3m", months: 3, priceCents: 2699, stripeLookupKey: "realsupporter_3m" },
      { slug: "real-supporter-6m", months: 6, priceCents: 4799, stripeLookupKey: "realsupporter_6m" },
      { slug: "real-supporter-12m", months: 12, priceCents: 7999, stripeLookupKey: "realsupporter_12m" }
    ],
    banner: "/images/store/real-supporter.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 20
  },
  {
    id: "cosmetic_atelier",
    name: "Cosmetic Atelier",
    category: "cosmetics",
    description:
      "Time-limited access to a curated RealFiction cosmetic collection containing profile effects, lobby entrances, particles, and seasonal badges. Digital delivery only. No gameplay or competitive advantages.",
    stripeEntitlement: "cosmetic.atelier",
    prices: [
      { slug: "cosmetic-atelier-1m", months: 1, priceCents: 699, stripeLookupKey: "cosmetic_atelier_1m" },
      { slug: "cosmetic-atelier-3m", months: 3, priceCents: 1899, stripeLookupKey: "cosmetic_atelier_3m" },
      { slug: "cosmetic-atelier-6m", months: 6, priceCents: 3399, stripeLookupKey: "cosmetic_atelier_6m" },
      { slug: "cosmetic-atelier-12m", months: 12, priceCents: 5599, stripeLookupKey: "cosmetic_atelier_12m" }
    ],
    banner: "/images/store/cosmetic-atelier.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 30
  },
  {
    id: "realpets",
    name: "RealPets Pack",
    category: "pets",
    description:
      "Time-limited access to a rotating collection of cosmetic pets for RealFiction hubs, lobbies, and social spaces. Includes nameable pet profiles and seasonal skins. Pets provide no combat, gameplay, or competitive advantages.",
    stripeEntitlement: "cosmetic.pets",
    prices: [
      { slug: "realpets-1m", months: 1, priceCents: 299, stripeLookupKey: "realpets_1m" },
      { slug: "realpets-3m", months: 3, priceCents: 799, stripeLookupKey: "realpets_3m" },
      { slug: "realpets-6m", months: 6, priceCents: 1399, stripeLookupKey: "realpets_6m" },
      { slug: "realpets-12m", months: 12, priceCents: 2399, stripeLookupKey: "realpets_12m" }
    ],
    banner: "/images/store/realpets.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 40
  },
  {
    id: "particle_vault",
    name: "Particle Vault",
    category: "particles",
    description:
      "Time-limited access to cinematic trails, celebration effects, and cosmetic lobby visual effects across the RealFiction Minecraft network. Includes toggleable presets and profile showcase support. No gameplay or competitive advantages.",
    stripeEntitlement: "cosmetic.particles",
    prices: [
      { slug: "particle-vault-1m", months: 1, priceCents: 349, stripeLookupKey: "particle_vault_1m" },
      { slug: "particle-vault-3m", months: 3, priceCents: 899, stripeLookupKey: "particle_vault_3m" },
      { slug: "particle-vault-6m", months: 6, priceCents: 1699, stripeLookupKey: "particle_vault_6m" },
      { slug: "particle-vault-12m", months: 12, priceCents: 2799, stripeLookupKey: "particle_vault_12m" }
    ],
    banner: "/images/store/particle-vault.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 50
  },
  {
    id: "username_colors",
    name: "Username Colors",
    category: "identity",
    description:
      "Time-limited access to approved cosmetic username, chat, and nameplate color styles across the RealFiction Minecraft network. Works with eligible prefixes and profile styling. Does not permit staff impersonation or provide gameplay advantages.",
    stripeEntitlement: "cosmetic.username_colors",
    prices: [
      { slug: "username-colors-1m", months: 1, priceCents: 199, stripeLookupKey: "username_colors_1m" },
      { slug: "username-colors-3m", months: 3, priceCents: 499, stripeLookupKey: "username_colors_3m" },
      { slug: "username-colors-6m", months: 6, priceCents: 899, stripeLookupKey: "username_colors_6m" },
      { slug: "username-colors-12m", months: 12, priceCents: 1599, stripeLookupKey: "username_colors_12m" }
    ],
    banner: "/images/store/username-colors.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: true,
    sortOrder: 60
  },
  {
    // Flight in LOBBIES only. The description is explicit about where it does
    // not apply, because "flight" in a Minecraft store is exactly the kind of
    // thing a customer could reasonably read as a gameplay advantage.
    id: "lobby_flight",
    name: "Lobby Flight",
    category: "lobby",
    description:
      "Time-limited access to flight in approved RealFiction lobbies, hubs, spawn showcases, and event spaces. Lobby Flight does not apply to survival, Factions, PvP, BedWars, or other competitive gameplay.",
    stripeEntitlement: "capability.lobby_flight",
    prices: [
      { slug: "lobby-flight-1m", months: 1, priceCents: 249, stripeLookupKey: "lobby_flight_1m" },
      { slug: "lobby-flight-3m", months: 3, priceCents: 649, stripeLookupKey: "lobby_flight_3m" },
      { slug: "lobby-flight-6m", months: 6, priceCents: 1199, stripeLookupKey: "lobby_flight_6m" },
      { slug: "lobby-flight-12m", months: 12, priceCents: 1999, stripeLookupKey: "lobby_flight_12m" }
    ],
    banner: "/images/store/lobby-flight.png",
    availability: "available",
    giftable: true,
    cosmeticOnly: false,
    sortOrder: 70
  },
  {
    // Gift cards exist in Stripe and stay there untouched. The website refuses
    // every gift-card slug because the generation, redemption, balance, refund
    // and reversal lifecycle is not finished — and RealCore's delivery fails
    // safely for them, which is a fail-safe worth preserving rather than
    // routing around.
    id: "gift_card",
    name: "Gift Cards",
    category: "gift-cards",
    description:
      "Send RealFiction store credit to another player. Not available yet: secure one-time claim codes, partial balances, and refunds are still being built.",
    stripeEntitlement: "store.credit",
    prices: [],
    banner: null,
    availability: "coming-soon",
    giftable: false,
    cosmeticOnly: true,
    sortOrder: 90
  }
]

// -- Lookups ------------------------------------------------------------------

export const CATALOG_BY_ID = new Map(CATALOG.map((product) => [product.id, product]))

export function getProduct(id: string): CatalogProduct | undefined {
  return CATALOG_BY_ID.get(id)
}

/** Products a customer may buy today, in display order. */
export function purchasableProducts(): CatalogProduct[] {
  return CATALOG.filter((product) => product.availability === "available" && product.prices.length > 0).sort(
    (a, b) => a.sortOrder - b.sortOrder
  )
}

/** Every sellable duration slug. The server's allowlist is built from this. */
export function purchasableSlugs(): string[] {
  return purchasableProducts().flatMap((product) => product.prices.map((price) => price.slug))
}

/** The product and duration a slug refers to, or null. */
export function findPrice(slug: string): { product: CatalogProduct; price: CatalogPrice } | null {
  for (const product of CATALOG) {
    const price = product.prices.find((candidate) => candidate.slug === slug)
    if (price) {
      return { product, price }
    }
  }
  return null
}

// -- Duration presentation ----------------------------------------------------

export const DURATION_LABEL: Record<DurationMonths, string> = {
  1: "1 month",
  3: "3 months",
  6: "6 months",
  12: "12 months"
}

/**
 * What one month of this duration effectively costs.
 *
 * Rounded to whole cents for display only. The customer is charged the listed
 * price, never a computed one.
 */
export function effectiveMonthlyCents(price: CatalogPrice): number {
  return Math.round(price.priceCents / price.months)
}

/**
 * Savings against buying the same number of MONTHS one month at a time.
 *
 * Derived from the authoritative prices, never a hardcoded marketing number. If
 * a longer duration ever stops being cheaper per month, this returns 0 and the
 * card simply shows no savings claim.
 */
export function savingsPercent(product: CatalogProduct, price: CatalogPrice): number {
  const monthly = product.prices.find((candidate) => candidate.months === 1)
  if (!monthly || price.months === 1) {
    return 0
  }
  const baseline = monthly.priceCents * price.months
  if (baseline <= 0 || price.priceCents >= baseline) {
    return 0
  }
  return Math.round(((baseline - price.priceCents) / baseline) * 100)
}

/**
 * The duration with the lowest effective monthly rate.
 *
 * "Best value" is an objective, checkable claim about price per month — not a
 * popularity claim, which we have no analytics to support.
 */
export function bestValueSlug(product: CatalogProduct): string | null {
  if (product.prices.length === 0) {
    return null
  }
  return product.prices.reduce((best, candidate) =>
    effectiveMonthlyCents(candidate) < effectiveMonthlyCents(best) ? candidate : best
  ).slug
}

export const STORE_SECTIONS: Array<{ id: StoreCategory; title: string; blurb: string }> = [
  {
    id: "supporter",
    title: "Supporter access",
    blurb: "Cosmetic supporter standing for a fixed period. One-time payment, no auto-renewal."
  },
  { id: "cosmetics", title: "Cosmetics", blurb: "Curated cosmetic collections for your chosen period." },
  { id: "pets", title: "Pets", blurb: "Cosmetic companions for hubs, lobbies, and social spaces." },
  { id: "particles", title: "Particles", blurb: "Trails, celebrations, and lobby visual effects." },
  { id: "identity", title: "Identity", blurb: "Approved username, chat, and nameplate color styles." },
  { id: "lobby", title: "Lobby", blurb: "Lobby-only perks. Never survival, Factions, PvP, or BedWars." },
  { id: "gift-cards", title: "Gift cards", blurb: "Coming soon." }
]

/**
 * The Fair Play Promise. A product promise about what RealFiction sells, not a
 * legal claim about anything else.
 */
export const FAIR_PLAY = {
  title: "Fair Play Promise",
  never: [
    "Stat boosts, damage, reach, or any combat advantage",
    "Economy multipliers, crate odds, or faster progression",
    "Anything that works in survival, Factions, PvP, or BedWars",
    "Loot boxes, gambling mechanics, or randomized paid rewards",
    "Automatic renewals, subscriptions you have to remember to cancel, or hidden charges"
  ],
  sell: [
    "Cosmetic supporter standing: profile style, chat flair, lobby perks",
    "Cosmetic pets, particles, and approved username colors",
    "Lobby Flight — in lobbies, hubs, and event spaces only",
    "A fixed period of access: 1, 3, 6, or 12 months, paid once",
    "More time whenever you want it, added on top of what you already have"
  ]
} as const
