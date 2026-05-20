import type { Metadata } from "next"
import { MapPinned } from "lucide-react"

import { MapTabs } from "@/components/map-tabs"
import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "Map",
  description: "RealFiction Pl3xMap integrations for map.realfiction.live, map2.realfiction.live, and map.realanarchy.live."
}

export default function MapPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-4xl">
        <Badge variant="default">
          <MapPinned className="mr-1.5 h-3.5 w-3.5" />
          Pl3xMap integration
        </Badge>
        <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Live Maps</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
          Switch between RealFiction maps, seasonal worlds, and RealAnarchy world surfaces without leaving the platform.
        </p>
      </Reveal>
      <Reveal className="mt-10">
        <MapTabs />
      </Reveal>
    </section>
  )
}
