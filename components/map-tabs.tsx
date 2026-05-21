"use client"

import { ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { mapEndpoints } from "@/lib/data"
import { cn } from "@/lib/utils"

export function MapTabs() {
  const [active, setActive] = useState(mapEndpoints[0])
  const [status, setStatus] = useState<"loading" | "loaded" | "blocked">("loading")

  useEffect(() => {
    setStatus("loading")

    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loaded" ? current : "blocked"))
    }, 7000)

    return () => window.clearTimeout(timer)
  }, [active.url])

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
                  ? "border-amber-200/45 bg-amber-200/14 text-amber-100"
                  : "border-amber-200/14 bg-black/24 text-muted-foreground hover:bg-amber-200/8 hover:text-amber-100"
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
        <div className="flex flex-col gap-3 border-b border-amber-200/12 p-4 md:flex-row md:items-center md:justify-between">
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

        <div className="relative">
          <iframe
            key={active.url}
            className="h-[620px] w-full bg-background"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={active.url}
            title={active.name}
            onLoad={() => setStatus("loaded")}
          />

          {status === "blocked" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#06101c]/92 p-6 text-center backdrop-blur-sm">
              <p className="display-font text-xl font-semibold text-white">This map opens best in its own tab</p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {active.name} can take a moment to load, and some map hosts block embedding. Open it
                directly for the full live view.
              </p>
              <Button asChild size="lg">
                <a href={active.url} rel="noreferrer" target="_blank">
                  <ExternalLink className="h-4 w-4" />
                  Open {active.name}
                </a>
              </Button>
            </div>
          ) : null}
        </div>

        <div className="border-t border-amber-200/12 px-4 py-3 text-center text-sm text-muted-foreground">
          Map not loading?{" "}
          <a
            href={active.url}
            rel="noreferrer"
            target="_blank"
            className="font-semibold text-amber-100 hover:underline"
          >
            Open {active.name} in a new tab
          </a>
        </div>
      </div>
    </div>
  )
}
