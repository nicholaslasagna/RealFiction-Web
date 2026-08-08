// One purchase, as the customer sees it.
//
// Extracted from the account page so the preview harness and the DOM tests
// render the SAME component the account page renders, rather than a copy that
// can drift from it. The money lines come from the shared accounting function
// the receipt email also uses.

import { Gift } from "lucide-react"

import { CheckIcon, ClockIcon, WarningIcon } from "@/components/minecraft-icons"
import { Badge } from "@/components/ui/badge"
import { buildOrderAccounting } from "@/lib/store/order-accounting"

export type PurchaseItem = {
  quantity: number
  product_snapshot?: { name?: string; slug?: string } | null
}

export type PurchaseRow = {
  id: string
  status: string
  total_cents: number
  currency: string
  created_at: string
  paid_at?: string | null
  gifted_to_minecraft_username?: string | null
  store_credit_applied_cents?: number | null
  payment_due_cents?: number | null
  // Absent on historical orders placed before upgrades existed.
  subtotal_cents?: number | null
  discount_cents?: number | null
  order_items?: PurchaseItem[] | null
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD"
  }).format(cents / 100)
}

export function formatDate(value: string | null) {
  if (!value) {
    return "Not yet"
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return "Not yet"
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(parsed)
  )
}

/**
 * A gift card is not a RealCore reward and is never "ready in-game": nothing is
 * delivered to a Minecraft server, so the ordinary fulfilment wording is wrong
 * for it. The delivery is an email carrying a private claim link, and the
 * meaningful states are sent and claimed.
 */
export function isGiftCardOrderRow(order: { order_items?: PurchaseItem[] | null }): boolean {
  return (order.order_items ?? []).some((item) => {
    const slug = (item.product_snapshot?.slug ?? "").toLowerCase()
    return slug.startsWith("gift-card") || slug.startsWith("gift_card")
  })
}

export function orderLabel(status: string, isGiftCard = false) {
  if (isGiftCard) {
    const giftLabels: Record<string, string> = {
      draft: "Not started",
      pending: "Waiting for checkout",
      paid: "Sending",
      // The card exists and its delivery email has been queued. "Sent" is what
      // the purchaser can actually act on; whether the recipient has claimed it
      // is the recipient's business and is not reported here.
      fulfilled: "Sent",
      refunded: "Refunded",
      chargeback: "Closed",
      cancelled: "Cancelled",
      under_review: "Being reviewed"
    }
    return giftLabels[status] ?? "Checking"
  }

  const labels: Record<string, string> = {
    draft: "Not started",
    pending: "Waiting for checkout",
    paid: "Almost ready",
    fulfilled: "Ready in-game",
    refunded: "Refunded",
    chargeback: "Closed",
    cancelled: "Cancelled",
    // A purchase held for a human decision. Not an error, and not a failure the
    // customer caused — so it does not read like one.
    under_review: "Being reviewed"
  }
  return labels[status] ?? "Checking"
}

export function OrderStatusBadge({ status, isGiftCard = false }: { status: string; isGiftCard?: boolean }) {
  const warning = status === "refunded" || status === "chargeback" || status === "under_review"
  const Icon = status === "fulfilled" ? CheckIcon : warning ? WarningIcon : ClockIcon
  const variant: "success" | "warning" | "outline" =
    status === "fulfilled" ? "success" : warning ? "warning" : "outline"
  return (
    <Badge variant={variant}>
      <Icon size={12} />
      {orderLabel(status, isGiftCard)}
    </Badge>
  )
}

/**
 * The money story for one order.
 *
 * An order with nothing to explain keeps the single-amount layout it has always
 * had. An upgrade or store-credit order gets the full breakdown, because the
 * merchandise subtotal, the order total, and the amount actually charged are
 * three different numbers and only one of them is what the customer paid.
 */
export function OrderAccounting({ order }: { order: PurchaseRow }) {
  const accounting = buildOrderAccounting({
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    totalCents: order.total_cents,
    storeCreditCents: order.store_credit_applied_cents,
    paymentDueCents: order.payment_due_cents
  })

  if (accounting.simple) {
    return (
      <p className="mt-3 text-sm font-semibold text-amber-100" data-testid="order-amount">
        {formatMoney(accounting.orderTotalCents, order.currency)}
      </p>
    )
  }

  return (
    <dl className="mt-3 space-y-0.5 text-sm" data-testid="order-accounting">
      {accounting.lines.map((line) => (
        <div key={line.key} className="flex items-baseline justify-between gap-3" data-line={line.key}>
          <dt className={line.emphasis ? "font-semibold text-amber-100" : "text-muted-foreground"}>
            {line.label}
          </dt>
          <dd
            className={
              line.negative
                ? "tabular-nums text-emerald-200"
                : line.emphasis
                  ? "tabular-nums font-semibold text-amber-100"
                  : "tabular-nums text-muted-foreground"
            }
          >
            {line.negative ? "-" : ""}
            {formatMoney(line.cents, order.currency)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PurchaseRowCard({ order }: { order: PurchaseRow }) {
  // The product NAME comes from the order's own snapshot, so a historical
  // purchase keeps its name even after the SKU is retired or renamed.
  const firstItem = order.order_items?.[0]
  const itemName = firstItem?.product_snapshot?.name ?? "Store item"
  const moreItems = Math.max((order.order_items?.length ?? 1) - 1, 0)
  const giftedTo = order.gifted_to_minecraft_username

  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4" data-testid="purchase-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white">
            {itemName}
            {moreItems ? ` + ${moreItems} more` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
          {giftedTo ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-amber-100">
              <Gift className="h-3.5 w-3.5" aria-hidden />
              Gifted to: <span className="font-semibold">{giftedTo}</span>
            </p>
          ) : null}
        </div>
        <OrderStatusBadge status={order.status} isGiftCard={isGiftCardOrderRow(order)} />
      </div>
      <OrderAccounting order={order} />
    </div>
  )
}
