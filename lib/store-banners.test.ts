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

/**
 * Banner FILES that must exist. Named after the original product ids; the
 * catalog's permanent SKUs (realvip-permanent, ...) reuse the same artwork, so
 * the filenames deliberately did not change with the product-model rewrite.
 *
 * Not every product has a banner — RealFiction+ ships none — so this asserts
 * the files exist, while lib/store-catalog.test.ts asserts every DECLARED
 * banner resolves.
 */
const EXPECTED_BANNER_FILES = [
  "realvip",
  "real-supporter",
  "realpets",
  "particle-vault",
  "username-colors",
  "lobby-flight",
  "cosmetic-atelier"
]

function bannerPaths(): string[] {
  // The catalog is now the declaration site for banners.
  const catalog = readFileSync(path.join(repoRoot, "lib", "store", "catalog.ts"), "utf8")
  return [...catalog.matchAll(/banner:\s*"([^"]+)"/g)].map((match) => match[1])
}

test("every banner file is present on disk", () => {
  for (const name of EXPECTED_BANNER_FILES) {
    assert.ok(
      existsSync(path.join(repoRoot, "public", "images", "store", `${name}.png`)),
      `missing public/images/store/${name}.png`
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
      existsSync(path.join(repoRoot, "public", "images", "store", `${slug}.png`)),
      `perk primary slug "${slug}" has no banner file`
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
