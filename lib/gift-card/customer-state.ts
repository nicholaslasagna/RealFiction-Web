// The words a customer sees about a refund or a dispute.
//
// Pure and free of "server-only" so the wording is testable, and — more to the
// point — so the rule about what these strings may NOT contain is enforced by a
// test rather than by whoever edits the account page next.
//
// THE RULE
// ========
// A purchaser badge never distinguishes "your recipient spent some of it" from
// "your recipient has not touched it" from "there is a chargeback in progress".
// All three are `Refund requires review` or `Disputed`. The moment a badge
// discriminates, the account page becomes a report on what the recipient did
// with their gift.
//
// A recipient notice never says "dispute" or "chargeback". A chargeback is an
// accusation aimed at the sender, and the recipient is not the one being asked.

/** Exactly the states public.purchaser_gift_card_states can return. */
export type PurchaserRefundState = "refund_processing" | "refunded" | "refund_review" | "disputed"

/** Exactly the states a recipient can be shown about their own credit. */
export type RecipientCreditState = "frozen" | "restored" | "cash_redemption_hold"

export type StateBadge = {
  label: string
  /** Maps to the existing Badge variants; no new design vocabulary. */
  tone: "outline" | "warning" | "success"
  /** Read by screen readers in place of a color-only cue. */
  detail: string
}

const PURCHASER_BADGES: Record<PurchaserRefundState, StateBadge> = {
  refund_processing: {
    label: "Refund processing",
    tone: "outline",
    detail: "We have started your refund. It will return to your original payment method."
  },
  refunded: {
    label: "Refunded",
    tone: "success",
    detail: "Refunded to your original payment method. Most banks post it within 5-10 business days."
  },
  refund_review: {
    label: "Refund requires review",
    tone: "warning",
    // No reason. "Partially spent" would report the recipient's activity.
    detail: "Our support team is looking at this one. We will email you with the outcome."
  },
  disputed: {
    label: "Disputed",
    tone: "warning",
    detail: "This payment is under review with your bank. We will email you when it closes."
  }
}

const RECIPIENT_BADGES: Record<RecipientCreditState, StateBadge> = {
  frozen: {
    // A PAYMENT hold: a refund or a chargeback on the card that funded this
    // credit. Distinct from a cash-redemption hold, which the customer asked
    // for themselves — see CASH_REDEMPTION_BADGES. Saying "the payment behind
    // it is under review" about a redemption the customer initiated is simply
    // untrue, and it reads as though something went wrong with their card.
    label: "On hold during payment review",
    tone: "warning",
    detail:
      "This part of your balance cannot be spent while the payment that funded it is under review."
  },
  restored: {
    label: "Restored after dispute resolution",
    tone: "success",
    detail: "The review closed and your credit is available again."
  },
  // A hold the customer ASKED FOR. Architecturally distinct from `frozen`: that
  // one is imposed by a refund or chargeback on the funding payment, this one
  // is the direct consequence of their own cash-redemption request. Conflating
  // them told customers their payment was under review when nothing was wrong
  // with it.
  cash_redemption_hold: {
    label: "Cash redemption review pending",
    tone: "warning",
    detail:
      "This gift-card credit cannot be spent while your cash-redemption request is being reviewed."
  }
}

/**
 * Unknown states render nothing rather than leaking a raw database value.
 *
 * `Object.hasOwn` rather than a plain lookup: the state arrives from a database
 * row that becomes a JSON response, and `states["__proto__"]` on a plain object
 * resolves to `Object.prototype` — truthy, and enough to render a badge with no
 * label at all. Found by the test below.
 */
function lookup<K extends string>(table: Record<K, StateBadge>, state: string | null | undefined) {
  return state && Object.hasOwn(table, state) ? table[state as K] : null
}

export function purchaserBadge(state: string | null | undefined): StateBadge | null {
  return lookup(PURCHASER_BADGES, state)
}

export function recipientBadge(state: string | null | undefined): StateBadge | null {
  return lookup(RECIPIENT_BADGES, state)
}

/**
 * Which notice, if any, a recipient's credit warrants.
 *
 * A live hold always wins: if any money is frozen right now, telling them about
 * one that was released is noise.
 */
export function recipientCreditState(input: {
  holdCents: number
  restoredRecently: boolean
  /** True while the customer has an OPEN cash-redemption review. */
  cashRedemptionOpen?: boolean
}): RecipientCreditState | null {
  if (input.holdCents > 0) {
    // An open redemption review explains the hold precisely. Only fall back to
    // the payment wording when there is no redemption to attribute it to.
    return input.cashRedemptionOpen ? "cash_redemption_hold" : "frozen"
  }
  return input.restoredRecently ? "restored" : null
}

/** The redemption states during which value is actually on hold. */
export function isCashRedemptionOpen(state: string | null | undefined): boolean {
  return (
    state === "requested" ||
    state === "eligibility_review" ||
    state === "eligible" ||
    state === "manual_payout_required"
  )
}

// ---------------------------------------------------------------------------
// Cash-redemption review
// ---------------------------------------------------------------------------

/** Exactly the states public.cash_redemption_requests can hold. */
export type CashRedemptionState =
  | "requested"
  | "eligibility_review"
  | "eligible"
  | "ineligible"
  | "manual_payout_required"
  | "completed"
  | "rejected"

/**
 * THE RULE FOR THESE STRINGS
 * ==========================
 * Not one of them promises a payout, quotes an amount, or gives a reason.
 *
 * "Eligible" is the dangerous one: internally it means a reviewer decided the
 * balance qualifies, but to a customer it reads as "you are getting paid", and
 * a customer who reads that and is later refused has been misled by us. So the
 * eligible and payout-required states say the same neutral thing as the rest —
 * a person is handling it, and we will email.
 *
 * Reasons are absent for the same purpose. `ineligible_reason` records the legal
 * reasoning for our review record; publishing it would turn the account page
 * into an explanation of which jurisdictions and which balances qualify, which
 * is both a compliance answer we are not making by API and a map of the rules.
 */
const CASH_REDEMPTION_BADGES: Record<CashRedemptionState, StateBadge> = {
  requested: {
    label: "Review requested",
    tone: "outline",
    detail: "We have your request. A member of our team will review it and email you."
  },
  eligibility_review: {
    label: "Under review",
    tone: "outline",
    detail: "A member of our team is reviewing your request. We will email you with the outcome."
  },
  eligible: {
    // Deliberately NOT "Approved". See the rule above.
    label: "Under review",
    tone: "outline",
    detail: "A member of our team is reviewing your request. We will email you with the outcome."
  },
  manual_payout_required: {
    label: "Under review",
    tone: "outline",
    detail: "A member of our team is reviewing your request. We will email you with the outcome."
  },
  ineligible: {
    label: "Review closed",
    tone: "outline",
    detail: "We have emailed you about this request. Your store credit is unchanged."
  },
  rejected: {
    label: "Review closed",
    tone: "outline",
    detail: "We have emailed you about this request. Your store credit is unchanged."
  },
  completed: {
    label: "Review completed",
    tone: "success",
    detail: "We have emailed you about this request."
  }
}

export function cashRedemptionBadge(state: string | null | undefined): StateBadge | null {
  return lookup(CASH_REDEMPTION_BADGES, state)
}

/**
 * Whether the entry point should be offered.
 *
 * Offered only when there is gift-origin credit AND no review is already open:
 * a second button while the first request is being worked would invite a
 * customer to think the first one failed.
 */
export function canRequestCashRedemption(input: {
  hasGiftOriginCredit: boolean
  currentState: string | null | undefined
}): boolean {
  if (!input.hasGiftOriginCredit) {
    return false
  }
  return !(
    input.currentState === "requested" ||
    input.currentState === "eligibility_review" ||
    input.currentState === "eligible" ||
    input.currentState === "manual_payout_required"
  )
}
