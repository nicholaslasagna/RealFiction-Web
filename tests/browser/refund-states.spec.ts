// The refund and dispute states, in a real browser.
//
// The DOM harness already proves the strings are served. What it cannot prove
// is that they survive hydration, that the badge is readable rather than merely
// colored, and that axe finds nothing serious or critical — which is the bar
// the owner set.
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  const summary = blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) — ${v.help}`).join("\n")
  expect(blocking, `${label}\n${summary}`).toEqual([])
}

test("the four purchaser states render and pass axe", async ({ page }) => {
  await page.goto("/dev/preview/refund-states")

  const blocks = page.getByTestId("gift-card-refund-state")
  await expect(blocks).toHaveCount(4)

  for (const label of ["Refunded", "Refund processing", "Refund requires review", "Disputed"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }

  await scan(page, "purchaser refund states")
})

test("a purchaser learns NOTHING about what the recipient did", async ({ page }) => {
  await page.goto("/dev/preview/refund-states")

  // One fixture card was claimed and partially spent. Nothing on this page may
  // say so — not the badge, not the sentence, not a hidden attribute.
  const body = (await page.locator("body").innerText()) + (await page.content())
  for (const leak of [/\$12\.99/, /partially/i, /spent/i, /chargeback/i, /provider_refund_pending/]) {
    expect(body, `leaked ${leak}`).not.toMatch(leak)
  }
})

test("each state is readable without seeing its color", async ({ page }) => {
  await page.goto("/dev/preview/refund-states")

  // Every block must carry a sentence, so the state survives grayscale, a
  // screen reader, and a color-blind reader alike.
  for (const block of await page.getByTestId("gift-card-refund-state").all()) {
    expect((await block.innerText()).trim().length).toBeGreaterThan(40)
  }
})

test("the recipient's frozen notice renders, announces itself, and passes axe", async ({ page }) => {
  await page.goto("/dev/preview/credit-frozen")

  const notice = page.getByTestId("store-credit-hold")
  await expect(notice).toBeVisible()
  await expect(notice).toHaveAttribute("role", "status")
  await expect(notice).toContainText("Frozen during payment review")
  await expect(notice).toContainText("$25.00 on hold")

  // The recipient is not a party to the chargeback and is never told about one.
  await expect(notice).not.toContainText(/dispute|chargeback|fraud/i)

  await scan(page, "recipient credit frozen")
})

test("the recipient's restored notice renders and passes axe", async ({ page }) => {
  await page.goto("/dev/preview/credit-restored")

  const notice = page.getByTestId("store-credit-hold")
  await expect(notice).toContainText("Restored after dispute resolution")
  await expect(notice).toContainText(/available again/i)
  await expect(notice).not.toContainText(/on hold/i)

  await scan(page, "recipient credit restored")
})
