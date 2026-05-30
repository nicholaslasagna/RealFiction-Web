"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * "Your Gift Cards" — lets the purchaser reveal/copy the codes they bought.
 *
 * The plaintext code is owner-only (RLS on gift_cards) and rendered masked
 * until the user clicks Reveal. Codes are never shown for cards that have
 * already been redeemed/voided.
 */

export type GiftCardEntry = {
  id: string
  code: string | null
  balanceCents: number
  originalCents: number
  status: string
  createdAt: string
  redeemedAt: string | null
}

const STATUS_LABEL: Record<string, string> = {
  active: "Ready to redeem",
  redeemed: "Redeemed",
  depleted: "Spent",
  expired: "Expired",
  revoked: "Void",
  void: "Void"
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export function GiftCardCodes({ cards }: { cards: GiftCardEntry[] }) {
  if (cards.length === 0) {
    return null
  }

  return (
    <Card className="minecraft-card">
      <CardHeader>
        <CardTitle className="display-font text-3xl">Your Gift Cards</CardTitle>
        <CardDescription>
          Codes you bought. Keep them private — anyone with a code can redeem it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
          {cards.map((card) => (
            <GiftCardRowItem key={card.id} card={card} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function GiftCardRowItem({ card }: { card: GiftCardEntry }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const redeemable = card.status === "active" && Boolean(card.code)

  async function copy() {
    if (!card.code) {
      return
    }
    try {
      await navigator.clipboard.writeText(card.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — the revealed code is still selectable by hand.
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-white">{formatUsd(card.originalCents)} gift card</p>
        <Badge variant={redeemable ? "success" : "outline"}>{STATUS_LABEL[card.status] ?? card.status}</Badge>
      </div>

      {redeemable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded bg-black/40 px-3 py-2 font-mono text-sm tracking-wider text-white">
            {revealed ? card.code : "RF-••••-••••-••••"}
          </code>
          <Button type="button" variant="outline" onClick={() => setRevealed((value) => !value)}>
            {revealed ? "Hide" : "Reveal"}
          </Button>
          {revealed ? (
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {card.status === "redeemed" ? "Redeemed to store credit." : "This card is no longer redeemable."}
        </p>
      )}
    </div>
  )
}
