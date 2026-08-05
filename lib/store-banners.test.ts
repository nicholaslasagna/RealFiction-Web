// Every store product must have its banner file present.
//
// The banners are referenced by three surfaces (store cards, cart lines, account
// perks). A missing file is not a runtime error we can recover from — it is a
// visibly broken store — so it fails the build here instead.
//
// This reads lib/data.ts as text rather than importing it: data.ts pulls in React
// icon components, and the asset paths are what we actually care about.
import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "..")
const dataSource = readFileSync(path.join(repoRoot, "lib", "data.ts"), "utf8")

/** Product ids that must have banner art, in lib/data.ts declaration order. */
const EXPECTED_PRODUCT_IDS = [
  "realvip",
  "real-supporter",
  "realpets",
  "particle-vault",
  "username-colors",
  "lobby-flight",
  "cosmetic-atelier"
]

function bannerPaths(): string[] {
  return [...dataSource.matchAll(/banner:\s*"([^"]+)"/g)].map((match) => match[1])
}

test("every subscription product declares a banner", () => {
  const banners = bannerPaths()
  assert.equal(
    banners.length,
    EXPECTED_PRODUCT_IDS.length,
    `expected ${EXPECTED_PRODUCT_IDS.length} product banners, found ${banners.length}`
  )
  for (const id of EXPECTED_PRODUCT_IDS) {
    assert.ok(
      banners.includes(`/images/store/${id}.png`),
      `no banner declared for product "${id}"`
    )
  }
})

test("every declared banner file actually exists", () => {
  const missing: string[] = []
  for (const banner of bannerPaths()) {
    assert.match(banner, /^\/images\/store\/[a-z0-9-]+\.png$/, `unexpected banner path: ${banner}`)
    if (!existsSync(path.join(repoRoot, "public", banner))) {
      missing.push(`public${banner}`)
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Missing store banner file(s):\n  ${missing.join("\n  ")}\n` +
      "Add the PNGs uploaded to Stripe — see public/images/store/README.md."
  )
})

test("account perk banners resolve to the same files as the store", () => {
  // app/account/page.tsx builds `/images/store/<perk.slugs[0]>.png`, so every
  // primary perk slug must be a product id with art.
  const account = readFileSync(path.join(repoRoot, "app", "account", "page.tsx"), "utf8")
  assert.match(account, /\/images\/store\/\$\{perk\.slugs\[0\]\}\.png/)

  const primarySlugs = [...account.matchAll(/slugs:\s*\[\s*"([^"]+)"/g)].map((match) => match[1])
  assert.ok(primarySlugs.length > 0, "no perk slugs found")
  for (const slug of primarySlugs) {
    assert.ok(
      EXPECTED_PRODUCT_IDS.includes(slug),
      `perk primary slug "${slug}" has no matching product banner`
    )
  }
})

test("gift card artwork is still present", () => {
  for (const match of dataSource.matchAll(/image:\s*"(\/images\/[^"]+)"/g)) {
    assert.ok(
      existsSync(path.join(repoRoot, "public", match[1])),
      `missing gift card art: public${match[1]}`
    )
  }
})

test("banners stay small enough for a page that loads all seven", () => {
  const MAX_BYTES = 400 * 1024
  const oversized: string[] = []
  for (const banner of bannerPaths()) {
    const file = path.join(repoRoot, "public", banner)
    if (!existsSync(file)) {
      continue // the existence test above already reports this
    }
    const { size } = statSync(file)
    if (size > MAX_BYTES) {
      oversized.push(`${banner} (${Math.round(size / 1024)}KB)`)
    }
  }
  assert.deepEqual(oversized, [], `optimise these banners (see README): ${oversized.join(", ")}`)
})
