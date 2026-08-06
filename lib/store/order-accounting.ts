// ONE definition of how an order's money is described to a customer.
//
// An order can carry three amounts that are easy to confuse and expensive to
// confuse: the merchandise subtotal, the order total (after any server-applied
// discount), and the amount actually collected through Stripe (after store
// credit). Calling any of them "total" is wrong for two of them.
//
//   RealVIP · 3 months             $12.99   <- merchandise subtotal
//   Discount                       -$0.00   <- any server-applied reduction
//   Order total                    $12.99
//   Store credit                   -$5.00   <- money the customer already had
//   Paid through Stripe             $7.99   <- the only external charge
//
// The receipt email and the account page both render from this function, so
// they cannot drift into telling the customer two different stories about the
// same purchase — which is the failure this exists to prevent.
//
// Pure: no `server-only`, no I/O, safe to import from a React Server Component
// and from a test.

export type OrderAccountingInput = {
  /** Merchandise list value. Absent on historical orders — falls back to total. */
  subtotalCents?: number | null
  /** Server-computed discount, if any. Absent on historical orders. */
  discountCents?: number | null
  /** What the order came to after any discount. */
  totalCents: number
  storeCreditCents?: number | null
  /** What Stripe was asked to collect. Absent on historical orders. */
  paymentDueCents?: number | null
}

export type AccountingLine = {
  key: "subtotal" | "discount" | "order_total" | "store_credit" | "paid_external" | "paid_credit"
  label: string
  /** Always positive. `negative` says how to render the sign. */
  cents: number
  negative: boolean
  /** Emphasised lines are the ones a customer checks: the total, and what they paid. */
  emphasis: boolean
}

export type OrderAccounting = {
  lines: AccountingLine[]
  /**
   * True when nothing needed explaining — no discount, no store credit.
   * Callers render these as a single amount, exactly as they always have.
   */
  simple: boolean
  subtotalCents: number
  discountCents: number
  orderTotalCents: number
  storeCreditCents: number
  externalPaidCents: number
}

function whole(value: number | null | undefined, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * Derives the accounting from whatever columns an order actually has.
 *
 * Historical orders predate `discount_cents` and `payment_due_cents`. They
 * resolve to a plain single-amount order rather than throwing or rendering a
 * NaN — an old receipt must keep working forever.
 */
export function buildOrderAccounting(order: OrderAccountingInput): OrderAccounting {
  const total = Math.max(0, whole(order.totalCents))
  const discount = Math.max(0, whole(order.discountCents))
  // A missing subtotal means an older order, where subtotal == total.
  const subtotal = Math.max(total, whole(order.subtotalCents, total + discount) || total + discount)
  const storeCredit = Math.max(0, Math.min(whole(order.storeCreditCents), total))
  // Derive rather than trust when the column is absent, and never let a stale
  // column produce a payment larger than the order.
  const external =
    order.paymentDueCents === null || order.paymentDueCents === undefined
      ? Math.max(0, total - storeCredit)
      : Math.max(0, Math.min(whole(order.paymentDueCents), total))

  const lines: AccountingLine[] = []
  const explained = discount > 0 || storeCredit > 0

  if (explained) {
    lines.push({ key: "subtotal", label: "Subtotal", cents: subtotal, negative: false, emphasis: false })
  }
  if (discount > 0) {
    lines.push({
      key: "discount",
      label: "Discount",
      cents: discount,
      negative: true,
      emphasis: false
    })
    lines.push({ key: "order_total", label: "Order total", cents: total, negative: false, emphasis: true })
  }
  if (storeCredit > 0) {
    lines.push({
      key: "store_credit",
      label: "Store credit",
      cents: storeCredit,
      negative: true,
      emphasis: false
    })
  }

  // The externally collected amount is labelled as such — never as the order
  // total, which it is not once store credit is applied. And an order that took
  // no external payment shows no Stripe line at all.
  lines.push(
    external > 0
      ? { key: "paid_external", label: "Paid through Stripe", cents: external, negative: false, emphasis: true }
      : { key: "paid_credit", label: "Paid with store credit", cents: total, negative: false, emphasis: true }
  )

  return {
    lines,
    simple: !explained,
    subtotalCents: subtotal,
    discountCents: discount,
    orderTotalCents: total,
    storeCreditCents: storeCredit,
    externalPaidCents: external
  }
}
