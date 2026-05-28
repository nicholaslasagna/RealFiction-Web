import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Gift, ShieldCheck } from "lucide-react"
// ShieldCheck is still used by the trust card row below.

import { Reveal } from "@/components/reveal"
import { Storefront } from "@/components/storefront"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Store",
  description:
    "RealFiction store for cosmetics, supporter ranks, pets, particles, username colors, lobby flight, and gift cards."
}

export default function StorePage() {
  return (
    <section>
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
        <Reveal className="grid gap-3 md:grid-cols-3">
          {[
            "Stripe, Apple Pay, Google Pay, and PayPal checkout",
            "Rewards delivered to your linked Minecraft account",
            "Cosmetics, supporter perks, lobby fun, and gift cards only"
          ].map((item) => (
            <Card key={item} className="border-amber-200/12 bg-black/18 shadow-none backdrop-blur-sm">
              <CardContent className="flex items-start gap-3 p-4">
                {item.includes("gift") ? (
                  <Gift className="mt-0.5 h-4 w-4 text-amber-200" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-200" />
                )}
                <p className="text-sm leading-6 text-muted-foreground">{item}</p>
              </CardContent>
            </Card>
          ))}
        </Reveal>

        <Reveal className="mt-10">
          <Storefront />
        </Reveal>
      </div>
    </section>
  )
}
