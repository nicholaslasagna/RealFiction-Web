"use client"

import { Clock } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

function getRemainingText(target: number) {
  const remaining = Math.max(0, target - Date.now())
  const hours = Math.floor(remaining / 1000 / 60 / 60)
  const minutes = Math.floor((remaining / 1000 / 60) % 60)

  if (remaining === 0) {
    return "Ready"
  }

  return `${hours}h ${minutes}m`
}

export function VoteCountdown({ hours }: { hours: number }) {
  const target = useMemo(() => Date.now() + hours * 60 * 60 * 1000, [hours])
  const [remaining, setRemaining] = useState(() => getRemainingText(target))

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(getRemainingText(target)), 30000)

    return () => window.clearInterval(timer)
  }, [target])

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {remaining}
    </span>
  )
}
