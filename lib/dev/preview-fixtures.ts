// Fixture data for the development-only presentation harness.
//
// Every state below is one a real customer can reach and none of them are easy
// to produce on demand against a real database without touching real money or
// real people's accounts. They are plain data: no secrets, no identifiers that
// resolve to anything, no network.
//
// The shapes are the real ones — `EntitlementView` and `UpgradeQuoteView` are
// exactly what `getStorefrontOwnership` returns from Postgres, and `PurchaseRow`
// is exactly what the account page selects. If those shapes change, this file
// stops compiling, which is the point.

import type { PurchaseRow } from "@/components/account/purchase-history"
import type { EntitlementView, UpgradeQuoteView } from "@/lib/store/ownership-view"

const VIP = "realvip-permanent"
const SUPPORTER = "real-supporter-permanent"

/** Far enough out to stay in the future for the life of this harness. */
const AUG_2026 = "2026-08-30T12:00:00.000Z"

const ELIGIBLE_QUOTE: UpgradeQuoteView = {
  eligible: true,
  reason: "ok",
  targetPriceCents: 3499,
  creditCents: 1299,
  upgradePriceCents: 2200,
  hold: "none"
}

const NO_SOURCE_QUOTE: UpgradeQuoteView = {
  eligible: false,
  reason: "upgrade_credit_unavailable",
  targetPriceCents: 3499,
  creditCents: 0,
  upgradePriceCents: 3499,
  hold: "none"
}

type StoreFixture = {
  surface: "store"
  title: string
  note: string
  signedIn: boolean
  linkedUsername: string | null
  ownedProductIds: string[]
  entitlements: EntitlementView[]
  upgradeQuote: UpgradeQuoteView | null
}

type AccountFixture = {
  surface: "account"
  title: string
  note: string
  orders: PurchaseRow[]
}

export type PreviewFixture = StoreFixture | AccountFixture

// -- Orders -------------------------------------------------------------------

const ORDINARY_STRIPE: PurchaseRow = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-02T10:00:00.000Z",
  subtotal_cents: 1299,
  discount_cents: 0,
  total_cents: 1299,
  store_credit_applied_cents: 0,
  payment_due_cents: 1299,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP", slug: VIP } }]
}

const STORE_CREDIT_ONLY: PurchaseRow = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-05T10:00:00.000Z",
  subtotal_cents: 3499,
  discount_cents: 0,
  total_cents: 3499,
  store_credit_applied_cents: 3499,
  payment_due_cents: 0,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter", slug: SUPPORTER } }]
}

const MIXED_TENDER: PurchaseRow = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-08T10:00:00.000Z",
  subtotal_cents: 1299,
  discount_cents: 0,
  total_cents: 1299,
  store_credit_applied_cents: 500,
  payment_due_cents: 799,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP", slug: VIP } }]
}

const UPGRADE_NO_CREDIT: PurchaseRow = {
  id: "44444444-4444-4444-8444-444444444444",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-12T10:00:00.000Z",
  subtotal_cents: 3499,
  discount_cents: 1299,
  total_cents: 2200,
  store_credit_applied_cents: 0,
  payment_due_cents: 2200,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter", slug: SUPPORTER } }]
}

/** THE example: 3499 / -1299 / 2200 / -500 / 1700. */
const UPGRADE_WITH_CREDIT: PurchaseRow = {
  id: "55555555-5555-4555-8555-555555555555",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-18T10:00:00.000Z",
  subtotal_cents: 3499,
  discount_cents: 1299,
  total_cents: 2200,
  store_credit_applied_cents: 500,
  payment_due_cents: 1700,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter", slug: SUPPORTER } }]
}

/** Placed before discount/payment_due columns existed. Must not crash or NaN. */
const HISTORICAL_NO_DISCOUNT_FIELDS: PurchaseRow = {
  id: "66666666-6666-4666-8666-666666666666",
  status: "fulfilled",
  currency: "USD",
  created_at: "2025-11-03T10:00:00.000Z",
  total_cents: 999,
  // The product no longer exists in the catalogue; the SNAPSHOT still names it.
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP · 1 Month", slug: "realvip-1m" } }]
}

const REFUNDED_UPGRADE: PurchaseRow = {
  ...UPGRADE_WITH_CREDIT,
  id: "77777777-7777-4777-8777-777777777777",
  status: "refunded"
}

const UNDER_REVIEW: PurchaseRow = {
  ...UPGRADE_WITH_CREDIT,
  id: "88888888-8888-4888-8888-888888888888",
  status: "under_review"
}

const PENDING: PurchaseRow = {
  id: "99999999-9999-4999-8999-999999999999",
  status: "pending",
  currency: "USD",
  created_at: "2026-08-01T10:00:00.000Z",
  subtotal_cents: 3499,
  discount_cents: 1299,
  total_cents: 2200,
  store_credit_applied_cents: 0,
  payment_due_cents: 2200,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter", slug: SUPPORTER } }]
}

const REVOKED: PurchaseRow = {
  ...ORDINARY_STRIPE,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "chargeback"
}

// -- States -------------------------------------------------------------------

export const PREVIEW_STATES = {
  "signed-out": {
    surface: "store",
    title: "1. Signed out",
    note: "No account. No ownership, no upgrade offer, no prices personalised.",
    signedIn: false,
    linkedUsername: null,
    ownedProductIds: [],
    entitlements: [],
    upgradeQuote: null
  },

  "no-purchases": {
    surface: "store",
    title: "2. Signed in, nothing owned",
    note: "Linked account, empty collection. Everything sellable is offered at list price.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [],
    entitlements: [],
    upgradeQuote: NO_SOURCE_QUOTE
  },

  "vip-upgradeable": {
    surface: "store",
    title: "3. Permanent RealVIP, eligible to upgrade",
    note: "The headline case. RealSupporter shows 34.99 / -12.99 / 22.00 from the server quote.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: null, source: "order" }],
    upgradeQuote: ELIGIBLE_QUOTE
  },

  "vip-ineligible-source": {
    surface: "store",
    title: "4. Permanent RealVIP, source ineligible",
    note: "Owns RealVIP, but it was gifted/granted/store-credit funded. No upgrade offer, no silent full-price swap.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: null, source: "manual_grant" }],
    upgradeQuote: NO_SOURCE_QUOTE
  },

  "supporter-owner": {
    surface: "store",
    title: "5. Permanent RealSupporter owner",
    note: "Top rank owned outright. Nothing to upgrade to; the card is locked.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [SUPPORTER],
    entitlements: [{ productId: SUPPORTER, expiresAt: null, source: "order" }],
    upgradeQuote: {
      eligible: false,
      reason: "upgrade_target_already_owned",
      targetPriceCents: 3499,
      creditCents: 0,
      upgradePriceCents: 3499,
      hold: "none"
    }
  },

  "supporter-inherited-vip": {
    surface: "store",
    title: "6. RealSupporter with INHERITED RealVIP",
    note: "RealVIP came with RealSupporter. It reads as included, not as a purchase, and cannot fund an upgrade.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [SUPPORTER, VIP],
    entitlements: [
      { productId: SUPPORTER, expiresAt: null, source: "order" },
      { productId: VIP, expiresAt: null, source: "inclusion" }
    ],
    upgradeQuote: {
      eligible: false,
      reason: "upgrade_target_already_owned",
      targetPriceCents: 3499,
      creditCents: 0,
      upgradePriceCents: 3499,
      hold: "none"
    }
  },

  "legacy-vip": {
    surface: "store",
    title: "7. LEGACY timed RealVIP",
    note: "A dated grant on a card the catalogue now sells permanently. Must not read as 'Owned permanently'.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: AUG_2026, source: "order" }],
    upgradeQuote: NO_SOURCE_QUOTE
  },

  "legacy-supporter": {
    surface: "store",
    title: "8. LEGACY timed RealSupporter",
    note: "Expiring top rank. Both ranks show dated legacy access.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [SUPPORTER, VIP],
    entitlements: [
      { productId: SUPPORTER, expiresAt: AUG_2026, source: "order" },
      { productId: VIP, expiresAt: AUG_2026, source: "inclusion" }
    ],
    upgradeQuote: NO_SOURCE_QUOTE
  },

  "vip-direct-and-inherited": {
    surface: "store",
    title: "9. RealVIP owned BOTH directly and by inclusion",
    note: "A paid RealVIP plus an inherited one. The paid purchase is what the upgrade quote may use.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [
      { productId: VIP, expiresAt: null, source: "order" },
      { productId: VIP, expiresAt: null, source: "inclusion" }
    ],
    upgradeQuote: ELIGIBLE_QUOTE
  },

  "upgrade-reserved": {
    surface: "store",
    title: "10. Upgrade credit held by another checkout",
    note: "A pending checkout already holds the credit. Explained plainly; no button, no full-price fallback.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: null, source: "order" }],
    upgradeQuote: { ...NO_SOURCE_QUOTE, hold: "reserved" }
  },

  "upgrade-review": {
    surface: "store",
    title: "11. Upgrade source refunded or under review",
    note: "The source purchase is being reviewed. Paused, explained, and never silently repriced.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: null, source: "order" }],
    upgradeQuote: { ...NO_SOURCE_QUOTE, hold: "needs_review" }
  },

  "service-unavailable": {
    surface: "store",
    title: "14. Upgrade/product service unavailable",
    note: "The quote could not be read. No upgrade is offered — the safe direction — and the store still renders.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    ownedProductIds: [VIP],
    entitlements: [{ productId: VIP, expiresAt: null, source: "order" }],
    upgradeQuote: null
  },

  // -- Account surfaces -------------------------------------------------------

  "orders-empty": {
    surface: "account",
    title: "15. Empty order history",
    note: "No purchases yet.",
    orders: []
  },

  "orders-ordinary": {
    surface: "account",
    title: "16. Historical ordinary order",
    note: "One Stripe purchase, nothing to explain: a single amount, exactly as before.",
    orders: [ORDINARY_STRIPE]
  },

  "orders-mixed": {
    surface: "account",
    title: "17. Historical mixed-tender order",
    note: "Store credit plus a card charge, on separate lines.",
    orders: [MIXED_TENDER, STORE_CREDIT_ONLY]
  },

  "orders-upgrade": {
    surface: "account",
    title: "18. Upgraded RealSupporter order",
    note: "THE example: 34.99 / -12.99 / 22.00 / -5.00 / 17.00.",
    orders: [UPGRADE_WITH_CREDIT, UPGRADE_NO_CREDIT]
  },

  "orders-all": {
    surface: "account",
    title: "Account history — every accounting shape at once",
    note: "Ordinary, store-credit-only, mixed, upgrade, upgrade+credit, historical, refunded, review, pending, revoked.",
    orders: [
      ORDINARY_STRIPE,
      STORE_CREDIT_ONLY,
      MIXED_TENDER,
      UPGRADE_NO_CREDIT,
      UPGRADE_WITH_CREDIT,
      HISTORICAL_NO_DISCOUNT_FIELDS,
      REFUNDED_UPGRADE,
      UNDER_REVIEW,
      PENDING,
      REVOKED
    ]
  }
} as const satisfies Record<string, PreviewFixture>

export type PreviewStateId = keyof typeof PREVIEW_STATES

/** Fixtures reused by the DOM tests, so tests and browser see the same data. */
export const PREVIEW_ORDERS = {
  ordinaryStripe: ORDINARY_STRIPE,
  storeCreditOnly: STORE_CREDIT_ONLY,
  mixedTender: MIXED_TENDER,
  upgradeNoCredit: UPGRADE_NO_CREDIT,
  upgradeWithCredit: UPGRADE_WITH_CREDIT,
  historicalNoDiscountFields: HISTORICAL_NO_DISCOUNT_FIELDS,
  refundedUpgrade: REFUNDED_UPGRADE,
  underReview: UNDER_REVIEW,
  pending: PENDING,
  revoked: REVOKED
}
