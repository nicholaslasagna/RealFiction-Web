// Layout at every target width, measured rather than eyeballed.
//
// `scrollWidth > clientWidth` is the objective test for horizontal overflow;
// a screenshot can look fine and still scroll.
import { expect, test } from "@playwright/test"
import { mkdirSync } from "node:fs"

const SECRET = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE"
const SHOTS = "test-results/screenshots"
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "laptop-1280x800", width: 1280, height: 800 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "narrow-320x700", width: 320, height: 700 }
] as const

for (const viewport of VIEWPORTS) {
  test(`store has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto("/store")

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }))
    expect(
      overflow.scrollWidth,
      `page scrolls horizontally: ${overflow.scrollWidth} > ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1)
  })

  test(`gift-card controls fit and stay usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto("/store")

    const group = page.getByRole("radiogroup", { name: /choose an amount/i })
    await group.scrollIntoViewIfNeeded()

    // No control may be wider than the viewport, and every one must be a
    // usable touch target on a phone.
    for (const radio of await group.getByRole("radio").all()) {
      const box = await radio.boundingBox()
      expect(box, "a denomination has no layout box").not.toBeNull()
      expect(box!.width).toBeLessThanOrEqual(viewport.width)
      if (viewport.width <= 768) {
        expect(box!.height, "touch target too short").toBeGreaterThanOrEqual(40)
      }
    }

    const submit = page.locator('form button[type="submit"]')
    const submitBox = await submit.boundingBox()
    expect(submitBox!.width).toBeLessThanOrEqual(viewport.width)

    // The disclosures must not be clipped away.
    await expect(page.getByText(/never expires/i).first()).toBeVisible()
    await expect(page.getByText(/not redeemable for cash/i).first()).toBeVisible()
  })

  test(`claim page fits at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(`/gift-cards/claim#${SECRET}`)

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

    const button = page.getByRole("button", { name: /claim/i })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(viewport.width)
    if (viewport.width <= 768) {
      expect(box!.height).toBeGreaterThanOrEqual(40)
    }
  })
}

test("representative screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/store")
  await page.getByRole("radiogroup", { name: /choose an amount/i }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/store-gift-cards-enabled-1440.png`, fullPage: false })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByRole("radiogroup", { name: /choose an amount/i }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/store-gift-cards-enabled-390.png`, fullPage: false })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/gift-cards/claim#${SECRET}`)
  await page.screenshot({ path: `${SHOTS}/claim-before-confirmation-1440.png` })

  await page.route("**/api/gift-cards/claim", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "claimed", amountCents: 2500, balanceCents: 2500 })
    })
  )
  await page.getByRole("button", { name: /claim/i }).click()
  await page.getByText("$25.00", { exact: true }).first().waitFor()
  await page.screenshot({ path: `${SHOTS}/claim-success-1440.png` })

  await page.goto("/legal/gift-cards")
  await page.screenshot({ path: `${SHOTS}/gift-card-terms-1440.png`, fullPage: true })
})
