import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
// All trust-card icons were removed for a cleaner look — no lucide
// imports needed here anymore.

import { HolidayStoreBanner } from "@/components/holiday-store-banner"
import { Reveal } from "@/components/reveal"
import { FairPlayPromise } from "@/components/store/fair-play"
import { RankComparison } from "@/components/store/rank-comparison"
import { Storefront } from "@/components/storefront"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getOwnedProductIds } from "@/lib/store/ownership"
import { getVerifiedMinecraftLink } from "@/lib/store-server"
import { getAuthenticatedUser } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Store",
  description:
    "RealFiction store for cosmetics, supporter ranks, pets, particles, username colors, lobby flight, and gift cards."
}

// Checkout eligibility (signed in + linked account) is gated in the cart, so
// this needs fresh per-request auth state.
export const dynamic = "force-dynamic"

export default async function StorePage() {
  const user = await getAuthenticatedUser().catch(() => null)
  const link = user ? await getVerifiedMinecraftLink(user.id).catch(() => null) : null
  // Authoritative ownership, resolved server-side. The browser is never asked.
  const ownedProductIds = await getOwnedProductIds(user?.id ?? null)
  return (
    <section>
      <HolidayStoreBanner />
      <div className="relative overflow-hidden border-b border-amber-200/10 py-16 md:py-20">
        <Image
          alt="RealFiction store"
          src="/images/hero1.png"
          fill
          priority
          className="-z-20 object-cover opacity-32 blur-[1px]"
          sizes="100vw"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/70 via-background/82 to-background" />
        <div className="container-shell">
          <Reveal className="max-w-4xl">
            <h1 className="display-font text-4xl font-semibold leading-tight sm:text-5xl md:text-7xl">
              RealFiction Store
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Support the network with RealVIP, RealSupporter, pets, particles, username colors,
              lobby flight, cosmetic bundles, and gift cards. No paid power, no gameplay shortcuts.
            </p>
            <Button asChild className="mt-7" variant="outline">
              <Link href="/account">Link your Minecraft account</Link>
            </Button>
          </Reveal>
        </div>
      </div>

      <div className="container-shell py-10 md:py-14">
        {/* Quiet, icon-free trust band — clean rf-bold uppercase labels
            on top, body line below. Reads like a server MOTD instead of
            a generic SaaS feature row. */}
        <Reveal className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Checkout", body: "Secure payment methods available through Stripe Checkout." },
            { label: "Delivery", body: "Rewards land on your linked Minecraft account." },
            { label: "What's sold", body: "Cosmetics, supporter perks, lobby fun, and gift cards. Nothing else." }
          ].map((item) => (
            <div
              key={item.label}
              className="border border-amber-200/14 bg-black/24 px-4 py-3"
            >
              <div
                className="text-[11px] uppercase tracking-[0.18em] text-amber-200/85"
                style={{ fontFamily: "rf-bold, sans-serif" }}
              >
                {item.label}
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </Reveal>

        {/* Comparison first: the three headline choices and exactly how each
            one bills, before any card asks for money. */}
        <Reveal className="mt-10">
          <RankComparison />
        </Reveal>

        <Reveal className="mt-10">
          <Storefront
            signedIn={Boolean(user)}
            linkedUsername={link?.username ?? null}
            ownedProductIds={ownedProductIds}
          />
        </Reveal>

        <Reveal className="mt-10">
          <FairPlayPromise />
        </Reveal>
      </div>
    </section>
  )
}
