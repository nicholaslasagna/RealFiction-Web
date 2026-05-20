"use client"

import { Activity, WifiOff } from "lucide-react"
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
    <div className="inline-flex items-center gap-3 rounded-md border border-white/15 bg-black/28 px-4 py-3 text-sm shadow-xl backdrop-blur">
      {online ? (
        <Activity className="h-4 w-4 text-emerald-300" />
      ) : (
        <WifiOff className="h-4 w-4 text-amber-200" />
      )}
      <span className="text-muted-foreground">Network</span>
      <strong className="font-mono text-foreground">
        {loading ? "Checking" : online ? `${state.playersOnline}/${state.playersMax ?? "?"}` : "Status pending"}
      </strong>
    </div>
  )
}
