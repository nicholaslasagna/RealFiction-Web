// The staff publishing surface, and the canonical detail route.
//
// The expensive mistakes here are: a draft becoming public, an ordinary
// customer publishing, and staff-authored text executing in a browser. Each of
// those has a test that drives the real code path rather than the helper.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_ADMIN_DB ?? "rf_admin_ann"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})

// The session the route sees. Swapped per test.
const session = { user: null as { id: string; email: string } | null, isAdmin: false }

mock.module("@/lib/supabase/server", {
  namedExports: {
    getAuthenticatedUser: async () => session.user,
    createSupabaseServerClient: async () => ({
      // Mirrors is_admin(): the answer comes from the session, never the request.
      rpc: async (fn: string) =>
        fn === "is_admin" ? { data: session.isAdmin, error: null } : { data: null, error: null }
    })
  }
})
mock.module("@/lib/supabase/service-role", {
  namedExports: { getSupabaseServiceRoleClient: () => createPgSupabaseClient(DB) }
})

const { POST, GET } = await import("../app/api/admin/announcements/route.ts")
const { parseAnnouncementBody, parseInline } = await import("./announcements/render.ts")
const { normalizeSlug, validateAnnouncement } = await import("./announcements/validate.ts")

const STAFF = { id: "11111111-1111-4111-8111-111111111111", email: "staff@realfiction.live" }
const PLAYER = { id: "22222222-2222-4222-8222-222222222222", email: "player@example.com" }

const post = (body: unknown) =>
  POST(
    new Request("https://realfiction.live/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  )

const VALID = {
  slug: "season-four",
  title: "Season 4",
  excerpt: "It starts Friday.",
  body: "First paragraph.\n\nSecond paragraph.",
  category: "Announcement",
  authorDisplay: "RealFiction",
  imageUrl: "",
  mirrorToDiscord: true
}

function asStaff() {
  session.user = STAFF
  session.isAdmin = true
}
function asPlayer() {
  session.user = PLAYER
  session.isAdmin = false
}
function signedOut() {
  session.user = null
  session.isAdmin = false
}

// ===========================================================================
// Authorization
// ===========================================================================

test("UNAUTHENTICATED publishing is denied", async () => {
  sql(DB, "delete from public.announcements")
  signedOut()

  const response = await post({ ...VALID, publish: true })
  assert.equal(response.status, 404)
  assert.equal(sql(DB, "select count(*) from public.announcements"), "0", "an anonymous request created a row")
})

test("an ORDINARY authenticated user is denied", async () => {
  sql(DB, "delete from public.announcements")
  asPlayer()

  const response = await post({ ...VALID, publish: true })
  assert.equal(response.status, 404)
  assert.equal(sql(DB, "select count(*) from public.announcements"), "0", "a customer created an announcement")
})

test("signed-out and not-staff are INDISTINGUISHABLE", async () => {
  signedOut()
  const anonymous = await post({ ...VALID, publish: true })
  asPlayer()
  const customer = await post({ ...VALID, publish: true })

  assert.equal(anonymous.status, customer.status)
  assert.deepEqual(await anonymous.json(), await customer.json(), "the responses differ, revealing who is staff")
})

test("STAFF may publish", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  const response = await post({ ...VALID, publish: true })
  assert.equal(response.status, 200)
  assert.equal(sql(DB, "select status from public.announcements where slug='season-four'"), "published")
})

test("a client-supplied role or admin flag is REJECTED", async () => {
  sql(DB, "delete from public.announcements")
  asPlayer()

  for (const field of ["role", "isAdmin", "userId"]) {
    const response = await post({ ...VALID, publish: true, [field]: "owner" })
    assert.equal(response.status, 404, `${field} changed the outcome`)
  }
  assert.equal(sql(DB, "select count(*) from public.announcements"), "0")
})

test("a GET can never mutate", async () => {
  assert.equal((await GET()).status, 405)
})

// ===========================================================================
// Draft safety
// ===========================================================================

test("a saved DRAFT stays private", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "hidden", publish: false })

  assert.equal(sql(DB, "select status from public.announcements where slug='hidden'"), "draft")
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")
  assert.equal(sql(DB, "select coalesce((select slug from public.latest_announcement()),'none')"), "none")
})

test("OMITTING publish saves a draft — it can never mean publish", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "omitted" })
  assert.equal(
    sql(DB, "select status from public.announcements where slug='omitted'"),
    "draft",
    "a missing publish flag published the announcement"
  )
})

test("publishing makes a draft public", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "goes-live", publish: false })
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")

  await post({ ...VALID, slug: "goes-live", publish: true })
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "1")
})

test("a client cannot set publication or Discord state directly", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  for (const field of ["publishedAt", "published_at", "discordState", "discord_message_id", "webhookUrl"]) {
    const response = await post({ ...VALID, slug: "tampered", publish: true, [field]: "x" })
    assert.equal(response.status, 400, `${field} was accepted`)
  }
  assert.equal(sql(DB, "select count(*) from public.announcements"), "0")
})

// ===========================================================================
// Idempotency and mirror scheduling
// ===========================================================================

test("repeated publishing of identical content is idempotent", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "same-thing", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-1'")
  sql(
    DB,
    `update public.announcements set discord_delivered_hash =
      encode(extensions.digest('Season 4' || chr(31) || 'It starts Friday.' || chr(31) || 'Announcement' || chr(31) || '', 'sha256'), 'hex')`
  )

  await post({ ...VALID, slug: "same-thing", publish: true })

  assert.equal(
    sql(DB, "select discord_state from public.announcements where slug='same-thing'"),
    "delivered",
    "an identical republish re-armed the Discord mirror"
  )
  assert.equal(sql(DB, "select count(*) from public.announcements"), "1")
})

test("editing a DELIVERED announcement schedules a PATCH, not a new post", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "will-edit", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-keep'")

  await post({ ...VALID, slug: "will-edit", title: "Season 4 — delayed", publish: true })

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='will-edit'"), "pending")
  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='will-edit'"),
    "m-keep",
    "the message id was lost, which would cause a duplicate post"
  )
})

test("a Discord failure does not undo the website publication", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "resilient", publish: true })
  sql(DB, "update public.announcements set discord_state='failed', discord_last_error='provider_500'")

  assert.equal(sql(DB, "select status from public.announcements where slug='resilient'"), "published")
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "1")
})

// ===========================================================================
// Validation
// ===========================================================================

test("slugs are normalised and uniqueness is an UPSERT, not a crash", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  assert.equal(normalizeSlug("Season 4: The Return!"), "season-4-the-return")

  await post({ ...VALID, slug: "Season 4!!", publish: true })
  const first = await post({ ...VALID, slug: "season-4", title: "Edited", publish: true })

  assert.equal(first.status, 200, "a duplicate slug should update, not fail")
  assert.equal(sql(DB, "select count(*) from public.announcements"), "1")
  assert.equal(sql(DB, "select title from public.announcements"), "Edited")
})

test("a REMOTE image URL is rejected", () => {
  const remote = validateAnnouncement({ ...VALID, imageUrl: "https://evil.example/x.png" })
  assert.equal(remote.ok, false)
  assert.equal(remote.ok === false && remote.field, "imageUrl")

  const protocolRelative = validateAnnouncement({ ...VALID, imageUrl: "//evil.example/x.png" })
  assert.equal(protocolRelative.ok, false)

  const sitePath = validateAnnouncement({ ...VALID, imageUrl: "/images/updates/a.png" })
  assert.equal(sitePath.ok, true)
})

test("an unknown category is refused", () => {
  const result = validateAnnouncement({ ...VALID, category: "<script>" })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.field, "category")
})

test("empty and oversized fields are refused", () => {
  assert.equal(validateAnnouncement({ ...VALID, title: "" }).ok, false)
  assert.equal(validateAnnouncement({ ...VALID, slug: "" }).ok, false)
  assert.equal(validateAnnouncement({ ...VALID, title: "T".repeat(200) }).ok, false)
  assert.equal(validateAnnouncement({ ...VALID, excerpt: "E".repeat(500) }).ok, false)
})

// ===========================================================================
// Body rendering — no HTML path
// ===========================================================================

test("a body CANNOT execute HTML or script", () => {
  const hostile = '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">'
  const blocks = parseAnnouncementBody(hostile)

  // The parser emits text runs. There is no markup anywhere in the output, so
  // the component renders these as literal characters in a text node.
  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line) {
        assert.ok(run.kind === "text" || run.kind === "link")
        if (run.kind === "link") {
          assert.match(run.href, /^https?:\/\//)
        }
      }
    }
  }

  const flattened = JSON.stringify(blocks)
  assert.ok(flattened.includes("script"), "the text should be preserved verbatim, just inert")
  assert.ok(!flattened.includes('"kind":"html"'), "there is no html run kind, and must never be")
})

test("javascript: and data: URLs are never linked", () => {
  for (const hostile of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x"]) {
    const runs = parseInline(`click ${hostile} now`)
    assert.ok(!runs.some((run) => run.kind === "link"), `${hostile} became a link`)
  }
})

test("an https link becomes a safe anchor labelled by host", () => {
  const runs = parseInline("see https://realfiction.live/rules for details")
  const link = runs.find((run) => run.kind === "link")
  assert.ok(link && link.kind === "link")
  assert.equal(link.href, "https://realfiction.live/rules")
  assert.equal(link.label, "realfiction.live")
})

test("paragraphs and line breaks are structural, not markup", () => {
  const blocks = parseAnnouncementBody("One\nTwo\n\nThree")
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].lines.length, 2, "a single newline should be a line break")
  assert.equal(blocks[1].lines.length, 1)
})

test("control characters are stripped from a body", () => {
  // THE CONTRACT, stated as code points rather than a character class.
  //
  // `parseAnnouncementBody` keeps TAB (0x09), LF (0x0A), and everything from
  // 0x20 up; it removes every other C0 control - which includes CR (0x0D).
  //
  // The previous assertion embedded raw control bytes inside a regex range.
  // That is unreadable in a diff, invisible in most editors, and ambiguous to a
  // reader and to static analysis alike: a range written with literal control
  // characters cannot be checked by eye. A predicate over charCodeAt has no
  // range semantics to misread, and states the policy directly.
  const isRemoved = (code: number) => code < 0x20 && code !== 0x09 && code !== 0x0a
  const BELL = String.fromCharCode(0x07)
  const ESCAPE = String.fromCharCode(0x1b)

  const blocks = parseAnnouncementBody(`clean${BELL}text${ESCAPE}[31m`)
  const text = JSON.stringify(blocks)

  // The two characters actually supplied are gone, named explicitly.
  assert.ok(!text.includes(BELL), "BEL (U+0007) survived")
  assert.ok(!text.includes(ESCAPE), "ESC (U+001B) survived")

  // And nothing else in the removed set survived either.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    assert.ok(
      !isRemoved(code),
      `U+${code.toString(16).padStart(4, "0").toUpperCase()} survived at ${index}`
    )
  }

  // Stripping is not mangling: the visible text is untouched.
  assert.ok(text.includes("clean"), "surrounding text was lost")
  assert.ok(text.includes("text"), "surrounding text was lost")
})

test("EVERY C0 control is handled exactly as the contract says", () => {
  // Exhaustive over 0x00-0x1F, so the contract cannot drift silently.
  for (let code = 0x00; code < 0x20; code += 1) {
    const char = String.fromCharCode(code)
    const blocks = parseAnnouncementBody(`a${char}b`)
    // The RENDERED text, not JSON.stringify's output: stringify escapes a tab
    // as a backslash and a `t`, so searching its output for the character
    // itself reports a surviving tab as missing.
    const rendered = blocks
      .flatMap((block) => block.lines)
      .flat()
      .map((run) => (run.kind === "text" ? run.value : run.label))
      .join("")
    const label = `U+${code.toString(16).padStart(4, "0").toUpperCase()}`

    if (code === 0x09) {
      assert.ok(rendered.includes(char), "TAB must be preserved")
    } else if (code === 0x0a) {
      // LF is structural: it becomes a line break rather than a literal.
      assert.equal(blocks[0].lines.length, 2, "LF must still split lines")
    } else {
      assert.ok(!rendered.includes(char), `${label} was not removed`)
    }
  }
})
// ===========================================================================
// The canonical URL is the same everywhere
// ===========================================================================

test("the slug published is the slug every surface links to", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "one-url", publish: true })

  const feed = sql(DB, "select slug from public.published_announcements(50) limit 1")
  const latest = sql(DB, "select slug from public.latest_announcement()")

  // /updates links /updates/<slug>; /discord links /updates/<slug>; the Discord
  // embed url is built from the same slug in buildAnnouncementPayload.
  assert.equal(feed, "one-url")
  assert.equal(latest, "one-url")
})

// ===========================================================================
// Detail-route resolution
//
// The route renders a React server component, so these drive the resolution
// boundary the route calls — which is the thing that decides 404 vs render.
// ===========================================================================

const { getAnnouncementBySlug } = await import("./announcements/read.ts")

// The legacy slugs are read as TEXT rather than imported: lib/data.ts pulls in
// a .tsx icon module that Node's type-stripping cannot load, and importing it
// here would fail the file for a reason that has nothing to do with the test.
const legacySlugs = [
  ...(await import("node:fs")).readFileSync(new URL("./data.ts", import.meta.url), "utf8")
    .matchAll(/slug:\s*"([a-z0-9-]+)"/g)
].map((match) => match[1])

test("a PUBLISHED announcement resolves for its detail page", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "detail-ok", publish: true })

  const found = await getAnnouncementBySlug("detail-ok")
  assert.ok(found, "a published announcement did not resolve")
  assert.equal(found.title, "Season 4")
  assert.equal(found.body, "First paragraph.\n\nSecond paragraph.")
})

test("a DRAFT never resolves — the detail page 404s", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "still-draft", publish: false })

  assert.equal(await getAnnouncementBySlug("still-draft"), null)
})

test("a FUTURE-DATED announcement never resolves", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "next-week", publish: true })
  sql(DB, "update public.announcements set published_at = now() + interval '7 days'")

  assert.equal(
    await getAnnouncementBySlug("next-week"),
    null,
    "a scheduled announcement was publicly readable before its date"
  )
})

test("an unknown slug resolves to null", async () => {
  assert.equal(await getAnnouncementBySlug("no-such-thing"), null)
})

test("a malformed slug is refused before any query", async () => {
  for (const bad of ["", "../../etc/passwd", "a".repeat(200), "has spaces", "semi;colon"]) {
    assert.equal(await getAnnouncementBySlug(bad), null, `${bad} was accepted`)
  }
})

test("LEGACY static updates are untouched and still have detail pages", async () => {
  // The route checks the static array first, so these keep working regardless
  // of the database. Their URLs are in the wild and must not break.
  assert.ok(legacySlugs.length > 0, "no legacy update slugs were found")

  for (const slug of legacySlugs) {
    // None of them may collide with a canonical announcement slug, which would
    // make the database row permanently unreachable.
    assert.equal(
      await getAnnouncementBySlug(slug),
      null,
      `legacy slug ${slug} collides with a published announcement`
    )
  }
})

// ===========================================================================
// UNPUBLISH / RETRACT
//
// The website going private must never depend on Discord, and a retraction
// must never be able to produce a replacement message. Those two properties
// are what these tests exist to hold.
// ===========================================================================

const unpublish = (slug: string) => post({ action: "unpublish", slug })

test("STAFF can unpublish a published announcement", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "oops", publish: true })

  const response = await unpublish("oops")
  assert.equal(response.status, 200)
  assert.equal(sql(DB, "select status from public.announcements where slug='oops'"), "draft")
})

test("a NORMAL user cannot unpublish", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "protected", publish: true })

  asPlayer()
  const response = await unpublish("protected")
  assert.equal(response.status, 404)
  assert.equal(
    sql(DB, "select status from public.announcements where slug='protected'"),
    "published",
    "a customer took an announcement down"
  )
})

test("an unauthenticated request cannot unpublish", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "protected2", publish: true })

  signedOut()
  assert.equal((await unpublish("protected2")).status, 404)
  assert.equal(sql(DB, "select status from public.announcements where slug='protected2'"), "published")
})

test("an unpublished announcement DISAPPEARS from every public surface", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "gone", publish: true })

  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "1")
  assert.equal(sql(DB, "select slug from public.latest_announcement()"), "gone")

  await unpublish("gone")

  // /updates
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")
  // /discord
  assert.equal(sql(DB, "select coalesce((select slug from public.latest_announcement()),'none')"), "none")
  // /updates/[slug]
  assert.equal(await getAnnouncementBySlug("gone"), null, "the detail page would still render")
})

test("the row and its content SURVIVE — nothing is deleted", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "kept", publish: true })

  await unpublish("kept")

  assert.equal(sql(DB, "select count(*) from public.announcements where slug='kept'"), "1")
  assert.equal(sql(DB, "select body from public.announcements where slug='kept'"), VALID.body)
  assert.equal(sql(DB, "select title from public.announcements where slug='kept'"), "Season 4")
  assert.equal(sql(DB, "select slug from public.announcements where slug='kept'"), "kept", "the slug changed")
  assert.notEqual(
    sql(DB, "select coalesce(published_at::text,'null') from public.announcements where slug='kept'"),
    "null",
    "published_at was erased, losing the record of when it went out"
  )
})

test("a NEVER-MIRRORED announcement needs no Discord delete", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "web-only", publish: true, mirrorToDiscord: false })

  await unpublish("web-only")

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='web-only'"), "skipped")
  assert.equal(
    sql(DB, "select count(*) from public.claim_announcement_mirrors('w',5,120,6)"),
    "0",
    "a row with no Discord message was queued for deletion"
  )
})

test("a MIRRORED announcement schedules deletion, and the worker gets 'retract'", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "mirrored", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-9'")

  await unpublish("mirrored")

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='mirrored'"), "retract_pending")
  assert.equal(sql(DB, "select operation from public.claim_announcement_mirrors('w',5,120,6)"), "retract")
})

test("a Discord DELETE failure does NOT republish the website content", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "stubborn", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-stuck'")
  await unpublish("stubborn")

  const id = sql(DB, "select id from public.announcements where slug='stubborn'")
  sql(DB, `select public.complete_announcement_retraction('${id}','failed','provider_403')`)

  assert.equal(sql(DB, "select status from public.announcements where slug='stubborn'"), "draft")
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='stubborn'"), "retract_failed")
})

test("a SUCCESSFUL delete clears the message identity", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "cleared", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-old'")
  await unpublish("cleared")

  const id = sql(DB, "select id from public.announcements where slug='cleared'")
  sql(DB, `select public.complete_announcement_retraction('${id}','deleted')`)

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='cleared'"), "retracted")
  assert.equal(
    sql(DB, "select coalesce(discord_message_id,'CLEARED') from public.announcements where slug='cleared'"),
    "CLEARED",
    "a known-deleted message id was kept, so the next publish would PATCH a 404"
  )
})

test("a FAILED delete KEEPS the message identity, so republish cannot duplicate", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "uncertain", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-maybe'")
  await unpublish("uncertain")

  const id = sql(DB, "select id from public.announcements where slug='uncertain'")
  sql(DB, `select public.complete_announcement_retraction('${id}','failed','provider_403')`)

  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='uncertain'"),
    "m-maybe",
    "the id was cleared while the message may still exist — the next publish would POST a duplicate"
  )
})

test("REPUBLISH after a successful retract creates exactly ONE new message", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "again", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-first'")
  await unpublish("again")

  const id = sql(DB, "select id from public.announcements where slug='again'")
  sql(DB, `select public.complete_announcement_retraction('${id}','deleted')`)

  await post({ ...VALID, slug: "again", publish: true })

  assert.equal(sql(DB, "select status from public.announcements where slug='again'"), "published")
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='again'"), "pending")
  // No message id -> the worker POSTs. That is the ONE new message.
  assert.equal(
    sql(DB, "select coalesce(discord_message_id,'NONE') from public.announcements where slug='again'"),
    "NONE"
  )
  assert.equal(sql(DB, "select operation from public.claim_announcement_mirrors('w',5,120,6)"), "mirror")
  assert.equal(sql(DB, "select count(*) from public.announcements where slug='again'"), "1")
})

test("REPUBLISH after an UNCERTAIN delete PATCHes rather than duplicating", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "risky", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-alive'")
  await unpublish("risky")

  const id = sql(DB, "select id from public.announcements where slug='risky'")
  sql(DB, `select public.complete_announcement_retraction('${id}','failed','provider_500')`)

  await post({ ...VALID, slug: "risky", publish: true })

  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='risky'"),
    "m-alive",
    "republishing after an uncertain delete lost the id and would POST a second message"
  )
})

test("repeated unpublish is IDEMPOTENT", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "twice", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-2'")

  const first = await unpublish("twice")
  const firstBody = (await first.json()) as { changed?: boolean }
  const id = sql(DB, "select id from public.announcements where slug='twice'")
  sql(DB, `select public.complete_announcement_retraction('${id}','deleted')`)

  const second = await unpublish("twice")
  const secondBody = (await second.json()) as { changed?: boolean }

  assert.equal(firstBody.changed, true)
  assert.equal(secondBody.changed, false, "a second unpublish re-armed the mirror")
  assert.equal(
    sql(DB, "select discord_state from public.announcements where slug='twice'"),
    "retracted",
    "a second unpublish scheduled a DELETE for an already-removed message"
  )
  assert.equal(sql(DB, "select count(*) from public.announcements where slug='twice'"), "1")
})

test("unpublishing something that was never published changes nothing", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "just-a-draft", publish: false })

  const response = await unpublish("just-a-draft")
  const body = (await response.json()) as { changed?: boolean; status?: string }

  assert.equal(response.status, 200)
  assert.equal(body.changed, false)
  assert.equal(body.status, "draft")
})

test("a malformed or unknown slug is refused safely", async () => {
  asStaff()
  for (const bad of ["", "../x", "has spaces"]) {
    assert.equal((await unpublish(bad)).status, 400, `${bad} was accepted`)
  }
  const missing = await unpublish("no-such-announcement")
  assert.equal(missing.status, 200)
  assert.equal(((await missing.json()) as { status?: string }).status, "missing")
})

// ===========================================================================
// Republish timestamp semantics, and manual recovery from a stuck retraction
// ===========================================================================

const confirmRemoved = (slug: string) => post({ action: "confirm_discord_removed", slug })

/** now() is TRANSACTION time, so two publishes in one statement tie. */
const backdate = (slug: string, interval: string) =>
  sql(DB, `update public.announcements
           set published_at = now() - interval '${interval}',
               first_published_at = now() - interval '${interval}'
           where slug='${slug}'`)

test("REPUBLISH moves an announcement back to the top of the feed", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "older", publish: true })
  backdate("older", "10 days")
  await post({ ...VALID, slug: "newer", publish: true })
  backdate("newer", "2 days")

  assert.equal(sql(DB, "select slug from public.latest_announcement()"), "newer")

  await unpublish("older")
  await post({ ...VALID, slug: "older", publish: true })

  assert.equal(
    sql(DB, "select slug from public.latest_announcement()"),
    "older",
    "a deliberately republished announcement stayed buried under its original date"
  )
  assert.equal(
    sql(DB, "select string_agg(slug, ',' order by published_at desc) from public.published_announcements(50)"),
    "older,newer"
  )
})

test("republish RESTAMPS published_at but PRESERVES first_published_at", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "history", publish: true })
  backdate("history", "30 days")

  await unpublish("history")
  await post({ ...VALID, slug: "history", publish: true })

  assert.equal(
    sql(DB, "select (published_at > first_published_at)::text from public.announcements where slug='history'"),
    "true",
    "publication was not restamped, or history was overwritten"
  )
  assert.equal(
    sql(DB, "select (first_published_at < now() - interval '20 days')::text from public.announcements where slug='history'"),
    "true",
    "the original publication date was lost"
  )
})

test("a FIRST publish sets first_published_at (the insert path)", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "brand-new", publish: true })

  assert.equal(
    sql(DB, "select (first_published_at is not null)::text from public.announcements where slug='brand-new'"),
    "true",
    "a first-time publish left first_published_at null"
  )
})

test("a DRAFT has neither timestamp", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "unsent", publish: false })

  assert.equal(
    sql(DB, "select (published_at is null and first_published_at is null)::text from public.announcements where slug='unsent'"),
    "true"
  )
})

test("EDITING a live announcement does not bump it up the feed", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()

  await post({ ...VALID, slug: "first", publish: true })
  backdate("first", "5 days")
  await post({ ...VALID, slug: "second", publish: true })

  const before = sql(DB, "select published_at from public.announcements where slug='first'")
  await post({ ...VALID, slug: "first", title: "Typo fixed", publish: true })
  const after = sql(DB, "select published_at from public.announcements where slug='first'")

  assert.equal(before, after, "a typo fix reordered the feed")
  assert.equal(sql(DB, "select slug from public.latest_announcement()"), "second")
})

// ---- Manual recovery -------------------------------------------------------

async function stickARetraction(slug: string) {
  await post({ ...VALID, slug, publish: true })
  sql(DB, `update public.announcements set discord_state='delivered', discord_message_id='m-${slug}' where slug='${slug}'`)
  await unpublish(slug)
  const id = sql(DB, `select id from public.announcements where slug='${slug}'`)
  sql(DB, `select public.complete_announcement_retraction('${id}','failed','provider_403')`)
}

test("a failed retraction KEEPS the id, and republish before confirmation cannot duplicate", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await stickARetraction("stuck")

  assert.equal(sql(DB, "select discord_message_id from public.announcements where slug='stuck'"), "m-stuck")

  // Republishing now must PATCH the id we still hold, never POST beside it.
  await post({ ...VALID, slug: "stuck", publish: true })
  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='stuck'"),
    "m-stuck",
    "republishing before confirmation lost the id and would POST a duplicate"
  )
})

test("CONFIRMING manual removal clears the message identity", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await stickARetraction("cleanup")

  const response = await confirmRemoved("cleanup")
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { changed?: boolean }).changed, true)

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='cleanup'"), "retracted")
  assert.equal(
    sql(DB, "select coalesce(discord_message_id,'CLEARED') from public.announcements where slug='cleanup'"),
    "CLEARED"
  )
  // And it published nothing.
  assert.equal(sql(DB, "select status from public.announcements where slug='cleanup'"), "draft")
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")
})

test("after confirmation, publishing posts EXACTLY ONE new message", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await stickARetraction("reborn")
  await confirmRemoved("reborn")

  await post({ ...VALID, slug: "reborn", publish: true })

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='reborn'"), "pending")
  assert.equal(
    sql(DB, "select coalesce(discord_message_id,'NONE') from public.announcements where slug='reborn'"),
    "NONE",
    "an id survived confirmation, so the worker would PATCH instead of posting anew"
  )
  assert.equal(sql(DB, "select operation from public.claim_announcement_mirrors('w',5,120,6)"), "mirror")
  assert.equal(sql(DB, "select count(*) from public.announcements where slug='reborn'"), "1")
})

test("UNAUTHORIZED users cannot confirm removal", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await stickARetraction("guarded")

  for (const who of [signedOut, asPlayer]) {
    who()
    assert.equal((await confirmRemoved("guarded")).status, 404)
  }

  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='guarded'"),
    "m-guarded",
    "a non-staff request cleared the message identity"
  )
})

test("REPEATED confirmation is safe", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await stickARetraction("twice-confirmed")

  const first = (await (await confirmRemoved("twice-confirmed")).json()) as { changed?: boolean }
  const second = (await (await confirmRemoved("twice-confirmed")).json()) as { changed?: boolean }

  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.equal(
    sql(DB, "select discord_state from public.announcements where slug='twice-confirmed'"),
    "retracted"
  )
})

test("confirmation is NOT available merely because a delete timed out", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "still-trying", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-live' where slug='still-trying'")
  await unpublish("still-trying")

  // retract_pending: the worker is still retrying, and the message is very
  // probably still there.
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='still-trying'"), "retract_pending")

  const response = await confirmRemoved("still-trying")
  assert.equal(((await response.json()) as { changed?: boolean }).changed, false)
  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='still-trying'"),
    "m-live",
    "a still-retrying retraction had its id cleared, which would duplicate the message"
  )
})

test("confirmation cannot clear a LIVE delivered message", async () => {
  sql(DB, "delete from public.announcements")
  asStaff()
  await post({ ...VALID, slug: "live-one", publish: true })
  sql(DB, "update public.announcements set discord_state='delivered', discord_message_id='m-current' where slug='live-one'")

  const response = await confirmRemoved("live-one")
  assert.equal(((await response.json()) as { changed?: boolean }).changed, false)
  assert.equal(sql(DB, "select discord_message_id from public.announcements where slug='live-one'"), "m-current")
})

// ===========================================================================
// Slug normalisation — shape and complexity
//
// The previous implementation chained `.replace(/[^a-z0-9]+/g, "-")` with
// `.replace(/^-+|-+$/g, "")`. The second alternation is polynomial: against a
// long run of hyphens the engine retries `-+$` from every position, so
// `"-".repeat(n)` costs O(n squared). It was reachable from an unauthenticated
// request body, because normalisation runs BEFORE the length check that would
// have rejected the input.
//
// These exercise the shapes that were pathological. They assert OUTPUT, not
// timing: a wall-clock threshold is the flaky way to test this, and a correct
// single-pass implementation is what actually makes the shape safe.
// ===========================================================================

const SLUG_MAX = 80

test("a huge run of hyphens normalises to nothing", () => {
  // The exact former pathological input.
  assert.equal(normalizeSlug("-".repeat(50_000)), "")
  assert.equal(normalizeSlug("-".repeat(1_000_000)), "")
})

test("huge runs of arbitrary punctuation normalise to nothing", () => {
  for (const filler of ["!", ".", "_", " ", "/", "@"]) {
    assert.equal(normalizeSlug(filler.repeat(100_000)), "", `${filler} produced output`)
  }
})

test("alternating valid and invalid characters collapse correctly", () => {
  assert.equal(normalizeSlug("a-b-c"), "a-b-c")
  assert.equal(normalizeSlug("a!b!c"), "a-b-c")
  assert.equal(normalizeSlug("a!!!b"), "a-b")
  // A long alternation is bounded by the slug limit, not by the input.
  const result = normalizeSlug("a!".repeat(100_000))
  assert.ok(result.length <= SLUG_MAX)
  assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result), `invalid slug: ${result}`)
})

test("all-invalid input yields an empty slug, and validation rejects it", () => {
  for (const input of ["", "   ", "!!!", "///", "éè", "-".repeat(500)]) {
    assert.equal(normalizeSlug(input), "", `${JSON.stringify(input)} produced output`)
  }
  const result = validateAnnouncement({ ...VALID, slug: "!!!" })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.field, "slug")
})

test("leading and trailing separators are dropped", () => {
  assert.equal(normalizeSlug("---season---"), "season")
  assert.equal(normalizeSlug("   season   "), "season")
  assert.equal(normalizeSlug("!!!season!!!"), "season")
  assert.equal(normalizeSlug("-a-"), "a")
})

test("output is bounded by the slug limit", () => {
  assert.equal(normalizeSlug("x".repeat(500)).length, SLUG_MAX)
  assert.ok(normalizeSlug("season ".repeat(200)).length <= SLUG_MAX)
})

test("TRUNCATION NEVER LEAVES A TRAILING HYPHEN", () => {
  // The old implementation did exactly this, producing a slug its OWN validator
  // then rejected: `.slice()` ran after the trim, so a cut landing on a
  // separator left one behind.
  const shapes = [
    "x".repeat(SLUG_MAX - 1) + "-y",   // cut immediately after a separator
    "x".repeat(SLUG_MAX) + "-y",       // cut exactly at the limit
    "a-".repeat(SLUG_MAX),             // separator every other character
    "ab!".repeat(SLUG_MAX),
    "word ".repeat(SLUG_MAX)
  ]

  for (const shape of shapes) {
    const slug = normalizeSlug(shape)
    assert.ok(!slug.endsWith("-"), `trailing hyphen for ${JSON.stringify(shape.slice(0, 20))}…`)
    assert.ok(!slug.startsWith("-"), `leading hyphen for ${JSON.stringify(shape.slice(0, 20))}…`)
    assert.ok(slug.length <= SLUG_MAX)
    // The real point: whatever comes out must satisfy the validator.
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), `invalid slug produced: ${slug}`)
  }
})

test("a TITLE-DERIVED truncated slug is accepted by validateAnnouncement", () => {
  // End to end, because the old bug only surfaced when the two met: normalise
  // produced a trailing hyphen and SLUG_PATTERN then refused it.
  //
  // Driven through the title path, which is where truncation legitimately
  // happens — an explicit slug over LIMITS.slug is now rejected outright rather
  // than truncated, so it cannot exercise this.
  const derived = normalizeSlug("x".repeat(SLUG_MAX - 1) + "-y")
  assert.ok(!derived.endsWith("-"), "truncation left a trailing hyphen")
  assert.equal(
    validateAnnouncement({ ...VALID, slug: derived }).ok,
    true,
    "a truncated slug was rejected by its own validator"
  )
})

test("runs of separators never produce consecutive hyphens", () => {
  for (const input of ["a!!!!!!!!!!b", "a          b", "a---------b", "a!-!-!-!-!b"]) {
    const slug = normalizeSlug(input)
    assert.ok(!slug.includes("--"), `consecutive hyphens in ${slug}`)
    assert.equal(slug, "a-b")
  }
})

test("case folding and digits behave as before", () => {
  assert.equal(normalizeSlug("Season 4"), "season-4")
  assert.equal(normalizeSlug("SEASON FOUR"), "season-four")
  assert.equal(normalizeSlug("Season 4: The Return!"), "season-4-the-return")
})

test("oversized input is bounded BEFORE the scan", () => {
  // O(n) is not the same as free. A slug derived from a valid title must still
  // normalise identically, which is why the bound is the canonical title limit
  // rather than a new number.
  const title = "Season ".repeat(20).trim()
  assert.ok(title.length <= 140)
  assert.equal(normalizeSlug(title), normalizeSlug(title + "x".repeat(1_000_000)).slice(0, normalizeSlug(title).length))
})

// ===========================================================================
// Unicode folding, and the raw-input contract
// ===========================================================================

test("UNICODE CASE FOLDING is preserved exactly", () => {
  // `.toLowerCase()` runs before ASCII classification, so a character that
  // folds INTO the accepted set is still accepted. U+212A KELVIN SIGN folds to
  // ASCII "k"; treating it as a separator would silently narrow the charset.
  assert.equal(normalizeSlug("K"), "k", "U+212A KELVIN SIGN must fold to k")
  assert.equal(normalizeSlug("Kelvin"), "kelvin")
  // U+0130 LATIN CAPITAL I WITH DOT folds to "i" plus a combining mark; the
  // "i" survives and the mark becomes a separator, which is then dropped.
  assert.equal(normalizeSlug("İ"), "i")
  assert.equal(normalizeSlug("A"), "a")

  // Characters that do NOT fold into [a-z0-9] are separators, as before.
  for (const ch of ["ſ", "ẞ", "É", "Ａ"]) {
    assert.equal(normalizeSlug(ch), "", `${JSON.stringify(ch)} should not survive`)
  }
})

test("an OVER-LONG raw slug is REJECTED, never silently truncated", () => {
  // A slug may be supplied directly, independently of a title. Truncating it to
  // the scan bound would change what the caller asked for — 140 punctuation
  // characters followed by "abc" would become "" and be refused for the wrong
  // reason.
  const overLong = "!".repeat(140) + "abc"
  const result = validateAnnouncement({ ...VALID, slug: overLong })

  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.field, "slug")
  assert.match(
    result.ok === false ? result.message : "",
    /too long/i,
    "the message must name the real problem, not the character set"
  )
})

// ===========================================================================
// The EXPLICIT-SLUG contract
//
// An explicit slug is its own field with its own maximum — the same one the
// form enforces with maxLength={80}. Measuring it against the title-derived
// scan bound let a 100-character slug normalise quietly down to 80 and be
// accepted, handing the caller a slug they never asked for.
// ===========================================================================

test("an explicit slug of exactly LIMITS.slug is ACCEPTED", () => {
  const result = validateAnnouncement({ ...VALID, slug: "a".repeat(SLUG_MAX) })
  assert.equal(result.ok, true)
  assert.equal(result.ok === true && result.value.slug.length, SLUG_MAX)
})

test("an explicit slug ONE OVER the limit is rejected with the right message", () => {
  const result = validateAnnouncement({ ...VALID, slug: "a".repeat(SLUG_MAX + 1) })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.field, "slug")
  assert.match(result.ok === false ? result.message : "", /too long/i)
})

test("an explicit 100-character slug is REJECTED, not silently truncated", () => {
  // The exact defect: this used to normalise to 80 characters and pass.
  const result = validateAnnouncement({ ...VALID, slug: "a".repeat(100) })
  assert.equal(result.ok, false, "a 100-character slug was silently truncated and accepted")
  assert.match(result.ok === false ? result.message : "", /too long/i)
})

test("a TITLE of LIMITS.title still derives a valid slug within LIMITS.slug", () => {
  // The title path legitimately exceeds the slug limit and is meant to be
  // normalised down. Tightening the explicit-slug bound must not break it.
  const title = "Season Four The Return ".repeat(10).slice(0, 140)
  assert.equal(title.length, 140)

  const derived = normalizeSlug(title)
  assert.ok(derived.length <= SLUG_MAX, `derived slug was ${derived.length}`)
  assert.ok(!derived.endsWith("-"))
  assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(derived), `invalid derived slug: ${derived}`)
  assert.equal(validateAnnouncement({ ...VALID, slug: derived }).ok, true)
})

test("length is measured in UTF-16 code units, as HTML maxLength counts", () => {
  // No separate counting rule introduced for this field. 40 astral characters
  // are 80 code units to both `.length` and `maxLength`.
  const astral = "\u{1F600}".repeat(40)
  assert.equal(astral.length, SLUG_MAX, "the fixture is not 80 code units")
  // Rejected for its character set, having passed the length gate — which is
  // the proof that the gate measured it the same way the form does.
  const result = validateAnnouncement({ ...VALID, slug: astral })
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.message : "", /lowercase letters/i)

  // One code unit more is refused for LENGTH instead.
  const tooLong = astral + "a"
  assert.equal(tooLong.length, SLUG_MAX + 1)
  assert.match(
    (() => { const r = validateAnnouncement({ ...VALID, slug: tooLong }); return r.ok === false ? r.message : "" })(),
    /too long/i
  )
})

test("truncation inside normalizeSlug is UNREACHABLE from the request path", () => {
  // Called directly it still truncates — that is its DoS guard for the title
  // path. The validator rejects first, so no request can reach it.
  assert.equal(normalizeSlug("a".repeat(500)).length, SLUG_MAX)
  assert.equal(validateAnnouncement({ ...VALID, slug: "a".repeat(500) }).ok, false)
  assert.equal(validateAnnouncement({ ...VALID, slug: "!".repeat(140) + "abc" }).ok, false)
})
