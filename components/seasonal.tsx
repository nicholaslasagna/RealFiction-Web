"use client"

import { useEffect, useState } from "react"

import { ChristmasScene } from "@/components/christmas-scene"
import { FallingParticles } from "@/components/falling-particles"
import { Fireworks } from "@/components/fireworks"
import { HalloweenHaunt } from "@/components/halloween-haunt"
import { HanukkahScene } from "@/components/hanukkah-scene"
import { HOLIDAYS, type Holiday } from "@/lib/holidays"

/** Builds an evenly-segmented horizontal gradient from N stripe colors. */
function stripeGradient(colors: string[]): string {
  if (colors.length < 2) return colors[0] ?? "transparent"
  const seg = 100 / colors.length
  const stops = colors
    .map((color, index) => `${color} ${(index * seg).toFixed(3)}% ${((index + 1) * seg).toFixed(3)}%`)
    .join(", ")
  return `linear-gradient(90deg, ${stops})`
}

/**
 * Renders the active holiday's effect, top stripe, and greeting. The active
 * holiday is decided by the inline boot script (which adds `theme-<id>` to
 * <html> before paint); this component just reads that class and looks the
 * holiday up in the registry. Renders nothing outside any window.
 */
export function Seasonal() {
  const [holiday, setHoliday] = useState<Holiday | null>(null)
  const [greetingVisible, setGreetingVisible] = useState(true)

  useEffect(() => {
    const id = Array.from(document.documentElement.classList)
      .filter((cls) => cls.startsWith("theme-") && cls !== "theme-active")
      .map((cls) => cls.slice("theme-".length))
      .find((candidate) => HOLIDAYS[candidate])
    if (id) setHoliday(HOLIDAYS[id])
  }, [])

  useEffect(() => {
    if (!holiday) return
    const timer = window.setTimeout(() => setGreetingVisible(false), 6800)
    return () => window.clearTimeout(timer)
  }, [holiday])

  if (!holiday) return null

  const { effect, stripe, greeting, greetingEmoji } = holiday
  const anniversaryYears = holiday.since ? new Date().getFullYear() - holiday.since : 0
  const greetingLine =
    anniversaryYears > 0 ? `${greeting} — ${anniversaryYears} years!` : `${greeting} from RealFiction`

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[62] h-1"
        style={{ background: stripeGradient(stripe) }}
      />

      {effect.kind === "fireworks" && <Fireworks colors={effect.colors} />}
      {effect.kind === "halloween" && <HalloweenHaunt />}
      {effect.kind === "christmas" && <ChristmasScene />}
      {effect.kind === "hanukkah" && <HanukkahScene />}
      {effect.kind === "snow" && (
        <FallingParticles
          colors={effect.colors}
          count={effect.count}
          sizeMin={2}
          sizeMax={5}
          speedMin={0.4}
          speedMax={1.3}
          sway={0.5}
        />
      )}
      {effect.kind === "glyphs" && (
        <FallingParticles
          glyphs={effect.glyphs}
          count={effect.count}
          spin={effect.spin}
          sizeMin={16}
          sizeMax={32}
          speedMin={0.6}
          speedMax={1.8}
          sway={0.9}
        />
      )}

      <div
        className={`pointer-events-none fixed inset-x-0 bottom-6 z-[61] flex justify-center px-4 transition-opacity duration-1000 ${
          greetingVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="rounded-full border border-white/15 bg-[#0a1830]/80 px-5 py-2 text-center text-sm font-medium text-white shadow-lg backdrop-blur">
          <span aria-hidden="true" className="mr-2">{greetingEmoji}</span>
          {greetingLine}
          <span aria-hidden="true" className="ml-2">{greetingEmoji}</span>
        </div>
      </div>
    </>
  )
}
