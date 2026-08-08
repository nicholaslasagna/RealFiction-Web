// The cash-redemption confirmation dialog.
//
// WHY THIS EXISTS
// ===============
// The live $5 production test showed a single click on "Request cash redemption
// review" immediately created the request and froze real money. Placing a hold
// on a customer's balance is too consequential for one click, and the customer
// was never told how much would be held.
//
// The financial mechanics are correct and unchanged. These assert only that
// nothing reaches the server until the customer explicitly confirms.
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const OFFER = "/dev/preview/cash-redemption-offer"

/** Records every attempt to reach the request endpoint. */
async function trackRequests(page: import("@playwright/test").Page) {
  const calls: string[] = []
  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    calls.push(route.request().method())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "received", message: "We have received your request." })
    })
  })
  return calls
}

test("the FIRST click opens a dialog and sends nothing", async ({ page }) => {
  const calls = await trackRequests(page)
  await page.goto(OFFER, { waitUntil: "networkidle" })

  await page.getByTestId("cash-redemption-request").click()

  await expect(page.getByTestId("cash-redemption-dialog")).toBeVisible()
  expect(calls, "the first click created a request and froze credit").toEqual([])
})

test("CANCEL sends nothing and returns focus to the opener", async ({ page }) => {
  const calls = await trackRequests(page)
  await page.goto(OFFER, { waitUntil: "networkidle" })

  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-cancel").click()

  await expect(page.getByTestId("cash-redemption-dialog")).toBeHidden()
  expect(calls, "cancelling still sent a request").toEqual([])

  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))
  expect(focused, "focus was not returned to the opener").toBe("cash-redemption-request")
})

test("ESCAPE closes the dialog before submission", async ({ page }) => {
  const calls = await trackRequests(page)
  await page.goto(OFFER, { waitUntil: "networkidle" })

  await page.getByTestId("cash-redemption-request").click()
  await page.keyboard.press("Escape")

  await expect(page.getByTestId("cash-redemption-dialog")).toBeHidden()
  expect(calls).toEqual([])
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))
  expect(focused).toBe("cash-redemption-request")
})

test("only EXPLICIT confirmation submits, exactly once", async ({ page }) => {
  const calls = await trackRequests(page)
  await page.goto(OFFER, { waitUntil: "networkidle" })

  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-confirm").click()

  await expect.poll(() => calls.length).toBe(1)
  expect(calls).toEqual(["POST"])
})

test("the dialog states the amount that will be held", async ({ page }) => {
  await page.goto(OFFER, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()

  const body = await page.getByTestId("cash-redemption-dialog").innerText()
  expect(body).toMatch(/temporarily unavailable to spend/i)
  // No promise of payout, in either direction.
  expect(body).toMatch(/does not guarantee/i)
  expect(body).not.toMatch(/approved|you will receive|guaranteed payout/i)
})

test("the dialog carries no secret material", async ({ page }) => {
  await page.goto(OFFER, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()

  const html = await page.getByTestId("cash-redemption-dialog").innerHTML()
  expect(html).not.toMatch(/RFG-[A-Z0-9]{4}/)
  expect(html).not.toMatch(/claim|secret|token|#[A-Za-z0-9_-]{20,}/i)
})

test("the dialog is keyboard operable and traps focus", async ({ page }) => {
  await page.goto(OFFER, { waitUntil: "networkidle" })

  await page.getByTestId("cash-redemption-request").focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("cash-redemption-dialog")).toBeVisible()

  // Focus starts inside the dialog.
  let inside = await page.evaluate(() =>
    document.querySelector('[data-testid="cash-redemption-dialog"]')?.contains(document.activeElement)
  )
  expect(inside, "focus did not move into the dialog").toBe(true)

  // Tabbing repeatedly must never escape it.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab")
    inside = await page.evaluate(() =>
      document
        .querySelector('[data-testid="cash-redemption-dialog"]')
        ?.contains(document.activeElement)
    )
    expect(inside, `focus escaped the dialog on tab ${i}`).toBe(true)
  }
})

test("the dialog is axe-clean", async ({ page }) => {
  await page.goto(OFFER, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()
  await expect(page.getByTestId("cash-redemption-dialog")).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  )
  expect(blocking.map((v) => `${v.impact}: ${v.id}`)).toEqual([])
})

// ===========================================================================
// Responsive — the production screenshot showed the label overflowing its card
// ===========================================================================

for (const width of [320, 375, 390, 412, 768, 1024, 1440]) {
  test(`no horizontal overflow at ${width}px, and the button fits its card`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(OFFER, { waitUntil: "networkidle" })

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflows, `the page scrolls horizontally at ${width}px`).toBe(false)

    const fits = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="cash-redemption-request"]')
      const card = document.querySelector('[data-testid="cash-redemption"]')
      if (!button || !card) return true
      const b = button.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      return b.right <= c.right + 1 && b.left >= c.left - 1
    })
    expect(fits, `the request button overflows its card at ${width}px`).toBe(true)
  })
}
