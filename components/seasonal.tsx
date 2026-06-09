"use client"

import { useEffect, useState } from "react"

import { Fireworks } from "@/components/fireworks"
import { isIndependenceDayWindow } from "@/lib/seasonal"

/**
 * Gates the Independence Day treatment (fireworks + greeting) to the July 1–7
 * window. Renders nothing on the server / outside the window, so there's zero
 * cost the rest of the year.
 *
 * Preview override (any date): add `?fireworks=1` to force it on, or
 * `?fireworks=0` to force it off.
 */
export function Seasonal() {
  const [active, setActive] = useState(false)
  const [greetingVisible, setGreetingVisible] = useState(true)

  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get("fireworks")
    if (override === "1" || override === "true") {
      setActive(true)
    } else if (override === "0" || override === "false") {
      setActive(false)
    } else {
      setActive(isIndependenceDayWindow())
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setGreetingVisible(false), 6500)
    return () => window.clearTimeout(timer)
  }, [active])

  if (!active) return null

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[62] h-1"
        style={{ background: "linear-gradient(90deg, #e5304a 0 33%, #f6f4ef 33% 66%, #4d8bf0 66% 100%)" }}
      />
      <Fireworks />
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-6 z-[61] flex justify-center px-4 transition-opacity duration-1000 ${
          greetingVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="rounded-full border border-white/15 bg-[#0a1830]/80 px-5 py-2 text-center text-sm font-medium text-white shadow-lg backdrop-blur">
          <span aria-hidden="true" className="mr-2">🎆</span>
          Happy Independence Day from RealFiction
          <span aria-hidden="true" className="ml-2">🎆</span>
        </div>
      </div>
    </>
  )
}
