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
  giftCards,
  productCategories,
  STORE_BANNER_HEIGHT,
  STORE_BANNER_WIDTH,
  storeProducts,
  type ProductCategory
} from "@/lib/data"
import { CATALOG, getProduct, isIncludedIn } from "@/lib/store/catalog"
import {
  ownershipStateFor,
  upgradeErrorMessage,
  UPGRADE_COPY,
  upgradeStateFrom,
  type EntitlementView,
  type UpgradeQuoteView
} from "@/lib/store/ownership-view"
import { cn, formatCurrency } from "@/lib/utils"

/** The one product an upgrade can target today. */
const UPGRADE_TARGET_ID = "real-supporter-permanent"

/**
 * Catalogue entries that are announced but not sold.
 *
 * RealFiction+ is here because RealCore does not enforce its benefits yet.
 * Hiding it entirely would be tidier and less honest — people ask about it — so
 * it gets a card that states plainly what it will be and that it is not on sale.
 * It has no price and no add-to-cart control, and `products.active` is false, so
 * even a hand-crafted request is refused server-side.
 */
const COMING_SOON_PRODUCTS = CATALOG.filter((product) => product.availability === "coming-soon")
  .filter((product) => product.category !== "gift-cards")
  .sort((a, b) => a.sortOrder - b.sortOrder)

const CATEGORY_FOR_CATALOG: Record<string, string> = {
  ranks: "supporter",
  membership: "supporter",
  cosmetics: "cosmetics",
  pets: "pets",
  bundles: "cosmetics",
  "gift-cards": "gift-cards"
}

/**
 * An announced-but-unavailable product.
 *
 * Deliberately NOT a price + disabled button: a greyed-out buy button reads as
 * "temporarily out of stock, try again in a minute". This says what it is, what
 * you would keep, and that it is not for sale, with nothing to click.
 */
function ComingSoonCard({ product }: { product: (typeof CATALOG)[number] }) {
  return (
    <Card className="minecraft-card border-dashed border-white/14">
      <CardContent className="flex flex-col items-start gap-3 py-8">
        <Badge variant="outline">Coming soon</Badge>
        <CardTitle className="display-font text-xl">{product.name}</CardTitle>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {product.features[0]}
        </p>
        {product.retained.length > 0 ? (
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            When it launches it will be a {product.durationDays}-day pass that does not renew
            itself. You would keep {product.retained.join(", ").toLowerCase()} after it ends.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          It is not on sale yet — the in-game benefits are not built, and we would rather say so
          than take your money for something half-finished.
        </p>
      </CardContent>
    </Card>
  )
}

type CartItem = { slug: string; quantity: number }

/** sessionStorage key for the in-progress checkout attempt (UX only). */
const CHECKOUT_ATTEMPT_STORAGE_KEY = "rf.checkoutAttempt"

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
const skuIndex = new Map<
  string,
  { name: string; priceCents: number; consumable: boolean; art: string | null; artWide: boolean }
>()
for (const card of giftCards) {
  skuIndex.set(card.id, {
    name: card.name,
    priceCents: card.priceCents,
    consumable: true,
    art: card.image,
    artWide: false
  })
}
for (const product of storeProducts) {
  skuIndex.set(product.id, {
    name: product.name,
    priceCents: product.priceCents,
    consumable: false,
    art: product.banner,
    artWide: true
  })
}

/**
 * A single payment brand mark.
 *
 * Official brand SVGs on a white pill so they stay legible on the dark cart
 * surface. `alt=""` is deliberate — these are decorative inside a group that
 * already has an accessible label; announcing each brand individually would
 * imply a definitive accepted-methods list, which Stripe does not guarantee.
 */
function PayMark({ src }: { src: string }) {
  return (
    // Pill sized for the WIDEST mark. The wordmarks (Visa 256x83, Apple Pay and
    // Google Pay ~512x210) are far wider than the square ones, so a narrow pill
    // silently squeezes them to ~11-14px tall while Amex/Mastercard stay full
    // size — inconsistent and unreadable. 58px wide with an 18px height cap
    // renders every mark at 15-18px.
    <span className="inline-flex h-9 w-[58px] items-center justify-center rounded bg-white px-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="max-h-[18px] max-w-[46px] w-auto object-contain"
        loading="lazy"
        decoding="async"
      />
    </span>
  )
}

/**
 * Which owned product makes `id` redundant, if any.
 *
 * Display only. The server re-checks entitlements at checkout; this exists so a
 * RealSupporter owner is not invited to buy RealVIP again.
 */
function includedByOwned(id: string, ownedIds: Set<string>): string | null {
  for (const owned of ownedIds) {
    if (isIncludedIn(id, owned)) {
      return getProduct(owned)?.name ?? null
    }
  }
  return null
}

export function Storefront({
  signedIn,
  linkedUsername,
  ownedProductIds = [],
  entitlements = [],
  upgradeQuote = null
}: {
  signedIn: boolean
  linkedUsername: string | null
  /** Authoritative, server-resolved. Never derived in the browser. */
  ownedProductIds?: string[]
  /** Real expiry dates and provenance, server-resolved. */
  entitlements?: EntitlementView[]
  /** The server's upgrade quote. Every figure shown comes from here. */
  upgradeQuote?: UpgradeQuoteView | null
}) {
  const ownedIds = useMemo(() => new Set(ownedProductIds), [ownedProductIds])
  const upgradeState = useMemo(() => upgradeStateFrom(upgradeQuote), [upgradeQuote])
  const [upgradeBusy, setUpgradeBusy] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const upgradeAttemptIdRef = useRef<string | null>(null)
  const [category, setCategory] = useState<ProductCategory | "all">("all")
  const [cart, setCart] = useState<CartItem[]>([])
  const [isGift, setIsGift] = useState(false)
  const [giftRecipient, setGiftRecipient] = useState("")
  const [applyCredit, setApplyCredit] = useState(false)
  const [storeCreditCents, setStoreCreditCents] = useState(0)
  const [checkoutState, setCheckoutState] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  // Identity of the CURRENT checkout intent. Cleared whenever the cart changes,
  // so a different cart can never reuse a previous attempt id.
  const checkoutAttemptIdRef = useRef<string | null>(null)
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
          id: c.id,
          products: c.id === "gift-cards" ? [] : storeProducts.filter((p) => p.category === c.id),
          // Catalogue entries that exist but are NOT on sale. They are shown
          // because saying "coming soon" is more honest than pretending the
          // product does not exist — but they carry no price, no quantity, and
          // no purchase action of any kind.
          comingSoon:
            c.id === "gift-cards"
              ? []
              : COMING_SOON_PRODUCTS.filter((p) => CATEGORY_FOR_CATALOG[p.category] === c.id),
          // Deliberately empty: gift cards render as a single coming-soon
          // panel, never as purchasable cards.
          cards: []
        }))
        .filter((s) => s.products.length > 0 || s.comingSoon.length > 0 || s.id === "gift-cards"),
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
        consumable: info.consumable,
        art: info.art,
        artWide: info.artWide
      }
    })
    .filter(Boolean) as Array<{
    slug: string
    name: string
    quantity: number
    total: number
    consumable: boolean
    art: string | null
    artWide: boolean
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
  // An empty cart, or one whose total is zero, can never start a checkout.
  // The server enforces this too — this only keeps the button honest.
  const hasPayableCart = cartLines.length > 0 && total > 0
  const canCheckout = signedIn && hasPayableCart && deliveryReady

  // Client-side view of the cart, used only to key the persisted attempt id.
  // The server recomputes its own canonical fingerprint and is authoritative.
  const clientCartKey = useMemo(
    () =>
      JSON.stringify({
        items: [...cart].map((item) => `${item.slug}x${item.quantity}`).sort(),
        applyCredit,
        isGift,
        giftRecipient: isGift ? giftRecipient.trim().toLowerCase() : ""
      }),
    [cart, applyCredit, isGift, giftRecipient]
  )

  // Persist the active attempt id for THIS cart so a same-tab refresh resumes
  // the same checkout instead of starting a second one. Purely a UX aid — the
  // database active-cart lock is the real guarantee. Contains no personal data
  // and no secrets: a random UUID plus a hash-free cart shape.
  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    try {
      const stored = window.sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
      const parsed = stored ? (JSON.parse(stored) as { cartKey?: string; attemptId?: string }) : null
      // Only restore when it belongs to the cart currently on screen.
      checkoutAttemptIdRef.current =
        parsed && parsed.cartKey === clientCartKey && typeof parsed.attemptId === "string"
          ? parsed.attemptId
          : null
      if (!checkoutAttemptIdRef.current) {
        window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
      }
    } catch {
      // Storage unavailable (private mode/quota) — fall back to in-memory only.
      checkoutAttemptIdRef.current = null
    }
  }, [clientCartKey])

  function clearCheckoutAttempt() {
    checkoutAttemptIdRef.current = null
    try {
      window.sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)
    } catch {
      // ignore
    }
  }

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

  /**
   * The upgrade checkout.
   *
   * Sends a REQUEST, never an amount: `requestUpgrade: true` plus the target
   * slug and quantity 1. The server recomputes eligibility and the price from
   * entitlements and settled orders, so a client that tampers with anything here
   * gets refused, not discounted.
   *
   * There is deliberately no fallback. If eligibility changed between page load
   * and click, this shows an error — it never quietly becomes a $34.99 checkout.
   */
  async function startUpgrade() {
    if (upgradeBusy) {
      return
    }
    setUpgradeError(null)
    setUpgradeBusy(true)

    // Same attempt-identity rule as the cart: one id per intent, reused across
    // retries, so a double-click cannot produce two payable sessions.
    if (!upgradeAttemptIdRef.current) {
      upgradeAttemptIdRef.current = crypto.randomUUID()
    }

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
          checkoutAttemptId: upgradeAttemptIdRef.current,
          requestUpgrade: true,
          isGift: false,
          applyStoreCredit: false,
          items: [{ productId: UPGRADE_TARGET_ID, quantity: 1 }]
        })
      })

      const json = (await response.json()) as {
        checkoutUrl?: string | null
        completed?: boolean
        code?: string
        message?: string
        error?: string
      }

      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl
        return
      }
      if (json.completed) {
        window.location.href = "/account?checkout=success"
        return
      }

      // A terminal attempt can never succeed again; drop the id so a retry is a
      // genuinely new intent.
      if (response.status === 409) {
        upgradeAttemptIdRef.current = null
      }
      setUpgradeError(upgradeErrorMessage(json.code, json.message ?? json.error))
      setUpgradeBusy(false)
    } catch {
      // Network failure: KEEP the attempt id so retrying resumes this intent.
      setUpgradeError(upgradeErrorMessage("checkout_failed"))
      setUpgradeBusy(false)
    }
  }

  async function checkout(provider: "stripe") {
    // Guard against double submission: a second click while the first request is
    // in flight would create a second checkout attempt. The server also collapses
    // duplicate attempts onto one order, but the button must not invite it.
    if (checkoutBusy) {
      return
    }

    // One cryptographically random id per checkout intent, REUSED for every
    // retry of that intent (that is why it is a ref, not a fresh value per
    // call). The server binds it to this account + cart, and a unique DB
    // constraint turns any number of retries or duplicate tabs into exactly one
    // order — and therefore one payable Stripe session.
    if (!checkoutAttemptIdRef.current) {
      checkoutAttemptIdRef.current = crypto.randomUUID()
    }
    const checkoutAttemptId = checkoutAttemptIdRef.current
    try {
      window.sessionStorage.setItem(
        CHECKOUT_ATTEMPT_STORAGE_KEY,
        JSON.stringify({ cartKey: clientCartKey, attemptId: checkoutAttemptId })
      )
    } catch {
      // Storage unavailable — the DB lock still prevents a second checkout.
    }

    setCheckoutBusy(true)
    setCheckoutState("Getting your payment ready...")

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          checkoutAttemptId,
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
        clearCheckoutAttempt()
        window.location.href = "/account?checkout=success"
        return
      }
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl
        return
      }
      // A terminal/mismatched/expired attempt (409) can never succeed again —
      // drop it (memory + storage) so the next click starts a new intent.
      if (response.status === 409) {
        clearCheckoutAttempt()
      }
      setCheckoutState(json.message ?? json.error ?? "This payment option is not ready yet.")
      setCheckoutBusy(false)
    } catch (error) {
      // Network failure: keep the SAME attempt id. Retrying must resume this
      // intent, not create a second order.
      setCheckoutState(error instanceof Error ? error.message : "Checkout failed.")
      setCheckoutBusy(false)
    }
    // Note: on the success paths above we intentionally leave the button
    // disabled — the page is navigating away to Stripe/account.
  }

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0 space-y-6">
        {/* Horizontal scroll is right on a phone and wrong on a desktop: with the
            cart occupying 390px the filter row was 986px of content in a 790px
            column, so two filters sat permanently off-screen behind the cart.
            Wraps from `sm` up; still swipes below it. */}
        <div className="-mx-4 flex max-w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-2 sm:flex-wrap sm:overflow-x-visible">
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
                  <Card className="minecraft-card">
                    <CardContent className="flex flex-col items-start gap-3 py-8">
                      <Badge variant="outline">Coming soon</Badge>
                      <CardTitle className="display-font text-xl">Gift cards</CardTitle>
                      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
                        We&apos;re building gift cards properly — secure one-time claim
                        links, partial balances, and refunds that actually work. They
                        aren&apos;t on sale yet, and we&apos;d rather say so than take your
                        money for something half-finished.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Want to gift something today? Every rank and cosmetic can be sent
                        to another player — tick <span className="text-slate-200">Send as a gift</span> in
                        the cart.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    {section.products.map((product) => {
                      const theme = accentThemes[product.accent] ?? accentThemes.amber
                      const owned = ownedIds.has(product.id)
                      const includedByName = includedByOwned(product.id, ownedIds)
                      const includedByProduct = includedByName
                        ? { productId: "", name: includedByName }
                        : null
                      const ownership = ownershipStateFor(product.id, entitlements, {
                        // The catalogue sells every rank permanently now; a dated
                        // grant therefore means legacy timed access, which must
                        // not read the same as an outright purchase.
                        isPermanentProduct: product.durationDays === null,
                        includedByOwned: includedByProduct
                      })
                      // A signed-out visitor has no entitlements at all, so the
                      // legacy ownedIds set stays the fallback.
                      const effectiveOwned =
                        ownership.kind === "owned_permanent" || ownership.kind === "included" || owned
                      const cardLocked = effectiveOwned || Boolean(includedByName)
                      const isUpgradeTarget = product.id === UPGRADE_TARGET_ID

                      return (
                        <Card key={product.id} className="minecraft-card flex flex-col overflow-hidden">
                          {/* Same artwork as the Stripe catalog entry, so the
                              storefront and the Stripe checkout page read as one
                              product. */}
                          {product.banner ? (
                            <div className="relative overflow-hidden border-b border-white/10">
                              <Image
                                alt=""
                                aria-hidden
                                src={product.banner}
                                width={STORE_BANNER_WIDTH}
                                height={STORE_BANNER_HEIGHT}
                                className="h-auto w-full"
                              />
                              {product.badge ? (
                                <Badge variant="warning" className="absolute left-3 top-3">
                                  {product.badge}
                                </Badge>
                              ) : null}
                            </div>
                          ) : (
                            <div className={cn("border-b border-white/10 px-4 py-5", theme.surface)}>
                              {product.badge ? <Badge variant="warning">{product.badge}</Badge> : null}
                            </div>
                          )}
                          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
                            <CardTitle className="display-font text-xl">{product.name}</CardTitle>
                            <p className="text-sm leading-6 text-muted-foreground">{product.summary}</p>

                            <div>
                              <div className="font-mono text-2xl font-semibold text-amber-100">
                                {formatCurrency(product.priceCents)}
                              </div>
                              {/* Every card states its billing shape. A fixed
                                  term must never look like a subscription. */}
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                {product.disclosure.map((line) => (
                                  <span key={line}>{line}</span>
                                ))}
                              </div>
                              {product.durationDays ? (
                                <div className="text-xs text-muted-foreground">
                                  {product.durationDays} days of access
                                </div>
                              ) : null}
                            </div>

                            <ul className="grid gap-2 text-sm text-muted-foreground">
                              {product.details.map((detail) => (
                                <li key={detail} className="flex gap-2">
                                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>

                            {/* Term products must say what survives expiry and
                                what does not — no vague "benefits end". */}
                            {product.expires.length > 0 ? (
                              <div className="rounded-md border border-white/10 bg-black/24 p-3 text-xs leading-5">
                                <div className="font-semibold text-emerald-200">You keep after it ends</div>
                                <div className="text-muted-foreground">{product.retained.join(" · ")}</div>
                                <div className="mt-2 font-semibold text-amber-200">Ends with the pass</div>
                                <div className="text-muted-foreground">{product.expires.join(" · ")}</div>
                              </div>
                            ) : null}

                            {ownership.kind !== "none" ? (
                              <Badge
                                variant={
                                  ownership.kind === "owned_permanent"
                                    ? "success"
                                    : ownership.kind === "legacy_term"
                                      ? "warning"
                                      : "outline"
                                }
                                className="w-fit"
                              >
                                {ownership.label}
                              </Badge>
                            ) : null}

                            {/* The upgrade offer. Shown ONLY on the target card,
                                only when the server said this account is
                                eligible, and always with the server's own
                                figures. */}
                            {isUpgradeTarget && upgradeState.kind === "available" ? (
                              <div className="mt-auto space-y-3">
                                <dl
                                  className="space-y-1 rounded-md border border-emerald-300/25 bg-emerald-300/[0.06] p-3 text-sm"
                                  aria-label="Your upgrade price"
                                >
                                  <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-muted-foreground">RealSupporter permanent rank</dt>
                                    <dd className="tabular-nums">{formatCurrency(upgradeState.targetPriceCents)}</dd>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-muted-foreground">Your RealVIP upgrade credit</dt>
                                    <dd className="tabular-nums text-emerald-200">
                                      -{formatCurrency(upgradeState.creditCents)}
                                    </dd>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-1.5 font-semibold text-amber-100">
                                    <dt>Upgrade today</dt>
                                    <dd className="tabular-nums">{formatCurrency(upgradeState.upgradePriceCents)}</dd>
                                  </div>
                                </dl>
                                <Button
                                  className="h-auto w-full whitespace-normal py-3 leading-tight"
                                  disabled={upgradeBusy}
                                  onClick={startUpgrade}
                                  type="button"
                                  aria-describedby={upgradeError ? "upgrade-error" : undefined}
                                >
                                  {upgradeBusy ? "Getting your upgrade ready..." : "Upgrade to RealSupporter"}
                                </Button>
                                {upgradeError ? (
                                  <p
                                    id="upgrade-error"
                                    role="alert"
                                    className="text-sm leading-6 text-rose-200"
                                  >
                                    {upgradeError}
                                  </p>
                                ) : null}
                                <p className="text-xs leading-5 text-muted-foreground">
                                  Upgrades apply to your own account and cannot be gifted. Prefer to buy
                                  RealSupporter at the full price? Add it to the cart below.
                                </p>
                              </div>
                            ) : null}

                            {isUpgradeTarget &&
                            upgradeState.kind !== "available" &&
                            upgradeState.kind !== "none" &&
                            UPGRADE_COPY[upgradeState.kind] ? (
                              <p className="rounded-md border border-white/10 bg-black/24 p-3 text-xs leading-5 text-muted-foreground">
                                {UPGRADE_COPY[upgradeState.kind]}
                              </p>
                            ) : null}

                            {/* An owned product gets NO purchase control at all.
                                A greyed-out "Add to cart" is a control that
                                looks temporarily broken; the badge above already
                                says what is true, and removing the button also
                                removes a disabled tab stop and a 253px label
                                that overflowed its 238px box at 320px wide. */}
                            {cardLocked ? (
                              <div className="mt-auto" />
                            ) : (
                              <Button
                                className="mt-auto h-auto w-full whitespace-normal py-3 leading-tight"
                                onClick={() => addToCart(product.id)}
                                type="button"
                                variant={
                                  isUpgradeTarget && upgradeState.kind === "available" ? "outline" : "default"
                                }
                              >
                                <Plus className="h-4 w-4" />
                                {isUpgradeTarget && upgradeState.kind === "available"
                                  ? "Buy at full price instead"
                                  : "Add to cart"}
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}

                {section.comingSoon.map((product) => (
                  <ComingSoonCard key={product.id} product={product} />
                ))}
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
            <CardDescription>Secure payment methods available through Stripe Checkout.</CardDescription>
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
                      <div className="flex min-w-0 items-start gap-3">
                        {/* Same artwork as the product card and Stripe checkout.
                            Some products (RealFiction+) ship no banner. */}
                        {item.art ? (
                        <Image
                          alt=""
                          aria-hidden
                          src={item.art}
                          width={item.artWide ? STORE_BANNER_WIDTH : 384}
                          height={item.artWide ? STORE_BANNER_HEIGHT : 606}
                          className={cn(
                            "shrink-0 rounded border border-white/10 object-cover",
                            item.artWide ? "h-9 w-[74px]" : "h-12 w-8"
                          )}
                        />
                        ) : null}
                        <div className="min-w-0">
                          <div className="font-semibold">{item.name}</div>
                          <div className="text-sm text-muted-foreground">{formatCurrency(item.total)}</div>
                        </div>
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
                  aria-label="Secure checkout through Stripe"
                  disabled={!canCheckout || checkoutBusy}
                  onClick={() => checkout("stripe")}
                  type="button"
                >
                  <span>
                    {checkoutBusy ? "Starting checkout…" : creditToApply > 0 ? "Pay the rest" : "Checkout"}
                  </span>
                </Button>
                {/* Representative marks, not an accepted-methods list. Stripe
                    Checkout decides what each buyer is actually offered, so the
                    row is labelled as examples and always sits next to the
                    "shown at checkout" copy. PayPal is deliberately absent. */}
                <div className="space-y-2 text-center">
                  <p className="text-xs font-medium text-slate-200">Secure checkout through Stripe</p>
                  <div
                    role="img"
                    aria-label="Example payment methods including Visa, Mastercard, American Express, Apple Pay and Google Pay. The methods available to you are shown at checkout."
                    className="flex flex-wrap items-center justify-center gap-1.5"
                  >
                    <PayMark src="/images/payments/visa.svg" />
                    <PayMark src="/images/payments/mastercard.svg" />
                    <PayMark src="/images/payments/amex.svg" />
                    <PayMark src="/images/payments/apple-pay.svg" />
                    <PayMark src="/images/payments/google-pay.svg" />
                    <span
                      aria-hidden
                      className="inline-flex h-9 items-center rounded border border-white/15 px-2 text-[11px] font-medium text-muted-foreground"
                    >
                      + more
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Eligible payment methods are shown at checkout based on your location, device,
                    currency, and purchase amount.
                  </p>
                </div>
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
              <span className="font-semibold text-slate-200">Stripe</span>. RealFiction never
              stores your card details.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
