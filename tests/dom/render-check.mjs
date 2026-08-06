// DOM verification against the REAL rendered pages.
//
// The shared accounting function already has unit tests. Those prove the strings
// are right; they do not prove the page renders them, that the upgrade button
// exists, or that a coming-soon product has no way to be bought. This starts the
// application, requests the pages, and asserts on the markup that comes back.
//
// Server-rendered HTML is what a browser receives and what a crawler, a
// screen-reader's initial pass, and a JavaScript-disabled visitor get. Asserting
// on it is asserting on the DOM.
//
//   npm run test:dom
//
// No database, no Stripe, no Supabase: the store page degrades to signed-out and
// the presentation states come from development fixtures.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

// Next refuses to run two dev servers for the same directory, so reuse one if a
// developer already has it open and start our own otherwise.
const PORT = Number(process.env.RF_DOM_PORT ?? 3210)
const BASE = `http://localhost:${PORT}`

async function alreadyRunning() {
  try {
    const probe = await fetch(`${BASE}/store`, { signal: AbortSignal.timeout(2000) })
    return probe.ok
  } catch {
    return false
  }
}
const results = []
let failures = 0

function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    failures++
    results.push({ name, ok: false, detail: error.message.split("\n")[0].slice(0, 180) })
  }
}

/** Visible text of the served HTML, tags stripped, entities decoded. */
function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    // React splits adjacent text nodes with <!-- -->, so a rendered "-$12.99"
    // arrives as "-" and "$12.99" on separate lines. Rejoin a lone sign.
    .replace(/(^|\n)-\s*\n\s*\$/g, "$1-$")
}

/** The accounting rows of one purchase card, in document order. */
function accountingLines(html) {
  const blocks = [...html.matchAll(/data-line="([^"]+)"[\s\S]*?<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/g)]
  return blocks.map((m) => `${m[1]}|${text(m[2]).trim()}|${text(m[3]).replace(/\s+/g, "")}`)
}

const reused = await alreadyRunning()
const server = reused
  ? null
  : spawn("npm", ["run", "dev"], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"]
    })
server?.stdout.on("data", () => {})
server?.stderr.on("data", () => {})
if (reused) {
  console.log(`(reusing the dev server already listening on ${PORT})\n`)
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`)
  return { status: response.status, html: await response.text() }
}

try {
  // Wait for the dev server.
  let up = reused
  for (let i = 0; !up && i < 60; i++) {
    try {
      const probe = await fetch(`${BASE}/store`)
      if (probe.ok) {
        up = true
        break
      }
    } catch {
      // not listening yet
    }
    await delay(1000)
  }
  assert.ok(up, `dev server did not start on ${PORT}`)

  // =========================================================================
  // Account history — the real rendered DOM
  // =========================================================================
  const all = await get("/dev/preview/orders-all")
  assert.equal(all.status, 200)
  const cards = all.html.split('data-testid="purchase-row"').slice(1)

  check("every fixture order renders a purchase row", () => {
    assert.equal(cards.length, 10)
  })

  check("ordinary Stripe order renders ONE amount, no breakdown", () => {
    assert.match(cards[0], /data-testid="order-amount"/)
    assert.ok(!cards[0].includes('data-testid="order-accounting"'))
    assert.match(text(cards[0]), /\$12\.99/)
  })

  check("store-credit-only order shows NO Stripe line", () => {
    assert.deepEqual(accountingLines(cards[1]), [
      "subtotal|Subtotal|$34.99",
      "store_credit|Store credit|-$34.99",
      "paid_credit|Paid with store credit|$34.99"
    ])
    assert.ok(!text(cards[1]).includes("Paid through Stripe"))
  })

  check("mixed-tender order separates credit from charge", () => {
    assert.deepEqual(accountingLines(cards[2]), [
      "subtotal|Subtotal|$12.99",
      "store_credit|Store credit|-$5.00",
      "paid_external|Paid through Stripe|$7.99"
    ])
  })

  check("upgrade with NO store credit", () => {
    assert.deepEqual(accountingLines(cards[3]), [
      "subtotal|Subtotal|$34.99",
      "upgrade_credit|RealVIP upgrade credit|-$12.99",
      "order_total|Order total|$22.00",
      "paid_external|Paid through Stripe|$22.00"
    ])
  })

  // THE example.
  check("upgrade WITH store credit renders 34.99 / -12.99 / 22.00 / -5.00 / 17.00", () => {
    assert.deepEqual(accountingLines(cards[4]), [
      "subtotal|Subtotal|$34.99",
      "upgrade_credit|RealVIP upgrade credit|-$12.99",
      "order_total|Order total|$22.00",
      "store_credit|Store credit|-$5.00",
      "paid_external|Paid through Stripe|$17.00"
    ])
  })

  check("$34.99 is never described as paid", () => {
    const lines = accountingLines(cards[4])
    for (const line of lines) {
      if (line.endsWith("$34.99")) {
        assert.match(line, /^subtotal\|/, `"${line}" presents the subtotal as something else`)
      }
    }
  })

  check("$17.00 is never described as the order total", () => {
    const lines = accountingLines(cards[4])
    assert.ok(lines.includes("order_total|Order total|$22.00"))
    assert.ok(!lines.some((l) => l.startsWith("order_total") && l.endsWith("$17.00")))
  })

  check("upgrade credit and store credit are separate rows", () => {
    const keys = accountingLines(cards[4]).map((l) => l.split("|")[0])
    assert.ok(keys.includes("upgrade_credit"))
    assert.ok(keys.includes("store_credit"))
  })

  check("a historical order with no discount columns renders, with its snapshot name", () => {
    assert.match(text(cards[5]), /RealVIP · 1 Month/)
    assert.match(text(cards[5]), /\$9\.99/)
    assert.ok(!text(cards[5]).includes("NaN"))
  })

  check("refunded, review, pending and revoked states all render a status", () => {
    assert.match(text(cards[6]), /Refunded/)
    assert.match(text(cards[7]), /Being reviewed/)
    assert.match(text(cards[8]), /Waiting for checkout/)
    assert.match(text(cards[9]), /Closed/)
  })

  check("a refunded upgrade still shows what was originally charged", () => {
    assert.deepEqual(accountingLines(cards[6]), accountingLines(cards[4]))
  })

  check("NO internal identifier reaches the rendered page", () => {
    const body = text(all.html)
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body), "raw UUID")
    assert.ok(!/\bcs_[A-Za-z0-9]|\bpi_[A-Za-z0-9]|\bre_[A-Za-z0-9]|\bch_[A-Za-z0-9]/.test(body), "provider id")
    assert.ok(!/upgrade_credit_reservations|source_order_item|payment_reviews/i.test(body), "table name")
  })

  check("an empty history renders the empty state, not a blank card", async () => {
    const empty = await get("/dev/preview/orders-empty")
    assert.match(text(empty.html), /No purchases yet/)
  })

  // =========================================================================
  // Upgrade interaction
  // =========================================================================
  const eligible = await get("/dev/preview/vip-upgradeable")

  check("an eligible RealVIP owner sees the server's three figures", () => {
    const body = text(eligible.html)
    assert.match(body, /RealSupporter permanent rank/)
    assert.match(body, /\$34\.99/)
    assert.match(body, /Your RealVIP upgrade credit/)
    assert.match(body, /-\$12\.99/)
    assert.match(body, /Upgrade today/)
    assert.match(body, /\$22\.00/)
  })

  check("the upgrade button says exactly what it does", () => {
    assert.match(text(eligible.html), /Upgrade to RealSupporter/)
  })

  check("the price panel is a labelled description list", () => {
    assert.match(eligible.html, /<dl[^>]*aria-label="Your upgrade price"/)
  })

  check("the upgrade states it is for your own account and cannot be gifted", () => {
    assert.match(text(eligible.html), /cannot be gifted/i)
  })

  check("a full-price purchase is a SEPARATE, differently-labelled action", () => {
    // Never a silent substitution: the discounted action and the full-price
    // action are two distinct buttons with distinct words.
    assert.match(text(eligible.html), /Buy at full price instead/)
  })

  check("an already-owned RealVIP card offers no purchase control at all", () => {
    // Not a disabled button — no control. A disabled buy button reads as
    // "temporarily unavailable" for something the customer already owns.
    const body = text(eligible.html)
    assert.match(body, /Owned permanently/)
    // The phrase only ever appeared on a disabled buy button, which no longer exists.
    assert.ok(!/Already in your collection/.test(body))
  })

  const ineligible = {
    legacy: await get("/dev/preview/legacy-vip"),
    inherited: await get("/dev/preview/supporter-inherited-vip"),
    manual: await get("/dev/preview/vip-ineligible-source"),
    reserved: await get("/dev/preview/upgrade-reserved"),
    review: await get("/dev/preview/upgrade-review"),
    owned: await get("/dev/preview/supporter-owner"),
    down: await get("/dev/preview/service-unavailable")
  }

  check("NO ineligible state ever renders an upgrade button", () => {
    for (const [name, page] of Object.entries(ineligible)) {
      assert.ok(!/Upgrade to RealSupporter/.test(text(page.html)), `${name} offered an upgrade`)
    }
  })

  check("no ineligible state silently shows a discounted price", () => {
    for (const [name, page] of Object.entries(ineligible)) {
      assert.ok(!/Upgrade today/.test(text(page.html)), `${name} showed an upgrade price`)
      assert.ok(!/Your RealVIP upgrade credit/.test(text(page.html)), `${name} showed a credit`)
    }
  })

  check("LEGACY timed RealVIP reads as legacy, never as owned permanently", () => {
    const body = text(ineligible.legacy.html)
    assert.match(body, /Legacy access active until August 30, 2026/)
    assert.match(body, /Upgrade pricing applies to a RealVIP rank bought outright/)
  })

  check("INHERITED RealVIP reads as included, and cannot fund an upgrade", () => {
    const body = text(ineligible.inherited.html)
    assert.match(body, /Included with RealSupporter/)
    assert.match(body, /You already have RealSupporter/)
  })

  check("a granted (non-purchased) RealVIP explains why the discount does not apply", () => {
    assert.match(text(ineligible.manual.html), /bought outright/)
  })

  check("a credit reserved by another checkout is explained, not hidden", () => {
    assert.match(text(ineligible.reserved.html), /already started/)
  })

  check("a source under review is explained without exposing the mechanism", () => {
    const body = text(ineligible.review.html)
    assert.match(body, /being reviewed/i)
    assert.ok(!/needs_review|reservation|payment_reviews/i.test(body))
  })

  check("an unreadable quote offers nothing rather than guessing", () => {
    const body = text(ineligible.down.html)
    assert.ok(!/Upgrade today/.test(body))
    assert.ok(!/Upgrade to RealSupporter/.test(body))
  })

  // =========================================================================
  // Availability
  // =========================================================================
  check("RealFiction+ is presented as coming soon with NO purchase action", () => {
    const html = eligible.html
    assert.match(text(html), /RealFiction\+/)
    // Isolate the coming-soon card and prove it holds no button and no price.
    const start = html.indexOf("Coming soon")
    const card = html.slice(start, start + 2600)
    assert.match(text(card), /not on sale yet/i)
    const buttons = card.split("</button>").length - 1
    assert.equal(buttons, 0, "a coming-soon product must have no purchase control")
  })

  check("gift cards are presented as coming soon with NO purchase action", () => {
    const body = text(eligible.html)
    assert.match(body, /gift cards/i)
    assert.match(body, /aren't on sale yet/i)
    // No gift-card SKU appears as a buyable line anywhere.
    assert.ok(!/gift-card-\d+/.test(eligible.html), "a gift card SKU is exposed to the client")
  })

  check("a coming-soon product is never given a price to compare against", () => {
    // RealFiction+ is $5.99 in the catalogue. A price on a product nobody can
    // buy reads as an offer, so the comparison column says "Coming soon".
    assert.ok(!/\$5\.99/.test(text(eligible.html)), "a coming-soon price is being advertised")
  })

  // =========================================================================
  // Accessibility structure
  // =========================================================================
  check("the comparison table has a caption and scoped headers", () => {
    const table = eligible.html.slice(eligible.html.indexOf("<table"), eligible.html.indexOf("</table>"))
    assert.match(table, /<caption/)
    // `<th`, not `<thead`.
    const headers = (table.match(/<th[\s>]/g) ?? []).length
    const scoped = (table.match(/<th[^>]*scope="(col|row)"/g) ?? []).length
    assert.ok(headers > 0)
    assert.equal(scoped, headers, `${headers - scoped} header cells lack a scope`)
  })

  check("the comparison table can scroll horizontally on a narrow screen", () => {
    const index = eligible.html.indexOf("<table")
    const before = eligible.html.slice(Math.max(0, index - 400), index)
    assert.match(before, /overflow-x-auto/)
  })

  check("the social rail is a labelled landmark, not a bare div", () => {
    assert.match(eligible.html, /<aside[^>]*aria-label="RealFiction community links"/)
  })

  check("every store section heading is a real heading element", () => {
    assert.match(eligible.html, /<h2[^>]*>[\s\S]{0,40}Supporter/)
  })

  check("images are either described or explicitly decorative", () => {
    const imgs = [...eligible.html.matchAll(/<img[^>]*>/g)].map((m) => m[0])
    for (const img of imgs) {
      assert.match(img, /alt=/, `image without alt: ${img.slice(0, 90)}`)
    }
  })

  // =========================================================================
  // The preview harness itself must not exist in production
  // =========================================================================
  check("an unknown preview state is a 404, not a blank page", async () => {
    const missing = await get("/dev/preview/definitely-not-a-state")
    assert.equal(missing.status, 404)
  })
} finally {
  server?.kill("SIGTERM")
}

const width = Math.max(...results.map((r) => r.name.length))
for (const result of results) {
  console.log(`  ${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(width)}${result.detail ? `  ${result.detail}` : ""}`)
}
console.log(`\n${results.length - failures}/${results.length} DOM checks passed`)
process.exit(failures > 0 ? 1 : 0)
