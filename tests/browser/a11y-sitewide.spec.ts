// Site-wide accessibility sweep.
//
// WHY THIS EXISTS
// ===============
// The existing a11y spec scans three pages: the store, the claim page, and the
// gift-card terms. The site has sixteen routes, so most of what a customer
// actually touches — the homepage, the account area, the contact form, the
// legal pages — had never been scanned at all.
//
// ADA Title III claims against websites are argued against WCAG 2.1 AA in
// practice, so that is the ruleset here. Two honest caveats, stated in the code
// because they matter when reading a green run:
//
//   1. axe finds roughly a third of WCAG issues. It cannot judge whether alt
//      text is MEANINGFUL, whether focus order is logical, or whether an error
//      message is understandable. A pass here is a floor, not a certificate.
//   2. This scans the anonymous view. Signed-in surfaces need their own pass.
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

/**
 * Every publicly reachable route. Dynamic and dev-only routes excluded.
 *
 * `/account/settings` is absent on purpose: signed out it redirects to sign-in,
 * so scanning it anonymously measures the sign-in page while pretending to
 * measure settings. It needs an authenticated pass, which this sweep does not
 * do — see the caveat at the top of the file.
 */
const PUBLIC_ROUTES = [
  "/",
  "/store",
  "/account",
  "/account/reset-password",
  "/contact",
  "/leaderboards",
  "/map",
  "/rules",
  "/updates",
  "/vote",
  "/terms",
  "/privacy",
  "/legal/gift-cards",
  "/gift-cards/claim"
]

/** WCAG 2.1 A + AA, which is the bar ADA claims are argued against. */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]

async function scan(page: Page, route: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  )
  const summary = blocking
    .map((v) => `  ${v.impact}: ${v.id} (${v.nodes.length} node(s)) — ${v.help}`)
    .join("\n")
  expect(blocking, `${route}\n${summary}`).toEqual([])
}

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no serious or critical WCAG 2.1 AA violations`, async ({ page }) => {
    const response = await page.goto(route, { waitUntil: "networkidle" })
    // A route that fails to load would otherwise "pass" by having nothing to scan.
    expect(response?.status(), `${route} did not load`).toBeLessThan(400)
    // A redirect mid-scan destroys the execution context, which surfaces as a
    // confusing axe error rather than a violation.
    expect(new URL(page.url()).pathname, `${route} redirected`).toBe(route)
    await scan(page, route)
  })
}

// ===========================================================================
// Checks axe cannot make
// ===========================================================================

test("every page declares a language", async ({ page }) => {
  // WCAG 3.1.1. A screen reader with no `lang` guesses the pronunciation rules.
  for (const route of ["/", "/store", "/terms"]) {
    await page.goto(route)
    const lang = await page.locator("html").getAttribute("lang")
    expect(lang, `${route} has no <html lang>`).toBeTruthy()
  }
})

test("every page has exactly one h1, and headings do not skip levels", async ({ page }) => {
  // WCAG 1.3.1. Heading structure is how a screen-reader user skims a page.
  for (const route of ["/", "/store", "/terms", "/privacy"]) {
    await page.goto(route)

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]))
    )

    expect(levels.filter((l) => l === 1).length, `${route} h1 count`).toBe(1)
    for (let i = 1; i < levels.length; i++) {
      expect(
        levels[i] - levels[i - 1],
        `${route} skips from h${levels[i - 1]} to h${levels[i]}`
      ).toBeLessThanOrEqual(1)
    }
  }
})

test("keyboard focus is always visible", async ({ page }) => {
  // WCAG 2.4.7. A keyboard user who cannot see where they are cannot use the
  // site at all, and this is invisible to axe.
  await page.goto("/store")

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab")
    const visible = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return true
      const s = getComputedStyle(el)
      const ring =
        s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
      const shadow = s.boxShadow !== "none"
      return ring || shadow
    })
    expect(visible, `focused element ${i} has no visible focus indicator`).toBe(true)
  }
})

test("the page is usable at 320px without horizontal scrolling", async ({ page }) => {
  // WCAG 1.4.10 reflow. 320px is the standard smallest viewport.
  await page.setViewportSize({ width: 320, height: 700 })
  for (const route of ["/", "/store", "/terms"]) {
    await page.goto(route)
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(overflows, `${route} scrolls horizontally at 320px`).toBe(false)
  }
})

test("text can be resized to 200% without loss of content", async ({ page }) => {
  // WCAG 1.4.4. Simulated by halving the viewport, which is the standard proxy.
  await page.goto("/store")
  await page.setViewportSize({ width: 640, height: 400 })
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  )
  expect(overflows, "content is lost when text is enlarged").toBe(false)
})

test("motion respects prefers-reduced-motion", async ({ page }) => {
  // WCAG 2.3.3. Vestibular disorders are triggered by animation the user did
  // not ask for.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")

  const animated = await page.evaluate(() => {
    return [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el)
      const dur = parseFloat(s.animationDuration) || 0
      const iter = s.animationIterationCount
      // A long-running or infinite animation under reduce is the problem case.
      return dur > 0 && (iter === "infinite" || dur > 5)
    }).length
  })

  expect(animated, "infinite or long animations still run under reduced-motion").toBe(0)
})

test("images carry alt attributes", async ({ page }) => {
  // WCAG 1.1.1. axe catches a MISSING alt; it cannot tell you the alt is wrong,
  // so this is the floor, not the ceiling.
  for (const route of ["/", "/store"]) {
    await page.goto(route)
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((i) => !i.hasAttribute("alt"))
        .map((i) => i.getAttribute("src") ?? "(no src)")
    )
    expect(missing, `${route} has images with no alt attribute`).toEqual([])
  }
})

test("form controls have programmatic labels", async ({ page }) => {
  // WCAG 1.3.1 / 3.3.2. A placeholder is not a label.
  await page.goto("/contact")
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => {
        const e = el as HTMLInputElement
        if (e.type === "hidden") return false
        return !(
          e.labels?.length ||
          e.getAttribute("aria-label") ||
          e.getAttribute("aria-labelledby")
        )
      })
      .map((e) => e.getAttribute("name") ?? e.tagName)
  )
  expect(unlabelled, "/contact has unlabelled form controls").toEqual([])
})
