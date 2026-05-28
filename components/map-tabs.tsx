"use client"

import Image from "next/image"
import { ExternalLink, MapPinned } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { mapEndpoints } from "@/lib/data"
import { cn } from "@/lib/utils"

const mapBackdrops: Record<string, string> = {
  "https://map.realfiction.live": "/images/creative.png",
  "https://map2.realfiction.live": "/images/hero2.png",
  "https://map.realanarchy.live": "/images/bedwars.png"
}

export function MapTabs() {
  const [active, setActive] = useState(mapEndpoints[0])
  const backdrop = mapBackdrops[active.url] ?? "/images/hero1.png"
  const host = active.url.replace(/^https?:\/\//, "")

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {mapEndpoints.map((map) => {
          const Icon = map.icon

          return (
            <button
              key={map.url}
              className={cn(
                "inline-flex h-12 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-bold transition",
                active.url === map.url
                  ? "border-border bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary"
              )}
              onClick={() => setActive(map)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {map.name}
            </button>
          )
        })}
      </div>

      <div className="minecraft-panel overflow-hidden rounded-lg">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="display-font text-2xl font-semibold">{active.name}</h2>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </div>
          <Button variant="outline" asChild>
            <a href={active.url} rel="noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              Open map
            </a>
          </Button>
        </div>

        {active.embeddable ? (
          <iframe
            key={active.url}
            className="h-[620px] w-full bg-background"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={active.url}
            title={active.name}
          />
        ) : (
          <div className="relative">
            <Image alt="" src={backdrop} fill className="object-cover opacity-25" sizes="100vw" />
            <div className="absolute inset-0 bg-gradient-to-b from-background/82 via-background/86 to-background" />

            <div className="relative flex flex-col items-center gap-5 px-6 py-16 text-center md:py-24">
              <span className="rounded-xl border border-border bg-secondary p-3.5 shadow-lg">
                <MapPinned className="h-7 w-7 text-primary" />
              </span>
              <div>
                <h3 className="display-font text-2xl font-semibold text-foreground">Opens in a new tab</h3>
                <p className="mx-auto mt-2.5 max-w-md text-sm leading-6 text-muted-foreground">
                  This map can&rsquo;t be embedded here yet, but the full live view works in a new tab.
                </p>
              </div>
              <Button asChild size="lg">
                <a href={active.url} rel="noreferrer" target="_blank">
                  <ExternalLink className="h-4 w-4" />
                  Open Live Map
                </a>
              </Button>
              <p className="font-mono text-xs text-muted-foreground">{host}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
