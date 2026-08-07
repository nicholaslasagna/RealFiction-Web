// The cash-redemption review surface, in a real browser.
//
// The DOM harness proves the strings are served. This proves they survive
// hydration, that the button really submits to the real endpoint, and that the
// one thing this UI must never do — read as a promise of payment — does not
// creep back in through interaction state.
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  const summary = blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) — ${v.help}`).join("\n")
  expect(blocking, `${label}\n${summary}`).toEqual([])
}

test("the entry point renders, asks for a review, and passes axe", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-offer")

  await expect(page.getByTestId("cash-redemption-request")).toBeVisible()
  await expect(page.getByText(/request cash redemption review/i)).toBeVisible()
  await expect(page.getByText(/does not guarantee a payout/i)).toBeVisible()

  await scan(page, "cash-redemption entry point")
})

test("NO AMOUNT AND NO PAYOUT ESTIMATE appears in the panel", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-offer")

  const panel = (await page.getByTestId("cash-redemption").innerText()).toLowerCase()
  expect(panel).not.toMatch(/\$\d/)
  expect(panel).not.toMatch(/estimate|you will receive|we will pay|approved|eligible for/)
})

test("submitting reaches the REAL endpoint and shows the server's wording", async ({ page }) => {
  let posted = 0
  let body: string | null = null

  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    posted++
    body = route.request().postData()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "received",
        message:
          "We have received your request and a member of our team will review it. We will email you with the outcome."
      })
    })
  })

  await page.goto("/dev/preview/cash-redemption-offer")
  await page.getByTestId("cash-redemption-request").click()

  await expect(page.getByTestId("cash-redemption-message")).toContainText(/we will email you/i)
  expect(posted).toBe(1)
  // The client sends NOTHING that could assert a value.
  expect(body).toBe("{}")

  await scan(page, "cash-redemption after submission")
})

test("a not-eligible answer says so without a reason, and promises nothing", async ({ page }) => {
  await page.route("**/api/store/gift-cards/cash-redemption", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "not_eligible",
        message:
          "We could not find gift-card credit on your account that is eligible for a cash-redemption review."
      })
    })
  )

  await page.goto("/dev/preview/cash-redemption-offer")
  await page.getByTestId("cash-redemption-request").click()

  const message = await page.getByTestId("cash-redemption-message").innerText()
  expect(message).toMatch(/could not find/i)
  expect(message).not.toMatch(/promotional|disputed|spent|reserved|state law|jurisdiction/i)

  await scan(page, "cash-redemption not eligible")
})

test("an open review shows status only, with no second button", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-open")

  await expect(page.getByTestId("cash-redemption-status")).toBeVisible()
  await expect(page.getByText("Review requested", { exact: true })).toBeVisible()
  await expect(page.getByTestId("cash-redemption-request")).toHaveCount(0)

  await scan(page, "cash-redemption open review")
})

test("AN INTERNALLY ELIGIBLE REVIEW NEVER READS AS APPROVED", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-eligible")

  await expect(page.getByTestId("cash-redemption-status")).toContainText("Under review")
  const panel = (await page.getByTestId("cash-redemption").innerText()).toLowerCase()
  expect(panel).not.toMatch(/approved|eligible|qualif|payout/)

  await scan(page, "cash-redemption eligible")
})

test("a closed review gives no reason and leaves credit alone", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-closed")

  await expect(page.getByTestId("cash-redemption-status")).toContainText("Review closed")
  await expect(page.getByText(/store credit is unchanged/i)).toBeVisible()

  const panel = (await page.getByTestId("cash-redemption").innerText()).toLowerCase()
  expect(panel).not.toMatch(/because|state law|jurisdiction|threshold|rejected|ineligible/)

  await scan(page, "cash-redemption closed")
})

test("the panel is announced to a screen reader, not signalled by color alone", async ({ page }) => {
  await page.goto("/dev/preview/cash-redemption-open")
  await expect(page.getByTestId("cash-redemption-status")).toHaveAttribute("role", "status")
  // The badge label is real text, so the state survives without color.
  await expect(page.getByTestId("cash-redemption-status")).toContainText(/review/i)
})
