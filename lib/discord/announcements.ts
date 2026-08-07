// Reading the latest announcement from the RealFiction Discord.
//
// WHAT THIS NEEDS THAT THE REPO DOES NOT HAVE
// ===========================================
// Member counts come from Discord's UNAUTHENTICATED invite endpoint, which is
// why the homepage card already works with no credentials. Reading MESSAGES is
// different: there is no anonymous way to do it. It requires a bot that is a
// member of the guild, with `View Channel` + `Read Message History` on the
// announcements channel, and a token sent as `Authorization: Bot <token>`.
//
// Neither the token nor the channel id exists in this repository, so
// `isAnnouncementsConfigured()` returns false and the page renders a graceful
// state rather than a placeholder pretending an integration exists. Set both
// values and this starts working with no further code change:
//
//   DISCORD_BOT_TOKEN              a bot token, runtime SECRET (never a var)
//   DISCORD_ANNOUNCEMENTS_CHANNEL_ID   the channel's numeric id
//
// A WEBHOOK URL IS NOT A SUBSTITUTE. `DISCORD_CONTACT_WEBHOOK_URL` already
// exists in this repo and cannot be used here: webhooks are write-only, and
// Discord provides no way to read a channel through one.
//
// THE OUTPUT IS PLAIN TEXT, NEVER HTML
// ====================================
// Everything below treats the message as hostile input. Discord content is
// written by people, some of whom are not staff, and a compromised staff
// account is a real scenario. So this returns plain text and a small list of
// explicitly-validated links; the page renders those as text and anchors it
// builds itself. Nothing from Discord is ever passed to `dangerouslySetInnerHTML`
// or interpolated into markup.

import "server-only"

/** The shape the page renders. Nothing here is raw Discord content. */
export type Announcement = {
  /** Plain text. Markdown stripped, mentions neutralised, no HTML. */
  text: string
  /** Display name only. Never an id, never a discriminator. */
  author: string
  /** ISO 8601, from Discord's own timestamp. */
  postedAt: string
  /** Validated https links found in the message, deduped and capped. */
  links: { url: string; label: string }[]
  /** Image attachments from Discord's CDN only. */
  images: { url: string; alt: string }[]
}

export type AnnouncementResult =
  | { status: "ok"; announcement: Announcement }
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | { status: "empty" }

const MAX_TEXT = 1200
const MAX_LINKS = 4
const MAX_IMAGES = 1

/** Hosts we will render an image from. Discord's CDN only. */
const IMAGE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"])

export function isAnnouncementsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN?.trim() && env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim())
}

/**
 * Strips Discord markup down to readable plain text.
 *
 * Deliberately conservative and deliberately LOSSY. This is not a markdown
 * renderer: the goal is that whatever a message contains, the result is text
 * that can be placed in a text node without surprises.
 */
export function toPlainText(raw: string): string {
  let text = String(raw ?? "")

  // Custom emoji `<:name:123>` / `<a:name:123>` -> `:name:`
  text = text.replace(/<a?:(\w+):\d+>/g, ":$1:")
  // Channel and role/user mentions -> neutral words. We cannot resolve names
  // without more gateway permissions, and printing a raw id helps nobody.
  text = text.replace(/<#\d+>/g, "#channel")
  text = text.replace(/<@&\d+>/g, "@role")
  text = text.replace(/<@!?\d+>/g, "@member")
  // Mass pings are stripped rather than displayed: rendering "@everyone" on a
  // web page imitates a notification that is not happening.
  text = text.replace(/@(everyone|here)\b/g, "")
  // Markdown link `[label](url)` -> `label` (the url is collected separately).
  text = text.replace(/\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g, "$1")
  // Emphasis, headings, quotes, inline code, spoilers.
  text = text.replace(/```[\s\S]*?```/g, " ")
  text = text.replace(/`([^`]*)`/g, "$1")
  text = text.replace(/\|\|([^|]*)\|\|/g, "$1")
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "")
  text = text.replace(/^\s{0,3}>\s?/gm, "")
  text = text.replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, "")
  // Control characters, which could break out of a plain-text block.
  text = [...text].filter((ch) => ch === "\n" || ch >= " ").join("")
  // Collapse runs of blank lines, then trim and bound.
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()

  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text
}

/**
 * Keeps only links we are willing to put in an `href`.
 *
 * An allowlist of SCHEMES, not a blocklist: `javascript:`, `data:`, `vbscript:`
 * and whatever comes next are all excluded by not being http(s), rather than by
 * being individually remembered.
 */
export function safeLinks(raw: string): { url: string; label: string }[] {
  const found = new Map<string, string>()

  for (const match of String(raw ?? "").matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
    let parsed: URL
    try {
      parsed = new URL(match[0])
    } catch {
      continue
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      continue
    }
    if (found.has(parsed.href)) {
      continue
    }
    // The label is the HOST, not the full URL: a long link pasted into an
    // announcement should not become the loudest thing on the page, and a host
    // is what a reader actually needs to judge where they are going.
    found.set(parsed.href, parsed.host.replace(/^www\./, ""))
    if (found.size >= MAX_LINKS) {
      break
    }
  }

  return [...found].map(([url, label]) => ({ url, label }))
}

type DiscordAttachment = { url?: string; content_type?: string; filename?: string }
type DiscordMessage = {
  content?: string
  timestamp?: string
  author?: { global_name?: string | null; username?: string | null; bot?: boolean }
  attachments?: DiscordAttachment[]
}

function safeImages(attachments: DiscordAttachment[]): { url: string; alt: string }[] {
  const images: { url: string; alt: string }[] = []

  for (const attachment of attachments) {
    if (images.length >= MAX_IMAGES) {
      break
    }
    if (!attachment.url || !attachment.content_type?.startsWith("image/")) {
      continue
    }
    let parsed: URL
    try {
      parsed = new URL(attachment.url)
    } catch {
      continue
    }
    // Discord's CDN over https, and nothing else. An attachment url is
    // attacker-influenced in the sense that it comes from message content we do
    // not control, so the host is checked rather than assumed.
    if (parsed.protocol !== "https:" || !IMAGE_HOSTS.has(parsed.host)) {
      continue
    }
    images.push({ url: parsed.href, alt: "" })
  }

  return images
}

/** Display name, bounded and stripped of anything but plain characters. */
function safeAuthor(message: DiscordMessage): string {
  const raw = message.author?.global_name || message.author?.username || "RealFiction"
  return toPlainText(raw).slice(0, 40) || "RealFiction"
}

/**
 * The latest eligible announcement.
 *
 * Cached for five minutes via the fetch cache, matching the member-count card:
 * an announcements channel does not change often, and a page render must not
 * become a Discord API call.
 *
 * Never throws. Every failure — unconfigured, rate limited, revoked token,
 * network — resolves to a status the page can render.
 */
export async function getLatestAnnouncement(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<AnnouncementResult> {
  if (!isAnnouncementsConfigured(env)) {
    return { status: "unconfigured" }
  }

  const channel = env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID!.trim()
  // A channel id is a snowflake. Validated so a misconfigured value cannot be
  // used to point this request at an arbitrary path.
  if (!/^\d{5,25}$/.test(channel)) {
    return { status: "unconfigured" }
  }

  try {
    const response = await fetchImpl(
      `https://discord.com/api/v10/channels/${channel}/messages?limit=10`,
      {
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN!.trim()}`,
          "User-Agent": "RealFiction (https://realfiction.live, 1.0)"
        },
        next: { revalidate: 300 }
      }
    )

    if (!response.ok) {
      // 401 revoked, 403 missing permission, 429 rate limited, 5xx outage. The
      // page says the same thing for all of them; the status goes to our log.
      console.warn("discord_announcements_unavailable", { status: response.status })
      return { status: "unavailable" }
    }

    const messages = (await response.json()) as DiscordMessage[]
    if (!Array.isArray(messages)) {
      return { status: "unavailable" }
    }

    for (const message of messages) {
      const text = toPlainText(message.content ?? "")
      const images = safeImages(message.attachments ?? [])
      // A message with no text AND no renderable image is skipped rather than
      // rendered as an empty card — reactions-only and sticker-only posts are
      // common in an announcements channel.
      if (!text && images.length === 0) {
        continue
      }
      if (!message.timestamp || Number.isNaN(Date.parse(message.timestamp))) {
        continue
      }

      return {
        status: "ok",
        announcement: {
          text,
          author: safeAuthor(message),
          postedAt: new Date(message.timestamp).toISOString(),
          links: safeLinks(message.content ?? ""),
          images
        }
      }
    }

    return { status: "empty" }
  } catch {
    return { status: "unavailable" }
  }
}
