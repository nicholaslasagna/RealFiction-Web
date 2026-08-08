// Accessibility of the SIGNED-IN surfaces.
//
// The site-wide sweep scans the anonymous view. Everything a customer touches
// after signing in — the store with entitlements resolved, order history, the
// refund and dispute states, held credit, the cash-redemption review — was
// never scanned, and those are exactly the surfaces where money is discussed.
//
// Real Supabase auth is not reachable from this host (no local instance), so
// these use the development preview harness, which renders the REAL components
// with fixture props. That is the same mechanism the refund-state specs already
// use: the component tree under test is the production one; only the data is
// fixed.
// NAVIGATION: `domcontentloaded`, deliberately not `networkidle`.
//
// This spec runs against the DEV-mode preview harness, which holds an HMR
// websocket open — `networkidle` can never settle there, and a cold route
// compile pushed the first navigation past the 90s timeout, failing 7 tests
// that have nothing wrong with them. axe needs a parsed DOM, not a quiet
// network.
//
// tests/browser/a11y-sitewide.spec.ts deliberately still uses `networkidle`:
// it runs against BUILT servers with no HMR socket, and its homepage scan needs
// the hero BACKGROUND IMAGE painted before axe measures colour contrast.
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  )
  const summary = blocking
    .map((v) => `  ${v.impact}: ${v.id} (${v.nodes.length}) — ${v.help}`)
    .join("\n")
  expect(blocking, `${label}\n${summary}`).toEqual([])
}

/** Every authenticated fixture, by the surface it represents. */
const AUTHENTICATED = [
  // Store, signed in, with entitlements resolved.
  ["store checkout — no entitlements", "no-access"],
  ["store checkout — active RealVIP", "active-realvip"],
  ["store checkout — active Supporter", "active-realsupporter"],
  ["store checkout — active cosmetic", "active-cosmetic"],
  ["store checkout — expired entitlement", "expired-realvip"],
  ["store checkout — stacked renewals", "stacked-renewals"],
  // Account order history.
  ["account orders — empty", "orders-empty"],
  ["account orders — ordinary", "orders-ordinary"],
  ["account orders — mixed", "orders-mixed"],
  ["account orders — all states", "orders-all"],
  // Gift-card refund and dispute states.
  ["gift-card refund states", "refund-states"],
  // Recipient credit.
  ["recipient credit frozen", "credit-frozen"],
  ["recipient credit restored", "credit-restored"],
  // Cash-redemption review.
  ["cash redemption — offer", "cash-redemption-offer"],
  ["cash redemption — open", "cash-redemption-open"],
  ["cash redemption — eligible", "cash-redemption-eligible"],
  ["cash redemption — closed", "cash-redemption-closed"]
] as const

for (const [label, fixture] of AUTHENTICATED) {
  test(`${label} has no serious or critical violations`, async ({ page }) => {
    const response = await page.goto(`/dev/preview/${fixture}`, { waitUntil: "domcontentloaded" })
    expect(response?.status(), `${fixture} did not load`).toBeLessThan(400)
    await scan(page, label)
  })
}

// ===========================================================================
// Keyboard operability on the surfaces that MOVE MONEY
// ===========================================================================

test("the signed-in store is fully keyboard operable with a visible ring", async ({ page }) => {
  await page.goto("/dev/preview/active-realvip", { waitUntil: "domcontentloaded" })

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab")
    const focused = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { visible: true, what: "(body)" }
      const s = getComputedStyle(el)
      const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
      const shadow =
        s.boxShadow !== "none" &&
        !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(s.boxShadow)
      return {
        visible: ring || shadow,
        what: `<${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 30)}"`
      }
    })
    expect(focused.visible, `tab stop ${i} ${focused.what} has no visible focus indicator`).toBe(true)
  }
})

test("the cash-redemption request is reachable and operable by keyboard alone", async ({ page }) => {
  // This button opens a legal review and freezes value. A customer who cannot
  // reach it with a keyboard cannot exercise a right the law may give them.
  await page.goto("/dev/preview/cash-redemption-offer", { waitUntil: "domcontentloaded" })

  const button = page.getByTestId("cash-redemption-request")
  await expect(button).toBeVisible()

  await button.focus()
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null
  )
  expect(focused, "the request control cannot take keyboard focus").toBe("cash-redemption-request")

  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element)
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none"
  })
  expect(ring, "the focused request control shows no ring").toBe(true)
})

test("every money state is announced, not signalled by color alone", async ({ page }) => {
  // WCAG 1.4.1. A refund state or a credit hold conveyed only by a colored
  // badge is invisible to a screen reader and to a colorblind customer.
  for (const [fixture, testid] of [
    ["credit-frozen", "store-credit-hold"],
    ["cash-redemption-open", "cash-redemption-status"]
  ] as const) {
    await page.goto(`/dev/preview/${fixture}`, { waitUntil: "domcontentloaded" })
    const block = page.getByTestId(testid)
    await expect(block).toHaveAttribute("role", "status")
    expect((await block.innerText()).trim().length, `${fixture} has no text`).toBeGreaterThan(20)
  }
})

test("order history tables carry programmatic structure", async ({ page }) => {
  // A table of purchases read as a flat run of text is unusable. If it renders
  // as a table it must have headers; if it renders as cards that is fine too.
  await page.goto("/dev/preview/orders-all", { waitUntil: "domcontentloaded" })

  const problems = await page.evaluate(() =>
    [...document.querySelectorAll("table")]
      .filter((t) => t.querySelectorAll("th").length === 0)
      .map((t) => t.className || "(unclassed table)")
  )
  expect(problems, "a table renders with no header cells").toEqual([])
})
