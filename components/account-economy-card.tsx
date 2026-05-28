"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

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

type RedeemState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string }

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

  // Group thousands in the integer part for readability (12,345.67).
  const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${negative ? "-" : ""}$${dollarsStr}.${cents.toString().padStart(2, "0")}`
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

/**
 * Minecraft-style "emerald" icon for the balance card.
 * Pixel diamond/emerald shape that matches the in-game economy currency
 * visual better than a generic lucide-react Coins icon.
 */
function EmeraldIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {/* Outer dark border */}
      <rect x="6" y="1" width="4" height="1" fill="#0a3d22" />
      <rect x="4" y="2" width="8" height="1" fill="#0a3d22" />
      <rect x="2" y="3" width="12" height="2" fill="#0a3d22" />
      <rect x="1" y="5" width="14" height="6" fill="#0a3d22" />
      <rect x="2" y="11" width="12" height="2" fill="#0a3d22" />
      <rect x="4" y="13" width="8" height="1" fill="#0a3d22" />
      <rect x="6" y="14" width="4" height="1" fill="#0a3d22" />
      {/* Bright emerald body */}
      <rect x="7" y="2" width="2" height="1" fill="#50d68a" />
      <rect x="5" y="3" width="6" height="1" fill="#3eb336" />
      <rect x="3" y="4" width="10" height="1" fill="#3eb336" />
      <rect x="2" y="5" width="12" height="6" fill="#3eb336" />
      <rect x="3" y="11" width="10" height="1" fill="#318e2a" />
      <rect x="5" y="12" width="6" height="1" fill="#318e2a" />
      <rect x="7" y="13" width="2" height="1" fill="#318e2a" />
      {/* Highlight (top-left) */}
      <rect x="5" y="4" width="1" height="2" fill="#9be8a9" />
      <rect x="4" y="5" width="2" height="1" fill="#9be8a9" />
    </svg>
  )
}

export function AccountEconomyCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [showRedeem, setShowRedeem] = useState(false)
  const [code, setCode] = useState("")
  const [redeem, setRedeem] = useState<RedeemState>({ status: "idle" })
  const codeInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (showRedeem) {
      // Focus the code field when the form opens, but only after the next
      // paint so the autofocus doesn't fight the layout animation.
      const id = window.setTimeout(() => codeInputRef.current?.focus(), 40)
      return () => window.clearTimeout(id)
    }
  }, [showRedeem])

  async function submitRedeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return

    setRedeem({ status: "submitting" })
    try {
      const response = await fetch("/api/account/giftcard/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed })
      })
      const body = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null

      if (response.ok) {
        setRedeem({
          status: "success",
          message: body?.message ?? "Gift card redeemed — balance updated."
        })
        setCode("")
        void loadBalance()
        return
      }

      setRedeem({
        status: "error",
        message: body?.error ?? "Could not redeem that code. Try again in a moment."
      })
    } catch {
      setRedeem({
        status: "error",
        message: "Could not reach the server. Try again in a moment."
      })
    }
  }

  const ready = state.status === "ready" ? state.data : null
  const linked = ready?.linked ?? false

  return (
    <Card className="minecraft-card border-amber-200/18">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="display-font text-3xl">Your Balance</CardTitle>
            <CardDescription>Only you can see this.</CardDescription>
          </div>
          <span className="flex h-11 w-11 items-center justify-center border-2 border-[#00060e] bg-gradient-to-b from-[#1a2638] to-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.3)]">
            <EmeraldIcon size={22} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" ? (
          <div className="rounded-lg border border-white/10 bg-black/24 p-4">
            <div className="h-9 w-32 animate-pulse rounded bg-amber-100/18" />
            <div className="mt-3 h-4 w-44 animate-pulse rounded bg-white/10" />
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="space-y-4 rounded-lg border border-amber-300/20 bg-black/24 p-4">
            <p className="text-sm font-semibold text-amber-100">{state.error}</p>
            <Button type="button" variant="outline" onClick={() => void loadBalance()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : null}

        {ready ? (
          linked ? (
            <div className="rounded-lg border border-emerald-300/16 bg-black/24 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-4xl font-semibold text-amber-100">
                    {formatBalance(ready.balanceMinor, ready.scale)}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    For {ready.minecraftUsername ?? "your linked player"}
                  </p>
                </div>
                <span
                  className="border border-emerald-300/40 bg-emerald-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-200"
                  style={{ fontFamily: "rf-bold, sans-serif" }}
                >
                  Linked
                </span>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Updated {formatDate(ready.updatedAt)}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/24 p-4">
              <p className="font-semibold text-white">Link Minecraft to see your balance.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Once linked, your RealFiction balance will show up here.
              </p>
            </div>
          )
        ) : null}

        {/* Gift card redemption — visible whether linked or not, since you
            might want to redeem first and link after. */}
        {ready ? (
          <div className="rounded-lg border border-amber-200/16 bg-black/16 p-4">
            {showRedeem ? (
              <form onSubmit={submitRedeem} className="space-y-3">
                <label className="grid gap-2 text-sm font-semibold text-white">
                  Gift card code
                  <Input
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. RF-XXXX-XXXX-XXXX"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    ref={codeInputRef}
                    maxLength={40}
                    disabled={redeem.status === "submitting"}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={redeem.status === "submitting" || code.trim().length < 6}
                  >
                    {redeem.status === "submitting" ? "Redeeming…" : "Redeem"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowRedeem(false)
                      setRedeem({ status: "idle" })
                      setCode("")
                    }}
                  >
                    Cancel
                  </Button>
                </div>
                {redeem.status === "success" ? (
                  <p
                    role="status"
                    className="rounded-md border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm text-emerald-100"
                  >
                    {redeem.message}
                  </p>
                ) : null}
                {redeem.status === "error" ? (
                  <p
                    role="status"
                    className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100"
                  >
                    {redeem.message}
                  </p>
                ) : null}
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">Have a gift card?</p>
                  <p className="text-sm text-muted-foreground">
                    Redeem a code to add credit to your account.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowRedeem(true)
                    setRedeem({ status: "idle" })
                  }}
                >
                  Redeem Gift Card
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
