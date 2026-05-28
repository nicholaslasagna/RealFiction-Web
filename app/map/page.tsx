import type { Metadata } from "next"
import Image from "next/image"

import { MapTabs } from "@/components/map-tabs"
import { Reveal } from "@/components/reveal"

export const metadata: Metadata = {
  title: "Map",
  description: "RealFiction Pl3xMap integrations for map.realfiction.live, map2.realfiction.live, and map.realanarchy.live."
}

export default function MapPage() {
  return (
    <section>
      <div className="relative overflow-hidden border-b border-amber-200/10 py-16 md:py-20">
        <Image
          alt="RealFiction map landscape"
          src="/images/creative.png"
          fill
          priority
          className="-z-20 object-cover opacity-34 blur-[1px]"
          sizes="100vw"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/66 via-background/86 to-background" />
        <div className="container-shell">
          <Reveal className="max-w-4xl">
            <h1 className="display-font text-5xl font-semibold leading-tight md:text-7xl">Explore the Worlds</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
              Jump into the RealFiction and RealAnarchy live maps. Pick a world below and open the
              full interactive map in a new tab.
            </p>
          </Reveal>
        </div>
      </div>
      <div className="container-shell py-10 md:py-14">
        <Reveal>
          <MapTabs />
        </Reveal>
      </div>
    </section>
  )
}
