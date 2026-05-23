// Shared playtime formatting used by the homepage hero cards, the public
// /leaderboards page, and any future surface that renders a value backed by
// playtime_totals.total_seconds. Keeping the implementation centralized so a
// single player's number reads identically wherever it appears.

// Compact form for tables/rows: "3d 4h 5m" (mirrors the original
// playtime-leaderboards rendering, kept byte-for-byte to avoid a visual
// change on /leaderboards when the import was migrated).
export function formatPlaytimeShort(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0m"
  }

  const total = Math.trunc(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)

  return parts.join(" ")
}

// Verbose form for hero stats: "3 days, 4 hours" (or "12 minutes" when the
// total is sub-hour). Pluralization is handled per-unit. Returns "0 minutes"
// for zero / non-finite inputs so the fallback matches the data shape (no
// stray dashes leak into the visible copy).
export function formatPlaytimeLong(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 minutes"
  }

  const total = Math.trunc(seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days.toLocaleString()} day${days === 1 ? "" : "s"}`)
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`)
  }
  if (parts.length === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  if (days === 0 && minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`)
  }

  return parts.join(", ")
}

// Build a Crafatar avatar URL from a Mojang UUID (with or without dashes).
// Returns null when the UUID is missing or malformed so callers can render a
// neutral placeholder instead of a broken image.
export function avatarUrl(uuid: string | null | undefined, size = 48) {
  if (!uuid) return null
  const cleaned = uuid.replace(/-/g, "").trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(cleaned)) return null
  // mc-heads.net is a reliable head-render service and falls back to a default
  // (Steve/Alex) for unknown/offline UUIDs instead of failing.
  return `https://mc-heads.net/avatar/${cleaned}/${size}`
}
