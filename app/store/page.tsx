import type { Metadata } from "next"
import { ShieldCheck, Sparkles } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Storefront } from "@/components/storefront"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { storeProducts } from "@/lib/data"

export const metadata: Metadata = {
  title: "Store",
  description:
    "RealFiction store for cosmetics, supporter ranks, pets, particles, username colors, lobby flight, and gift cards."
}

export default function StorePage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <Badge variant="success">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          No pay-to-win products
        </Badge>
        <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">RealFiction Store</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          First-party checkout for cosmetics, pets, particles, lobby perks, profile customization,
          supporter ranks, chat colors, gift cards, subscriptions, and permanent unlocks.
        </p>
      </Reveal>

      <Reveal className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          "Stripe Checkout with Apple Pay and Google Pay support",
          "PayPal Checkout with Venmo support where available",
          "Reward queue delivery through RealCore and LuckPerms"
        ].map((item) => (
          <Card key={item}>
            <CardContent className="flex items-start gap-3 p-5">
              <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
              <p className="text-sm leading-6 text-muted-foreground">{item}</p>
            </CardContent>
          </Card>
        ))}
      </Reveal>

      <Reveal className="mt-10">
        <Storefront products={storeProducts} />
      </Reveal>
    </section>
  )
}
