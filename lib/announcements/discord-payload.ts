// The Discord message for a RealFiction announcement.
//
// Pure: no network, no secrets, no "server-only" — so every rule about what may
// reach a public Discord channel is enforced by a test rather than by whoever
// edits the mirror worker next.
//
// MENTIONS ARE SUPPRESSED STRUCTURALLY
// ====================================
// `allowed_mentions: { parse: [] }` tells Discord to resolve NOTHING: no
// @everyone, no @here, no roles, no users, regardless of what the text
// contains. That is the defence, not the text-stripping below — stripping is
// belt to that braces, because an announcement that accidentally pings a whole
// server is the kind of mistake you only get to make once.
//
// The same technique is already used by lib/contact-notify.ts; this follows it
// deliberately rather than inventing a second approach.

/** Discord's documented limits, with room to spare. */
export const LIMITS = {
  title: 256,
  description: 4096,
  fieldValue: 1024,
  footer: 2048,
  /** Our own cap: an announcement embed should be readable, not a wall. */
  excerpt: 900
} as const

export type AnnouncementForDiscord = {
  slug: string
  title: string
  excerpt: string
  category: string
  publishedAt: string | null
  authorDisplay: string | null
  imageUrl: string | null
}

/** Truncates on a character budget, leaving a visible ellipsis. */
export function clip(value: string, max: number): string {
  const text = String(value ?? "")
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Removes mention syntax from text we are about to publish.
 *
 * Redundant with `allowed_mentions` by design. If a future edit drops the
 * allowed_mentions field, this still prevents the worst outcome, and if this is
 * removed, allowed_mentions still does. Two independent guards for a mistake
 * that is broadcast to everyone.
 */
export function stripMentions(value: string): string {
  return String(value ?? "")
    .replace(/@(everyone|here)\b/gi, "")
    // Raw mention markup: <@123>, <@!123>, <@&123>.
    .replace(/<@[!&]?\d+>/g, "")
    // A bare @word cannot ping without an id, but it reads as an attempt.
    .replace(/@{2,}/g, "@")
    .replace(/[ \t]+/g, " ")
    .trim()
}

/** Only https images, and only ones we serve or Discord already hosts. */
export function safeImageUrl(raw: string | null, siteUrl: string): string | null {
  if (!raw) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(raw, siteUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") {
    return null
  }
  const allowed = new Set([new URL(siteUrl).host, "cdn.discordapp.com", "media.discordapp.net"])
  return allowed.has(parsed.host) ? parsed.href : null
}

/**
 * Builds the webhook body.
 *
 * The canonical link is the point of the whole message: Discord carries the
 * headline, realfiction.live carries the announcement.
 */
export function buildAnnouncementPayload(
  announcement: AnnouncementForDiscord,
  siteUrl: string
): Record<string, unknown> {
  const base = siteUrl.replace(/\/$/, "")
  const url = `${base}/updates/${announcement.slug}`
  const image = safeImageUrl(announcement.imageUrl, base)

  const description = clip(stripMentions(announcement.excerpt), LIMITS.excerpt)
  const author = stripMentions(announcement.authorDisplay ?? "")

  return {
    // No `content`, only an embed. A top-level content string is where mention
    // text would be most likely to render, and we have nothing to put there.
    username: "RealFiction",
    embeds: [
      {
        title: clip(stripMentions(announcement.title), LIMITS.title),
        url,
        description: description || undefined,
        color: 0xf2c66d,
        timestamp: announcement.publishedAt ?? undefined,
        author: author ? { name: clip(author, 256) } : undefined,
        image: image ? { url: image } : undefined,
        footer: {
          text: clip(`${announcement.category} · realfiction.live`, LIMITS.footer)
        }
      }
    ],
    // THE guard. Discord resolves no mention of any kind from this message.
    allowed_mentions: { parse: [] as string[] }
  }
}
