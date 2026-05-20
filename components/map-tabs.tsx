"use client"

import { ExternalLink } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { mapEndpoints } from "@/lib/data"
import { cn } from "@/lib/utils"

export function MapTabs() {
  const [active, setActive] = useState(mapEndpoints[0])

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {mapEndpoints.map((map) => {
          const Icon = map.icon

          return (
            <button
              key={map.url}
              className={cn(
                "inline-flex h-12 shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition",
                active.url === map.url
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-background/45 text-muted-foreground hover:bg-white/6 hover:text-foreground"
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

      <div className="overflow-hidden rounded-lg border border-border bg-black/30">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{active.name}</h2>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </div>
          <Button variant="outline" asChild>
            <a href={active.url} rel="noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              Open map
            </a>
          </Button>
        </div>
        <iframe
          className="h-[620px] w-full bg-background"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={active.url}
          title={active.name}
        />
      </div>
    </div>
  )
}
