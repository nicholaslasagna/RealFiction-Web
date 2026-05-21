"use client"

import Image from "next/image"
import { CreditCard, Gift, Minus, Plus, ShieldCheck, ShoppingCart, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { productCategories, type ProductCategory, type StoreProduct } from "@/lib/data"
import { formatCurrency, cn } from "@/lib/utils"

type CartItem = {
  productId: string
  quantity: number
}

const accentThemes: Record<string, { gradient: string; icon: string; glow: string }> = {
  cyan: { gradient: "from-cyan-400/25 via-cyan-500/10 to-[#0a1726]", icon: "text-cyan-200", glow: "bg-cyan-400/25" },
  amber: { gradient: "from-amber-400/25 via-amber-500/10 to-[#0a1726]", icon: "text-amber-200", glow: "bg-amber-400/25" },
  emerald: { gradient: "from-emerald-400/25 via-emerald-500/10 to-[#0a1726]", icon: "text-emerald-200", glow: "bg-emerald-400/25" },
  violet: { gradient: "from-violet-400/25 via-violet-500/10 to-[#0a1726]", icon: "text-violet-200", glow: "bg-violet-400/25" },
  rose: { gradient: "from-rose-400/25 via-rose-500/10 to-[#0a1726]", icon: "text-rose-200", glow: "bg-rose-400/25" },
  sky: { gradient: "from-sky-400/25 via-sky-500/10 to-[#0a1726]", icon: "text-sky-200", glow: "bg-sky-400/25" },
  blue: { gradient: "from-blue-400/25 via-blue-500/10 to-[#0a1726]", icon: "text-blue-200", glow: "bg-blue-400/25" }
}

export function Storefront({ products }: { products: StoreProduct[] }) {
  const [category, setCategory] = useState<ProductCategory | "all">("all")
  const [cart, setCart] = useState<CartItem[]>([])
  const [minecraftUsername, setMinecraftUsername] = useState("")
  const [giftRecipient, setGiftRecipient] = useState("")
  const [checkoutState, setCheckoutState] = useState<string | null>(null)

  const sections = useMemo(
    () =>
      productCategories
        .filter((c) => c.id !== "all" && (category === "all" || category === c.id))
        .map((c) => ({ meta: c, items: products.filter((p) => p.category === c.id) }))
        .filter((s) => s.items.length > 0),
    [category, products]
  )

  const cartLines = cart.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)

    if (!product) {
      return null
    }

    return {
      product,
      quantity: item.quantity,
      total: product.priceCents * item.quantity
    }
  }).filter(Boolean) as Array<{ product: StoreProduct; quantity: number; total: number }>

  const total = cartLines.reduce((sum, item) => sum + item.total, 0)

  function updateQuantity(productId: string, delta: number) {
    setCart((current) => {
      const product = products.find((candidate) => candidate.id === productId)
      const maxQuantity = product?.fulfillment === "consumable" ? 25 : 1
      const existing = current.find((item) => item.productId === productId)

      if (!existing) {
        return delta > 0 ? [...current, { productId, quantity: 1 }] : current
      }

      const quantity = existing.quantity + delta

      if (quantity <= 0) {
        return current.filter((item) => item.productId !== productId)
      }

      return current.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.min(quantity, maxQuantity) } : item
      )
    })
  }

  async function checkout(provider: "stripe" | "paypal") {
    setCheckoutState("Getting your payment ready...")

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider,
          minecraftUsername: minecraftUsername || undefined,
          giftRecipient: giftRecipient || undefined,
          items: cart
        })
      })

      const json = (await response.json()) as {
        checkoutUrl?: string | null
        message?: string
        error?: string
      }

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

            return (
              <section key={section.meta.id} className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-md border border-amber-200/20 bg-black/30 p-2">
                    <SectionIcon className="h-4 w-4 text-amber-200" />
                  </span>
                  <h2 className="display-font text-2xl font-semibold">{section.meta.label}</h2>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs text-muted-foreground">
                    {section.items.length}
                  </span>
                </div>

                <div className={cn("grid gap-5", isGiftCards ? "grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
                  {section.items.map((product) => {
                    const theme = accentThemes[product.accent] ?? accentThemes.amber

                    if (isGiftCards) {
                      return (
                        <Card key={product.id} className="minecraft-card flex flex-col overflow-hidden">
                          <div className="flex justify-center bg-black/30 px-3 pt-4">
                            <Image
                              alt={`${product.name} for RealFiction`}
                              src={product.image ?? "/images/giftcard-25.png"}
                              width={384}
                              height={606}
                              className="h-auto w-[80%] max-w-[170px] rounded-lg drop-shadow-[0_16px_36px_rgba(0,0,0,0.55)]"
                            />
                          </div>
                          <CardContent className="flex flex-1 flex-col gap-2 pt-4">
                            <div className="flex items-center justify-between gap-2">
                              <CardTitle className="display-font text-lg">{product.name}</CardTitle>
                              <span className="font-mono text-base font-semibold text-amber-100">
                                {formatCurrency(product.priceCents)}
                              </span>
                            </div>
                            <Button className="mt-auto w-full" onClick={() => updateQuantity(product.id, 1)} type="button">
                              <Plus className="h-4 w-4" />
                              Add to cart
                            </Button>
                          </CardContent>
                        </Card>
                      )
                    }

                    return (
                      <Card key={product.id} className="minecraft-card flex flex-col overflow-hidden">
                        <div
                          className={cn(
                            "relative flex h-28 items-center justify-center overflow-hidden border-b border-white/10 bg-gradient-to-br",
                            theme.gradient
                          )}
                        >
                          <div className={cn("absolute -right-5 -top-6 h-20 w-20 rounded-full blur-2xl", theme.glow)} />
                          <SectionIcon className={cn("relative h-11 w-11 drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]", theme.icon)} />
                          <Badge variant={product.featured ? "warning" : "outline"} className="absolute left-3 top-3">
                            {product.fulfillment === "subscription"
                              ? "Monthly"
                              : product.fulfillment === "consumable"
                                ? "Gift"
                                : "Permanent"}
                          </Badge>
                        </div>
                        <CardContent className="flex flex-1 flex-col gap-3 pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <CardTitle className="display-font text-xl">{product.name}</CardTitle>
                            <span className="font-mono text-lg font-semibold text-amber-100">
                              {formatCurrency(product.priceCents)}
                              {product.fulfillment === "subscription" ? (
                                <span className="text-xs font-normal text-muted-foreground">/mo</span>
                              ) : null}
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">{product.summary}</p>
                          <ul className="grid gap-2 text-sm text-muted-foreground">
                            {product.details.map((detail) => (
                              <li key={detail} className="flex gap-2">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                                <span>{detail}</span>
                              </li>
                            ))}
                          </ul>
                          <Button className="mt-auto w-full" onClick={() => updateQuantity(product.id, 1)} type="button">
                            <Plus className="h-4 w-4" />
                            Add to cart
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <Card className="minecraft-panel">
          <CardHeader>
            <Badge variant="success">Cosmetic-only shop</Badge>
            <CardTitle className="display-font flex items-center gap-2 text-3xl">
              <ShoppingCart className="h-5 w-5 text-amber-200" />
              Server Cart
            </CardTitle>
            <CardDescription>
              Pay safely with card, Apple Pay, Google Pay, or PayPal.
            </CardDescription>
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
                  Add cosmetics, supporter ranks, particles, pets, lobby perks, or gift cards.
                </div>
              ) : (
                cartLines.map((item) => (
                  <div key={item.product.id} className="rounded-lg border border-amber-200/14 bg-black/24 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground">{formatCurrency(item.total)}</div>
                      </div>
                      <button
                        aria-label={`Remove ${item.product.name}`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-amber-200/10 hover:text-amber-100"
                        onClick={() =>
                          setCart((current) => current.filter((line) => line.productId !== item.product.id))
                        }
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        aria-label={`Decrease ${item.product.name}`}
                        size="icon"
                        variant="outline"
                        onClick={() => updateQuantity(item.product.id, -1)}
                        type="button"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-8 text-center font-mono">{item.quantity}</span>
                      <Button
                        aria-label={`Increase ${item.product.name}`}
                        size="icon"
                        variant="outline"
                        onClick={() => updateQuantity(item.product.id, 1)}
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
