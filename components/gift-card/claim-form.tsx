"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

/** base64url of 32 bytes, unpadded — the same shape the server insists on. */
const CANONICAL = /^[A-Za-z0-9_-]{43}$/

type Outcome =
  | "claimed"
  | "already_claimed_by_you"
  | "invalid_or_unavailable"
  | "wrong_recipient"
  | "email_not_verified"
  | "temporarily_unavailable"
  | "rate_limited"

const MESSAGES: Record<Outcome, string> = {
  claimed: "Added to your store credit.",
  already_claimed_by_you: "You have already claimed this gift card.",
  invalid_or_unavailable:
    "This gift card link is not valid, or it has already been used. If someone sent it to you recently, check the most recent email — a resent card replaces the previous link.",
  wrong_recipient:
    "This gift card was sent to a different email address. Sign in with that address to claim it.",
  email_not_verified: "Please verify your email address first, then come back to this page.",
  temporarily_unavailable: "We could not complete this right now. Nothing has changed — please try again shortly.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again."
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

export function GiftCardClaimForm() {
  // Held in memory only. Never written to state that persists, never to
  // storage, never to a query string.
  const secretRef = useRef<string | null>(null)
  const [hasSecret, setHasSecret] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [balanceCents, setBalanceCents] = useState<number | null>(null)

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, "")

    if (CANONICAL.test(fragment)) {
      secretRef.current = fragment
      setHasSecret(true)
    } else {
      setHasSecret(false)
    }

    // Strip the fragment from the visible URL immediately. It stops the secret
    // being read over someone's shoulder, copied out of the address bar, or
    // carried into a bookmark or a shared screenshot. The value we already
    // captured stays in `secretRef`.
    if (fragment) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }, [])

  async function claim() {
    if (!secretRef.current || submitting) {
      return
    }
    setSubmitting(true)
    setOutcome(null)

    try {
      const response = await fetch("/api/gift-cards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The secret goes in the BODY. Never a path or a query string, so it
        // cannot reach an access log.
        body: JSON.stringify({ secret: secretRef.current }),
        // No credentials to a third party, no referrer anywhere.
        referrerPolicy: "no-referrer"
      })

      if (response.status === 401) {
        window.location.href = `/account?next=${encodeURIComponent("/gift-cards/claim")}`
        return
      }

      const data = (await response.json()) as {
        result?: Outcome
        amountCents?: number
        balanceCents?: number
      }

      setOutcome(data.result ?? "temporarily_unavailable")
      setAmountCents(typeof data.amountCents === "number" ? data.amountCents : null)
      setBalanceCents(typeof data.balanceCents === "number" ? data.balanceCents : null)

      // Single use: once it has been spent there is nothing left to retry with.
      if (data.result === "claimed" || data.result === "already_claimed_by_you") {
        secretRef.current = null
      }
    } catch {
      setOutcome("temporarily_unavailable")
    } finally {
      setSubmitting(false)
    }
  }

  const succeeded = outcome === "claimed" || outcome === "already_claimed_by_you"

  return (
    <div className="mt-8">
      {/* Every state change is announced. A claim moves money; a screen-reader
          user must not have to go hunting for the result. */}
      <div aria-live="polite" aria-atomic="true" className="min-h-[1.5rem]">
        {submitting ? <p className="text-sm text-muted-foreground">Claiming your gift card…</p> : null}
        {outcome ? (
          <p
            className={
              succeeded ? "text-sm font-semibold text-emerald-200" : "text-sm font-semibold text-amber-100"
            }
          >
            {MESSAGES[outcome]}
          </p>
        ) : null}
      </div>

      {succeeded && amountCents !== null ? (
        <div className="mt-4 rounded-lg border border-emerald-300/25 bg-emerald-400/5 p-5">
          <p className="text-2xl font-semibold text-emerald-100">{money(amountCents)}</p>
          {balanceCents !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Your store credit balance is now {money(balanceCents)}.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild>
              <a href="/store">Visit the store</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/account">Your account</a>
            </Button>
          </div>
        </div>
      ) : null}

      {hasSecret === false && !outcome ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This page needs the full link from your gift card email. Open that link again, or contact{" "}
          <a className="underline" href="mailto:support@realfiction.live">
            support@realfiction.live
          </a>
          .
        </p>
      ) : null}

      {hasSecret && !succeeded ? (
        <div className="mt-6">
          <Button onClick={claim} disabled={submitting} aria-busy={submitting}>
            {submitting ? "Claiming…" : "Claim gift card"}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Your balance never expires and there are no fees. Gift card credit cannot be used to buy
            another gift card, and is not redeemable for cash except where required by law.
          </p>
        </div>
      ) : null}
    </div>
  )
}
