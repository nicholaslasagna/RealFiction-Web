"use client"

import { ArrowUpRight, Clock } from "lucide-react"
import { useEffect, useState } from "react"

/**
 * One line on the voting board.
 *
 * WHY A ROW AND NOT A CARD
 * ========================
 * Ten sites previously rendered as ten bordered cards, each with a numbered
 * badge, a cooldown pill, a description, and a full-width button — 2290px of
 * page on desktop and 4415px on mobile to convey ten links. Every site carried
 * identical visual weight, so the one question a voter actually has ("which can
 * I vote on right now?") took a full scan to answer.
 *
 * A row makes state the loudest thing on the line, and makes the whole row the
 * click target instead of a button nested inside a card.
 *
 * The countdown ticks, so this stays a client component. `readyAt` is epoch-ms
 * computed SERVER-side from the user's last recorded vote plus the site
 * cooldown — never supplied by the browser.
 */
export function VoteRow({
  name,
  reward,
  href,
  signedIn,
  readyAt
}: {
  name: string
  reward: string
  href: string
  signedIn: boolean
  readyAt: number | null
}) {
  const [remaining, setRemaining] = useState<number | null>(() =>
    readyAt === null ? null : Math.max(0, readyAt - Date.now())
  )

  useEffect(() => {
    if (readyAt === null) {
      return
    }
    const update = () => setRemaining(Math.max(0, readyAt - Date.now()))
    update()
    const timer = window.setInterval(update, 30_000)
    return () => window.clearInterval(timer)
  }, [readyAt])

  const waiting = remaining !== null && remaining > 0
  const hours = waiting ? Math.floor(remaining / 3_600_000) : 0
  const minutes = waiting ? Math.floor((remaining / 60_000) % 60) : 0

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="vote-row"
      data-state={waiting ? "cooldown" : "ready"}
      className={`group flex items-center gap-3 border-l-2 px-3 py-2.5 transition sm:gap-4 sm:px-4 ${
        waiting
          ? "border-l-white/12 bg-black/16 hover:bg-black/28"
          : "border-l-amber-200/70 bg-amber-200/[0.045] hover:bg-amber-200/[0.09]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">{name}</span>
        {/* Compact metadata, not a paragraph. */}
        <span className="block truncate text-xs text-muted-foreground">{reward}</span>
      </span>

      {waiting ? (
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Next vote in </span>
          {hours}h {minutes}m
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-100">
          {/* Signed out, the cooldown is the same on every row, so it is stated
              once in the section heading instead of ten times down the page. */}
          {signedIn ? "Ready" : null}
          <ArrowUpRight
            className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      )}
    </a>
  )
}
