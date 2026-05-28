"use client"

import { useEffect, useState } from "react"

type PlayerCountState = {
  online: boolean
  playersOnline: number
  playersMax?: number
}

/**
 * Mockup-styled `.playercount` chip. Uses the global CSS class so the
 * hero pill matches the design 1:1 (dark transparent bg, "rf-h1" font,
 * yellow numeric accent on the `.num` span).
 */
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
    <div className="playercount">
      {loading || !online ? (
        <>
          Checking players<span className="num">…</span>
        </>
      ) : (
        <>
          There are <span className="num">{state.playersOnline}</span> player
          {state.playersOnline === 1 ? "" : "s"} online on RealFiction
        </>
      )}
    </div>
  )
}
