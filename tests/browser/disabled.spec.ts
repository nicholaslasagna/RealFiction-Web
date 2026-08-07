// Gift cards OFF — the production default.
//
// The gate is a server decision, so "hidden in the browser" is not the claim
// being tested: with the environment values absent, the purchase form is never
// rendered at all.
import { expect, test } from "@playwright/test"

test.describe("store with gift cards disabled", () => {
  test("renders the coming-soon card and NO purchase controls", async ({ page }) => {
    await page.goto("/store")

    await expect(page.getByText("Coming soon")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Gift cards", exact: true })).toBeVisible()

    // Nothing that could start a purchase exists in the document.
    await expect(page.getByRole("radiogroup", { name: /choose an amount/i })).toHaveCount(0)
    await expect(page.getByLabel(/recipient email/i)).toHaveCount(0)
    await expect(page.getByLabel(/your name/i)).toHaveCount(0)
    await expect(page.getByLabel(/message/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toHaveCount(0)
  })

  test("no denomination appears anywhere in the gift-card section", async ({ page }) => {
    await page.goto("/store")
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Gift cards", exact: true }) })
    for (const amount of ["$5.00", "$25.00", "$100.00"]) {
      await expect(section.getByText(amount, { exact: true })).toHaveCount(0)
    }
  })

  test("empty-cart copy does not offer gift cards", async ({ page }) => {
    await page.goto("/store")
    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/or gift cards/i)
  })

  test("the terms page is reachable and marked a draft", async ({ page }) => {
    const response = await page.goto("/legal/gift-cards")
    expect(response?.status()).toBe(200)
    await expect(page.getByText(/draft — not yet in effect/i)).toBeVisible()
    await expect(page.getByText(/not redeemable for cash except where required by law/i)).toBeVisible()
  })

  test("navigating directly exposes no hidden purchase form", async ({ page }) => {
    await page.goto("/store#gift-cards")
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toHaveCount(0)
    // And the checkout endpoint refuses before creating anything.
    const refusal = await page.request.post("/api/store/gift-cards/checkout", {
      data: { slug: "gift-card-25", recipientEmail: "x@e.test", checkoutAttemptId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }
    })
    expect(refusal.status()).toBe(503)
  })
})
