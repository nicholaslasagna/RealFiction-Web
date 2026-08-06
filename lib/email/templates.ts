// Transactional email content.
//
// Pure: no "server-only", no network, no DB — so every branch is unit-testable
// and the "what may appear in a customer email" rules are enforced by tests
// rather than by reviewer memory.
//
// A RealFiction fulfilment email is NOT a payment receipt. Stripe sends the
// receipt (card brand/last4, tax, the legal record). This email says what was
// bought, where it was delivered in-game, and when it expires. Keeping them
// separate is why nothing here needs card or payment-instrument data.

export type OrderEmailItem = {
  name: string
  quantity: number
  /** e.g. "3 Months" for a subscription tier; null for consumables. */
  durationLabel: string | null
  totalCents: number
  /** Entitlement expiry after stacking, ISO string; null if not time-bound. */
  expiresAt: string | null
}

export type OrderEmailData = {
  orderId: string
  purchasedAt: string
  /** Minecraft account the perks were delivered to. */
  deliveryUsername: string | null
  isGift: boolean
  giftRecipient: string | null
  items: OrderEmailItem[]
  subtotalCents: number
  /** Server-computed upgrade discount. Zero for an ordinary order. */
  upgradeDiscountCents?: number
  storeCreditCents: number
  totalPaidCents: number
  currency: string
  /** 'fulfilled' | 'paid' — what the customer should expect right now. */
  fulfillmentStatus: string
  supportEmail: string
  siteUrl: string
  /** Stripe-hosted receipt, when Stripe has produced one. */
  stripeReceiptUrl: string | null
}

export type EmailContent = { subject: string; text: string; html: string }

/**
 * Human-quotable order number. Support can find the order from this, and it is
 * not a secret — it identifies nothing on its own without an authenticated
 * session.
 */
export function orderNumber(orderId: string): string {
  return `RF-${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(
    cents / 100
  )
}

export function formatDate(value: string | null): string | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed)
}

/**
 * HTML-escape every interpolated value. Product names and Minecraft usernames
 * come from the database; even though usernames are charset-validated at the
 * boundary, an email template must never be the thing that assumes that.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function itemLine(item: OrderEmailItem): string {
  const parts = [item.name]
  if (item.durationLabel) {
    parts.push(`(${item.durationLabel})`)
  }
  if (item.quantity > 1) {
    parts.push(`x${item.quantity}`)
  }
  return parts.join(" ")
}

function expiryLine(item: OrderEmailItem): string | null {
  const date = formatDate(item.expiresAt)
  return date ? `Access through ${date}` : null
}

/**
 * Order confirmation / fulfilment email.
 *
 * Deliberately excludes: card numbers or any payment instrument detail, Stripe
 * ids or secrets, webhook payloads, HMAC material, service-role data, account
 * UUIDs, and Minecraft UUIDs. The only identifiers are the human order number
 * and the Minecraft username the buyer chose.
 */
export function buildOrderConfirmationEmail(data: OrderEmailData): EmailContent {
  const number = orderNumber(data.orderId)
  const fulfilled = data.fulfillmentStatus === "fulfilled"
  const historyUrl = `${data.siteUrl.replace(/\/$/, "")}/account`

  const deliveredTo = data.isGift
    ? data.giftRecipient
    : data.deliveryUsername

  const subject = data.isGift
    ? `Your RealFiction gift is on its way (${number})`
    : `Order confirmed — ${number}`

  const statusLine = fulfilled
    ? "Your perks are active in-game now."
    : "Payment received. Your perks are being delivered — this usually takes a moment, and they will be waiting next time you log in."

  // -- Plain text ------------------------------------------------------------
  const textLines: string[] = [
    data.isGift ? "Thanks for the gift!" : "Thanks for your support!",
    "",
    statusLine,
    "",
    `Order ${number}`,
    `Placed ${formatDate(data.purchasedAt) ?? "recently"}`,
    ""
  ]

  if (deliveredTo) {
    textLines.push(data.isGift ? `Gift for: ${deliveredTo}` : `Delivered to: ${deliveredTo}`, "")
  }

  textLines.push("Items")
  for (const item of data.items) {
    textLines.push(`  - ${itemLine(item)} — ${formatMoney(item.totalCents, data.currency)}`)
    const expiry = expiryLine(item)
    if (expiry) {
      textLines.push(`      ${expiry}`)
    }
  }
  textLines.push("")

  // An upgrade discount and store credit are DIFFERENT things and are shown on
  // separate lines: one reduces the price of the goods, the other is money the
  // customer already had with us.
  const discountCents = data.upgradeDiscountCents ?? 0
  const orderTotalCents = data.subtotalCents - discountCents

  if (discountCents > 0 || data.storeCreditCents > 0) {
    textLines.push(`Subtotal: ${formatMoney(data.subtotalCents, data.currency)}`)
    if (discountCents > 0) {
      textLines.push(`RealVIP upgrade credit: -${formatMoney(discountCents, data.currency)}`)
      textLines.push(`Order total: ${formatMoney(orderTotalCents, data.currency)}`)
    }
    if (data.storeCreditCents > 0) {
      textLines.push(`Store credit: -${formatMoney(data.storeCreditCents, data.currency)}`)
    }
  }
  // The externally collected amount is labelled as such — never as the order
  // total, which it is not once store credit is applied.
  textLines.push(
    data.totalPaidCents > 0
      ? `Paid through Stripe: ${formatMoney(data.totalPaidCents, data.currency)}`
      : `Paid with store credit: ${formatMoney(orderTotalCents, data.currency)}`
  )
  textLines.push("")

  if (data.stripeReceiptUrl) {
    textLines.push(`Payment receipt: ${data.stripeReceiptUrl}`)
  }
  textLines.push(`Order history: ${historyUrl}`)
  textLines.push("")
  textLines.push(`Questions? Reply to this email or contact ${data.supportEmail}.`)

  // -- HTML ------------------------------------------------------------------
  const itemRows = data.items
    .map((item) => {
      const expiry = expiryLine(item)
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #1e3244;color:#f6f4ef;">
            ${escapeHtml(itemLine(item))}
            ${expiry ? `<div style="color:#9db3c4;font-size:13px;margin-top:4px;">${escapeHtml(expiry)}</div>` : ""}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #1e3244;color:#f6f4ef;text-align:right;white-space:nowrap;">
            ${escapeHtml(formatMoney(item.totalCents, data.currency))}
          </td>
        </tr>`
    })
    .join("")

  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:${strong ? "8px" : "4px"} 0;color:${strong ? "#f6f4ef" : "#9db3c4"};${strong ? "font-weight:600;" : ""}">${escapeHtml(label)}</td><td style="padding:${strong ? "8px" : "4px"} 0;color:${strong ? "#f6f4ef" : "#9db3c4"};text-align:right;${strong ? "font-weight:600;" : ""}">${escapeHtml(value)}</td></tr>`

  const totalsRows = [
    discountCents > 0 || data.storeCreditCents > 0
      ? row("Subtotal", formatMoney(data.subtotalCents, data.currency))
      : "",
    discountCents > 0
      ? row("RealVIP upgrade credit", `-${formatMoney(discountCents, data.currency)}`)
      : "",
    discountCents > 0
      ? row("Order total", formatMoney(orderTotalCents, data.currency), true)
      : "",
    data.storeCreditCents > 0
      ? row("Store credit", `-${formatMoney(data.storeCreditCents, data.currency)}`)
      : "",
    data.totalPaidCents > 0
      ? row("Paid through Stripe", formatMoney(data.totalPaidCents, data.currency), true)
      : row("Paid with store credit", formatMoney(orderTotalCents, data.currency), true)
  ].join("")

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#021429;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;">
    <tr><td style="padding-bottom:16px;">
      <div style="font-size:22px;font-weight:700;color:#f6f4ef;">${escapeHtml(data.isGift ? "Thanks for the gift!" : "Thanks for your support!")}</div>
      <div style="margin-top:8px;color:#9db3c4;font-size:15px;line-height:22px;">${escapeHtml(statusLine)}</div>
    </td></tr>
    <tr><td style="padding:16px;background:#07203a;border-radius:8px;">
      <div style="color:#9db3c4;font-size:13px;">Order</div>
      <div style="color:#f6f4ef;font-size:18px;font-weight:600;">${escapeHtml(number)}</div>
      <div style="color:#9db3c4;font-size:13px;margin-top:4px;">Placed ${escapeHtml(formatDate(data.purchasedAt) ?? "recently")}</div>
      ${
        deliveredTo
          ? `<div style="color:#9db3c4;font-size:13px;margin-top:8px;">${escapeHtml(data.isGift ? "Gift for" : "Delivered to")}: <span style="color:#f6f4ef;">${escapeHtml(deliveredTo)}</span></div>`
          : ""
      }
    </td></tr>
    <tr><td style="padding-top:20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${itemRows}${totalsRows}</table>
    </td></tr>
    <tr><td style="padding-top:24px;">
      <a href="${escapeHtml(historyUrl)}" style="display:inline-block;background:#f2c14e;color:#021429;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">View your orders</a>
      ${
        data.stripeReceiptUrl
          ? `<a href="${escapeHtml(data.stripeReceiptUrl)}" style="display:inline-block;margin-left:12px;color:#9db3c4;text-decoration:underline;padding:12px 0;">Payment receipt</a>`
          : ""
      }
    </td></tr>
    <tr><td style="padding-top:24px;color:#9db3c4;font-size:13px;line-height:20px;">
      Questions? Reply to this email or contact
      <a href="mailto:${escapeHtml(data.supportEmail)}" style="color:#f2c14e;">${escapeHtml(data.supportEmail)}</a>.
    </td></tr>
  </table>
</body>
</html>`

  return { subject, text: textLines.join("\n"), html }
}

// -- Refund confirmation ------------------------------------------------------

export type RefundEmailData = {
  orderId: string
  refundedCents: number
  currency: string
  /** true when the whole charge was refunded. */
  isFullRefund: boolean
  /** Named only when the refund maps unambiguously to one item. */
  affectedItemName: string | null
  /** What happened to access: 'revoked' | 'unchanged' | 'under_review'. */
  entitlementStatus: "revoked" | "unchanged" | "under_review"
  supportEmail: string
  siteUrl: string
}

function entitlementSentence(status: RefundEmailData["entitlementStatus"]): string {
  if (status === "revoked") {
    return "The perks from this order have been removed from your account."
  }
  if (status === "under_review") {
    return "Our team is reviewing which perks this affects and will follow up. Nothing has been removed yet."
  }
  return "Your perks are unchanged."
}

/**
 * Refund confirmation. Queued ONLY when a refund reaches status=succeeded — a
 * pending or failed refund must never produce this email.
 *
 * Carries no card details and no Stripe or Supabase identifiers; the human
 * order number is the only reference.
 */
export function buildRefundConfirmationEmail(data: RefundEmailData): EmailContent {
  const number = orderNumber(data.orderId)
  const amount = formatMoney(data.refundedCents, data.currency)
  const historyUrl = `${data.siteUrl.replace(/\/$/, "")}/account`
  const scope = data.isFullRefund ? "Full refund" : "Partial refund"

  const subject = `${scope} issued — ${number}`

  const textLines = [
    `${scope} issued for order ${number}.`,
    "",
    `Amount refunded: ${amount}`,
    ...(data.affectedItemName ? [`Item: ${data.affectedItemName}`] : []),
    "",
    entitlementSentence(data.entitlementStatus),
    "",
    "Refunds usually appear on your original payment method within 5–10 business days,",
    "depending on your bank.",
    "",
    `Order history: ${historyUrl}`,
    "",
    `Questions? Reply to this email or contact ${data.supportEmail}.`
  ]

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#021429;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;">
    <tr><td style="padding-bottom:16px;">
      <div style="font-size:22px;font-weight:700;color:#f6f4ef;">${escapeHtml(scope)} issued</div>
      <div style="margin-top:8px;color:#9db3c4;font-size:15px;line-height:22px;">${escapeHtml(entitlementSentence(data.entitlementStatus))}</div>
    </td></tr>
    <tr><td style="padding:16px;background:#07203a;border-radius:8px;">
      <div style="color:#9db3c4;font-size:13px;">Order</div>
      <div style="color:#f6f4ef;font-size:18px;font-weight:600;">${escapeHtml(number)}</div>
      <div style="color:#9db3c4;font-size:13px;margin-top:8px;">Amount refunded: <span style="color:#f6f4ef;">${escapeHtml(amount)}</span></div>
      ${
        data.affectedItemName
          ? `<div style="color:#9db3c4;font-size:13px;margin-top:4px;">Item: <span style="color:#f6f4ef;">${escapeHtml(data.affectedItemName)}</span></div>`
          : ""
      }
    </td></tr>
    <tr><td style="padding-top:20px;color:#9db3c4;font-size:14px;line-height:21px;">
      Refunds usually appear on your original payment method within 5–10 business days, depending on your bank.
    </td></tr>
    <tr><td style="padding-top:24px;">
      <a href="${escapeHtml(historyUrl)}" style="display:inline-block;background:#f2c14e;color:#021429;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">View your orders</a>
    </td></tr>
    <tr><td style="padding-top:24px;color:#9db3c4;font-size:13px;line-height:20px;">
      Questions? Reply to this email or contact
      <a href="mailto:${escapeHtml(data.supportEmail)}" style="color:#f2c14e;">${escapeHtml(data.supportEmail)}</a>.
    </td></tr>
  </table>
</body>
</html>`

  return { subject, text: textLines.join("\n"), html }
}
