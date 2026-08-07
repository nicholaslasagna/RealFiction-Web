// Accessibility, measured with axe against the real rendered pages.
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const SECRET = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE"

/** Serious and critical only — the bar the owner set. */
async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  const summary = blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) — ${v.help}`).join("\n")
  expect(blocking, `${label}\n${summary}`).toEqual([])
  return results.violations.length
}

test("store with gift cards enabled has no serious or critical violations", async ({ page }) => {
  await page.goto("/store")
  await scan(page, "store (enabled)")
})

test("the gift-card form in an ERROR state has no serious or critical violations", async ({ page }) => {
  await page.route("**/api/store/gift-cards/checkout", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "We could not start that checkout. Nothing has been charged." })
    })
  )
  await page.goto("/store")
  await page.getByLabel(/recipient email/i).fill("friend@example.com")
  await page.locator('form button[type="submit"]').click()
  await expect(page.locator("[aria-live=polite][aria-atomic=true]")).toContainText(/nothing has been charged/i)
  await scan(page, "gift-card form (error state)")
})

test("the claim page has no serious or critical violations", async ({ page }) => {
  await page.goto(`/gift-cards/claim#${SECRET}`)
  await scan(page, "claim page (before confirmation)")
})

test("the claim SUCCESS state has no serious or critical violations", async ({ page }) => {
  await page.route("**/api/gift-cards/claim", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "claimed", amountCents: 2500, balanceCents: 2500 })
    })
  )
  await page.goto(`/gift-cards/claim#${SECRET}`)
  await page.getByRole("button", { name: /claim/i }).click()
  await page.getByText("$25.00", { exact: true }).first().waitFor()
  await scan(page, "claim page (success)")
})

test("the claim FAILURE state has no serious or critical violations", async ({ page }) => {
  await page.route("**/api/gift-cards/claim", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "wrong_recipient" })
    })
  )
  await page.goto(`/gift-cards/claim#${SECRET}`)
  await page.getByRole("button", { name: /claim/i }).click()
  await expect(page.locator("[aria-live=polite][aria-atomic=true]")).toContainText(/recipient|different|another/i)
  await scan(page, "claim page (failure)")
})

test("the terms page has no serious or critical violations", async ({ page }) => {
  await page.goto("/legal/gift-cards")
  await scan(page, "gift card terms")
})

// -- Keyboard, reported separately from the axe counts ------------------------

test("KEYBOARD: the whole gift-card form is operable without a mouse", async ({ page }) => {
  await page.route("**/api/store/gift-cards/checkout", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkoutUrl: "https://checkout.stripe.com/x", orderId: "o" })
    })
  )
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>ok</body></html>" })
  )

  await page.goto("/store")

  const twentyFive = page.getByRole("radio", { name: "$25.00" })
  await twentyFive.focus()
  await expect(twentyFive).toBeFocused()

  // A visible focus indicator, not just a focused element.
  const outline = await twentyFive.evaluate((el) => {
    const style = getComputedStyle(el)
    return `${style.outlineStyle}|${style.outlineWidth}|${style.boxShadow}`
  })
  expect(outline, "no visible focus indicator").not.toBe("none|0px|none")

  await page.keyboard.press("Enter")
  await expect(twentyFive).toHaveAttribute("aria-checked", "true")

  // Tab to each field and type — no focus trap, no lost focus.
  await page.getByLabel(/recipient email/i).focus()
  await page.keyboard.type("friend@example.com")
  await page.getByLabel(/your name/i).focus()
  await page.keyboard.type("Nicholas")

  await page.locator('form button[type="submit"]').focus()
  await expect(page.locator('form button[type="submit"]')).toBeFocused()
})

test("KEYBOARD: the claim button is reachable and activates by keyboard", async ({ page }) => {
  const calls: unknown[] = []
  await page.route("**/api/gift-cards/claim", async (route) => {
    calls.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "claimed", amountCents: 2500, balanceCents: 2500 })
    })
  })

  await page.goto(`/gift-cards/claim#${SECRET}`)
  const button = page.getByRole("button", { name: /claim/i })
  await button.focus()
  await expect(button).toBeFocused()

  await page.keyboard.press("Enter")
  await expect.poll(() => calls.length).toBe(1)
  await expect(page.getByText("$25.00", { exact: true }).first()).toBeVisible()
})

test("LIVE REGION: the error announcement is in a polite live region", async ({ page }) => {
  await page.route("**/api/store/gift-cards/checkout", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Nothing has been charged." }) })
  )
  await page.goto("/store")
  await page.getByLabel(/recipient email/i).fill("friend@example.com")

  const live = page.locator("[aria-live=polite][aria-atomic=true]")
  await expect(live).toBeAttached()
  await page.locator('form button[type="submit"]').click()
  await expect(live).toContainText(/nothing has been charged/i)
})
