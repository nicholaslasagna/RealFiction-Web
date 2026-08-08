// Announcements: RealFiction publishes, Discord receives a copy.
//
// The properties that matter are the ones that are expensive to get wrong in
// public: a draft appearing, a duplicate announcement in a channel nobody can
// un-send from, an @everyone nobody intended, and a webhook URL in a bundle.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_ANNOUNCE_DB ?? "rf_announce"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})

const { buildAnnouncementPayload, clip, safeImageUrl, stripMentions } = await import(
  "./announcements/discord-payload.ts"
)

const holder: { client: unknown } = { client: null }
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => holder.client } })

const { mirrorAnnouncements } = await import("./announcements/mirror.ts")

const SITE = "https://realfiction.live"
const WEBHOOK = "https://discord.com/api/webhooks/123/tok"

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-not-real",
  DISCORD_ANNOUNCEMENTS_WEBHOOK_URL: WEBHOOK,
  NEXT_PUBLIC_SITE_URL: SITE
}

let seq = 0
function publish(over: Record<string, string | boolean> = {}) {
  const slug = (over.slug as string) ?? `note-${++seq}`
  const publishFlag = over.publish === false ? "false" : "true"
  sql(
    DB,
    `select public.publish_announcement('${slug}', '${over.title ?? "Season 4"}',
      '${over.excerpt ?? "It starts Friday."}', '${over.body ?? "Body"}',
      '${over.category ?? "Announcement"}', null, null, true, ${publishFlag})`
  )
  return slug
}

function discord(handler: (url: string, init: RequestInit) => { ok: boolean; status: number; body?: unknown }) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    const parsed = handler(String(url), init ?? {})
    calls.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      body: JSON.parse(String(init?.body ?? "{}"))
    })
    return { ok: parsed.ok, status: parsed.status, json: async () => parsed.body ?? {} }
  }) as unknown as typeof fetch
  return { impl, calls }
}

const ok = (id = "msg-1") => () => ({ ok: true, status: 200, body: { id } })

function run(fetchImpl: typeof fetch) {
  holder.client = createPgSupabaseClient(DB)
  return mirrorAnnouncements(ENV, { fetchImpl, workerId: "test" })
}

// ===========================================================================
// Canonical selection and draft safety
// ===========================================================================

test("the latest published announcement is the newest one", () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "older", title: "Older" })
  sql(DB, "update public.announcements set published_at = now() - interval '2 days'")
  publish({ slug: "newer", title: "Newer" })

  assert.equal(sql(DB, "select title from public.latest_announcement()"), "Newer")
})

test("a DRAFT never appears publicly", () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "draft-one", title: "Unreleased", publish: false })

  assert.equal(sql(DB, "select coalesce((select title from public.latest_announcement()), 'none')"), "none")
  assert.equal(sql(DB, "select count(*) from public.published_announcements(50)"), "0")
  assert.equal(sql(DB, "select status from public.announcements where slug='draft-one'"), "draft")
})

test("a FUTURE-dated announcement is not published early", () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "future", title: "Later" })
  sql(DB, "update public.announcements set published_at = now() + interval '1 day'")

  assert.equal(sql(DB, "select coalesce((select title from public.latest_announcement()), 'none')"), "none")
})

test("/updates and /discord read the SAME canonical row", () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "shared", title: "Shared headline" })

  const latest = sql(DB, "select slug from public.latest_announcement()")
  const feedTop = sql(DB, "select slug from public.published_announcements(50) limit 1")
  assert.equal(latest, feedTop, "the two surfaces disagree about the latest announcement")
})

test("a draft never reaches Discord", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "secret", publish: false })

  const stripe = discord(ok())
  const result = await run(stripe.impl)

  assert.equal(result.claimed, 0, "a draft was claimed for mirroring")
  assert.deepEqual(stripe.calls, [], "a draft reached Discord")
})

// ===========================================================================
// Publishing is idempotent; retries cannot duplicate
// ===========================================================================

test("publishing the SAME content twice does not re-arm the mirror", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "same", title: "Stable" })
  await run(discord(ok("m-1")).impl)
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='same'"), "delivered")

  publish({ slug: "same", title: "Stable" })
  assert.equal(
    sql(DB, "select discord_state from public.announcements where slug='same'"),
    "delivered",
    "an identical republish re-armed the mirror"
  )

  const second = discord(ok("m-2"))
  const result = await run(second.impl)
  assert.equal(result.claimed, 0)
  assert.deepEqual(second.calls, [], "an identical republish posted to Discord again")
})

test("a RETRY never produces a second Discord post", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "retry-me" })

  // First attempt: Discord is down.
  const down = discord(() => ({ ok: false, status: 503 }))
  await run(down.impl)
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='retry-me'"), "retrying")
  assert.equal(down.calls.length, 1)

  // Make it due, then succeed.
  sql(DB, "update public.announcements set discord_next_attempt_at = now() - interval '1 hour'")
  const up = discord(ok("only-message"))
  await run(up.impl)

  assert.equal(up.calls.length, 1)
  assert.equal(up.calls[0].method, "POST")
  assert.equal(sql(DB, "select discord_message_id from public.announcements where slug='retry-me'"), "only-message")

  // And a third pass posts nothing at all.
  const third = discord(ok("should-not-happen"))
  const result = await run(third.impl)
  assert.equal(result.claimed, 0)
  assert.deepEqual(third.calls, [])
})

test("an EDIT patches the existing message instead of posting a new one", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "edited", title: "First wording" })
  await run(discord(ok("m-edit")).impl)

  publish({ slug: "edited", title: "Corrected wording" })
  assert.equal(sql(DB, "select discord_state from public.announcements where slug='edited'"), "pending")

  const edit = discord(ok("m-edit"))
  await run(edit.impl)

  assert.equal(edit.calls.length, 1)
  assert.equal(edit.calls[0].method, "PATCH", "an edit posted a new message instead of patching")
  assert.match(edit.calls[0].url, /\/messages\/m-edit$/)
  assert.equal(
    sql(DB, "select discord_message_id from public.announcements where slug='edited'"),
    "m-edit",
    "the message id changed"
  )
})

test("a FAILED edit goes to review and never re-posts", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "gone", title: "Original" })
  await run(discord(ok("m-gone")).impl)

  // Somebody deleted the message in Discord.
  publish({ slug: "gone", title: "Amended" })
  const missing = discord(() => ({ ok: false, status: 404 }))
  await run(missing.impl)

  assert.equal(
    sql(DB, "select discord_state from public.announcements where slug='gone'"),
    "review_required",
    "a deleted message should stop for a human"
  )

  const after = discord(ok("duplicate"))
  const result = await run(after.impl)
  assert.equal(result.claimed, 0, "a review_required row was re-claimed")
  assert.deepEqual(after.calls, [], "a failed edit fell back to posting a duplicate")
})

// ===========================================================================
// Discord failure must not affect the website
// ===========================================================================

test("a Discord outage does NOT unpublish or alter the website announcement", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "resilient", title: "Still live" })

  await run(discord(() => ({ ok: false, status: 500 })).impl)

  assert.equal(sql(DB, "select status from public.announcements where slug='resilient'"), "published")
  assert.equal(sql(DB, "select title from public.latest_announcement()"), "Still live")
})

test("with NO webhook configured, nothing is claimed and the site is unaffected", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "no-hook", title: "Live anyway" })

  holder.client = createPgSupabaseClient(DB)
  const stripe = discord(ok())
  const result = await mirrorAnnouncements(
    { ...ENV, DISCORD_ANNOUNCEMENTS_WEBHOOK_URL: "" },
    { fetchImpl: stripe.impl }
  )

  assert.equal(result.claimed, 0, "attempts were burned with no webhook configured")
  assert.deepEqual(stripe.calls, [])
  assert.equal(sql(DB, "select title from public.latest_announcement()"), "Live anyway")
})

test("attempts are bounded, then the row stops for a human", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "doomed" })

  for (let i = 0; i < 8; i++) {
    sql(DB, "update public.announcements set discord_next_attempt_at = now() - interval '1 hour'")
    await run(discord(() => ({ ok: false, status: 500 })).impl)
  }

  assert.equal(sql(DB, "select discord_state from public.announcements where slug='doomed'"), "failed")
  assert.ok(Number(sql(DB, "select discord_attempts from public.announcements where slug='doomed'")) <= 6)
})

// ===========================================================================
// The payload
// ===========================================================================

test("MENTIONS are suppressed structurally and textually", () => {
  const payload = buildAnnouncementPayload(
    {
      slug: "s",
      title: "@everyone read this",
      excerpt: "cc <@123456> and <@&987> and @here",
      category: "Announcement",
      publishedAt: null,
      authorDisplay: null,
      imageUrl: null
    },
    SITE
  )

  // The structural guard: Discord resolves nothing.
  assert.deepEqual(payload.allowed_mentions, { parse: [] })

  const embed = (payload.embeds as Record<string, string>[])[0]
  assert.ok(!embed.title.includes("@everyone"))
  assert.ok(!embed.description.includes("@here"))
  assert.ok(!/<@[!&]?\d+>/.test(embed.description))
  // And no top-level content, where mention text renders most readily.
  assert.equal(payload.content, undefined)
})

test("content is truncated safely to Discord's limits", () => {
  const payload = buildAnnouncementPayload(
    {
      slug: "s",
      title: "T".repeat(500),
      excerpt: "E".repeat(5000),
      category: "News",
      publishedAt: null,
      authorDisplay: null,
      imageUrl: null
    },
    SITE
  )
  const embed = (payload.embeds as Record<string, string>[])[0]
  assert.ok(embed.title.length <= 256, `title was ${embed.title.length}`)
  assert.ok(embed.description.length <= 900, `description was ${embed.description.length}`)
  assert.ok(embed.title.endsWith("…"))
})

test("clip never exceeds its budget and marks truncation", () => {
  assert.equal(clip("short", 10), "short")
  assert.equal(clip("abcdefghij", 5).length, 5)
  assert.ok(clip("abcdefghij", 5).endsWith("…"))
})

test("only https images from our own site or Discord's CDN are embedded", () => {
  assert.equal(safeImageUrl("https://realfiction.live/images/a.png", SITE), "https://realfiction.live/images/a.png")
  assert.equal(safeImageUrl("/images/a.png", SITE), "https://realfiction.live/images/a.png")
  assert.equal(safeImageUrl("https://evil.example/a.png", SITE), null)
  assert.equal(safeImageUrl("http://realfiction.live/a.png", SITE), null)
  assert.equal(safeImageUrl("javascript:alert(1)", SITE), null)
})

test("the embed links back to the canonical RealFiction update", () => {
  const payload = buildAnnouncementPayload(
    {
      slug: "season-4",
      title: "Season 4",
      excerpt: "x",
      category: "Announcement",
      publishedAt: "2026-08-09T10:00:00.000Z",
      authorDisplay: "Staff",
      imageUrl: null
    },
    SITE
  )
  const embed = (payload.embeds as Record<string, unknown>[])[0]
  assert.equal(embed.url, "https://realfiction.live/updates/season-4")
  assert.equal(embed.timestamp, "2026-08-09T10:00:00.000Z")
  assert.equal(payload.username, "RealFiction")
})

test("stripMentions leaves ordinary text intact", () => {
  assert.equal(stripMentions("Season 4 starts Friday at 6pm"), "Season 4 starts Friday at 6pm")
})

// ===========================================================================
// Secrets
// ===========================================================================

test("the webhook URL never appears in a result", async () => {
  sql(DB, "delete from public.announcements")
  publish({ slug: "secretive" })
  const result = await run(discord(() => ({ ok: false, status: 500 })).impl)
  assert.ok(!JSON.stringify(result).includes("discord.com/api/webhooks"))
  assert.ok(!JSON.stringify(result).includes("tok"))
})
