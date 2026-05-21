"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

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
    <div className="inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-black/35 px-4 py-2 text-sm shadow-lg backdrop-blur">
      <span className="relative flex h-2.5 w-2.5">
        {online ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            online ? "bg-emerald-400" : "bg-amber-300"
          )}
        />
      </span>
      {loading ? (
        <span className="text-slate-300">Checking players…</span>
      ) : online ? (
        <span className="text-slate-200">
          <strong className="font-semibold text-amber-200">{state.playersOnline}</strong>{" "}
          player{state.playersOnline === 1 ? "" : "s"} online
        </span>
      ) : (
        <span className="text-slate-300">Server status updating</span>
      )}
    </div>
  )
}
