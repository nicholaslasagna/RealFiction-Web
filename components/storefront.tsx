"use client"

import Image from "next/image"
import Link from "next/link"
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react"

import { CheckIcon } from "@/components/minecraft-icons"
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
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0 space-y-6">
        <div className="-mx-4 flex max-w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-2">
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
                  <div className="grid gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
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
                          <div className="flex flex-wrap items-center justify-between gap-2">
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

                            <div className="grid gap-2 min-[430px]:grid-cols-2">
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
                                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
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

      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <Card className="minecraft-panel">
          <CardHeader>
            <CardTitle className="display-font flex items-center gap-2 text-3xl">
              <ShoppingCart className="h-5 w-5 text-amber-200" />
              Server Cart
            </CardTitle>
            <CardDescription>Pay with Card, Apple Pay, Google Pay, or PayPal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-medium">
                Your Minecraft username
                <Input
                  autoComplete="username"
                  placeholder="Your in-game name"
                  value={minecraftUsername}
                  onChange={(event) => setMinecraftUsername(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  This is where rewards get delivered.
                </span>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Send as a gift?{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
                <Input
                  placeholder="Their Minecraft username"
                  value={giftRecipient}
                  onChange={(event) => setGiftRecipient(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Leave blank to deliver to your own account.
                </span>
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
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        aria-label={`Decrease ${item.name}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-amber-200/30 bg-black/40 text-amber-100 transition hover:border-amber-200/60 hover:bg-amber-200/10 disabled:opacity-40"
                        onClick={() => changeQuantity(item.slug, -1)}
                        type="button"
                      >
                        <Minus className="h-4 w-4" aria-hidden />
                      </button>
                      <span className="min-w-[1.5rem] text-center font-mono text-base font-semibold text-slate-100">
                        {item.quantity}
                      </span>
                      <button
                        aria-label={`Increase ${item.name}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-amber-200/30 bg-black/40 text-amber-100 transition hover:border-amber-200/60 hover:bg-amber-200/10 disabled:opacity-40"
                        onClick={() => changeQuantity(item.slug, 1)}
                        type="button"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
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
              <Button
                disabled={cartLines.length === 0}
                onClick={() => checkout("stripe")}
                type="button"
              >
                <CardWalletGlyph />
                Checkout
              </Button>
              <Button
                disabled={cartLines.length === 0}
                onClick={() => checkout("paypal")}
                type="button"
                variant="outline"
              >
                <PayPalLogo height={16} />
                Pay with PayPal
              </Button>
            </div>

            {checkoutState ? (
              <p
                className="rounded-md border border-border bg-background/55 p-3 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {checkoutState}
              </p>
            ) : null}

            {/* Trust + brand row: shows accepted payment methods using
                clean inline marks so visitors recognize the brands. */}
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                We accept
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <PaymentBadge label="Visa"><VisaLogo /></PaymentBadge>
                <PaymentBadge label="Mastercard"><MastercardLogo /></PaymentBadge>
                <PaymentBadge label="American Express"><AmexLogo /></PaymentBadge>
                <PaymentBadge label="Apple Pay"><ApplePayLogo /></PaymentBadge>
                <PaymentBadge label="Google Pay"><GooglePayLogo /></PaymentBadge>
                <PaymentBadge label="PayPal"><PayPalLogo height={14} /></PaymentBadge>
              </div>
            </div>

            {/* Legal + processor disclosure — kept short, honest, and
                linked out for the full rules so we cover what's required
                for an online store while staying readable. */}
            <p className="text-[11px] leading-5 text-muted-foreground">
              Cosmetic items only — no gameplay advantages. By placing an order you agree to
              our{" "}
              <Link href="/terms" className="text-amber-200 underline-offset-2 hover:underline">
                Terms &amp; Refund Policy
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-amber-200 underline-offset-2 hover:underline">
                Privacy Policy
              </Link>
              . Prices in USD. Payments are securely processed by{" "}
              <span className="font-semibold text-slate-200">Stripe</span> (Card / Apple Pay /
              Google Pay) and <span className="font-semibold text-slate-200">PayPal</span>.
              RealFiction never stores your card details.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

/* ============================================================
   Payment brand marks — minimal inline SVGs.

   Goals:
   - Show real brand identity (so customers trust the checkout)
   - Stay small (these render inline at ~14-16px tall)
   - Not pull in any tracking from third-party CDNs
   - Match each brand's actual look closely enough to be recognizable
     without redrawing the protected wordmark from scratch
   ============================================================ */

function PaymentBadge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-flex h-7 items-center justify-center rounded-md border border-white/10 bg-white/95 px-2 text-[#1a1a1a]"
    >
      {children}
    </span>
  )
}

function CardWalletGlyph() {
  // Generic card+wallet glyph used inside the Stripe checkout button.
  // The Stripe-hosted checkout itself will show the actual card / Apple Pay /
  // Google Pay options, so the button just communicates "secure card flow".
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10.5h19" />
      <path d="M6.5 15.5h3" />
    </svg>
  )
}

function VisaLogo() {
  return (
    <svg viewBox="0 0 48 16" height="11" aria-hidden>
      <text
        x="0"
        y="13"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="14"
        fontWeight="900"
        fontStyle="italic"
        fill="#1A1F71"
        letterSpacing="0.5"
      >
        VISA
      </text>
    </svg>
  )
}

function MastercardLogo() {
  return (
    <svg viewBox="0 0 32 20" height="14" aria-hidden>
      <circle cx="12" cy="10" r="7" fill="#EB001B" />
      <circle cx="20" cy="10" r="7" fill="#F79E1B" />
      <path
        d="M16 4.6a7 7 0 0 1 0 10.8 7 7 0 0 1 0-10.8z"
        fill="#FF5F00"
      />
    </svg>
  )
}

function AmexLogo() {
  return (
    <svg viewBox="0 0 40 16" height="11" aria-hidden>
      <rect width="40" height="16" rx="2" fill="#1F72CD" />
      <text
        x="20"
        y="11.5"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="6.5"
        fontWeight="800"
        fill="#fff"
        letterSpacing="0.6"
      >
        AMERICAN EXPRESS
      </text>
    </svg>
  )
}

function ApplePayLogo() {
  return (
    <svg viewBox="0 0 40 16" height="13" aria-hidden>
      {/* Apple mark */}
      <path
        d="M6.6 4.2c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.7.1 1.3-.3 1.7-.8zM7.2 5.1c-.9 0-1.7.5-2.1.5-.4 0-1.1-.5-1.9-.5-1 0-1.9.6-2.4 1.5-1 1.8-.3 4.4.7 5.9.5.7 1.1 1.5 1.9 1.5.8 0 1-.5 1.9-.5.9 0 1.1.5 1.9.5.8 0 1.3-.7 1.8-1.5.6-.8.8-1.6.8-1.7-.1 0-1.5-.6-1.5-2.3 0-1.4 1.1-2 1.2-2.1-.7-1-1.7-1.3-2.3-1.3z"
        fill="#000"
      />
      {/* "Pay" */}
      <text
        x="13"
        y="11.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.2"
        fontWeight="600"
        fill="#000"
      >
        Pay
      </text>
    </svg>
  )
}

function GooglePayLogo() {
  return (
    <svg viewBox="0 0 48 16" height="13" aria-hidden>
      {/* "G" mark approximation */}
      <path
        d="M7.7 8.1v1.6h2.3c-.1.7-.4 1.3-.9 1.7-.5.4-1.2.6-2 .6a2.9 2.9 0 1 1 0-5.8c.8 0 1.5.3 2 .8l1.1-1.1A4.5 4.5 0 0 0 4.5 8c0 2.5 2 4.5 4.5 4.5 1.3 0 2.4-.4 3.1-1.2.8-.8 1.1-1.9 1.1-3 0-.3 0-.5-.1-.7H7.7z"
        fill="#4285F4"
      />
      {/* "Pay" wordmark */}
      <text
        x="15"
        y="11.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.2"
        fontWeight="600"
        fill="#5F6368"
      >
        Pay
      </text>
    </svg>
  )
}

function PayPalLogo({ height = 14 }: { height?: number }) {
  return (
    <svg viewBox="0 0 80 20" height={height} aria-hidden>
      {/* "Pay" in dark blue */}
      <text
        x="0"
        y="15"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="16"
        fontWeight="800"
        fontStyle="italic"
        fill="#003087"
      >
        Pay
      </text>
      {/* "Pal" in lighter blue */}
      <text
        x="30"
        y="15"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="16"
        fontWeight="800"
        fontStyle="italic"
        fill="#009CDE"
      >
        Pal
      </text>
    </svg>
  )
}
