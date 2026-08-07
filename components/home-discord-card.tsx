import Link from "next/link"

/**
 * Real Discord card for the homepage Community section.
 *
 * Fetches the public Discord invite endpoint (no auth required) which
 * returns approximate member + presence counts. Cached for 5 minutes so
 * we don't hammer Discord on every page render.
 *
 * If Discord is down or the invite isn't resolvable, we drop to a
 * neutral copy line instead of showing a hardcoded number.
 */

const DISCORD_INVITE_CODE = "JkPpmzn"
const DISCORD_INVITE_URL = `https://discord.com/invite/${DISCORD_INVITE_CODE}`

type DiscordInvite = {
  memberCount: number | null
  onlineCount: number | null
}

async function fetchDiscordCounts(): Promise<DiscordInvite> {
  try {
    const response = await fetch(
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

function DiscordWordmark({ size = 56, color = "#5865f2" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M19.7 5.3A18.3 18.3 0 0 0 15.2 4l-.3.6c1.6.4 3 1 4.2 1.8a13.8 13.8 0 0 0-13.8 0c1.2-.7 2.6-1.4 4.2-1.8L9.2 4a18.3 18.3 0 0 0-4.5 1.3C2.4 8.7 1.8 12.1 2.1 15.4a18.5 18.5 0 0 0 5.6 2.8c.5-.7.9-1.4 1.2-2.2-.7-.3-1.4-.7-2-1.1.2-.1.4-.3.5-.4a13.1 13.1 0 0 0 11.3 0c.2.1.3.3.5.4-.6.4-1.3.8-2 1.1.3.8.7 1.5 1.2 2.2a18.5 18.5 0 0 0 5.6-2.8c.4-3.8-.6-7.2-3.3-10.1ZM8.7 13.5c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Zm6.6 0c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Z" />
    </svg>
  )
}

export async function HomeDiscordCard() {
  const { memberCount, onlineCount } = await fetchDiscordCounts()

  return (
    <section className="section-dark">
      <h2 className="section-title">Join the Community</h2>
      <p className="section-kicker">
        Announcements, events, support, screenshots, and voice chat live in the RealFiction
        Discord. The server lives there too.
      </p>

      <div
        style={{
          maxWidth: "70%",
          margin: "50px auto 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center"
        }}
      >
        <DiscordWordmark size={64} />

        {memberCount !== null ? (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              gap: 28,
              flexWrap: "wrap",
              justifyContent: "center"
            }}
          >
            <DiscordStat label="Members" value={memberCount.toLocaleString()} />
            {onlineCount !== null ? (
              <DiscordStat
                label="Online now"
                value={onlineCount.toLocaleString()}
                accent="green"
              />
            ) : null}
          </div>
        ) : (
          <p
            style={{
              marginTop: 22,
              color: "var(--text-dim)",
              fontFamily: "rf-light, sans-serif",
              fontSize: 15
            }}
          >
            Drop in any time — the whole community lives there.
          </p>
        )}

        <Link
          href={DISCORD_INVITE_URL}
          className="mc-button mc-button--discord"
          style={{ marginTop: 28 }}
        >
          <span style={{ display: "inline-flex", marginRight: 4 }}>
            {/* currentColor = the button's white label, so the mark stays
                visible against the blurple background (it used to be the
                same #5865f2 as the button and only showed on hover). */}
            <DiscordWordmark size={16} color="currentColor" />
          </span>
          Join Discord
        </Link>
      </div>
    </section>
  )
}

function DiscordStat({
  label,
  value,
  accent = "gold"
}: {
  label: string
  value: string
  accent?: "gold" | "green"
}) {
  return (
    <div style={{ minWidth: 120 }}>
      <div
        className="f-h1"
        style={{
          fontSize: 32,
          color: accent === "green" ? "var(--mc-green)" : "var(--gold)",
          lineHeight: 1.05
        }}
      >
        {value}
      </div>
      <div
        className="stat-eyebrow"
        style={{
          marginTop: 6,
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-mute)"
        }}
      >
        {label}
      </div>
    </div>
  )
}
