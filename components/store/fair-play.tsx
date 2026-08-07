import { FAIR_PLAY } from "@/lib/store/catalog"

/**
 * The Fair Play Promise.
 *
 * Phrased as a RealFiction product commitment, deliberately NOT as a legal or
 * compliance claim — every line is something a player can check against the
 * store rather than an assertion about law.
 *
 * WHY THIS IS NOT TWO COLORED COLUMNS ANY MORE
 * =============================================
 * It used to be a red panel headed "We never sell" beside a green panel headed
 * "We do sell" — the shape of a comparison widget, which is the shape of a
 * marketing table. That framing works against the message: a promise read as a
 * sales chart is a promise nobody believes, and color-coded good-versus-bad
 * columns are the single most generated-looking pattern on the site.
 *
 * So it reads as a statement now. One strong claim, then the specifics as a
 * plain list under a quiet heading, with the negative commitments FIRST because
 * those are the ones that cost us money and are therefore the ones worth
 * saying. Color carries no meaning here — the words do — which also removes a
 * color-only distinction a colorblind reader could not see.
 *
 * The policy text itself is unchanged: it comes from FAIR_PLAY in the catalog,
 * and this component only decides how it is presented.
 */
export function FairPlayPromise() {
  return (
    <section aria-labelledby="fair-play-heading" className="border-y border-amber-200/15 py-8 md:py-10">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-12">
        <div>
          <h2
            id="fair-play-heading"
            className="display-font text-2xl leading-tight text-white md:text-3xl"
          >
            Everything here changes
            <br className="hidden md:block" /> how you look.
            <br className="hidden md:block" />{" "}
            <span className="text-amber-100">Never how you play.</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
            Nothing in this store makes you stronger, faster, or richer than someone who never
            spends a penny. That is the whole policy — the rest is detail.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 md:gap-8">
          <div>
            <h3 className="border-b border-white/10 pb-1.5 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              We never sell
            </h3>
            <ul className="mt-3 space-y-2.5">
              {FAIR_PLAY.never.map((line) => (
                <li key={line} className="text-sm leading-6 text-slate-200">
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="border-b border-amber-200/25 pb-1.5 text-xs font-bold uppercase tracking-[0.14em] text-amber-100">
              We do sell
            </h3>
            <ul className="mt-3 space-y-2.5">
              {FAIR_PLAY.sell.map((line) => (
                <li key={line} className="text-sm leading-6 text-slate-200">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
