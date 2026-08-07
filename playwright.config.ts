import { defineConfig, devices } from "@playwright/test"

// Interactive browser verification for the gift-card storefront and claim page.
//
// TWO SERVERS, ON PURPOSE
// =======================
// Gift-card availability is decided on the SERVER from environment values, so
// the disabled and enabled states cannot both be reached from one process. Two
// dev servers run on separate ports:
//
//   3311  production-safe defaults — gift cards OFF (the real default)
//   3312  explicit test-only gate values — gift cards ON
//
// Neither uses a real key. Neither reaches production Supabase, Stripe, Resend,
// or RealCore: the pages under test are server-rendered from the catalog and
// the feature gate, and every outbound call the browser makes is intercepted in
// the tests themselves.

const DISABLED_PORT = 3311
const ENABLED_PORT = 3312
// The refund and dispute states are only reachable through the development
// preview harness, which `next start` deliberately 404s. A third server runs in
// dev mode against its own build directory so it does not contend with the two
// built ones over `.next`.
const PREVIEW_PORT = 3313

/** Obviously fake, and never valid anywhere. */
const TEST_ONLY_ENV = {
  STORE_GIFT_CARDS_ENABLED: "true",
  // Required by the storefront gate: without it gift cards stay in Coming Soon,
  // because the checkout route would refuse every submission.
  ABUSE_SUBJECT_PEPPER: "playwright-pepper-not-a-secret",
  GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
  GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY: "0".repeat(64),
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1",
  RESEND_API_KEY: "playwright-not-a-real-key",
  EMAIL_FROM: "test@example.invalid",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${ENABLED_PORT}`
}

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  // A dev server compiling a route on first hit is slow; this is generous
  // rather than flaky-tolerant.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],

  use: {
    // Artifacts only when something fails, so a green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },

  projects: [
    {
      name: "gift-cards-disabled",
      testMatch: /disabled\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DISABLED_PORT}` }
    },
    {
      name: "gift-cards-enabled",
      testMatch: /(enabled|claim|responsive|a11y|a11y-sitewide)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${ENABLED_PORT}` }
    },
    {
      name: "refund-states",
      // The preview harness serves both the refund/dispute states and the
      // cash-redemption surfaces; they share this server.
      testMatch: /(refund-states|cash-redemption|a11y-authenticated)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PREVIEW_PORT}` }
    }
  ],

  webServer: [
    {
      // `next start`, not `next dev`: two dev servers cannot share one project
      // directory (they contend for `.next`), and a built server is closer to
      // production anyway. `test:browser` runs `next build` first.
      //
      // Production-safe defaults: the gate values are simply absent.
      command: `npx next start --port ${DISABLED_PORT}`,
      port: DISABLED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_SITE_URL: `http://localhost:${DISABLED_PORT}` }
    },
    {
      command: `npx next start --port ${ENABLED_PORT}`,
      port: ENABLED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...TEST_ONLY_ENV }
    },
    {
      command: `npx next dev --port ${PREVIEW_PORT}`,
      port: PREVIEW_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ...TEST_ONLY_ENV, RF_DIST_DIR: ".next-preview", NEXT_PUBLIC_SITE_URL: `http://localhost:${PREVIEW_PORT}` }
    }
  ]
})
