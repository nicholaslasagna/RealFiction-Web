// The cash-redemption submit -> refetch -> render loop.
//
// THE REGRESSION THIS COVERS
// ==========================
// Confirming a request closed the modal but left the card unchanged, so a
// successful request that really did freeze money looked like nothing had
// happened. Three causes, all client-side:
//
//   * `loadBalance()` dropped the card to a skeleton before refetching, which
//     unmounted the hold notice, the panel, and the confirmation message;
//   * the modal closed on failure too, hiding the error behind the card;
//   * `giftOriginCents` was never mapped out of the response, so the dialog
//     always fell back to its amountless wording.
//
// Every other preview state renders the sub-components with fixture props.
// These drive the REAL AccountEconomyCard against intercepted routes, which is
// the only way to exercise the loop that actually broke.
import { expect, test, type Page, type Route } from "@playwright/test"

const LIVE = "/dev/preview/account-economy-live"

type Balance = {
  balanceCents: number
  holdCents: number
  giftOriginCents: number | null
  cashRedemptionState: string | null
}

const AVAILABLE: Balance = {
  balanceCents: 500,
  holdCents: 0,
  giftOriginCents: 500,
  cashRedemptionState: null
}

const PENDING: Balance = {
  balanceCents: 500,
  holdCents: 500,
  giftOriginCents: 0,
  cashRedemptionState: "requested"
}

/**
 * Serves the balance route from a mutable box, so a test can change what the
 * SERVER says and prove the card reconciles against it.
 */
async function serveBalance(page: Page, box: { value: Balance }) {
  await page.route("**/api/account/store-credit", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ currency: "USD", updatedAt: null, restoredRecently: false,
        hasGiftOriginCredit: box.value.giftOriginCents !== null && box.value.giftOriginCents > 0,
        ...box.value })
    })
  })
}

test("1. a NEW request becomes pending immediately, with no manual reload", async ({ page }) => {
  const box = { value: AVAILABLE }
  await serveBalance(page, box)
  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    // The server is now authoritative for the pending state.
    box.value = PENDING
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "received", message: "We have received your request." })
    })
  })

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await expect(page.getByTestId("cash-redemption-request")).toBeVisible()

  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-confirm").click()

  await expect(page.getByTestId("cash-redemption-dialog")).toBeHidden()
  // The hold notice is the thing that was missing.
  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")
  await expect(page.getByTestId("store-credit-hold")).toContainText("$5.00")
})

test("2. an ALREADY-OPEN response shows pending, not a silent no-op", async ({ page }) => {
  // The customer already has an open review; the server says so. This must look
  // identical to a fresh request rather than appearing to do nothing.
  const box = { value: AVAILABLE }
  await serveBalance(page, box)
  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    box.value = PENDING
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "already_open", message: "We have received your request." })
    })
  })

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-confirm").click()

  await expect(page.getByTestId("cash-redemption-dialog")).toBeHidden()
  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")
  // And the request control is gone — there is nothing left to request.
  await expect(page.getByTestId("cash-redemption-request")).toHaveCount(0)
})

test("3. a FAILED POST shows an error and KEEPS the dialog open", async ({ page }) => {
  const box = { value: AVAILABLE }
  await serveBalance(page, box)
  await page.route("**/api/store/gift-cards/cash-redemption", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "We could not start that review. Please try again later." })
    })
  )

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-confirm").click()

  // Still open, with the error inside it.
  await expect(page.getByTestId("cash-redemption-dialog")).toBeVisible()
  const error = page.getByTestId("cash-redemption-dialog-error")
  await expect(error).toBeVisible()
  await expect(error).toHaveAttribute("role", "alert")
  await expect(error).toContainText(/could not start/i)

  // And no pending state was invented on the client.
  await expect(page.getByTestId("store-credit-hold")).toHaveCount(0)
})

test("4. a RELOAD preserves the pending state", async ({ page }) => {
  // The database is authoritative; a refresh must agree with what was shown.
  const box = { value: PENDING }
  await serveBalance(page, box)

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")

  await page.reload({ waitUntil: "networkidle" })
  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")
  await expect(page.getByTestId("cash-redemption-request")).toHaveCount(0)
})

test("5. REJECTION returns the card to the available state", async ({ page }) => {
  const box = { value: PENDING }
  await serveBalance(page, box)

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")

  // Staff reject out of band; the hold is released.
  box.value = { balanceCents: 500, holdCents: 0, giftOriginCents: 500, cashRedemptionState: "rejected" }
  await page.reload({ waitUntil: "networkidle" })

  await expect(page.getByTestId("store-credit-hold")).toHaveCount(0)
  await expect(page.getByTestId("cash-redemption")).toContainText("Review closed")
})

test("the dialog states the amount from the SERVER, not a client guess", async ({ page }) => {
  // giftOriginCents was dropped during mapping, so this always fell back to the
  // wording with no figure in it.
  const box = { value: AVAILABLE }
  await serveBalance(page, box)

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()

  await expect(page.getByTestId("cash-redemption-dialog-amount")).toContainText("$5.00")
})

test("the card never blanks to a skeleton during revalidation", async ({ page }) => {
  // The skeleton is what destroyed the message and remounted the panel.
  const box = { value: AVAILABLE }
  await page.route("**/api/account/store-credit", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ currency: "USD", updatedAt: null, restoredRecently: false,
        hasGiftOriginCredit: true, ...box.value })
    })
  })
  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    box.value = PENDING
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "received", message: "We have received your request." })
    })
  })

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()
  await page.getByTestId("cash-redemption-confirm").click()

  // Mid-revalidation the card still shows real content, not a placeholder.
  await page.waitForTimeout(120)
  await expect(page.getByTestId("cash-redemption")).toBeVisible()

  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")
})

test("DOUBLE SUBMIT protection survives the fix", async ({ page }) => {
  const box = { value: AVAILABLE }
  const posts: string[] = []
  await serveBalance(page, box)
  await page.route("**/api/store/gift-cards/cash-redemption", async (route) => {
    posts.push(route.request().method())
    await new Promise((resolve) => setTimeout(resolve, 150))
    box.value = PENDING
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "received", message: "We have received your request." })
    })
  })

  await page.goto(LIVE, { waitUntil: "networkidle" })
  await page.getByTestId("cash-redemption-request").click()

  const confirm = page.getByTestId("cash-redemption-confirm")
  await confirm.click()
  await confirm.click({ force: true }).catch(() => undefined)
  await confirm.click({ force: true }).catch(() => undefined)

  await expect(page.getByTestId("store-credit-hold")).toContainText("Cash redemption review pending")
  expect(posts, `duplicate submissions: ${posts.length}`).toEqual(["POST"])
})
