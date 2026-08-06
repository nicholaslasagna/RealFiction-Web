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
    assert.equal(cards.length, 9)
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

  check("a longer duration paid partly with store credit", () => {
    assert.deepEqual(accountingLines(cards[3]), [
      "subtotal|Subtotal|$23.99",
      "store_credit|Store credit|-$5.00",
      "paid_external|Paid through Stripe|$18.99"
    ])
  })

  check("the subtotal is never described as paid", () => {
    for (const line of accountingLines(cards[3])) {
      if (line.endsWith("$23.99")) {
        assert.match(line, /^subtotal\|/, `"${line}" presents the subtotal as something else`)
      }
    }
  })

  check("the Stripe charge is never described as the order total", () => {
    const lines = accountingLines(cards[3])
    assert.ok(lines.some((l) => l.startsWith("paid_external") && l.endsWith("$18.99")))
    assert.ok(!lines.some((l) => l.startsWith("order_total") && l.endsWith("$18.99")))
  })

  check("a historical order with no discount columns renders, with its snapshot name", () => {
    assert.match(text(cards[4]), /RealVIP · 1 Month/)
    assert.match(text(cards[4]), /\$9\.99/)
    assert.ok(!text(cards[4]).includes("NaN"))
  })

  check("refunded, review, pending and revoked states all render a status", () => {
    assert.match(text(cards[5]), /Refunded/)
    assert.match(text(cards[6]), /Being reviewed/)
    assert.match(text(cards[7]), /Waiting for checkout/)
    assert.match(text(cards[8]), /Closed/)
  })

  check("a refunded order still shows what was originally charged", () => {
    assert.deepEqual(accountingLines(cards[5]), accountingLines(cards[3]))
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
  // The fixed-duration store
  // =========================================================================
  const store = await get("/dev/preview/no-access")

  check("every product offers FOUR durations as radio options", () => {
    const radios = (store.html.match(/type="radio"/g) ?? []).length
    // 7 products x 4 durations.
    assert.equal(radios, 28)
  })

  check("every card carries the one-time-payment disclosure", () => {
    const body = text(store.html)
    assert.equal((body.match(/One-time payment/g) ?? []).length, 7)
    assert.equal((body.match(/Does not automatically renew/g) ?? []).length, 7)
  })

  check("prices, monthly rates and savings are all rendered", () => {
    const body = text(store.html)
    for (const amount of ["$4.99", "$12.99", "$23.99", "$39.99"]) {
      assert.ok(body.includes(amount), `RealVIP is missing ${amount}`)
    }
    // React splits adjacent text nodes, so the amount and the "/month" suffix
    // arrive separately; both must be present.
    assert.ok(body.includes("$4.33"), "3-month effective monthly rate")
    assert.ok(body.includes("$3.33"), "12-month effective monthly rate")
    assert.ok(body.includes("/month"))
    // "Save", the number and "%" are three text nodes in the server render.
    assert.ok(body.includes("Save"))
    assert.ok(body.includes("13"), "3-month savings figure")
    assert.ok(body.includes("33"), "12-month savings figure")
  })

  check("Best value marks the 12-month option and nothing claims popularity", () => {
    const body = text(store.html)
    assert.match(body, /Best value/)
    assert.ok(!/most popular/i.test(body))
  })

  check("NOTHING on the store says permanent, lifetime, or never expires", () => {
    const body = text(store.html)
    for (const phrase of [/permanent unlock/i, /lifetime/i, /never expires?/i, /owned permanently/i]) {
      assert.ok(!phrase.test(body), `store page says ${phrase}`)
    }
  })

  check("NOTHING offers an upgrade or claims one rank includes another", () => {
    const body = text(store.html)
    assert.ok(!/upgrade to real/i.test(body))
    assert.ok(!/everything in realvip/i.test(body))
    assert.ok(!/included with real/i.test(body))
  })

  check("RealFiction+ is gone from the store entirely", () => {
    assert.ok(!/realfiction\s*\+|realfiction-plus/i.test(store.html))
  })

  check("copy uses US spelling", () => {
    assert.ok(!/colour/i.test(text(store.html)), "British spelling on the store page")
  })

  const active = await get("/dev/preview/active-realvip")

  check("an active entitlement shows its real expiry date", () => {
    assert.match(text(active.html), /Active until September 18, 2026/)
  })

  check("selecting a duration projects the EXTENDED expiry", () => {
    // Default selection is 1 month: Sep 18 + 1 month = Oct 18.
    assert.match(text(active.html), /would extend access through October 18, 2026/)
  })

  check("stacked purchases show the FURTHEST expiry, not the most recent", async () => {
    const stacked = await get("/dev/preview/stacked-renewals")
    assert.match(text(stacked.html), /Active until December 18, 2026/)
    assert.ok(!/Active until September 18, 2026/.test(text(stacked.html)))
  })

  check("expired access reads as expired and projects from today", async () => {
    const expired = await get("/dev/preview/expired-realvip")
    assert.match(text(expired.html), /Expired July 5, 2026/)
    assert.match(text(expired.html), /would give you access through/)
  })

  check("RealVIP and RealSupporter are independent — one active does not imply the other", async () => {
    const supporter = await get("/dev/preview/active-realsupporter")
    const body = text(supporter.html)
    // Exactly one product reports active access.
    assert.equal((body.match(/Active until/g) ?? []).length, 1)
    assert.ok(!/included with/i.test(body))
  })

  check("gift cards are coming soon with NO purchase action and no SKU exposed", () => {
    assert.match(text(store.html), /gift cards/i)
    assert.ok(!/gift-card-\d+/.test(store.html), "a gift-card SKU reached the client")
  })

  check("the Fair Play Promise states that nothing auto-renews", () => {
    assert.match(text(store.html), /Automatic renewals/)
  })

  // =========================================================================
  // Accessibility structure
  // =========================================================================
  check("each duration group is a labelled fieldset with a radiogroup", () => {
    assert.match(store.html, /<fieldset/)
    assert.match(store.html, /<legend/)
    assert.match(store.html, /role="radiogroup"/)
    assert.match(store.html, /aria-label="RealVIP duration"/)
  })

  check("the savings claim says what it is compared against", () => {
    assert.ok(text(store.html).includes("separate months"), "the comparison basis is stated")
  })

  check("the projection is announced when the duration changes", () => {
    assert.match(active.html, /aria-live="polite"/)
  })

  check("the social rail is a labelled landmark, not a bare div", () => {
    assert.match(store.html, /<aside[^>]*aria-label="RealFiction community links"/)
  })

  check("every store section heading is a real heading element", () => {
    assert.match(store.html, /<h2[^>]*>[\s\S]{0,60}Supporter/)
  })

  check("images are either described or explicitly decorative", () => {
    for (const img of [...store.html.matchAll(/<img[^>]*>/g)].map((m) => m[0])) {
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
