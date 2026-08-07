// The Player ID privacy control.
//
// The account page showed the player's full Minecraft UUID unprompted. It is
// not a secret — most Minecraft APIs expose it — but it is a durable identifier
// that links a person across servers, and this is the page people screenshot
// for support and show on stream. Masked by default is the privacy default
// nobody had to ask for.
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const PREVIEW = "/dev/preview/player-id"
const UUID = "00000000-1111-4222-8333-444444444444"

test("the Player ID is MASKED by default", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })

  const id = page.getByTestId("player-id")
  await expect(id).toBeVisible()
  await expect(id).toHaveAttribute("data-revealed", "false")

  const shown = (await id.innerText()).trim()
  expect(shown, "the real UUID is on screen by default").not.toContain(UUID)
  expect(shown, "the mask should keep dash positions").toMatch(/^[•]{8}-[•]{4}-[•]{4}-[•]{4}-[•]{12}$/)
})

test("reveal shows it, hide masks it again", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })
  const id = page.getByTestId("player-id")
  const toggle = page.getByTestId("player-id-toggle")

  await toggle.click()
  await expect(id).toHaveAttribute("data-revealed", "true")
  await expect(id).toHaveText(UUID)

  await toggle.click()
  await expect(id).toHaveAttribute("data-revealed", "false")
  await expect(id).not.toHaveText(UUID)
})

test("the control is keyboard operable and announces its state", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })
  const toggle = page.getByTestId("player-id-toggle")

  await expect(toggle).toHaveAttribute("aria-label", "Show Player ID")
  await expect(toggle).toHaveAttribute("aria-pressed", "false")

  await toggle.focus()
  await page.keyboard.press("Enter")

  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await expect(toggle).toHaveAttribute("aria-label", "Hide Player ID")
})

test("toggling does not shift the layout", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })
  const id = page.getByTestId("player-id")

  const before = await id.boundingBox()
  await page.getByTestId("player-id-toggle").click()
  await expect(id).toHaveText(UUID)
  const after = await id.boundingBox()

  // Same character count and tabular figures, so the row must not move.
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(2)
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1)
})

test("copy is offered ONLY while revealed", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })

  // A button that silently copies something you cannot see is worse than none.
  await expect(page.getByTestId("player-id-copy")).toHaveCount(0)

  await page.getByTestId("player-id-toggle").click()
  await expect(page.getByTestId("player-id-copy")).toBeVisible()
  await expect(page.getByTestId("player-id-copy")).toHaveAttribute("aria-label", "Copy Player ID")
})

test("the control has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto(PREVIEW, { waitUntil: "networkidle" })
  for (const pass of [0, 1]) {
    if (pass === 1) {
      await page.getByTestId("player-id-toggle").click()
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    expect(blocking.map((v) => v.id), pass === 0 ? "masked" : "revealed").toEqual([])
  }
})
