import { NextResponse } from "next/server"

import { capturePayPalOrder } from "@/lib/payments"
import { markOrderPaidAndFulfill } from "@/lib/store-server"

export const runtime = "edge"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const localOrderId = url.searchParams.get("order_id")
  const payPalOrderId = url.searchParams.get("token")
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realfiction.live"

  if (!localOrderId || !payPalOrderId) {
    return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error`)
  }

  try {
    const captured = await capturePayPalOrder(payPalOrderId)
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0]
    const referencesLocalOrder = captured.purchase_units?.some((unit) => unit.reference_id === localOrderId)

    if (!referencesLocalOrder) {
      return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error&order_id=${localOrderId}`)
    }

    if (captured.status !== "COMPLETED" && capture?.status !== "COMPLETED") {
      return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-pending&order_id=${localOrderId}`)
    }

    await markOrderPaidAndFulfill(localOrderId, capture?.id ?? captured.id ?? payPalOrderId)

    return NextResponse.redirect(`${siteUrl}/account?checkout=success&order_id=${localOrderId}`)
  } catch (error) {
    console.error("paypal_capture_error", error)
    return NextResponse.redirect(`${siteUrl}/store?checkout=paypal-error&order_id=${localOrderId}`)
  }
}
