// Pure resolver for a store order's delivery target.
//
// No "server-only" import so it can be unit tested directly under node:test.
// It never trusts a raw client username for a normal purchase — the checkout
// route passes `submittedUsername: undefined` for non-gift orders and lets the
// server-resolved linked account win. The precedence is:
//
//   gift recipient (gift mode)  >  submitted username  >  linked account
//
// A gift order with no recipient resolves to "missing" (it must never silently
// fall back to the purchaser's own account), so the route can reject it.

export type DeliverySource = "gift_recipient" | "submitted_username" | "linked_account" | "missing"

export type DeliveryResolution = {
  username: string | null
  source: DeliverySource
  isGift: boolean
}

export type DeliveryInput = {
  isGift?: boolean
  giftRecipient?: string | null
  submittedUsername?: string | null
  linkedUsername?: string | null
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveDeliveryTarget(input: DeliveryInput): DeliveryResolution {
  const isGift = Boolean(input.isGift)
  const giftRecipient = clean(input.giftRecipient)

  // Gift mode delivers to the recipient or fails — never to the purchaser.
  if (isGift) {
    return giftRecipient
      ? { username: giftRecipient, source: "gift_recipient", isGift: true }
      : { username: null, source: "missing", isGift: true }
  }

  const submitted = clean(input.submittedUsername)
  if (submitted) {
    return { username: submitted, source: "submitted_username", isGift: false }
  }

  const linked = clean(input.linkedUsername)
  if (linked) {
    return { username: linked, source: "linked_account", isGift: false }
  }

  return { username: null, source: "missing", isGift: false }
}
