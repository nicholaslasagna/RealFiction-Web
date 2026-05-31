// Pure store-credit math (no "server-only" so it's unit testable).
//
// The server is always the source of truth for `availableCents` (read from
// store_credit_ledger). This only decides how much of a cart a given balance
// covers. All integer cents; credit can never exceed the balance or the
// subtotal, and `dueCents` is never negative.

export type CreditApplication = {
  creditCents: number
  dueCents: number
}

export function computeCreditApplication(
  subtotalCents: number,
  availableCents: number,
  apply: boolean
): CreditApplication {
  const subtotal = Math.max(0, Math.trunc(subtotalCents || 0))
  const available = Math.max(0, Math.trunc(availableCents || 0))

  if (!apply || available <= 0 || subtotal <= 0) {
    return { creditCents: 0, dueCents: subtotal }
  }

  const creditCents = Math.min(available, subtotal)
  return { creditCents, dueCents: subtotal - creditCents }
}
