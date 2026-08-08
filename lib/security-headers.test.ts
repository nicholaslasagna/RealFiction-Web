// Security response headers.
//
// The application shipped with NONE. That is not an exploit by itself, but it
// took the browser out of the defence entirely: nothing prevented the site from
// being framed, sensitive authenticated pages carried no cache directives, and
// any future HTML-injection bug would have had no second line of defence.
//
// These assert the POLICY, so a future edit that quietly drops a header fails
// here rather than in production.
import assert from "node:assert/strict"
import { test } from "node:test"

const config = (await import("../next.config.mjs")).default
const groups = await config.headers()

const forSource = (source: string) => {
  const group = groups.find((g: { source: string }) => g.source === source)
  assert.ok(group, `no header group for ${source}`)
  return new Map(group.headers.map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]))
}

test("every response carries the baseline hardening headers", () => {
  const h = forSource("/:path*")
  assert.equal(h.get("x-frame-options"), "DENY")
  assert.match(h.get("content-security-policy") ?? "", /frame-ancestors 'none'/)
  assert.equal(h.get("x-content-type-options"), "nosniff")
  assert.match(h.get("referrer-policy") ?? "", /strict-origin/)
  assert.match(h.get("strict-transport-security") ?? "", /max-age=\d{7,}/)
  assert.match(h.get("permissions-policy") ?? "", /camera=\(\)/)
})

test("NO header key is duplicated in any group", () => {
  // A duplicated key is ambiguous — a browser may honour either copy, so an
  // override that appends rather than replaces silently weakens the policy.
  for (const group of groups) {
    const keys = group.headers.map((x: { key: string }) => x.key.toLowerCase())
    const dupes = keys.filter((k: string, i: number) => keys.indexOf(k) !== i)
    assert.deepEqual(dupes, [], `${group.source} duplicates: ${dupes.join(", ")}`)
  }
})

test("the gift-card claim page sends NO referrer and is never cached", () => {
  // Its URL fragment is a bearer secret. A fragment is never sent in a Referer
  // header, but the page must also never land in a shared cache.
  const h = forSource("/gift-cards/claim")
  assert.equal(h.get("referrer-policy"), "no-referrer")
  assert.match(h.get("cache-control") ?? "", /no-store/)
  assert.match(h.get("cache-control") ?? "", /private/)
})

test("the admin surface is uncacheable and unindexable", () => {
  const h = forSource("/admin/:path*")
  assert.match(h.get("cache-control") ?? "", /no-store/)
  assert.match(h.get("x-robots-tag") ?? "", /noindex/)
  assert.equal(h.get("x-frame-options"), "DENY")
})

test("authenticated account pages are never shared-cached", () => {
  const h = forSource("/account/:path*")
  assert.match(h.get("cache-control") ?? "", /no-store/)
  assert.match(h.get("cache-control") ?? "", /private/)
})

test("API responses are never cached", () => {
  const h = forSource("/api/:path*")
  assert.match(h.get("cache-control") ?? "", /no-store/)
})

test("every sensitive group still inherits the baseline", () => {
  // The override helper filters the base list; a bug there would silently drop
  // clickjacking protection from exactly the pages that need it most.
  for (const source of ["/gift-cards/claim", "/admin/:path*", "/account/:path*", "/api/:path*"]) {
    const h = forSource(source)
    assert.equal(h.get("x-frame-options"), "DENY", `${source} lost X-Frame-Options`)
    assert.equal(h.get("x-content-type-options"), "nosniff", `${source} lost nosniff`)
    assert.ok(h.get("strict-transport-security"), `${source} lost HSTS`)
  }
})
