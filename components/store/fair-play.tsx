import { CheckIcon, WarningIcon } from "@/components/minecraft-icons"
import { FAIR_PLAY } from "@/lib/store/catalog"

/**
 * The Fair Play Promise.
 *
 * Phrased as a RealFiction product commitment, deliberately NOT as a legal or
 * compliance claim — every line is something a player can check against the
 * store rather than an assertion about law.
 */
export function FairPlayPromise() {
  return (
    <section
      aria-labelledby="fair-play-heading"
      className="minecraft-panel rounded-lg p-6 md:p-8"
    >
      <h2 id="fair-play-heading" className="display-font text-3xl text-white md:text-4xl">
        Our Fair Play Promise
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        Everything in this store changes how you look, not how you play. Nothing here
        makes you stronger, faster, or richer than someone who never spends a penny.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/[0.045] p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-200">
            <WarningIcon size={16} aria-hidden />
            We never sell
          </h3>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
            {FAIR_PLAY.never.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-rose-300/70" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.045] p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-emerald-200">
            <CheckIcon size={16} aria-hidden />
            We do sell
          </h3>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
            {FAIR_PLAY.sell.map((line) => (
              <li key={line} className="flex gap-2">
                <CheckIcon size={14} aria-hidden className="mt-1.5 shrink-0 text-emerald-300/80" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
