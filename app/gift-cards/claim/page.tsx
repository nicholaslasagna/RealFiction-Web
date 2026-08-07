import type { Metadata } from "next"

import { GiftCardClaimForm } from "@/components/gift-card/claim-form"

export const metadata: Metadata = {
  title: "Claim your gift card",
  description: "Add a RealFiction gift card to your store credit.",
  // Belt and braces with the header set below: this page must never appear in
  // search results, because the URL a recipient holds contains their secret in
  // the fragment.
  robots: { index: false, follow: false },
  referrer: "no-referrer"
}

export const dynamic = "force-dynamic"

/**
 * The claim page.
 *
 * The secret lives in the URL FRAGMENT, which a browser never transmits, so
 * this server component never sees it and it cannot appear in an access log, a
 * Referer header, or a CDN trace. Everything that touches the secret happens in
 * the client component below, and value only moves on an explicit POST.
 *
 * No third-party resources load here. Nothing on this page may be in a position
 * to read `location.hash`.
 */
export default function GiftCardClaimPage() {
  return (
    <section className="container-shell py-16 md:py-24">
      <div className="mx-auto max-w-lg">
        <h1 className="display-font text-3xl font-semibold sm:text-4xl">Claim your gift card</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Opening this page does not claim anything. Sign in with the address the gift card was sent
          to, then confirm below — your balance changes only after you do.
        </p>
        <GiftCardClaimForm />
      </div>
    </section>
  )
}
