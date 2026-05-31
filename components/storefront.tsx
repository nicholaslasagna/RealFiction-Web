"use client"

import Image from "next/image"
import Link from "next/link"
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react"

import { CheckIcon } from "@/components/minecraft-icons"
import { useEffect, useMemo, useRef, useState } from "react"

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

export function Storefront({
  signedIn,
  linkedUsername
}: {
  signedIn: boolean
  linkedUsername: string | null
}) {
  const [category, setCategory] = useState<ProductCategory | "all">("all")
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedMonths, setSelectedMonths] = useState<Record<string, DurationMonths>>({})
  const [isGift, setIsGift] = useState(false)
  const [giftRecipient, setGiftRecipient] = useState("")
  const [applyCredit, setApplyCredit] = useState(false)
  const [storeCreditCents, setStoreCreditCents] = useState(0)
  const [checkoutState, setCheckoutState] = useState<string | null>(null)
  const cartRef = useRef<HTMLElement>(null)

  // Deep link: /store#<category> (e.g. from the homepage perk cards)
  // pre-selects that category filter. Runs on mount and on hash changes.
  useEffect(() => {
    const valid = new Set(productCategories.map((c) => c.id as string))
    function applyHash() {
      const hash = window.location.hash.replace(/^#/, "")
      if (hash && valid.has(hash)) {
        setCategory(hash as ProductCategory | "all")
      }
    }
    applyHash()
    window.addEventListener("hashchange", applyHash)
    return () => window.removeEventListener("hashchange", applyHash)
  }, [])

  // Load the signed-in user's store-credit balance so it can be applied at
  // checkout. The amount actually applied is always recomputed server-side.
  useEffect(() => {
    if (!signedIn) {
      return
    }
    let active = true
    fetch("/api/account/store-credit", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { balanceCents?: number } | null) => {
        if (active && body && typeof body.balanceCents === "number") {
          setStoreCreditCents(Math.max(0, Math.trunc(body.balanceCents)))
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [signedIn])

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
      return {
        slug: item.slug,
        name: info.name,
        quantity: item.quantity,
        total: info.priceCents * item.quantity,
        consumable: info.consumable
      }
    })
    .filter(Boolean) as Array<{
    slug: string
    name: string
    quantity: number
    total: number
    consumable: boolean
  }>

  const total = cartLines.reduce((sum, item) => sum + item.total, 0)

  // Store credit is display-only here; the server recomputes the real amount.
  const creditAvailable = signedIn && storeCreditCents > 0
  const creditToApply = applyCredit && creditAvailable ? Math.min(storeCreditCents, total) : 0
  const dueCents = total - creditToApply
  const fullCredit = creditToApply > 0 && dueCents === 0

  // Checkout eligibility. A normal purchase delivers to the buyer's linked
  // account; a gift delivers to a valid recipient username. The server enforces
  // all of this too — these gates just keep the UI honest.
  const validRecipient = /^[A-Za-z0-9_]{3,16}$/.test(giftRecipient.trim())
  const deliveryReady = isGift ? validRecipient : Boolean(linkedUsername)
  const canCheckout = signedIn && cartLines.length > 0 && deliveryReady

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

  function addToCart(slug: string) {
    changeQuantity(slug, 1)
    // On mobile the cart sits below the whole product list — bring it into view
    // so the item visibly lands and checkout is right there, no long scroll.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => {
        cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    }
  }

  async function checkout(provider: "stripe" | "paypal") {
    setCheckoutState("Getting your payment ready...")

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          isGift,
          applyStoreCredit: applyCredit,
          giftRecipient: isGift ? giftRecipient.trim() || undefined : undefined,
          items: cart.map((item) => ({ productId: item.slug, quantity: item.quantity }))
        })
      })

      const json = (await response.json()) as {
        checkoutUrl?: string | null
        completed?: boolean
        message?: string
        error?: string
      }

      // Fully covered by store credit — the order completed server-side with no
      // payment provider; send the buyer to their account to see it.
      if (json.completed) {
        window.location.href = "/account?checkout=success"
        return
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
                          <Button className="mt-auto w-full" onClick={() => addToCart(card.id)} type="button">
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

                            <Button className="mt-auto w-full" onClick={() => addToCart(tier.slug)} type="button">
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

      <aside
        ref={cartRef}
        className="min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
      >
        <Card className="minecraft-panel">
          <CardHeader>
            <CardTitle className="display-font flex items-center gap-2 text-3xl">
              <ShoppingCart className="h-5 w-5 text-amber-200" />
              Server Cart
            </CardTitle>
            <CardDescription>Pay with Card, Apple Pay, Google Pay, or PayPal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!signedIn ? (
              <div className="rounded-lg border border-amber-200/18 bg-black/24 p-4">
                <div className="text-sm font-semibold text-white">Delivery</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Sign in to checkout and deliver rewards safely.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200/14 bg-black/24 p-4">
                <div className="text-sm font-semibold text-white">{isGift ? "Gift delivery" : "Delivery"}</div>

                {isGift ? (
                  <label className="mt-3 grid gap-2 text-sm font-medium">
                    Their Minecraft username
                    <Input
                      autoComplete="off"
                      placeholder="Recipient Minecraft username"
                      value={giftRecipient}
                      aria-invalid={giftRecipient.trim().length > 0 && !validRecipient}
                      onChange={(event) => setGiftRecipient(event.target.value)}
                    />
                    <span className="text-xs font-normal text-muted-foreground">
                      Enter the Minecraft username that should receive this gift.
                    </span>
                  </label>
                ) : linkedUsername ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Delivering to your linked Minecraft account:{" "}
                    <span className="font-semibold text-emerald-200">{linkedUsername}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Link your Minecraft account before checkout so rewards know where to go.
                  </p>
                )}

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-200">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-amber-400"
                    checked={isGift}
                    onChange={(event) => setIsGift(event.target.checked)}
                  />
                  Send as gift
                </label>
              </div>
            )}

            <div className="grid gap-3">
              {cartLines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-200/18 bg-black/18 p-5 text-sm text-muted-foreground">
                  Add a supporter rank, cosmetics, particles, pets, lobby perks, or gift cards.
                </div>
              ) : (
                cartLines.map((item) => {
                  // Subscriptions / perks are one-per-account (max 1); gift
                  // cards stack up to 25. Mirrors the cap in changeQuantity().
                  const max = item.consumable ? 25 : 1
                  const atMax = item.quantity >= max
                  return (
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
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-amber-200/30 bg-black/40 text-amber-100 transition hover:border-amber-200/60 hover:bg-amber-200/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-amber-200/30 disabled:hover:bg-black/40"
                        onClick={() => changeQuantity(item.slug, 1)}
                        disabled={atMax}
                        title={atMax ? (item.consumable ? "Max 25 per order" : "Only one per account") : undefined}
                        type="button"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    {atMax ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.consumable
                          ? "That's the most you can add to one order (25)."
                          : "Just one of these per account — it's a perk, not a stackable item."}
                      </p>
                    ) : null}
                  </div>
                  )
                })
              )}
            </div>

            {/* Store credit — only when signed in with a positive balance. */}
            {creditAvailable ? (
              <label className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/16 bg-black/16 p-3 text-sm">
                <span className="font-semibold text-white">
                  Apply store credit
                  <span className="ml-2 font-normal text-muted-foreground">
                    {formatCurrency(storeCreditCents)} available
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-amber-300"
                  checked={applyCredit}
                  onChange={(event) => setApplyCredit(event.target.checked)}
                />
              </label>
            ) : null}

            {/* Totals — break down credit when applied, otherwise a plain total. */}
            <div className="space-y-2 border-t border-border pt-4">
              {creditToApply > 0 ? (
                <>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-emerald-200">
                    <span>Store credit</span>
                    <span className="font-mono">-{formatCurrency(creditToApply)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Due today</span>
                    <strong className="font-mono text-xl text-amber-100">{formatCurrency(dueCents)}</strong>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <strong className="font-mono text-xl text-amber-100">{formatCurrency(total)}</strong>
                </div>
              )}
            </div>

            {!signedIn ? (
              <Button asChild className="w-full">
                <Link href="/account">Sign in to checkout</Link>
              </Button>
            ) : !isGift && !linkedUsername ? (
              <Button asChild className="w-full" variant="outline">
                <Link href="/account">Link Minecraft account</Link>
              </Button>
            ) : fullCredit ? (
              <div className="grid gap-2">
                <Button
                  aria-label="Place order with store credit"
                  disabled={!canCheckout}
                  onClick={() => checkout("stripe")}
                  type="button"
                >
                  Place order with store credit
                </Button>
                {isGift && !validRecipient ? (
                  <p className="text-xs text-muted-foreground">
                    Enter the recipient&apos;s Minecraft username to continue.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-2">
                <Button
                  aria-label="Checkout — pay with card, Apple Pay, or Google Pay"
                  className="flex-col"
                  disabled={!canCheckout}
                  onClick={() => checkout("stripe")}
                  type="button"
                >
                  <span>{creditToApply > 0 ? "Pay the rest" : "Checkout"}</span>
                  {/* What Stripe Checkout accepts — card networks + the wallets. */}
                  <span className="flex items-center justify-center gap-1.5">
                    <PayMark src="/images/payments/visa.svg" label="Visa" />
                    <PayMark src="/images/payments/mastercard.svg" label="Mastercard" />
                    <PayMark src="/images/payments/amex.svg" label="American Express" />
                    <PayMark src="/images/payments/apple-pay.svg" label="Apple Pay" />
                    <PayMark src="/images/payments/google-pay.svg" label="Google Pay" />
                  </span>
                </Button>
                <Button
                  aria-label="Pay with PayPal"
                  disabled={!canCheckout}
                  onClick={() => checkout("paypal")}
                  type="button"
                  variant="outline"
                >
                  Pay with
                  <PayMark src="/images/payments/paypal.svg" label="PayPal" />
                </Button>
                {isGift && !validRecipient ? (
                  <p className="text-xs text-muted-foreground">
                    Enter the recipient&apos;s Minecraft username to continue.
                  </p>
                ) : null}
              </div>
            )}

            {checkoutState ? (
              <p
                className="rounded-md border border-border bg-background/55 p-3 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {checkoutState}
              </p>
            ) : null}

            {/* Legal + processor disclosure — kept short, honest, and
                linked out for the full rules so we cover what's required
                for an online store while staying readable. Accepted methods
                are shown on the checkout buttons above. */}
            <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
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
   Payment brand marks.

   The accepted-method marks use the real brand logos (official SVGs in
   /public/images/payments/) inside small white pills so they read clearly
   on the green Checkout button. PayPal keeps its own labelled button.
   ============================================================ */

// Real brand logo on a white pill — uniform height, natural width, so the
// row reads as a tidy strip of recognizable marks.
function PayMark({ src, label }: { src: string; label: string }) {
  return (
    <span className="inline-flex h-[26px] items-center justify-center rounded bg-white px-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="h-[16px] w-auto" loading="lazy" decoding="async" />
    </span>
  )
}

