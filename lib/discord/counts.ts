// Discord member/presence counts.
//
// Extracted from the homepage card so the Discord page uses the SAME fetch
// rather than a second copy that could drift on cache policy or failure
// behaviour.
//
// No credentials required: Discord's invite endpoint serves approximate counts
// anonymously. That is why this works today while announcements — which need a
// bot token — do not. See ./announcements.ts.

export const DISCORD_INVITE_CODE = "JkPpmzn"
export const DISCORD_INVITE_URL = `https://discord.com/invite/${DISCORD_INVITE_CODE}`

export type DiscordCounts = { memberCount: number | null; onlineCount: number | null }

/** Never throws: counts are decoration, and the page renders without them. */
export async function fetchDiscordCounts(fetchImpl: typeof fetch = fetch): Promise<DiscordCounts> {
  try {
    const response = await fetchImpl(
      `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`,
      { next: { revalidate: 300 } }
    )
    if (!response.ok) {
      return { memberCount: null, onlineCount: null }
    }
    const json = (await response.json()) as {
      approximate_member_count?: number
      approximate_presence_count?: number
    }
    return {
      memberCount: typeof json.approximate_member_count === "number" ? json.approximate_member_count : null,
      onlineCount: typeof json.approximate_presence_count === "number" ? json.approximate_presence_count : null
    }
  } catch {
    return { memberCount: null, onlineCount: null }
  }
}
