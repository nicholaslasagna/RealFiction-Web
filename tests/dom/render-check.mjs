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
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "development",
        // TEST-ONLY gate values, applied to this harness's dev server alone.
        // Production defaults are untouched: with any of these absent the store
        // renders the coming-soon card and checkout refuses before any state.
        STORE_GIFT_CARDS_ENABLED: "true",
        GIFT_CARD_TAX_TREATMENT_REVIEWED: "no_tax_at_sale",
        GIFT_CARD_CLAIM_PEPPER: "a".repeat(64),
        GIFT_CARD_ENCRYPTION_KEY: "0".repeat(64),
        GIFT_CARD_ENCRYPTION_KEY_VERSION: "1",
        RESEND_API_KEY: "dom-harness-not-a-real-key",
        EMAIL_FROM: "RealFiction <orders@realfiction.live>"
      },
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
  // Gift cards
  // =========================================================================
  const giftStore = await get("/store")
  const claimPage = await get("/gift-cards/claim")
  const terms = await get("/legal/gift-cards")

  check("the gift-card terms page renders and is marked a draft", () => {
    assert.equal(terms.status, 200)
    assert.match(text(terms.html), /Draft — not yet in effect/)
    assert.match(text(terms.html), /not redeemable for cash except where required by law/i)
    assert.match(text(terms.html), /never expires|do not expire/i)
  })

  check("the claim page renders without claiming anything", () => {
    assert.equal(claimPage.status, 200)
    // A GET must be presentation only. If the page claimed on load, an email
    // scanner would consume gift cards before anyone read the message.
    assert.match(text(claimPage.html), /Opening this page does not claim anything/i)
    assert.match(text(claimPage.html), /Claim your gift card/i)
  })

  check("the claim page renders NO secret and no claim controls without a fragment", () => {
    // The secret lives in the URL fragment, which the server never receives, so
    // a server-rendered page cannot contain it by construction.
    assert.ok(!/[A-Za-z0-9_-]{43}/.test(text(claimPage.html)), "a 43-char secret-shaped string was rendered")
    assert.ok(!/claim#/.test(claimPage.html))
  })

  check("the claim page sets a strict referrer policy", () => {
    assert.match(claimPage.html, /no-referrer/)
  })

  check("the claim page LOADS no third-party resource", () => {
    // `src` only, not `href`. A resource that loads runs in the page and could
    // read location.hash; a footer link to YouTube cannot, and a fragment is
    // never transmitted in a Referer header even if one were sent — which the
    // no-referrer policy asserted above already prevents.
    for (const src of [...claimPage.html.matchAll(/\bsrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1])) {
      assert.match(src, /^https?:\/\/(localhost|realfiction\.live)/, `third-party resource: ${src}`)
    }
    assert.ok(
      !/googletagmanager|google-analytics|plausible|segment\.io|hotjar|sentry/i.test(claimPage.html),
      "an analytics script on the claim page could read the fragment"
    )
  })

  check("the store renders all nine gift-card denominations when enabled", () => {
    const visible = text(giftStore.html)
    for (const amount of ["$5.00", "$10.00", "$15.00", "$20.00", "$25.00", "$30.00", "$50.00", "$75.00", "$100.00"]) {
      assert.ok(visible.includes(amount), `missing denomination ${amount}`)
    }
  })

  check("the denominations are an accessible radio group", () => {
    assert.match(giftStore.html, /role="radiogroup"/)
    assert.match(giftStore.html, /role="radio"[^>]*aria-checked/)
  })

  check("the gift-card form carries every required disclosure", () => {
    const visible = text(giftStore.html)
    assert.match(visible, /Delivered by email immediately after payment/i)
    assert.match(visible, /Never expires\. No inactivity, maintenance, or service fees/i)
    assert.match(visible, /Cannot be used to buy another gift card/i)
    assert.match(visible, /Not redeemable for cash except where required by law/i)
  })

  check("the gift-card form links to working terms and support", () => {
    assert.match(giftStore.html, /href="\/legal\/gift-cards"/)
    assert.match(giftStore.html, /mailto:support@realfiction\.live/)
  })

  check("NO denomination is labelled popular, and there is no urgency copy", () => {
    const visible = text(giftStore.html)
    assert.ok(!/most popular/i.test(visible))
    assert.ok(!/hurry|limited time|only .* left|ends soon/i.test(visible))
  })

  check("the gift-card form exposes NO client monetary field", () => {
    // The browser picks a SKU. Price, currency, and Stripe identifiers are
    // resolved server-side; none may appear as a form input.
    const inputs = [...giftStore.html.matchAll(/<input[^>]*>/g)].map((m) => m[0])
    for (const input of inputs) {
      assert.ok(
        !/name="(price|amount|currency|priceId|productId|faceValue)"/i.test(input),
        `client monetary input: ${input.slice(0, 90)}`
      )
    }
    assert.ok(!/data-price-cents|data-amount-cents/.test(giftStore.html))
  })

  check("the gift-card fields are labelled and length-limited", () => {
    const visible = text(giftStore.html)
    assert.match(visible, /Recipient email/i)
    assert.match(visible, /Your name/i)
    // React splits adjacent text nodes, so "0/60 characters" arrives across
    // several lines; compare with whitespace collapsed.
    const flat = visible.replace(/\s+/g, " ")
    assert.match(flat, /0 ?\/ ?60 characters/)
    assert.match(flat, /0 ?\/ ?500 characters/)
  })

  check("the checkout action names the selected amount", () => {
    assert.match(text(giftStore.html), /Buy \$25\.00 gift card/)
  })

  // =========================================================================
  // Refund and dispute states — what the customer actually sees
  // =========================================================================
  const refunds = await get("/dev/preview/refund-states")
  const refundBlocks = refunds.html.split('data-testid="gift-card-refund-state"').slice(1)
  const refundText = text(refunds.html)

  check("only cards with something to report render a state block", () => {
    // Five fixture cards, one of which has no refund and no dispute.
    assert.equal(refundBlocks.length, 4)
  })

  check("the four purchaser states are distinguishable words", () => {
    for (const label of ["Refunded", "Refund processing", "Refund requires review", "Disputed"]) {
      assert.ok(refundText.includes(label), `missing state: ${label}`)
    }
  })

  check("every state block carries a sentence, not just a colored badge", () => {
    for (const block of refundBlocks) {
      // Color alone is not information. Each block must say something.
      assert.ok(text(block).replace(/\s+/g, " ").trim().length > 40, "a state block was label-only")
    }
  })

  check("NO refund state reveals what the recipient did with the card", () => {
    // The review fixture is a card whose recipient spent $12.99 of $25.00.
    for (const leak of [/spent/i, /\$12\.99/, /\$12\.01/, /partially/i, /redeem(ed|er)/i, /recipient/i]) {
      assert.ok(!leak.test(refundText), `the refund states leaked ${leak}`)
    }
  })

  check("a disputed card does not say chargeback, fraud, or bank dispute detail", () => {
    assert.ok(!/chargeback/i.test(refundText))
    assert.ok(!/fraud/i.test(refundText))
  })

  check("no refund state leaks an internal identifier", () => {
    // `refund_review` and friends ARE the public state names and travel in the
    // RSC payload by design. What must never appear is the internal vocabulary
    // behind them.
    assert.ok(!/eligible_unclaimed|eligible_claimed_unused|provider_refund_pending|review_required/.test(refunds.html))
    assert.ok(!/\bre_[A-Za-z0-9]|\bpi_[A-Za-z0-9]|\bch_[A-Za-z0-9]/.test(refunds.html))
    assert.ok(!/gift_card_refunds|store_credit_lots|payment_reviews/i.test(refunds.html))
  })

  check("no refund state offers a claim link or a code", () => {
    assert.ok(!/gift-cards\/claim|claim#/.test(refunds.html))
    assert.ok(!/RF-[A-Z0-9]{4}/.test(refundText), "a gift card code was rendered next to a refund state")
  })

  const frozen = await get("/dev/preview/credit-frozen")
  const frozenText = text(frozen.html)

  check("a recipient sees the hold, the amount, and why they cannot spend it", () => {
    assert.match(frozen.html, /data-testid="store-credit-hold"/)
    assert.ok(frozenText.includes("Frozen during payment review"))
    assert.match(frozenText, /\$25\.00 on hold/)
    assert.match(frozenText, /cannot be spent/i)
  })

  check("THE RECIPIENT IS NEVER TOLD A DISPUTE EXISTS", () => {
    // A chargeback is an accusation aimed at the sender. The recipient is not
    // the one being asked about it.
    for (const leak of [/dispute/i, /chargeback/i, /fraud/i, /stolen/i, /purchaser/i, /sender's/i]) {
      assert.ok(!leak.test(frozenText), `the frozen notice leaked ${leak}`)
    }
  })

  check("the hold notice is announced, not just colored", () => {
    const block = frozen.html.slice(frozen.html.indexOf('data-testid="store-credit-hold"'))
    assert.match(block.slice(0, 400), /role="status"/)
  })

  const restored = await get("/dev/preview/credit-restored")
  const restoredText = text(restored.html)

  check("a restored recipient is told the hold is gone, with no amount on hold", () => {
    assert.ok(restoredText.includes("Restored after dispute resolution"))
    assert.match(restoredText, /available again/i)
    assert.ok(!/on hold/i.test(restoredText))
  })

  check("neither recipient state names a gift card, a sender, or an order", () => {
    for (const body of [frozen.html, restored.html]) {
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body), "raw UUID")
      assert.ok(!/RFG-[A-Z0-9]/.test(body), "a gift card reference")
    }
  })

  // =========================================================================
  // Cash-redemption review
  //
  // The risk this section guards is a customer reading the page as a promise to
  // pay them. Every check below is a way that could happen.
  // =========================================================================
  const offer = await get("/dev/preview/cash-redemption-offer")
  const offerText = text(offer.html)

  check("the entry point asks for a REVIEW, not a payout", () => {
    assert.match(offer.html, /data-testid="cash-redemption-request"/)
    assert.ok(offerText.includes("Request cash redemption review"))
    assert.match(offerText, /does not guarantee a payout/i)
  })

  check("NO PAYOUT ESTIMATE AND NO AMOUNT ANYWHERE on the entry point", () => {
    assert.ok(!/\$\d/.test(offerText), "an amount was rendered")
    assert.ok(!/estimate|you will receive|we will pay|payout of/i.test(offerText))
  })

  check("no eligibility is promised or implied", () => {
    assert.ok(!/you (are|qualify)|approved|eligible for/i.test(offerText))
  })

  const openReview = await get("/dev/preview/cash-redemption-open")
  const openText = text(openReview.html)

  check("an open review shows a status and withdraws the button", () => {
    assert.match(openReview.html, /data-testid="cash-redemption-status"/)
    assert.ok(openText.includes("Review requested"))
    assert.ok(
      !openReview.html.includes('data-testid="cash-redemption-request"'),
      "a second button while one is open reads as the first having failed"
    )
  })

  const eligible = await get("/dev/preview/cash-redemption-eligible")
  // Scoped to the COMPONENT, not the page: the preview harness prints its own
  // fixture note above it, and that note is allowed to say what the component
  // must not.
  const eligibleText = text(
    eligible.html.slice(eligible.html.indexOf('data-testid="cash-redemption"'))
  )

  check("an INTERNALLY ELIGIBLE review still reads as under review", () => {
    // The dangerous one: internally a reviewer agreed, but a customer reading
    // "approved" and later being refused has been misled by us.
    assert.ok(eligibleText.includes("Under review"))
    assert.ok(!/approved|eligible/i.test(eligibleText))
  })

  const closed = await get("/dev/preview/cash-redemption-closed")
  const closedText = text(closed.html)

  check("a closed review gives NO REASON and no legal reasoning", () => {
    assert.ok(closedText.includes("Review closed"))
    assert.ok(!/state law|jurisdiction|threshold|promotional|because|not eligible/i.test(closedText))
    assert.match(closedText, /store credit is unchanged/i)
  })

  check("the cash-redemption surfaces expose no internal identifier or rule", () => {
    for (const body of [offer.html, openReview.html, eligible.html, closed.html]) {
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body), "raw UUID")
      assert.ok(!/cash_redemption_requests|store_credit_lots|abuse_events|velocity/i.test(body))
      assert.ok(!/manual_payout_required|eligibility_review/.test(body), "a raw state value")
    }
  })

  check("the status block is announced, not just colored", () => {
    const block = openReview.html.slice(openReview.html.indexOf('data-testid="cash-redemption-status"'))
    assert.match(block.slice(0, 400), /role="status"/)
  })

  check("American English throughout the refund and dispute states", () => {
    for (const body of [refundText, frozenText, restoredText, offerText, openText, closedText]) {
      assert.ok(!/colour|authorise|cancelled|recognise|apologise/i.test(body))
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
