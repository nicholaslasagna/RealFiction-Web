"use client"

import { AlertCircle, Clock3, Crown, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { avatarUrl, formatPlaytimeShort } from "@/lib/format-playtime"
import { cn } from "@/lib/utils"

type LeaderboardEntry = {
  position: number
  uuid: string
  name: string | null
  value: number
}

type LeaderboardResponse = {
  statKey: string
  subjectType: string
  entries: LeaderboardEntry[]
}

type Status = "idle" | "loading" | "ready" | "empty" | "error" | "warming"

type BoardState = {
  status: Status
  entries: LeaderboardEntry[]
  errorMessage: string | null
  refreshedAt: number | null
}

export type PlaytimeBoard = {
  /** Stat key passed to /api/public/stats/leaderboard?key=... */
  key: string
  /** Tab label */
  label: string
  /** Short description shown above the table */
  description: string
}

export const PLAYTIME_BOARDS: readonly PlaytimeBoard[] = [
  { key: "playtime.total",    label: "Network",  description: "Total time across every RealFiction backend." },
  { key: "playtime.lobby",    label: "Lobby",    description: "Time spent in lobby worlds and hubs." },
  { key: "playtime.smp",      label: "SMP",      description: "Survival multiplayer hours." },
  { key: "playtime.factions", label: "Factions", description: "Time on the Factions seasonal world." },
  { key: "playtime.anarchy",  label: "Anarchy",  description: "Time on RealAnarchy." },
  { key: "playtime.arcade",   label: "Arcade",   description: "Lobby games, parkour, and arcade modes." }
]

const TOP_LIMIT = 10
const EMPTY_BOARD: BoardState = { status: "idle", entries: [], errorMessage: null, refreshedAt: null }

export function PlaytimeLeaderboards() {
  const [activeKey, setActiveKey] = useState<string>(PLAYTIME_BOARDS[0].key)
  const [boards, setBoards] = useState<Record<string, BoardState>>({})
  const inflightRef = useRef<Map<string, AbortController>>(new Map())

  const activeBoard = useMemo(() => PLAYTIME_BOARDS.find((b) => b.key === activeKey)!, [activeKey])
  const activeState = boards[activeKey] ?? EMPTY_BOARD

  const load = useCallback(async (key: string) => {
    const previous = inflightRef.current.get(key)
    previous?.abort()
    const controller = new AbortController()
    inflightRef.current.set(key, controller)

    setBoards((current) => ({
      ...current,
      [key]: { ...(current[key] ?? EMPTY_BOARD), status: "loading", errorMessage: null }
    }))

    try {
      const response = await fetch(
        `/api/public/stats/leaderboard?key=${encodeURIComponent(key)}&limit=${TOP_LIMIT}`,
        { cache: "no-store", signal: controller.signal }
      )

      if (response.status === 503) {
        setBoards((current) => ({
          ...current,
          [key]: { status: "warming", entries: [], errorMessage: null, refreshedAt: Date.now() }
        }))
        return
      }

      if (!response.ok) {
        const message = response.status === 400 ? "This leaderboard is not available." : "Couldn't reach the leaderboard."
        setBoards((current) => ({
          ...current,
          [key]: { status: "error", entries: [], errorMessage: message, refreshedAt: Date.now() }
        }))
        return
      }

      const json = (await response.json()) as LeaderboardResponse
      const entries = Array.isArray(json.entries) ? json.entries : []

      setBoards((current) => ({
        ...current,
        [key]: {
          status: entries.length === 0 ? "empty" : "ready",
          entries,
          errorMessage: null,
          refreshedAt: Date.now()
        }
      }))
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return
      }
      setBoards((current) => ({
        ...current,
        [key]: {
          status: "error",
          entries: [],
          errorMessage: "Network error — please try again.",
          refreshedAt: Date.now()
        }
      }))
    } finally {
      if (inflightRef.current.get(key) === controller) {
        inflightRef.current.delete(key)
      }
    }
  }, [])

  useEffect(() => {
    if (!boards[activeKey] || boards[activeKey]?.status === "idle") {
      void load(activeKey)
    }
  }, [activeKey, boards, load])

  useEffect(() => {
    const controllers = inflightRef.current
    return () => {
      controllers.forEach((c) => c.abort())
      controllers.clear()
    }
  }, [])

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Playtime leaderboards" className="flex flex-wrap gap-2">
        {PLAYTIME_BOARDS.map((board) => {
          const isActive = board.key === activeKey
          return (
            <button
              key={board.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActiveKey(board.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-semibold uppercase tracking-[0.08em] transition",
                isActive
                  ? "border-amber-200/40 bg-amber-200/12 text-amber-100 shadow-[0_0_24px_rgba(252,211,77,0.18)]"
                  : "border-white/10 bg-black/30 text-slate-300 hover:border-amber-200/25 hover:text-amber-100"
              )}
            >
              {board.label}
            </button>
          )
        })}
      </div>

      <Card className="minecraft-card overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1.5">
            <Badge variant="outline" className="font-mono text-[11px] uppercase tracking-[0.16em]">
              {activeBoard.key}
            </Badge>
            <CardTitle className="display-font text-3xl">Top {TOP_LIMIT} — {activeBoard.label}</CardTitle>
            <CardDescription>{activeBoard.description}</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => load(activeKey)}
            disabled={activeState.status === "loading"}
            aria-label="Refresh leaderboard"
          >
            {activeState.status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </CardHeader>

        <CardContent className="pt-0">
          {activeState.status === "loading" && activeState.entries.length === 0 ? (
            <LoadingRows />
          ) : activeState.status === "warming" ? (
            <EmptyState
              title="Stats are warming up"
              body="The network stat cache is still being prepared. Try again in a moment."
              tone="warning"
            />
          ) : activeState.status === "empty" ? (
            <EmptyState
              title="No leaderboard yet"
              body="Be the first — log in and start playing to appear here."
              tone="muted"
            />
          ) : activeState.status === "error" ? (
            <EmptyState
              title="Couldn't load leaderboard"
              body={activeState.errorMessage ?? "Please try again."}
              tone="error"
              onRetry={() => load(activeKey)}
            />
          ) : (
            <LeaderboardRows entries={activeState.entries} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LeaderboardRows({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <ol className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/8 bg-black/24">
      {entries.map((entry) => {
        const avatar = avatarUrl(entry.uuid)
        const isPodium = entry.position <= 3
        const podiumColor =
          entry.position === 1 ? "text-amber-200" : entry.position === 2 ? "text-slate-200" : "text-orange-300"

        return (
          <li
            key={`${entry.uuid}-${entry.position}`}
            className="flex items-center gap-4 px-4 py-3 transition hover:bg-amber-200/[0.04]"
          >
            <span
              className={cn(
                "flex h-8 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-bold",
                isPodium ? `border-current ${podiumColor}` : "border-white/12 text-slate-300"
              )}
            >
              {isPodium ? <Crown className="h-4 w-4" aria-hidden /> : entry.position}
            </span>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={avatar}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-md border border-white/10"
                  loading="lazy"
                />
              ) : (
                <div className="h-8 w-8 rounded-md border border-white/10 bg-white/5" aria-hidden />
              )}
              <span className="truncate font-semibold text-slate-100">
                {entry.name ?? "Unknown player"}
              </span>
            </div>

            <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm text-amber-100/90">
              <Clock3 className="h-3.5 w-3.5 text-amber-200/70" aria-hidden />
              {formatPlaytimeShort(entry.value)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function LoadingRows() {
  return (
    <ol aria-busy className="divide-y divide-white/5 overflow-hidden rounded-md border border-white/8 bg-black/24">
      {Array.from({ length: 6 }).map((_, idx) => (
        <li key={idx} className="flex items-center gap-4 px-4 py-3">
          <div className="h-8 w-9 shrink-0 animate-pulse rounded-md bg-white/5" />
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-white/5" />
          <div className="h-3 flex-1 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-16 animate-pulse rounded bg-white/5" />
        </li>
      ))}
    </ol>
  )
}

function EmptyState({
  title,
  body,
  tone,
  onRetry
}: {
  title: string
  body: string
  tone: "muted" | "warning" | "error"
  onRetry?: () => void
}) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? Loader2 : Clock3
  const iconClass =
    tone === "error" ? "text-rose-300" : tone === "warning" ? "text-amber-200 animate-spin" : "text-slate-400"

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-white/10 bg-black/24 px-6 py-12 text-center">
      <Icon className={cn("h-6 w-6", iconClass)} aria-hidden />
      <div>
        <p className="font-semibold text-slate-100">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
