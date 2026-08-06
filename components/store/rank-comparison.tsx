import { CheckIcon } from "@/components/minecraft-icons"
import { Badge } from "@/components/ui/badge"
import { BILLING_DISCLOSURE, getProduct } from "@/lib/store/catalog"
import { formatCurrency } from "@/lib/utils"

type Row = {
  label: string
  /** Per column: true = included, false = not, string = a qualified answer. */
  values: [boolean | string, boolean | string, boolean | string]
}

const ROWS: Row[] = [
  { label: "Chat prefix", values: ["[VIP]", "[SUPPORTER]", false] },
  { label: "Profile badge", values: [true, true, "Animated, while active"] },
  { label: "Username colours", values: ["8", "24", false] },
  { label: "Cosmetic loadout slots", values: ["3", "8", "+4 while active"] },
  { label: "Lobby flight", values: [false, "Permanent", "While active"] },
  { label: "Pets included", values: [false, "3 permanent", "Vault rotation"] },
  { label: "Particle effects", values: [false, "4 permanent", "Vault rotation"] },
  { label: "Monthly collectible", values: [false, false, "Yours to keep"] },
  { label: "Vote on next cosmetic theme", values: [false, false, true] },
  { label: "Discord member role", values: [false, false, "While active"] },
  { label: "Competitive advantage", values: ["None", "None", "None"] }
]

function Cell({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <>
        <CheckIcon size={16} aria-hidden className="mx-auto text-emerald-300" />
        <span className="sr-only">Included</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden className="text-muted-foreground/50">
          —
        </span>
        <span className="sr-only">Not included</span>
      </>
    )
  }
  return <span className="text-sm text-slate-200">{value}</span>
}

/**
 * Rank and membership comparison.
 *
 * Renders as a real <table> so screen readers announce row/column headers, and
 * scrolls horizontally on small screens rather than reflowing into an unreadable
 * squeeze. Prices come from the catalog, not from hardcoded copy.
 */
export function RankComparison() {
  const vip = getProduct("realvip-permanent")!
  const supporter = getProduct("real-supporter-permanent")!
  const plus = getProduct("realfiction-plus-30d")!
  const columns = [vip, supporter, plus]

  return (
    <section aria-labelledby="comparison-heading" className="minecraft-panel rounded-lg p-6 md:p-8">
      <h2 id="comparison-heading" className="display-font text-3xl text-white md:text-4xl">
        Compare
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Ranks are bought once and never expire. RealFiction+ is a 30-day pass that does
        not renew itself — you keep that month&apos;s collectible either way.
      </p>

      {/* Wide content scrolls inside its own container; the page never scrolls
          sideways on mobile. */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <caption className="sr-only">
            Comparison of RealVIP, RealSupporter and RealFiction+ benefits, prices and
            billing behaviour
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[34%] pb-4 align-bottom text-sm text-muted-foreground">
                Benefit
              </th>
              {columns.map((product) => (
                <th key={product.id} scope="col" className="pb-4 text-center align-bottom">
                  <div className="display-font text-lg text-white">{product.name}</div>
                  <div className="font-mono text-base font-semibold text-amber-100">
                    {formatCurrency(product.priceCents)}
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {BILLING_DISCLOSURE[product.billing].join(" · ")}
                  </div>
                  {product.badge ? (
                    <Badge variant="warning" className="mt-2">
                      {product.badge}
                    </Badge>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-white/10">
                <th scope="row" className="py-3 pr-3 text-sm font-normal text-muted-foreground">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td key={columns[index].id} className="py-3 text-center">
                    <Cell value={value} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-white/10">
              <th scope="row" className="py-3 pr-3 text-sm font-normal text-muted-foreground">
                What happens when it ends
              </th>
              <td className="py-3 text-center text-sm text-slate-200">Never ends</td>
              <td className="py-3 text-center text-sm text-slate-200">Never ends</td>
              <td className="py-3 text-center text-sm text-slate-200">
                Keep the collectible; vault access and the frame stop
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        RealSupporter includes everything in RealVIP. If you already own RealVIP, the
        store shows your upgrade price — what you paid for RealVIP comes off the total.
      </p>
    </section>
  )
}
