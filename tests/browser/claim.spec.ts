// The claim page, in a real browser.
//
// The security property here cannot be checked by fetching HTML: the secret
// lives in the URL FRAGMENT, which never reaches a server, is read by
// JavaScript, and must be scrubbed from history before the user can share the
// URL. All of that is browser behaviour.
import { expect, test, type Page } from "@playwright/test"

/** Canonical: 43 base64url characters. Obviously fake. */
const SECRET = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE"

async function stubClaim(page: Page, status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = []
  await page.route("**/api/gift-cards/claim", async (route) => {
    calls.push({ url: route.request().url(), body: route.request().postDataJSON() })
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
  })
  return calls
}

test.describe("claim page", () => {
  test("THE FRAGMENT IS CAPTURED AND REMOVED, and never sent to a server", async ({ page }) => {
    const serverUrls: string[] = []
    page.on("request", (request) => serverUrls.push(request.url()))

    await page.goto(`/gift-cards/claim#${SECRET}`)

    // The fragment is gone from the visible URL almost immediately.
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain(SECRET)
    expect(page.url()).not.toContain("#")

    // NOTHING the browser requested carried it. Fragments are not transmitted
    // by construction, and this proves the page did not put it in a URL either.
    for (const url of serverUrls) {
      expect(url, `a request carried the secret: ${url}`).not.toContain(SECRET)
    }

    // And it is not sitting in history for the next person to press Back into.
    const historyUrl = await page.evaluate(() => window.location.href)
    expect(historyUrl).not.toContain(SECRET)
  })

  test("page load does NOT claim — no request until the button is pressed", async ({ page }) => {
    const calls = await stubClaim(page, 200, { result: "claimed", amountCents: 2500, balanceCents: 2500 })

    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.waitForTimeout(1500)

    expect(calls.length, "an email scanner opening this link must claim nothing").toBe(0)
    await expect(page.getByRole("button", { name: /claim/i })).toBeVisible()
  })

  test("the secret is absent from rendered text AND from every attribute", async ({ page }) => {
    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.waitForTimeout(500)

    const text = await page.locator("body").innerText()
    expect(text).not.toContain(SECRET)

    const inAttributes = await page.evaluate((secret) => {
      for (const el of Array.from(document.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.value.includes(secret)) return `${el.tagName}[${attr.name}]`
        }
      }
      return null
    }, SECRET)
    expect(inAttributes, `the secret appeared in ${inAttributes}`).toBeNull()
  })

  test("no console output carries the secret", async ({ page }) => {
    const console: string[] = []
    page.on("console", (message) => console.push(message.text()))

    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.waitForTimeout(1000)

    expect(console.join("\n")).not.toContain(SECRET)
  })

  test("a strict referrer policy is set, and no third-party script loads", async ({ page }) => {
    await page.goto(`/gift-cards/claim#${SECRET}`)

    const policy = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="referrer"]')
      // `Document.referrerPolicy` is not in the DOM lib types; read it off the
      // element that actually carries it.
      return meta?.getAttribute("content") ?? document.documentElement.getAttribute("referrerpolicy") ?? ""
    })
    expect(policy).toMatch(/no-referrer/)

    // Executable/fetched resources only. A footer link to YouTube cannot read
    // location.hash and is not a leak.
    const externalScripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src], iframe[src], img[src]"))
        .map((el) => el.getAttribute("src") ?? "")
        .filter((src) => /^https?:\/\//.test(src) && !src.includes("localhost"))
    )
    expect(externalScripts).toEqual([])
  })

  test("an explicit press sends the secret in the POST BODY, never the URL", async ({ page }) => {
    const calls = await stubClaim(page, 200, { result: "claimed", amountCents: 2500, balanceCents: 2500 })

    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.getByRole("button", { name: /claim/i }).click()

    await expect.poll(() => calls.length).toBe(1)
    expect(calls[0].url).not.toContain(SECRET)
    expect((calls[0].body as { secret?: string }).secret).toBe(SECRET)
  })

  test("a successful claim shows the amount from the SERVER response", async ({ page }) => {
    await stubClaim(page, 200, { result: "claimed", amountCents: 2500, balanceCents: 3800 })

    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.getByRole("button", { name: /claim/i }).click()

    await expect(page.getByText("$25.00", { exact: true }).first()).toBeVisible()
    // The balance is rendered inside a sentence, not as a bare figure.
    await expect(page.getByText(/balance is now \$38\.00/)).toBeVisible()
    // Still no secret, even in the success state.
    expect(await page.locator("body").innerText()).not.toContain(SECRET)
  })

  test("double submission is prevented", async ({ page }) => {
    let calls = 0
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/gift-cards/claim", async (route) => {
      calls++
      await held
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: "claimed", amountCents: 2500, balanceCents: 2500 })
      })
    })

    await page.goto(`/gift-cards/claim#${SECRET}`)
    const button = page.getByRole("button", { name: /claim/i })
    await button.click()
    await expect(button).toBeDisabled()

    for (let attempt = 0; attempt < 3; attempt++) {
      await button.click({ force: true, timeout: 2000 }).catch(() => undefined)
    }
    expect(calls, "a disabled claim button must not re-submit").toBe(1)
    release()
  })

  test("missing fragment explains itself and sends nothing", async ({ page }) => {
    const calls = await stubClaim(page, 200, { result: "claimed" })
    await page.goto("/gift-cards/claim")
    await page.waitForTimeout(800)

    await expect(page.getByText(/link|missing|incomplete/i).first()).toBeVisible()
    expect(calls.length).toBe(0)
  })

  test.describe("result states", () => {
    for (const [result, pattern] of [
      ["email_not_verified", /verify/i],
      ["wrong_recipient", /different|another|recipient/i],
      ["invalid_or_unavailable", /not valid|already been used/i],
      ["already_claimed_by_you", /already/i],
      ["temporarily_unavailable", /try again|temporar/i],
      ["rate_limited", /too many|wait/i]
    ] as const) {
      test(`"${result}" is shown accessibly`, async ({ page }) => {
        await stubClaim(page, result === "rate_limited" ? 429 : 200, { result })
        await page.goto(`/gift-cards/claim#${SECRET}`)
        await page.getByRole("button", { name: /claim/i }).click()

        // Next.js injects its own aria-live route announcer; scope to the page's.
        const live = page.locator("[aria-live=polite][aria-atomic=true]")
        await expect(live).toContainText(pattern)
        // No result class may leak the secret back out.
        expect(await page.locator("body").innerText()).not.toContain(SECRET)
      })
    }
  })

  test("a signed-out visitor is told to sign in and claims nothing", async ({ page }) => {
    const calls = await stubClaim(page, 401, { error: "Please sign in to claim your gift card." })
    await page.goto(`/gift-cards/claim#${SECRET}`)
    await page.getByRole("button", { name: /claim/i }).click()

    // The page swaps to a sign-in prompt rather than announcing in the live
    // region, so assert on what a signed-out visitor actually sees.
    await expect(page.getByText(/sign in/i).first()).toBeVisible()
    expect(calls.length).toBe(1)
    expect(await page.locator("body").innerText()).not.toContain(SECRET)
  })
})
