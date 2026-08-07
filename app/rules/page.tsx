import type { Metadata } from "next"
import { Reveal } from "@/components/reveal"
import { RulesExplorer } from "@/components/rules-explorer"

export const metadata: Metadata = {
  title: "Rules",
  description: "RealFiction community rules — respect, chat conduct, fair play, anti-cheat, gameplay, and account safety — all searchable."
}

export default function RulesPage() {
  return (
    <section className="container-shell py-10 md:py-14">
      {/* One tight header. The old page also carried a line about being "ready
          for admin-managed rule updates", which described our roadmap to a
          player who came here to read the rules. */}
      <Reveal className="border-b border-amber-200/15 pb-6">
        <h1 className="display-font text-4xl font-semibold leading-tight md:text-5xl">Rules</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          How we keep RealFiction fair and welcoming. These apply everywhere on the network.
        </p>
      </Reveal>
      <Reveal className="mt-8">
        <RulesExplorer />
      </Reveal>
    </section>
  )
}
