"use client"

// One product, four durations.
//
// The card has to answer four questions before someone will buy: what is it,
// how long do I get it for, what does that cost per month, and what does it do
// to the access I already have. Everything else is decoration.
//
// The duration control is a real radio group, not a row of buttons: a screen
// reader announces "3 months, 2 of 4", arrow keys move between options, and the
// selected option is programmatically the value that goes into the cart.

import Image from "next/image"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { STORE_BANNER_HEIGHT, STORE_BANNER_WIDTH, type StoreProduct } from "@/lib/data"
import {
  DURATION_LABEL,
  effectiveMonthlyCents,
  savingsPercent,
  type CatalogPrice
} from "@/lib/store/catalog"
import { accessStateFor, projectionSentence, type EntitlementView } from "@/lib/store/access-view"
import { getProduct } from "@/lib/store/catalog"
import { cn, formatCurrency } from "@/lib/utils"

export function ProductCard({
  product,
  selectedSlug,
  onSelect,
  onAdd,
  entitlements,
  signedIn
}: {
  product: StoreProduct
  selectedSlug: string
  onSelect: (slug: string) => void
  onAdd: (slug: string) => void
  entitlements: readonly EntitlementView[]
  signedIn: boolean
}) {
  const catalogProduct = getProduct(product.id)
  const selected = product.prices.find((price) => price.slug === selectedSlug) ?? product.prices[0]
  const access = accessStateFor(product.id, entitlements)
  const currentExpiry = access.kind === "active" ? access.expiresAt : null
  const projection = signedIn
    ? projectionSentence(currentExpiry, selected.months, DURATION_LABEL[selected.months])
    : null

  const groupId = `duration-${product.id}`

  return (
    <Card className="minecraft-card flex flex-col overflow-hidden">
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
        </div>
      ) : null}

      <CardContent className="flex flex-1 flex-col gap-4 pt-4">
        <div>
          <CardTitle className="display-font text-xl">{product.name}</CardTitle>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{product.description}</p>
        </div>

        {/* Access the customer already holds, from the server. */}
        {signedIn && access.kind !== "none" ? (
          <p
            className={cn(
              "text-sm font-semibold",
              access.kind === "active" ? "text-emerald-200" : "text-amber-200"
            )}
          >
            {access.label}
          </p>
        ) : null}

        <fieldset className="min-w-0">
          <legend className="text-[11px] uppercase tracking-[0.16em] text-amber-200/85">
            Choose how long
          </legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label={`${product.name} duration`}>
            {product.prices.map((price) => (
              <DurationOption
                key={price.slug}
                name={groupId}
                product={product}
                price={price}
                checked={price.slug === selected.slug}
                onSelect={onSelect}
              />
            ))}
          </div>
        </fieldset>

        {/* Non-negotiable disclosure, on every card, above the buy button. */}
        <div className="rounded-md border border-white/10 bg-black/24 p-3 text-xs leading-5">
          {product.disclosure.map((line) => (
            <div key={line} className="font-semibold text-slate-200">
              {line}
            </div>
          ))}
          <div className="mt-1 text-muted-foreground">
            Adds {DURATION_LABEL[selected.months]} to your {product.name} access.
          </div>
          {projection ? (
            <p className="mt-2 text-emerald-200" aria-live="polite">
              {projection}
            </p>
          ) : null}
        </div>

        {product.cosmeticOnly ? (
          <p className="text-xs text-muted-foreground">
            Cosmetic only. No gameplay or competitive advantages.
          </p>
        ) : catalogProduct ? (
          <p className="text-xs text-muted-foreground">
            Lobbies, hubs, and event spaces only — never survival, Factions, PvP, or BedWars.
          </p>
        ) : null}

        <Button
          className="mt-auto h-auto w-full whitespace-normal py-3 leading-tight"
          onClick={() => onAdd(selected.slug)}
          type="button"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add {DURATION_LABEL[selected.months]} — {formatCurrency(selected.priceCents)}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * One duration.
 *
 * The monthly rate and the savings figure are both derived from the
 * authoritative prices at render time, so no fixed percentage can quietly become
 * false when a price changes.
 */
function DurationOption({
  name,
  product,
  price,
  checked,
  onSelect
}: {
  name: string
  product: StoreProduct
  price: CatalogPrice
  checked: boolean
  onSelect: (slug: string) => void
}) {
  const catalogProduct = getProduct(product.id)
  const monthly = effectiveMonthlyCents(price)
  const savings = catalogProduct ? savingsPercent(catalogProduct, price) : 0
  const isBestValue = product.bestValueSlug === price.slug

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition",
        checked
          ? "border-amber-200/45 bg-amber-200/12"
          : "border-white/10 bg-black/24 hover:border-amber-200/25"
      )}
    >
      <input
        type="radio"
        name={name}
        value={price.slug}
        checked={checked}
        onChange={() => onSelect(price.slug)}
        className="h-4 w-4 shrink-0 accent-amber-400"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-semibold text-slate-100">{DURATION_LABEL[price.months]}</span>
          <span className="font-mono font-semibold text-amber-100">
            {formatCurrency(price.priceCents)}
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatCurrency(monthly)}/month</span>
          {savings > 0 ? (
            <span className="text-emerald-200">
              {`Save ${savings}% `}
              {/* Says what the comparison IS, so it cannot be read as a discount
                  off some invented "was" price. The trailing space above is
                  inside the template literal on purpose: JSX collapses a literal
                  space before an element, so "Save 13%" and the sr-only text ran
                  together as "Save 13%compared with...". */}
              <span className="sr-only">compared with buying {price.months} separate months</span>
            </span>
          ) : null}
          {isBestValue ? (
            <Badge variant="warning" className="ml-auto">
              Best value
            </Badge>
          ) : null}
        </span>
      </span>
    </label>
  )
}
