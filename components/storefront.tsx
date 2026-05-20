"use client"

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

export function Storefront({ products }: { products: StoreProduct[] }) {
  const [category, setCategory] = useState<ProductCategory | "all">("all")
  const [cart, setCart] = useState<CartItem[]>([])
  const [minecraftUsername, setMinecraftUsername] = useState("")
  const [giftRecipient, setGiftRecipient] = useState("")
  const [checkoutState, setCheckoutState] = useState<string | null>(null)

  const filteredProducts = useMemo(
    () => products.filter((product) => category === "all" || product.category === category),
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
    setCheckoutState("Preparing secure checkout...")

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

      setCheckoutState(json.message ?? json.error ?? "Checkout provider is not configured yet.")
    } catch (error) {
      setCheckoutState(error instanceof Error ? error.message : "Checkout failed.")
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {productCategories.map((item) => {
            const Icon = item.icon
            const active = category === item.id

            return (
              <button
                key={item.id}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition",
                  active
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-background/45 text-muted-foreground hover:bg-white/6 hover:text-foreground"
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

        <div className="grid gap-5 md:grid-cols-2">
          {filteredProducts.map((product) => (
            <Card key={product.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Badge variant={product.featured ? "warning" : "default"}>
                      {product.fulfillment === "subscription" ? "Timed" : product.fulfillment}
                    </Badge>
                    <CardTitle className="mt-3">{product.name}</CardTitle>
                  </div>
                  <div className="font-mono text-lg font-semibold text-primary">
                    {formatCurrency(product.priceCents)}
                  </div>
                </div>
                <CardDescription>{product.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm text-muted-foreground">
                  {product.details.map((detail) => (
                    <li key={detail} className="flex gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
                <Button className="mt-5 w-full" onClick={() => updateQuantity(product.id, 1)} type="button">
                  <Plus className="h-4 w-4" />
                  Add to cart
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <Card>
          <CardHeader>
            <Badge variant="success">Cosmetic-only checkout</Badge>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Cart
            </CardTitle>
            <CardDescription>
              Payments run through Stripe or PayPal. RealFiction never stores raw card data.
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
                <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                  Add cosmetics, supporter ranks, particles, pets, lobby perks, or gift cards.
                </div>
              ) : (
                cartLines.map((item) => (
                  <div key={item.product.id} className="rounded-lg border border-border bg-background/45 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{item.product.name}</div>
                        <div className="text-sm text-muted-foreground">{formatCurrency(item.total)}</div>
                      </div>
                      <button
                        aria-label={`Remove ${item.product.name}`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-white/8 hover:text-foreground"
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
              <strong className="font-mono text-xl">{formatCurrency(total)}</strong>
            </div>

            <div className="grid gap-2">
              <Button disabled={cartLines.length === 0} onClick={() => checkout("stripe")} type="button">
                <CreditCard className="h-4 w-4" />
                Stripe checkout
              </Button>
              <Button disabled={cartLines.length === 0} onClick={() => checkout("paypal")} type="button" variant="outline">
                <Gift className="h-4 w-4" />
                PayPal checkout
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
