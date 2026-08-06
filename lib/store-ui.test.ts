// Storefront presentation rules that must hold regardless of who edits the JSX.
//
// These are SHAPE assertions over the component source. They exist because the
// rules they protect are product decisions, not styling: a card that stops
// saying "does not automatically renew", or starts saying "permanent", is a
// customer being misled — and that is not something a visual review reliably
// catches.
//
// Behaviour is verified separately: lib/store-catalog.test.ts covers prices and
// durations, and tests/dom/render-check.mjs asserts on the rendered page.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8")

const storefront = read("components/storefront.tsx")
const productCard = read("components/store/product-card.tsx")
const storePage = read("app/store/page.tsx")
const fairPlay = read("components/store/fair-play.tsx")
const catalog = read("lib/store/catalog.ts")

const ALL_STORE_UI = [storefront, productCard, storePage, fairPlay, catalog].join("\n")

// -- The product model --------------------------------------------------------

test("no store surface describes anything as permanent or lifetime", () => {
  for (const phrase of [
    /permanent unlock/i,
    /never expires?/i,
    /lifetime/i,
    /own it forever/i,
    /keep forever/i
  ]) {
    assert.ok(!phrase.test(ALL_STORE_UI), `store UI still says ${phrase}`)
  }
})

test("no store surface offers an upgrade, credit, or tier conversion", () => {
  for (const phrase of [/upgrade to real/i, /upgrade credit/i, /upgrade today/i, /prorat/i]) {
    assert.ok(!phrase.test(ALL_STORE_UI), `store UI still offers ${phrase}`)
  }
})

test("no store surface claims one product includes another", () => {
  for (const phrase of [/includes realvip/i, /everything in realvip/i, /included with real/i]) {
    assert.ok(!phrase.test(ALL_STORE_UI), `store UI still claims ${phrase}`)
  }
})

test("RealFiction+ appears nowhere in the store UI", () => {
  assert.ok(!/realfiction\s*\+|realfiction-plus/i.test(ALL_STORE_UI))
})

test("copy uses US spelling", () => {
  for (const britishism of [/\bcolour/i, /\bcustomise/i, /\bcatalogue\b/i]) {
    assert.ok(!britishism.test(ALL_STORE_UI), `store UI contains ${britishism}`)
  }
})

// -- Required disclosure ------------------------------------------------------

test("every card renders the one-time-payment disclosure", () => {
  assert.match(productCard, /product\.disclosure\.map/)
  assert.match(catalog, /"One-time payment"/)
  assert.match(catalog, /"Does not automatically renew"/)
})

test("every card states what the purchase does to existing access", () => {
  assert.match(productCard, /Adds \{DURATION_LABEL\[selected\.months\]\} to your/)
})

test("the projected expiration is shown, derived from the server's expiry", () => {
  assert.match(productCard, /projectionSentence\(/)
  assert.match(productCard, /aria-live="polite"/)
})

// -- Duration selection -------------------------------------------------------

test("durations are a real radio group, not a row of buttons", () => {
  assert.match(productCard, /role="radiogroup"/)
  assert.match(productCard, /type="radio"/)
  assert.match(productCard, /<fieldset/)
  assert.match(productCard, /<legend/)
})

test("the effective monthly price and savings are derived, never hardcoded", () => {
  assert.match(productCard, /effectiveMonthlyCents\(/)
  assert.match(productCard, /savingsPercent\(/)
  assert.ok(!/Save 33%/.test(productCard), "a hardcoded savings claim would go stale")
})

test("savings say what they are compared against", () => {
  assert.match(productCard, /compared with buying \{price\.months\} separate months/)
})

test("Best value is an objective price claim; nothing is called most popular", () => {
  assert.match(productCard, /Best value/)
  assert.ok(!/most popular/i.test(ALL_STORE_UI))
})

test("no duration is preselected at a higher price than the shortest", () => {
  assert.match(storefront, /product\.prices\[0\]\.slug/)
})

// -- Access presentation ------------------------------------------------------

test("access state comes from server entitlements, not product duration", () => {
  assert.match(productCard, /accessStateFor\(product\.id, entitlements\)/)
  assert.match(storePage, /getStorefrontAccess/)
  assert.match(storePage, /entitlements=\{ownership\.entitlements\}/)
})

test("no ownership wording survives that the product model cannot support", () => {
  for (const phrase of [/Owned permanently/i, /in your collection/i]) {
    assert.ok(!phrase.test(ALL_STORE_UI), `store UI still says ${phrase}`)
  }
})

// -- Gift cards ---------------------------------------------------------------

test("gift cards render as coming soon with no purchase control", () => {
  assert.match(storefront, /Coming soon/)
  assert.ok(!/gift-card-\d+/.test(storefront), "a gift-card slug is exposed to the client")
})

// -- Fair Play ----------------------------------------------------------------

test("the Fair Play Promise names what is never sold, including auto-renewal", () => {
  assert.match(catalog, /Loot boxes, gambling mechanics/)
  assert.match(catalog, /Automatic renewals/)
  assert.match(catalog, /survival, Factions, PvP/)
})

test("Lobby Flight is scoped to lobbies everywhere it is described", () => {
  assert.match(catalog, /does not apply to survival, Factions, PvP, BedWars/)
  assert.match(productCard, /never survival, Factions, PvP, or BedWars/)
})

// -- Accessibility ------------------------------------------------------------

test("the duration group is labelled for screen readers", () => {
  assert.match(productCard, /aria-label=\{`\$\{product\.name\} duration`\}/)
})

test("decorative banner art is hidden from assistive technology", () => {
  assert.match(productCard, /aria-hidden/)
})

test("wide content scrolls in its own container, not the page body", () => {
  assert.match(storefront, /overflow-x-auto/)
})
