"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

/**
 * "Your Balance" card on the account page.
 *
 * This shows the player's USD **store credit** — real-money website credit
 * that the player can use at the /store checkout. Funded by redeeming gift
 * cards (see /api/account/giftcard/redeem) and refunds; spent by store
 * checkout when "pay with balance" is selected.
 *
 * It is NOT the in-game economy balance (SMP coins / Factions money). Those
 * live in /api/account/economy and are shown elsewhere in-game and on
 * leaderboards.
 */

type StoreCreditPayload = {
  balanceCents: number
  currency: string
  updatedAt: string | null
}

type LoadState =
  | { status: "loading"; data?: never; error?: never; transient?: never }
  | { status: "ready"; data: StoreCreditPayload; error?: never; transient?: never }
  | { status: "empty"; data?: never; error?: never; transient?: never }
  | { status: "error"; data?: never; error: string; transient?: never }

type RedeemState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string }

/**
 * USD formatter. Renders "$1,234.56" with thousands separators.
 */
function formatCents(cents: number) {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.trunc(abs / 100)
  const remainder = abs - dollars * 100
  const dollarsStr = dollars.toLocaleString("en-US")
  return `${negative ? "-" : ""}$${dollarsStr}.${String(remainder).padStart(2, "0")}`
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
 * Minecraft-style "gold ingot" icon. Pixel-art, fits the storefront / real
 * money framing better than a coins/emerald icon (emerald was reading as
 * the in-game economy currency).
 */
function GoldIngotIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {/* dark outer outline */}
      <rect x="3" y="4" width="10" height="1" fill="#5a3d09" />
      <rect x="2" y="5" width="12" height="1" fill="#5a3d09" />
      <rect x="2" y="11" width="12" height="1" fill="#5a3d09" />
      <rect x="3" y="12" width="10" height="1" fill="#5a3d09" />
      <rect x="2" y="5" width="1" height="6" fill="#5a3d09" />
      <rect x="13" y="5" width="1" height="6" fill="#5a3d09" />
      {/* gold body */}
      <rect x="3" y="5" width="10" height="6" fill="#f2c66d" />
      {/* highlight top edge */}
      <rect x="4" y="5" width="8" height="1" fill="#ffe9a8" />
      <rect x="3" y="6" width="1" height="1" fill="#ffe9a8" />
      {/* shadow bottom edge */}
      <rect x="3" y="10" width="10" height="1" fill="#c68f1e" />
      <rect x="12" y="6" width="1" height="4" fill="#c68f1e" />
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
      const response = await fetch("/api/account/store-credit", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      })
      if (response.status === 503) {
        // Migration hasn't landed in the target DB yet — show the empty
        // state and the redemption CTA so the user sees a clear path
        // forward without a scary error banner.
        setState({ status: "empty" })
        return
      }
      const body = (await response.json().catch(() => null)) as
        | (Partial<StoreCreditPayload> & { error?: string })
        | null

      if (!response.ok) {
        setState({ status: "error", error: body?.error ?? "Could not load your store credit." })
        return
      }

      setState({
        status: "ready",
        data: {
          balanceCents:
            typeof body?.balanceCents === "number" && Number.isFinite(body.balanceCents)
              ? Math.trunc(body.balanceCents)
              : 0,
          currency: typeof body?.currency === "string" ? body.currency : "USD",
          updatedAt: body?.updatedAt ?? null
        }
      })
    } catch {
      setState({ status: "error", error: "Could not load your store credit." })
    }
  }, [])

  useEffect(() => {
    void loadBalance()
  }, [loadBalance])

  useEffect(() => {
    if (showRedeem) {
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
          message: body?.message ?? "Gift card redeemed — store credit updated."
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

  return (
    <Card className="minecraft-card border-amber-200/18">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="display-font text-3xl">Your Balance</CardTitle>
            <CardDescription>
              Store credit you can spend at checkout. Only you can see this.
            </CardDescription>
          </div>
          <span className="flex h-11 w-11 items-center justify-center border-2 border-[#00060e] bg-gradient-to-b from-[#1a2638] to-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.3)]">
            <GoldIngotIcon size={22} />
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

        {state.status === "ready" ? (
          <div className="rounded-lg border border-emerald-300/16 bg-black/24 p-4">
            <div className="font-mono text-4xl font-semibold text-amber-100">
              {formatCents(state.data.balanceCents)}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Available at the storefront checkout.
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Updated {formatDate(state.data.updatedAt)}
            </p>
          </div>
        ) : null}

        {state.status === "empty" ? (
          <div className="rounded-lg border border-white/10 bg-black/24 p-4">
            <div className="font-mono text-4xl font-semibold text-amber-100">$0.00</div>
            <p className="mt-2 text-sm text-muted-foreground">
              No store credit yet. Redeem a gift card to add credit to your account.
            </p>
          </div>
        ) : null}

        {/* Gift card redemption — visible in every state so a player can
            top up at any time. */}
        {state.status !== "loading" && state.status !== "error" ? (
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
                    Redeem a code to add real-money credit to your account.
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
