import { NextResponse } from "next/server"

import { isPayPalAllowed } from "@/lib/checkout-guard"
import { capturePayPalOrder } from "@/lib/payments"
import { fulfillPaidOrderWithOutbox } from "@/lib/store-server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const localOrderId = url.searchParams.get("order_id")
  const payPalOrderId = url.searchParams.get("token")
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"

  // PayPal is sandbox-only: never fulfil a production order from this path, even
  // if someone calls the capture URL directly with a crafted token.
  if (!isPayPalAllowed()) {
    return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-unavailable`)
  }

  if (!localOrderId || !payPalOrderId) {
    return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error`)
  }

  try {
    const captured = await capturePayPalOrder(payPalOrderId)
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0]
    const referencesLocalOrder = captured.purchase_units?.some((unit) => unit.reference_id === localOrderId)

    if (!referencesLocalOrder) {
      return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error&order_id=${encodeURIComponent(localOrderId)}`)
    }

    if (captured.status !== "COMPLETED" && capture?.status !== "COMPLETED") {
      return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-pending&order_id=${encodeURIComponent(localOrderId)}`)
    }

    await fulfillPaidOrderWithOutbox(localOrderId, {
      paymentIntentId: capture?.id ?? captured.id ?? payPalOrderId
    })

    return NextResponse.redirect(`${siteUrl}/account?checkout=success&order_id=${encodeURIComponent(localOrderId)}`)
  } catch (error) {
    console.error("paypal_capture_error", error)
    return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error&order_id=${encodeURIComponent(localOrderId)}`)
  }
}
