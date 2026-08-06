// Fixture data for the development-only presentation harness.
//
// Every state below is one a real customer can reach and none of them are easy
// to produce on demand against a real database without touching real money or
// real people's accounts. They are plain data: no secrets, no identifiers that
// resolve to anything, no network.
//
// The shapes are the real ones — `EntitlementView` is exactly what
// `getStorefrontAccess` returns from Postgres, and `PurchaseRow` is exactly what
// the account page selects. If those shapes change, this file stops compiling,
// which is the point.

import type { PurchaseRow } from "@/components/account/purchase-history"
import type { EntitlementView } from "@/lib/store/access-view"

const VIP = "realvip-3m"
const SUPPORTER = "real-supporter-3m"

const SEP_2026 = "2026-09-18T12:00:00.000Z"
const DEC_2026 = "2026-12-18T12:00:00.000Z"
const LAST_MONTH = "2026-07-05T12:00:00.000Z"

type StoreFixture = {
  surface: "store"
  title: string
  note: string
  signedIn: boolean
  linkedUsername: string | null
  entitlements: EntitlementView[]
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
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP · 3 months", slug: VIP } }]
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
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter · 3 months", slug: SUPPORTER } }]
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
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP · 3 months", slug: VIP } }]
}

const SIX_MONTH_MIXED: PurchaseRow = {
  id: "55555555-5555-4555-8555-555555555555",
  status: "fulfilled",
  currency: "USD",
  created_at: "2026-07-18T10:00:00.000Z",
  subtotal_cents: 2399,
  discount_cents: 0,
  total_cents: 2399,
  store_credit_applied_cents: 500,
  payment_due_cents: 1899,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealVIP · 6 months", slug: "realvip-6m" } }]
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
  ...SIX_MONTH_MIXED,
  id: "77777777-7777-4777-8777-777777777777",
  status: "refunded"
}

const UNDER_REVIEW: PurchaseRow = {
  ...SIX_MONTH_MIXED,
  id: "88888888-8888-4888-8888-888888888888",
  status: "under_review"
}

const PENDING: PurchaseRow = {
  id: "99999999-9999-4999-8999-999999999999",
  status: "pending",
  currency: "USD",
  created_at: "2026-08-01T10:00:00.000Z",
  subtotal_cents: 2699,
  discount_cents: 0,
  total_cents: 2699,
  store_credit_applied_cents: 0,
  payment_due_cents: 2699,
  order_items: [{ quantity: 1, product_snapshot: { name: "RealSupporter · 3 months", slug: SUPPORTER } }]
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
    title: "Signed out",
    note: "No account. Prices and durations shown; no access state, no projection.",
    signedIn: false,
    linkedUsername: null,
    entitlements: []
  },

  "no-access": {
    surface: "store",
    title: "Signed in, nothing active",
    note: "Linked account, no entitlements. Every card offers four durations at list price.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: []
  },

  "active-realvip": {
    surface: "store",
    title: "Active RealVIP",
    note: "Access until September 18, 2026. Selecting a duration projects the extension.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: [{ productId: "realvip", expiresAt: SEP_2026 }]
  },

  "active-realsupporter": {
    surface: "store",
    title: "Active RealSupporter",
    note: "RealSupporter active, RealVIP NOT active — the two are independent products.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: [{ productId: "realsupporter", expiresAt: SEP_2026 }]
  },

  "active-cosmetic": {
    surface: "store",
    title: "Active cosmetic product",
    note: "Particle Vault active; everything else unaffected.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: [{ productId: "particle_vault", expiresAt: SEP_2026 }]
  },

  "expired-realvip": {
    surface: "store",
    title: "Expired RealVIP",
    note: "Lapsed access reads as expired, and a new purchase starts from today, not the old date.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: [{ productId: "realvip", expiresAt: LAST_MONTH }]
  },

  "stacked-renewals": {
    surface: "store",
    title: "Multiple stacked renewals",
    note: "Two purchases of the same product. The card shows the FURTHEST expiry, not the latest purchase.",
    signedIn: true,
    linkedUsername: "LittleNicholas",
    entitlements: [
      { productId: "realvip", expiresAt: SEP_2026 },
      { productId: "realvip", expiresAt: DEC_2026 }
    ]
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

  "orders-all": {
    surface: "account",
    title: "Account history — every accounting shape at once",
    note: "Ordinary, store-credit-only, mixed tender, historical, refunded, review, pending, revoked.",
    orders: [
      ORDINARY_STRIPE,
      STORE_CREDIT_ONLY,
      MIXED_TENDER,
      SIX_MONTH_MIXED,
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
  sixMonthMixed: SIX_MONTH_MIXED,
  historicalNoDiscountFields: HISTORICAL_NO_DISCOUNT_FIELDS,
  refunded: REFUNDED_UPGRADE,
  underReview: UNDER_REVIEW,
  pending: PENDING,
  revoked: REVOKED
}
