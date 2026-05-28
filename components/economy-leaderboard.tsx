import { Coins } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatEconomyBalance } from "@/lib/format-economy"
import { cn } from "@/lib/utils"

type EconomyEntry = {
  position: number
  name: string
  balanceMinor: string
}

type EconomyLeaderboardResponse = {
  currencyKey: string
  scale: number
  entries: EconomyEntry[]
}

function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"
}

async function fetchEconomyLeaderboard(): Promise<EconomyLeaderboardResponse | null> {
  try {
    const response = await fetch(`${siteOrigin()}/api/public/economy/leaderboard`, {
      next: { revalidate: 60 }
    })

    if (!response.ok) {
      return null
    }

    const json = (await response.json()) as EconomyLeaderboardResponse
    return {
      currencyKey: json.currencyKey ?? "realfiction_main",
      scale: typeof json.scale === "number" ? json.scale : 100,
      entries: Array.isArray(json.entries) ? json.entries.slice(0, 10) : []
    }
  } catch {
    return null
  }
}

export async function EconomyLeaderboard() {
  const leaderboard = await fetchEconomyLeaderboard()
  const entries = leaderboard?.entries ?? []
  const scale = leaderboard?.scale ?? 100

  return (
    <Card className="minecraft-card overflow-hidden shadow-none">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="display-font text-3xl">Economy Leaderboard</CardTitle>
            <CardDescription>Top balances from RealFiction economy data.</CardDescription>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-200/14 bg-black/20 text-amber-200">
            <Coins className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length > 0 ? (
          <ol className="divide-y divide-white/5 overflow-hidden rounded-md border border-amber-200/10 bg-black/18">
            {entries.map((entry) => (
              <li
                key={`${entry.position}-${entry.name}`}
                className="flex items-center gap-4 px-4 py-3 transition hover:bg-amber-200/[0.04]"
              >
                <span
                  className={cn(
                    "flex h-8 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-bold",
                    entry.position === 1
                      ? "border-amber-200 text-amber-200"
                      : entry.position <= 3
                        ? "border-white/25 text-slate-100"
                        : "border-white/12 text-slate-300"
                  )}
                >
                  {entry.position}
                </span>

                <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                  {entry.name || "Unknown player"}
                </span>

                <span className="shrink-0 font-mono text-sm font-semibold text-amber-100">
                  {formatEconomyBalance(entry.balanceMinor, scale)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-md border border-dashed border-amber-200/12 bg-black/18 px-6 py-10 text-center">
            <p className="font-semibold text-slate-100">No balances to show yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The leaderboard will appear once players earn RealFiction money.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
