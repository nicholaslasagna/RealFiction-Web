// Gift cards ON, via explicit test-only gate values.
//
// The same mounted components as production — no alternate storefront. Only the
// outbound checkout call is intercepted, so the form, its validation, and the
// request it builds are all the real ones.
import { expect, test, type Page } from "@playwright/test"

/** Fields the request may carry. Anything else is a finding. */
const ALLOWED_KEYS = new Set([
  "slug",
  "recipientEmail",
  "senderName",
  "message",
  "sendToSelf",
  "checkoutAttemptId"
])

const FORBIDDEN = [
  "amount", "amountCents", "price", "priceCents", "currency",
  "stripePriceId", "priceId", "stripeProductId", "productId",
  "storeCreditCents", "creditLotId", "giftCardId", "ledgerEntryId",
  "secret", "verifier", "ciphertext", "keyVersion", "recipientUserId"
]

async function stubCheckout(page: Page, response: { status: number; body: unknown }) {
  const captured: { body: unknown }[] = []
  await page.route("**/api/store/gift-cards/checkout", async (route) => {
    captured.push({ body: route.request().postDataJSON() })
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body)
    })
  })
  return captured
}

async function giftSection(page: Page) {
  await page.goto("/store")
  return page.getByRole("radiogroup", { name: /choose an amount/i })
}

test.describe("gift-card purchase form", () => {
  test("renders all nine approved denominations as a radio group", async ({ page }) => {
    const group = await giftSection(page)
    await expect(group).toBeVisible()

    for (const amount of ["$5.00", "$10.00", "$15.00", "$20.00", "$25.00", "$30.00", "$50.00", "$75.00", "$100.00"]) {
      await expect(group.getByRole("radio", { name: amount })).toBeVisible()
    }
    await expect(group.getByRole("radio")).toHaveCount(9)
  })

  test("exactly one denomination is selected at a time, by mouse", async ({ page }) => {
    const group = await giftSection(page)
    await group.getByRole("radio", { name: "$50.00" }).click()

    await expect(group.getByRole("radio", { name: "$50.00" })).toHaveAttribute("aria-checked", "true")
    await expect(group.getByRole("radio", { name: "$25.00" })).toHaveAttribute("aria-checked", "false")
    await expect(group.locator('[aria-checked="true"]')).toHaveCount(1)
  })

  test("the group is keyboard reachable and operable", async ({ page }) => {
    const group = await giftSection(page)
    const hundred = group.getByRole("radio", { name: "$100.00" })

    await hundred.focus()
    await expect(hundred).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(hundred).toHaveAttribute("aria-checked", "true")
  })

  test("NO fake popularity, urgency, or client-editable money", async ({ page }) => {
    await page.goto("/store")
    const body = await page.locator("body").innerText()

    expect(body).not.toMatch(/most popular/i)
    expect(body).not.toMatch(/hurry|limited time|ends soon|only \d+ left/i)

    // No input may carry a monetary or provider identifier.
    const names = await page.locator("input, select").evaluateAll((els) =>
      els.map((el) => `${(el as HTMLInputElement).name}|${el.id}`.toLowerCase())
    )
    for (const name of names) {
      expect(name).not.toMatch(/price|amount|currency|stripe|product_id/)
    }
  })

  test("the checkout request carries a SKU and NO monetary value", async ({ page }) => {
    const captured = await stubCheckout(page, {
      status: 200,
      body: { checkoutUrl: "https://checkout.stripe.com/test", orderId: "order-1" }
    })

    const group = await giftSection(page)
    await group.getByRole("radio", { name: "$25.00" }).click()
    await page.getByLabel(/recipient email/i).fill("friend@example.com")
    await page.getByLabel(/your name/i).fill("Nicholas")
    await page.getByLabel(/message/i).fill("Happy birthday!")
    await page.getByRole("button", { name: /buy \$25\.00 gift card/i }).click()

    await expect.poll(() => captured.length).toBe(1)
    const body = captured[0].body as Record<string, unknown>

    expect(body.slug).toBe("gift-card-25")
    expect(body.recipientEmail).toBe("friend@example.com")
    expect(body.senderName).toBe("Nicholas")

    // THE POINT: the browser names a SKU, never a price.
    for (const key of FORBIDDEN) {
      expect(body, `request carried forbidden key "${key}"`).not.toHaveProperty(key)
    }
    for (const key of Object.keys(body)) {
      expect(ALLOWED_KEYS.has(key), `unexpected key "${key}" in the request`).toBe(true)
    }
    expect(JSON.stringify(body)).not.toContain("2500")
  })

  test("send-to-self does not submit a client-supplied recipient", async ({ page }) => {
    const captured = await stubCheckout(page, {
      status: 200,
      body: { checkoutUrl: "https://checkout.stripe.com/test", orderId: "order-2" }
    })

    await page.goto("/store")
    await page.getByLabel(/send it to me/i).check()
    // The recipient field is removed entirely when sending to self.
    await expect(page.getByLabel(/recipient email/i)).toHaveCount(0)

    await page.getByRole("button", { name: /buy .* gift card/i }).click()
    await expect.poll(() => captured.length).toBe(1)

    const body = captured[0].body as Record<string, unknown>
    expect(body.sendToSelf).toBe(true)
    // The server uses the session address; the browser must not name one.
    expect(body.recipientEmail === undefined || body.recipientEmail === "").toBe(true)
  })

  test("a loading state appears and DOUBLE SUBMISSION is blocked", async ({ page }) => {
    let calls = 0
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    await page.route("**/api/store/gift-cards/checkout", async (route) => {
      calls++
      // Held open until the test releases it, so the in-flight window is
      // deterministic rather than a race against a timer.
      await held
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkoutUrl: "https://checkout.stripe.com/test", orderId: "o" })
      })
    })
    // The success path navigates to Stripe. Stub the destination so the browser
    // does not leave localhost — and so the assertions below are not racing a
    // real navigation.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>stripe</body></html>" })
    )

    await page.goto("/store")
    await page.getByLabel(/recipient email/i).fill("friend@example.com")
    // By ROLE+TYPE, not by name: the accessible name deliberately changes to
    // "Starting checkout…" while submitting, so a name-based locator stops
    // matching the very element under test.
    const button = page.locator('form button[type="submit"]')

    await button.click()
    await expect(button).toBeDisabled()
    await expect(page.getByText(/starting secure checkout/i)).toBeVisible()

    // Three more attempts while the request is still in flight.
    for (let attempt = 0; attempt < 3; attempt++) {
      await button.click({ force: true, timeout: 2000 }).catch(() => undefined)
    }
    expect(calls, "a disabled button must not re-submit").toBe(1)

    release()
    await expect.poll(() => calls, { timeout: 10_000 }).toBe(1)
  })

  test("a server failure is shown, announced, and preserves the form", async ({ page }) => {
    await stubCheckout(page, { status: 502, body: { error: "We could not start that checkout. Nothing has been charged." } })

    await page.goto("/store")
    await page.getByLabel(/recipient email/i).fill("friend@example.com")
    await page.getByLabel(/your name/i).fill("Nicholas")
    await page.getByRole("button", { name: /buy .* gift card/i }).click()

    const alert = page.locator("[aria-live=polite]")
    await expect(alert).toContainText(/nothing has been charged/i)
    // The customer's input survives the failure.
    await expect(page.getByLabel(/your name/i)).toHaveValue("Nicholas")
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toBeEnabled()
  })

  test("a network failure does not claim success", async ({ page }) => {
    await page.route("**/api/store/gift-cards/checkout", (route) => route.abort("failed"))

    await page.goto("/store")
    await page.getByLabel(/recipient email/i).fill("friend@example.com")
    await page.getByRole("button", { name: /buy .* gift card/i }).click()

    await expect(page.locator("[aria-live=polite]")).toContainText(/nothing has been charged/i)
  })

  test("grapheme limits are counted and surfaced", async ({ page }) => {
    await page.goto("/store")

    // A family emoji is ONE user-perceived character and eight UTF-16 units.
    // Counting `.length` would reject a short name.
    await page.getByLabel(/your name/i).fill("👨‍👩‍👧 Nick")
    await expect(page.getByText(/6\s*\/\s*60 characters/)).toBeVisible()

    await page.getByLabel(/your name/i).fill("x".repeat(61))
    await expect(page.getByText(/61\s*\/\s*60 characters/)).toBeVisible()
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toBeDisabled()

    await page.getByLabel(/your name/i).fill("Nick")
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toBeEnabled()
  })

  test("the message limit disables submission until corrected", async ({ page }) => {
    await page.goto("/store")
    await page.getByLabel(/message/i).fill("m".repeat(501))
    await expect(page.getByText(/501\s*\/\s*500 characters/)).toBeVisible()
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toBeDisabled()

    await page.getByLabel(/message/i).fill("short")
    await expect(page.getByRole("button", { name: /buy .* gift card/i })).toBeEnabled()
  })

  test("the terms link works from the form", async ({ page }) => {
    await page.goto("/store")
    await page.getByRole("link", { name: /gift card terms/i }).click()
    await expect(page).toHaveURL(/\/legal\/gift-cards$/)
    await expect(page.getByText(/draft — not yet in effect/i)).toBeVisible()
  })
})
