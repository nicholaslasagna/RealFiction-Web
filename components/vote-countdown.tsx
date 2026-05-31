"use client"

import { Clock } from "lucide-react"
import { useEffect, useState } from "react"

/**
 * Per-site vote cooldown indicator.
 *
 * - Signed-in + we know the last vote on this site: a live countdown to when
 *   the next vote is allowed ("23h 5m"), ticking down, or "Vote ready".
 * - Signed-in with no recorded vote on this site: "Vote ready".
 * - Signed-out (we can't know a per-user cooldown): the honest cooldown period
 *   ("Every 24h") instead of a fake countdown.
 *
 * `readyAt` is an epoch-ms timestamp computed server-side from the user's last
 * recorded vote + the site cooldown — never trusted from the client.
 */

function remainingText(readyAt: number) {
  const remaining = Math.max(0, readyAt - Date.now())
  if (remaining === 0) {
    return "Vote ready"
  }
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining / 60_000) % 60)
  return `${hours}h ${minutes}m`
}

export function VoteCountdown({
  hours,
  signedIn = false,
  readyAt = null
}: {
  hours: number
  signedIn?: boolean
  readyAt?: number | null
}) {
  const counting = signedIn && readyAt !== null

  const [label, setLabel] = useState<string>(() => {
    if (!signedIn) {
      return `Every ${hours}h`
    }
    return readyAt === null ? "Vote ready" : remainingText(readyAt)
  })

  useEffect(() => {
    if (!counting || readyAt === null) {
      return
    }
    const update = () => setLabel(remainingText(readyAt))
    update()
    const timer = window.setInterval(update, 30_000)
    return () => window.clearInterval(timer)
  }, [counting, readyAt])

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}
