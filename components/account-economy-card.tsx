"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"

import { formatCurrency } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  canRequestCashRedemption,
  cashRedemptionBadge,
  recipientBadge,
  recipientCreditState,
  isCashRedemptionOpen
} from "@/lib/gift-card/customer-state"

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
  /** Part of the balance that cannot be spent right now. */
  holdCents: number
  restoredRecently: boolean
  /** Whether any of the balance came from a gift card. Never an amount. */
  hasGiftOriginCredit: boolean
  giftOriginCents?: number | null
  cashRedemptionState: string | null
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

/**
 * Why part of a balance will not spend.
 *
 * Says nothing about a dispute, a chargeback, or who sent the gift card: the
 * recipient is not a party to any of that, and the payment behind a gift they
 * received being questioned is not an accusation they need to carry.
 */
export function CreditHoldNotice({
  holdCents,
  restoredRecently,
  cashRedemptionState
}: {
  holdCents: number
  restoredRecently: boolean
  /** Lets the notice say WHY the value is held, rather than assuming payment. */
  cashRedemptionState?: string | null
}) {
  const badge = recipientBadge(
    recipientCreditState({
      holdCents,
      restoredRecently,
      cashRedemptionOpen: isCashRedemptionOpen(cashRedemptionState)
    })
  )
  if (!badge) {
    return null
  }

  return (
    <div
      className="rounded-lg border border-amber-300/20 bg-black/24 p-4"
      data-testid="store-credit-hold"
      role="status"
    >
      <Badge variant={badge.tone}>{badge.label}</Badge>
      {holdCents > 0 ? (
        <p className="mt-2 font-mono text-lg font-semibold text-amber-100">
          {`${formatCents(holdCents)} on hold`}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-muted-foreground">{badge.detail}</p>
    </div>
  )
}

/**
 * Cash-redemption review: the entry point and the status.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY
 * ==================================
 * No amount, no estimate, no eligibility. The button asks for a REVIEW, and the
 * copy says so in the button itself — a customer who clicks it must not come
 * away believing a payout has been agreed. The server computes the amount under
 * a lock at request time and never sends it back, so there is no number here to
 * render even if someone wanted to.
 *
 * Nothing about which states qualify, which balances are excluded, or why a
 * request was closed appears here. That reasoning is on the review record.
 */
export function CashRedemptionPanel({
  hasGiftOriginCredit,
  giftOriginCents,
  state,
  onRequested
}: {
  hasGiftOriginCredit: boolean
  /** The customer's own unfrozen gift-origin balance. Null when unknown. */
  giftOriginCents?: number | null
  state: string | null
  onRequested?: () => void | Promise<void>
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  // The first click OPENS THIS. It performs no request and freezes nothing —
  // placing a hold on real money is too consequential for one click.
  const [confirming, setConfirming] = useState(false)

  const openerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  const badge = cashRedemptionBadge(state)
  const canRequest = canRequestCashRedemption({ hasGiftOriginCredit, currentState: state })

  function closeDialog() {
    setConfirming(false)
    // Focus returns to the control that opened it, or a keyboard user is
    // dropped at the top of the document with no idea where they were.
    openerRef.current?.focus()
  }

  useEffect(() => {
    if (!confirming) {
      return
    }
    confirmRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        // Escape cancels. Nothing has been submitted at this point.
        setConfirming(false)
        openerRef.current?.focus()
        return
      }
      if (event.key !== "Tab") {
        return
      }
      // Focus trap: the dialog is modal, so Tab must not walk behind it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [confirming])

  if (!badge && !canRequest) {
    return null
  }

  async function submit() {
    // Guard the in-flight window as well as the disabled attribute: a second
    // Enter press can land before React re-renders the button.
    if (status === "submitting") {
      return
    }
    setStatus("submitting")
    try {
      const response = await fetch("/api/store/gift-cards/cash-redemption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
      const body = (await response.json().catch(() => null)) as
        | { status?: string; message?: string; error?: string }
        | null

      // The server's message is the ONLY wording shown. Composing our own here
      // would eventually drift into promising something the server did not.
      setMessage(body?.message ?? body?.error ?? "We could not start that review.")

      if (!response.ok) {
        // The dialog STAYS OPEN. Closing it on failure hides the error behind
        // the card the customer just dismissed, which reads as "nothing
        // happened" — the same failure mode this whole flow had.
        setStatus("error")
        return
      }

      setStatus("done")
      setConfirming(false)
      // Awaited, so `done` is only reached once the authoritative state has
      // been re-read. The database decides what the card shows, not this.
      await onRequested?.()
    } catch {
      setMessage("We could not start that review. Please try again later.")
      setStatus("error")
    }
  }

  return (
    <div
      className="rounded-lg border border-white/10 bg-black/16 p-4"
      data-testid="cash-redemption"
    >
      {badge ? (
        <div data-testid="cash-redemption-status" role="status">
          <Badge variant={badge.tone}>{badge.label}</Badge>
          <p className="mt-2 text-sm text-muted-foreground">{badge.detail}</p>
        </div>
      ) : null}

      {canRequest ? (
        <div className={badge ? "mt-4" : undefined}>
          <p className="text-sm text-muted-foreground">
            Some US states allow a gift-card balance to be redeemed for cash. If you think that
            applies to you, our team can review your account.
          </p>
          <Button
            ref={openerRef}
            type="button"
            variant="outline"
            // `w-full` with `whitespace-normal` so a long label wraps inside the
            // card instead of overflowing it on a narrow viewport; `sm:w-auto`
            // keeps the compact desktop shape. `h-auto` lets a wrapped label
            // grow rather than clip.
            className="mt-3 h-auto w-full whitespace-normal py-2.5 text-left sm:w-auto sm:text-center"
            onClick={() => setConfirming(true)}
            data-testid="cash-redemption-request"
          >
            Request cash redemption review
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Requesting a review does not guarantee a payout.
          </p>

          {confirming ? (
            <>
              {/* Backdrop. Clicking it cancels, like Escape. */}
              <div
                className="fixed inset-0 z-40 bg-black/60"
                onClick={closeDialog}
                aria-hidden
              />
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cash-redemption-dialog-title"
                aria-describedby="cash-redemption-dialog-body"
                data-testid="cash-redemption-dialog"
                className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border border-amber-200/20 bg-[#07203a] p-5 shadow-2xl"
              >
                <h3
                  id="cash-redemption-dialog-title"
                  className="display-font text-xl font-semibold text-white"
                >
                  Request cash redemption review?
                </h3>

                <div id="cash-redemption-dialog-body" className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                  {/* The amount is the customer's OWN unfrozen gift-origin
                      balance, from the server. "up to" because the server
                      recomputes under a lock and may hold less. When the amount
                      is unknown the sentence simply omits it rather than
                      guessing. */}
                  {typeof giftOriginCents === "number" && giftOriginCents > 0 ? (
                    <>
                      <p data-testid="cash-redemption-dialog-amount">
                        You’re requesting a review of up to{" "}
                        <strong className="text-amber-100">
                          {formatCurrency(giftOriginCents)}
                        </strong>{" "}
                        in gift-card credit.
                      </p>
                      <p>
                        While your request is being reviewed, this{" "}
                        {formatCurrency(giftOriginCents)} will be temporarily unavailable to spend.
                      </p>
                    </>
                  ) : (
                    <p data-testid="cash-redemption-dialog-amount">
                      Your eligible gift-card credit will be temporarily unavailable to spend while
                      your request is being reviewed.
                    </p>
                  )}
                  <p>
                    Submitting this request does not guarantee a cash payout. Eligibility depends on
                    applicable law and review by the RealFiction team.
                  </p>
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={closeDialog}
                    data-testid="cash-redemption-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    ref={confirmRef}
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={status === "submitting"}
                    onClick={() => void submit()}
                    data-testid="cash-redemption-confirm"
                  >
                    {status === "submitting" ? "Submitting…" : "Submit review request"}
                  </Button>
                </div>

                {status === "error" && message ? (
                  <p
                    role="alert"
                    data-testid="cash-redemption-dialog-error"
                    className="mt-3 text-sm leading-6 text-rose-200"
                  >
                    {message}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          className="mt-3 text-sm text-muted-foreground"
          role="status"
          data-testid="cash-redemption-message"
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}

export function AccountEconomyCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [showRedeem, setShowRedeem] = useState(false)
  const [code, setCode] = useState("")
  const [redeem, setRedeem] = useState<RedeemState>({ status: "idle" })
  const codeInputRef = useRef<HTMLInputElement>(null)

  const loadBalance = useCallback(async () => {
    // REVALIDATE IN PLACE. Dropping to `loading` unmounted the hold notice, the
    // redemption panel, and the just-set confirmation message, replacing the
    // whole card with a skeleton — so a successful request looked like nothing
    // had happened, and the panel remounted with its state reset.
    //
    // The previous data stays on screen until the server answers, and is then
    // REPLACED by it. The rendered state always reconciles against the
    // database; nothing here is optimistic.
    setState((current) => (current.status === "ready" ? current : { status: "loading" }))
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
          updatedAt: body?.updatedAt ?? null,
          holdCents:
            typeof body?.holdCents === "number" && Number.isFinite(body.holdCents)
              ? Math.max(0, Math.trunc(body.holdCents))
              : 0,
          restoredRecently: body?.restoredRecently === true,
          hasGiftOriginCredit: body?.hasGiftOriginCredit === true,
          // Was missing: the dialog reads this to say what will go on hold, so
          // without it every confirmation fell back to the amountless wording.
          giftOriginCents:
            typeof body?.giftOriginCents === "number" && Number.isFinite(body.giftOriginCents)
              ? Math.max(0, Math.trunc(body.giftOriginCents))
              : null,
          cashRedemptionState:
            typeof body?.cashRedemptionState === "string" ? body.cashRedemptionState : null
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
            {state.data.updatedAt ? (
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Updated {formatDate(state.data.updatedAt)}
              </p>
            ) : null}
          </div>
        ) : null}

        {state.status === "ready" ? (
          <CreditHoldNotice
            holdCents={state.data.holdCents}
            restoredRecently={state.data.restoredRecently}
            cashRedemptionState={state.data.cashRedemptionState}
          />
        ) : null}

        {state.status === "ready" ? (
          <CashRedemptionPanel
            hasGiftOriginCredit={state.data.hasGiftOriginCredit}
            giftOriginCents={state.data.giftOriginCents}
            state={state.data.cashRedemptionState}
            onRequested={() => void loadBalance()}
          />
        ) : null}

        {state.status === "empty" ? (
          <div className="rounded-lg border border-white/10 bg-black/24 p-4">
            <div className="font-mono text-4xl font-semibold text-amber-100">$0.00</div>
            <p className="mt-2 text-sm text-muted-foreground">
              No store credit yet. Claim a RealFiction gift card to add its value to your store
              credit.
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
              <div className="space-y-3">
                <div>
                  <p className="font-semibold text-white">Have a gift card?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Redeem a code to add real-money credit to your account.
                  </p>
                </div>
                <Button
                  className="w-full"
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
