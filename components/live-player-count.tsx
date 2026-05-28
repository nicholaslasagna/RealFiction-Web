"use client"

import { useEffect, useState } from "react"

type PlayerCountState = {
  online: boolean
  playersOnline: number
  playersMax?: number
}

export function LivePlayerCount() {
  const [state, setState] = useState<PlayerCountState>({
    online: false,
    playersOnline: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch("/api/player-count", { cache: "no-store" })
        const json = (await response.json()) as PlayerCountState

        if (!cancelled) {
          setState(json)
        }
      } catch {
        if (!cancelled) {
          setState({ online: false, playersOnline: 0 })
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    const timer = window.setInterval(load, 45000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const online = state.online && !loading

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-1.5 text-sm">
      <span className="rf-status-beacon shrink-0" data-online={online ? "true" : "false"} aria-hidden>
        <span />
      </span>
      {loading ? (
        <span className="text-muted-foreground">Checking players...</span>
      ) : online ? (
        <span className="text-muted-foreground">
          <strong className="font-semibold text-foreground">{state.playersOnline}</strong>{" "}
          player{state.playersOnline === 1 ? "" : "s"} online
        </span>
      ) : (
        <span className="text-muted-foreground">Server status updating</span>
      )}
    </div>
  )
}
