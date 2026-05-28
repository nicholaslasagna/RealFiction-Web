"use client"

import { useCallback, useEffect, useState } from "react"
import { Coins, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type EconomyPayload = {
  linked: boolean
  minecraftUuid: string | null
  minecraftUsername: string | null
  balanceMinor: string
  scale: number
  updatedAt: string | null
}

type LoadState =
  | { status: "loading"; data?: never; error?: never }
  | { status: "ready"; data: EconomyPayload; error?: never }
  | { status: "error"; data?: never; error: string }

function formatBalance(balanceMinor: string, scale: number) {
  const safeScale = BigInt(Math.max(1, scale || 100))
  let amount: bigint

  try {
    amount = BigInt(balanceMinor || "0")
  } catch {
    amount = 0n
  }

  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const dollars = absolute / safeScale
  const cents = absolute % safeScale

  return `${negative ? "-" : ""}$${dollars}.${cents.toString().padStart(2, "0")}`
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not yet"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value))
}

export function AccountEconomyCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" })

  const loadBalance = useCallback(async () => {
    setState({ status: "loading" })
    try {
      const response = await fetch("/api/account/economy", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      })
      const body = (await response.json().catch(() => null)) as Partial<EconomyPayload> & { error?: string } | null

      if (!response.ok) {
        setState({ status: "error", error: body?.error ?? "Could not load your balance." })
        return
      }

      setState({
        status: "ready",
        data: {
          linked: Boolean(body?.linked),
          minecraftUuid: body?.minecraftUuid ?? null,
          minecraftUsername: body?.minecraftUsername ?? null,
          balanceMinor: String(body?.balanceMinor ?? "0"),
          scale: typeof body?.scale === "number" ? body.scale : 100,
          updatedAt: body?.updatedAt ?? null
        }
      })
    } catch {
      setState({ status: "error", error: "Could not load your balance." })
    }
  }, [])

  useEffect(() => {
    void loadBalance()
  }, [loadBalance])

  const ready = state.status === "ready" ? state.data : null
  const linked = ready?.linked ?? false

  return (
    <Card className="minecraft-card border-border">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="display-font text-3xl">Your Balance</CardTitle>
            <CardDescription>Only you can see this.</CardDescription>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary text-primary">
            <Coins className="h-5 w-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {state.status === "loading" ? (
          <div className="rounded-lg border border-border bg-secondary p-4">
            <div className="h-9 w-32 animate-pulse rounded bg-primary/10" />
            <div className="mt-3 h-4 w-44 animate-pulse rounded bg-secondary" />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="space-y-4 rounded-lg border border-border bg-secondary p-4">
            <p className="text-sm font-semibold text-primary">{state.error}</p>
            <Button type="button" variant="outline" onClick={() => void loadBalance()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : null}

        {ready ? (
          linked ? (
            <div className="rounded-lg border border-border bg-secondary p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-4xl font-semibold text-primary">
                    {formatBalance(ready.balanceMinor, ready.scale)}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    For {ready.minecraftUsername ?? "your linked player"}
                  </p>
                </div>
                <Badge variant="success">Linked</Badge>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Updated {formatDate(ready.updatedAt)}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-secondary p-4">
              <p className="font-semibold text-foreground">Link Minecraft to see your balance.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Once linked, your RealFiction balance will show up here.
              </p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}
