"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  GIFT_CARD_DENOMINATIONS,
  GIFT_CARD_MESSAGE_MAX,
  GIFT_CARD_SENDER_NAME_MAX,
  graphemeLength
} from "@/lib/gift-card/checkout-policy"

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

/**
 * The gift-card purchase form.
 *
 * Rendered only when the server has confirmed gift cards are fully available —
 * feature flag, crypto keys, and email configuration all present. The client is
 * never the authority on that; this component simply is not rendered otherwise.
 *
 * The amount the customer sees comes from the shared denomination table, and
 * the amount they are CHARGED is resolved again server-side from the product
 * row. This form sends a slug, never a price.
 */
export function GiftCardPurchaseForm({ buyerEmail }: { buyerEmail: string | null }) {
  const [slug, setSlug] = useState("gift-card-25")
  const [sendToSelf, setSendToSelf] = useState(false)
  const [recipientEmail, setRecipientEmail] = useState("")
  const [senderName, setSenderName] = useState("")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ids = {
    amount: useId(),
    recipient: useId(),
    recipientError: useId(),
    sender: useId(),
    message: useId(),
    messageHint: useId()
  }

  const selected = GIFT_CARD_DENOMINATIONS.find((d) => d.slug === slug) ?? GIFT_CARD_DENOMINATIONS[4]
  const senderLength = graphemeLength(senderName)
  const messageLength = graphemeLength(message)
  const overLimit = senderLength > GIFT_CARD_SENDER_NAME_MAX || messageLength > GIFT_CARD_MESSAGE_MAX

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting || overLimit) {
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch("/api/store/gift-cards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          recipientEmail: sendToSelf ? undefined : recipientEmail.trim(),
          senderName: senderName.trim(),
          message: message.trim(),
          sendToSelf,
          // One identity per checkout intent, reused across retries of it.
          checkoutAttemptId: crypto.randomUUID()
        })
      })

      const data = (await response.json()) as { checkoutUrl?: string; error?: string }

      if (!response.ok || !data.checkoutUrl) {
        setError(data.error ?? "We could not start that checkout. Nothing has been charged.")
        return
      }

      window.location.href = data.checkoutUrl
    } catch {
      setError("We could not reach checkout. Nothing has been charged.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="text-sm font-semibold text-white" id={ids.amount}>
          Choose an amount
        </legend>
        {/* A radio group, not buttons: arrow keys move between amounts, which is
            what a screen-reader or keyboard user expects of a single choice. */}
        <div role="radiogroup" aria-labelledby={ids.amount} className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {GIFT_CARD_DENOMINATIONS.map((denomination) => {
            const active = denomination.slug === slug
            return (
              <button
                key={denomination.slug}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSlug(denomination.slug)}
                className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold tabular-nums transition ${
                  active
                    ? "border-amber-200/60 bg-amber-200/12 text-amber-100"
                    : "border-white/12 bg-black/24 text-muted-foreground hover:border-amber-200/30"
                }`}
              >
                {money(denomination.faceValueCents)}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          id="gift-send-to-self"
          type="checkbox"
          checked={sendToSelf}
          onChange={(event) => setSendToSelf(event.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="gift-send-to-self" className="text-sm text-muted-foreground">
          Send it to me{buyerEmail ? ` (${buyerEmail})` : ""} so I can pass it on later
        </label>
      </div>

      {!sendToSelf ? (
        <div>
          <label htmlFor={ids.recipient} className="block text-sm font-semibold text-white">
            Recipient email
          </label>
          <input
            id={ids.recipient}
            type="email"
            required
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            aria-describedby={ids.recipientError}
            className="mt-2 w-full rounded-md border border-white/12 bg-black/30 px-3 py-2 text-sm text-white"
          />
          <p id={ids.recipientError} className="mt-1 text-xs text-muted-foreground">
            We send the gift card here right away. They do not need an account yet.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor={ids.sender} className="block text-sm font-semibold text-white">
          Your name
        </label>
        <input
          id={ids.sender}
          type="text"
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          className="mt-2 w-full rounded-md border border-white/12 bg-black/30 px-3 py-2 text-sm text-white"
        />
        <p className={`mt-1 text-xs ${senderLength > GIFT_CARD_SENDER_NAME_MAX ? "text-red-300" : "text-muted-foreground"}`}>
          {senderLength}/{GIFT_CARD_SENDER_NAME_MAX} characters
        </p>
      </div>

      <div>
        <label htmlFor={ids.message} className="block text-sm font-semibold text-white">
          Message <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={ids.message}
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-describedby={ids.messageHint}
          className="mt-2 w-full rounded-md border border-white/12 bg-black/30 px-3 py-2 text-sm text-white"
        />
        <p
          id={ids.messageHint}
          className={`mt-1 text-xs ${messageLength > GIFT_CARD_MESSAGE_MAX ? "text-red-300" : "text-muted-foreground"}`}
        >
          {messageLength}/{GIFT_CARD_MESSAGE_MAX} characters. Plain text only.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200/16 bg-black/24 p-4">
        <p className="text-lg font-semibold text-amber-100">{money(selected.faceValueCents)}</p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          <li>Delivered by email immediately after payment.</li>
          <li>Never expires. No inactivity, maintenance, or service fees.</li>
          <li>Cannot be used to buy another gift card.</li>
          <li>Not redeemable for cash except where required by law.</li>
        </ul>
      </div>

      {/* Errors and progress are announced. A payment flow must not change
          silently for someone not watching the screen. */}
      <div aria-live="polite" aria-atomic="true" className="min-h-[1.25rem]">
        {submitting ? <p className="text-sm text-muted-foreground">Starting secure checkout…</p> : null}
        {error ? <p className="text-sm font-semibold text-red-300">{error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={submitting || overLimit} aria-busy={submitting}>
          {submitting ? "Starting checkout…" : `Buy ${money(selected.faceValueCents)} gift card`}
        </Button>
        <span className="text-xs text-muted-foreground">
          <a className="underline" href="/legal/gift-cards">
            Gift card terms
          </a>{" "}
          ·{" "}
          <a className="underline" href="mailto:support@realfiction.live">
            Support
          </a>
        </span>
      </div>
    </form>
  )
}
