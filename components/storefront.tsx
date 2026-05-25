"use client"

import Image from "next/image"
import { CreditCard, Gift, Minus, Plus, ShieldCheck, ShoppingCart, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DURATION_LABEL,
  giftCards,
  productCategories,
  storeProducts,
  type DurationMonths,
  type ProductCategory,
  type SubscriptionProduct
} from "@/lib/data"
import { cn, formatCurrency } from "@/lib/utils"

type CartItem = { slug: string; quantity: number }

const accentThemes: Record<string, { surface: string; icon: string }> = {
  cyan: { surface: "border-cyan-300/16 bg-cyan-300/[0.055]", icon: "text-cyan-200" },
  amber: { surface: "border-amber-300/18 bg-amber-300/[0.06]", icon: "text-amber-200" },
  emerald: { surface: "border-emerald-300/16 bg-emerald-300/[0.055]", icon: "text-emerald-200" },
  violet: { surface: "border-violet-300/16 bg-violet-300/[0.052]", icon: "text-violet-200" },
  rose: { surface: "border-rose-300/16 bg-rose-300/[0.052]", icon: "text-rose-200" },
  sky: { surface: "border-sky-300/16 bg-sky-300/[0.055]", icon: "text-sky-200" },
  blue: { surface: "border-blue-300/16 bg-blue-300/[0.052]", icon: "text-blue-200" }
}

// Flat lookup for every purchasable slug (subscription tiers + gift cards).
const skuIndex = new Map<string, { name: string; priceCents: number; consumable: boolean }>()
for (const card of giftCards) {
  skuIndex.set(card.id, { name: card.name, priceCents: card.priceCents, consumable: true })
}
for (const product of storeProducts) {
  for (const tier of product.tiers) {
    skuIndex.set(tier.slug, {
      name: `${product.name} · ${DURATION_LABEL[tier.months]}`,
      priceCents: tier.priceCents,
      consumable: false
    })
  }
}

function savePercent(product: SubscriptionProduct, priceCents: number, months: DurationMonths) {
  const monthly = product.tiers[0]?.priceCents ?? priceCents
  const full = monthly * months
  if (full <= 0) {
    return 0
  }
  return Math.round((1 - priceCents / full) * 100)
}

export function Storefront() {
  const [category, setCategory] = useState<ProductCategory | "all">("all")
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedMonths, setSelectedMonths] = useState<Record<string, DurationMonths>>({})
  const [minecraftUsername, setMinecraftUsername] = useState("")
  const [giftRecipient, setGiftRecipient] = useState("")
  const [checkoutState, setCheckoutState] = useState<string | null>(null)

  const sections = useMemo(
    () =>
      productCategories
        .filter((c) => c.id !== "all" && (category === "all" || category === c.id))
        .map((c) => ({
          meta: c,
          products: c.id === "gift-cards" ? [] : storeProducts.filter((p) => p.category === c.id),
          cards: c.id === "gift-cards" ? giftCards : []
        }))
        .filter((s) => s.products.length > 0 || s.cards.length > 0),
    [category]
  )

  const cartLines = cart
    .map((item) => {
      const info = skuIndex.get(item.slug)
      if (!info) {
        return null
      }
      return { slug: item.slug, name: info.name, quantity: item.quantity, total: info.priceCents * item.quantity }
    })
    .filter(Boolean) as Array<{ slug: string; name: string; quantity: number; total: number }>

  const total = cartLines.reduce((sum, item) => sum + item.total, 0)

  function changeQuantity(slug: string, delta: number) {
    setCart((current) => {
      const info = skuIndex.get(slug)
      const max = info?.consumable ? 25 : 1
      const existing = current.find((item) => item.slug === slug)

      if (!existing) {
        return delta > 0 ? [...current, { slug, quantity: 1 }] : current
      }

      const quantity = existing.quantity + delta
      if (quantity <= 0) {
        return current.filter((item) => item.slug !== slug)
      }
      return current.map((item) => (item.slug === slug ? { ...item, quantity: Math.min(quantity, max) } : item))
    })
  }

  async function checkout(provider: "stripe" | "paypal") {
    setCheckoutState("Getting your payment ready...")

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          minecraftUsername: minecraftUsername || undefined,
          giftRecipient: giftRecipient || undefined,
          items: cart.map((item) => ({ productId: item.slug, quantity: item.quantity }))
        })
      })

      const json = (await response.json()) as { checkoutUrl?: string | null; message?: string; error?: string }

      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl
        return
      }
      setCheckoutState(json.message ?? json.error ?? "This payment option is not ready yet.")
    } catch (error) {
      setCheckoutState(error instanceof Error ? error.message : "Checkout failed.")
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_390px]">
      <div className="space-y-6">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {productCategories.map((item) => {
            const Icon = item.icon
            const active = category === item.id

            return (
              <button
                key={item.id}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-bold transition",
                  active
                    ? "border-amber-200/45 bg-amber-200/14 text-amber-100"
                    : "border-amber-200/14 bg-black/24 text-muted-foreground hover:bg-amber-200/8 hover:text-amber-100"
                )}
                onClick={() => setCategory(item.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
        </div>

        <div className="space-y-10">
          {sections.map((section) => {
            const SectionIcon = section.meta.icon
            const isGiftCards = section.meta.id === "gift-cards"
            const count = isGiftCards ? section.cards.length : section.products.length

            return (
              <section key={section.meta.id} className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-md border border-amber-200/20 bg-black/30 p-2">
                    <SectionIcon className="h-4 w-4 text-amber-200" />
                  </span>
                  <h2 className="display-font text-2xl font-semibold">{section.meta.label}</h2>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs text-muted-foreground">
                    {count}
                  </span>
                </div>

                {isGiftCards ? (
                  <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
                    {section.cards.map((card) => (
                      <Card key={card.id} className="minecraft-card flex flex-col overflow-hidden">
                        <div className="flex justify-center bg-black/30 px-3 pt-4">
                          <Image
                            alt={`${card.name} for RealFiction`}
                            src={card.image}
                            width={384}
                            height={606}
                            className="h-auto w-[80%] max-w-[170px] rounded-lg drop-shadow-[0_16px_36px_rgba(0,0,0,0.55)]"
                          />
                        </div>
                        <CardContent className="flex flex-1 flex-col gap-2 pt-4">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="display-font text-lg">{card.name}</CardTitle>
                            <span className="font-mono text-base font-semibold text-amber-100">
                              {formatCurrency(card.priceCents)}
                            </span>
                          </div>
                          <Button className="mt-auto w-full" onClick={() => changeQuantity(card.id, 1)} type="button">
                            <Plus className="h-4 w-4" />
                            Add to cart
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    {section.products.map((product) => {
                      const theme = accentThemes[product.accent] ?? accentThemes.amber
                      const months = selectedMonths[product.id] ?? 1
                      const tier = product.tiers.find((entry) => entry.months === months) ?? product.tiers[0]
                      const perMonth = Math.round(tier.priceCents / tier.months)

                      return (
                        <Card key={product.id} className="minecraft-card flex flex-col overflow-hidden">
                          <div
                            className={cn(
                              "relative flex h-24 items-center justify-center overflow-hidden border-b",
                              theme.surface
                            )}
                          >
                            <SectionIcon className={cn("relative h-10 w-10 drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]", theme.icon)} />
                            {product.featured ? (
                              <Badge variant="warning" className="absolute left-3 top-3">
                                Popular
                              </Badge>
                            ) : null}
                          </div>
                          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
                            <CardTitle className="display-font text-xl">{product.name}</CardTitle>
                            <p className="text-sm leading-6 text-muted-foreground">{product.summary}</p>

                            <div className="grid grid-cols-2 gap-2">
                              {product.tiers.map((entry) => {
                                const selected = entry.months === months
                                const pct = savePercent(product, entry.priceCents, entry.months)
                                return (
                                  <button
                                    key={entry.slug}
                                    type="button"
                                    onClick={() => setSelectedMonths((current) => ({ ...current, [product.id]: entry.months }))}
                                    className={cn(
                                      "relative rounded-md border px-3 py-2 text-left transition",
                                      selected
                                        ? "border-amber-300/60 bg-amber-200/12"
                                        : "border-white/10 bg-black/24 hover:border-amber-200/30"
                                    )}
                                  >
                                    <div className="text-xs font-bold text-slate-200">{DURATION_LABEL[entry.months]}</div>
                                    <div className="font-mono text-sm font-semibold text-amber-100">
                                      {formatCurrency(entry.priceCents)}
                                    </div>
                                    {pct > 0 ? (
                                      <span className="absolute right-1.5 top-1.5 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                                        -{pct}%
                                      </span>
                                    ) : null}
                                  </button>
                                )
                              })}
                            </div>

                            <div>
                              <div className="font-mono text-2xl font-semibold text-amber-100">{formatCurrency(tier.priceCents)}</div>
                              <div className="text-xs text-muted-foreground">
                                {DURATION_LABEL[tier.months]} of access · about {formatCurrency(perMonth)}/mo
                              </div>
                            </div>

                            <ul className="grid gap-2 text-sm text-muted-foreground">
                              {product.details.map((detail) => (
                                <li key={detail} className="flex gap-2">
                                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>

                            <Button className="mt-auto w-full" onClick={() => changeQuantity(tier.slug, 1)} type="button">
                              <Plus className="h-4 w-4" />
                              Add to cart
                            </Button>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <Card className="minecraft-panel">
          <CardHeader>
            <div className="rf-kicker">Cosmetic-only shop</div>
            <CardTitle className="display-font flex items-center gap-2 text-3xl">
              <ShoppingCart className="h-5 w-5 text-amber-200" />
              Server Cart
            </CardTitle>
            <CardDescription>Pay safely with card, Apple Pay, Google Pay, or PayPal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-medium">
                Minecraft username
                <Input
                  autoComplete="username"
                  placeholder="Your in-game name"
                  value={minecraftUsername}
                  onChange={(event) => setMinecraftUsername(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Gift recipient
                <Input
                  placeholder="Optional"
                  value={giftRecipient}
                  onChange={(event) => setGiftRecipient(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-3">
              {cartLines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-200/18 bg-black/18 p-5 text-sm text-muted-foreground">
                  Add a supporter rank, cosmetics, particles, pets, lobby perks, or gift cards.
                </div>
              ) : (
                cartLines.map((item) => (
                  <div key={item.slug} className="rounded-lg border border-amber-200/14 bg-black/24 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{item.name}</div>
                        <div className="text-sm text-muted-foreground">{formatCurrency(item.total)}</div>
                      </div>
                      <button
                        aria-label={`Remove ${item.name}`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-amber-200/10 hover:text-amber-100"
                        onClick={() => setCart((current) => current.filter((line) => line.slug !== item.slug))}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        aria-label={`Decrease ${item.name}`}
                        size="icon"
                        variant="outline"
                        onClick={() => changeQuantity(item.slug, -1)}
                        type="button"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center font-mono">{item.quantity}</span>
                      <Button
                        aria-label={`Increase ${item.name}`}
                        size="icon"
                        variant="outline"
                        onClick={() => changeQuantity(item.slug, 1)}
                        type="button"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <strong className="font-mono text-xl text-amber-100">{formatCurrency(total)}</strong>
            </div>

            <div className="grid gap-2">
              <Button disabled={cartLines.length === 0} onClick={() => checkout("stripe")} type="button">
                <CreditCard className="h-4 w-4" />
                Pay with card
              </Button>
              <Button disabled={cartLines.length === 0} onClick={() => checkout("paypal")} type="button" variant="outline">
                <Gift className="h-4 w-4" />
                Pay with PayPal
              </Button>
            </div>

            {checkoutState ? (
              <p className="rounded-md border border-border bg-background/55 p-3 text-sm text-muted-foreground">
                {checkoutState}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
